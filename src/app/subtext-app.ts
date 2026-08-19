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

import type { TranscriptDraft } from "../acquisition/acquire-transcript.js";
import type { ArtifactLibraryAccess, ArtifactLibraryEntry } from "../artifacts/artifact-library.js";
import type { TranscriptExportFormat } from "../artifacts/transcript-export.js";
import type {
  ApplicationConfigurationAccess,
  ConfigurationUpdate,
} from "../config/application-configuration.js";
import type { ExternalOpener } from "../platform/external-opener.js";
import type {
  SummaryProcessingOptions,
  SummaryProcessingOutcome,
  TranscriptReady,
  VideoProcessingOptions,
  VideoProcessingOutcome,
} from "../processing/process-video.js";
import { ConfigurationWizard } from "./configuration-wizard.js";
import {
  DeleteConfirmationOverlay,
  LibraryActionsOverlay,
  LibraryOverlay,
  TranscriptExportOverlay,
  type LibraryAction,
} from "./library-overlay.js";
import { HelpOverlay, Palette, type PaletteDestination } from "./palette.js";
import { SummaryView } from "./summary-view.js";
import { TranscriptDraftView } from "./transcript-draft-view.js";
import { TranscriptView } from "./transcript-view.js";

export interface SourceVideoProcessing {
  process(sourceUrl: string, options?: VideoProcessingOptions): Promise<VideoProcessingOutcome>;
  summarize(videoId: string, options?: SummaryProcessingOptions): Promise<SummaryProcessingOutcome>;
}

export interface SubtextAppOptions {
  readonly configuration?: ApplicationConfigurationAccess;
  readonly library?: ArtifactLibraryAccess;
  readonly externalOpener?: ExternalOpener;
}

type MutableVideoProcessingOptions = {
  -readonly [Key in keyof VideoProcessingOptions]: VideoProcessingOptions[Key];
};

interface ActiveProcessing {
  readonly id: number;
  readonly kind: "video" | "summary";
  readonly controller: AbortController;
  cancellationRequested: boolean;
  transcriptRendered: boolean;
  transcriptDraftView: TranscriptDraftView | null;
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
  private readonly configuration: ApplicationConfigurationAccess | undefined;
  private readonly library: ArtifactLibraryAccess | undefined;
  private readonly externalOpener: ExternalOpener | undefined;
  private readonly history = new Container();
  private readonly status = new Text("Ready. Paste a YouTube URL and press Enter.", 0, 0);
  private readonly editor: Editor;
  private removeInputListener: (() => void) | null = null;
  private activeProcessing: ActiveProcessing | null = null;
  private latestTranscriptVideoId: string | null = null;
  private nextProcessingId = 1;
  private stopped = false;

  constructor(tui: TUI, processing: SourceVideoProcessing, options: SubtextAppOptions = {}) {
    super();
    this.tui = tui;
    this.processing = processing;
    this.configuration = options.configuration;
    this.library = options.library;
    this.externalOpener = options.externalOpener;
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
    if (this.configuration?.current === null) {
      this.openConfiguration(true);
    }
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
    this.startVideoProcessing(normalizedUrl, false);
  }

  private startVideoProcessing(sourceUrl: string, refresh: boolean): void {
    if (this.activeProcessing !== null) {
      this.appendMessage("Another Source Video cannot be submitted while processing is active.");
      this.tui.requestRender();
      return;
    }

    const active = this.beginProcessing("video");
    this.appendMessage(`${refresh ? "Refreshing" : "Source Video"}: ${sourceUrl}`);
    this.status.setText("Acquiring a Transcript, then generating its Summary… Esc cancels.");
    this.tui.requestRender();
    void this.processVideo(sourceUrl, active, refresh);
  }

  private async processVideo(
    sourceUrl: string,
    active: ActiveProcessing,
    refresh: boolean,
  ): Promise<void> {
    let outcome: VideoProcessingOutcome;
    try {
      const processingOptions: MutableVideoProcessingOptions = {
        signal: active.controller.signal,
        onTranscript: (ready) => this.renderReadyTranscript(ready, active),
        onTranscriptDraft: (draft) => this.renderTranscriptDraft(draft, active),
      };
      if (refresh) {
        processingOptions.refresh = true;
      }
      const asrQuality = this.configuration?.current?.asrQuality;
      if (asrQuality !== undefined) {
        processingOptions.asrQuality = asrQuality;
      }
      outcome = await this.processing.process(sourceUrl, processingOptions);
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

  private renderTranscriptDraft(draft: TranscriptDraft, active: ActiveProcessing): void {
    if (
      this.stopped ||
      this.activeProcessing?.id !== active.id ||
      active.cancellationRequested ||
      active.transcriptRendered
    ) {
      return;
    }
    if (active.transcriptDraftView === null) {
      active.transcriptDraftView = new TranscriptDraftView(draft.video);
      this.appendComponent(active.transcriptDraftView);
      this.status.setText("Transcribing Default Audio locally… Esc cancels.");
    }
    if (active.transcriptDraftView.video.id !== draft.video.id) {
      return;
    }
    active.transcriptDraftView.append(draft.segment);
    this.tui.requestRender();
  }

  private renderReadyTranscript(ready: TranscriptReady, active: ActiveProcessing): void {
    if (this.stopped || this.activeProcessing?.id !== active.id || active.transcriptRendered) {
      return;
    }
    active.transcriptRendered = true;
    this.latestTranscriptVideoId = ready.transcript.video.id;
    if (active.transcriptDraftView === null) {
      this.appendComponent(new TranscriptView(ready.transcript));
    } else {
      active.transcriptDraftView.complete(ready.transcript);
    }
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
    this.regenerateSummary(videoId);
  }

  private regenerateSummary(videoId: string): void {
    if (this.activeProcessing !== null) {
      this.reportLibraryMessage("Summary generation cannot start while processing is active.");
      return;
    }

    this.latestTranscriptVideoId = videoId;
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
      transcriptDraftView: null,
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
    if (destination === "library") {
      void this.openLibrary();
      return;
    }
    if (destination === "options") {
      this.openConfiguration(false);
      return;
    }
    this.openHelp();
  }

  private async openLibrary(): Promise<void> {
    const library = this.library;
    if (library === undefined) {
      this.reportLibraryMessage("The Artifact Library is not available in this build.");
      return;
    }

    let entries: readonly ArtifactLibraryEntry[];
    try {
      entries = await library.listEntries();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not read the Artifact Library.";
      this.reportLibraryMessage(message);
      return;
    }
    if (this.stopped) {
      return;
    }
    if (entries.length === 0) {
      this.reportLibraryMessage("The Artifact Library is empty.");
      return;
    }

    let handle: OverlayHandle;
    const close = (): void => {
      handle.hide();
      this.restoreEditorFocus();
      this.tui.requestRender();
    };
    const select = (entry: ArtifactLibraryEntry): void => {
      close();
      this.openLibraryActions(entry);
    };
    handle = this.tui.showOverlay(new LibraryOverlay(this.tui, entries, select, close), {
      width: "80%",
      minWidth: 42,
      maxHeight: 16,
      margin: 1,
    });
    this.tui.requestRender();
  }

  private openLibraryActions(entry: ArtifactLibraryEntry): void {
    let handle: OverlayHandle;
    const close = (): void => {
      handle.hide();
      this.restoreEditorFocus();
      this.tui.requestRender();
    };
    const select = (action: LibraryAction): void => {
      close();
      this.performLibraryAction(entry, action);
    };
    handle = this.tui.showOverlay(new LibraryActionsOverlay(this.tui, entry, select, close), {
      width: "80%",
      minWidth: 42,
      maxHeight: 12,
      margin: 1,
    });
    this.tui.requestRender();
  }

  private performLibraryAction(entry: ArtifactLibraryEntry, action: LibraryAction): void {
    switch (action) {
      case "print": {
        void this.printLibraryEntry(entry.videoId);
        return;
      }
      case "regenerate-summary": {
        this.regenerateSummary(entry.videoId);
        return;
      }
      case "export": {
        this.openTranscriptExport(entry);
        return;
      }
      case "open-video": {
        void this.openLibraryTarget(entry.canonicalUrl, "Source Video");
        return;
      }
      case "open-directory": {
        void this.openLibraryTarget(entry.artifactDirectory, "Artifact directory");
        return;
      }
      case "refresh": {
        this.refreshLibraryEntry(entry);
        return;
      }
      case "delete": {
        this.confirmLibraryDeletion(entry);
      }
    }
  }

  private openTranscriptExport(entry: ArtifactLibraryEntry): void {
    let handle: OverlayHandle;
    const close = (): void => {
      handle.hide();
      this.restoreEditorFocus();
      this.tui.requestRender();
    };
    const select = (format: TranscriptExportFormat): void => {
      close();
      void this.exportLibraryEntry(entry.videoId, format);
    };
    handle = this.tui.showOverlay(new TranscriptExportOverlay(this.tui, select, close), {
      width: "70%",
      minWidth: 36,
      maxHeight: 9,
      margin: 1,
    });
    this.tui.requestRender();
  }

  private async exportLibraryEntry(videoId: string, format: TranscriptExportFormat): Promise<void> {
    const library = this.library;
    if (library === undefined) {
      return;
    }
    try {
      const exportPath = await library.exportTranscript(videoId, format);
      this.reportLibraryMessage(`Exported Transcript to ${exportPath}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not export the Transcript.";
      this.reportLibraryMessage(message);
    }
  }

  private async openLibraryTarget(target: string, label: string): Promise<void> {
    const opener = this.externalOpener;
    if (opener === undefined) {
      this.reportLibraryMessage("Opening external targets is not available in this build.");
      return;
    }
    try {
      await opener.open(target);
      this.reportLibraryMessage(`${label} opened.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : `Could not open ${label}.`;
      this.reportLibraryMessage(message);
    }
  }

  private refreshLibraryEntry(entry: ArtifactLibraryEntry): void {
    if (this.activeProcessing !== null) {
      this.reportLibraryMessage("Refresh cannot start while processing is active.");
      return;
    }
    this.startVideoProcessing(entry.canonicalUrl, true);
  }

  private confirmLibraryDeletion(entry: ArtifactLibraryEntry): void {
    if (this.activeProcessing !== null) {
      this.reportLibraryMessage("Video Artifacts cannot be deleted while processing is active.");
      return;
    }

    let handle: OverlayHandle;
    const close = (): void => {
      handle.hide();
      this.restoreEditorFocus();
      this.tui.requestRender();
    };
    const confirm = (): void => {
      close();
      void this.deleteLibraryEntry(entry.videoId);
    };
    handle = this.tui.showOverlay(new DeleteConfirmationOverlay(entry, confirm, close), {
      width: "75%",
      minWidth: 40,
      maxHeight: 8,
      margin: 1,
    });
    this.tui.requestRender();
  }

  private async deleteLibraryEntry(videoId: string): Promise<void> {
    const library = this.library;
    if (library === undefined) {
      return;
    }
    try {
      const deleted = await library.deleteVideoArtifacts(videoId);
      if (this.latestTranscriptVideoId === videoId) {
        this.latestTranscriptVideoId = null;
      }
      this.reportLibraryMessage(
        deleted ? "Video Artifacts deleted." : "The selected Video Artifacts no longer exist.",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not delete Video Artifacts.";
      this.reportLibraryMessage(message);
    }
  }

  private async printLibraryEntry(videoId: string): Promise<void> {
    const library = this.library;
    if (library === undefined) {
      return;
    }

    try {
      const [storedTranscript, storedSummary] = await Promise.all([
        library.findTranscript(videoId),
        library.findSummary(videoId),
      ]);
      if (storedTranscript === null) {
        this.reportLibraryMessage("The selected Transcript is no longer available.");
        return;
      }

      this.latestTranscriptVideoId = videoId;
      this.appendComponent(new TranscriptView(storedTranscript.transcript));
      if (storedSummary !== null && storedSummary.revision === storedTranscript.revision) {
        this.appendComponent(new SummaryView(storedSummary.markdown));
      } else {
        this.appendMessage("Unsummarized Transcript — no current Summary is available.");
      }
      if (this.activeProcessing === null) {
        this.status.setText("Printed Video Artifacts from the Artifact Library.");
      }
      this.tui.requestRender();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not print Video Artifacts.";
      this.reportLibraryMessage(message);
    }
  }

  private reportLibraryMessage(message: string): void {
    if (this.activeProcessing === null) {
      this.status.setText(message);
    } else {
      this.appendMessage(message);
    }
    this.tui.requestRender();
  }

  private openConfiguration(required: boolean): void {
    const configuration = this.configuration;
    if (configuration === undefined) {
      this.status.setText("Options are not available in this build.");
      this.tui.requestRender();
      return;
    }

    let handle: OverlayHandle;
    const close = (): void => {
      handle.hide();
      this.restoreEditorFocus();
      this.tui.requestRender();
    };
    const save = async (update: ConfigurationUpdate): Promise<void> => {
      await configuration.save(update);
      close();
      if (this.activeProcessing === null) {
        this.status.setText("Options saved. Ready for a YouTube URL.");
      } else {
        this.appendMessage("Options saved — changes apply to future work.");
      }
      this.tui.requestRender();
    };
    const wizard = new ConfigurationWizard(this.tui, configuration, {
      required,
      onSaved: save,
      onCancel: close,
    });
    handle = this.tui.showOverlay(wizard, {
      width: "80%",
      minWidth: 42,
      maxHeight: 16,
      margin: 1,
    });
    this.tui.requestRender();
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

  private appendComponent(
    component: Text | TranscriptView | TranscriptDraftView | SummaryView,
  ): void {
    if (this.history.children.length > 0) {
      this.history.addChild(new Spacer(1));
    }
    this.history.addChild(component);
  }
}

function identity(text: string): string {
  return text;
}
