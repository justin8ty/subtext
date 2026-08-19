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

export type PaletteDestination = "options" | "help" | "quit";

const PALETTE_ITEMS: readonly SelectItem[] = [
  { value: "options", label: "Options", description: "Configure Summary and ASR preferences" },
  { value: "help", label: "Help", description: "Show keyboard help" },
  { value: "quit", label: "Quit", description: "Exit Subtext" },
];

const PLAIN_SELECT_THEME: SelectListTheme = {
  selectedPrefix: identity,
  selectedText: identity,
  description: identity,
  scrollInfo: identity,
  noMatch: identity,
};

export class Palette extends Container implements Focusable {
  private readonly query = new Input();
  private readonly list = new SelectList(
    [...PALETTE_ITEMS],
    PALETTE_ITEMS.length,
    PLAIN_SELECT_THEME,
  );
  private readonly tui: TUI;
  private readonly selectDestination: (destination: PaletteDestination) => void;
  private readonly cancel: () => void;
  private _focused = false;

  constructor(
    tui: TUI,
    selectDestination: (destination: PaletteDestination) => void,
    cancel: () => void,
  ) {
    super();
    this.tui = tui;
    this.selectDestination = selectDestination;
    this.cancel = cancel;

    this.addChild(new Text("Subtext", 1, 0));
    this.addChild(new Text("Search", 1, 0));
    this.addChild(this.query);
    this.addChild(this.list);
    this.addChild(new Text("↑↓ navigate · enter select · esc close", 1, 0));

    this.list.onSelect = (item) => this.selectDestination(parseDestination(item.value));
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

export class HelpOverlay extends Container {
  private readonly close: () => void;

  constructor(close: () => void) {
    super();
    this.close = close;
    this.addChild(new Text("Subtext Help", 1, 0));
    this.addChild(
      new Text(
        [
          "Paste a YouTube URL and press Enter.",
          "",
          "/       Open the palette when the editor is empty",
          "R       Regenerate the latest Summary when the editor is empty",
          "Esc     Cancel active processing",
          "Ctrl+C  Cancel active processing, or quit while idle",
          "",
          "Enter or Esc closes Help.",
        ].join("\n"),
        1,
        0,
      ),
    );
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter)) {
      this.close();
    }
  }
}

function parseDestination(value: string): PaletteDestination {
  if (value === "quit" || value === "options") {
    return value;
  }
  return "help";
}

function identity(text: string): string {
  return text;
}
