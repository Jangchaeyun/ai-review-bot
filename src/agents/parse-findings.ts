import { ZodError } from "zod";
import { agentResponseSchema, reviewFindingSchema, type FindingCategory, type ReviewFinding } from "../schemas/review-finding.schema.js";
import { AppError } from "../utils/app-error.js";

export type ParsedFindings = {
  findings: ReviewFinding[];
  droppedCount: number;
};

function unwrapJson(content: string): string {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return fenced?.[1] ?? trimmed;
}

export function parseFindings(content: string, category: FindingCategory): ParsedFindings {
  let parsed: unknown;
  try {
    parsed = JSON.parse(unwrapJson(content));
  } catch (error) {
    throw new AppError({
      message: "LLM 응답을 JSON으로 읽지 못했습니다.",
      code: "LLM_BAD_RESPONSE",
      statusCode: 502,
      expose: false,
      cause: error,
    });
  }

  const envelope = agentResponseSchema.safeParse(parsed);
  if (!envelope.success) {
    throw new AppError({
      message: "LLM 응답 형식이 올바르지 않습니다.",
      code: "LLM_BAD_RESPONSE",
      statusCode: 502,
      expose: false,
      cause: new ZodError(envelope.error.issues),
    });
  }

  const findings: ReviewFinding[] = [];
  let droppedCount = 0;
  for (const item of envelope.data.findings) {
    const finding = reviewFindingSchema.safeParse(item);
    if (!finding.success || finding.data.category !== category || finding.data.lineStart > finding.data.lineEnd) {
      droppedCount += 1;
      continue;
    }
    findings.push(finding.data);
  }

  return { findings, droppedCount };
}
