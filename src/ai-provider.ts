import type { AiConfig } from "./services/ai.service";

export type AiProvider = "gemini" | "huggingface";

export interface AiProviderEnv {
  AI_PROVIDER?: string;
  GEMINI_API_KEY?: string;
  GEMINI_BASE_URL?: string;
  GEMINI_MODEL?: string;
  GEMINI_REASONING_EFFORT?: string;
  HF_TOKEN?: string;
  HF_BASE_URL?: string;
  HF_MODEL?: string;
  SYSTEM_PROMPT: string;
}

export interface ResolvedAiConfig extends AiConfig {
  provider: AiProvider;
}

export function resolveAiConfig(env: AiProviderEnv): ResolvedAiConfig {
  const provider = env.AI_PROVIDER?.trim().toLowerCase() || "gemini";
  if (provider !== "gemini" && provider !== "huggingface") {
    throw new Error(
      "AI_PROVIDER must be either 'gemini' or 'huggingface'",
    );
  }

  if (provider === "gemini") {
    return {
      provider,
      baseUrl: required(env.GEMINI_BASE_URL, "GEMINI_BASE_URL"),
      token: required(env.GEMINI_API_KEY, "GEMINI_API_KEY"),
      model: required(env.GEMINI_MODEL, "GEMINI_MODEL"),
      systemPrompt: env.SYSTEM_PROMPT,
      reasoningEffort: resolveGeminiReasoningEffort(
        env.GEMINI_REASONING_EFFORT,
      ),
    };
  }

  return {
    provider,
    baseUrl: required(env.HF_BASE_URL, "HF_BASE_URL"),
    token: required(env.HF_TOKEN, "HF_TOKEN"),
    model: required(env.HF_MODEL, "HF_MODEL"),
    systemPrompt: env.SYSTEM_PROMPT,
  };
}

function resolveGeminiReasoningEffort(
  value: string | undefined,
): "minimal" | "low" | "medium" | "high" {
  const effort = value?.trim().toLowerCase() || "low";
  if (
    effort !== "minimal" &&
    effort !== "low" &&
    effort !== "medium" &&
    effort !== "high"
  ) {
    throw new Error(
      "GEMINI_REASONING_EFFORT must be minimal, low, medium, or high",
    );
  }
  return effort;
}

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} is required for the selected AI provider`);
  return value.trim();
}
