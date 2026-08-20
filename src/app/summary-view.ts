import { Markdown, stripTerminalSequences, type Component } from "@earendil-works/pi-tui";

import { MARKDOWN_THEME } from "./theme.js";

export class SummaryView implements Component {
  markdown: string;
  private renderer: Markdown;

  constructor(markdown: string) {
    this.markdown = markdown;
    this.renderer = this.createRenderer(markdown);
  }

  setMarkdown(markdown: string): void {
    this.markdown = markdown;
    this.renderer = this.createRenderer(markdown);
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

  private createRenderer(markdown: string): Markdown {
    return new Markdown(stripTerminalSequences(markdown).trimEnd(), 0, 0, MARKDOWN_THEME);
  }
}
