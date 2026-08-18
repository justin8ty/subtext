export { ArtifactLibrary, ArtifactLibraryError } from "./artifacts/artifact-library.js";
export {
  TranscriptAcquirer,
  type AcquisitionOptions,
  type AcquisitionOutcome,
} from "./acquisition/acquire-transcript.js";
export { parseYoutubeUrl, type YoutubeUrlResult } from "./source-video/youtube-url.js";
export {
  CAPTION_TRACK_ARTIFACT_FILENAME,
  TRANSCRIPT_SCHEMA_VERSION,
  type CaptionProvenance,
  type SourceVideoRecord,
  type Transcript,
  type TranscriptProvenance,
  type TranscriptSegment,
} from "./transcript/model.js";
export {
  type CaptionTrack,
  type CaptionTrackOrigin,
  type InspectedSourceVideo,
  type YoutubeAdapter,
  YoutubeAdapterError,
  type YoutubeAdapterErrorKind,
} from "./youtube/youtube-adapter.js";
export { YtDlpYoutubeAdapter } from "./youtube/yt-dlp-adapter.js";
