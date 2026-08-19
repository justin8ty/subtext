import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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
  it("downloads, verifies, and reuses every pinned runtime package", async () => {
    const rootDirectory = await temporaryRuntime();
    const manifest = fixtureManifest("v1");
    const http = new MemoryRuntimeHttpClient(downloads("v1"));
    const progress: string[] = [];
    const manager = new RuntimeManager({ rootDirectory, manifest, httpClient: http });

    const first = await manager.prepare({
      onProgress: (event) => progress.push(`${event.phase}:${event.packageId}`),
    });
    const second = await manager.prepare();

    expect(first).toEqual(second);
    expect(first.ytDlpExecutable).toContain(join("tools", "yt-dlp", "v1"));
    expect(first.ffmpegDirectory).toBe(dirname(first.ffmpegExecutable));
    expect(first.whisperExecutable).toContain("whisper-cli.exe");
    expect(first.modelName).toBe("fixture-balanced");
    await expect(readFile(first.ytDlpExecutable, "utf8")).resolves.toBe("yt-dlp");
    await expect(readFile(first.ffmpegExecutable, "utf8")).resolves.toBe("ffmpeg");
    await expect(readFile(first.whisperExecutable, "utf8")).resolves.toBe("whisper");
    await expect(readFile(first.modelPath, "utf8")).resolves.toBe("model");
    expect(http.requestCount).toBe(4);
    expect(progress).toContain("installing:ffmpeg");
    expect(progress).toContain("ready:model-balanced");
  });

  it("repairs a same-size corrupted executable after full digest verification", async () => {
    const rootDirectory = await temporaryRuntime();
    const manifest = fixtureManifest("v1");
    const http = new MemoryRuntimeHttpClient(downloads("v1"));
    const manager = new RuntimeManager({ rootDirectory, manifest, httpClient: http });
    const installed = await manager.prepare();
    await writeFile(installed.ytDlpExecutable, "broken", "utf8");

    const repaired = await manager.prepare({ mode: "repair" });

    await expect(readFile(repaired.ytDlpExecutable, "utf8")).resolves.toBe("yt-dlp");
    expect(http.requestsFor("https://runtime.test/v1/yt-dlp.exe")).toBe(2);
    expect(http.requestCount).toBe(5);
  });

  it("installs updated pins transactionally and removes obsolete versions on update", async () => {
    const rootDirectory = await temporaryRuntime();
    const http = new MemoryRuntimeHttpClient(new Map([...downloads("v1"), ...downloads("v2")]));
    const first = await new RuntimeManager({
      rootDirectory,
      manifest: fixtureManifest("v1"),
      httpClient: http,
    }).prepare();
    const second = await new RuntimeManager({
      rootDirectory,
      manifest: fixtureManifest("v2"),
      httpClient: http,
    }).prepare({ mode: "update" });

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

    await expect(manager.prepare()).rejects.toMatchObject({
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
