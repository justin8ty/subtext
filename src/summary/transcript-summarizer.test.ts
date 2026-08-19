import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  type Context,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { TRANSCRIPT_SCHEMA_VERSION, type Transcript } from "../transcript/model.js";
import { PiAiTranscriptSummarizer, SummaryGenerationError } from "./transcript-summarizer.js";

const SUMMARY = `# Key ideas

The speaker introduces a testable idea and demonstrates it with a fixture.
`;

describe("PiAiTranscriptSummarizer", () => {
  it("sends only timestamped Transcript material and returns model-written Markdown", async () => {
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
      expect(message.content).toContain("Choose the structure and formatting");
      expect(message.content).not.toContain("## Overview");
    }
  });

  it("applies the selected Summary detail to the final request", async () => {
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    let receivedContext: Context | undefined;
    faux.setResponses([
      (context) => {
        receivedContext = context;
        return fauxAssistantMessage(SUMMARY);
      },
    ]);
    const summarizer = new PiAiTranscriptSummarizer(models, faux.getModel(), "detailed");

    await summarizer.summarize(transcript());

    const message = receivedContext?.messages[0];
    expect(message?.role).toBe("user");
    if (message?.role === "user") {
      expect(message.content).toContain("Provide a detailed Summary");
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

  it("handles a six-hour Transcript through bounded hierarchical requests", async () => {
    const faux = fauxProvider({
      models: [{ id: "small-context", contextWindow: 1_000, maxTokens: 300 }],
    });
    const models = createModels();
    models.setProvider(faux.provider);
    faux.setResponses(
      Array.from({ length: 1_000 }, () => (context: Context) => {
        const request = context.messages[0];
        const content = request?.role === "user" ? JSON.stringify(request.content) : "";
        return fauxAssistantMessage(
          content.includes("Write the final Markdown Summary")
            ? SUMMARY
            : "[00:00] Compact grounded note.",
        );
      }),
    );
    const sixHoursMs = 6 * 60 * 60 * 1_000;
    const segments: Transcript["segments"] = [
      ...defaultSegments(),
      ...Array.from({ length: 359 }, (_, index) => ({
        startMs: (index + 1) * 60_000,
        endMs: (index + 1) * 60_000 + 30_000,
        text: `Minute ${(index + 1).toString()} ${"grounded long-video detail ".repeat(8)}`,
      })),
    ];
    const summarizer = new PiAiTranscriptSummarizer(models, faux.getModel());

    await expect(summarizer.summarize(transcript(segments, sixHoursMs))).resolves.toBe(SUMMARY);
    expect(faux.state.callCount).toBeGreaterThan(10);
  });

  it("accepts the model's content without imposing structure or timestamp checks", async () => {
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    const modelWrittenSummary =
      "The central argument is presented as prose, with a model-chosen timestamp [00:06].";
    faux.setResponses([fauxAssistantMessage(modelWrittenSummary)]);
    const summarizer = new PiAiTranscriptSummarizer(models, faux.getModel());

    await expect(summarizer.summarize(transcript())).resolves.toBe(`${modelWrittenSummary}\n`);
  });

  it("rejects an empty model response", async () => {
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    faux.setResponses([fauxAssistantMessage("  \n")]);
    const summarizer = new PiAiTranscriptSummarizer(models, faux.getModel());

    await expect(summarizer.summarize(transcript())).rejects.toMatchObject({
      name: "SummaryGenerationError",
      kind: "empty-response",
      message: "The Summary model returned no text.",
    } satisfies Partial<SummaryGenerationError>);
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

function transcript(
  segments: Transcript["segments"] = defaultSegments(),
  durationMs = 10_000,
): Transcript {
  return {
    schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
    video: {
      id: "dQw4w9WgXcQ",
      title: "Metadata title must stay local",
      canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      durationMs,
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
