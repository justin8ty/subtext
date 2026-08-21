import { Key, Spacer, Text, matchesKey } from "@earendil-works/pi-tui";

import { KeyHints, SectionHeader } from "./design-system.js";
import { Panel } from "./panel.js";
import { THEME } from "./theme.js";

export class HelpView extends Panel {
  private readonly close: () => void;

  constructor(close: () => void) {
    super();
    this.close = close;
    this.addChild(new SectionHeader("Watchless Help", "Keyboard shortcuts and app basics", 1));
    this.addChild(new Spacer(1));
    this.addChild(new Text("Paste a YouTube URL and press Enter.", 1, 0));
    this.addChild(new Spacer(1));
    this.addChild(
      new KeyHints(
        [
          ["/", "List App Commands below the editor"],
          ["Ctrl+O", "Expand or collapse the latest Transcript"],
          ["R", "Regenerate the latest Summary when the editor is empty"],
          ["Esc", "Cancel active processing"],
          ["Ctrl+C", "Cancel active processing, or quit while idle"],
        ],
        { layout: "stacked", paddingX: 1 },
      ),
    );
    this.addChild(new Spacer(1));
    this.addChild(new Text(THEME.muted("Enter or Esc closes Help."), 1, 0));
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter)) {
      this.close();
    }
  }
}
