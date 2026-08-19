import {
  Container,
  Input,
  Key,
  SelectList,
  Text,
  matchesKey,
  type Focusable,
  type SelectItem,
  type SelectListTheme,
  type TUI,
} from "@earendil-works/pi-tui";

import type { ArtifactLibraryEntry } from "../artifacts/artifact-library.js";
import type { TranscriptExportFormat } from "../artifacts/transcript-export.js";

const PLAIN_SELECT_THEME: SelectListTheme = {
  selectedPrefix: identity,
  selectedText: identity,
  description: identity,
  scrollInfo: identity,
  noMatch: identity,
};

export type LibraryAction =
  | "print"
  | "regenerate-summary"
  | "export"
  | "open-video"
  | "open-directory"
  | "refresh"
  | "delete";

export class LibraryOverlay extends Container implements Focusable {
  private readonly query = new Input();
  private readonly list: SelectList;
  private readonly tui: TUI;
  private readonly selectEntry: (entry: ArtifactLibraryEntry) => void;
  private readonly cancel: () => void;
  private readonly entriesByVideoId: ReadonlyMap<string, ArtifactLibraryEntry>;
  private _focused = false;

  constructor(
    tui: TUI,
    entries: readonly ArtifactLibraryEntry[],
    selectEntry: (entry: ArtifactLibraryEntry) => void,
    cancel: () => void,
  ) {
    super();
    this.tui = tui;
    this.selectEntry = selectEntry;
    this.cancel = cancel;
    this.entriesByVideoId = new Map(entries.map((entry) => [entry.videoId, entry]));
    this.list = new SelectList(
      entries.map(entryItem),
      Math.min(10, entries.length),
      PLAIN_SELECT_THEME,
    );

    this.addChild(new Text("Artifact Library", 1, 0));
    this.addChild(new Text("Search", 1, 0));
    this.addChild(this.query);
    this.addChild(this.list);
    this.addChild(new Text("↑↓ navigate · enter actions · esc close", 1, 0));

    this.list.onSelect = (item) => {
      const entry = this.entriesByVideoId.get(item.value);
      if (entry !== undefined) {
        this.selectEntry(entry);
      }
    };
    this.list.onCancel = this.cancel;
    this.query.onEscape = this.cancel;
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.query.focused = value;
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.cancel();
      return;
    }
    if (matchesKey(data, Key.up) || matchesKey(data, Key.down) || matchesKey(data, Key.enter)) {
      this.list.handleInput(data);
      this.tui.requestRender();
      return;
    }

    this.query.handleInput(data);
    this.list.setFilter(this.query.getValue());
    this.tui.requestRender();
  }
}

interface MenuItem<Value extends string> extends SelectItem {
  readonly value: Value;
}

class MenuOverlay<Value extends string> extends Container {
  private readonly list: SelectList;
  private readonly tui: TUI;
  private readonly cancel: () => void;

  constructor(
    tui: TUI,
    title: string,
    items: readonly MenuItem<Value>[],
    select: (value: Value) => void,
    cancel: () => void,
  ) {
    super();
    this.tui = tui;
    this.cancel = cancel;
    const values = new Map<string, Value>();
    for (const item of items) {
      values.set(item.value, item.value);
    }
    this.list = new SelectList([...items], items.length, PLAIN_SELECT_THEME);
    this.list.onSelect = (item) => {
      const value = values.get(item.value);
      if (value !== undefined) {
        select(value);
      }
    };
    this.list.onCancel = cancel;
    this.addChild(new Text(title, 1, 0));
    this.addChild(this.list);
    this.addChild(new Text("↑↓ navigate · enter select · esc close", 1, 0));
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.cancel();
      return;
    }
    this.list.handleInput(data);
    this.tui.requestRender();
  }
}

export class LibraryActionsOverlay extends MenuOverlay<LibraryAction> {
  constructor(
    tui: TUI,
    entry: ArtifactLibraryEntry,
    select: (action: LibraryAction) => void,
    cancel: () => void,
  ) {
    super(
      tui,
      entry.title,
      [
        { value: "print", label: "Print", description: "Print Transcript and Summary" },
        {
          value: "regenerate-summary",
          label: "Regenerate Summary",
          description: "Replace the current Summary",
        },
        { value: "export", label: "Export Transcript", description: "Markdown, text, VTT, or SRT" },
        {
          value: "open-video",
          label: "Open Source Video",
          description: "Open in the default browser",
        },
        {
          value: "open-directory",
          label: "Open Artifact Directory",
          description: "Open the current revision directory",
        },
        {
          value: "refresh",
          label: "Refresh",
          description: "Reacquire the Transcript from YouTube",
        },
        { value: "delete", label: "Delete", description: "Delete all Video Artifacts" },
      ],
      select,
      cancel,
    );
  }
}

export class TranscriptExportOverlay extends MenuOverlay<TranscriptExportFormat> {
  constructor(tui: TUI, select: (format: TranscriptExportFormat) => void, cancel: () => void) {
    super(
      tui,
      "Export Transcript",
      [
        { value: "markdown", label: "Markdown", description: "transcript.md" },
        { value: "text", label: "Text", description: "transcript.txt" },
        { value: "vtt", label: "WebVTT", description: "transcript.vtt" },
        { value: "srt", label: "SubRip", description: "transcript.srt" },
      ],
      select,
      cancel,
    );
  }
}

export class DeleteConfirmationOverlay extends Container {
  private readonly confirm: () => void;
  private readonly cancel: () => void;

  constructor(entry: ArtifactLibraryEntry, confirm: () => void, cancel: () => void) {
    super();
    this.confirm = confirm;
    this.cancel = cancel;
    this.addChild(new Text("Delete Video Artifacts?", 1, 0));
    this.addChild(new Text(entry.title, 1, 0));
    this.addChild(
      new Text("This deletes the Transcript, source evidence, Summary, and exports.", 1, 0),
    );
    this.addChild(new Text("Y delete · N or esc cancel", 1, 0));
  }

  handleInput(data: string): void {
    if (data.toLowerCase() === "y") {
      this.confirm();
      return;
    }
    if (data.toLowerCase() === "n" || matchesKey(data, Key.escape)) {
      this.cancel();
    }
  }
}

function entryItem(entry: ArtifactLibraryEntry): SelectItem {
  return {
    value: entry.videoId,
    label: entry.title,
    description: `${entry.languageCode} · ${originLabel(entry.transcriptOrigin)} · ${entry.hasSummary ? "Summary" : "Unsummarized"}`,
  };
}

function originLabel(origin: ArtifactLibraryEntry["transcriptOrigin"]): string {
  if (origin === "creator-caption") {
    return "creator captions";
  }
  if (origin === "automatic-caption") {
    return "automatic captions";
  }
  return "ASR";
}

function identity(text: string): string {
  return text;
}
