import type { AcquisitionOptions, AcquisitionOutcome } from "../acquisition/acquire-transcript.js";
import { ArtifactLibrary, ArtifactLibraryError } from "../artifacts/artifact-library.js";
import type { ProcessingStageOptions } from "./processing-stage.js";
import {
  SummaryGenerationError,
  type TranscriptSummarizer,
} from "../summary/transcript-summarizer.js";
import type { Transcript } from "../transcript/model.js";

interface CompletedVideoProcessing {
  readonly status: "completed";
  readonly transcript: Transcript;
  readonly summaryMarkdown: string;
  readonly artifactDirectory: string;
  readonly reusedTranscript: boolean;
  readonly reusedSummary: boolean;
}

export interface UnsummarizedVideoProcessing {
  readonly status: "unsummarized";
  readonly transcript: Transcript;
  readonly artifactDirectory: string;
  readonly reusedTranscript: boolean;
  readonly summaryStatus: "failed" | "cancelled";
  readonly message: string;
  readonly cause?: Error;
}

type AcquisitionFailure = Exclude<AcquisitionOutcome, { readonly status: "completed" }>;

export type VideoProcessingOutcome =
  | CompletedVideoProcessing
  | UnsummarizedVideoProcessing
  | AcquisitionFailure;

export interface TranscriptReady {
  readonly transcript: Transcript;
  readonly artifactDirectory: string;
  readonly reused: boolean;
}

export interface VideoProcessingOptions extends AcquisitionOptions {
  readonly onTranscript?: (ready: TranscriptReady) => void;
}

export interface SummaryProcessingOptions extends ProcessingStageOptions {
  readonly regenerate?: boolean;
  readonly signal?: AbortSignal;
}

export type SummaryProcessingOutcome =
  | {
      readonly status: "completed";
      readonly summaryMarkdown: string;
      readonly artifactDirectory: string;
      readonly reused: boolean;
    }
  | { readonly status: "unavailable"; readonly message: string }
  | { readonly status: "failed"; readonly message: string; readonly cause?: Error }
  | { readonly status: "cancelled"; readonly message: string };

type SummaryFailureOutcome = Extract<
  SummaryProcessingOutcome,
  { readonly status: "failed" | "cancelled" }
>;

export interface TranscriptAcquisition {
  acquire(sourceUrl: string, options?: AcquisitionOptions): Promise<AcquisitionOutcome>;
}

export type TranscriptSummarizerFactory = () => TranscriptSummarizer;

export class VideoProcessor {
  readonly acquisition: TranscriptAcquisition;
  readonly library: ArtifactLibrary;
  private readonly summarizerFactory: TranscriptSummarizerFactory;

  constructor(
    acquisition: TranscriptAcquisition,
    library: ArtifactLibrary,
    summarizerFactory: TranscriptSummarizerFactory,
  ) {
    this.acquisition = acquisition;
    this.library = library;
    this.summarizerFactory = summarizerFactory;
  }

  async process(
    sourceUrl: string,
    options: VideoProcessingOptions = {},
  ): Promise<VideoProcessingOutcome> {
    const summarizer = this.summarizerFactory();
    const acquisition = await this.acquisition.acquire(sourceUrl, options);
    if (acquisition.status !== "completed") {
      return acquisition;
    }

    options.onTranscript?.({
      transcript: acquisition.transcript,
      artifactDirectory: acquisition.artifactDirectory,
      reused: acquisition.reused,
    });
    if (signalIsAborted(options.signal)) {
      return cancelledAfterTranscript(acquisition);
    }

    if (options.refresh !== true) {
      try {
        const existingSummary = await this.library.findSummary(acquisition.transcript.video.id);
        if (signalIsAborted(options.signal)) {
          return cancelledAfterTranscript(acquisition);
        }
        if (existingSummary !== null && existingSummary.revision === acquisition.artifactRevision) {
          return {
            status: "completed",
            transcript: acquisition.transcript,
            summaryMarkdown: existingSummary.markdown,
            artifactDirectory: acquisition.artifactDirectory,
            reusedTranscript: acquisition.reused,
            reusedSummary: true,
          };
        }
      } catch (error) {
        const failure =
          error instanceof Error
            ? error
            : new Error("Summary lookup failed with an unrecognized error.");
        return unsummarizedFromError(acquisition, failure, options.signal);
      }
    }

    try {
      options.onStage?.("generating-summary");
      const summaryMarkdown = await summarizer.summarize(acquisition.transcript, options.signal);
      const storedSummary = await this.library.commitSummary(
        acquisition.transcript.video.id,
        acquisition.artifactRevision,
        summaryMarkdown,
        options.signal,
      );
      return {
        status: "completed",
        transcript: acquisition.transcript,
        summaryMarkdown: storedSummary.markdown,
        artifactDirectory: acquisition.artifactDirectory,
        reusedTranscript: acquisition.reused,
        reusedSummary: false,
      };
    } catch (error) {
      const failure =
        error instanceof Error
          ? error
          : new Error("Summary generation failed with an unrecognized error.");
      return unsummarizedFromError(acquisition, failure, options.signal);
    }
  }

  async summarize(
    videoId: string,
    options: SummaryProcessingOptions = {},
  ): Promise<SummaryProcessingOutcome> {
    const summarizer = this.summarizerFactory();
    try {
      if (signalIsAborted(options.signal)) {
        return { status: "cancelled", message: "Summary generation was cancelled." };
      }
      const storedTranscript = await this.library.findTranscript(videoId);
      if (storedTranscript === null) {
        return { status: "unavailable", message: "No completed Transcript is available." };
      }

      if (options.regenerate !== true) {
        const existingSummary = await this.library.findSummary(videoId);
        if (signalIsAborted(options.signal)) {
          return { status: "cancelled", message: "Summary generation was cancelled." };
        }
        if (existingSummary !== null && existingSummary.revision === storedTranscript.revision) {
          return {
            status: "completed",
            summaryMarkdown: existingSummary.markdown,
            artifactDirectory: existingSummary.artifactDirectory,
            reused: true,
          };
        }
      }

      options.onStage?.("generating-summary");
      const summaryMarkdown = await summarizer.summarize(
        storedTranscript.transcript,
        options.signal,
      );
      const storedSummary = await this.library.commitSummary(
        videoId,
        storedTranscript.revision,
        summaryMarkdown,
        options.signal,
      );
      return {
        status: "completed",
        summaryMarkdown: storedSummary.markdown,
        artifactDirectory: storedSummary.artifactDirectory,
        reused: false,
      };
    } catch (error) {
      const failure =
        error instanceof Error
          ? error
          : new Error("Summary generation failed with an unrecognized error.");
      return summaryFailure(failure, options.signal);
    }
  }
}

function cancelledAfterTranscript(
  acquisition: Extract<AcquisitionOutcome, { readonly status: "completed" }>,
): UnsummarizedVideoProcessing {
  return {
    status: "unsummarized",
    transcript: acquisition.transcript,
    artifactDirectory: acquisition.artifactDirectory,
    reusedTranscript: acquisition.reused,
    summaryStatus: "cancelled",
    message: "Summary generation was cancelled.",
  };
}

function unsummarizedFromError(
  acquisition: Extract<AcquisitionOutcome, { readonly status: "completed" }>,
  error: Error,
  signal?: AbortSignal,
): UnsummarizedVideoProcessing {
  const failure = summaryFailure(error, signal);
  if (failure.status === "cancelled") {
    return {
      status: "unsummarized",
      transcript: acquisition.transcript,
      artifactDirectory: acquisition.artifactDirectory,
      reusedTranscript: acquisition.reused,
      summaryStatus: "cancelled",
      message: failure.message,
    };
  }

  if (failure.status === "failed" && failure.cause !== undefined) {
    return {
      status: "unsummarized",
      transcript: acquisition.transcript,
      artifactDirectory: acquisition.artifactDirectory,
      reusedTranscript: acquisition.reused,
      summaryStatus: "failed",
      message: failure.message,
      cause: failure.cause,
    };
  }
  return {
    status: "unsummarized",
    transcript: acquisition.transcript,
    artifactDirectory: acquisition.artifactDirectory,
    reusedTranscript: acquisition.reused,
    summaryStatus: "failed",
    message: failure.message,
  };
}

function signalIsAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

function summaryFailure(error: Error, signal?: AbortSignal): SummaryFailureOutcome {
  if (signal?.aborted === true) {
    return { status: "cancelled", message: "Summary generation was cancelled." };
  }
  if (error instanceof SummaryGenerationError) {
    if (error.kind === "cancelled") {
      return { status: "cancelled", message: error.message };
    }
    return { status: "failed", message: error.message, cause: error };
  }
  if (error instanceof ArtifactLibraryError) {
    return { status: "failed", message: error.message, cause: error };
  }
  return { status: "failed", message: "Summary generation failed.", cause: error };
}
