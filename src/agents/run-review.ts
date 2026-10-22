import type { Logger } from "pino";
import { addLlmUsage, EMPTY_LLM_USAGE, type LlmUsage } from "../integrations/llm/llm-provider.js";
import { AppError } from "../utils/app-error.js";
import { aggregateFindings, type AggregatedFinding, type SourcedFinding } from "./aggregate-findings.js";
import type { AgentResult, ReviewAgent, ReviewAgentInput } from "./review-agent.js";

export type AgentReport =
  | {
      id: ReviewAgent["id"];
      status: "completed";
      findingCount: number;
      droppedCount: number;
      partial: boolean;
    }
  | {
      id: ReviewAgent["id"];
      status: "failed";
      code: string;
      findingCount: number;
      droppedCount: number;
    };

export type ReviewRunResult =
  | {
      status: "completed";
      partialFailure: boolean;
      findings: AggregatedFinding[];
      agents: AgentReport[];
      usage: LlmUsage;
    }
  | {
      status: "failed";
      code: "ALL_AGENTS_FAILED";
      agents: AgentReport[];
      usage: LlmUsage;
    };

export type ReviewRunner = {
  run(input: ReviewAgentInput): Promise<ReviewRunResult>;
};

function toReport(id: ReviewAgent["id"], result: AgentResult): AgentReport {
  if (result.status === "failed") {
    return {
      id,
      status: "failed",
      code: result.code,
      findingCount: 0,
      droppedCount: result.droppedCount,
    };
  }
  return {
    id,
    status: "completed",
    findingCount: result.findings.length,
    droppedCount: result.droppedCount,
    partial: result.partial,
  };
}

export function createReviewRunner(agents: readonly ReviewAgent[], logger: Logger): ReviewRunner {
  return {
    async run(input: ReviewAgentInput): Promise<ReviewRunResult> {
      const results = await Promise.all(
        agents.map(async (agent) => {
          try {
            return { id: agent.id, result: await agent.run(input) };
          } catch (error) {
            const code = error instanceof AppError ? error.code : "AGENT_FAILED";
            const result: AgentResult = { status: "failed", code, droppedCount: 0 };
            return { id: agent.id, result };
          }
        }),
      );
      const agentsReport = results.map((item) => toReport(item.id, item.result));
      const usage = results.reduce((sum, item) => addLlmUsage(sum, item.result.usage), EMPTY_LLM_USAGE);
      const succeeded = results.filter((item) => item.result.status === "completed");

      if (succeeded.length === 0) {
        logger.error({
          outcome: "review-agents-failed",
          agents: agentsReport.map((agent) => ({ id: agent.id, status: agent.status, code: agent.status === "failed" ? agent.code : "" })),
        });
        return { status: "failed", code: "ALL_AGENTS_FAILED", agents: agentsReport, usage };
      }

      const sourced: SourcedFinding[] = [];
      for (const item of succeeded) {
        if (item.result.status !== "completed") {
          continue;
        }
        for (const finding of item.result.findings) {
          sourced.push({ ...finding, source: item.id });
        }
      }

      const findings = aggregateFindings(sourced);
      const partialFailure = agentsReport.some((agent) => agent.status === "failed" || (agent.status === "completed" && agent.partial));
      logger.info({
        outcome: "review-agents-completed",
        partialFailure,
        findingCount: findings.length,
        agents: agentsReport.map((agent) =>
          agent.status === "failed"
            ? { id: agent.id, status: agent.status, code: agent.code }
            : { id: agent.id, status: agent.status, findingCount: agent.findingCount, partial: agent.partial },
        ),
      });

      return { status: "completed", partialFailure, findings, agents: agentsReport, usage };
    },
  };
}
