import { wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";

import type { ProcessingStage } from "../processing/processing-stage.js";
import { statusText } from "./design-system.js";
import { THEME } from "./theme.js";

type FinalTone = "success" | "warning" | "error";
type StageLine =
  | { readonly kind: "active"; readonly stage: ActiveStage }
  | { readonly kind: "completed"; readonly stage: ActiveStage }
  | { readonly kind: "failed"; readonly stage: ActiveStage; readonly tone: "warning" | "error" }
  | { readonly kind: "notice"; readonly stage: NoticeStage };

type ActiveStage = Exclude<ProcessingStage, NoticeStage>;
type NoticeStage = "no-eligible-caption" | "switching-to-asr";

const STAGE_COPY = {
  "inspecting-video": {
    active: "Inspecting Source Video",
    completed: "Source Video inspected",
    failed: "Source Video inspection failed",
    symbol: "●",
  },
  "preparing-caption-transcript": {
    active: "Preparing Transcript from Caption Track",
    completed: "Transcript prepared from Caption Track",
    failed: "Caption Track processing failed",
    symbol: "◌",
  },
  "downloading-default-audio": {
    active: "Downloading Default Audio",
    completed: "Default Audio downloaded",
    failed: "Default Audio download failed",
    symbol: "↓",
  },
  "preparing-runtime": {
    active: "Preparing Whisper runtime",
    completed: "Whisper runtime ready",
    failed: "Whisper runtime preparation failed",
    symbol: "◌",
  },
  "transcribing-whisper": {
    active: "Transcribing with Whisper",
    completed: "Transcription complete",
    failed: "Whisper transcription failed",
    symbol: "◌",
  },
  "generating-summary": {
    active: "Generating Summary",
    completed: "Summary generated",
    failed: "Summary generation failed",
    symbol: "◌",
  },
} satisfies Record<
  ActiveStage,
  {
    readonly active: string;
    readonly completed: string;
    readonly failed: string;
    readonly symbol: string;
  }
>;

export class ProcessingStatusView implements Component {
  private lines: StageLine[] = [];

  update(stage: ProcessingStage): void {
    const current = this.lines.at(-1);
    if (current?.kind === "active" && current.stage === stage) {
      return;
    }

    this.completeActive();
    if (isNoticeStage(stage)) {
      this.lines.push({ kind: "notice", stage });
    } else {
      this.lines.push({ kind: "active", stage });
    }
  }

  finish(tone: FinalTone): void {
    if (tone === "success") {
      this.completeActive();
      return;
    }
    const current = this.lines.at(-1);
    if (current?.kind === "active") {
      this.lines[this.lines.length - 1] = { kind: "failed", stage: current.stage, tone };
    }
  }

  render(width: number): string[] {
    if (width <= 0) {
      return [];
    }
    return this.lines.flatMap((line) => wrapTextWithAnsi(renderLine(line), width));
  }

  invalidate(): void {}

  private completeActive(): void {
    const current = this.lines.at(-1);
    if (current?.kind === "active") {
      this.lines[this.lines.length - 1] = { kind: "completed", stage: current.stage };
    }
  }
}

function isNoticeStage(stage: ProcessingStage): stage is NoticeStage {
  return stage === "no-eligible-caption" || stage === "switching-to-asr";
}

function renderLine(line: StageLine): string {
  if (line.kind === "notice") {
    return line.stage === "no-eligible-caption"
      ? statusText("✓ No eligible Caption Track found", "warning")
      : statusText("→ Switching to local ASR", "accent");
  }

  const copy = STAGE_COPY[line.stage];
  if (line.kind === "active") {
    return THEME.active(`${copy.symbol} ${copy.active}`);
  }
  if (line.kind === "completed") {
    return statusText(`✓ ${copy.completed}`, "success");
  }
  return line.tone === "warning"
    ? statusText(`! ${copy.active} cancelled`, "warning")
    : statusText(`✗ ${copy.failed}`, "error");
}
