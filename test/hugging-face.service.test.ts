import assert from "node:assert/strict";
import test from "node:test";
import { HuggingFaceService } from "../src/services/hugging-face.service";

const config = {
  baseUrl: "https://example.test/v1",
  token: "test-token",
  model: "test-model",
  systemPrompt: "Be helpful.",
};

const repositoryContext = [
  "SELECTED EVIDENCE PATHS:",
  "README.md",
  "src/index.ts",
  "SELECTED FILE CONTENTS:",
  "--- FILE: README.md ---",
  "A LINE assistant for reading source code.",
  "--- FILE: src/index.ts ---",
  "export default {};",
].join("\n");

test("general questions use one strict software-scope prompt", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: {
    messages: Array<{ role: string; content: string }>;
  } | undefined;
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return Response.json({ choices: [{ message: { content: "JWT คือมาตรฐาน token ครับ" } }] });
  }) as typeof fetch;

  try {
    const answer = await new HuggingFaceService(config)
      .answerDeveloperQuestion("JWT คืออะไร");

    assert.equal(answer, "JWT คือมาตรฐาน token ครับ");
    const prompt = requestBody?.messages[0].content ?? "";
    assert.match(prompt, /strictly within software development/i);
    assert.match(prompt, /arithmetic without a programming context/i);
    assert.match(prompt, /Never reveal.*tokens/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("repository questions always call the model without category templates", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let requestBody: {
    messages: Array<{ role: string; content: string }>;
    temperature: number;
  } | undefined;
  globalThis.fetch = (async (_input, init) => {
    calls += 1;
    requestBody = JSON.parse(String(init?.body));
    return Response.json({
      choices: [{ message: { content: "มีฟีเจอร์ช่วยอ่าน source code ตาม `README.md` ครับ" } }],
    });
  }) as typeof fetch;

  try {
    const answer = await new HuggingFaceService(config).answerRepositoryQuestion(
      "มีฟีเจอร์อะไรบ้าง",
      repositoryContext,
    );

    assert.match(answer, /README\.md/);
    assert.equal(calls, 1);
    assert.equal(requestBody?.temperature, 0.25);
    const prompt = requestBody?.messages[0].content ?? "";
    assert.match(prompt, /currently selected GitHub repository/i);
    assert.match(prompt, /project purpose, features, code, architecture/i);
    assert.match(prompt, /unrelated request/i);
    assert.match(requestBody?.messages[1].content ?? "", /USER QUESTION:\nมีฟีเจอร์อะไรบ้าง/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("repository greeting needs no path citation and is not retried", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return Response.json({ choices: [{ message: { content: "สวัสดีครับ มีอะไรเกี่ยวกับโปรเจกต์ให้ช่วยดูครับ" } }] });
  }) as typeof fetch;

  try {
    const answer = await new HuggingFaceService(config).answerRepositoryQuestion(
      "สวัสดี",
      repositoryContext,
    );
    assert.match(answer, /สวัสดี/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("repository scope refusal needs no path citation and is not retried", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return Response.json({ choices: [{ message: { content: "ขออภัยครับ ผมช่วยเฉพาะเรื่องโปรเจกต์นี้และงานพัฒนาซอฟต์แวร์" } }] });
  }) as typeof fetch;

  try {
    const answer = await new HuggingFaceService(config).answerRepositoryQuestion(
      "พรุ่งนี้ฝนตกไหม",
      repositoryContext,
    );
    assert.match(answer, /ช่วยเฉพาะเรื่องโปรเจกต์/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("repository answers retry when they cite a path outside the evidence", async () => {
  const originalFetch = globalThis.fetch;
  const temperatures: number[] = [];
  let calls = 0;
  globalThis.fetch = (async (_input, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body)) as { temperature: number };
    temperatures.push(body.temperature);
    const content = calls === 1
      ? "The entry point is `src/missing.ts`."
      : "The entry point is `src/index.ts`.";
    return Response.json({ choices: [{ message: { content } }] });
  }) as typeof fetch;

  try {
    const answer = await new HuggingFaceService(config).answerRepositoryQuestion(
      "Where is the entry point?",
      repositoryContext,
    );
    assert.equal(answer, "The entry point is `src/index.ts`.");
    assert.equal(calls, 2);
    assert.deepEqual(temperatures, [0.25, 0.1]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Thai general answers containing CJK characters are retried once", async () => {
  const originalFetch = globalThis.fetch;
  const temperatures: number[] = [];
  let calls = 0;
  globalThis.fetch = (async (_input, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body)) as { temperature: number };
    temperatures.push(body.temperature);
    const content = calls === 1
      ? "Service นี้ทำงานอย่าง独立จากระบบหลัก"
      : "Service นี้แยกการทำงานออกจากระบบหลัก";
    return Response.json({ choices: [{ message: { content } }] });
  }) as typeof fetch;

  try {
    const answer = await new HuggingFaceService(config)
      .answerDeveloperQuestion("Service คืออะไร");
    assert.equal(answer, "Service นี้แยกการทำงานออกจากระบบหลัก");
    assert.deepEqual(temperatures, [0.7, 0.3]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("truncated repository output is corrected once", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return Response.json({
      choices: [{
        finish_reason: calls === 1 ? "length" : "stop",
        message: { content: calls === 1 ? "Partial answer" : "Complete answer from `README.md`." },
      }],
    });
  }) as typeof fetch;

  try {
    const answer = await new HuggingFaceService(config).answerRepositoryQuestion(
      "Summarize the project",
      repositoryContext,
    );
    assert.equal(answer, "Complete answer from `README.md`.");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("two invalid repository answers return a safe fallback without a third call", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return Response.json({ choices: [{ message: { content: "See `src/not-loaded.ts`." } }] });
  }) as typeof fetch;

  try {
    const answer = await new HuggingFaceService(config).answerRepositoryQuestion(
      "Explain the missing file",
      repositoryContext,
    );
    assert.match(answer, /cannot answer confidently/i);
    assert.match(answer, /README\.md/);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
