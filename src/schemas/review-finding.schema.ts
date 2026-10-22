/**
 * 에이전트가 돌려줘야 하는 발견 형식. 심각도와 카테고리는 이 목록 밖을 허용하지 않는다.
 */
import { z } from "zod";

export const AGENT_IDS = ["quality", "security", "performance"] as const;
export const FINDING_CATEGORIES = AGENT_IDS;
export const SEVERITIES = ["critical", "high", "medium", "low"] as const;

export type AgentId = (typeof AGENT_IDS)[number];
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];
export type Severity = (typeof SEVERITIES)[number];

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

function boundedText(maxLength: number) {
  return z
    .string()
    .transform((value) => value.replace(CONTROL_CHARS, "").trim())
    .pipe(z.string().min(1).max(maxLength));
}

export const reviewFindingSchema = z
  .object({
    category: z.enum(FINDING_CATEGORIES),
    severity: z.enum(SEVERITIES),
    title: boundedText(120),
    filePath: boundedText(1024),
    lineStart: z.coerce.number().int().positive().max(1_000_000),
    lineEnd: z.coerce.number().int().positive().max(1_000_000),
    evidence: z
      .string()
      .transform((value) => value.replace(CONTROL_CHARS, "").trim())
      .pipe(z.string().min(6).max(500)),
    explanation: boundedText(1000),
    suggestion: boundedText(1000),
    confidence: z.coerce.number().min(0).max(1),
  });

export const agentResponseSchema = z.object({
  findings: z.array(z.unknown()).max(30),
});

export type ReviewFinding = z.infer<typeof reviewFindingSchema>;
