import {
  Container,
  Editor,
  Key,
  Spacer,
  Text,
  matchesKey,
  type EditorTheme,
  type OverlayHandle,
  type SelectListTheme,
  type TUI,
  type TuiInputListenerResult,
} from "@earendil-works/pi-tui";

import type {
  SummaryProcessingOptions,
  SummaryProcessingOutcome,
  TranscriptReady,
  VideoProcessingOptions,
  VideoProcessingOutcome,
} from "../processing/process-video.js";
import { HelpOverlay, Palette, type PaletteDestination } from "./palette.js";
import { SummaryView } from "./summary-view.js";
import { TranscriptView } from "./transcript-view.js";

export interface SourceVideoProcessing {
  process(sourceUrl: string, options?: VideoProcessingOptions): Promise<VideoProcessingOutcome>;
  summarize(videoId: string, options?: SummaryProcessingOptions): Promise<SummaryProcessingOutcome>;
}

interface ActiveProcessing {
  readonly id: number;
  readonly kind: "video" | "summary";
  readonly controller: AbortController;
  cancellationRequested: boolean;
  transcriptRendered: boolean;
}

const PLAIN_SELECT_THEME: SelectListTheme = {
  selectedPrefix: identity,
  selectedText: identity,
  description: identity,
  scrollInfo: identity,
  noMatch: identity,
};

const EDITOR_THEME: EditorTheme = {
  borderColor: identity,
  selectList: PLAIN_SELECT_THEME,
};

export class SubtextApp extends Container {
  private readonly tui: TUI;
  private readonly processing: SourceVideoProcessing;
  private readonly history = new Container();
  private readonly status = new Text("Ready. Paste a YouTube URL and press Enter.", 0, 0);
  private readonly editor: Editor;
  private removeInputListener: (() => void) | null = null;
  private activeProcessing: ActiveProcessing | null = null;
  private latestTranscriptVideoId: string | null = null;
  private nextProcessingId = 1;
  private stopped = false;

  constructor(tui: TUI, processing: SourceVideoProcessing) {
    super();
    this.tui = tui;
    this.processing = processing;
    this.editor = new Editor(tui, EDITOR_THEME, { paddingX: 1, autocompleteMaxVisible: 4 });
    this.editor.onSubmit = (sourceUrl) => this.submit(sourceUrl);

    this.addChild(new Text("Subtext", 0, 0));
    this.addChild(new Text("Understand a YouTube video without watching it.", 0, 0));
    this.addChild(new Spacer(1));
    this.addChild(this.history);
    this.addChild(this.status);
    this.addChild(this.editor);
    this.addChild(new Text("/ palette · R regenerate Summary · Esc cancel · Ctrl+C quit", 0, 0));
  }

  start(): void {
    if (this.stopped || this.removeInputListener !== null) {
      return;
    }
    this.tui.addChild(this);
    this.removeInputListener = this.tui.addInputListener((data) => this.handleGlobalInput(data));
    this.tui.setFocus(this.editor);
    this.tui.start();
  }

  stop(): void {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.removeInputListener?.();
    this.removeInputListener = null;

    if (this.activeProcessing !== null) {
      const incompleteWork =
        this.activeProcessing.kind === "summary" ? "Summary generation" : "Transcript acquisition";
      this.activeProcessing.controller.abort();
      this.appendMessage(`Incomplete — ${incompleteWork} cancelled because Subtext quit.`);
      this.activeProcessing = null;
    }

    this.status.setText("Stopped.");
    this.tui.renderNow();
    this.tui.stop();
  }

  private handleGlobalInput(data: string): TuiInputListenerResult {
    if (matchesKey(data, Key.ctrl("c"))) {
      if (this.activeProcessing === null) {
        this.stop();
      } else {
        this.cancelActiveProcessing();
      }
      return { consume: true };
    }

    if (this.tui.hasOverlay()) {
      return undefined;
    }

    if (data === "/" && this.editor.getText().trim() === "") {
      this.openPalette();
      return { consume: true };
    }

    if (data === "R" && this.editor.getText().trim() === "" && this.activeProcessing === null) {
      this.regenerateLatestSummary();
      return { consume: true };
    }

    if (this.activeProcessing !== null && matchesKey(data, Key.escape)) {
      this.cancelActiveProcessing();
      return { consume: true };
    }

    if (this.activeProcessing !== null && matchesKey(data, Key.enter)) {
      this.appendMessage("Another Source Video cannot be submitted while processing is active.");
      this.tui.requestRender();
      return { consume: true };
    }

    return undefined;
  }

  private submit(sourceUrl: string): void {
    const normalizedUrl = sourceUrl.trim();
    if (normalizedUrl === "") {
      this.status.setText("Enter a YouTube URL.");
      this.tui.requestRender();
      return;
    }
    if (this.activeProcessing !== null) {
      this.appendMessage("Another Source Video cannot be submitted while processing is active.");
      this.tui.requestRender();
      return;
    }

    const active = this.beginProcessing("video");
    this.appendMessage(`Source Video: ${normalizedUrl}`);
    this.status.setText("Acquiring a Transcript, then generating its Summary… Esc cancels.");
    this.tui.requestRender();
    void this.processVideo(normalizedUrl, active);
  }

  private async processVideo(sourceUrl: string, active: ActiveProcessing): Promise<void> {
    let outcome: VideoProcessingOutcome;
    try {
      outcome = await this.processing.process(sourceUrl, {
        signal: active.controller.signal,
        onTranscript: (ready) => this.renderReadyTranscript(ready, active),
      });
    } catch (error) {
      if (active.controller.signal.aborted) {
        outcome = { status: "cancelled", message: "Source Video processing was cancelled." };
      } else if (error instanceof Error) {
        outcome = { status: "failed", message: "Source Video processing failed.", cause: error };
      } else {
        outcome = {
          status: "failed",
          message: "Source Video processing failed with an unrecognized error.",
        };
      }
    }

    if (!this.finishProcessing(active)) {
      return;
    }
    this.renderVideoOutcome(outcome, active.transcriptRendered);
    this.restoreEditorFocus();
    this.tui.requestRender();
  }

  private renderReadyTranscript(ready: TranscriptReady, active: ActiveProcessing): void {
    if (this.stopped || this.activeProcessing?.id !== active.id || active.transcriptRendered) {
      return;
    }
    active.transcriptRendered = true;
    this.latestTranscriptVideoId = ready.transcript.video.id;
    this.appendComponent(new TranscriptView(ready.transcript));
    this.status.setText(
      ready.reused
        ? "Loaded the existing Transcript. Generating its Summary…"
        : "Transcript completed. Generating its Summary…",
    );
    this.tui.requestRender();
  }

  private renderVideoOutcome(outcome: VideoProcessingOutcome, transcriptRendered: boolean): void {
    switch (outcome.status) {
      case "completed": {
        this.latestTranscriptVideoId = outcome.transcript.video.id;
        if (!transcriptRendered) {
          this.appendComponent(new TranscriptView(outcome.transcript));
        }
        this.appendComponent(new SummaryView(outcome.summaryMarkdown));
        this.status.setText(
          outcome.reusedTranscript && outcome.reusedSummary
            ? "Loaded the existing Transcript and Summary from the Artifact Library."
            : "Transcript and Summary completed.",
        );
        return;
      }
      case "unsummarized": {
        this.latestTranscriptVideoId = outcome.transcript.video.id;
        if (!transcriptRendered) {
          this.appendComponent(new TranscriptView(outcome.transcript));
        }
        this.appendMessage(
          outcome.summaryStatus === "cancelled"
            ? `Incomplete — ${outcome.message}`
            : `Summary unavailable — ${outcome.message}`,
        );
        this.status.setText("Transcript completed. Press R to retry Summary generation.");
        return;
      }
      case "needs-input": {
        this.appendMessage(`Needs input — ${outcome.message}`);
        this.status.setText("Ready for another URL.");
        return;
      }
      case "unavailable": {
        this.appendMessage(`Unavailable — ${outcome.message}`);
        this.status.setText("Ready for another URL.");
        return;
      }
      case "blocked": {
        this.appendMessage(`Blocked — ${outcome.message}`);
        this.status.setText("Ready for another URL.");
        return;
      }
      case "failed": {
        this.appendMessage(`Failed — ${outcome.message}`);
        this.status.setText("Ready for another URL.");
        return;
      }
      case "cancelled": {
        this.appendMessage(`Incomplete — ${outcome.message}`);
        this.status.setText("Ready for another URL.");
      }
    }
  }

  private regenerateLatestSummary(): void {
    const videoId = this.latestTranscriptVideoId;
    if (videoId === null) {
      this.status.setText("Process a Source Video before regenerating a Summary.");
      this.tui.requestRender();
      return;
    }

    const active = this.beginProcessing("summary");
    this.status.setText("Generating a new Summary… Esc cancels.");
    this.tui.requestRender();
    void this.processSummary(videoId, active);
  }

  private async processSummary(videoId: string, active: ActiveProcessing): Promise<void> {
    let outcome: SummaryProcessingOutcome;
    try {
      outcome = await this.processing.summarize(videoId, {
        regenerate: true,
        signal: active.controller.signal,
      });
    } catch (error) {
      if (active.controller.signal.aborted) {
        outcome = { status: "cancelled", message: "Summary generation was cancelled." };
      } else if (error instanceof Error) {
        outcome = { status: "failed", message: "Summary generation failed.", cause: error };
      } else {
        outcome = {
          status: "failed",
          message: "Summary generation failed with an unrecognized error.",
        };
      }
    }

    if (!this.finishProcessing(active)) {
      return;
    }
    this.renderSummaryOutcome(outcome);
    this.restoreEditorFocus();
    this.tui.requestRender();
  }

  private renderSummaryOutcome(outcome: SummaryProcessingOutcome): void {
    switch (outcome.status) {
      case "completed": {
        this.appendComponent(new SummaryView(outcome.summaryMarkdown));
        this.status.setText(outcome.reused ? "Loaded the existing Summary." : "Summary completed.");
        return;
      }
      case "unavailable": {
        this.appendMessage(`Summary unavailable — ${outcome.message}`);
        this.status.setText("Ready for another URL.");
        return;
      }
      case "failed": {
        this.appendMessage(`Summary failed — ${outcome.message}`);
        this.status.setText("The previous Summary, if any, remains available. Press R to retry.");
        return;
      }
      case "cancelled": {
        this.appendMessage(`Incomplete — ${outcome.message}`);
        this.status.setText("The Transcript remains available. Press R to retry.");
      }
    }
  }

  private beginProcessing(kind: ActiveProcessing["kind"]): ActiveProcessing {
    const active: ActiveProcessing = {
      id: this.nextProcessingId,
      kind,
      controller: new AbortController(),
      cancellationRequested: false,
      transcriptRendered: false,
    };
    this.nextProcessingId += 1;
    this.activeProcessing = active;
    return active;
  }

  private finishProcessing(active: ActiveProcessing): boolean {
    if (this.stopped || this.activeProcessing?.id !== active.id) {
      return false;
    }
    this.activeProcessing = null;
    return true;
  }

  private cancelActiveProcessing(): void {
    const active = this.activeProcessing;
    if (active === null || active.cancellationRequested) {
      return;
    }
    active.cancellationRequested = true;
    active.controller.abort();
    this.status.setText(
      active.kind === "summary"
        ? "Cancelling Summary generation…"
        : "Cancelling Source Video processing…",
    );
    this.tui.requestRender();
  }

  private restoreEditorFocus(): void {
    if (!this.tui.hasOverlay()) {
      this.tui.setFocus(this.editor);
    }
  }

  private openPalette(): void {
    let handle: OverlayHandle;
    const close = (): void => handle.hide();
    const select = (destination: PaletteDestination): void => {
      close();
      this.selectPaletteDestination(destination);
    };
    const palette = new Palette(this.tui, select, close);
    handle = this.tui.showOverlay(palette, {
      width: "70%",
      minWidth: 32,
      maxHeight: 10,
      margin: 1,
    });
    this.tui.requestRender();
  }

  private selectPaletteDestination(destination: PaletteDestination): void {
    if (destination === "quit") {
      this.stop();
      return;
    }
    this.openHelp();
  }

  private openHelp(): void {
    let handle: OverlayHandle;
    const close = (): void => {
      handle.hide();
      this.tui.requestRender();
    };
    handle = this.tui.showOverlay(new HelpOverlay(close), {
      width: "80%",
      minWidth: 38,
      maxHeight: 13,
      margin: 1,
    });
    this.tui.requestRender();
  }

  private appendMessage(message: string): void {
    this.appendComponent(new Text(message, 0, 0));
  }

  private appendComponent(component: Text | TranscriptView | SummaryView): void {
    if (this.history.children.length > 0) {
      this.history.addChild(new Spacer(1));
    }
    this.history.addChild(component);
  }
}

function identity(text: string): string {
  return text;
}
