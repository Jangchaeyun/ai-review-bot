/** LLM 일시 오류만 재시도하고, 인증 실패는 다시 호출하지 않는지 확인한다. */
import { describe, expect, it } from "vitest";
import { createOpenAiCompatibleProvider } from "../../src/integrations/llm/openai-provider.js";
import { AppError } from "../../src/utils/app-error.js";

const API_KEY = "test-llm-key";

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  if (headers === undefined) {
    return new Response(JSON.stringify(body), { status });
  }
  return new Response(JSON.stringify(body), { status, headers });
}

describe("createOpenAiCompatibleProvider", () => {
  it("posts a chat completion and does not put the api key in the body", async () => {
    const calls: Array<{ url: string; authorization: string | null; body: string }> = [];
    const provider = createOpenAiCompatibleProvider({
      apiKey: API_KEY,
      baseUrl: "https://llm.example",
      model: "review-model",
      timeoutMs: 1000,
      sleep: async () => undefined,
      fetchImpl: async (input, init) => {
        calls.push({
          url: String(input),
          authorization: new Headers(init?.headers).get("authorization"),
          body: String(init?.body),
        });
        return jsonResponse(200, {
          id: "chatcmpl-test",
          choices: [{ index: 0, message: { role: "assistant", content: "{\"findings\":[]}" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 11, completion_tokens: 2, total_tokens: 13 },
        });
      },
    });

    const completion = await provider.complete({
      messages: [
        { role: "system", content: "system rules" },
        { role: "user", content: "diff data" },
      ],
    });

    expect(completion.content).toBe("{\"findings\":[]}");
    expect(completion.usage).toEqual({ promptTokens: 11, completionTokens: 2, totalTokens: 13 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://llm.example/v1/chat/completions");
    expect(calls[0]?.authorization).toBe(`Bearer ${API_KEY}`);
    const body = JSON.parse(calls[0]?.body ?? "{}") as { temperature: number; model: string };
    expect(body).toMatchObject({ temperature: 0, model: "review-model", response_format: { type: "json_object" } });
    expect(calls[0]?.body).not.toContain(API_KEY);
  });

  it("retries a rate limit and then reads the completion", async () => {
    let calls = 0;
    const provider = createOpenAiCompatibleProvider({
      apiKey: API_KEY,
      baseUrl: "https://llm.example",
      model: "review-model",
      timeoutMs: 1000,
      sleep: async () => undefined,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          return jsonResponse(429, { error: API_KEY }, { "retry-after": "0" });
        }
        return jsonResponse(200, { choices: [{ message: { content: "{\"findings\":[]}" } }] });
      },
    });

    await expect(provider.complete({ messages: [{ role: "user", content: "diff" }] })).resolves.toEqual({
      content: "{\"findings\":[]}",
    });
    expect(calls).toBe(2);
  });

  it("does not retry an authentication failure or follow a redirect", async () => {
    const urls: string[] = [];
    const provider = createOpenAiCompatibleProvider({
      apiKey: API_KEY,
      baseUrl: "https://llm.example",
      model: "review-model",
      timeoutMs: 1000,
      sleep: async () => undefined,
      fetchImpl: async (input) => {
        urls.push(String(input));
        if (urls.length === 1) {
          return jsonResponse(401, { error: API_KEY });
        }
        return new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } });
      },
    });

    await expect(provider.complete({ messages: [{ role: "user", content: "diff" }] })).rejects.toMatchObject({
      code: "LLM_UNAUTHORIZED",
    });

    const redirecting = createOpenAiCompatibleProvider({
      apiKey: API_KEY,
      baseUrl: "https://llm.example",
      model: "review-model",
      timeoutMs: 1000,
      sleep: async () => undefined,
      fetchImpl: async (input) => {
        urls.push(String(input));
        return new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } });
      },
    });
    await expect(redirecting.complete({ messages: [{ role: "user", content: "diff" }] })).rejects.toMatchObject({
      code: "LLM_UNEXPECTED_REDIRECT",
    });
    expect(urls.some((url) => url.includes("evil.example"))).toBe(false);
  });

  it("fails before calling the network when the api key is empty", async () => {
    let calls = 0;
    const provider = createOpenAiCompatibleProvider({
      apiKey: "",
      baseUrl: "https://llm.example",
      model: "review-model",
      timeoutMs: 1000,
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse(200, {});
      },
    });

    await expect(provider.complete({ messages: [{ role: "user", content: "diff" }] })).rejects.toBeInstanceOf(AppError);
    expect(calls).toBe(0);
  });

  it("does not include the api key in an error message", async () => {
    const provider = createOpenAiCompatibleProvider({
      apiKey: API_KEY,
      baseUrl: "https://llm.example",
      model: "review-model",
      timeoutMs: 1000,
      sleep: async () => undefined,
      fetchImpl: async () => jsonResponse(500, { error: API_KEY }),
    });

    await expect(provider.complete({ messages: [{ role: "user", content: "diff" }] })).rejects.toSatisfy((error: unknown) => {
      return error instanceof AppError && error.code === "LLM_BAD_RESPONSE" && !error.message.includes(API_KEY);
    });
  });
});
