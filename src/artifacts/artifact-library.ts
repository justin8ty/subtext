import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  CAPTION_TRACK_ARTIFACT_FILENAME,
  TRANSCRIPT_SCHEMA_VERSION,
  type Transcript,
} from "../transcript/model.js";

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const TRANSCRIPT_FILENAME = "transcript.json";
const SUMMARY_FILENAME = "summary.md";

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

export class ArtifactLibraryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ArtifactLibraryError";
  }
}

export class ArtifactLibrary {
  readonly rootDirectory: string;

  constructor(rootDirectory = join(homedir(), ".subtext")) {
    this.rootDirectory = rootDirectory;
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
  }

  private async commitTranscriptRevision(
    transcript: Transcript,
    rawCaption?: string,
  ): Promise<StoredTranscript> {
    const videoDirectory = this.videoDirectory(transcript.video.id);
    const revisionsDirectory = join(videoDirectory, "revisions");
    const previousRevision = await readCurrentRevision(videoDirectory);
    const revision = `${Date.now()}-${randomUUID()}`;
    const artifactDirectory = join(revisionsDirectory, revision);
    await mkdir(artifactDirectory, { recursive: true, mode: 0o700 });

    try {
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

    if (previousRevision !== null && previousRevision !== revision) {
      await rm(join(revisionsDirectory, previousRevision), { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
    return { transcript, artifactDirectory, revision };
  }

  private videoDirectory(videoId: string): string {
    return join(this.rootDirectory, "videos", videoId);
  }
}

async function switchCurrentRevision(videoDirectory: string, revision: string): Promise<void> {
  await mkdir(videoDirectory, { recursive: true, mode: 0o700 });
  const temporaryPointer = join(videoDirectory, `.current-${randomUUID()}.json`);
  const currentPointer = join(videoDirectory, "current.json");
  await writeFile(temporaryPointer, `${JSON.stringify({ revision }, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPointer, currentPointer);
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
