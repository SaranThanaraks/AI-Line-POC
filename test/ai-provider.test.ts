import assert from "node:assert/strict";
import test from "node:test";
import { resolveAiConfig } from "../src/ai-provider";

const common = {
  SYSTEM_PROMPT: "Be helpful.",
  GEMINI_API_KEY: "gemini-key",
  GEMINI_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai",
  GEMINI_MODEL: "gemini-3.5-flash-lite",
  HF_TOKEN: "hf-token",
  HF_BASE_URL: "https://router.huggingface.co/v1",
  HF_MODEL: "meta-llama/Llama-3.1-8B-Instruct:novita",
};

test("Gemini is the default provider", () => {
  const config = resolveAiConfig(common);
  assert.equal(config.provider, "gemini");
  assert.equal(config.token, "gemini-key");
  assert.equal(config.model, "gemini-3.5-flash-lite");
  assert.equal(config.reasoningEffort, "low");
});

test("Gemini reasoning effort is configurable", () => {
  const config = resolveAiConfig({
    ...common,
    GEMINI_REASONING_EFFORT: "minimal",
  });

  assert.equal(config.reasoningEffort, "minimal");
  assert.throws(
    () => resolveAiConfig({ ...common, GEMINI_REASONING_EFFORT: "extreme" }),
    /GEMINI_REASONING_EFFORT must be/,
  );
});

test("AI_PROVIDER can switch to Hugging Face", () => {
  const config = resolveAiConfig({ ...common, AI_PROVIDER: "huggingface" });
  assert.equal(config.provider, "huggingface");
  assert.equal(config.token, "hf-token");
  assert.equal(config.baseUrl, "https://router.huggingface.co/v1");
});

test("the selected provider must have its own API key", () => {
  assert.throws(
    () => resolveAiConfig({ ...common, GEMINI_API_KEY: "" }),
    /GEMINI_API_KEY is required/,
  );
  assert.throws(
    () => resolveAiConfig({ ...common, AI_PROVIDER: "huggingface", HF_TOKEN: "" }),
    /HF_TOKEN is required/,
  );
});

test("unsupported provider names fail fast", () => {
  assert.throws(
    () => resolveAiConfig({ ...common, AI_PROVIDER: "unknown" }),
    /AI_PROVIDER must be either/,
  );
});
