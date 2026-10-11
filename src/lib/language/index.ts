// The language a post is written in (texts and words on images). The brand's languages are the owner's choice; a
// channel language outside them (e.g. the "sl" default of a channel made before the brand switched to English) does
// not win.
export const LANGUAGE_NAMES: Record<string, string> = { sl: "Slovenian", en: "English", de: "German", hr: "Croatian", it: "Italian" };

export function postLanguage(channelLanguage: string | null | undefined, brandLanguages: string[]): string {
  if (channelLanguage && (brandLanguages.length === 0 || brandLanguages.includes(channelLanguage))) return channelLanguage;
  return brandLanguages[0] ?? channelLanguage ?? "sl";
}

export const languageName = (code: string) => LANGUAGE_NAMES[code] ?? code;
