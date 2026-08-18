import { ArtifactLibrary, ArtifactLibraryError } from "../artifacts/artifact-library.js";
import { parseYoutubeUrl } from "../source-video/youtube-url.js";
import { CaptionNormalizationError, normalizeJson3Caption } from "../transcript/normalize-json3.js";
import { selectEligibleCaption } from "../transcript/select-caption.js";
import { assessTranscriptCoverage } from "../transcript/transcript-coverage.js";
import {
  CAPTION_TRACK_ARTIFACT_FILENAME,
  TRANSCRIPT_SCHEMA_VERSION,
  type CaptionProvenance,
  type Transcript,
} from "../transcript/model.js";
import type {
  CaptionTrack,
  InspectedSourceVideo,
  YoutubeAdapter,
} from "../youtube/youtube-adapter.js";
import { YoutubeAdapterError } from "../youtube/youtube-adapter.js";

export interface AcquisitionOptions {
  readonly refresh?: boolean;
  readonly signal?: AbortSignal;
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
        | "no-spoken-language"
        | "no-eligible-caption"
        | "empty-caption"
        | "invalid-caption"
        | "implausible-coverage"
        | "source-unavailable";
      readonly message: string;
    }
  | { readonly status: "blocked"; readonly message: string }
  | { readonly status: "failed"; readonly message: string; readonly cause?: Error }
  | { readonly status: "cancelled"; readonly message: string };

export class TranscriptAcquirer {
  readonly youtube: YoutubeAdapter;
  readonly library: ArtifactLibrary;

  constructor(youtube: YoutubeAdapter, library: ArtifactLibrary) {
    this.youtube = youtube;
    this.library = library;
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

      const video = await this.youtube.inspect(parsedUrl.canonicalUrl, options.signal);
      const eligibilityFailure = validateSourceVideo(video, parsedUrl.videoId);
      if (eligibilityFailure !== null) {
        return eligibilityFailure;
      }

      const selection = selectEligibleCaption(video);
      if (selection.status === "no-spoken-language") {
        return {
          status: "unavailable",
          reason: "no-spoken-language",
          message: "The Spoken Language could not be established, so no Caption Track is eligible.",
        };
      }
      if (selection.status === "no-eligible-caption") {
        return {
          status: "unavailable",
          reason: "no-eligible-caption",
          message: `No eligible ${selection.languageCode} Caption Track is available.`,
        };
      }

      const rawCaption = await this.youtube.downloadCaption(selection.track, options.signal);
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

      const transcript = createTranscript(video, selection.track, selection.languageCode, segments);
      const stored = await this.library.commitCaptionTranscript(transcript, rawCaption);
      return {
        status: "completed",
        transcript: stored.transcript,
        artifactDirectory: stored.artifactDirectory,
        artifactRevision: stored.revision,
        reused: false,
      };
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

function createTranscript(
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
    video: {
      id: video.id,
      title: video.title,
      canonicalUrl: video.canonicalUrl,
      durationMs: video.durationMs,
    },
    languageCode,
    segments,
    provenance,
  };
}

function acquisitionFailure(error: Error, signal?: AbortSignal): AcquisitionOutcome {
  if (signal?.aborted === true) {
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
