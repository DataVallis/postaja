// Test double for the LLM adapter: replays queued answers and records every request (never calls a provider).
import { LlmError, type LlmClient, type StructuredRequest, type Usage } from "./types";

export type FakeAnswer = { input: unknown; usage?: Partial<Usage> } | { error: LlmError };

export function createFakeLlm(answers: FakeAnswer[] = []) {
  const requests: StructuredRequest[] = [];
  const queue = [...answers];
  const client: LlmClient = {
    async structured(req) {
      requests.push(req);
      const next = queue.shift();
      if (!next) throw new Error("FakeLlm: no answer queued");
      if ("error" in next) throw next.error;
      return { input: next.input, usage: { inputTokens: 1000, outputTokens: 200, cacheWriteTokens: 0, cacheReadTokens: 0, ...next.usage } };
    },
  };
  return { client, requests, queue };
}
