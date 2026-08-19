import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { WhisperCppAsrAdapter, parseWhisperSegmentLine } from "./whisper-cpp-adapter.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("WhisperCppAsrAdapter", () => {
  it("parses timestamped whisper.cpp output", () => {
    expect(parseWhisperSegmentLine("[00:01:02.340 --> 00:01:05.670]   spoken   text ")).toEqual({
      startMs: 62_340,
      endMs: 65_670,
      text: "spoken text",
    });
    expect(parseWhisperSegmentLine("whisper_print_progress_callback: progress = 50%")).toBeNull();
    expect(parseWhisperSegmentLine("[00:00:03.000 --> 00:00:02.000] backwards")).toBeNull();
  });

  it("streams finalized segments and records the detected language", async () => {
    const fixture = await whisperFixture(`
process.stderr.write("whisper_full: auto-detected language: fr (p = 0.98)\\n");
process.stdout.write("[00:00:00.000 --> 00:00:04.000]  First idea\\n[00:00");
setTimeout(() => {
  process.stdout.write(":04.000 --> 00:00:09.000]  Second idea\\n");
}, 10);
`);
    const streamed: string[] = [];
    const adapter = new WhisperCppAsrAdapter({
      executable: fixture.executable,
      executableArguments: fixture.executableArguments,
      modelPath: fixture.model,
      modelName: "fixture-model",
    });

    const result = await adapter.transcribe(fixture.audio, {
      onSegment: (segment) => streamed.push(segment.text),
    });

    expect(streamed).toEqual(["First idea", "Second idea"]);
    expect(result).toEqual({
      languageCode: "fr",
      model: "fixture-model",
      segments: [
        { startMs: 0, endMs: 4_000, text: "First idea" },
        { startMs: 4_000, endMs: 9_000, text: "Second idea" },
      ],
    });
  });

  it("deduplicates, repairs overlap, and clamps Draft segments to the video duration", async () => {
    const fixture = await whisperFixture(`
process.stdout.write([
  "[00:00:00.000 --> 00:00:04.000]  First idea",
  "[00:00:00.000 --> 00:00:04.000]  First idea",
  "[00:00:03.000 --> 00:00:12.000]  Second idea",
].join("\\n") + "\\n");
`);
    const streamed: Array<{ startMs: number; endMs: number; text: string }> = [];
    const adapter = new WhisperCppAsrAdapter({
      executable: fixture.executable,
      executableArguments: fixture.executableArguments,
      modelPath: fixture.model,
    });

    const result = await adapter.transcribe(fixture.audio, {
      durationMs: 10_000,
      languageCode: "en-US",
      onSegment: (segment) => streamed.push(segment),
    });

    expect(result.segments).toEqual([
      { startMs: 0, endMs: 4_000, text: "First idea" },
      { startMs: 4_000, endMs: 10_000, text: "Second idea" },
    ]);
    expect(streamed).toEqual(result.segments);
    expect(result.languageCode).toBe("en");
  });

  it("kills the process and reports cancellation after streamed output", async () => {
    const fixture = await whisperFixture(`
process.stderr.write("whisper_full: auto-detected language: en (p = 0.99)\\n");
process.stdout.write("[00:00:00.000 --> 00:00:02.000]  Draft segment\\n");
setInterval(() => {}, 1000);
`);
    const controller = new AbortController();
    const adapter = new WhisperCppAsrAdapter({
      executable: fixture.executable,
      executableArguments: fixture.executableArguments,
      modelPath: fixture.model,
    });

    await expect(
      adapter.transcribe(fixture.audio, {
        signal: controller.signal,
        onSegment: () => controller.abort(),
      }),
    ).rejects.toMatchObject({ kind: "cancelled" });
  });
});

async function whisperFixture(body: string): Promise<{
  executable: string;
  executableArguments: readonly string[];
  audio: string;
  model: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "subtext-whisper-test-"));
  temporaryDirectories.push(directory);
  const script = join(directory, "whisper-fixture.mjs");
  const audio = join(directory, "audio.wav");
  const model = join(directory, "model.bin");
  await Promise.all([
    writeFile(script, `${body.trim()}\n`, "utf8"),
    writeFile(audio, "fixture audio", "utf8"),
    writeFile(model, "fixture model", "utf8"),
  ]);
  return { executable: process.execPath, executableArguments: [script], audio, model };
}
