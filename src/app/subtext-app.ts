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

import type { AcquisitionOptions, AcquisitionOutcome } from "../acquisition/acquire-transcript.js";
import { HelpOverlay, Palette, type PaletteDestination } from "./palette.js";
import { TranscriptView } from "./transcript-view.js";

export interface TranscriptAcquisition {
  acquire(sourceUrl: string, options?: AcquisitionOptions): Promise<AcquisitionOutcome>;
}

interface ActiveAcquisition {
  readonly id: number;
  readonly controller: AbortController;
  cancellationRequested: boolean;
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
  private readonly acquisition: TranscriptAcquisition;
  private readonly history = new Container();
  private readonly status = new Text("Ready. Paste a YouTube URL and press Enter.", 0, 0);
  private readonly editor: Editor;
  private removeInputListener: (() => void) | null = null;
  private activeAcquisition: ActiveAcquisition | null = null;
  private nextAcquisitionId = 1;
  private stopped = false;

  constructor(tui: TUI, acquisition: TranscriptAcquisition) {
    super();
    this.tui = tui;
    this.acquisition = acquisition;
    this.editor = new Editor(tui, EDITOR_THEME, { paddingX: 1, autocompleteMaxVisible: 4 });
    this.editor.onSubmit = (sourceUrl) => this.submit(sourceUrl);

    this.addChild(new Text("Subtext", 0, 0));
    this.addChild(new Text("Understand a YouTube video without watching it.", 0, 0));
    this.addChild(new Spacer(1));
    this.addChild(this.history);
    this.addChild(this.status);
    this.addChild(this.editor);
    this.addChild(new Text("/ palette · Esc cancel · Ctrl+C quit", 0, 0));
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

    if (this.activeAcquisition !== null) {
      this.activeAcquisition.controller.abort();
      this.appendMessage("Incomplete — Transcript acquisition cancelled because Subtext quit.");
      this.activeAcquisition = null;
    }

    this.status.setText("Stopped.");
    this.tui.renderNow();
    this.tui.stop();
  }

  private handleGlobalInput(data: string): TuiInputListenerResult {
    if (matchesKey(data, Key.ctrl("c"))) {
      if (this.activeAcquisition === null) {
        this.stop();
      } else {
        this.cancelActiveAcquisition();
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

    if (this.activeAcquisition !== null && matchesKey(data, Key.escape)) {
      this.cancelActiveAcquisition();
      return { consume: true };
    }

    if (this.activeAcquisition !== null && matchesKey(data, Key.enter)) {
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
    if (this.activeAcquisition !== null) {
      this.appendMessage("Another Source Video cannot be submitted while processing is active.");
      this.tui.requestRender();
      return;
    }

    const active: ActiveAcquisition = {
      id: this.nextAcquisitionId,
      controller: new AbortController(),
      cancellationRequested: false,
    };
    this.nextAcquisitionId += 1;
    this.activeAcquisition = active;
    this.appendMessage(`Source Video: ${normalizedUrl}`);
    this.status.setText("Inspecting the Source Video and acquiring a Transcript… Esc cancels.");
    this.tui.requestRender();
    void this.processAcquisition(normalizedUrl, active);
  }

  private async processAcquisition(sourceUrl: string, active: ActiveAcquisition): Promise<void> {
    let outcome: AcquisitionOutcome;
    try {
      outcome = await this.acquisition.acquire(sourceUrl, { signal: active.controller.signal });
    } catch (error) {
      if (active.controller.signal.aborted) {
        outcome = { status: "cancelled", message: "Transcript acquisition was cancelled." };
      } else if (error instanceof Error) {
        outcome = { status: "failed", message: "Transcript acquisition failed.", cause: error };
      } else {
        outcome = {
          status: "failed",
          message: "Transcript acquisition failed with an unrecognized error.",
        };
      }
    }

    if (this.stopped || this.activeAcquisition?.id !== active.id) {
      return;
    }
    this.activeAcquisition = null;
    this.renderOutcome(outcome);
    if (!this.tui.hasOverlay()) {
      this.tui.setFocus(this.editor);
    }
    this.tui.requestRender();
  }

  private renderOutcome(outcome: AcquisitionOutcome): void {
    switch (outcome.status) {
      case "completed": {
        this.appendComponent(new TranscriptView(outcome.transcript));
        this.status.setText(
          outcome.reused
            ? "Loaded the existing Transcript from the Artifact Library."
            : "Transcript completed.",
        );
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

  private cancelActiveAcquisition(): void {
    const active = this.activeAcquisition;
    if (active === null || active.cancellationRequested) {
      return;
    }
    active.cancellationRequested = true;
    active.controller.abort();
    this.status.setText("Cancelling Transcript acquisition…");
    this.tui.requestRender();
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
      maxHeight: 12,
      margin: 1,
    });
    this.tui.requestRender();
  }

  private appendMessage(message: string): void {
    this.appendComponent(new Text(message, 0, 0));
  }

  private appendComponent(component: Text | TranscriptView): void {
    if (this.history.children.length > 0) {
      this.history.addChild(new Spacer(1));
    }
    this.history.addChild(component);
  }
}

function identity(text: string): string {
  return text;
}
