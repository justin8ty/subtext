export type ProcessingStage =
  | "inspecting-video"
  | "preparing-caption-transcript"
  | "no-eligible-caption"
  | "switching-to-asr"
  | "downloading-default-audio"
  | "preparing-runtime"
  | "transcribing-whisper"
  | "generating-summary";

export interface ProcessingStageOptions {
  readonly onStage?: (stage: ProcessingStage) => void;
}
