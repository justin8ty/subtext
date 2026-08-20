import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  AsrAdapterError,
  type AsrAdapter,
  type AsrTranscript,
  type AsrTranscriptionOptions,
} from "../asr/asr-adapter.js";
import { ArtifactLibrary } from "../artifacts/artifact-library.js";
import { parseYoutubeUrl } from "../source-video/youtube-url.js";
import { normalizeJson3Caption } from "../transcript/normalize-json3.js";
import type {
  CaptionTrack,
  InspectedSourceVideo,
  YoutubeAdapter,
} from "../youtube/youtube-adapter.js";
import { TranscriptAcquirer } from "./acquire-transcript.js";

const VIDEO_ID = "dQw4w9WgXcQ";
const RAW_CAPTION = JSON.stringify({
  events: [
    { tStartMs: 0, dDurationMs: 4_000, segs: [{ utf8: "First idea" }] },
    { tStartMs: 4_000, dDurationMs: 5_000, segs: [{ utf8: "Second idea" }] },
  ],
});

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("TranscriptAcquirer", () => {
  it("selects creator captions, commits both artifacts, and reuses by video ID", async () => {
    const creatorTrack = captionTrack("creator-caption", "creator");
    const automaticTrack = captionTrack("automatic-caption", "automatic");
    const youtube = new FakeYoutubeAdapter(
      sourceVideo([automaticTrack, creatorTrack]),
      RAW_CAPTION,
    );
    const library = new ArtifactLibrary(await temporaryLibrary());
    const acquirer = new TranscriptAcquirer(youtube, new UnusedAsrAdapter(), library);
    const stages: string[] = [];

    const first = await acquirer.acquire(`https://youtu.be/${VIDEO_ID}`, {
      onStage: (stage) => stages.push(stage),
    });
    expect(first.status).toBe("completed");
    if (first.status !== "completed") {
      return;
    }
    expect(first.reused).toBe(false);
    expect(first.transcript.provenance.origin).toBe("creator-caption");
    expect(youtube.downloadedTrack?.url).toBe("https://captions.test/creator");
    await expect(
      readFile(join(first.artifactDirectory, "caption-track.json3"), "utf8"),
    ).resolves.toBe(RAW_CAPTION);
    await expect(
      readFile(join(first.artifactDirectory, "transcript.json"), "utf8"),
    ).resolves.toContain('"schemaVersion": 1');

    const reused = await acquirer.acquire(
      `https://www.youtube.com/watch?v=${VIDEO_ID}&list=ignored`,
    );
    expect(reused.status).toBe("completed");
    if (reused.status === "completed") {
      expect(reused.reused).toBe(true);
      expect(reused.artifactDirectory).toBe(first.artifactDirectory);
    }
    expect(youtube.inspectionCount).toBe(1);
    expect(stages).toEqual(["inspecting-video", "preparing-caption-transcript"]);
  });

  it("replaces the current revision only after a refreshed Transcript is complete", async () => {
    const library = new ArtifactLibrary(await temporaryLibrary());
    const firstYoutube = new FakeYoutubeAdapter(
      sourceVideo([captionTrack("creator-caption", "creator")]),
      RAW_CAPTION,
    );
    const first = await new TranscriptAcquirer(
      firstYoutube,
      new UnusedAsrAdapter(),
      library,
    ).acquire(`https://www.youtube.com/watch?v=${VIDEO_ID}`);
    expect(first.status).toBe("completed");
    if (first.status !== "completed") {
      return;
    }

    const refreshedCaption = JSON.stringify({
      events: [
        { tStartMs: 0, dDurationMs: 5_000, segs: [{ utf8: "Refreshed opening" }] },
        { tStartMs: 5_000, dDurationMs: 4_000, segs: [{ utf8: "Refreshed ending" }] },
      ],
    });
    const refreshYoutube = new FakeYoutubeAdapter(
      sourceVideo([captionTrack("creator-caption", "creator")]),
      refreshedCaption,
    );
    const refreshed = await new TranscriptAcquirer(
      refreshYoutube,
      new UnusedAsrAdapter(),
      library,
    ).acquire(`https://youtu.be/${VIDEO_ID}`, { refresh: true });

    expect(refreshed.status).toBe("completed");
    if (refreshed.status === "completed") {
      expect(refreshed.reused).toBe(false);
      expect(refreshed.artifactDirectory).not.toBe(first.artifactDirectory);
      expect(refreshed.transcript.segments[0]?.text).toBe("Refreshed opening");
    }
    await expect(
      readFile(join(first.artifactDirectory, "transcript.json"), "utf8"),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(library.findTranscript(VIDEO_ID)).resolves.toMatchObject({
      transcript: { segments: [{ text: "Refreshed opening" }, { text: "Refreshed ending" }] },
    });
  });

  it("does not commit a malformed Caption Track", async () => {
    const youtube = new FakeYoutubeAdapter(
      sourceVideo([captionTrack("creator-caption", "creator")]),
      "{not-json",
    );
    const library = new ArtifactLibrary(await temporaryLibrary());
    const acquirer = new TranscriptAcquirer(youtube, new UnusedAsrAdapter(), library);

    const outcome = await acquirer.acquire(`https://www.youtube.com/watch?v=${VIDEO_ID}`);

    expect(outcome).toMatchObject({ status: "unavailable", reason: "invalid-caption" });
    await expect(library.findTranscript(VIDEO_ID)).resolves.toBeNull();
  });

  it("does not commit a Caption Track that cannot plausibly cover the Source Video", async () => {
    const shortCaption = JSON.stringify({
      events: [{ tStartMs: 0, dDurationMs: 1_000, segs: [{ utf8: "Only the opening" }] }],
    });
    const youtube = new FakeYoutubeAdapter(
      sourceVideo([captionTrack("creator-caption", "creator")]),
      shortCaption,
    );
    const library = new ArtifactLibrary(await temporaryLibrary());
    const acquirer = new TranscriptAcquirer(youtube, new UnusedAsrAdapter(), library);

    const outcome = await acquirer.acquire(`https://www.youtube.com/watch?v=${VIDEO_ID}`);

    expect(outcome).toMatchObject({ status: "unavailable", reason: "implausible-coverage" });
    await expect(library.findTranscript(VIDEO_ID)).resolves.toBeNull();
  });

  it("reports the ASR fallback before downloading Default Audio or preparing ASR", async () => {
    const library = new ArtifactLibrary(await temporaryLibrary());
    const workspaceRoot = await temporaryLibrary();
    const events: string[] = [];
    const youtube = new FakeAsrYoutubeAdapter(sourceVideoWithoutLanguage(), events);
    const segments = [
      { startMs: 0, endMs: 5_000, text: "ASR opening" },
      { startMs: 5_000, endMs: 10_000, text: "ASR ending" },
    ];
    const asr = new ScriptedAsrAdapter(
      { languageCode: "es", model: "large-v3-turbo", segments },
      undefined,
      events,
    );
    const drafts: string[] = [];
    const acquirer = new TranscriptAcquirer(youtube, asr, library, workspaceRoot);

    const outcome = await acquirer.acquire(`https://www.youtube.com/watch?v=${VIDEO_ID}`, {
      asrQuality: "accurate",
      onStage: (stage) => events.push(stage),
      onTranscriptDraft: (draft) => drafts.push(draft.segment.text),
    });

    expect(outcome).toMatchObject({
      status: "completed",
      reused: false,
      transcript: {
        languageCode: "es",
        provenance: { origin: "asr", languageCode: "es", model: "large-v3-turbo" },
      },
    });
    expect(events).toEqual([
      "inspecting-video",
      "no-eligible-caption",
      "switching-to-asr",
      "downloading-default-audio",
      "audio",
      "preparing-runtime",
      "transcribing-whisper",
      "asr",
    ]);
    expect(drafts).toEqual(["ASR opening", "ASR ending"]);
    expect(asr.receivedLanguageCode).toBeUndefined();
    expect(asr.receivedDurationMs).toBe(10_000);
    expect(asr.receivedQuality).toBe("accurate");
    expect(youtube.downloadedAudioPath).toMatch(/default-audio\.wav$/u);
    expect(await readdir(workspaceRoot)).toEqual([]);
    if (outcome.status === "completed") {
      await expect(
        readFile(join(outcome.artifactDirectory, "caption-track.json3"), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        readFile(join(outcome.artifactDirectory, "transcript.json"), "utf8"),
      ).resolves.toContain('"origin": "asr"');
    }
  });

  it("retains streamed draft output but no artifact when ASR is cancelled", async () => {
    const library = new ArtifactLibrary(await temporaryLibrary());
    const workspaceRoot = await temporaryLibrary();
    const youtube = new FakeAsrYoutubeAdapter(sourceVideo([]));
    const draftSegment = { startMs: 0, endMs: 3_000, text: "Incomplete draft" };
    const asr = new ScriptedAsrAdapter(
      new AsrAdapterError("cancelled", "ASR transcription was cancelled."),
      [draftSegment],
    );
    const drafts: string[] = [];
    const acquirer = new TranscriptAcquirer(youtube, asr, library, workspaceRoot);

    const outcome = await acquirer.acquire(`https://youtu.be/${VIDEO_ID}`, {
      onTranscriptDraft: (draft) => drafts.push(draft.segment.text),
    });

    expect(outcome).toMatchObject({ status: "cancelled" });
    expect(drafts).toEqual(["Incomplete draft"]);
    await expect(library.findTranscript(VIDEO_ID)).resolves.toBeNull();
    expect(await readdir(workspaceRoot)).toEqual([]);
  });

  it("returns needs-input without invoking YouTube for an invalid URL", async () => {
    const youtube = new FakeYoutubeAdapter(sourceVideo([]), RAW_CAPTION);
    const acquirer = new TranscriptAcquirer(
      youtube,
      new UnusedAsrAdapter(),
      new ArtifactLibrary(await temporaryLibrary()),
    );

    const outcome = await acquirer.acquire("https://example.com/watch?v=dQw4w9WgXcQ");

    expect(outcome.status).toBe("needs-input");
    expect(youtube.inspectionCount).toBe(0);
  });
});

describe("JSON3 normalization", () => {
  it("normalizes whitespace, removes rolling duplication, and repairs overlap", () => {
    const raw = JSON.stringify({
      events: [
        { tStartMs: 0, dDurationMs: 2_000, segs: [{ utf8: "  hello\nworld " }] },
        { tStartMs: 1_000, dDurationMs: 2_000, segs: [{ utf8: "hello world again" }] },
        { tStartMs: 2_500, dDurationMs: 2_000, segs: [{ utf8: "again and onward" }] },
      ],
    });

    expect(normalizeJson3Caption(raw, 5_000)).toEqual([
      { startMs: 0, endMs: 2_500, text: "hello world again" },
      { startMs: 2_500, endMs: 4_500, text: "again and onward" },
    ]);
  });

  it("preserves intentional repeated wording in non-overlapping cues", () => {
    const raw = JSON.stringify({
      events: [
        { tStartMs: 0, dDurationMs: 1_000, segs: [{ utf8: "no" }] },
        { tStartMs: 1_000, dDurationMs: 1_000, segs: [{ utf8: "no" }] },
      ],
    });

    expect(normalizeJson3Caption(raw, 2_000)).toEqual([
      { startMs: 0, endMs: 1_000, text: "no" },
      { startMs: 1_000, endMs: 2_000, text: "no" },
    ]);
  });
});

describe("YouTube URL identity", () => {
  it.each([
    `https://youtu.be/${VIDEO_ID}?feature=shared`,
    `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    `https://youtube.com/shorts/${VIDEO_ID}`,
    `https://www.youtube.com/embed/${VIDEO_ID}`,
  ])("extracts the durable video ID from %s", (url) => {
    expect(parseYoutubeUrl(url)).toEqual({
      status: "valid",
      videoId: VIDEO_ID,
      canonicalUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    });
  });
});

class FakeYoutubeAdapter implements YoutubeAdapter {
  readonly video: InspectedSourceVideo;
  readonly rawCaption: string;
  inspectionCount = 0;
  downloadedTrack?: CaptionTrack;

  constructor(video: InspectedSourceVideo, rawCaption: string) {
    this.video = video;
    this.rawCaption = rawCaption;
  }

  async inspect(): Promise<InspectedSourceVideo> {
    this.inspectionCount += 1;
    return this.video;
  }

  async downloadCaption(track: CaptionTrack): Promise<string> {
    this.downloadedTrack = track;
    return this.rawCaption;
  }

  async downloadDefaultAudio(): Promise<void> {
    throw new Error("Default Audio was not expected in this test.");
  }
}

class UnusedAsrAdapter implements AsrAdapter {
  async transcribe(): Promise<AsrTranscript> {
    throw new Error("ASR was not expected in this test.");
  }
}

class ScriptedAsrAdapter implements AsrAdapter {
  readonly result: AsrTranscript | Error;
  readonly draftSegments: readonly AsrTranscript["segments"][number][];
  readonly events: string[] | undefined;
  receivedDurationMs: number | undefined;
  receivedLanguageCode: string | undefined;
  receivedQuality: AsrTranscriptionOptions["quality"];

  constructor(
    result: AsrTranscript | Error,
    draftSegments: readonly AsrTranscript["segments"][number][] | undefined = undefined,
    events?: string[],
  ) {
    this.result = result;
    this.draftSegments = draftSegments ?? (result instanceof Error ? [] : result.segments);
    this.events = events;
  }

  async transcribe(
    _audioPath: string,
    options: AsrTranscriptionOptions = {},
  ): Promise<AsrTranscript> {
    options.onStage?.("preparing-runtime");
    options.onStage?.("transcribing-whisper");
    this.events?.push("asr");
    this.receivedDurationMs = options.durationMs;
    this.receivedLanguageCode = options.languageCode;
    this.receivedQuality = options.quality;
    for (const segment of this.draftSegments) {
      options.onSegment?.(segment);
    }
    if (this.result instanceof Error) {
      throw this.result;
    }
    return this.result;
  }
}

class FakeAsrYoutubeAdapter implements YoutubeAdapter {
  readonly video: InspectedSourceVideo;
  readonly events: string[] | undefined;
  downloadedAudioPath: string | undefined;

  constructor(video: InspectedSourceVideo, events?: string[]) {
    this.video = video;
    this.events = events;
  }

  async inspect(): Promise<InspectedSourceVideo> {
    return this.video;
  }

  async downloadCaption(): Promise<string> {
    throw new Error("A Caption Track was not expected in this test.");
  }

  async downloadDefaultAudio(_canonicalUrl: string, destinationPath: string): Promise<void> {
    this.events?.push("audio");
    this.downloadedAudioPath = destinationPath;
    await writeFile(destinationPath, "fixture audio");
  }
}

function sourceVideo(captionTracks: readonly CaptionTrack[]): InspectedSourceVideo {
  return {
    id: VIDEO_ID,
    title: "Fixture video",
    canonicalUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    durationMs: 10_000,
    spokenLanguage: "en-US",
    liveStatus: "not_live",
    availability: "public",
    captionTracks,
  };
}

function sourceVideoWithoutLanguage(): InspectedSourceVideo {
  return {
    id: VIDEO_ID,
    title: "Fixture video",
    canonicalUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    durationMs: 10_000,
    liveStatus: "not_live",
    availability: "public",
    captionTracks: [],
  };
}

function captionTrack(origin: CaptionTrack["origin"], suffix: string): CaptionTrack {
  return {
    origin,
    languageCode: "en",
    name: "English",
    format: "json3",
    url: `https://captions.test/${suffix}`,
  };
}

async function temporaryLibrary(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "subtext-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
