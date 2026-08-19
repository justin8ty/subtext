import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

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
        canonicalUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
        artifactDirectory: stored.artifactDirectory,
        languageCode: "en",
        transcriptOrigin: "creator-caption",
        hasSummary: true,
        updatedAtMs: expect.any(Number),
      },
    ]);
  });

  it("serializes concurrent Transcript commits and retains only the current revision", async () => {
    const rootDirectory = await temporaryLibrary();
    const library = new ArtifactLibrary(rootDirectory);
    const commits = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        library.commitCaptionTranscript(
          {
            ...TRANSCRIPT,
            video: { ...TRANSCRIPT.video, title: `Concurrent ${index.toString()}` },
          },
          `{"fixture":${index.toString()}}`,
        ),
      ),
    );

    const current = await library.findTranscript(VIDEO_ID);
    expect(current).not.toBeNull();
    if (current === null) {
      return;
    }
    expect(commits.map((commit) => commit.revision)).toContain(current.revision);
    const revisions = await readdir(join(rootDirectory, "videos", VIDEO_ID, "revisions"));
    expect(revisions).toEqual([current.revision]);
  });

  it("serializes a Summary commit with a concurrent Transcript refresh", async () => {
    const library = new ArtifactLibrary(await temporaryLibrary());
    const original = await library.commitCaptionTranscript(TRANSCRIPT, '{"fixture":"old"}');
    const replacement = {
      ...TRANSCRIPT,
      video: { ...TRANSCRIPT.video, title: "Refreshed fixture" },
    };

    const [summary, refreshed] = await Promise.all([
      library.commitSummary(VIDEO_ID, original.revision, "# Summary\n"),
      library.commitCaptionTranscript(replacement, '{"fixture":"replacement"}'),
    ]);

    expect(summary.revision).toBe(original.revision);
    await expect(library.findTranscript(VIDEO_ID)).resolves.toMatchObject({
      revision: refreshed.revision,
      transcript: { video: { title: "Refreshed fixture" } },
    });
    await expect(library.findSummary(VIDEO_ID)).resolves.toBeNull();
  });

  it("recovers from a corrupt current pointer when a fresh Transcript is committed", async () => {
    const rootDirectory = await temporaryLibrary();
    const library = new ArtifactLibrary(rootDirectory);
    await library.commitCaptionTranscript(TRANSCRIPT, '{"fixture":"old"}');
    await writeFile(join(rootDirectory, "videos", VIDEO_ID, "current.json"), "{invalid", "utf8");
    await expect(library.findTranscript(VIDEO_ID)).rejects.toThrow("invalid or incomplete");

    const replacement = {
      ...TRANSCRIPT,
      video: { ...TRANSCRIPT.video, title: "Recovered fixture" },
    };
    await library.commitCaptionTranscript(replacement, '{"fixture":"replacement"}');

    await expect(library.findTranscript(VIDEO_ID)).resolves.toMatchObject({
      transcript: { video: { title: "Recovered fixture" } },
    });
    const revisions = await readdir(join(rootDirectory, "videos", VIDEO_ID, "revisions"));
    expect(revisions).toHaveLength(1);
  });

  it("exports derived formats and deletes Video Artifacts", async () => {
    const library = new ArtifactLibrary(await temporaryLibrary());
    await library.commitCaptionTranscript(TRANSCRIPT, '{"events":[]}');

    const markdownPath = await library.exportTranscript(VIDEO_ID, "markdown");
    const textPath = await library.exportTranscript(VIDEO_ID, "text");
    const vttPath = await library.exportTranscript(VIDEO_ID, "vtt");
    const srtPath = await library.exportTranscript(VIDEO_ID, "srt");

    expect(basename(markdownPath)).toBe("transcript.md");
    await expect(readFile(markdownPath, "utf8")).resolves.toContain("[00:00]");
    await expect(readFile(textPath, "utf8")).resolves.toBe("[00:00] A retained idea.\n");
    await expect(readFile(vttPath, "utf8")).resolves.toContain("00:00:00.000 --> 00:00:09.000");
    await expect(readFile(srtPath, "utf8")).resolves.toContain("00:00:00,000 --> 00:00:09,000");

    await expect(library.deleteVideoArtifacts(VIDEO_ID)).resolves.toBe(true);
    await expect(library.findTranscript(VIDEO_ID)).resolves.toBeNull();
    await expect(library.listEntries()).resolves.toEqual([]);
    await expect(library.deleteVideoArtifacts(VIDEO_ID)).resolves.toBe(false);
  });
});

async function temporaryLibrary(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "subtext-library-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
