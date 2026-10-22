export const REVIEW_LANGUAGES = ["ko", "en"] as const;

export type ReviewLanguage = (typeof REVIEW_LANGUAGES)[number];

export function reviewLanguageFrom(value: unknown): ReviewLanguage {
  return value === "en" ? "en" : "ko";
}
