import { wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";

import type { SourceVideoRecord, Transcript, TranscriptSegment } from "../transcript/model.js";
import { TranscriptView, renderTimestampedSegment } from "./transcript-view.js";

export class TranscriptDraftView implements Component {
  readonly video: SourceVideoRecord;
  private readonly segments: TranscriptSegment[] = [];
  private completedTranscript: Transcript | null = null;

  constructor(video: SourceVideoRecord) {
    this.video = video;
  }

  append(segment: TranscriptSegment): void {
    if (this.completedTranscript === null) {
      this.segments.push(segment);
    }
  }

  complete(transcript: Transcript): void {
    this.completedTranscript = transcript;
  }

  render(width: number): string[] {
    if (width <= 0) {
      return [];
    }
    if (this.completedTranscript !== null) {
      return new TranscriptView(this.completedTranscript).render(width);
    }

    return [
      ...wrapTextWithAnsi(this.video.title, width),
      ...wrapTextWithAnsi("Transcript Draft · ASR · incomplete", width),
      "",
      ...this.segments.flatMap((segment) =>
        renderTimestampedSegment(segment, this.video.canonicalUrl, width),
      ),
    ];
  }

  invalidate(): void {}
}
