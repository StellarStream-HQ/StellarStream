import errorDictionary from "./error-dictionary.json" assert { type: "json" };

export type SupportedLanguage = "en" | "ar" | "fr" | "es";

const FALLBACK_LANGUAGE: SupportedLanguage = "en";
const SUPPORTED_LANGUAGES: SupportedLanguage[] = ["en", "ar", "fr", "es"];

type ErrorDictionary = Record<string, Record<SupportedLanguage, string>>;

const dictionary = errorDictionary as ErrorDictionary;

export function resolvePreferredLanguage(
  acceptLanguageHeader: string | string[] | undefined,
): SupportedLanguage {
  const headerValue = Array.isArray(acceptLanguageHeader)
    ? acceptLanguageHeader.join(",")
    : acceptLanguageHeader;

  if (!headerValue) {
    return FALLBACK_LANGUAGE;
  }

  const candidates = headerValue
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const [tag, qualityPart] = entry.split(";");
      const quality = qualityPart?.startsWith("q=")
        ? Number.parseFloat(qualityPart.slice(2))
        : 1;

      return {
        tag: (tag ?? "").toLowerCase(),
        quality: Number.isFinite(quality) ? quality : 0,
      };
    })
    .sort((left, right) => right.quality - left.quality);

  for (const candidate of candidates) {
    const baseLanguage = candidate.tag.split("-")[0] as SupportedLanguage;
    if (SUPPORTED_LANGUAGES.includes(baseLanguage)) {
      return baseLanguage;
    }
  }

  return FALLBACK_LANGUAGE;
}

export function translateErrorMessage(
  errorCode: string | undefined,
  acceptLanguageHeader: string | string[] | undefined,
  fallbackMessage: string,
): string {
  if (!errorCode) {
    return fallbackMessage;
  }

  const translations = dictionary[errorCode];
  if (!translations) {
    return fallbackMessage;
  }

  const preferredLanguage = resolvePreferredLanguage(acceptLanguageHeader);
  return (
    translations[preferredLanguage] ??
    translations[FALLBACK_LANGUAGE] ??
    fallbackMessage
  );
}
