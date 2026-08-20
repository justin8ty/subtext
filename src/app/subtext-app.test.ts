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
  ArtifactLibraryAccess,
  ArtifactLibraryEntry,
  StoredSummary,
  StoredTranscript,
} from "../artifacts/artifact-library.js";
import type { TranscriptExportFormat } from "../artifacts/transcript-export.js";
import type {
  ApplicationConfigurationAccess,
  ConfigurationUpdate,
} from "../config/application-configuration.js";
import type { ApplicationSettings } from "../config/application-settings.js";
import type { ExternalOpener } from "../platform/external-opener.js";
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
  it("renders a focused URL editor with placeholder text and a contextual hint", () => {
    const terminal = new FakeTerminal();
    const tui: TUI = new TuiMainScreen(terminal);
    const app = new SubtextApp(
      tui,
      new ImmediateProcessing({
        status: "needs-input",
        reason: "invalid-source-url",
        message: "Fixture outcome.",
      }),
    );
    app.start();

    const rendered = app.render(80).join("\n");
    const plain = stripTerminalSequences(rendered);
    expect(plain).toContain("Paste a YouTube URL…");
    expect(plain).toContain("Public, completed YouTube videos only · Enter to process");
    expect(rendered).toContain("\u001b[36m╭");
    app.stop();
  });

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
    expect(stripTerminalSequences(rendered)).toContain("01:05  A later supporting example.");
    expect(rendered).toContain(`${SOURCE_URL}&t=65s`);
    expect(rendered).toContain("\u001b[1;36mSubtext\u001b[0m");
    expect(rendered).toContain(`\u001b[1m${TRANSCRIPT.video.title}\u001b[0m`);
    expect(rendered).toContain("\u001b[4m\u001b[2;36m01:05\u001b[0m\u001b[0m");
    expect(rendered).toContain("\u001b[32mTranscript and Summary completed.\u001b[0m");
    expect(stripTerminalSequences(rendered)).toContain("Takeaways");
    expect(stripTerminalSequences(rendered)).not.toContain("## Takeaways");
    app.stop();
  });

  it("reports the ASR fallback while Default Audio and runtime preparation are pending", async () => {
    const processing = new PendingAsrFallbackProcessing();
    const terminal = new FakeTerminal();
    const tui: TUI = new TuiMainScreen(terminal);
    const app = new SubtextApp(tui, processing);
    app.start();

    typeText(terminal, SOURCE_URL);
    terminal.send("\r");

    await vi.waitFor(() =>
      expect(renderedText(app)).toContain("✓ No eligible Caption Track found"),
    );
    const rendered = renderedText(app);
    expect(rendered).toContain("✓ Source Video inspected");
    expect(rendered).toContain("→ Switching to local ASR");
    expect(rendered).toContain("↓ Downloading Default Audio");
    expect(rendered.match(/^[●↓◌] /gmu)).toHaveLength(1);
    const styled = app.render(80).join("\n");
    expect(styled).toContain("\u001b[33m✓ No eligible Caption Track found\u001b[0m");
    expect(styled).toContain("\u001b[1;36m↓ Downloading Default Audio\u001b[0m");
    expect(styled).toContain("\u001b[2;37m╭");
    expect(stripTerminalSequences(styled)).toContain(
      "Processing active · New URLs unavailable · / App Commands remain available",
    );
    app.stop();
  });

  it("renders failures in red", async () => {
    const processing = new ImmediateProcessing({
      status: "failed",
      message: "Fixture failure.",
    });
    const terminal = new FakeTerminal();
    const tui: TUI = new TuiMainScreen(terminal);
    const app = new SubtextApp(tui, processing);
    app.start();

    typeText(terminal, SOURCE_URL);
    terminal.send("\r");

    await vi.waitFor(() => expect(renderedText(app)).toContain("Failed — Fixture failure."));
    expect(app.render(80).join("\n")).toContain("\u001b[31mFailed — Fixture failure.\u001b[0m");
    app.stop();
  });

  it("streams an ASR Transcript Draft and replaces it with the canonical Transcript", async () => {
    const processing = new DelayedAsrProcessing();
    const terminal = new FakeTerminal();
    const tui: TUI = new TuiMainScreen(terminal);
    const app = new SubtextApp(tui, processing);
    app.start();

    typeText(terminal, SOURCE_URL);
    terminal.send("\r");

    await vi.waitFor(() =>
      expect(renderedText(app)).toContain("Transcript Draft · ASR · incomplete"),
    );
    expect(renderedText(app)).toContain("The opening idea.");
    expect(renderedText(app)).not.toContain("Overview");

    processing.complete();

    await vi.waitFor(() => expect(renderedText(app)).toContain("Overview"));
    expect(renderedText(app)).not.toContain("Transcript Draft · ASR · incomplete");
    expect(renderedText(app).match(/The opening idea\./gu)).toHaveLength(1);
    app.stop();
  });

  it("keeps a streamed Transcript Draft with an explicit marker after ASR cancellation", async () => {
    const processing = new CancelledAsrProcessing();
    const terminal = new FakeTerminal();
    const tui: TUI = new TuiMainScreen(terminal);
    const app = new SubtextApp(tui, processing);
    app.start();

    typeText(terminal, SOURCE_URL);
    terminal.send("\r");

    await vi.waitFor(() =>
      expect(renderedText(app)).toContain("Incomplete — ASR transcription was cancelled."),
    );
    expect(renderedText(app)).toContain("Transcript Draft · ASR · incomplete");
    expect(renderedText(app)).toContain("The opening idea.");
    app.stop();
  });

  it("snapshots the selected ASR quality when a Source Video is submitted", async () => {
    const processing = new ImmediateProcessing({
      status: "needs-input",
      reason: "invalid-source-url",
      message: "Fixture outcome.",
    });
    const terminal = new FakeTerminal();
    const tui: TUI = new TuiMainScreen(terminal);
    const app = new SubtextApp(tui, processing, {
      configuration: configuredApplication(),
    });
    app.start();

    typeText(terminal, SOURCE_URL);
    terminal.send("\r");

    await vi.waitFor(() => expect(processing.calls).toBe(1));
    expect(processing.options?.asrQuality).toBe("accurate");
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
    expect(renderedText(app)).not.toContain("Overview");

    processing.completeSummary();

    await vi.waitFor(() => expect(renderedText(app)).toContain("Overview"));
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

  it("keeps App Command Completion and inline Help available during active processing", async () => {
    const processing = new AbortableProcessing();
    const terminal = new FakeTerminal();
    const tui: TUI = new TuiMainScreen(terminal);
    const app = new SubtextApp(tui, processing);
    app.start();

    typeText(terminal, SOURCE_URL);
    terminal.send("\r");
    await vi.waitFor(() => expect(processing.calls).toBe(1));

    terminal.send("/");
    await vi.waitFor(() => expect(renderedText(app)).toContain("Browse completed Video Artifacts"));
    terminal.send("\u001b");
    expect(processing.signal?.aborted).toBe(false);

    typeText(terminal, "help");
    await vi.waitFor(() => expect(renderedText(app)).toContain("→ Help"));
    terminal.send("\r");

    await vi.waitFor(() => expect(renderedText(app)).toContain("Subtext Help"));
    expect(renderedText(app)).not.toContain("Browse completed Video Artifacts");
    expect(tui.hasOverlay()).toBe(false);
    expect(processing.signal?.aborted).toBe(false);

    processing.complete();
    await vi.waitFor(() => expect(renderedText(app)).toContain("Ready for another URL."));
    terminal.send("\u001b");
    expect(renderedText(app)).not.toContain("Subtext Help");
    expect(processing.signal?.aborted).toBe(false);
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
    expect(renderedText(app)).toContain("Overview");
    expect(renderedText(app)).not.toContain("## Overview");
    expect(processing.processCalls).toBe(1);
    app.stop();
  });

  it("runs first-use authentication and Options setup without rendering the API key", async () => {
    const terminal = new FakeTerminal();
    const tui: TUI = new TuiMainScreen(terminal);
    const configuration = new FirstRunConfiguration();
    const app = new SubtextApp(
      tui,
      new ImmediateProcessing({
        status: "needs-input",
        reason: "invalid-source-url",
        message: "Enter a URL.",
      }),
      { configuration },
    );
    app.start();

    expect(tui.hasOverlay()).toBe(false);
    expect(renderedText(app)).toContain("Set up Subtext");
    terminal.send("\r");
    typeText(terminal, "fixture-secret-key");
    expect(renderedText(app)).not.toContain("fixture-secret-key");
    terminal.send("\r");
    terminal.send("\r");
    terminal.send("\r");
    terminal.send("\r");

    await vi.waitFor(() => expect(configuration.saved?.apiKey).toBe("fixture-secret-key"));
    await vi.waitFor(() => expect(renderedText(app)).not.toContain("Set up Subtext"));
    expect(tui.hasOverlay()).toBe(false);
    expect(configuration.current).toMatchObject({
      summaryProvider: "deepseek",
      summaryModel: "deepseek-v4-flash",
      summaryDetail: "standard",
      asrQuality: "balanced",
    });
    app.stop();
  });

  it("prints a selected Transcript and Summary from the Artifact Library", async () => {
    const processing = new ImmediateProcessing({
      status: "needs-input",
      reason: "invalid-source-url",
      message: "Enter a URL.",
    });
    const library = new FixtureArtifactLibrary();
    const terminal = new FakeTerminal();
    const tui: TUI = new TuiMainScreen(terminal);
    const app = new SubtextApp(tui, processing, { library });
    app.start();

    terminal.send("/");
    terminal.send("l");
    await vi.waitFor(() => expect(renderedText(app)).toContain("→ Library"));
    terminal.send("\r");

    await vi.waitFor(() => expect(library.listCalls).toBe(1));
    await vi.waitFor(() => expect(renderedText(app)).toContain("Artifact Library"));
    expect(renderedText(app)).toContain("[CAPTIONS] [SUMMARY]");
    expect(app.render(80).join("\n")).toContain("\u001b[1;30;46m");
    expect(tui.hasOverlay()).toBe(false);
    terminal.send("\r");
    terminal.send("\r");

    await vi.waitFor(() => expect(renderedText(app)).toContain("Overview"));
    expect(renderedText(app)).not.toContain("## Overview");
    expect(renderedText(app)).toContain("The opening idea.");
    expect(renderedText(app)).toContain("Printed Video Artifacts from the Artifact Library.");
    expect(processing.calls).toBe(0);
    app.stop();
  });

  it("regenerates the Summary for the selected Library entry", async () => {
    const processing = new RetrySummaryProcessing();
    const library = new FixtureArtifactLibrary();
    const terminal = new FakeTerminal();
    const tui: TUI = new TuiMainScreen(terminal);
    const app = new SubtextApp(tui, processing, { library });
    app.start();

    await selectLibraryAction(app, terminal, tui, library, 1);

    await vi.waitFor(() => expect(processing.summaryCalls).toBe(1));
    expect(processing.summaryVideoId).toBe(VIDEO_ID);
    expect(processing.processCalls).toBe(0);
    app.stop();
  });

  it("exports the selected Library Transcript on demand", async () => {
    const library = new FixtureArtifactLibrary();
    const terminal = new FakeTerminal();
    const tui: TUI = new TuiMainScreen(terminal);
    const app = new SubtextApp(
      tui,
      new ImmediateProcessing({
        status: "needs-input",
        reason: "invalid-source-url",
        message: "Enter a URL.",
      }),
      { library },
    );
    app.start();

    await selectLibraryAction(app, terminal, tui, library, 2);
    terminal.send("\u001b[B");
    terminal.send("\u001b[B");
    terminal.send("\u001b[B");
    terminal.send("\r");

    await vi.waitFor(() => expect(library.exportedFormat).toBe("srt"));
    expect(renderedText(app)).toContain(
      "Exported Transcript to /tmp/subtext-artifacts/transcript.srt.",
    );
    app.stop();
  });

  it("opens the selected Source Video and Artifact directory", async () => {
    const library = new FixtureArtifactLibrary();
    const opener = new FixtureExternalOpener();
    const terminal = new FakeTerminal();
    const tui: TUI = new TuiMainScreen(terminal);
    const app = new SubtextApp(
      tui,
      new ImmediateProcessing({
        status: "needs-input",
        reason: "invalid-source-url",
        message: "Enter a URL.",
      }),
      { library, externalOpener: opener },
    );
    app.start();

    await selectLibraryAction(app, terminal, tui, library, 3);
    await vi.waitFor(() => expect(opener.targets).toEqual([SOURCE_URL]));
    await selectLibraryAction(app, terminal, tui, library, 4);
    await vi.waitFor(() => expect(opener.targets).toEqual([SOURCE_URL, "/tmp/subtext-artifacts"]));
    app.stop();
  });

  it("refreshes the selected Library entry instead of reusing it", async () => {
    const processing = new ImmediateProcessing({
      status: "needs-input",
      reason: "invalid-source-url",
      message: "Fixture outcome.",
    });
    const library = new FixtureArtifactLibrary();
    const terminal = new FakeTerminal();
    const tui: TUI = new TuiMainScreen(terminal);
    const app = new SubtextApp(tui, processing, { library });
    app.start();

    await selectLibraryAction(app, terminal, tui, library, 5);

    await vi.waitFor(() => expect(processing.calls).toBe(1));
    expect(processing.options?.refresh).toBe(true);
    app.stop();
  });

  it("deletes selected Video Artifacts only after confirmation", async () => {
    const library = new FixtureArtifactLibrary();
    const terminal = new FakeTerminal();
    const tui: TUI = new TuiMainScreen(terminal);
    const app = new SubtextApp(
      tui,
      new ImmediateProcessing({
        status: "needs-input",
        reason: "invalid-source-url",
        message: "Enter a URL.",
      }),
      { library },
    );
    app.start();

    await selectLibraryAction(app, terminal, tui, library, 6);
    expect(library.deleteCalls).toBe(0);
    terminal.send("n");
    expect(library.deleteCalls).toBe(0);

    await selectLibraryAction(app, terminal, tui, library, 6);
    terminal.send("y");

    await vi.waitFor(() => expect(library.deleteCalls).toBe(1));
    expect(renderedText(app)).toContain("Video Artifacts deleted.");
    app.stop();
  });

  it("replaces Command Completion with inline Options selected through its settings alias", async () => {
    const terminal = new FakeTerminal();
    const tui: TUI = new TuiMainScreen(terminal);
    const app = new SubtextApp(
      tui,
      new ImmediateProcessing({
        status: "needs-input",
        reason: "invalid-source-url",
        message: "Enter a URL.",
      }),
      { configuration: configuredApplication() },
    );
    app.start();

    terminal.send("/");
    await vi.waitFor(() => expect(renderedText(app)).toContain("Browse completed Video Artifacts"));
    expect(renderedText(app)).toContain("Configure Summary and ASR preferences");
    expect(renderedText(app)).toContain("├");
    expect(app.render(80).join("\n")).toContain("\u001b[1;30;46m");
    expect(tui.hasOverlay()).toBe(false);

    typeText(terminal, "settings");
    await vi.waitFor(() => expect(renderedText(app)).toContain("→ Options"));
    terminal.send("\r");

    await vi.waitFor(() => expect(renderedText(app)).toContain("Subtext Options"));
    expect(renderedText(app)).not.toContain("Browse completed Video Artifacts");
    expect(renderedText(app)).not.toContain("Configure Summary and ASR preferences");
    expect(tui.hasOverlay()).toBe(false);
    app.stop();
  });
});

describe("TranscriptView", () => {
  it.each([5, 20, 80])("keeps every rendered line within a %d-column terminal", (width) => {
    const lines = new TranscriptView(TRANSCRIPT).render(width);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
  });

  it("aligns wrapped Transcript text beneath the content instead of the timestamp", () => {
    const transcript: Transcript = {
      ...TRANSCRIPT,
      segments: [
        {
          startMs: 65_000,
          endMs: 80_000,
          text: "A later supporting example that wraps.",
        },
      ],
    };
    const lines = new TranscriptView(transcript)
      .render(28)
      .map((line) => stripTerminalSequences(line));
    const contentStart = lines.indexOf("") + 1;

    expect(lines[contentStart]).toBe("01:05  A later supporting");
    expect(lines[contentStart + 1]).toBe("       example that wraps.");
  });
});

describe("SummaryView", () => {
  it.each([5, 20, 80])("keeps every rendered line within a %d-column terminal", (width) => {
    const lines = new SummaryView(SUMMARY_MARKDOWN).render(width);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
  });

  it("renders Markdown structure and inline styles without leaving markup in copied text", () => {
    const rendered = new SummaryView(
      `## Details\n\n- **Important** point with \`code\`\n  - Nested detail`,
    ).render(80);
    const styled = rendered.join("\n");
    const plain = stripTerminalSequences(styled);

    expect(plain).toContain("Details");
    expect(plain).toContain("- Important point with code");
    expect(plain).toContain("    - Nested detail");
    expect(plain).not.toContain("##");
    expect(plain).not.toContain("**");
    expect(plain).not.toContain("`code`");
    expect(styled).toContain("\u001b[33mcode\u001b[0m");
    expect(styled).toContain("\u001b[1mImportant\u001b[0m");
  });
});

class ImmediateProcessing implements SourceVideoProcessing {
  readonly outcome: VideoProcessingOutcome;
  calls = 0;
  options: VideoProcessingOptions | undefined;

  constructor(outcome: VideoProcessingOutcome) {
    this.outcome = outcome;
  }

  async process(
    _sourceUrl: string,
    options: VideoProcessingOptions = {},
  ): Promise<VideoProcessingOutcome> {
    this.calls += 1;
    this.options = options;
    return this.outcome;
  }

  async summarize(): Promise<SummaryProcessingOutcome> {
    return { status: "unavailable", message: "No Transcript." };
  }
}

class PendingAsrFallbackProcessing implements SourceVideoProcessing {
  process(
    _sourceUrl: string,
    options: VideoProcessingOptions = {},
  ): Promise<VideoProcessingOutcome> {
    options.onStage?.("inspecting-video");
    options.onStage?.("no-eligible-caption");
    options.onStage?.("switching-to-asr");
    options.onStage?.("downloading-default-audio");
    return new Promise((resolve) => {
      options.signal?.addEventListener(
        "abort",
        () => resolve({ status: "cancelled", message: "Transcript acquisition was cancelled." }),
        { once: true },
      );
    });
  }

  async summarize(): Promise<SummaryProcessingOutcome> {
    return { status: "unavailable", message: "No Transcript." };
  }
}

class DelayedAsrProcessing implements SourceVideoProcessing {
  private finish: ((outcome: VideoProcessingOutcome) => void) | null = null;
  private options: VideoProcessingOptions | null = null;

  process(
    _sourceUrl: string,
    options: VideoProcessingOptions = {},
  ): Promise<VideoProcessingOutcome> {
    this.options = options;
    options.onStage?.("inspecting-video");
    options.onStage?.("no-eligible-caption");
    options.onStage?.("switching-to-asr");
    options.onStage?.("downloading-default-audio");
    options.onStage?.("preparing-runtime");
    options.onStage?.("transcribing-whisper");
    options.onTranscriptDraft?.({
      video: TRANSCRIPT.video,
      segment: TRANSCRIPT.segments[0]!,
    });
    return new Promise((resolve) => {
      this.finish = resolve;
    });
  }

  async summarize(): Promise<SummaryProcessingOutcome> {
    return { status: "unavailable", message: "No Transcript." };
  }

  complete(): void {
    this.options?.onTranscript?.({
      transcript: TRANSCRIPT,
      artifactDirectory: "/tmp/subtext-artifacts",
      reused: false,
    });
    this.options?.onStage?.("generating-summary");
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

class CancelledAsrProcessing implements SourceVideoProcessing {
  async process(
    _sourceUrl: string,
    options: VideoProcessingOptions = {},
  ): Promise<VideoProcessingOutcome> {
    options.onTranscriptDraft?.({
      video: TRANSCRIPT.video,
      segment: TRANSCRIPT.segments[0]!,
    });
    return { status: "cancelled", message: "ASR transcription was cancelled." };
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
    options.onStage?.("inspecting-video");
    options.onStage?.("preparing-caption-transcript");
    options.onTranscript?.({
      transcript: TRANSCRIPT,
      artifactDirectory: "/tmp/subtext-artifacts",
      reused: false,
    });
    options.onStage?.("generating-summary");
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
  private finish: ((outcome: VideoProcessingOutcome) => void) | null = null;

  process(_sourceUrl: string, options: AcquisitionOptions = {}): Promise<VideoProcessingOutcome> {
    this.calls += 1;
    this.signal = options.signal;
    return new Promise((resolve) => {
      this.finish = resolve;
      options.signal?.addEventListener(
        "abort",
        () => resolve({ status: "cancelled", message: "Transcript acquisition was cancelled." }),
        { once: true },
      );
    });
  }

  complete(): void {
    this.finish?.({ status: "needs-input", reason: "invalid-source-url", message: "Done." });
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
  summaryVideoId: string | undefined;

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

  async summarize(videoId: string): Promise<SummaryProcessingOutcome> {
    this.summaryCalls += 1;
    this.summaryVideoId = videoId;
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

async function selectLibraryAction(
  app: SubtextApp,
  terminal: FakeTerminal,
  tui: TUI,
  library: FixtureArtifactLibrary,
  actionIndex: number,
): Promise<void> {
  const expectedListCalls = library.listCalls + 1;
  terminal.send("/");
  terminal.send("l");
  await vi.waitFor(() => expect(renderedText(app)).toContain("→ Library"));
  terminal.send("\r");
  await vi.waitFor(() => expect(library.listCalls).toBe(expectedListCalls));
  await vi.waitFor(() => expect(renderedText(app)).toContain("Artifact Library"));
  expect(tui.hasOverlay()).toBe(false);
  terminal.send("\r");
  for (let index = 0; index < actionIndex; index += 1) {
    terminal.send("\u001b[B");
  }
  terminal.send("\r");
}

class FixtureArtifactLibrary implements ArtifactLibraryAccess {
  listCalls = 0;
  deleteCalls = 0;
  exportedFormat: TranscriptExportFormat | undefined;
  deleted = false;

  async listEntries(): Promise<readonly ArtifactLibraryEntry[]> {
    this.listCalls += 1;
    return this.deleted
      ? []
      : [
          {
            videoId: VIDEO_ID,
            title: TRANSCRIPT.video.title,
            canonicalUrl: SOURCE_URL,
            artifactDirectory: "/tmp/subtext-artifacts",
            languageCode: TRANSCRIPT.languageCode,
            transcriptOrigin: TRANSCRIPT.provenance.origin,
            hasSummary: true,
            updatedAtMs: 1,
          },
        ];
  }

  async findTranscript(): Promise<StoredTranscript> {
    return {
      transcript: TRANSCRIPT,
      artifactDirectory: "/tmp/subtext-artifacts",
      revision: "1-00000000-0000-0000-0000-000000000000",
    };
  }

  async findSummary(): Promise<StoredSummary> {
    return {
      markdown: SUMMARY_MARKDOWN,
      artifactDirectory: "/tmp/subtext-artifacts",
      revision: "1-00000000-0000-0000-0000-000000000000",
    };
  }

  async exportTranscript(_videoId: string, format: TranscriptExportFormat): Promise<string> {
    this.exportedFormat = format;
    const extension = format === "markdown" ? "md" : format === "text" ? "txt" : format;
    return `/tmp/subtext-artifacts/transcript.${extension}`;
  }

  async deleteVideoArtifacts(): Promise<boolean> {
    this.deleteCalls += 1;
    this.deleted = true;
    return true;
  }
}

class FixtureExternalOpener implements ExternalOpener {
  readonly targets: string[] = [];

  async open(target: string): Promise<void> {
    this.targets.push(target);
  }
}

class FirstRunConfiguration implements ApplicationConfigurationAccess {
  current: ApplicationSettings | null = null;
  saved: ConfigurationUpdate | undefined;

  providers(): readonly { id: string; label: string }[] {
    return [{ id: "deepseek", label: "DeepSeek" }];
  }

  models(): readonly { id: string; label: string; description: string }[] {
    return [
      {
        id: "deepseek-v4-flash",
        label: "deepseek-v4-flash",
        description: "DeepSeek V4 Flash",
      },
    ];
  }

  async save(update: ConfigurationUpdate): Promise<ApplicationSettings> {
    this.saved = update;
    this.current = { schemaVersion: 1, ...update };
    return this.current;
  }
}

function configuredApplication(): ApplicationConfigurationAccess {
  return {
    current: {
      schemaVersion: 1,
      summaryProvider: "deepseek",
      summaryModel: "deepseek-v4-flash",
      summaryDetail: "standard",
      asrQuality: "accurate",
    },
    providers: () => [],
    models: () => [],
    save: async () => {
      throw new Error("Options save is not expected in this test.");
    },
  };
}
