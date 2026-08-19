import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { YtDlpYoutubeAdapter } from "./yt-dlp-adapter.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("YtDlpYoutubeAdapter Default Audio", () => {
  it("downloads one original/default audio rendition as WAV", async () => {
    const directory = await mkdtemp(join(tmpdir(), "subtext-ytdlp-test-"));
    temporaryDirectories.push(directory);
    const script = join(directory, "yt-dlp-fixture.mjs");
    const argumentsPath = join(directory, "arguments.json");
    const destinationPath = join(directory, "default-audio.wav");
    await writeFile(
      script,
      `
import { writeFile } from "node:fs/promises";
const arguments_ = process.argv.slice(2);
await writeFile(${JSON.stringify(argumentsPath)}, JSON.stringify(arguments_));
const outputIndex = arguments_.indexOf("--output");
const output = arguments_[outputIndex + 1].replace("%(ext)s", "wav");
await writeFile(output, "fixture audio");
`,
      "utf8",
    );
    const adapter = new YtDlpYoutubeAdapter(process.execPath, [script]);

    await adapter.downloadDefaultAudio(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      destinationPath,
    );

    const arguments_: string[] = JSON.parse(await readFile(argumentsPath, "utf8"));
    expect(arguments_).toContain("--no-playlist");
    expect(arguments_).toContain("--no-audio-multistreams");
    expect(arguments_).toContain("--extract-audio");
    expect(arguments_).toContain("wav");
    expect(arguments_).toContain("bestaudio[format_note*=original]/bestaudio");
    await expect(readFile(destinationPath, "utf8")).resolves.toBe("fixture audio");
  });
});
