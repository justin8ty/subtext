import type { Component } from "@earendil-works/pi-tui";

import type { SourceVideoRecord, Transcript, TranscriptSegment } from "../transcript/model.js";
import { SectionHeader } from "./design-system.js";
import { TranscriptView, renderTimestampedSegment } from "./transcript-view.js";

export class TranscriptDraftView implements Component {
  readonly video: SourceVideoRecord;
  private readonly segments: TranscriptSegment[] = [];
  private completedTranscriptView: TranscriptView | null = null;

  constructor(video: SourceVideoRecord) {
    this.video = video;
  }

  append(segment: TranscriptSegment): void {
    if (this.completedTranscriptView === null) {
      this.segments.push(segment);
    }
  }

  complete(transcript: Transcript): void {
    this.completedTranscriptView = new TranscriptView(transcript);
  }

  get isCollapsed(): boolean {
    return this.completedTranscriptView?.isCollapsed ?? false;
  }

  toggleCollapsed(): void {
    this.completedTranscriptView?.toggleCollapsed();
  }

  render(width: number): string[] {
    if (width <= 0) {
      return [];
    }
    if (this.completedTranscriptView !== null) {
      return this.completedTranscriptView.render(width);
    }

    return [
      ...new SectionHeader(this.video.title, "Transcript Draft · ASR · Incomplete").render(width),
      "",
      ...this.segments.flatMap((segment) =>
        renderTimestampedSegment(segment, this.video.canonicalUrl, width),
      ),
    ];
  }

  invalidate(): void {}
}
