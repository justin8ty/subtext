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

const PLAIN_SELECT_THEME: SelectListTheme = {
  selectedPrefix: identity,
  selectedText: identity,
  description: identity,
  scrollInfo: identity,
  noMatch: identity,
};

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
    this.addChild(new Text("↑↓ navigate · enter print · esc close", 1, 0));

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
