import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { StringDecoder } from "node:string_decoder";

import { terminateProcessTree } from "../process/terminate-process-tree.js";
import type { TranscriptSegment } from "../transcript/model.js";
import {
  AsrAdapterError,
  type AsrAdapter,
  type AsrTranscript,
  type AsrTranscriptionOptions,
} from "./asr-adapter.js";

const MAX_PROCESS_OUTPUT_BYTES = 64 * 1024 * 1024;
const SEGMENT_PATTERN =
  /^\s*\[(\d{2}:\d{2}:\d{2}\.\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}\.\d{3})\]\s*(.*?)\s*$/u;
const DETECTED_LANGUAGE_PATTERN = /auto-detected language:\s*([a-z]{2,3})\b/iu;

interface WhisperCppAdapterOptions {
  readonly executable?: string;
  readonly executableArguments?: readonly string[];
  readonly modelPath: string;
  readonly modelName?: string;
}

interface ProcessResult {
  readonly stderr: string;
  readonly segments: readonly TranscriptSegment[];
}

export class WhisperCppAsrAdapter implements AsrAdapter {
  readonly executable: string;
  readonly executableArguments: readonly string[];
  readonly modelPath: string;
  readonly modelName: string;

  constructor(options: WhisperCppAdapterOptions) {
    this.executable = options.executable ?? "whisper-cli";
    this.executableArguments = options.executableArguments ?? [];
    this.modelPath = options.modelPath;
    this.modelName =
      options.modelName ?? basename(options.modelPath).replace(/^ggml-|\.bin$/gu, "");
  }

  async transcribe(
    audioPath: string,
    options: AsrTranscriptionOptions = {},
  ): Promise<AsrTranscript> {
    throwIfAborted(options.signal);
    await requireNonEmptyFile(audioPath, "Default Audio");
    await requireNonEmptyFile(this.modelPath, "ASR model");

    const languageCode = normalizeLanguageCode(options.languageCode);
    const result = await runWhisperProcess(
      this.executable,
      [
        ...this.executableArguments,
        "--model",
        this.modelPath,
        "--file",
        audioPath,
        "--language",
        languageCode ?? "auto",
        "--print-progress",
      ],
      options.durationMs,
      options.signal,
      options.onSegment,
    );
    const detectedLanguage =
      languageCode ?? result.stderr.match(DETECTED_LANGUAGE_PATTERN)?.[1]?.toLowerCase();
    if (detectedLanguage === undefined) {
      throw new AsrAdapterError(
        "invalid",
        "whisper.cpp did not report the detected Spoken Language.",
      );
    }

    if (result.segments.length === 0) {
      throw new AsrAdapterError("invalid", "whisper.cpp produced no spoken text.");
    }
    return {
      languageCode: detectedLanguage,
      model: this.modelName,
      segments: result.segments,
    };
  }
}

export function parseWhisperSegmentLine(line: string): TranscriptSegment | null {
  const match = line.match(SEGMENT_PATTERN);
  if (match === null) {
    return null;
  }

  const startMs = parseWhisperTimestamp(match[1] ?? "");
  const endMs = parseWhisperTimestamp(match[2] ?? "");
  const text = normalizeWhitespace(match[3] ?? "");
  if (startMs === null || endMs === null || endMs <= startMs || text === "") {
    return null;
  }
  return { startMs, endMs, text };
}

function runWhisperProcess(
  executable: string,
  arguments_: readonly string[],
  durationMs?: number,
  signal?: AbortSignal,
  onSegment?: (segment: TranscriptSegment) => void,
): Promise<ProcessResult> {
  throwIfAborted(signal);

  return new Promise((resolve, reject) => {
    const child = spawn(executable, arguments_, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    const stderrParts: string[] = [];
    const collector = new FinalizedSegmentCollector(durationMs, onSegment);
    let stdoutRemainder = "";
    let outputBytes = 0;
    let completed = false;
    let outputLimitExceeded = false;
    let termination: Promise<void> | null = null;

    const terminate = (): Promise<void> => {
      termination ??= terminateProcessTree(child);
      return termination;
    };
    const consumeLine = (line: string): void => {
      if (signal?.aborted === true) {
        return;
      }
      const segment = parseWhisperSegmentLine(line);
      if (segment === null) {
        return;
      }
      collector.add(segment);
    };
    const consumeStdout = (text: string): void => {
      const lines = `${stdoutRemainder}${text}`.split(/\r?\n/u);
      stdoutRemainder = lines.pop() ?? "";
      for (const line of lines) {
        consumeLine(line);
      }
    };
    const abort = (): void => {
      void terminate();
    };
    signal?.addEventListener("abort", abort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_PROCESS_OUTPUT_BYTES) {
        outputLimitExceeded = true;
        void terminate();
        return;
      }
      consumeStdout(stdoutDecoder.write(chunk));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_PROCESS_OUTPUT_BYTES) {
        outputLimitExceeded = true;
        void terminate();
        return;
      }
      stderrParts.push(stderrDecoder.write(chunk));
    });

    child.on("error", (error) => {
      if (completed) {
        return;
      }
      completed = true;
      signal?.removeEventListener("abort", abort);
      reject(
        new AsrAdapterError("unavailable", `Could not start ${executable}.`, { cause: error }),
      );
    });

    child.on("close", async (exitCode) => {
      if (completed) {
        return;
      }
      completed = true;
      signal?.removeEventListener("abort", abort);
      if (termination !== null) {
        await termination;
      }
      consumeStdout(stdoutDecoder.end());
      if (stdoutRemainder !== "") {
        consumeLine(stdoutRemainder);
      }
      stderrParts.push(stderrDecoder.end());
      const stderr = stderrParts.join("").trim();

      if (signal?.aborted === true) {
        reject(new AsrAdapterError("cancelled", "ASR transcription was cancelled."));
        return;
      }
      if (outputLimitExceeded) {
        reject(new AsrAdapterError("failed", "whisper.cpp produced too much process output."));
        return;
      }
      if (exitCode !== 0) {
        reject(
          new AsrAdapterError(
            "failed",
            stderr || `whisper.cpp exited with code ${exitCode ?? "unknown"}.`,
          ),
        );
        return;
      }
      resolve({ stderr, segments: collector.finish() });
    });
  });
}

class FinalizedSegmentCollector {
  private readonly durationLimit: number;
  private readonly onSegment: ((segment: TranscriptSegment) => void) | undefined;
  private readonly segments: TranscriptSegment[] = [];
  private readonly observed = new Set<string>();
  private finished = false;

  constructor(durationMs?: number, onSegment?: (segment: TranscriptSegment) => void) {
    this.durationLimit =
      durationMs !== undefined && Number.isFinite(durationMs) && durationMs > 0
        ? Math.round(durationMs)
        : Infinity;
    this.onSegment = onSegment;
  }

  add(segment: TranscriptSegment): void {
    if (this.finished) {
      return;
    }
    const text = normalizeWhitespace(segment.text);
    let startMs = Math.max(0, Math.round(segment.startMs));
    const endMs = Math.min(this.durationLimit, Math.round(segment.endMs));
    if (
      !Number.isFinite(segment.startMs) ||
      !Number.isFinite(segment.endMs) ||
      startMs >= this.durationLimit ||
      endMs <= startMs ||
      text === ""
    ) {
      return;
    }

    const key = `${startMs}:${endMs}:${text}`;
    if (this.observed.has(key)) {
      return;
    }
    this.observed.add(key);

    const previous = this.segments.at(-1);
    if (previous !== undefined) {
      if (startMs < previous.startMs || (startMs < previous.endMs && text === previous.text)) {
        return;
      }
      startMs = Math.max(startMs, previous.endMs);
    }
    if (endMs <= startMs) {
      return;
    }

    const normalized = { startMs, endMs, text };
    this.segments.push(normalized);
    this.onSegment?.(normalized);
  }

  finish(): readonly TranscriptSegment[] {
    this.finished = true;
    return this.segments;
  }
}

function parseWhisperTimestamp(value: string): number | null {
  const parts = value.split(":");
  if (parts.length !== 3) {
    return null;
  }
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  const seconds = Number(parts[2]);
  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(seconds) ||
    hours < 0 ||
    minutes < 0 ||
    minutes >= 60 ||
    seconds < 0 ||
    seconds >= 60
  ) {
    return null;
  }
  return Math.round((hours * 3_600 + minutes * 60 + seconds) * 1_000);
}

function normalizeLanguageCode(languageCode?: string): string | undefined {
  const normalized = languageCode
    ?.trim()
    .toLowerCase()
    .replace(/-orig$/u, "");
  if (normalized === undefined || normalized === "") {
    return undefined;
  }
  return normalized.split("-")[0];
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

async function requireNonEmptyFile(path: string, label: string): Promise<void> {
  try {
    const file = await stat(path);
    if (!file.isFile() || file.size === 0) {
      throw new AsrAdapterError("unavailable", `${label} is empty.`);
    }
  } catch (error) {
    if (error instanceof AsrAdapterError) {
      throw error;
    }
    throw new AsrAdapterError("unavailable", `${label} is not available at ${path}.`, {
      cause: error,
    });
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw new AsrAdapterError("cancelled", "ASR transcription was cancelled.");
  }
}
