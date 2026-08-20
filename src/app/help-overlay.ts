import { Container, Key, Text, matchesKey } from "@earendil-works/pi-tui";

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
          "/       List App Commands below the editor",
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
