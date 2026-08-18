export const TRANSCRIPT_SCHEMA_VERSION = 1;
export const CAPTION_TRACK_ARTIFACT_FILENAME = "caption-track.json3";

export type TranscriptOrigin = "creator-caption" | "automatic-caption" | "asr";

export interface TranscriptSegment {
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
}

export interface SourceVideoRecord {
  readonly id: string;
  readonly title: string;
  readonly canonicalUrl: string;
  readonly durationMs: number;
}

export interface CaptionProvenance {
  readonly origin: "creator-caption" | "automatic-caption";
  readonly languageCode: string;
  readonly trackName?: string;
  readonly rawArtifact: string;
  readonly normalization: readonly [
    "whitespace-normalization",
    "rolling-caption-deduplication",
    "timing-repair",
    "cue-boundary-repair",
  ];
}

export interface AsrProvenance {
  readonly origin: "asr";
  readonly languageCode: string;
  readonly model: string;
  readonly normalization: readonly ["whitespace-normalization", "timing-repair"];
}

export type TranscriptProvenance = CaptionProvenance | AsrProvenance;

export interface Transcript {
  readonly schemaVersion: typeof TRANSCRIPT_SCHEMA_VERSION;
  readonly video: SourceVideoRecord;
  readonly languageCode: string;
  readonly segments: readonly TranscriptSegment[];
  readonly provenance: TranscriptProvenance;
}
