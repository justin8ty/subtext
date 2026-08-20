import {
  fuzzyMatch,
  type AutocompleteItem,
  type AutocompleteProvider,
  type AutocompleteSuggestions,
} from "@earendil-works/pi-tui";

export type AppCommandDestination = "library" | "options" | "help" | "quit";

interface AppCommand {
  readonly destination: AppCommandDestination;
  readonly label: string;
  readonly description: string;
  readonly aliases: readonly string[];
}

const APP_COMMANDS: readonly AppCommand[] = [
  {
    destination: "library",
    label: "Library",
    description: "Browse completed Video Artifacts",
    aliases: ["artifacts", "videos"],
  },
  {
    destination: "options",
    label: "Options",
    description: "Configure Summary and ASR preferences",
    aliases: ["settings", "preferences", "config"],
  },
  {
    destination: "help",
    label: "Help",
    description: "Show keyboard help",
    aliases: ["keyboard", "keys"],
  },
  {
    destination: "quit",
    label: "Quit",
    description: "Exit Subtext",
    aliases: ["exit", "close"],
  },
];

export class AppCommandCompletion implements AutocompleteProvider {
  async getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    _options: { signal: AbortSignal; force?: boolean },
  ): Promise<AutocompleteSuggestions | null> {
    const textBeforeCursor = (lines[cursorLine] ?? "").slice(0, cursorCol);
    if (!textBeforeCursor.startsWith("/") || textBeforeCursor.includes(" ")) {
      return null;
    }

    const query = textBeforeCursor.slice(1);
    const commands = filterCommands(query);
    if (commands.length === 0) {
      return null;
    }

    return {
      items: commands.map(commandItem),
      prefix: textBeforeCursor,
    };
  }

  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem,
    prefix: string,
  ) {
    const currentLine = lines[cursorLine] ?? "";
    const beforePrefix = currentLine.slice(0, cursorCol - prefix.length);
    const completed = `${beforePrefix}/${item.value} ${currentLine.slice(cursorCol)}`;
    const completedLines = [...lines];
    completedLines[cursorLine] = completed;
    return {
      lines: completedLines,
      cursorLine,
      cursorCol: beforePrefix.length + item.value.length + 2,
    };
  }
}

export function resolveAppCommand(input: string): AppCommandDestination | null {
  if (!input.startsWith("/")) {
    return null;
  }
  const name = input.slice(1).trim().toLowerCase();
  const command = APP_COMMANDS.find(
    (candidate) =>
      candidate.destination === name || candidate.aliases.some((alias) => alias === name),
  );
  return command?.destination ?? null;
}

function commandItem(command: AppCommand): AutocompleteItem {
  return {
    value: command.destination,
    label: command.label,
    description: command.description,
  };
}

function filterCommands(query: string): AppCommand[] {
  const tokens = query
    .trim()
    .split(/\s+/u)
    .filter((token) => token !== "");
  if (tokens.length === 0) {
    return [...APP_COMMANDS];
  }

  return APP_COMMANDS.map((command) => ({ command, score: commandScore(command, tokens) }))
    .filter((result): result is { command: AppCommand; score: number } => result.score !== null)
    .sort((left, right) => left.score - right.score)
    .map((result) => result.command);
}

function commandScore(command: AppCommand, tokens: readonly string[]): number | null {
  const searchableText = [command.label, command.description, ...command.aliases];
  let totalScore = 0;
  for (const token of tokens) {
    const scores = searchableText
      .map((text) => fuzzyMatch(token, text))
      .filter((match) => match.matches)
      .map((match) => match.score);
    if (scores.length === 0) {
      return null;
    }
    totalScore += Math.min(...scores);
  }
  return totalScore;
}
