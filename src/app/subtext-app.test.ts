import {
  TuiMainScreen,
  stripTerminalSequences,
  visibleWidth,
  type Terminal,
  type TUI,
} from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";

import type { AcquisitionOptions, AcquisitionOutcome } from "../acquisition/acquire-transcript.js";
import { TRANSCRIPT_SCHEMA_VERSION, type Transcript } from "../transcript/model.js";
import { SubtextApp, type TranscriptAcquisition } from "./subtext-app.js";
import { TranscriptView } from "./transcript-view.js";

const VIDEO_ID = "dQw4w9WgXcQ";
const SOURCE_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
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
  it("submits a URL and prints a timestamp-linked Transcript", async () => {
    const acquisition = new ImmediateAcquisition({
      status: "completed",
      transcript: TRANSCRIPT,
      artifactDirectory: "/tmp/subtext-artifacts",
      reused: false,
    });
    const terminal = new FakeTerminal();
    const tui: TUI = new TuiMainScreen(terminal);
    const app = new SubtextApp(tui, acquisition);
    app.start();

    typeText(terminal, SOURCE_URL);
    terminal.send("\r");

    await vi.waitFor(() => expect(acquisition.calls).toBe(1));
    await vi.waitFor(() => expect(renderedText(app)).toContain("Transcript completed."));
    const rendered = app.render(80).join("\n");
    expect(stripTerminalSequences(rendered)).toContain("[01:05] A later supporting example.");
    expect(rendered).toContain(`${SOURCE_URL}&t=65s`);
    app.stop();
  });

  it("rejects another URL while active and leaves an incomplete marker after cancellation", async () => {
    const acquisition = new AbortableAcquisition();
    const terminal = new FakeTerminal();
    const tui: TUI = new TuiMainScreen(terminal);
    const app = new SubtextApp(tui, acquisition);
    app.start();

    typeText(terminal, SOURCE_URL);
    terminal.send("\r");
    await vi.waitFor(() => expect(acquisition.calls).toBe(1));

    typeText(terminal, `https://youtu.be/${VIDEO_ID}`);
    terminal.send("\r");
    expect(renderedText(app)).toContain("Another Source Video cannot be submitted");
    expect(acquisition.calls).toBe(1);

    terminal.send("\u001b");
    await vi.waitFor(() =>
      expect(renderedText(app)).toContain("Incomplete — Transcript acquisition was cancelled."),
    );
    expect(acquisition.signal?.aborted).toBe(true);
    app.stop();
  });

  it("opens the searchable palette and can quit through a filtered result", () => {
    const terminal = new FakeTerminal();
    const tui: TUI = new TuiMainScreen(terminal);
    const app = new SubtextApp(
      tui,
      new ImmediateAcquisition({
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

class ImmediateAcquisition implements TranscriptAcquisition {
  readonly outcome: AcquisitionOutcome;
  calls = 0;

  constructor(outcome: AcquisitionOutcome) {
    this.outcome = outcome;
  }

  async acquire(): Promise<AcquisitionOutcome> {
    this.calls += 1;
    return this.outcome;
  }
}

class AbortableAcquisition implements TranscriptAcquisition {
  calls = 0;
  signal: AbortSignal | undefined;

  acquire(_sourceUrl: string, options: AcquisitionOptions = {}): Promise<AcquisitionOutcome> {
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
