import {
  TuiMainScreen,
  stripTerminalSequences,
  visibleWidth,
  type Terminal,
  type TUI,
} from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";

import type { AcquisitionOptions } from "../acquisition/acquire-transcript.js";
import type {
  SummaryProcessingOptions,
  SummaryProcessingOutcome,
  VideoProcessingOptions,
  VideoProcessingOutcome,
} from "../processing/process-video.js";
import { TRANSCRIPT_SCHEMA_VERSION, type Transcript } from "../transcript/model.js";
import { SubtextApp, type SourceVideoProcessing } from "./subtext-app.js";
import { SummaryView } from "./summary-view.js";
import { TranscriptView } from "./transcript-view.js";

const VIDEO_ID = "dQw4w9WgXcQ";
const SOURCE_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
const SUMMARY_MARKDOWN = `# Summary

## Overview
The opening idea is introduced [00:01].

## Chapters
- [00:01] Opening

## Claims
- The opening idea matters [00:01].

## Examples
- A later example appears [01:05].

## Caveats
- None stated.

## Takeaways
- Retain the opening idea [00:01].
`;
const TRANSCRIPT: Transcript = {
  schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
  video: {
    id: VIDEO_ID,
    title: "A fixture video with a useful title",
    canonicalUrl: SOURCE_URL,
    durationMs: 120_000,
  },
  languageCode: "en",
  segments: [
    { startMs: 1_000, endMs: 10_000, text: "The opening idea." },
    { startMs: 65_000, endMs: 80_000, text: "A later supporting example." },
  ],
  provenance: {
    origin: "creator-caption",
    languageCode: "en",
    rawArtifact: "caption-track.json3",
    normalization: [
      "whitespace-normalization",
      "rolling-caption-deduplication",
      "timing-repair",
      "cue-boundary-repair",
    ],
  },
};

describe("SubtextApp", () => {
  it("submits a URL and prints a timestamp-linked Transcript and Summary", async () => {
    const processing = new ImmediateProcessing({
      status: "completed",
      transcript: TRANSCRIPT,
      summaryMarkdown: SUMMARY_MARKDOWN,
      artifactDirectory: "/tmp/subtext-artifacts",
      reusedTranscript: false,
      reusedSummary: false,
    });
    const terminal = new FakeTerminal();
    const tui: TUI = new TuiMainScreen(terminal);
    const app = new SubtextApp(tui, processing);
    app.start();

    typeText(terminal, SOURCE_URL);
    terminal.send("\r");

    await vi.waitFor(() => expect(processing.calls).toBe(1));
    await vi.waitFor(() =>
      expect(renderedText(app)).toContain("Transcript and Summary completed."),
    );
    const rendered = app.render(80).join("\n");
    expect(stripTerminalSequences(rendered)).toContain("[01:05] A later supporting example.");
    expect(rendered).toContain(`${SOURCE_URL}&t=65s`);
    expect(stripTerminalSequences(rendered)).toContain("## Takeaways");
    app.stop();
  });

  it("prints the Transcript before Summary generation finishes", async () => {
    const processing = new DelayedSummaryProcessing();
    const terminal = new FakeTerminal();
    const tui: TUI = new TuiMainScreen(terminal);
    const app = new SubtextApp(tui, processing);
    app.start();

    typeText(terminal, SOURCE_URL);
    terminal.send("\r");

    await vi.waitFor(() => expect(renderedText(app)).toContain("The opening idea."));
    expect(renderedText(app)).not.toContain("## Overview");

    processing.completeSummary();

    await vi.waitFor(() => expect(renderedText(app)).toContain("## Overview"));
    app.stop();
  });

  it("rejects another URL while active and leaves an incomplete marker after cancellation", async () => {
    const processing = new AbortableProcessing();
    const terminal = new FakeTerminal();
    const tui: TUI = new TuiMainScreen(terminal);
    const app = new SubtextApp(tui, processing);
    app.start();

    typeText(terminal, SOURCE_URL);
    terminal.send("\r");
    await vi.waitFor(() => expect(processing.calls).toBe(1));

    typeText(terminal, `https://youtu.be/${VIDEO_ID}`);
    terminal.send("\r");
    expect(renderedText(app)).toContain("Another Source Video cannot be submitted");
    expect(processing.calls).toBe(1);

    terminal.send("\u001b");
    await vi.waitFor(() =>
      expect(renderedText(app)).toContain("Incomplete — Transcript acquisition was cancelled."),
    );
    expect(processing.signal?.aborted).toBe(true);
    app.stop();
  });

  it("marks a cancelled Summary incomplete while retaining the Transcript", async () => {
    const processing = new ImmediateProcessing({
      status: "unsummarized",
      transcript: TRANSCRIPT,
      artifactDirectory: "/tmp/subtext-artifacts",
      reusedTranscript: false,
      summaryStatus: "cancelled",
      message: "Summary generation was cancelled.",
    });
    const terminal = new FakeTerminal();
    const tui: TUI = new TuiMainScreen(terminal);
    const app = new SubtextApp(tui, processing);
    app.start();

    typeText(terminal, SOURCE_URL);
    terminal.send("\r");

    await vi.waitFor(() =>
      expect(renderedText(app)).toContain("Incomplete — Summary generation was cancelled."),
    );
    expect(renderedText(app)).toContain("The opening idea.");
    app.stop();
  });

  it("retries an unavailable Summary without reacquiring the Transcript", async () => {
    const processing = new RetrySummaryProcessing();
    const terminal = new FakeTerminal();
    const tui: TUI = new TuiMainScreen(terminal);
    const app = new SubtextApp(tui, processing);
    app.start();

    typeText(terminal, SOURCE_URL);
    terminal.send("\r");
    await vi.waitFor(() =>
      expect(renderedText(app)).toContain("Press R to retry Summary generation."),
    );

    terminal.send("R");

    await vi.waitFor(() => expect(processing.summaryCalls).toBe(1));
    await vi.waitFor(() => expect(renderedText(app)).toContain("Summary completed."));
    expect(renderedText(app)).toContain("## Overview");
    expect(processing.processCalls).toBe(1);
    app.stop();
  });

  it("opens the searchable palette and can quit through a filtered result", () => {
    const terminal = new FakeTerminal();
    const tui: TUI = new TuiMainScreen(terminal);
    const app = new SubtextApp(
      tui,
      new ImmediateProcessing({
        status: "needs-input",
        reason: "invalid-source-url",
        message: "Enter a URL.",
      }),
    );
    app.start();

    terminal.send("/");
    expect(tui.hasOverlay()).toBe(true);
    terminal.send("q");
    terminal.send("\r");

    expect(terminal.stopped).toBe(true);
  });
});

describe("TranscriptView", () => {
  it.each([5, 20, 80])("keeps every rendered line within a %d-column terminal", (width) => {
    const lines = new TranscriptView(TRANSCRIPT).render(width);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
  });
});

describe("SummaryView", () => {
  it.each([5, 20, 80])("keeps every rendered line within a %d-column terminal", (width) => {
    const lines = new SummaryView(SUMMARY_MARKDOWN).render(width);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
  });
});

class ImmediateProcessing implements SourceVideoProcessing {
  readonly outcome: VideoProcessingOutcome;
  calls = 0;

  constructor(outcome: VideoProcessingOutcome) {
    this.outcome = outcome;
  }

  async process(): Promise<VideoProcessingOutcome> {
    this.calls += 1;
    return this.outcome;
  }

  async summarize(): Promise<SummaryProcessingOutcome> {
    return { status: "unavailable", message: "No Transcript." };
  }
}

class DelayedSummaryProcessing implements SourceVideoProcessing {
  private finish: ((outcome: VideoProcessingOutcome) => void) | null = null;

  process(
    _sourceUrl: string,
    options: VideoProcessingOptions = {},
  ): Promise<VideoProcessingOutcome> {
    options.onTranscript?.({
      transcript: TRANSCRIPT,
      artifactDirectory: "/tmp/subtext-artifacts",
      reused: false,
    });
    return new Promise((resolve) => {
      this.finish = resolve;
    });
  }

  async summarize(): Promise<SummaryProcessingOutcome> {
    return { status: "unavailable", message: "No Transcript." };
  }

  completeSummary(): void {
    this.finish?.({
      status: "completed",
      transcript: TRANSCRIPT,
      summaryMarkdown: SUMMARY_MARKDOWN,
      artifactDirectory: "/tmp/subtext-artifacts",
      reusedTranscript: false,
      reusedSummary: false,
    });
  }
}

class AbortableProcessing implements SourceVideoProcessing {
  calls = 0;
  signal: AbortSignal | undefined;

  process(_sourceUrl: string, options: AcquisitionOptions = {}): Promise<VideoProcessingOutcome> {
    this.calls += 1;
    this.signal = options.signal;
    return new Promise((resolve) => {
      options.signal?.addEventListener(
        "abort",
        () => resolve({ status: "cancelled", message: "Transcript acquisition was cancelled." }),
        { once: true },
      );
    });
  }

  async summarize(
    _videoId: string,
    _options: SummaryProcessingOptions = {},
  ): Promise<SummaryProcessingOutcome> {
    return { status: "unavailable", message: "No Transcript." };
  }
}

class RetrySummaryProcessing implements SourceVideoProcessing {
  processCalls = 0;
  summaryCalls = 0;

  async process(): Promise<VideoProcessingOutcome> {
    this.processCalls += 1;
    return {
      status: "unsummarized",
      transcript: TRANSCRIPT,
      artifactDirectory: "/tmp/subtext-artifacts",
      reusedTranscript: false,
      summaryStatus: "failed",
      message: "Provider unavailable.",
    };
  }

  async summarize(): Promise<SummaryProcessingOutcome> {
    this.summaryCalls += 1;
    return {
      status: "completed",
      summaryMarkdown: SUMMARY_MARKDOWN,
      artifactDirectory: "/tmp/subtext-artifacts",
      reused: false,
    };
  }
}

class FakeTerminal implements Terminal {
  readonly columns = 80;
  readonly rows = 24;
  readonly kittyProtocolActive = false;
  readonly writes: string[] = [];
  stopped = false;
  private input: ((data: string) => void) | null = null;

  start(onInput: (data: string) => void, _onResize: () => void): void {
    this.input = onInput;
  }

  stop(): void {
    this.stopped = true;
    this.input = null;
  }

  async drainInput(): Promise<void> {}

  write(data: string): void {
    this.writes.push(data);
  }

  moveBy(_lines: number): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(_title: string): void {}
  setProgress(_active: boolean): void {}

  send(data: string): void {
    this.input?.(data);
  }
}

function typeText(terminal: FakeTerminal, text: string): void {
  for (const character of text) {
    terminal.send(character);
  }
}

function renderedText(app: SubtextApp): string {
  return stripTerminalSequences(app.render(80).join("\n"));
}
