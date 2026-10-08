import assert from "node:assert/strict";
import test from "node:test";
import { AiService } from "../src/services/ai.service";

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

test("Gemini OpenAI-compatible endpoint uses a Bearer API key", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let authorization = "";
  let requestBody: { reasoning_effort?: string; max_tokens?: number } = {};
  globalThis.fetch = (async (input, init) => {
    requestUrl = String(input);
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    requestBody = JSON.parse(String(init?.body));
    return Response.json({ choices: [{ message: { content: "API explanation" } }] });
  }) as typeof fetch;

  try {
    const service = new AiService({
      ...config,
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
      token: "gemini-test-key",
      model: "gemini-3.6-flash",
      reasoningEffort: "low",
    });
    await service.answerDeveloperQuestion("Explain this API");

    assert.equal(
      requestUrl,
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    );
    assert.equal(authorization, "Bearer gemini-test-key");
    assert.equal(requestBody.reasoning_effort, "low");
    assert.equal(requestBody.max_tokens, 4_096);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

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
    const answer = await new AiService(config)
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
    const answer = await new AiService(config).answerRepositoryQuestion(
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
    assert.match(prompt, /current question is authoritative/i);
    assert.match(prompt, /broad question such as what Service/i);
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
    const answer = await new AiService(config).answerRepositoryQuestion(
      "สวัสดี",
      repositoryContext,
    );
    assert.match(answer, /สวัสดี/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("repository assistant identity needs no path citation and is not retried", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return Response.json({
      choices: [{
        message: {
          content: "ผมคือผู้ช่วยนักพัฒนาสำหรับอธิบายและวิเคราะห์โปรเจกต์ที่คุณเลือกครับ",
        },
      }],
    });
  }) as typeof fetch;

  try {
    const answer = await new AiService(config).answerRepositoryQuestion(
      "คุณคือใคร",
      repositoryContext,
    );
    assert.match(answer, /ผู้ช่วยนักพัฒนา/);
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
    const answer = await new AiService(config).answerRepositoryQuestion(
      "พรุ่งนี้ฝนตกไหม",
      repositoryContext,
    );
    assert.equal(answer, "ไม่สามารถตอบได้ครับ");
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("general scope refusal is normalized without policy explanation", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({
    choices: [{
      message: {
        content: "ระบบถูกตั้งค่าให้ปฏิเสธคำถามนอกขอบเขตซอฟต์แวร์ จึงให้สูตรอาหารไม่ได้ครับ",
      },
    }],
  })) as typeof fetch;

  try {
    const answer = await new AiService(config).answerDeveloperQuestion(
      "ขอสูตรกะเพราหมูสับ",
    );
    assert.equal(answer, "ไม่สามารถตอบได้ครับ");
    assert.doesNotMatch(answer, /ตั้งค่า|ขอบเขต|สูตรอาหาร/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("repository answers cannot expose the internal POC guide", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    const content = calls === 1
      ? "ระบบทำงานตาม `POC_GUIDE.md`"
      : "ระบบรับ webhook ตาม `src/index.ts` ครับ";
    return Response.json({ choices: [{ message: { content } }] });
  }) as typeof fetch;

  try {
    const answer = await new AiService(config).answerRepositoryQuestion(
      "ระบบทำงานอย่างไร",
      repositoryContext,
    );
    assert.doesNotMatch(answer, /POC_GUIDE\.md/i);
    assert.match(answer, /src\/index\.ts/);
    assert.equal(calls, 2);
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
    const answer = await new AiService(config).answerRepositoryQuestion(
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

test("AI requests retry one transient provider failure", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return calls === 1
      ? new Response(null, { status: 503 })
      : Response.json({
          choices: [{ message: { content: "โปรเจกต์นี้เป็นผู้ช่วยอ่านโค้ดตาม `README.md` ครับ ถามต่อได้ว่าอยากดู feature หรือ tech stack ส่วนไหน" } }],
        });
  }) as typeof fetch;

  try {
    const answer = await new AiService(config).answerRepositoryQuestion(
      "โปรเจกต์นี้ทำอะไร",
      repositoryContext,
    );
    assert.match(answer, /README\.md/);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("repository factual answers retry when they omit evidence paths", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    const content = calls === 1
      ? "โปรเจกต์นี้เป็นผู้ช่วยอ่านโค้ดผ่าน LINE ครับ"
      : "โปรเจกต์นี้เป็นผู้ช่วยอ่านโค้ดผ่าน LINE ตาม `README.md` ครับ ถามต่อได้ว่าอยากดู feature หรือ architecture ส่วนไหน";
    return Response.json({ choices: [{ message: { content } }] });
  }) as typeof fetch;

  try {
    const answer = await new AiService(config).answerRepositoryQuestion(
      "โปรเจกต์นี้ทำอะไร",
      repositoryContext,
    );
    assert.match(answer, /README\.md/);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("broad project overviews are rewritten as a short answer with a follow-up", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    const content = calls === 1
      ? `${"รายละเอียด workflow จาก `README.md` ".repeat(35)}ถามต่อได้ครับ`
      : "โปรเจกต์นี้เป็นผู้ช่วยอ่านและวิเคราะห์โค้ดผ่าน LINE ตาม `README.md` ครับ ถามต่อได้ว่าอยากดู feature, architecture หรือ tech stack ส่วนไหน";
    return Response.json({ choices: [{ message: { content } }] });
  }) as typeof fetch;

  try {
    const answer = await new AiService(config).answerRepositoryQuestion(
      "โปรเจกต์นี้ทำอะไร",
      repositoryContext,
    );
    assert.ok(answer.length <= 700);
    assert.match(answer, /ถามต่อ/);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("grounded security reviews up to 2,000 characters are accepted", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const content = `พบความเสี่ยงที่ควรตรวจใน \`src/index.ts\` ครับ\n${"รายละเอียดความเสี่ยงและแนวทางแก้ ".repeat(45)}`;
  assert.ok(content.length > 1_200 && content.length < 2_000);
  globalThis.fetch = (async () => {
    calls += 1;
    return Response.json({ choices: [{ message: { content } }] });
  }) as typeof fetch;

  try {
    const answer = await new AiService(config).answerRepositoryQuestion(
      "โปรเจกต์นี้มีความเสี่ยง security อย่างไร",
      repositoryContext,
    );
    assert.equal(answer, content.trim());
    assert.equal(calls, 1);
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
    const answer = await new AiService(config)
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
        message: { content: calls === 1 ? "Partial answer" : "Project summary from `README.md`. Ask next about features or architecture." },
      }],
    });
  }) as typeof fetch;

  try {
    const answer = await new AiService(config).answerRepositoryQuestion(
      "Summarize the project",
      repositoryContext,
    );
    assert.equal(answer, "Project summary from `README.md`. Ask next about features or architecture.");
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
    const answer = await new AiService(config).answerRepositoryQuestion(
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
