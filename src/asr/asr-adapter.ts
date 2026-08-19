import type { AsrQuality } from "../runtime/runtime-manifest.js";
import type { TranscriptSegment } from "../transcript/model.js";

export interface AsrTranscript {
  readonly languageCode: string;
  readonly model: string;
  readonly segments: readonly TranscriptSegment[];
}

export interface AsrTranscriptionOptions {
  readonly durationMs?: number;
  readonly languageCode?: string;
  readonly quality?: AsrQuality;
  readonly signal?: AbortSignal;
  readonly onSegment?: (segment: TranscriptSegment) => void;
}

export type AsrAdapterErrorKind = "cancelled" | "unavailable" | "failed" | "invalid";

export class AsrAdapterError extends Error {
  readonly kind: AsrAdapterErrorKind;

  constructor(kind: AsrAdapterErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AsrAdapterError";
    this.kind = kind;
  }
}

export interface AsrAdapter {
  transcribe(audioPath: string, options?: AsrTranscriptionOptions): Promise<AsrTranscript>;
}
