import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { RuntimeManifest } from "./runtime-manifest.js";
import {
  RuntimeManager,
  type RuntimeHttpClient,
  type RuntimeManagerError,
} from "./runtime-manager.js";

const ZIP = Buffer.from(
  "UEsDBBQAAAAIAAaOE12e4/wvCAAAAAYAAAAVAAAAYnVuZGxlL2Jpbi9mZm1wZWcuZXhlS0vLLUhNBwBQSwMEFAAAAAgABo4TXdHS27oJAAAABwAAABYAAABidW5kbGUvYmluL2ZmcHJvYmUuZXhlS0srKMpPSgUAUEsDBBQAAAAIAAaOE10AQdxPCQAAAAcAAAAXAAAAUmVsZWFzZS93aGlzcGVyLWNsaS5leGUrz8gsLkgtAgBQSwMEFAAAAAgABo4TXTaz0z0FAAAAAwAAABMAAABSZWxlYXNlL3doaXNwZXIuZGxsS8nJAQBQSwECFAMUAAAACAAGjhNdnuP8LwgAAAAGAAAAFQAAAAAAAAAAAAAAgAEAAAAAYnVuZGxlL2Jpbi9mZm1wZWcuZXhlUEsBAhQDFAAAAAgABo4TXdHS27oJAAAABwAAABYAAAAAAAAAAAAAAIABOwAAAGJ1bmRsZS9iaW4vZmZwcm9iZS5leGVQSwECFAMUAAAACAAGjhNdAEHcTwkAAAAHAAAAFwAAAAAAAAAAAAAAgAF4AAAAUmVsZWFzZS93aGlzcGVyLWNsaS5leGVQSwECFAMUAAAACAAGjhNdNrPTPQUAAAADAAAAEwAAAAAAAAAAAAAAgAG2AAAAUmVsZWFzZS93aGlzcGVyLmRsbFBLBQYAAAAABAAEAA0BAADsAAAAAAA=",
  "base64",
);
const TAR_GZ = Buffer.from(
  "H4sIAAAAAAAAA+3V4QqCMBSG4V3KbiDb0c1dj5bRQiymUt190wwqE4lmEn3PnwkKHnw5mNbFOs+WbErC0Uo1J2kl7s8bRiqUpJSQMmKCSEvJuJp0qk5dVonlnO3chSmGnxu7/6PSa//cpBtzqmqbBeXe9zva/lq/0V9HUjAePkwVkO+5Wujf6+/7SzeBY7fQw/31U38Zh66/8DvGa3/e34W3iT3PPQbMpNv/49aUh8wuVrnx/47x/39v/4kU9v8buvBzjwEAAAAAAAAAAAAAAAAAAB+6AEvaYi4AKAAA",
  "base64",
);
const YT_DLP = Buffer.from("yt-dlp");
const MODEL = Buffer.from("model");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("RuntimeManager", () => {
  it("prepares YouTube tools first and defers reusable ASR assets", async () => {
    const rootDirectory = await temporaryRuntime();
    const manifest = fixtureManifest("v1");
    const http = new MemoryRuntimeHttpClient(downloads("v1"));
    const progress: string[] = [];
    const manager = new RuntimeManager({ rootDirectory, manifest, httpClient: http });

    const firstYoutube = await manager.prepareYoutube({
      onProgress: (event) => progress.push(`${event.phase}:${event.packageId}`),
    });
    const secondYoutube = await manager.prepareYoutube();

    expect(firstYoutube).toEqual(secondYoutube);
    expect(firstYoutube.ytDlpExecutable).toContain(join("tools", "yt-dlp", "v1"));
    expect(firstYoutube.ffmpegDirectory).toBe(dirname(firstYoutube.ffmpegExecutable));
    await expect(readFile(firstYoutube.ytDlpExecutable, "utf8")).resolves.toBe("yt-dlp");
    await expect(readFile(firstYoutube.ffmpegExecutable, "utf8")).resolves.toBe("ffmpeg");
    expect(http.requestCount).toBe(2);

    const firstAsr = await manager.prepareAsr({
      onProgress: (event) => progress.push(`${event.phase}:${event.packageId}`),
    });
    const secondAsr = await manager.prepareAsr();

    expect(firstAsr).toEqual(secondAsr);
    expect(firstAsr.whisperExecutable).toContain("whisper-cli.exe");
    expect(firstAsr.modelName).toBe("fixture-balanced");
    await expect(readFile(firstAsr.whisperExecutable, "utf8")).resolves.toBe("whisper");
    await expect(readFile(firstAsr.modelPath, "utf8")).resolves.toBe("model");
    expect(http.requestCount).toBe(4);
    expect(progress).toContain("installing:ffmpeg");
    expect(progress).toContain("ready:model-balanced");
    if (process.platform !== "win32") {
      expect((await stat(firstYoutube.ytDlpExecutable)).mode & 0o111).not.toBe(0);
      expect((await stat(firstAsr.whisperExecutable)).mode & 0o111).not.toBe(0);
    }
  });

  it.runIf(process.platform !== "win32")(
    "extracts tar.gz tools, materializes safe links, and preserves executability",
    async () => {
      const rootDirectory = await temporaryRuntime();
      const baseManifest = fixtureManifest("v1");
      const manifest: RuntimeManifest = {
        ...baseManifest,
        tools: {
          ...baseManifest.tools,
          whisperCpp: {
            version: "v1",
            archive: "tar.gz",
            download: download("v1", "whisper.tar.gz", TAR_GZ),
            executableName: "whisper-cli",
            requiredFiles: ["whisper-cli", "libfixture.so"],
          },
        },
      };
      const responses = downloads("v1");
      responses.set("https://runtime.test/v1/whisper.tar.gz", TAR_GZ);
      const manager = new RuntimeManager({
        rootDirectory,
        manifest,
        httpClient: new MemoryRuntimeHttpClient(responses),
      });

      const runtime = await manager.prepareAsr();
      const linkedLibrary = join(dirname(runtime.whisperExecutable), "libfixture.so");

      expect((await lstat(linkedLibrary)).isFile()).toBe(true);
      await expect(readFile(linkedLibrary, "utf8")).resolves.toBe("library");
      expect((await stat(runtime.whisperExecutable)).mode & 0o111).not.toBe(0);
    },
  );

  it("repairs a same-size corrupted executable after full digest verification", async () => {
    const rootDirectory = await temporaryRuntime();
    const manifest = fixtureManifest("v1");
    const http = new MemoryRuntimeHttpClient(downloads("v1"));
    const manager = new RuntimeManager({ rootDirectory, manifest, httpClient: http });
    const installed = await manager.prepareYoutube();
    await writeFile(installed.ytDlpExecutable, "broken", "utf8");

    const repaired = await manager.prepareYoutube({ mode: "repair" });

    await expect(readFile(repaired.ytDlpExecutable, "utf8")).resolves.toBe("yt-dlp");
    expect(http.requestsFor("https://runtime.test/v1/yt-dlp.exe")).toBe(2);
    expect(http.requestCount).toBe(3);
  });

  it("installs updated pins transactionally and removes obsolete versions on update", async () => {
    const rootDirectory = await temporaryRuntime();
    const http = new MemoryRuntimeHttpClient(new Map([...downloads("v1"), ...downloads("v2")]));
    const first = await new RuntimeManager({
      rootDirectory,
      manifest: fixtureManifest("v1"),
      httpClient: http,
    }).prepareYoutube();
    const second = await new RuntimeManager({
      rootDirectory,
      manifest: fixtureManifest("v2"),
      httpClient: http,
    }).prepareYoutube({ mode: "update" });

    expect(second.ytDlpExecutable).toContain(join("yt-dlp", "v2"));
    await expect(stat(dirname(first.ytDlpExecutable))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(second.ytDlpExecutable, "utf8")).resolves.toBe("yt-dlp");
  });

  it("rejects an asset that does not match its pinned digest", async () => {
    const rootDirectory = await temporaryRuntime();
    const manifest = fixtureManifest("v1", "0".repeat(64));
    const manager = new RuntimeManager({
      rootDirectory,
      manifest,
      httpClient: new MemoryRuntimeHttpClient(downloads("v1")),
    });

    await expect(manager.prepareYoutube()).rejects.toMatchObject({
      kind: "verification",
    } satisfies Partial<RuntimeManagerError>);
    await expect(stat(join(rootDirectory, "tools", "yt-dlp", "v1"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

class MemoryRuntimeHttpClient implements RuntimeHttpClient {
  readonly responses: ReadonlyMap<string, Buffer>;
  readonly requests: string[] = [];

  constructor(responses: ReadonlyMap<string, Buffer>) {
    this.responses = responses;
  }

  async get(url: string): Promise<Response> {
    this.requests.push(url);
    const content = this.responses.get(url);
    if (content === undefined) {
      return new Response(null, { status: 404 });
    }
    return new Response(new Uint8Array(content), { status: 200 });
  }

  get requestCount(): number {
    return this.requests.length;
  }

  requestsFor(url: string): number {
    return this.requests.filter((request) => request === url).length;
  }
}

function fixtureManifest(version: string, ytDlpSha256 = sha256(YT_DLP)): RuntimeManifest {
  return {
    schemaVersion: 1,
    platform: process.platform,
    architecture: process.arch,
    tools: {
      ytDlp: {
        version,
        archive: "file",
        download: download(version, "yt-dlp.exe", YT_DLP, ytDlpSha256),
        executableName: "yt-dlp.exe",
        requiredFiles: ["yt-dlp.exe"],
      },
      ffmpeg: {
        version,
        archive: "zip",
        download: download(version, "ffmpeg.zip", ZIP),
        executableName: "ffmpeg.exe",
        requiredFiles: ["ffmpeg.exe", "ffprobe.exe"],
      },
      whisperCpp: {
        version,
        archive: "zip",
        download: download(version, "whisper.zip", ZIP),
        executableName: "whisper-cli.exe",
        requiredFiles: ["whisper-cli.exe", "whisper.dll"],
      },
    },
    models: {
      balanced: {
        version,
        fileName: "balanced.bin",
        modelName: "fixture-balanced",
        download: download(version, "balanced.bin", MODEL),
      },
      accurate: {
        version,
        fileName: "accurate.bin",
        modelName: "fixture-accurate",
        download: download(version, "accurate.bin", MODEL),
      },
    },
  };
}

function downloads(version: string): Map<string, Buffer> {
  return new Map([
    [`https://runtime.test/${version}/yt-dlp.exe`, YT_DLP],
    [`https://runtime.test/${version}/ffmpeg.zip`, ZIP],
    [`https://runtime.test/${version}/whisper.zip`, ZIP],
    [`https://runtime.test/${version}/balanced.bin`, MODEL],
    [`https://runtime.test/${version}/accurate.bin`, MODEL],
  ]);
}

function download(version: string, name: string, content: Buffer, digest = sha256(content)) {
  return {
    url: `https://runtime.test/${version}/${name}`,
    sha256: digest,
    size: content.length,
  };
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

async function temporaryRuntime(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "subtext-runtime-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
