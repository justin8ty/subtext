import type {
  CaptionTrack,
  CaptionTrackOrigin,
  InspectedSourceVideo,
} from "../youtube/youtube-adapter.js";

export type CaptionSelection =
  | { readonly status: "selected"; readonly track: CaptionTrack; readonly languageCode: string }
  | { readonly status: "no-spoken-language" }
  | { readonly status: "no-eligible-caption"; readonly languageCode: string };

export function selectEligibleCaption(video: InspectedSourceVideo): CaptionSelection {
  const languageCode = findSpokenLanguage(video);
  if (languageCode === null) {
    return { status: "no-spoken-language" };
  }

  const creatorTrack = findTrack(video.captionTracks, "creator-caption", languageCode);
  if (creatorTrack !== null) {
    return {
      status: "selected",
      track: creatorTrack,
      languageCode: normalizeLanguageCode(languageCode),
    };
  }

  const automaticTrack = findTrack(video.captionTracks, "automatic-caption", languageCode);
  if (automaticTrack !== null) {
    return {
      status: "selected",
      track: automaticTrack,
      languageCode: normalizeLanguageCode(languageCode),
    };
  }

  return { status: "no-eligible-caption", languageCode: normalizeLanguageCode(languageCode) };
}

function findSpokenLanguage(video: InspectedSourceVideo): string | null {
  if (video.spokenLanguage !== undefined && video.spokenLanguage.trim() !== "") {
    return video.spokenLanguage;
  }

  const originalTrack = video.captionTracks.find(
    (track) =>
      track.origin === "automatic-caption" && track.languageCode.toLowerCase().endsWith("-orig"),
  );
  return originalTrack?.languageCode ?? null;
}

function findTrack(
  tracks: readonly CaptionTrack[],
  origin: CaptionTrackOrigin,
  spokenLanguage: string,
): CaptionTrack | null {
  const normalizedSpokenLanguage = normalizeLanguageCode(spokenLanguage);
  const eligible = tracks.filter(
    (track) =>
      track.origin === origin &&
      normalizeLanguageCode(track.languageCode) === normalizedSpokenLanguage,
  );
  return (
    eligible.find((track) => track.languageCode.toLowerCase().endsWith("-orig")) ??
    eligible[0] ??
    null
  );
}

export function normalizeLanguageCode(languageCode: string): string {
  const withoutOriginalMarker = languageCode.toLowerCase().replace(/-orig$/, "");
  const [primary] = withoutOriginalMarker.split("-");
  return primary ?? withoutOriginalMarker;
}
