import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { defaultAppDataDirectory } from "../platform/app-paths.js";
import {
  CAPTION_TRACK_ARTIFACT_FILENAME,
  TRANSCRIPT_SCHEMA_VERSION,
  type Transcript,
} from "../transcript/model.js";
import {
  TRANSCRIPT_EXPORT_FILENAMES,
  renderTranscriptExport,
  type TranscriptExportFormat,
} from "./transcript-export.js";

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const TRANSCRIPT_FILENAME = "transcript.json";
const SUMMARY_FILENAME = "summary.md";
const ARTIFACT_COMMIT_LOCKS = new Map<string, Promise<void>>();

interface CurrentRevision {
  readonly revision: string;
}

export interface StoredTranscript {
  readonly transcript: Transcript;
  readonly artifactDirectory: string;
  readonly revision: string;
}

export interface StoredSummary {
  readonly markdown: string;
  readonly artifactDirectory: string;
  readonly revision: string;
}

export interface ArtifactLibraryEntry {
  readonly videoId: string;
  readonly title: string;
  readonly canonicalUrl: string;
  readonly artifactDirectory: string;
  readonly languageCode: string;
  readonly transcriptOrigin: Transcript["provenance"]["origin"];
  readonly hasSummary: boolean;
  readonly updatedAtMs: number;
}

export interface ArtifactLibraryAccess {
  listEntries(): Promise<readonly ArtifactLibraryEntry[]>;
  findTranscript(videoId: string): Promise<StoredTranscript | null>;
  findSummary(videoId: string): Promise<StoredSummary | null>;
  exportTranscript(videoId: string, format: TranscriptExportFormat): Promise<string>;
  deleteVideoArtifacts(videoId: string): Promise<boolean>;
}

export class ArtifactLibraryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ArtifactLibraryError";
  }
}

export class ArtifactLibrary implements ArtifactLibraryAccess {
  readonly rootDirectory: string;

  constructor(rootDirectory = defaultAppDataDirectory()) {
    this.rootDirectory = rootDirectory;
  }

  async listEntries(): Promise<readonly ArtifactLibraryEntry[]> {
    let directories;
    try {
      directories = await readdir(join(this.rootDirectory, "videos"), { withFileTypes: true });
    } catch (error) {
      if (error instanceof Error && isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw new ArtifactLibraryError("Could not read the Artifact Library.", { cause: error });
    }

    const entries = await Promise.all(
      directories
        .filter((directory) => directory.isDirectory() && VIDEO_ID_PATTERN.test(directory.name))
        .map(async (directory): Promise<ArtifactLibraryEntry | null> => {
          const storedTranscript = await this.findTranscript(directory.name);
          if (storedTranscript === null) {
            return null;
          }
          const storedSummary = await this.findSummary(directory.name);
          return {
            videoId: storedTranscript.transcript.video.id,
            title: storedTranscript.transcript.video.title,
            canonicalUrl: storedTranscript.transcript.video.canonicalUrl,
            artifactDirectory: storedTranscript.artifactDirectory,
            languageCode: storedTranscript.transcript.languageCode,
            transcriptOrigin: storedTranscript.transcript.provenance.origin,
            hasSummary: storedSummary?.revision === storedTranscript.revision,
            updatedAtMs: revisionTimestamp(storedTranscript.revision),
          };
        }),
    );

    return entries
      .filter((entry): entry is ArtifactLibraryEntry => entry !== null)
      .sort(
        (left, right) =>
          right.updatedAtMs - left.updatedAtMs || left.title.localeCompare(right.title),
      );
  }

  async findTranscript(videoId: string): Promise<StoredTranscript | null> {
    validateVideoId(videoId);
    const videoDirectory = this.videoDirectory(videoId);
    let pointerText: string;
    try {
      pointerText = await readFile(join(videoDirectory, "current.json"), "utf8");
    } catch (error) {
      if (error instanceof Error && isNodeError(error) && error.code === "ENOENT") {
        return null;
      }
      throw new ArtifactLibraryError(`Could not read Video Artifacts for ${videoId}.`, {
        cause: error,
      });
    }

    try {
      const pointer: CurrentRevision = JSON.parse(pointerText);
      validateRevision(pointer.revision);
      const artifactDirectory = join(videoDirectory, "revisions", pointer.revision);
      const transcriptText = await readFile(join(artifactDirectory, TRANSCRIPT_FILENAME), "utf8");
      const transcript: Transcript = JSON.parse(transcriptText);
      validateTranscript(transcript, videoId);
      return { transcript, artifactDirectory, revision: pointer.revision };
    } catch (error) {
      throw new ArtifactLibraryError(`Video Artifacts for ${videoId} are invalid or incomplete.`, {
        cause: error,
      });
    }
  }

  async findSummary(videoId: string): Promise<StoredSummary | null> {
    validateVideoId(videoId);
    const videoDirectory = this.videoDirectory(videoId);
    const revision = await readCurrentRevision(videoDirectory);
    if (revision === null) {
      return null;
    }

    const artifactDirectory = join(videoDirectory, "revisions", revision);
    try {
      const markdown = await readFile(join(artifactDirectory, SUMMARY_FILENAME), "utf8");
      validateSummary(markdown);
      return { markdown, artifactDirectory, revision };
    } catch (error) {
      if (error instanceof Error && isNodeError(error) && error.code === "ENOENT") {
        return null;
      }
      throw new ArtifactLibraryError(`Could not read the Summary for ${videoId}.`, {
        cause: error,
      });
    }
  }

  async exportTranscript(videoId: string, format: TranscriptExportFormat): Promise<string> {
    const storedTranscript = await this.findTranscript(videoId);
    if (storedTranscript === null) {
      throw new ArtifactLibraryError(`No completed Transcript is available for ${videoId}.`);
    }

    const filename = TRANSCRIPT_EXPORT_FILENAMES[format];
    const exportPath = join(storedTranscript.artifactDirectory, filename);
    const temporaryPath = join(
      storedTranscript.artifactDirectory,
      `.${filename}-${randomUUID()}.tmp`,
    );
    try {
      await writeFile(temporaryPath, renderTranscriptExport(storedTranscript.transcript, format), {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temporaryPath, exportPath);
      return exportPath;
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw new ArtifactLibraryError(`Could not export the Transcript for ${videoId}.`, {
        cause: error,
      });
    }
  }

  async deleteVideoArtifacts(videoId: string): Promise<boolean> {
    validateVideoId(videoId);
    try {
      await rm(this.videoDirectory(videoId), { recursive: true });
      return true;
    } catch (error) {
      if (error instanceof Error && isNodeError(error) && error.code === "ENOENT") {
        return false;
      }
      throw new ArtifactLibraryError(`Could not delete Video Artifacts for ${videoId}.`, {
        cause: error,
      });
    }
  }

  async commitCaptionTranscript(
    transcript: Transcript,
    rawCaption: string,
  ): Promise<StoredTranscript> {
    validateTranscript(transcript, transcript.video.id);
    if (transcript.provenance.origin === "asr") {
      throw new ArtifactLibraryError("A caption commit requires Caption Track provenance.");
    }
    if (transcript.provenance.rawArtifact !== CAPTION_TRACK_ARTIFACT_FILENAME) {
      throw new ArtifactLibraryError(
        "Caption Track provenance does not name the canonical raw artifact.",
      );
    }
    if (rawCaption.trim() === "") {
      throw new ArtifactLibraryError("An empty Caption Track cannot be committed.");
    }
    return this.commitTranscriptRevision(transcript, rawCaption);
  }

  async commitAsrTranscript(transcript: Transcript): Promise<StoredTranscript> {
    validateTranscript(transcript, transcript.video.id);
    if (transcript.provenance.origin !== "asr") {
      throw new ArtifactLibraryError("An ASR commit requires ASR provenance.");
    }
    return this.commitTranscriptRevision(transcript);
  }

  async commitSummary(
    videoId: string,
    expectedRevision: string,
    markdown: string,
    signal?: AbortSignal,
  ): Promise<StoredSummary> {
    validateVideoId(videoId);
    validateRevision(expectedRevision);
    validateSummary(markdown);
    requireActiveSummaryCommit(signal);

    const videoDirectory = this.videoDirectory(videoId);
    return withArtifactCommitLock(videoDirectory, async () => {
      const currentRevision = await readCurrentRevision(videoDirectory);
      requireActiveSummaryCommit(signal);
      if (currentRevision !== expectedRevision) {
        throw new ArtifactLibraryError(
          `The Transcript for ${videoId} changed before its Summary could be committed.`,
        );
      }

      const artifactDirectory = join(videoDirectory, "revisions", expectedRevision);
      const temporarySummary = join(artifactDirectory, `.summary-${randomUUID()}.md`);
      const summary = join(artifactDirectory, SUMMARY_FILENAME);
      try {
        await writeFile(temporarySummary, `${markdown.trimEnd()}\n`, {
          encoding: "utf8",
          mode: 0o600,
        });
        requireActiveSummaryCommit(signal);
        await rename(temporarySummary, summary);
      } catch (error) {
        await rm(temporarySummary, { force: true }).catch(() => undefined);
        throw new ArtifactLibraryError(`Could not commit the Summary for ${videoId}.`, {
          cause: error,
        });
      }

      return { markdown: `${markdown.trimEnd()}\n`, artifactDirectory, revision: expectedRevision };
    });
  }

  private async commitTranscriptRevision(
    transcript: Transcript,
    rawCaption?: string,
  ): Promise<StoredTranscript> {
    const videoDirectory = this.videoDirectory(transcript.video.id);
    return withArtifactCommitLock(videoDirectory, async () => {
      const revisionsDirectory = join(videoDirectory, "revisions");
      const revision = `${Date.now()}-${randomUUID()}`;
      const artifactDirectory = join(revisionsDirectory, revision);

      try {
        await mkdir(artifactDirectory, { recursive: true, mode: 0o700 });
        if (rawCaption !== undefined) {
          await writeFile(join(artifactDirectory, CAPTION_TRACK_ARTIFACT_FILENAME), rawCaption, {
            encoding: "utf8",
            mode: 0o600,
          });
        }
        await writeFile(
          join(artifactDirectory, TRANSCRIPT_FILENAME),
          `${JSON.stringify(transcript, null, 2)}\n`,
          { encoding: "utf8", mode: 0o600 },
        );
        await switchCurrentRevision(videoDirectory, revision);
      } catch (error) {
        await rm(artifactDirectory, { recursive: true, force: true }).catch(() => undefined);
        throw new ArtifactLibraryError(
          `Could not commit Video Artifacts for ${transcript.video.id}.`,
          { cause: error },
        );
      }

      await removeObsoleteRevisions(revisionsDirectory, revision);
      return { transcript, artifactDirectory, revision };
    });
  }

  private videoDirectory(videoId: string): string {
    return join(this.rootDirectory, "videos", videoId);
  }
}

async function switchCurrentRevision(videoDirectory: string, revision: string): Promise<void> {
  await mkdir(videoDirectory, { recursive: true, mode: 0o700 });
  const temporaryPointer = join(videoDirectory, `.current-${randomUUID()}.json`);
  const currentPointer = join(videoDirectory, "current.json");
  try {
    await writeFile(temporaryPointer, `${JSON.stringify({ revision }, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPointer, currentPointer);
  } finally {
    await rm(temporaryPointer, { force: true }).catch(() => undefined);
  }
}

async function removeObsoleteRevisions(
  revisionsDirectory: string,
  currentRevision: string,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(revisionsDirectory, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name !== currentRevision)
      .map((entry) =>
        rm(join(revisionsDirectory, entry.name), { recursive: true, force: true }).catch(
          () => undefined,
        ),
      ),
  );
}

async function withArtifactCommitLock<T>(
  artifactKey: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = ARTIFACT_COMMIT_LOCKS.get(artifactKey) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(
    () => current,
    () => current,
  );
  ARTIFACT_COMMIT_LOCKS.set(artifactKey, tail);
  await previous.catch(() => undefined);

  try {
    return await operation();
  } finally {
    release();
    if (ARTIFACT_COMMIT_LOCKS.get(artifactKey) === tail) {
      ARTIFACT_COMMIT_LOCKS.delete(artifactKey);
    }
  }
}

async function readCurrentRevision(videoDirectory: string): Promise<string | null> {
  let pointerText: string;
  try {
    pointerText = await readFile(join(videoDirectory, "current.json"), "utf8");
  } catch (error) {
    if (error instanceof Error && isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    throw new ArtifactLibraryError("Could not inspect the current Video Artifact revision.", {
      cause: error,
    });
  }

  try {
    const pointer: CurrentRevision = JSON.parse(pointerText);
    validateRevision(pointer.revision);
    return pointer.revision;
  } catch (error) {
    throw new ArtifactLibraryError("The current Video Artifact revision is invalid.", {
      cause: error,
    });
  }
}

function validateVideoId(videoId: string): void {
  if (!VIDEO_ID_PATTERN.test(videoId)) {
    throw new ArtifactLibraryError(`Invalid YouTube video ID: ${videoId}`);
  }
}

function validateRevision(revision: string): void {
  if (!/^\d+-[0-9a-f-]{36}$/u.test(revision)) {
    throw new ArtifactLibraryError("The current Video Artifact revision is invalid.");
  }
}

function revisionTimestamp(revision: string): number {
  return Number.parseInt(revision.slice(0, revision.indexOf("-")), 10);
}

function validateTranscript(transcript: Transcript, expectedVideoId: string): void {
  if (
    transcript.schemaVersion !== TRANSCRIPT_SCHEMA_VERSION ||
    transcript.video.id !== expectedVideoId ||
    !Number.isFinite(transcript.video.durationMs) ||
    transcript.video.durationMs <= 0 ||
    !Array.isArray(transcript.segments) ||
    transcript.segments.length === 0 ||
    transcript.segments.some((segment, index, segments) => {
      const previous = segments[index - 1];
      return (
        !Number.isFinite(segment.startMs) ||
        !Number.isFinite(segment.endMs) ||
        segment.startMs < 0 ||
        segment.endMs <= segment.startMs ||
        segment.endMs > transcript.video.durationMs ||
        segment.text.trim() === "" ||
        (previous !== undefined && segment.startMs < previous.endMs)
      );
    })
  ) {
    throw new ArtifactLibraryError("The canonical Transcript is invalid.");
  }
}

function requireActiveSummaryCommit(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw new ArtifactLibraryError("Summary commit was cancelled.");
  }
}

function validateSummary(markdown: string): void {
  if (markdown.trim() === "") {
    throw new ArtifactLibraryError("An empty Summary cannot be committed.");
  }
}

function isNodeError(error: Error): error is NodeJS.ErrnoException {
  return "code" in error;
}
