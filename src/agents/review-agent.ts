/**
 * 품질, 보안, 성능 에이전트. 파일을 쓰거나 명령을 실행하지 않고, 이미 모은 diff만 모델에 보낸다.
 * 일부 청크가 실패해도 성공한 청크의 발견은 남긴다.
 */
import { addLlmUsage, EMPTY_LLM_USAGE, type LlmProvider, type LlmUsage } from "../integrations/llm/llm-provider.js";
import { AppError } from "../utils/app-error.js";
import { chunkReviewFiles } from "./chunk-files.js";
import { filterFindings, type ReviewFile } from "./filter-findings.js";
import { parseFindings } from "./parse-findings.js";
import {
  buildUserMessage,
  PERFORMANCE_SYSTEM_PROMPT,
  QUALITY_SYSTEM_PROMPT,
  reviewLanguageRule,
  SECURITY_SYSTEM_PROMPT,
} from "./review-prompts.js";
import { reviewLanguageFrom, type ReviewLanguage } from "../services/review-language.js";
import type { AgentId, ReviewFinding } from "../schemas/review-finding.schema.js";

export type ReviewAgentInput = {
  title?: string;
  files: readonly ReviewFile[];
  language?: ReviewLanguage;
};

export type AgentResult =
  | {
      status: "completed";
      findings: ReviewFinding[];
      droppedCount: number;
      partial: boolean;
      usage?: LlmUsage;
    }
  | {
      status: "failed";
      code: string;
      droppedCount: number;
      usage?: LlmUsage;
    };

export type ReviewAgent = {
  id: AgentId;
  run(input: ReviewAgentInput): Promise<AgentResult>;
};

const PROMPTS: Record<AgentId, string> = {
  quality: QUALITY_SYSTEM_PROMPT,
  security: SECURITY_SYSTEM_PROMPT,
  performance: PERFORMANCE_SYSTEM_PROMPT,
};

function failureCode(error: unknown): string {
  if (error instanceof AppError) {
    return error.code;
  }
  return "LLM_BAD_RESPONSE";
}

export function createReviewAgent(id: AgentId, provider: LlmProvider, maxInputChars: number): ReviewAgent {
  return {
    id,
    async run(input: ReviewAgentInput): Promise<AgentResult> {
      if (input.files.length === 0) {
        return { status: "completed", findings: [], droppedCount: 0, partial: false, usage: EMPTY_LLM_USAGE };
      }

      const language = reviewLanguageFrom(input.language);
      const systemPrompt = `${PROMPTS[id]}\n${reviewLanguageRule(language)}`;
      const findings: ReviewFinding[] = [];
      let droppedCount = 0;
      let failedChunks = 0;
      let lastCode = "LLM_BAD_RESPONSE";
      let usage: LlmUsage = EMPTY_LLM_USAGE;
      const chunks = chunkReviewFiles(input.files, maxInputChars);

      for (const chunk of chunks) {
        try {
          const completion = await provider.complete({
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: buildUserMessage(input.title, chunk) },
            ],
          });
          usage = addLlmUsage(usage, completion.usage);
          const parsed = parseFindings(completion.content, id);
          const filtered = filterFindings(parsed.findings, chunk, language);
          findings.push(...filtered.accepted);
          droppedCount += parsed.droppedCount + filtered.droppedCount;
        } catch (error) {
          failedChunks += 1;
          lastCode = failureCode(error);
        }
      }

      if (failedChunks === chunks.length) {
        return { status: "failed", code: lastCode, droppedCount, usage };
      }

      return {
        status: "completed",
        findings,
        droppedCount,
        partial: failedChunks > 0,
        usage,
      };
    },
  };
}

export function createReviewAgents(provider: LlmProvider, maxInputChars: number): ReviewAgent[] {
  return [
    createReviewAgent("quality", provider, maxInputChars),
    createReviewAgent("security", provider, maxInputChars),
    createReviewAgent("performance", provider, maxInputChars),
  ];
}
