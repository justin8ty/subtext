import { Text, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";

import { THEME } from "./theme.js";

export type UiTone = "accent" | "muted" | "success" | "warning" | "error";
export type KeyHint = readonly [key: string, description: string];

export class StatusLine extends Text {
  constructor(message: string, tone: UiTone = "muted", paddingX = 0) {
    super(statusText(message, tone), paddingX, 0);
  }

  setStatus(message: string, tone: UiTone): void {
    this.setText(statusText(message, tone));
  }
}

export class SectionHeader implements Component {
  readonly title: string;
  readonly metadata: string | undefined;
  private readonly paddingX: number;

  constructor(title: string, metadata?: string, paddingX = 0) {
    this.title = title;
    this.metadata = metadata;
    this.paddingX = paddingX;
  }

  render(width: number): string[] {
    const title = renderPadded(THEME.heading(this.title), width, this.paddingX);
    if (this.metadata === undefined || this.metadata === "") {
      return title;
    }
    return [...title, ...renderPadded(THEME.muted(this.metadata), width, this.paddingX)];
  }

  invalidate(): void {}
}

export class KeyHints implements Component {
  readonly hints: readonly KeyHint[];
  private readonly layout: "inline" | "stacked";
  private readonly paddingX: number;

  constructor(
    hints: readonly KeyHint[],
    options: { readonly layout?: "inline" | "stacked"; readonly paddingX?: number } = {},
  ) {
    this.hints = hints;
    this.layout = options.layout ?? "inline";
    this.paddingX = options.paddingX ?? 0;
  }

  render(width: number): string[] {
    if (this.layout === "stacked") {
      return this.hints.flatMap((hint) => renderPadded(formatKeyHint(hint), width, this.paddingX));
    }
    return renderPadded(
      this.hints.map(formatKeyHint).join(THEME.muted(" · ")),
      width,
      this.paddingX,
    );
  }

  invalidate(): void {}
}

export function badge(label: string, tone: UiTone = "accent"): string {
  return statusText(`[${label}]`, tone);
}

export function statusText(text: string, tone: UiTone): string {
  return THEME[tone](text);
}

function formatKeyHint([key, description]: KeyHint): string {
  return `${THEME.accent(key)} ${THEME.muted(description)}`;
}

function renderPadded(text: string, width: number, requestedPadding: number): string[] {
  if (width <= 0) {
    return [];
  }
  const paddingX = Math.min(requestedPadding, Math.max(0, width - 1));
  const padding = " ".repeat(paddingX);
  const contentWidth = width - paddingX;
  return wrapTextWithAnsi(text, contentWidth).map((line) => `${padding}${line}`);
}
