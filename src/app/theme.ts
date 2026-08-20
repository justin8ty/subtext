import type { EditorTheme, MarkdownTheme, SelectListTheme } from "@earendil-works/pi-tui";

const RESET = "\u001b[0m";

export const THEME = {
  accent: style("36"),
  muted: style("2"),
  success: style("32"),
  warning: style("33"),
  error: style("31"),
  border: style("2;37"),
  heading: style("1;36"),
  active: style("1;36"),
  selected: style("1;30;46"),
  timestamp: style("2;36"),
  bold: style("1"),
  italic: style("3"),
  underline: style("4"),
  strikethrough: style("9"),
} as const;

export const SELECT_THEME: SelectListTheme = {
  selectedPrefix: THEME.accent,
  selectedText: THEME.selected,
  description: THEME.muted,
  scrollInfo: THEME.muted,
  noMatch: THEME.warning,
};

export const EDITOR_THEME: EditorTheme = {
  borderColor: THEME.accent,
  selectList: SELECT_THEME,
};

export const MARKDOWN_THEME: MarkdownTheme = {
  heading: THEME.heading,
  link: THEME.accent,
  linkUrl: THEME.muted,
  code: THEME.warning,
  codeBlock: THEME.muted,
  codeBlockBorder: THEME.timestamp,
  quote: THEME.muted,
  quoteBorder: THEME.timestamp,
  hr: THEME.muted,
  listBullet: THEME.accent,
  bold: THEME.bold,
  italic: THEME.italic,
  strikethrough: THEME.strikethrough,
  underline: THEME.underline,
};

function style(code: string): (text: string) => string {
  return (text) => (text === "" ? "" : `\u001b[${code}m${text}${RESET}`);
}
