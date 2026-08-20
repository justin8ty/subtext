import { Markdown, stripTerminalSequences, type Component } from "@earendil-works/pi-tui";

import { MARKDOWN_THEME } from "./theme.js";

export class SummaryView implements Component {
  readonly markdown: string;
  private readonly renderer: Markdown;

  constructor(markdown: string) {
    this.markdown = markdown;
    this.renderer = new Markdown(stripTerminalSequences(markdown).trimEnd(), 0, 0, MARKDOWN_THEME);
  }

  render(width: number): string[] {
    if (width <= 0) {
      return [];
    }
    return this.renderer.render(width);
  }

  invalidate(): void {
    this.renderer.invalidate();
  }
}
