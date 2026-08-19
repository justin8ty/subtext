import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AcquisitionOptions, AcquisitionOutcome } from "../acquisition/acquire-transcript.js";
import { ArtifactLibrary } from "../artifacts/artifact-library.js";
import {
  SummaryGenerationError,
  type TranscriptSummarizer,
} from "../summary/transcript-summarizer.js";
import { TRANSCRIPT_SCHEMA_VERSION, type Transcript } from "../transcript/model.js";
import { VideoProcessor, type TranscriptAcquisition } from "./process-video.js";

const VIDEO_ID = "dQw4w9WgXcQ";
const RAW_CAPTION = '{"events":[]}';
const SUMMARY = `# Summary

## Overview
An idea is introduced [00:00].

## Chapters
- [00:00] Opening

## Claims
- An idea is stated [00:00].

## Examples
- None stated.

## Caveats
- None stated.

## Takeaways
- Retain the idea [00:00].
`;
const TRANSCRIPT: Transcript = {
  schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
  video: {
    id: VIDEO_ID,
    title: "Fixture video",
    canonicalUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    durationMs: 10_000,
  },
  languageCode: "en",
  segments: [{ startMs: 0, endMs: 10_000, text: "An idea is introduced." }],
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

describe("VideoProcessor", () => {
  it("commits a Summary independently and reuses it with the Transcript", async () => {
    const library = new ArtifactLibrary(await temporaryLibrary());
    const acquisition = await completedAcquisition(library);
    const events: string[] = [];
    const summarizer = new ScriptedSummarizer([SUMMARY], () => events.push("summary"));
    const processor = new VideoProcessor(acquisition, library, summarizer);

    const first = await processor.process(TRANSCRIPT.video.canonicalUrl, {
      onTranscript: () => events.push("transcript"),
    });

    expect(first).toMatchObject({
      status: "completed",
      reusedTranscript: false,
      reusedSummary: false,
    });
    expect(events).toEqual(["transcript", "summary"]);
    if (first.status !== "completed") {
      return;
    }
    await expect(readFile(join(first.artifactDirectory, "summary.md"), "utf8")).resolves.toBe(
      SUMMARY,
    );

    const second = await processor.process(TRANSCRIPT.video.canonicalUrl);
    expect(second).toMatchObject({
      status: "completed",
      reusedTranscript: false,
      reusedSummary: true,
    });
    expect(summarizer.calls).toBe(1);
  });

  it("forwards streamed Transcript Draft segments before the completed Transcript", async () => {
    const library = new ArtifactLibrary(await temporaryLibrary());
    const storedTranscript = await library.commitAsrTranscript({
      ...TRANSCRIPT,
      provenance: {
        origin: "asr",
        languageCode: "en",
        model: "fixture-model",
        normalization: ["whitespace-normalization", "timing-repair"],
      },
    });
    const acquisition = new FixedAcquisition(completedOutcome(storedTranscript), (options) => {
      options.onTranscriptDraft?.({
        video: TRANSCRIPT.video,
        segment: TRANSCRIPT.segments[0]!,
      });
    });
    const events: string[] = [];
    const processor = new VideoProcessor(acquisition, library, new ScriptedSummarizer([SUMMARY]));

    await processor.process(TRANSCRIPT.video.canonicalUrl, {
      onTranscriptDraft: () => events.push("draft"),
      onTranscript: () => events.push("transcript"),
    });

    expect(events).toEqual(["draft", "transcript"]);
  });

  it("retains an Unsummarized Transcript when Summary generation fails", async () => {
    const library = new ArtifactLibrary(await temporaryLibrary());
    const acquisition = await completedAcquisition(library);
    const failure = new SummaryGenerationError("failed", "Provider unavailable.");
    const processor = new VideoProcessor(acquisition, library, new ScriptedSummarizer([failure]));

    const outcome = await processor.process(TRANSCRIPT.video.canonicalUrl);

    expect(outcome).toMatchObject({
      status: "unsummarized",
      summaryStatus: "failed",
      message: "Provider unavailable.",
    });
    await expect(library.findTranscript(VIDEO_ID)).resolves.not.toBeNull();
    await expect(library.findSummary(VIDEO_ID)).resolves.toBeNull();
  });

  it("does not persist a Summary when cancellation arrives before its commit", async () => {
    const library = new ArtifactLibrary(await temporaryLibrary());
    const acquisition = await completedAcquisition(library);
    const controller = new AbortController();
    const processor = new VideoProcessor(
      acquisition,
      library,
      new CancellingSummarizer(controller),
    );

    const outcome = await processor.process(TRANSCRIPT.video.canonicalUrl, {
      signal: controller.signal,
    });

    expect(outcome).toMatchObject({
      status: "unsummarized",
      summaryStatus: "cancelled",
    });
    await expect(library.findSummary(VIDEO_ID)).resolves.toBeNull();
  });

  it("keeps the previous Summary when regeneration fails", async () => {
    const library = new ArtifactLibrary(await temporaryLibrary());
    const storedTranscript = await library.commitCaptionTranscript(TRANSCRIPT, RAW_CAPTION);
    await library.commitSummary(VIDEO_ID, storedTranscript.revision, SUMMARY);
    const failure = new SummaryGenerationError("failed", "Provider unavailable.");
    const processor = new VideoProcessor(
      new FixedAcquisition(completedOutcome(storedTranscript)),
      library,
      new ScriptedSummarizer([failure]),
    );

    const outcome = await processor.summarize(VIDEO_ID, { regenerate: true });

    expect(outcome).toMatchObject({ status: "failed", message: "Provider unavailable." });
    await expect(library.findSummary(VIDEO_ID)).resolves.toMatchObject({ markdown: SUMMARY });
  });
});

class FixedAcquisition implements TranscriptAcquisition {
  readonly outcome: AcquisitionOutcome;
  readonly onAcquire: ((options: AcquisitionOptions) => void) | undefined;

  constructor(outcome: AcquisitionOutcome, onAcquire?: (options: AcquisitionOptions) => void) {
    this.outcome = outcome;
    this.onAcquire = onAcquire;
  }

  async acquire(_sourceUrl: string, options: AcquisitionOptions = {}): Promise<AcquisitionOutcome> {
    this.onAcquire?.(options);
    return this.outcome;
  }
}

class ScriptedSummarizer implements TranscriptSummarizer {
  readonly responses: (string | Error)[];
  readonly onSummarize: (() => void) | undefined;
  calls = 0;

  constructor(responses: (string | Error)[], onSummarize?: () => void) {
    this.responses = responses;
    this.onSummarize = onSummarize;
  }

  async summarize(): Promise<string> {
    this.onSummarize?.();
    const response = this.responses[this.calls];
    this.calls += 1;
    if (response === undefined) {
      throw new Error("No scripted Summary response.");
    }
    if (response instanceof Error) {
      throw response;
    }
    return response;
  }
}

class CancellingSummarizer implements TranscriptSummarizer {
  readonly controller: AbortController;

  constructor(controller: AbortController) {
    this.controller = controller;
  }

  async summarize(): Promise<string> {
    this.controller.abort();
    return SUMMARY;
  }
}

async function completedAcquisition(library: ArtifactLibrary): Promise<TranscriptAcquisition> {
  const storedTranscript = await library.commitCaptionTranscript(TRANSCRIPT, RAW_CAPTION);
  return new FixedAcquisition(completedOutcome(storedTranscript));
}

function completedOutcome(
  storedTranscript: Awaited<ReturnType<ArtifactLibrary["commitCaptionTranscript"]>>,
): AcquisitionOutcome {
  return {
    status: "completed",
    transcript: storedTranscript.transcript,
    artifactDirectory: storedTranscript.artifactDirectory,
    artifactRevision: storedTranscript.revision,
    reused: false,
  };
}

async function temporaryLibrary(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "subtext-processing-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
