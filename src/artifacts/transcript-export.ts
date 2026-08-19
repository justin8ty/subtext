import type { Transcript } from "../transcript/model.js";

export type TranscriptExportFormat = "markdown" | "text" | "vtt" | "srt";

export const TRANSCRIPT_EXPORT_FILENAMES = {
  markdown: "transcript.md",
  text: "transcript.txt",
  vtt: "transcript.vtt",
  srt: "transcript.srt",
} satisfies Record<TranscriptExportFormat, string>;

export function renderTranscriptExport(
  transcript: Transcript,
  format: TranscriptExportFormat,
): string {
  if (format === "markdown") {
    return renderMarkdown(transcript);
  }
  if (format === "text") {
    return `${transcript.segments
      .map((segment) => `${readableTimestamp(segment.startMs)} ${segment.text}`)
      .join("\n")}\n`;
  }
  if (format === "vtt") {
    return `WEBVTT\n\n${transcript.segments
      .map(
        (segment) =>
          `${cueTimestamp(segment.startMs, ".")} --> ${cueTimestamp(segment.endMs, ".")}\n${segment.text}`,
      )
      .join("\n\n")}\n`;
  }
  return `${transcript.segments
    .map(
      (segment, index) =>
        `${(index + 1).toString()}\n${cueTimestamp(segment.startMs, ",")} --> ${cueTimestamp(segment.endMs, ",")}\n${segment.text}`,
    )
    .join("\n\n")}\n`;
}

function renderMarkdown(transcript: Transcript): string {
  const segments = transcript.segments.map((segment) => {
    const seconds = Math.floor(segment.startMs / 1_000);
    const separator = transcript.video.canonicalUrl.includes("?") ? "&" : "?";
    return `- [${readableTimestamp(segment.startMs).slice(1, -1)}](${transcript.video.canonicalUrl}${separator}t=${seconds.toString()}s) ${segment.text}`;
  });
  return `# ${transcript.video.title}\n\n[Source Video](${transcript.video.canonicalUrl})\n\n${segments.join("\n")}\n`;
}

function readableTimestamp(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const minuteSecond = `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  return hours === 0
    ? `[${minuteSecond}]`
    : `[${hours.toString().padStart(2, "0")}:${minuteSecond}]`;
}

function cueTimestamp(milliseconds: number, decimalSeparator: "." | ","): string {
  const bounded = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(bounded / 3_600_000);
  const minutes = Math.floor((bounded % 3_600_000) / 60_000);
  const seconds = Math.floor((bounded % 60_000) / 1_000);
  const millis = bounded % 1_000;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}${decimalSeparator}${millis.toString().padStart(3, "0")}`;
}
