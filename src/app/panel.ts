import { Container, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { THEME } from "./theme.js";

export class Panel extends Container {
  override render(width: number): string[] {
    if (width <= 0) {
      return [];
    }
    if (width === 1) {
      return super.render(width).map((line) => truncateToWidth(line, width, ""));
    }

    const contentWidth = width - 2;
    const content = super.render(contentWidth);
    return [
      THEME.border(`╭${"─".repeat(contentWidth)}╮`),
      ...content.map((line) => borderedLine(line, contentWidth)),
      THEME.border(`╰${"─".repeat(contentWidth)}╯`),
    ];
  }
}

export function borderedLine(
  line: string,
  width: number,
  frame: (text: string) => string = THEME.border,
): string {
  const fitted = truncateToWidth(line, width, "");
  const padding = " ".repeat(Math.max(0, width - visibleWidth(fitted)));
  return `${frame("│")}${fitted}${padding}${frame("│")}`;
}
