export const locales = ["sl", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "sl";
export const LOCALE_COOKIE = "NEXT_LOCALE";

export function resolveLocale(value: string | undefined): Locale {
  return locales.find((l) => l === value) ?? defaultLocale;
}
