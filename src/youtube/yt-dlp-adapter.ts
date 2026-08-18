import { spawn } from "node:child_process";

import type {
  CaptionTrack,
  CaptionTrackOrigin,
  InspectedSourceVideo,
  YoutubeAdapter,
} from "./youtube-adapter.js";
import { YoutubeAdapterError } from "./youtube-adapter.js";

const MAX_METADATA_BYTES = 32 * 1024 * 1024;

interface YtDlpCaptionFormat {
  readonly ext?: string;
  readonly url?: string;
  readonly name?: string;
}

type YtDlpCaptionTracks = Record<string, readonly YtDlpCaptionFormat[]>;

interface YtDlpMetadata {
  readonly id?: string;
  readonly title?: string;
  readonly webpage_url?: string;
  readonly duration?: number;
  readonly language?: string | null;
  readonly live_status?: string;
  readonly is_live?: boolean;
  readonly availability?: string;
  readonly subtitles?: YtDlpCaptionTracks;
  readonly automatic_captions?: YtDlpCaptionTracks;
}

interface ProcessResult {
  readonly stdout: string;
  readonly stderr: string;
}

interface MutableInspectedSourceVideo {
  id: string;
  title: string;
  canonicalUrl: string;
  durationMs: number;
  captionTracks: readonly CaptionTrack[];
  spokenLanguage?: string;
  liveStatus?: string;
  availability?: string;
}

export class YtDlpYoutubeAdapter implements YoutubeAdapter {
  readonly executable: string;

  constructor(executable = "yt-dlp") {
    this.executable = executable;
  }

  async inspect(canonicalUrl: string, signal?: AbortSignal): Promise<InspectedSourceVideo> {
    const result = await runProcess(
      this.executable,
      ["--dump-single-json", "--skip-download", "--no-playlist", "--no-warnings", canonicalUrl],
      signal,
    );

    let metadata: YtDlpMetadata;
    try {
      metadata = JSON.parse(result.stdout);
    } catch (error) {
      throw new YoutubeAdapterError("failed", "yt-dlp returned invalid Source Video metadata.", {
        cause: error,
      });
    }

    if (
      metadata.id === undefined ||
      metadata.title === undefined ||
      metadata.duration === undefined ||
      !Number.isFinite(metadata.duration) ||
      metadata.duration <= 0
    ) {
      throw new YoutubeAdapterError(
        "unavailable",
        "yt-dlp did not return complete Source Video metadata.",
      );
    }

    const captionTracks = [
      ...decodeCaptionTracks(metadata.subtitles, "creator-caption"),
      ...decodeCaptionTracks(metadata.automatic_captions, "automatic-caption"),
    ];
    const baseVideo = {
      id: metadata.id,
      title: metadata.title,
      canonicalUrl: `https://www.youtube.com/watch?v=${metadata.id}`,
      durationMs: Math.round(metadata.duration * 1_000),
      captionTracks,
    };

    return addOptionalMetadata(baseVideo, metadata);
  }

  async downloadCaption(track: CaptionTrack, signal?: AbortSignal): Promise<string> {
    let response: Response;
    try {
      response = await fetch(track.url, signal === undefined ? undefined : { signal });
    } catch (error) {
      if (signal?.aborted === true) {
        throw new YoutubeAdapterError("cancelled", "Caption Track download was cancelled.", {
          cause: error,
        });
      }
      throw new YoutubeAdapterError("failed", "Could not download the selected Caption Track.", {
        cause: error,
      });
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403 || response.status === 429) {
        throw new YoutubeAdapterError(
          "blocked",
          `YouTube blocked the Caption Track download (${response.status}).`,
        );
      }
      if (response.status === 404 || response.status === 410) {
        throw new YoutubeAdapterError(
          "unavailable",
          "The selected Caption Track is no longer available.",
        );
      }
      throw new YoutubeAdapterError(
        "failed",
        `Caption Track download failed with HTTP ${response.status}.`,
      );
    }

    return response.text();
  }
}

function decodeCaptionTracks(
  tracks: YtDlpCaptionTracks | undefined,
  origin: CaptionTrackOrigin,
): CaptionTrack[] {
  if (tracks === undefined) {
    return [];
  }

  const decoded: CaptionTrack[] = [];
  for (const [languageCode, formats] of Object.entries(tracks)) {
    const json3 = formats.find((format) => format.ext === "json3" && format.url !== undefined);
    if (json3?.url === undefined) {
      continue;
    }

    if (json3.name === undefined) {
      decoded.push({ origin, languageCode, format: "json3", url: json3.url });
    } else {
      decoded.push({ origin, languageCode, name: json3.name, format: "json3", url: json3.url });
    }
  }
  return decoded;
}

function addOptionalMetadata(
  baseVideo: Omit<InspectedSourceVideo, "spokenLanguage" | "liveStatus" | "availability">,
  metadata: YtDlpMetadata,
): InspectedSourceVideo {
  const video: MutableInspectedSourceVideo = { ...baseVideo };

  if (
    metadata.language !== undefined &&
    metadata.language !== null &&
    metadata.language.trim() !== ""
  ) {
    video.spokenLanguage = metadata.language;
  }
  if (metadata.live_status !== undefined) {
    video.liveStatus = metadata.live_status;
  }
  if (metadata.availability !== undefined) {
    video.availability = metadata.availability;
  }
  return video;
}

function runProcess(
  executable: string,
  arguments_: readonly string[],
  signal?: AbortSignal,
): Promise<ProcessResult> {
  if (signal?.aborted === true) {
    return Promise.reject(
      new YoutubeAdapterError("cancelled", "Source Video inspection was cancelled."),
    );
  }

  return new Promise((resolve, reject) => {
    const child = spawn(executable, arguments_, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let completed = false;

    const abort = (): void => {
      child.kill();
    };
    signal?.addEventListener("abort", abort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_METADATA_BYTES) {
        child.kill();
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

    child.on("error", (error) => {
      if (completed) {
        return;
      }
      completed = true;
      signal?.removeEventListener("abort", abort);
      reject(new YoutubeAdapterError("failed", `Could not start ${executable}.`, { cause: error }));
    });

    child.on("close", (exitCode) => {
      if (completed) {
        return;
      }
      completed = true;
      signal?.removeEventListener("abort", abort);

      if (signal?.aborted === true) {
        reject(new YoutubeAdapterError("cancelled", "Source Video inspection was cancelled."));
        return;
      }
      if (outputBytes > MAX_METADATA_BYTES) {
        reject(
          new YoutubeAdapterError(
            "failed",
            "yt-dlp returned more metadata than Subtext can safely process.",
          ),
        );
        return;
      }

      const stdoutText = Buffer.concat(stdout).toString("utf8");
      const stderrText = Buffer.concat(stderr).toString("utf8");
      if (exitCode !== 0) {
        reject(classifyProcessFailure(stderrText, exitCode));
        return;
      }
      resolve({ stdout: stdoutText, stderr: stderrText });
    });
  });
}

function classifyProcessFailure(stderr: string, exitCode: number | null): YoutubeAdapterError {
  const diagnostic = stderr.trim();
  const lowerDiagnostic = diagnostic.toLowerCase();
  if (
    lowerDiagnostic.includes("sign in to confirm") ||
    lowerDiagnostic.includes("http error 403") ||
    lowerDiagnostic.includes("too many requests") ||
    lowerDiagnostic.includes("not a bot")
  ) {
    return new YoutubeAdapterError(
      "blocked",
      diagnostic || "YouTube blocked Source Video inspection.",
    );
  }
  if (
    lowerDiagnostic.includes("private video") ||
    lowerDiagnostic.includes("video unavailable") ||
    lowerDiagnostic.includes("removed") ||
    lowerDiagnostic.includes("members-only")
  ) {
    return new YoutubeAdapterError("unavailable", diagnostic || "The Source Video is unavailable.");
  }
  return new YoutubeAdapterError(
    "failed",
    diagnostic || `yt-dlp exited with code ${exitCode ?? "unknown"}.`,
  );
}
