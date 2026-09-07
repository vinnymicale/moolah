/**
 * Model selection for the AI assistant.
 *
 * Providers retire model IDs on their own schedule - calling a retired one
 * fails at request time (Gemini answers 404), which is invisible until someone
 * opens the chat. Keeping the IDs here means a retirement is a one-line change,
 * and the env override lets a self-hosted instance move off a dead model
 * without waiting on a release.
 *
 * Precedence: user setting > env override > default below.
 */

export const AI_PROVIDERS = ["anthropic", "openai", "gemini"] as const;

export type AiProvider = (typeof AI_PROVIDERS)[number];

export function isAiProvider(value: string): value is AiProvider {
  return (AI_PROVIDERS as readonly string[]).includes(value);
}

const DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: "claude-haiku-4-5-20251001",
  openai: "gpt-4o-mini",
  gemini: "gemini-2.5-flash",
};

const ENV_OVERRIDES: Record<AiProvider, string> = {
  anthropic: "ANTHROPIC_MODEL",
  openai: "OPENAI_MODEL",
  gemini: "GEMINI_MODEL",
};

/**
 * Suggested models per provider, shown in Settings. Not a whitelist: a user can
 * type any model string, so a newly released model works without a code change.
 */
export const MODEL_SUGGESTIONS: Record<AiProvider, { value: string; label: string }[]> = {
  anthropic: [
    { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5 — fastest, cheapest" },
    { value: "claude-sonnet-5", label: "Sonnet 5 — balanced" },
    { value: "claude-opus-5", label: "Opus 5 — most capable" },
  ],
  openai: [
    { value: "gpt-4o-mini", label: "GPT-4o mini — fastest, cheapest" },
    { value: "gpt-4o", label: "GPT-4o — balanced" },
  ],
  gemini: [
    { value: "gemini-2.5-flash", label: "2.5 Flash — free tier" },
    { value: "gemini-2.5-flash-lite", label: "2.5 Flash-Lite — free tier, fastest" },
    { value: "gemini-2.5-pro", label: "2.5 Pro — most capable" },
  ],
};

export function resolveModel(provider: AiProvider, userModel?: string | null): string {
  const configured = userModel?.trim();
  if (configured) return configured;
  const fromEnv = process.env[ENV_OVERRIDES[provider]]?.trim();
  if (fromEnv) return fromEnv;
  return DEFAULT_MODELS[provider];
}

export function defaultModel(provider: AiProvider): string {
  return DEFAULT_MODELS[provider];
}
