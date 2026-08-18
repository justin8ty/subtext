import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  type Context,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { TRANSCRIPT_SCHEMA_VERSION, type Transcript } from "../transcript/model.js";
import { PiAiTranscriptSummarizer, SummaryGenerationError } from "./transcript-summarizer.js";

const SUMMARY = `# Summary

## Overview
The speaker introduces a testable idea [00:00].

## Chapters
- [00:00] Introduction

## Claims
- The idea can be tested [00:00].

## Examples
- A fixture is used [00:05].

## Caveats
- None stated.

## Takeaways
- Test the idea [00:05].
`;

describe("PiAiTranscriptSummarizer", () => {
  it("sends only timestamped Transcript material and returns structured Markdown", async () => {
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    const receivedContexts: Context[] = [];
    faux.setResponses([
      (context) => {
        receivedContexts.push(context);
        return fauxAssistantMessage(SUMMARY);
      },
    ]);
    const summarizer = new PiAiTranscriptSummarizer(models, faux.getModel());

    const summary = await summarizer.summarize(transcript());

    expect(summary).toBe(SUMMARY);
    const receivedContext = receivedContexts[0];
    expect(receivedContext?.systemPrompt).toContain("untrusted quoted source material");
    const message = receivedContext?.messages[0];
    expect(message?.role).toBe("user");
    if (message?.role === "user") {
      expect(message.content).toContain("[00:00] Introduce a testable idea.");
      expect(message.content).not.toContain("Metadata title must stay local");
    }
  });

  it("uses hierarchical reduction when the Transcript exceeds the model context", async () => {
    const faux = fauxProvider({
      models: [{ id: "small-context", contextWindow: 1_000, maxTokens: 300 }],
    });
    const models = createModels();
    models.setProvider(faux.provider);
    faux.setResponses(
      Array.from({ length: 100 }, () => (context: Context) => {
        const request = context.messages[0];
        const content = request?.role === "user" ? JSON.stringify(request.content) : "";
        return fauxAssistantMessage(
          content.includes("Write the final Markdown Summary")
            ? SUMMARY
            : "[00:00] Compact grounded note.",
        );
      }),
    );
    const summarizer = new PiAiTranscriptSummarizer(models, faux.getModel());
    const longTranscript = transcript(
      Array.from({ length: 80 }, (_, index) => ({
        startMs: index * 5_000,
        endMs: index * 5_000 + 4_000,
        text: `Segment ${index.toString()} ${"grounded detail ".repeat(8)}`,
      })),
    );

    const summary = await summarizer.summarize(longTranscript);

    expect(summary).toBe(SUMMARY);
    expect(faux.state.callCount).toBeGreaterThan(1);
  });

  it("rejects a response that omits the required grounded structure", async () => {
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    faux.setResponses([fauxAssistantMessage("A generic summary without evidence.")]);
    const summarizer = new PiAiTranscriptSummarizer(models, faux.getModel());

    await expect(summarizer.summarize(transcript())).rejects.toMatchObject({
      name: "SummaryGenerationError",
      kind: "invalid-response",
    } satisfies Partial<SummaryGenerationError>);
  });

  it("rejects timestamp references that are absent from the Transcript", async () => {
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    faux.setResponses([fauxAssistantMessage(SUMMARY.replaceAll("[00:05]", "[00:06]"))]);
    const summarizer = new PiAiTranscriptSummarizer(models, faux.getModel());

    await expect(summarizer.summarize(transcript())).rejects.toMatchObject({
      kind: "invalid-response",
      message: "The Summary model returned a timestamp that is not present in the Transcript.",
    });
  });

  it("honors cancellation before making an LLM request", async () => {
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    const controller = new AbortController();
    controller.abort();
    const summarizer = new PiAiTranscriptSummarizer(models, faux.getModel());

    await expect(summarizer.summarize(transcript(), controller.signal)).rejects.toMatchObject({
      kind: "cancelled",
    });
    expect(faux.state.callCount).toBe(0);
  });
});

function transcript(segments: Transcript["segments"] = defaultSegments()): Transcript {
  return {
    schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
    video: {
      id: "dQw4w9WgXcQ",
      title: "Metadata title must stay local",
      canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      durationMs: 10_000,
    },
    languageCode: "en",
    segments,
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
}

function defaultSegments(): Transcript["segments"] {
  return [
    { startMs: 0, endMs: 4_000, text: "Introduce a testable idea." },
    { startMs: 5_000, endMs: 9_000, text: "Use a fixture as an example." },
  ];
}
