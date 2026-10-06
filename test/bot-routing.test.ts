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

test("AI quota errors return an actionable LINE reply instead of throwing", async () => {
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

test("short-answer follow-ups inherit repository mode", async () => {
  const { bot, calls } = createBot({
    ...initialState,
    lastMode: "repository",
    lastQuestion: "ช่วย review architecture ของโปรเจกต์",
  });
  await bot.createReply("อธิบายสั้นๆ", "line-user");
  assert.match(calls[0], /Current follow-up: อธิบายสั้นๆ$/);
  assert.match(calls[1], /Current follow-up: อธิบายสั้นๆ$/);
});

test("selected repository component questions load code context", async () => {
  const { bot, calls } = createBot();
  await bot.createReply("Service ใช้ทำอะไร", "line-user");
  assert.deepEqual(calls, [
    "github:Service ใช้ทำอะไร",
    "repository:Service ใช้ทำอะไร",
  ]);
});

test("repository symbol inventory questions keep reading the selected repo", async () => {
  const { bot, calls, writes } = createBot({
    ...initialState,
    lastMode: "repository",
    lastQuestion: "โปรเจคนี้ทำอะไร",
  });
  await bot.createReply("มี function อะไรบ้าง", "line-user");
  assert.deepEqual(calls, [
    "github:มี function อะไรบ้าง",
    "repository:มี function อะไรบ้าง",
  ]);
  assert.equal(writes[0].lastMode, "repository");
});

test("capability synonyms keep reading the selected repo", async () => {
  for (const question of [
    "มีฟีเจอร์อะไรบ้าง",
    "มี feature อะไร",
    "โปรเจกต์มีคุณสมบัติหลักอะไร",
    "what capabilities does it have",
  ]) {
    const { bot, calls, writes } = createBot({
      ...initialState,
      lastMode: "repository",
      lastQuestion: "ระบบนี้ทำอะไร",
    });
    await bot.createReply(question, "line-user");
    assert.deepEqual(calls, [
      `github:${question}`,
      `repository:${question}`,
    ]);
    assert.equal(writes[0].lastMode, "repository");
  }
});

test("detailed function inventory is not mistaken for a repository-list command", async () => {
  const { bot, calls } = createBot({
    ...initialState,
    lastMode: "repository",
    lastQuestion: "โปรเจกต์นี้ทำอะไร",
  });
  const question = "มี function หลักอะไรบ้างในโปรเจกต์นี้ ขอชื่อ function จริงพร้อมหน้าที่";
  await bot.createReply(question, "line-user");
  assert.deepEqual(calls, [
    `github:${question}`,
    `repository:${question}`,
  ]);
});

test("project-purpose follow-ups stay in repository mode", async () => {
  const { bot, calls } = createBot({
    ...initialState,
    lastMode: "repository",
    lastQuestion: "Repo นี้เป็นระบบอะไร",
  });
  await bot.createReply("เป็นระบบใช้ทำอะไร", "line-user");
  assert.deepEqual(calls, [
    "github:เป็นระบบใช้ทำอะไร",
    "repository:เป็นระบบใช้ทำอะไร",
  ]);
});
