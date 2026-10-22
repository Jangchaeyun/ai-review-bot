export type LlmMessage = {
  role: "system" | "user";
  content: string;
};

export type LlmCompletionRequest = {
  messages: readonly LlmMessage[];
  signal?: AbortSignal;
};

export type LlmUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export const EMPTY_LLM_USAGE: LlmUsage = Object.freeze({
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
});

export function addLlmUsage(left: LlmUsage, right: LlmUsage | undefined): LlmUsage {
  if (right === undefined) {
    return left;
  }
  return {
    promptTokens: left.promptTokens + right.promptTokens,
    completionTokens: left.completionTokens + right.completionTokens,
    totalTokens: left.totalTokens + right.totalTokens,
  };
}

export type LlmCompletion = {
  content: string;
  usage?: LlmUsage;
};

export type LlmProvider = {
  complete(request: LlmCompletionRequest): Promise<LlmCompletion>;
};
