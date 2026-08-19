import {
  hyperlink,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
} from "@earendil-works/pi-tui";

import type { Transcript, TranscriptSegment } from "../transcript/model.js";

export class TranscriptView implements Component {
  readonly transcript: Transcript;

  constructor(transcript: Transcript) {
    this.transcript = transcript;
  }

  render(width: number): string[] {
    if (width <= 0) {
      return [];
    }

    const lines = [
      ...wrapTextWithAnsi(this.transcript.video.title, width),
      `Transcript · ${this.transcript.languageCode} · ${provenanceLabel(this.transcript)}`,
      "",
    ];
    const fittedHeader = lines.flatMap((line) =>
      visibleWidth(line) <= width ? [line] : wrapTextWithAnsi(line, width),
    );
    return [
      ...fittedHeader,
      ...this.transcript.segments.flatMap((segment) =>
        renderTimestampedSegment(segment, this.transcript.video.canonicalUrl, width),
      ),
    ];
  }

  invalidate(): void {}
}

export function renderTimestampedSegment(
  segment: TranscriptSegment,
  canonicalUrl: string,
  width: number,
): string[] {
  const timestamp = formatTimestamp(segment.startMs);
  const seconds = Math.floor(segment.startMs / 1_000);
  const separator = canonicalUrl.includes("?") ? "&" : "?";
  const linkedTimestamp = hyperlink(timestamp, `${canonicalUrl}${separator}t=${seconds}s`);
  const prefixWidth = visibleWidth(timestamp) + 1;

  if (width <= prefixWidth) {
    return [truncateToWidth(linkedTimestamp, width, ""), ...wrapTextWithAnsi(segment.text, width)];
  }

  const textWidth = width - prefixWidth;
  const textLines = wrapTextWithAnsi(segment.text, textWidth);
  const [firstLine = "", ...remainingLines] = textLines;
  const indentation = " ".repeat(prefixWidth);
  return [
    `${linkedTimestamp} ${firstLine}`,
    ...remainingLines.map((line) => `${indentation}${line}`),
  ];
}

export function formatTimestamp(startMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(startMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `[${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}]`;
  }
  return `[${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}]`;
}

function provenanceLabel(transcript: Transcript): string {
  if (transcript.provenance.origin === "creator-caption") {
    return "creator captions";
  }
  if (transcript.provenance.origin === "automatic-caption") {
    return "automatic captions";
  }
  return "ASR";
}
