import type { EditorTheme, SelectListTheme } from "@earendil-works/pi-tui";

export type UiTone = "accent" | "muted" | "success" | "warning" | "error";

const RESET = "\u001b[0m";

export const bold = style("1");
export const dim = style("2");
export const accent = style("36");
export const active = style("1;36");
export const success = style("32");
export const warning = style("33");
export const error = style("31");

export const SELECT_THEME: SelectListTheme = {
  selectedPrefix: accent,
  selectedText: active,
  description: dim,
  scrollInfo: dim,
  noMatch: warning,
};

export const EDITOR_THEME: EditorTheme = {
  borderColor: accent,
  selectList: SELECT_THEME,
};

export function tone(text: string, value: UiTone): string {
  switch (value) {
    case "accent":
      return accent(text);
    case "success":
      return success(text);
    case "warning":
      return warning(text);
    case "error":
      return error(text);
    case "muted":
      return dim(text);
  }
}

export function keyHint(parts: readonly [key: string, description: string][]): string {
  return parts.map(formatKeyHint).join(dim(" · "));
}

export function keyHintLines(parts: readonly [key: string, description: string][]): string {
  return parts.map(formatKeyHint).join("\n");
}

function formatKeyHint([key, description]: readonly [string, string]): string {
  return `${accent(key)} ${dim(description)}`;
}

function style(code: string): (text: string) => string {
  return (text) => (text === "" ? "" : `\u001b[${code}m${text}${RESET}`);
}
