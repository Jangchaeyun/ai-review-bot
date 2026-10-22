/**
 * 리뷰 댓글 언어. 콘솔에서 고르지 않거나 알 수 없는 값은 한국어로 둔다.
 * Webhook으로 들어온 작업은 언어가 없으므로 파이프라인이 ko로 처리한다.
 */
export const REVIEW_LANGUAGES = ["ko", "en"] as const;

export type ReviewLanguage = (typeof REVIEW_LANGUAGES)[number];

/** 알 수 없는 값은 한국어로 좁힌다. 저장된 작업에 언어가 없어도 호출부가 en을 추측하지 않는다. */
export function reviewLanguageFrom(value: unknown): ReviewLanguage {
  return value === "en" ? "en" : "ko";
}
