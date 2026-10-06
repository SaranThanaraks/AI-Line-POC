import assert from "node:assert/strict";
import test from "node:test";
import { BotService } from "../src/services/bot.service";
import type { RepoState } from "../src/types";

const initialState: RepoState = {
  owner: "owner",
  repo: "project",
  branch: "main",
};

function createBot(state: RepoState | null = initialState) {
  const calls: string[] = [];
  const contexts: string[] = [];
  const writes: RepoState[] = [];
  const github = {
    buildRepositoryContext: async (_state: RepoState, question: string) => {
      calls.push(`github:${question}`);
      return "SELECTED EVIDENCE PATHS:\nREADME.md\nSELECTED FILE CONTENTS:\n--- FILE: README.md ---\nrepository context";
    },
  };
  const ai = {
    answerDeveloperQuestion: async (question: string) => {
      calls.push(`general:${question}`);
      return "general answer";
    },
    answerRepositoryQuestion: async (question: string, context: string) => {
      calls.push(`repository:${question}`);
      contexts.push(context);
      assert.match(context, /repository context/);
      return "repository answer";
    },
  };
  const repoState = {
    get: async () => state,
    put: async (_key: string, nextState: RepoState) => {
      writes.push(nextState);
    },
  };

  return {
    bot: new BotService(github as never, ai as never, repoState as never),
    calls,
    contexts,
    writes,
  };
}

test("all normal messages use the selected repository without intent classification", async () => {
  for (const question of [
    "สวัสดี",
    "โปรเจกต์นี้ทำอะไร",
    "มี feature อะไรบ้าง",
    "JWT ใช้ตรงไหน",
    "1 + 1 ได้อะไร",
  ]) {
    const { bot, calls, writes } = createBot();
    const answer = await bot.createReply(question, "line-user");

    assert.equal(answer, "repository answer");
    assert.deepEqual(calls, [`github:${question}`, `repository:${question}`]);
    assert.equal(writes[0].lastQuestion, question);
    assert.equal("lastMode" in writes[0], false);
  }
});

test("messages without a selected repository go directly to scoped general AI", async () => {
  const { bot, calls, writes } = createBot(null);
  const answer = await bot.createReply("JWT คืออะไร", "line-user");

  assert.equal(answer, "general answer");
  assert.deepEqual(calls, ["general:JWT คืออะไร"]);
  assert.deepEqual(writes, []);
});

test("out-of-scope messages are sent to AI so the prompt can decline them", async () => {
  const { bot, calls } = createBot(null);
  await bot.createReply("1 + 1 ได้อะไร", "line-user");
  assert.deepEqual(calls, ["general:1 + 1 ได้อะไร"]);
});

test("/ask bypasses repository context", async () => {
  const { bot, calls, writes } = createBot();
  const answer = await bot.createReply("/ask JWT คืออะไร", "line-user");

  assert.equal(answer, "general answer");
  assert.deepEqual(calls, ["general:JWT คืออะไร"]);
  assert.deepEqual(writes, []);
});

test("/code requires a selected repository", async () => {
  const { bot, calls } = createBot(null);
  const answer = await bot.createReply("/code อธิบาย architecture", "line-user");

  assert.match(answer as string, /ยังไม่ได้เลือก repo/);
  assert.deepEqual(calls, []);
});

test("/code uses the selected repository", async () => {
  const { bot, calls } = createBot();
  const answer = await bot.createReply("/code อธิบาย architecture", "line-user");

  assert.equal(answer, "repository answer");
  assert.deepEqual(calls, [
    "github:อธิบาย architecture",
    "repository:อธิบาย architecture",
  ]);
});

test("the previous question is AI context but never changes current file retrieval", async () => {
  const { bot, calls, contexts } = createBot({
    ...initialState,
    lastQuestion: "business logic หลักคืออะไร",
  });
  await bot.createReply("อธิบายเพิ่มแบบสั้นๆ", "line-user");

  assert.equal(calls[0], "github:อธิบายเพิ่มแบบสั้นๆ");
  assert.equal(calls[1], "repository:อธิบายเพิ่มแบบสั้นๆ");
  assert.match(contexts[0], /CONVERSATION CONTEXT:/);
  assert.match(contexts[0], /Previous user question: business logic หลักคืออะไร/);
});

test("AI quota errors return an actionable LINE reply", async () => {
  const bot = new BotService(
    {} as never,
    {
      answerDeveloperQuestion: async () => {
        throw new Error("Hugging Face request failed (402)");
      },
    } as never,
    { get: async () => null } as never,
  );

  const answer = await bot.createReply("JWT คืออะไร", "line-user");
  assert.match(answer as string, /AI API quota/);
  assert.match(answer as string, /Hugging Face/);
});

test("repository AI quota errors return an actionable LINE reply", async () => {
  const bot = new BotService(
    { buildRepositoryContext: async () => "context" } as never,
    {
      answerRepositoryQuestion: async () => {
        throw new Error("Hugging Face request failed (429)");
      },
    } as never,
    { get: async () => initialState, put: async () => undefined } as never,
  );

  const answer = await bot.createReply("โปรเจกต์นี้ทำอะไร", "line-user");
  assert.match(answer as string, /มากเกินไปชั่วคราว/);
});
