import assert from "node:assert/strict";
import test from "node:test";
import { HuggingFaceService } from "../src/services/hugging-face.service";

const config = {
  baseUrl: "https://example.test/v1",
  token: "test-token",
  model: "test-model",
  systemPrompt: "Be helpful.",
};

test("repository prompt requires evidence for project-purpose claims", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: { messages?: Array<{ content?: string }> } | undefined;
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return Response.json({
      choices: [{ message: { content: "ระบบนี้เป็นบอทสำหรับอ่านโค้ดตาม README.md" } }],
    });
  }) as typeof fetch;

  try {
    const service = new HuggingFaceService(config);
    await service.answerRepositoryQuestion(
      "Repo นี้ใช้ทำอะไร",
      "--- FILE: README.md ---\nLINE code assistant",
    );

    const systemPrompt = requestBody?.messages?.[0]?.content ?? "";
    assert.match(systemPrompt, /product or business purpose/i);
    assert.match(systemPrompt, /supporting file path/i);
    assert.match(systemPrompt, /Do not invent module counts/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Thai answers containing CJK characters are retried once", async () => {
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
    const service = new HuggingFaceService(config);
    const answer = await service.answerDeveloperQuestion("Service คืออะไร");

    assert.equal(answer, "Service นี้แยกการทำงานออกจากระบบหลัก");
    assert.equal(calls, 2);
    assert.deepEqual(temperatures, [0.7, 0.3]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("repository answers retry when they omit exact evidence paths", async () => {
  const originalFetch = globalThis.fetch;
  const temperatures: number[] = [];
  let calls = 0;
  globalThis.fetch = (async (_input, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body)) as { temperature: number };
    temperatures.push(body.temperature);
    const content = calls === 1
      ? "ระบบนี้เป็นผู้ช่วยอ่านโค้ดบน LINE"
      : "ระบบนี้เป็นผู้ช่วยอ่านโค้ดบน LINE\n\nหลักฐาน: `README.md`";
    return Response.json({ choices: [{ message: { content } }] });
  }) as typeof fetch;

  try {
    const service = new HuggingFaceService(config);
    const answer = await service.answerRepositoryQuestion(
      "Repo นี้เป็นระบบอะไร",
      [
        "SELECTED EVIDENCE PATHS:",
        "README.md",
        "",
        "SELECTED FILE CONTENTS:",
        "--- FILE: README.md ---",
        "LINE code assistant",
      ].join("\n"),
    );

    assert.match(answer, /README\.md/);
    assert.equal(calls, 2);
    assert.deepEqual(temperatures, [0.2, 0.1]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("tech-stack answers must cite primary manifest and runtime config", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    const content = calls === 1
      ? "ใช้ TypeScript ตาม `package.json`"
      : "ใช้ TypeScript และ Express ตาม `package.json` และ deploy เป็น Cloudflare Worker ตาม `wrangler.jsonc`";
    return Response.json({ choices: [{ message: { content } }] });
  }) as typeof fetch;

  try {
    const service = new HuggingFaceService(config);
    const answer = await service.answerRepositoryQuestion(
      "ระบบนี้ใช้ tech stack อะไร",
      [
        "SELECTED EVIDENCE PATHS:",
        "package.json",
        "wrangler.jsonc",
        "",
        "SELECTED FILE CONTENTS:",
        "--- FILE: package.json ---",
        "{}",
        "--- FILE: wrangler.jsonc ---",
        "{}",
      ].join("\n"),
    );

    assert.match(answer, /package\.json/);
    assert.match(answer, /wrangler\.jsonc/);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("repository answers reject cited paths outside the evidence allowlist", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    const content = calls === 1
      ? "เป็นผู้ช่วยอ่านโค้ดตาม `README.md` และ `src/missing.service.ts`"
      : "เป็นผู้ช่วยอ่านโค้ดตาม `README.md`";
    return Response.json({ choices: [{ message: { content } }] });
  }) as typeof fetch;

  try {
    const service = new HuggingFaceService(config);
    const answer = await service.answerRepositoryQuestion(
      "Repo นี้เป็นระบบอะไร",
      "SELECTED EVIDENCE PATHS:\nREADME.md\nSELECTED FILE CONTENTS:\n--- FILE: README.md ---\nCode assistant",
    );

    assert.equal(answer, "เป็นผู้ช่วยอ่านโค้ดตาม `README.md`");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ambiguous component questions return candidates without calling the model", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error("model should not be called");
  }) as typeof fetch;

  try {
    const service = new HuggingFaceService(config);
    const answer = await service.answerRepositoryQuestion(
      "Service ใช้ทำอะไร",
      [
        "SELECTED EVIDENCE PATHS:",
        "README.md",
        "packages/api-client/src/index.ts",
        "packages/api-client/package.json",
        "packages/registration-store/src/index.ts",
        "SELECTED FILE CONTENTS:",
      ].join("\n"),
    );

    assert.match(answer, /ยังไม่พบไฟล์หรือโฟลเดอร์ชื่อ service/);
    assert.match(answer, /packages\/api-client\/src\/index\.ts/);
    assert.ok(
      answer.indexOf("packages/api-client/src/index.ts") <
        answer.indexOf("packages/api-client/package.json"),
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("structured tech-stack evidence renders without calling the model", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error("model should not be called");
  }) as typeof fetch;

  try {
    const service = new HuggingFaceService(config);
    const answer = await service.answerRepositoryQuestion(
      "ระบบนี้ใช้ tech stack อะไร",
      [
        "STRUCTURED EVIDENCE SUMMARY:",
        "package.json engines: node@>=20 <23",
        "package.json dependencies: express@^5.1.0",
        "package.json devDependencies: typescript@^5.9.2, tsx@^4.20.6, wrangler@^4.42.0",
        "package.json script names: test, check",
        "Selected runtime/build config paths: wrangler.jsonc, tsconfig.json",
        "SELECTED EVIDENCE PATHS:",
        "package.json",
        "wrangler.jsonc",
        "src/index.ts",
        "README.md",
        "SELECTED FILE CONTENTS:",
        "Cloudflare KV LINE Messaging API GitHub API Hugging Face API",
      ].join("\n"),
    );

    assert.match(answer, /node@>=20 <23/);
    assert.match(answer, /express/);
    assert.match(answer, /typescript/);
    assert.match(answer, /Cloudflare Workers/);
    assert.match(answer, /LINE Messaging API/);
    assert.equal(answer.match(/Wrangler/g)?.length, 1);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("known README overview renders without model inference", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error("model should not be called");
  }) as typeof fetch;

  try {
    const service = new HuggingFaceService(config);
    const answer = await service.answerRepositoryQuestion(
      "Repo นี้เป็นระบบอะไร",
      [
        "SELECTED EVIDENCE PATHS:",
        "README.md",
        "SELECTED FILE CONTENTS:",
        "--- FILE: README.md ---",
        "Express webhook running on Cloudflare Workers. Each LINE conversation can select a GitHub repository and branch.",
      ].join("\n"),
    );

    assert.match(answer, /ผู้ช่วยอ่านโค้ดผ่าน LINE/);
    assert.match(answer, /GitHub repo\/branch/);
    assert.match(answer, /README\.md/);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("known registration README renders its concrete user and admin workflow", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error("model should not be called");
  }) as typeof fetch;

  try {
    const service = new HuggingFaceService(config);
    const answer = await service.answerRepositoryQuestion(
      "Repo นี้เป็นระบบอะไร",
      [
        "SELECTED EVIDENCE PATHS:",
        "README.md",
        "SELECTED FILE CONTENTS:",
        "--- FILE: README.md ---",
        "Submit event registration details. Admin app: View all registrations and download uploaded documents.",
      ].join("\n"),
    );

    assert.match(answer, /ระบบลงทะเบียนงาน/);
    assert.match(answer, /ฝั่งผู้ใช้/);
    assert.match(answer, /ฝั่งแอดมิน/);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("known LINE repository flow renders from selected source evidence", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error("model should not be called");
  }) as typeof fetch;

  try {
    const service = new HuggingFaceService(config);
    const paths = [
      "src/index.ts",
      "src/services/bot.service.ts",
      "src/services/github.service.ts",
      "src/services/hugging-face.service.ts",
      "src/services/repository-state.service.ts",
      "src/services/line.service.ts",
    ];
    const answer = await service.answerRepositoryQuestion(
      "business logic หลักคืออะไร",
      [
        "SELECTED EVIDENCE PATHS:",
        ...paths,
        "SELECTED FILE CONTENTS:",
        ...paths.map((path) => `--- FILE: ${path} ---\nsource`),
      ].join("\n"),
    );

    assert.match(answer, /ตรวจสอบลายเซ็น LINE/);
    assert.match(answer, /Cloudflare KV/);
    assert.match(answer, /github\.service\.ts/);
    assert.match(answer, /hugging-face\.service\.ts/);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("truncated repository output is retried with a shorter answer", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return Response.json({
      choices: [{
        finish_reason: calls === 1 ? "length" : "stop",
        message: { content: "ระบบนี้ช่วยอ่านโค้ดตาม `README.md`" },
      }],
    });
  }) as typeof fetch;

  try {
    const service = new HuggingFaceService(config);
    const answer = await service.answerRepositoryQuestion(
      "Repo นี้เป็นระบบอะไร",
      "SELECTED EVIDENCE PATHS:\nREADME.md\nSELECTED FILE CONTENTS:\n--- FILE: README.md ---\nCode assistant",
    );

    assert.equal(answer, "ระบบนี้ช่วยอ่านโค้ดตาม `README.md`");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("LINE followed by a dash is not mistaken for a line-number citation", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return Response.json({
      choices: [{ message: { content: "ระบบ LINE - ผู้ช่วยอ่านโค้ดตาม `README.md`" } }],
    });
  }) as typeof fetch;

  try {
    const service = new HuggingFaceService(config);
    const answer = await service.answerRepositoryQuestion(
      "Repo นี้เป็นระบบอะไร",
      "SELECTED EVIDENCE PATHS:\nREADME.md\nSELECTED FILE CONTENTS:\n--- FILE: README.md ---\nLINE code assistant",
    );

    assert.equal(answer, "ระบบ LINE - ผู้ช่วยอ่านโค้ดตาม `README.md`");
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("README overview context excludes later setup and source-path sections", () => {
  const service = new HuggingFaceService(config) as unknown as {
    createReadmeOverviewExcerpt(content: string): string;
  };
  const excerpt = service.createReadmeOverviewExcerpt([
    "# LINE AI Worker",
    "",
    "Webhook that lets LINE users ask about selected GitHub code.",
    "",
    "Read `POC_GUIDE.md` for setup.",
    "",
    "## Architecture",
    "",
    "See `src/index.ts` and `src/services/bot.service.ts`.",
  ].join("\n"));

  assert.equal(
    excerpt,
    "Webhook that lets LINE users ask about selected GitHub code.",
  );
});

test("README overview context includes product workflow sections", () => {
  const service = new HuggingFaceService(config) as unknown as {
    createReadmeOverviewExcerpt(content: string): string;
  };
  const excerpt = service.createReadmeOverviewExcerpt([
    "# Registration",
    "",
    "Two Next.js apps.",
    "",
    "## Local setup",
    "npm install",
    "",
    "## Registration workflow",
    "User app:",
    "- Submit event registration details.",
    "Admin app:",
    "- View all registrations.",
  ].join("\n"));

  assert.match(excerpt, /Submit event registration details/);
  assert.match(excerpt, /View all registrations/);
  assert.doesNotMatch(excerpt, /npm install/);
});

test("project overview retries the signature-as-signal mistranslation", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    const content = calls === 1
      ? "ระบบตรวจสอบสัญญาณจาก LINE ตาม `README.md`"
      : "ระบบตรวจสอบลายเซ็น LINE ตาม `README.md`";
    return Response.json({ choices: [{ message: { content } }] });
  }) as typeof fetch;

  try {
    const service = new HuggingFaceService(config);
    const answer = await service.answerRepositoryQuestion(
      "Repo นี้เป็นระบบอะไร",
      "SELECTED EVIDENCE PATHS:\nREADME.md\nSELECTED FILE CONTENTS:\n--- FILE: README.md ---\nLINE webhook",
    );

    assert.match(answer, /ตรวจสอบลายเซ็น LINE/);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
