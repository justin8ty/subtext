import {
  CURSOR_MARKER,
  Editor,
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
  type EditorOptions,
  type TUI,
} from "@earendil-works/pi-tui";

import { accent, border, dim, EDITOR_THEME, mutedAccent } from "./theme.js";
import { borderedLine } from "./panel.js";

const URL_PLACEHOLDER = "Paste a YouTube URL…";

export class UrlEditor extends Editor {
  private processing = false;

  constructor(tui: TUI, options?: EditorOptions) {
    super(tui, EDITOR_THEME, options);
  }

  setProcessing(processing: boolean): void {
    this.processing = processing;
  }

  override render(width: number): string[] {
    if (width <= 2) {
      return super.render(width);
    }

    const frame = this.processing ? border : this.focused ? accent : border;
    this.borderColor = frame;
    const contentWidth = width - 2;
    const editorLines = super.render(contentWidth);
    const separatorIndex = editorLines.findIndex(
      (line, index) => index > 0 && isEditorBorder(stripTerminalSequences(line)),
    );
    if (separatorIndex < 0) {
      return editorLines;
    }

    const inputLines = editorLines.slice(1, separatorIndex);
    if (this.getText() === "" && inputLines.length > 0) {
      inputLines[0] = renderPlaceholder(contentWidth, this.getPaddingX(), this.focused);
    }
    const completionLines = editorLines.slice(separatorIndex + 1);
    const top = frame(`╭${"─".repeat(contentWidth)}╮`);
    const bottom = frame(`╰${"─".repeat(contentWidth)}╯`);

    if (completionLines.length === 0) {
      return [top, ...inputLines.map((line) => borderedLine(line, contentWidth, frame)), bottom];
    }

    return [
      top,
      ...inputLines.map((line) => borderedLine(line, contentWidth, frame)),
      frame(`├${"─".repeat(contentWidth)}┤`),
      ...completionLines.map((line) => borderedLine(line, contentWidth, frame)),
      bottom,
    ];
  }
}

function renderPlaceholder(width: number, paddingX: number, focused: boolean): string {
  const leftPadding = " ".repeat(Math.min(paddingX, Math.max(0, width - 1)));
  const cursor = focused ? `${CURSOR_MARKER}${mutedAccent("▏")} ` : "";
  const copy = truncateToWidth(
    dim(URL_PLACEHOLDER),
    Math.max(0, width - visibleWidth(leftPadding + cursor)),
    "",
  );
  const line = `${leftPadding}${cursor}${copy}`;
  return `${line}${" ".repeat(Math.max(0, width - visibleWidth(line)))}`;
}

function isEditorBorder(line: string): boolean {
  return /^─+(?: [↑↓] \d+ more )?$/u.test(line);
}
