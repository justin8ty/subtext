import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { YtDlpYoutubeAdapter } from "./yt-dlp-adapter.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("YtDlpYoutubeAdapter hardening", () => {
  it("decodes representative yt-dlp metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "subtext-ytdlp-test-"));
    temporaryDirectories.push(directory);
    const script = join(directory, "yt-dlp-metadata-fixture.mjs");
    await writeFile(
      script,
      `console.log(JSON.stringify({
  id: "dQw4w9WgXcQ",
  title: "Fixture video",
  duration: 90.5,
  language: "en-US",
  live_status: "not_live",
  availability: "public",
  subtitles: { en: [{ ext: "json3", url: "https://captions.test/creator", name: "English" }] },
  automatic_captions: { "en-orig": [{ ext: "json3", url: "https://captions.test/auto" }] }
}));`,
      "utf8",
    );
    const adapter = new YtDlpYoutubeAdapter({
      executable: process.execPath,
      executableArguments: [script],
    });

    await expect(
      adapter.inspect("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    ).resolves.toMatchObject({
      id: "dQw4w9WgXcQ",
      durationMs: 90_500,
      spokenLanguage: "en-US",
      liveStatus: "not_live",
      availability: "public",
      captionTracks: [
        { origin: "creator-caption", languageCode: "en", format: "json3" },
        { origin: "automatic-caption", languageCode: "en-orig", format: "json3" },
      ],
    });
  });

  it("classifies subprocess diagnostics and cancellation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "subtext-ytdlp-test-"));
    temporaryDirectories.push(directory);
    const failureScript = join(directory, "yt-dlp-failure-fixture.mjs");
    const hangingScript = join(directory, "yt-dlp-hanging-fixture.mjs");
    await writeFile(failureScript, 'console.error("Private video"); process.exit(1);', "utf8");
    await writeFile(hangingScript, "setInterval(() => undefined, 1_000);", "utf8");

    const failedAdapter = new YtDlpYoutubeAdapter({
      executable: process.execPath,
      executableArguments: [failureScript],
    });
    await expect(
      failedAdapter.inspect("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    ).rejects.toMatchObject({ kind: "unavailable" });

    const controller = new AbortController();
    const hangingAdapter = new YtDlpYoutubeAdapter({
      executable: process.execPath,
      executableArguments: [hangingScript],
    });
    const inspection = hangingAdapter.inspect(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      controller.signal,
    );
    setTimeout(() => controller.abort(), 25);
    await expect(inspection).rejects.toMatchObject({ kind: "cancelled" });
  });

  it("rejects an oversized Caption Track before buffering its body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("{}", { headers: { "content-length": String(32 * 1024 * 1024 + 1) } }),
      ),
    );
    const adapter = new YtDlpYoutubeAdapter();

    await expect(
      adapter.downloadCaption({
        origin: "creator-caption",
        languageCode: "en",
        format: "json3",
        url: "https://captions.test/oversized",
      }),
    ).rejects.toMatchObject({
      kind: "failed",
      message: "The Caption Track is larger than Watchless can safely process.",
    });
  });
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
    const adapter = new YtDlpYoutubeAdapter({
      executable: process.execPath,
      executableArguments: [script],
      ffmpegDirectory: join(directory, "managed-ffmpeg"),
    });

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
    expect(arguments_).toContain("--ffmpeg-location");
    expect(arguments_).toContain(join(directory, "managed-ffmpeg"));
    await expect(readFile(destinationPath, "utf8")).resolves.toBe("fixture audio");
  });
});
