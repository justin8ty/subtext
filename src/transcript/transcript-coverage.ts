import type { TranscriptSegment } from "./model.js";

export type TranscriptCoverage =
  | { readonly plausible: true }
  | { readonly plausible: false; readonly reason: "empty" | "starts-too-late" | "ends-too-early" };

export function assessTranscriptCoverage(
  segments: readonly TranscriptSegment[],
  videoDurationMs: number,
): TranscriptCoverage {
  const first = segments[0];
  const last = segments.at(-1);
  if (first === undefined || last === undefined) {
    return { plausible: false, reason: "empty" };
  }

  if (!Number.isFinite(videoDurationMs) || videoDurationMs <= 0) {
    return { plausible: true };
  }

  const latestPlausibleStart = Math.min(5 * 60_000, videoDurationMs * 0.5);
  if (first.startMs > latestPlausibleStart) {
    return { plausible: false, reason: "starts-too-late" };
  }

  const earliestPlausibleEnd = videoDurationMs * 0.5;
  if (last.endMs < earliestPlausibleEnd) {
    return { plausible: false, reason: "ends-too-early" };
  }

  return { plausible: true };
}
