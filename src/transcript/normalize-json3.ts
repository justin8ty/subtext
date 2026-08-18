import type { TranscriptSegment } from "./model.js";

interface Json3Segment {
  readonly utf8?: string;
}

interface Json3Event {
  readonly tStartMs?: number;
  readonly dDurationMs?: number;
  readonly segs?: readonly Json3Segment[];
}

interface Json3Document {
  readonly events?: readonly Json3Event[];
}

interface MutableCue {
  startMs: number;
  endMs: number;
  text: string;
  readonly sourceOrder: number;
}

export type CaptionNormalizationErrorKind = "invalid" | "empty";

export class CaptionNormalizationError extends Error {
  readonly kind: CaptionNormalizationErrorKind;

  constructor(kind: CaptionNormalizationErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CaptionNormalizationError";
    this.kind = kind;
  }
}

export function normalizeJson3Caption(
  rawCaption: string,
  videoDurationMs: number,
): readonly TranscriptSegment[] {
  let document: Json3Document;
  try {
    document = JSON.parse(rawCaption);
  } catch (error) {
    throw new CaptionNormalizationError(
      "invalid",
      "The selected Caption Track is not valid JSON3.",
      {
        cause: error,
      },
    );
  }

  if (!Array.isArray(document.events)) {
    throw new CaptionNormalizationError(
      "invalid",
      "The selected Caption Track has no caption events.",
    );
  }

  try {
    const cues = document.events.flatMap((event, sourceOrder) => cueFromEvent(event, sourceOrder));
    cues.sort(
      (left, right) => left.startMs - right.startMs || left.sourceOrder - right.sourceOrder,
    );

    const deduplicated = removeRollingCaptionDuplication(cues);
    const repaired = repairTiming(deduplicated, videoDurationMs);
    if (repaired.length === 0) {
      throw new CaptionNormalizationError(
        "empty",
        "The selected Caption Track contains no spoken text.",
      );
    }
    return repaired;
  } catch (error) {
    if (error instanceof CaptionNormalizationError) {
      throw error;
    }
    throw new CaptionNormalizationError("invalid", "The selected Caption Track is malformed.", {
      cause: error,
    });
  }
}

function cueFromEvent(event: Json3Event, sourceOrder: number): readonly MutableCue[] {
  if (!Number.isFinite(event.tStartMs) || !Array.isArray(event.segs)) {
    return [];
  }

  const text = normalizeWhitespace(event.segs.map((segment) => segment.utf8 ?? "").join(""));
  if (text === "") {
    return [];
  }

  const startMs = Math.max(0, Math.round(event.tStartMs ?? 0));
  const suppliedDuration = Number.isFinite(event.dDurationMs)
    ? Math.round(event.dDurationMs ?? 0)
    : 0;
  const endMs = startMs + Math.max(1, suppliedDuration);
  return [{ startMs, endMs, text, sourceOrder }];
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function removeRollingCaptionDuplication(cues: readonly MutableCue[]): MutableCue[] {
  const result: MutableCue[] = [];

  for (const cue of cues) {
    const previous = result.at(-1);
    if (previous === undefined) {
      result.push({ ...cue });
      continue;
    }

    const overlapsInTime = cue.startMs < previous.endMs;
    if (overlapsInTime && cue.text === previous.text) {
      previous.endMs = Math.max(previous.endMs, cue.endMs);
      continue;
    }

    if (overlapsInTime && cue.text.startsWith(`${previous.text} `)) {
      previous.text = cue.text;
      previous.endMs = Math.max(previous.endMs, cue.endMs);
      continue;
    }

    if (cue.startMs < previous.endMs) {
      const overlap = overlappingWordCount(previous.text, cue.text);
      if (overlap >= 2) {
        const remainingText = cue.text.split(" ").slice(overlap).join(" ");
        if (remainingText === "") {
          previous.endMs = Math.max(previous.endMs, cue.endMs);
          continue;
        }
        result.push({ ...cue, text: remainingText });
        continue;
      }
    }

    result.push({ ...cue });
  }

  return result;
}

function overlappingWordCount(previousText: string, currentText: string): number {
  const previousWords = previousText.split(" ");
  const currentWords = currentText.split(" ");
  const maximum = Math.min(previousWords.length, currentWords.length);

  for (let count = maximum; count >= 2; count -= 1) {
    const previousSuffix = previousWords.slice(-count).join(" ").toLocaleLowerCase();
    const currentPrefix = currentWords.slice(0, count).join(" ").toLocaleLowerCase();
    if (previousSuffix === currentPrefix) {
      return count;
    }
  }
  return 0;
}

function repairTiming(cues: readonly MutableCue[], videoDurationMs: number): TranscriptSegment[] {
  const durationLimit =
    Number.isFinite(videoDurationMs) && videoDurationMs > 0
      ? Math.round(videoDurationMs)
      : Infinity;
  const repaired: TranscriptSegment[] = [];

  for (const [index, cue] of cues.entries()) {
    if (cue.startMs >= durationLimit) {
      continue;
    }

    const nextCue = cues[index + 1];
    const naturalEnd = Math.min(cue.endMs, durationLimit);
    const nonOverlappingEnd =
      nextCue === undefined ? naturalEnd : Math.min(naturalEnd, nextCue.startMs);
    const endMs = Math.max(cue.startMs + 1, nonOverlappingEnd);
    repaired.push({ startMs: cue.startMs, endMs, text: cue.text });
  }

  return repaired;
}
