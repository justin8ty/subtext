export type CaptionTrackOrigin = "creator-caption" | "automatic-caption";

export interface CaptionTrack {
  readonly origin: CaptionTrackOrigin;
  readonly languageCode: string;
  readonly name?: string;
  readonly format: "json3";
  readonly url: string;
}

export interface InspectedSourceVideo {
  readonly id: string;
  readonly title: string;
  readonly canonicalUrl: string;
  readonly durationMs: number;
  readonly spokenLanguage?: string;
  readonly liveStatus?: string;
  readonly availability?: string;
  readonly captionTracks: readonly CaptionTrack[];
}

export type YoutubeAdapterErrorKind = "blocked" | "unavailable" | "failed" | "cancelled";

export class YoutubeAdapterError extends Error {
  readonly kind: YoutubeAdapterErrorKind;

  constructor(kind: YoutubeAdapterErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "YoutubeAdapterError";
    this.kind = kind;
  }
}

export interface YoutubeAdapter {
  inspect(canonicalUrl: string, signal?: AbortSignal): Promise<InspectedSourceVideo>;
  downloadCaption(track: CaptionTrack, signal?: AbortSignal): Promise<string>;
  downloadDefaultAudio(
    canonicalUrl: string,
    destinationPath: string,
    signal?: AbortSignal,
  ): Promise<void>;
}
