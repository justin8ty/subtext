import { stripTerminalSequences, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";

export class SummaryView implements Component {
  readonly markdown: string;

  constructor(markdown: string) {
    this.markdown = markdown;
  }

  render(width: number): string[] {
    if (width <= 0) {
      return [];
    }

    return stripTerminalSequences(this.markdown)
      .trimEnd()
      .split("\n")
      .flatMap((line) => (line === "" ? [""] : wrapTextWithAnsi(line, width)));
  }

  invalidate(): void {}
}
