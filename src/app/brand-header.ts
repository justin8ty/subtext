import { wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";

import { THEME } from "./theme.js";

const FEATURES = [
  "Get YouTube transcripts instantly",
  "Summarize videos with AI",
  "Export transcripts and summaries",
  "Automatic Speech Recognition supported for videos without transcript",
] as const;

export class BrandHeader implements Component {
  render(width: number): string[] {
    if (width <= 0) {
      return [];
    }

    return [
      ...wrapTextWithAnsi(`${THEME.accent("◆")} ${THEME.heading("WATCHLESS")}`, width),
      ...FEATURES.flatMap((feature) => renderIndented(renderFeature(feature), width)),
    ];
  }

  invalidate(): void {}
}

function renderFeature(feature: string): string {
  return `${THEME.accent("•")} ${THEME.muted(feature)}`;
}

function renderIndented(text: string, width: number): string[] {
  const indentation = " ".repeat(Math.min(2, Math.max(0, width - 1)));
  const contentWidth = width - indentation.length;
  return wrapTextWithAnsi(text, contentWidth).map((line) => `${indentation}${line}`);
}
