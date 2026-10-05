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
  const writes: RepoState[] = [];
  const github = {
    buildRepositoryContext: async (_state: RepoState, question: string) => {
      calls.push(`github:${question}`);
      return "repository context";
    },
  };
  const ai = {
    answerDeveloperQuestion: async (question: string) => {
      calls.push(`general:${question}`);
      return "general answer";
    },
    answerRepositoryQuestion: async (question: string) => {
      calls.push(`repository:${question}`);
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
    writes,
  };
}

test("out-of-scope requests never call GitHub or AI", async () => {
  const { bot, calls, writes } = createBot();
  const answer = await bot.createReply("1 + 1 ได้อะไร", "line-user");
  assert.match(answer as string, /ช่วยเฉพาะเรื่อง programming/);
  assert.deepEqual(calls, []);
  assert.deepEqual(writes, []);
});

test("general developer questions do not send repository context", async () => {
  const { bot, calls, writes } = createBot();
  const answer = await bot.createReply("JWT คืออะไร", "line-user");
  assert.equal(answer, "general answer");
  assert.deepEqual(calls, ["general:JWT คืออะไร"]);
  assert.equal(writes[0].lastMode, "general");
});

test("project questions load repository context", async () => {
  const { bot, calls, writes } = createBot();
  const answer = await bot.createReply("ระบบนี้ใช้ tech stack อะไร", "line-user");
  assert.equal(answer, "repository answer");
  assert.deepEqual(calls, [
    "github:ระบบนี้ใช้ tech stack อะไร",
    "repository:ระบบนี้ใช้ tech stack อะไร",
  ]);
  assert.equal(writes[0].lastMode, "repository");
});

test("ambiguous follow-ups inherit repository mode and prior question", async () => {
  const { bot, calls } = createBot({
    ...initialState,
    lastMode: "repository",
    lastQuestion: "business logic หลักคืออะไร",
  });
  await bot.createReply("อธิบายเพิ่มหน่อย", "line-user");
  assert.match(calls[0], /^github:Previous user question:/);
  assert.match(calls[1], /^repository:Previous user question:/);
});
