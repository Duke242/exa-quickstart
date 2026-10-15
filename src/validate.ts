import { Exa } from "exa-js";

export type KeyProblem = "invalid_key" | "out_of_credits" | "rate_limited" | "network" | "unknown";

export type ValidationResult =
  | { ok: true; latencyMs: number; sampleTitle: string | null; sampleUrl: string | null }
  | { ok: false; problem: KeyProblem; message: string; fix: string };

/** The one method validation needs, so tests can pass a fake instead of calling the API. */
export interface SearchClient {
  search(query: string, options: { numResults: number; type: "auto" }): Promise<{ results: { title?: string | null; url: string }[] }>;
}

const FIXES: Record<KeyProblem, string> = {
  invalid_key: "Create or copy a key at https://dashboard.exa.ai/api-keys and set EXA_API_KEY.",
  out_of_credits: "Add credits or a payment method at https://dashboard.exa.ai/billing, then run again.",
  rate_limited: "Wait a few seconds and run again.",
  network: "Check your internet connection or proxy settings, then run again.",
  unknown: "Run again with --json and include the output when asking for help.",
};

export function classifyError(error: unknown): KeyProblem {
  const status = (error as { statusCode?: number; status?: number })?.statusCode ?? (error as { status?: number })?.status;
  if (status === 401 || status === 403) return "invalid_key";
  if (status === 402) return "out_of_credits";
  if (status === 429) return "rate_limited";
  const code = (error as { code?: string; cause?: { code?: string } })?.code ?? (error as { cause?: { code?: string } })?.cause?.code;
  if (code && ["ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"].includes(code)) return "network";
  if (error instanceof TypeError && /fetch failed/i.test(error.message)) return "network";
  return "unknown";
}

/** Proves the key works with one real, minimal search: one result, no contents. */
export async function validateKey(key: string, client: SearchClient = new Exa(key) as unknown as SearchClient): Promise<ValidationResult> {
  const started = performance.now();
  try {
    const { results } = await client.search("Exa search API documentation", { numResults: 1, type: "auto" });
    const first = results[0];
    return {
      ok: true,
      latencyMs: Math.round(performance.now() - started),
      sampleTitle: first?.title ?? null,
      sampleUrl: first?.url ?? null,
    };
  } catch (error) {
    const problem = classifyError(error);
    return { ok: false, problem, message: error instanceof Error ? error.message : String(error), fix: FIXES[problem] };
  }
}
