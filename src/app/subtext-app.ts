import {
  Container,
  Key,
  Spacer,
  Text,
  matchesKey,
  type Component,
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
import {
  AppCommandCompletion,
  resolveAppCommand,
  type AppCommandDestination,
} from "./command-completion.js";
import { ConfigurationWizard } from "./configuration-wizard.js";
import { HelpView } from "./help-view.js";
import {
  DeleteConfirmationView,
  LibraryActionsView,
  LibraryView,
  TranscriptExportView,
  type LibraryAction,
} from "./library-view.js";
import { ProcessingStatusView } from "./processing-status-view.js";
import { SummaryView } from "./summary-view.js";
import { active, dim, keyHint, tone, type UiTone } from "./theme.js";
import { TranscriptDraftView } from "./transcript-draft-view.js";
import { UrlEditor } from "./url-editor.js";
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
  readonly stageView: ProcessingStatusView;
}

export class SubtextApp extends Container {
  private readonly tui: TUI;
  private readonly processing: SourceVideoProcessing;
  private readonly configuration: ApplicationConfigurationAccess | undefined;
  private readonly library: ArtifactLibraryAccess | undefined;
  private readonly externalOpener: ExternalOpener | undefined;
  private readonly history = new Container();
  private readonly status = new Text(dim("Ready. Paste a YouTube URL and press Enter."), 0, 0);
  private readonly editorHint = new Text(
    dim("Public, completed YouTube videos only · Enter to process"),
    1,
    0,
  );
  private readonly editor: UrlEditor;
  private readonly commandPanel = new Container();
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
    this.editor = new UrlEditor(tui, { paddingX: 1, autocompleteMaxVisible: 4 });
    this.editor.setAutocompleteProvider(new AppCommandCompletion());
    this.editor.onSubmit = (sourceUrl) => this.submit(sourceUrl);

    this.addChild(new Text(active("Subtext"), 0, 0));
    this.addChild(new Text(dim("Understand a YouTube video without watching it."), 0, 0));
    this.addChild(new Spacer(1));
    this.addChild(this.history);
    this.addChild(this.status);
    this.addChild(this.editor);
    this.addChild(this.editorHint);
    this.addChild(this.commandPanel);
    this.addChild(
      new Text(
        keyHint([
          ["/", "App Commands"],
          ["R", "regenerate Summary"],
          ["Esc", "cancel"],
          ["Ctrl+C", "quit"],
        ]),
        0,
        0,
      ),
    );
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
      this.activeProcessing.stageView.finish("warning");
      this.appendMessage(
        `Incomplete — ${incompleteWork} cancelled because Subtext quit.`,
        "warning",
      );
      this.activeProcessing = null;
    }

    this.setEditorProcessing(false);
    this.setStatus("Stopped.", "muted");
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

    if (this.commandPanel.children.length > 0 || this.tui.hasOverlay()) {
      return undefined;
    }

    if (data === "R" && this.editor.getText().trim() === "" && this.activeProcessing === null) {
      this.regenerateLatestSummary();
      return { consume: true };
    }

    if (
      this.activeProcessing !== null &&
      matchesKey(data, Key.escape) &&
      !this.editor.isShowingAutocomplete()
    ) {
      this.cancelActiveProcessing();
      return { consume: true };
    }

    if (
      this.activeProcessing !== null &&
      matchesKey(data, Key.enter) &&
      !this.editor.getText().trimStart().startsWith("/")
    ) {
      this.appendMessage(
        "Another Source Video cannot be submitted while processing is active.",
        "warning",
      );
      this.tui.requestRender();
      return { consume: true };
    }

    return undefined;
  }

  private submit(sourceUrl: string): void {
    const normalizedUrl = sourceUrl.trim();
    const command = resolveAppCommand(normalizedUrl);
    if (command !== null) {
      this.selectAppCommand(command);
      return;
    }
    if (normalizedUrl.startsWith("/")) {
      this.setStatus("Unknown App Command. Type / to list available commands.", "warning");
      this.tui.requestRender();
      return;
    }
    if (normalizedUrl === "") {
      this.setStatus("Enter a YouTube URL.", "warning");
      this.tui.requestRender();
      return;
    }
    this.startVideoProcessing(normalizedUrl, false);
  }

  private startVideoProcessing(sourceUrl: string, refresh: boolean): void {
    if (this.activeProcessing !== null) {
      this.appendMessage(
        "Another Source Video cannot be submitted while processing is active.",
        "warning",
      );
      this.tui.requestRender();
      return;
    }

    this.appendMessage(`${refresh ? "Refreshing" : "Source Video"}: ${sourceUrl}`, "muted");
    const active = this.beginProcessing("video");
    this.setStatus("Starting Source Video processing… Esc cancels.", "muted");
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
        onStage: (stage) => this.renderProcessingStage(stage, active),
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
    active.stageView.finish(videoOutcomeTone(outcome));
    this.renderVideoOutcome(outcome, active.transcriptRendered);
    this.restoreEditorFocus();
    this.tui.requestRender();
  }

  private renderProcessingStage(
    stage: Parameters<NonNullable<VideoProcessingOptions["onStage"]>>[0],
    active: ActiveProcessing,
  ): void {
    if (this.stopped || this.activeProcessing?.id !== active.id || active.cancellationRequested) {
      return;
    }
    active.stageView.update(stage);
    this.setStatus("Esc cancels active processing.", "muted");
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
      this.setStatus("Esc cancels active processing.", "muted");
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
    this.setStatus(
      ready.reused
        ? "Loaded the existing Transcript. Checking for a current Summary…"
        : "Transcript completed. Checking for a current Summary…",
      ready.reused ? "muted" : "success",
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
        this.setStatus(
          outcome.reusedTranscript && outcome.reusedSummary
            ? "Loaded the existing Transcript and Summary from the Artifact Library."
            : "Transcript and Summary completed.",
          "success",
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
          outcome.summaryStatus === "cancelled" ? "warning" : "error",
        );
        this.setStatus("Transcript completed. Press R to retry Summary generation.", "warning");
        return;
      }
      case "needs-input": {
        this.appendMessage(`Needs input — ${outcome.message}`, "warning");
        this.setStatus("Ready for another URL.", "muted");
        return;
      }
      case "unavailable": {
        this.appendMessage(`Unavailable — ${outcome.message}`, "warning");
        this.setStatus("Ready for another URL.", "muted");
        return;
      }
      case "blocked": {
        this.appendMessage(`Blocked — ${outcome.message}`, "error");
        this.setStatus("Ready for another URL.", "muted");
        return;
      }
      case "failed": {
        this.appendMessage(`Failed — ${outcome.message}`, "error");
        this.setStatus("Ready for another URL.", "muted");
        return;
      }
      case "cancelled": {
        this.appendMessage(`Incomplete — ${outcome.message}`, "warning");
        this.setStatus("Ready for another URL.", "muted");
      }
    }
  }

  private regenerateLatestSummary(): void {
    const videoId = this.latestTranscriptVideoId;
    if (videoId === null) {
      this.setStatus("Process a Source Video before regenerating a Summary.", "warning");
      this.tui.requestRender();
      return;
    }
    this.regenerateSummary(videoId);
  }

  private regenerateSummary(videoId: string): void {
    if (this.activeProcessing !== null) {
      this.reportLibraryMessage(
        "Summary generation cannot start while processing is active.",
        "warning",
      );
      return;
    }

    this.latestTranscriptVideoId = videoId;
    const active = this.beginProcessing("summary");
    this.setStatus("Starting Summary generation… Esc cancels.", "muted");
    this.tui.requestRender();
    void this.processSummary(videoId, active);
  }

  private async processSummary(videoId: string, active: ActiveProcessing): Promise<void> {
    let outcome: SummaryProcessingOutcome;
    try {
      outcome = await this.processing.summarize(videoId, {
        regenerate: true,
        signal: active.controller.signal,
        onStage: (stage) => this.renderProcessingStage(stage, active),
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
    active.stageView.finish(summaryOutcomeTone(outcome));
    this.renderSummaryOutcome(outcome);
    this.restoreEditorFocus();
    this.tui.requestRender();
  }

  private renderSummaryOutcome(outcome: SummaryProcessingOutcome): void {
    switch (outcome.status) {
      case "completed": {
        this.appendComponent(new SummaryView(outcome.summaryMarkdown));
        this.setStatus(
          outcome.reused ? "Loaded the existing Summary." : "Summary completed.",
          "success",
        );
        return;
      }
      case "unavailable": {
        this.appendMessage(`Summary unavailable — ${outcome.message}`, "warning");
        this.setStatus("Ready for another URL.", "muted");
        return;
      }
      case "failed": {
        this.appendMessage(`Summary failed — ${outcome.message}`, "error");
        this.setStatus(
          "The previous Summary, if any, remains available. Press R to retry.",
          "error",
        );
        return;
      }
      case "cancelled": {
        this.appendMessage(`Incomplete — ${outcome.message}`, "warning");
        this.setStatus("The Transcript remains available. Press R to retry.", "warning");
      }
    }
  }

  private beginProcessing(kind: ActiveProcessing["kind"]): ActiveProcessing {
    const stageView = new ProcessingStatusView();
    const active: ActiveProcessing = {
      id: this.nextProcessingId,
      kind,
      controller: new AbortController(),
      cancellationRequested: false,
      transcriptRendered: false,
      transcriptDraftView: null,
      stageView,
    };
    this.appendComponent(stageView);
    this.nextProcessingId += 1;
    this.activeProcessing = active;
    this.setEditorProcessing(true);
    return active;
  }

  private finishProcessing(active: ActiveProcessing): boolean {
    if (this.stopped || this.activeProcessing?.id !== active.id) {
      return false;
    }
    this.activeProcessing = null;
    this.setEditorProcessing(false);
    return true;
  }

  private cancelActiveProcessing(): void {
    const active = this.activeProcessing;
    if (active === null || active.cancellationRequested) {
      return;
    }
    active.cancellationRequested = true;
    active.controller.abort();
    this.setStatus(
      active.kind === "summary"
        ? "Cancelling Summary generation…"
        : "Cancelling Source Video processing…",
      "warning",
    );
    this.tui.requestRender();
  }

  private restoreEditorFocus(): void {
    if (this.commandPanel.children.length === 0 && !this.tui.hasOverlay()) {
      this.tui.setFocus(this.editor);
    }
  }

  private selectAppCommand(destination: AppCommandDestination): void {
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
      this.reportLibraryMessage("The Artifact Library is not available in this build.", "warning");
      return;
    }

    let entries: readonly ArtifactLibraryEntry[];
    try {
      entries = await library.listEntries();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not read the Artifact Library.";
      this.reportLibraryMessage(message, "error");
      return;
    }
    if (this.stopped) {
      return;
    }
    if (entries.length === 0) {
      this.reportLibraryMessage("The Artifact Library is empty.");
      return;
    }

    const close = (): void => this.closeCommandPanel();
    const select = (entry: ArtifactLibraryEntry): void => this.openLibraryActions(entry);
    this.openCommandPanel(new LibraryView(this.tui, entries, select, close));
  }

  private openLibraryActions(entry: ArtifactLibraryEntry): void {
    const close = (): void => this.closeCommandPanel();
    const select = (action: LibraryAction): void => {
      close();
      this.performLibraryAction(entry, action);
    };
    this.openCommandPanel(new LibraryActionsView(this.tui, entry, select, close));
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
    const close = (): void => this.closeCommandPanel();
    const select = (format: TranscriptExportFormat): void => {
      close();
      void this.exportLibraryEntry(entry.videoId, format);
    };
    this.openCommandPanel(new TranscriptExportView(this.tui, select, close));
  }

  private async exportLibraryEntry(videoId: string, format: TranscriptExportFormat): Promise<void> {
    const library = this.library;
    if (library === undefined) {
      return;
    }
    try {
      const exportPath = await library.exportTranscript(videoId, format);
      this.reportLibraryMessage(`Exported Transcript to ${exportPath}.`, "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not export the Transcript.";
      this.reportLibraryMessage(message, "error");
    }
  }

  private async openLibraryTarget(target: string, label: string): Promise<void> {
    const opener = this.externalOpener;
    if (opener === undefined) {
      this.reportLibraryMessage(
        "Opening external targets is not available in this build.",
        "warning",
      );
      return;
    }
    try {
      await opener.open(target);
      this.reportLibraryMessage(`${label} opened.`, "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : `Could not open ${label}.`;
      this.reportLibraryMessage(message, "error");
    }
  }

  private refreshLibraryEntry(entry: ArtifactLibraryEntry): void {
    if (this.activeProcessing !== null) {
      this.reportLibraryMessage("Refresh cannot start while processing is active.", "warning");
      return;
    }
    this.startVideoProcessing(entry.canonicalUrl, true);
  }

  private confirmLibraryDeletion(entry: ArtifactLibraryEntry): void {
    if (this.activeProcessing !== null) {
      this.reportLibraryMessage(
        "Video Artifacts cannot be deleted while processing is active.",
        "warning",
      );
      return;
    }

    const close = (): void => this.closeCommandPanel();
    const confirm = (): void => {
      close();
      void this.deleteLibraryEntry(entry.videoId);
    };
    this.openCommandPanel(new DeleteConfirmationView(entry, confirm, close));
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
        deleted ? "success" : "warning",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not delete Video Artifacts.";
      this.reportLibraryMessage(message, "error");
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
        this.reportLibraryMessage("The selected Transcript is no longer available.", "warning");
        return;
      }

      this.latestTranscriptVideoId = videoId;
      this.appendComponent(new TranscriptView(storedTranscript.transcript));
      if (storedSummary !== null && storedSummary.revision === storedTranscript.revision) {
        this.appendComponent(new SummaryView(storedSummary.markdown));
      } else {
        this.appendMessage("Unsummarized Transcript — no current Summary is available.", "warning");
      }
      if (this.activeProcessing === null) {
        this.setStatus("Printed Video Artifacts from the Artifact Library.", "success");
      }
      this.tui.requestRender();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not print Video Artifacts.";
      this.reportLibraryMessage(message, "error");
    }
  }

  private reportLibraryMessage(message: string, messageTone: UiTone = "muted"): void {
    if (this.activeProcessing === null) {
      this.setStatus(message, messageTone);
    } else {
      this.appendMessage(message, messageTone);
    }
    this.tui.requestRender();
  }

  private openConfiguration(required: boolean): void {
    const configuration = this.configuration;
    if (configuration === undefined) {
      this.setStatus("Options are not available in this build.", "warning");
      this.tui.requestRender();
      return;
    }

    const close = (): void => this.closeCommandPanel();
    const save = async (update: ConfigurationUpdate): Promise<void> => {
      await configuration.save(update);
      close();
      if (this.activeProcessing === null) {
        this.setStatus("Options saved. Ready for a YouTube URL.", "success");
      } else {
        this.appendMessage("Options saved — changes apply to future work.", "success");
      }
      this.tui.requestRender();
    };
    const wizard = new ConfigurationWizard(this.tui, configuration, {
      required,
      onSaved: save,
      onCancel: close,
    });
    this.openCommandPanel(wizard);
  }

  private openHelp(): void {
    const close = (): void => this.closeCommandPanel();
    this.openCommandPanel(new HelpView(close));
  }

  private openCommandPanel(component: Component): void {
    this.commandPanel.clear();
    this.commandPanel.addChild(component);
    this.tui.setFocus(component);
    this.tui.requestRender();
  }

  private closeCommandPanel(): void {
    this.commandPanel.clear();
    this.restoreEditorFocus();
    this.tui.requestRender();
  }

  private setEditorProcessing(processing: boolean): void {
    this.editor.setProcessing(processing);
    this.editorHint.setText(
      dim(
        processing
          ? "Processing active · New URLs unavailable · / App Commands remain available"
          : "Public, completed YouTube videos only · Enter to process",
      ),
    );
  }

  private setStatus(message: string, statusTone: UiTone): void {
    this.status.setText(tone(message, statusTone));
  }

  private appendMessage(message: string, messageTone?: UiTone): void {
    this.appendComponent(
      new Text(messageTone === undefined ? message : tone(message, messageTone), 0, 0),
    );
  }

  private appendComponent(component: Component): void {
    if (this.history.children.length > 0) {
      this.history.addChild(new Spacer(1));
    }
    this.history.addChild(component);
  }
}

function videoOutcomeTone(outcome: VideoProcessingOutcome): "success" | "warning" | "error" {
  if (outcome.status === "completed") {
    return "success";
  }
  if (
    outcome.status === "needs-input" ||
    outcome.status === "unavailable" ||
    outcome.status === "cancelled" ||
    (outcome.status === "unsummarized" && outcome.summaryStatus === "cancelled")
  ) {
    return "warning";
  }
  return "error";
}

function summaryOutcomeTone(outcome: SummaryProcessingOutcome): "success" | "warning" | "error" {
  if (outcome.status === "completed") {
    return "success";
  }
  return outcome.status === "cancelled" || outcome.status === "unavailable" ? "warning" : "error";
}
