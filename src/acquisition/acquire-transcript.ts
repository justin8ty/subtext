import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AsrAdapterError,
  type AsrAdapter,
  type AsrTranscript,
  type AsrTranscriptionOptions,
} from "../asr/asr-adapter.js";
import { ArtifactLibrary, ArtifactLibraryError } from "../artifacts/artifact-library.js";
import type { ProcessingStageOptions } from "../processing/processing-stage.js";
import type { AsrQuality } from "../runtime/runtime-manifest.js";
import { parseYoutubeUrl } from "../source-video/youtube-url.js";
import { CaptionNormalizationError, normalizeJson3Caption } from "../transcript/normalize-json3.js";
import { selectEligibleCaption } from "../transcript/select-caption.js";
import { assessTranscriptCoverage } from "../transcript/transcript-coverage.js";
import {
  CAPTION_TRACK_ARTIFACT_FILENAME,
  TRANSCRIPT_SCHEMA_VERSION,
  type CaptionProvenance,
  type SourceVideoRecord,
  type Transcript,
  type TranscriptSegment,
} from "../transcript/model.js";
import type {
  CaptionTrack,
  InspectedSourceVideo,
  YoutubeAdapter,
} from "../youtube/youtube-adapter.js";
import { YoutubeAdapterError } from "../youtube/youtube-adapter.js";

type MutableAsrTranscriptionOptions = {
  -readonly [Key in keyof AsrTranscriptionOptions]: AsrTranscriptionOptions[Key];
};

class TemporaryWorkspaceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TemporaryWorkspaceError";
  }
}

export interface TranscriptDraft {
  readonly video: SourceVideoRecord;
  readonly segment: TranscriptSegment;
}

export interface AcquisitionOptions extends ProcessingStageOptions {
  readonly refresh?: boolean;
  readonly signal?: AbortSignal;
  readonly asrQuality?: AsrQuality;
  readonly onTranscriptDraft?: (draft: TranscriptDraft) => void;
}

export type AcquisitionOutcome =
  | {
      readonly status: "completed";
      readonly transcript: Transcript;
      readonly artifactDirectory: string;
      readonly artifactRevision: string;
      readonly reused: boolean;
    }
  | {
      readonly status: "needs-input";
      readonly reason: "invalid-source-url";
      readonly message: string;
    }
  | {
      readonly status: "unavailable";
      readonly reason:
        | "source-video-mismatch"
        | "not-public"
        | "live-stream"
        | "empty-caption"
        | "invalid-caption"
        | "empty-asr"
        | "invalid-asr"
        | "implausible-coverage"
        | "asr-unavailable"
        | "source-unavailable";
      readonly message: string;
    }
  | { readonly status: "blocked"; readonly message: string }
  | { readonly status: "failed"; readonly message: string; readonly cause?: Error }
  | { readonly status: "cancelled"; readonly message: string };

export class TranscriptAcquirer {
  readonly youtube: YoutubeAdapter;
  readonly asr: AsrAdapter;
  readonly library: ArtifactLibrary;
  readonly temporaryRootDirectory: string;

  constructor(
    youtube: YoutubeAdapter,
    asr: AsrAdapter,
    library: ArtifactLibrary,
    temporaryRootDirectory = tmpdir(),
  ) {
    this.youtube = youtube;
    this.asr = asr;
    this.library = library;
    this.temporaryRootDirectory = temporaryRootDirectory;
  }

  async acquire(sourceUrl: string, options: AcquisitionOptions = {}): Promise<AcquisitionOutcome> {
    const parsedUrl = parseYoutubeUrl(sourceUrl);
    if (parsedUrl.status === "invalid") {
      return {
        status: "needs-input",
        reason: "invalid-source-url",
        message: "Enter a URL for a single YouTube video.",
      };
    }

    try {
      if (options.refresh !== true) {
        const existing = await this.library.findTranscript(parsedUrl.videoId);
        if (existing !== null) {
          return {
            status: "completed",
            transcript: existing.transcript,
            artifactDirectory: existing.artifactDirectory,
            artifactRevision: existing.revision,
            reused: true,
          };
        }
      }

      options.onStage?.("inspecting-video");
      const video = await this.youtube.inspect(parsedUrl.canonicalUrl, options.signal);
      const eligibilityFailure = validateSourceVideo(video, parsedUrl.videoId);
      if (eligibilityFailure !== null) {
        return eligibilityFailure;
      }

      const selection = selectEligibleCaption(video);
      if (selection.status === "selected") {
        options.onStage?.("preparing-caption-transcript");
        return await this.acquireCaption(video, selection.track, selection.languageCode, options);
      }
      options.onStage?.("no-eligible-caption");
      options.onStage?.("switching-to-asr");
      return await this.acquireAsr(video, options);
    } catch (error) {
      if (!(error instanceof Error)) {
        return {
          status: "failed",
          message: "Transcript acquisition failed with an unrecognized error.",
        };
      }
      return acquisitionFailure(error, options.signal);
    }
  }

  private async acquireCaption(
    video: InspectedSourceVideo,
    track: CaptionTrack,
    languageCode: string,
    options: AcquisitionOptions,
  ): Promise<AcquisitionOutcome> {
    const rawCaption = await this.youtube.downloadCaption(track, options.signal);
    if (options.signal?.aborted === true) {
      return { status: "cancelled", message: "Transcript acquisition was cancelled." };
    }
    if (rawCaption.trim() === "") {
      return {
        status: "unavailable",
        reason: "empty-caption",
        message: "The selected Caption Track is empty.",
      };
    }

    const segments = normalizeJson3Caption(rawCaption, video.durationMs);
    const coverage = assessTranscriptCoverage(segments, video.durationMs);
    if (!coverage.plausible) {
      return {
        status: "unavailable",
        reason: "implausible-coverage",
        message: `The selected Caption Track does not plausibly cover the Source Video (${coverage.reason}).`,
      };
    }

    const transcript = createCaptionTranscript(video, track, languageCode, segments);
    const stored = await this.library.commitCaptionTranscript(transcript, rawCaption);
    return completedOutcome(stored, false);
  }

  private async acquireAsr(
    video: InspectedSourceVideo,
    options: AcquisitionOptions,
  ): Promise<AcquisitionOutcome> {
    const sourceVideo = sourceVideoRecord(video);
    const asrTranscript = await this.transcribeDefaultAudio(video, sourceVideo, options);
    if (signalIsAborted(options.signal)) {
      return { status: "cancelled", message: "Transcript acquisition was cancelled." };
    }
    if (asrTranscript.segments.length === 0) {
      return {
        status: "unavailable",
        reason: "empty-asr",
        message: "ASR produced no spoken text.",
      };
    }
    if (!isCanonicalAsrTranscript(asrTranscript, video.durationMs)) {
      return {
        status: "unavailable",
        reason: "invalid-asr",
        message: "ASR produced an invalid timed Transcript.",
      };
    }

    const coverage = assessTranscriptCoverage(asrTranscript.segments, video.durationMs);
    if (!coverage.plausible) {
      return {
        status: "unavailable",
        reason: "implausible-coverage",
        message: `The ASR Transcript does not plausibly cover the Source Video (${coverage.reason}).`,
      };
    }

    const transcript: Transcript = {
      schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
      video: sourceVideo,
      languageCode: asrTranscript.languageCode,
      segments: asrTranscript.segments,
      provenance: {
        origin: "asr",
        languageCode: asrTranscript.languageCode,
        model: asrTranscript.model,
        normalization: ["whitespace-normalization", "timing-repair"],
      },
    };
    const stored = await this.library.commitAsrTranscript(transcript);
    return completedOutcome(stored, false);
  }

  private async transcribeDefaultAudio(
    video: InspectedSourceVideo,
    sourceVideo: SourceVideoRecord,
    options: AcquisitionOptions,
  ): Promise<AsrTranscript> {
    const workspace = await mkdtemp(join(this.temporaryRootDirectory, "subtext-asr-"));
    const audioPath = join(workspace, "default-audio.wav");
    let transcription:
      | { readonly status: "completed"; readonly result: AsrTranscript }
      | { readonly status: "failed"; readonly error: unknown };
    try {
      options.onStage?.("downloading-default-audio");
      await this.youtube.downloadDefaultAudio(video.canonicalUrl, audioPath, options.signal);
      if (signalIsAborted(options.signal)) {
        throw new AsrAdapterError("cancelled", "Transcript acquisition was cancelled.");
      }

      const asrOptions: MutableAsrTranscriptionOptions = { durationMs: video.durationMs };
      if (options.asrQuality !== undefined) {
        asrOptions.quality = options.asrQuality;
      }
      if (video.spokenLanguage !== undefined) {
        asrOptions.languageCode = video.spokenLanguage;
      }
      if (options.signal !== undefined) {
        asrOptions.signal = options.signal;
      }
      if (options.onTranscriptDraft !== undefined) {
        const onTranscriptDraft = options.onTranscriptDraft;
        asrOptions.onSegment = (segment) => onTranscriptDraft({ video: sourceVideo, segment });
      }
      if (options.onStage !== undefined) {
        asrOptions.onStage = options.onStage;
      }
      transcription = {
        status: "completed",
        result: await this.asr.transcribe(audioPath, asrOptions),
      };
    } catch (error) {
      transcription = { status: "failed", error };
    }

    try {
      await rm(workspace, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    } catch (error) {
      throw new TemporaryWorkspaceError("Could not remove temporary ASR files.", {
        cause: error,
      });
    }
    if (transcription.status === "failed") {
      throw transcription.error;
    }
    return transcription.result;
  }
}

function validateSourceVideo(
  video: InspectedSourceVideo,
  expectedVideoId: string,
): AcquisitionOutcome | null {
  if (video.id !== expectedVideoId) {
    return {
      status: "unavailable",
      reason: "source-video-mismatch",
      message: "YouTube resolved the URL to a different Source Video.",
    };
  }
  if (video.availability !== undefined && video.availability !== "public") {
    return {
      status: "unavailable",
      reason: "not-public",
      message: "The Source Video is not public.",
    };
  }
  if (video.liveStatus !== undefined && video.liveStatus !== "not_live") {
    return {
      status: "unavailable",
      reason: "live-stream",
      message: "Live streams and videos produced as live streams are not supported.",
    };
  }
  return null;
}

function createCaptionTranscript(
  video: InspectedSourceVideo,
  track: CaptionTrack,
  languageCode: string,
  segments: Transcript["segments"],
): Transcript {
  const baseProvenance = {
    origin: track.origin,
    languageCode,
    rawArtifact: CAPTION_TRACK_ARTIFACT_FILENAME,
    normalization: [
      "whitespace-normalization",
      "rolling-caption-deduplication",
      "timing-repair",
      "cue-boundary-repair",
    ],
  } satisfies CaptionProvenance;
  const provenance: CaptionProvenance =
    track.name === undefined ? baseProvenance : { ...baseProvenance, trackName: track.name };

  return {
    schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
    video: sourceVideoRecord(video),
    languageCode,
    segments,
    provenance,
  };
}

function sourceVideoRecord(video: InspectedSourceVideo): SourceVideoRecord {
  return {
    id: video.id,
    title: video.title,
    canonicalUrl: video.canonicalUrl,
    durationMs: video.durationMs,
  };
}

function completedOutcome(
  stored: Awaited<
    ReturnType<ArtifactLibrary["commitCaptionTranscript"] | ArtifactLibrary["commitAsrTranscript"]>
  >,
  reused: boolean,
): AcquisitionOutcome {
  return {
    status: "completed",
    transcript: stored.transcript,
    artifactDirectory: stored.artifactDirectory,
    artifactRevision: stored.revision,
    reused,
  };
}

function isCanonicalAsrTranscript(transcript: AsrTranscript, durationMs: number): boolean {
  if (transcript.languageCode.trim() === "" || transcript.model.trim() === "") {
    return false;
  }
  return transcript.segments.every((segment, index, segments) => {
    const previous = segments[index - 1];
    return (
      Number.isFinite(segment.startMs) &&
      Number.isFinite(segment.endMs) &&
      segment.startMs >= 0 &&
      segment.endMs > segment.startMs &&
      segment.endMs <= durationMs &&
      segment.text === segment.text.replace(/\s+/gu, " ").trim() &&
      segment.text !== "" &&
      (previous === undefined || segment.startMs >= previous.endMs)
    );
  });
}

function signalIsAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

function acquisitionFailure(error: Error, signal?: AbortSignal): AcquisitionOutcome {
  if (error instanceof TemporaryWorkspaceError) {
    return { status: "failed", message: error.message, cause: error };
  }
  if (signalIsAborted(signal)) {
    return { status: "cancelled", message: "Transcript acquisition was cancelled." };
  }
  if (error instanceof YoutubeAdapterError) {
    if (error.kind === "cancelled") {
      return { status: "cancelled", message: error.message };
    }
    if (error.kind === "blocked") {
      return { status: "blocked", message: error.message };
    }
    if (error.kind === "unavailable") {
      return { status: "unavailable", reason: "source-unavailable", message: error.message };
    }
    return { status: "failed", message: error.message, cause: error };
  }
  if (error instanceof AsrAdapterError) {
    if (error.kind === "cancelled") {
      return { status: "cancelled", message: error.message };
    }
    if (error.kind === "unavailable") {
      return { status: "unavailable", reason: "asr-unavailable", message: error.message };
    }
    if (error.kind === "invalid") {
      return { status: "unavailable", reason: "invalid-asr", message: error.message };
    }
    return { status: "failed", message: error.message, cause: error };
  }
  if (error instanceof CaptionNormalizationError) {
    return {
      status: "unavailable",
      reason: error.kind === "empty" ? "empty-caption" : "invalid-caption",
      message: error.message,
    };
  }
  if (error instanceof ArtifactLibraryError) {
    return { status: "failed", message: error.message, cause: error };
  }
  return { status: "failed", message: "Transcript acquisition failed.", cause: error };
}
