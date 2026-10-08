// Token → money (ADR-015/036). Integer micro-USD only; every component rounds up so we never under-count.
import type { Usage } from "./types";

export type Prices = { inputPerMtok: bigint; outputPerMtok: bigint; cacheWritePerMtok: bigint; cacheReadPerMtok: bigint };

const part = (tokens: number, perMtok: bigint) => {
  if (!Number.isInteger(tokens) || tokens < 0) throw new Error("BAD_TOKENS");
  const n = BigInt(tokens) * perMtok;
  return (n + 999_999n) / 1_000_000n; // ceil
};

/** Anthropic web search: $10 per 1,000 searches (TASK-049). */
export const WEB_SEARCH_MICRO_USD = 10_000n;

export function costMicroUsd(u: Usage, p: Prices): bigint {
  return part(u.inputTokens, p.inputPerMtok) + part(u.outputTokens, p.outputPerMtok) + part(u.cacheWriteTokens, p.cacheWritePerMtok) + part(u.cacheReadTokens, p.cacheReadPerMtok)
    + BigInt(u.webSearches ?? 0) * WEB_SEARCH_MICRO_USD;
}

/** Rough token count for a budget estimate: 1 token per 3 characters (conservative for Slovenian), never below 1. */
export const estimateTokens = (text: string) => Math.max(1, Math.ceil(text.length / 3));

/** Worst case for the cap check: all input billed as a cache write (the dearest input), full max_tokens of output. */
export function worstCaseMicroUsd(inputChars: number, maxTokens: number, p: Prices): bigint {
  const input = Math.max(1, Math.ceil(inputChars / 3));
  const inputPrice = p.cacheWritePerMtok > p.inputPerMtok ? p.cacheWritePerMtok : p.inputPerMtok;
  return part(input, inputPrice) + part(maxTokens, p.outputPerMtok);
}
