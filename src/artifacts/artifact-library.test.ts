import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { TRANSCRIPT_SCHEMA_VERSION, type Transcript } from "../transcript/model.js";
import { ArtifactLibrary } from "./artifact-library.js";

const VIDEO_ID = "dQw4w9WgXcQ";
const TRANSCRIPT: Transcript = {
  schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
  video: {
    id: VIDEO_ID,
    title: "Library fixture",
    canonicalUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    durationMs: 10_000,
  },
  languageCode: "en",
  segments: [{ startMs: 0, endMs: 9_000, text: "A retained idea." }],
  provenance: {
    origin: "creator-caption",
    languageCode: "en",
    rawArtifact: "caption-track.json3",
    normalization: [
      "whitespace-normalization",
      "rolling-caption-deduplication",
      "timing-repair",
      "cue-boundary-repair",
    ],
  },
};

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("ArtifactLibrary listing", () => {
  it("returns an empty list before any Video Artifacts are committed", async () => {
    const library = new ArtifactLibrary(await temporaryLibrary());

    await expect(library.listEntries()).resolves.toEqual([]);
  });

  it("lists the current Transcript and Summary state", async () => {
    const library = new ArtifactLibrary(await temporaryLibrary());
    const stored = await library.commitCaptionTranscript(TRANSCRIPT, '{"events":[]}');
    await library.commitSummary(VIDEO_ID, stored.revision, "# Summary\n");

    await expect(library.listEntries()).resolves.toEqual([
      {
        videoId: VIDEO_ID,
        title: "Library fixture",
        languageCode: "en",
        transcriptOrigin: "creator-caption",
        hasSummary: true,
        updatedAtMs: expect.any(Number),
      },
    ]);
  });
});

async function temporaryLibrary(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "subtext-library-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
