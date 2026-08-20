import { Container, Key, Text, matchesKey } from "@earendil-works/pi-tui";

import { bold, dim, keyHintLines } from "./theme.js";

export class HelpView extends Container {
  private readonly close: () => void;

  constructor(close: () => void) {
    super();
    this.close = close;
    this.addChild(new Text(bold("Subtext Help"), 1, 0));
    this.addChild(new Text("Paste a YouTube URL and press Enter.", 1, 0));
    this.addChild(
      new Text(
        keyHintLines([
          ["/", "List App Commands below the editor"],
          ["R", "Regenerate the latest Summary when the editor is empty"],
          ["Esc", "Cancel active processing"],
          ["Ctrl+C", "Cancel active processing, or quit while idle"],
        ]),
        1,
        0,
      ),
    );
    this.addChild(new Text(dim("Enter or Esc closes Help."), 1, 0));
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter)) {
      this.close();
    }
  }
}
