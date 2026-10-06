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

test("library project overview is grounded in manifest, UI types, and routes without README", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error("model should not be called");
  }) as typeof fetch;

  try {
    const service = new HuggingFaceService(config);
    const answer = await service.answerRepositoryQuestion(
      "โปรเจคนี้ทำอะไร",
      [
        "SELECTED EVIDENCE PATHS:",
        "package.json",
        "app/page.tsx",
        "app/api/books/route.ts",
        "app/api/borrow/route.ts",
        "app/api/admin/loans/route.ts",
        "SELECTED FILE CONTENTS:",
        "--- FILE: package.json ---",
        '{"name":"library-lending-system"}',
        "--- FILE: app/page.tsx ---",
        "type Book = {}; type Member = {}; type Loan = {}; export default function MemberHome() {}",
        "--- FILE: app/api/books/route.ts ---",
        "export async function GET() {} export async function POST() {}",
        "--- FILE: app/api/borrow/route.ts ---",
        "import { borrowBook } from '../../../lib/libraryService'; export async function POST() {}",
        "--- FILE: app/api/admin/loans/route.ts ---",
        "import { getAdminLoans } from '../../../../lib/libraryService'; export async function GET() {}",
      ].join("\n"),
    );

    assert.match(answer, /เว็บระบบห้องสมุดสำหรับยืมหนังสือ/);
    assert.match(answer, /สมาชิกสมัคร\/ล็อกอิน/);
    assert.match(answer, /app\/api\/borrow\/route\.ts/);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("member capability follow-up answers the selected role instead of repeating overview", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error("model should not be called");
  }) as typeof fetch;

  try {
    const service = new HuggingFaceService(config);
    const answer = await service.answerRepositoryQuestion(
      "ผู้ใช้ทั่วไปทำอะไรได้บ้างในระบบนี้",
      [
        "SELECTED EVIDENCE PATHS:",
        "app/page.tsx",
        "app/api/loans/borrow/route.ts",
        "SELECTED FILE CONTENTS:",
        "--- FILE: app/page.tsx ---",
        "async function signup() {} async function login() {} async function borrow() {} const loans = []; const books = [];",
        "--- FILE: app/api/loans/borrow/route.ts ---",
        "export async function POST() { return borrowBook(); }",
      ].join("\n"),
    );

    assert.match(answer, /สมัคร\/ล็อกอิน/);
    assert.match(answer, /ส่งคำขอยืม/);
    assert.match(answer, /app\/page\.tsx/);
    assert.doesNotMatch(answer, /ส่วนแอดมิน/);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("bare function follow-up means project capabilities unless code symbols are explicit", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error("model should not be called");
  }) as typeof fetch;

  try {
    const service = new HuggingFaceService(config);
    const answer = await service.answerRepositoryQuestion(
      "มี function อะไรบ้าง",
      [
        "SELECTED EVIDENCE PATHS:",
        "app/page.tsx",
        "app/admin/page.tsx",
        "lib/libraryService.ts",
        "lib/loanRules.ts",
        "SELECTED FILE CONTENTS:",
        "--- FILE: app/page.tsx ---",
        "signup login borrow books loans",
        "--- FILE: app/admin/page.tsx ---",
        "admin overdue return book",
        "--- FILE: lib/libraryService.ts ---",
        "export async function signupMember() {} export async function loginMember() {} export async function borrowBook() {} export async function getMemberLoans() {} export async function getAdminLoans() {} export async function markLoanReturned() {}",
        "--- FILE: lib/loanRules.ts ---",
        "export function calculateFine() {}",
      ].join("\n"),
    );

    assert.match(answer, /ความสามารถของโปรเจกต์/);
    assert.match(answer, /สมัคร\/ล็อกอิน/);
    assert.match(answer, /คำนวณวันครบกำหนด\/ค่าปรับ/);
    assert.doesNotMatch(answer, /ฟังก์ชันที่พบใน source/);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("capability synonyms render project capabilities without calling the model", async () => {
  let modelCalls = 0;
  const service = new HuggingFaceService({
    fetch: async () => {
      modelCalls += 1;
      throw new Error("model should not be called");
    },
  } as never);
  const context = [
    "SELECTED EVIDENCE PATHS:\n- app/page.tsx\n- app/admin/page.tsx\n- lib/libraryService.ts\n- lib/loanRules.ts",
    "--- FILE: app/page.tsx ---\ntype Book = {}; type Member = {}; type Loan = {}; signupMember(); loginMember(); borrowBook(); getMemberLoans();",
    "--- FILE: app/admin/page.tsx ---\ncreateBook(); getAdminLoans(); markLoanReturned();",
    "--- FILE: lib/libraryService.ts ---\nexport async function borrowBook() {}",
    "--- FILE: lib/loanRules.ts ---\nexport function calculateFine() {}",
  ].join("\n\n");

  for (const question of [
    "มีฟีเจอร์อะไรบ้าง",
    "มี feature อะไร",
    "โปรเจกต์มีคุณสมบัติหลักอะไร",
    "what capabilities does it have",
  ]) {
    const answer = await service.answerRepositoryQuestion(question, context);
    assert.match(answer, /ความสามารถของโปรเจกต์|project's capabilities/i);
    assert.match(answer, /สมัคร\/ล็อกอิน|sign/i);
  }
  assert.equal(modelCalls, 0);
});

test("function inventory is extracted from repository source without model guesses", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error("model should not be called");
  }) as typeof fetch;

  try {
    const service = new HuggingFaceService(config);
    const answer = await service.answerRepositoryQuestion(
      "มี function อะไรบ้าง ขอชื่อ function จริงในไฟล์ source",
      [
        "SELECTED EVIDENCE PATHS:",
        "lib/libraryService.ts",
        "app/api/books/route.ts",
        "app/page.tsx",
        "SELECTED FILE CONTENTS:",
        "--- FILE: lib/libraryService.ts ---",
        "import { query } from './db';",
        "",
        "export async function listBooks() {} export async function borrowBook() {}",
        "--- FILE: app/api/books/route.ts ---",
        "export async function GET() {} export async function POST() {}",
        "--- FILE: app/page.tsx ---",
        "async function api() {} function formatDate() {} export default function MemberHome() {}",
      ].join("\n"),
    );

    assert.match(answer, /lib\/libraryService\.ts/);
    assert.match(answer, /`listBooks\(\)`/);
    assert.match(answer, /`borrowBook\(\)`/);
    assert.match(answer, /app\/api\/books\/route\.ts/);
    assert.match(answer, /`GET\(\)`/);
    assert.doesNotMatch(answer, /sin\(\)|cos\(\)|print\(\)/);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("layered Next.js architecture is composed from concrete boundaries without model guesses", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error("model should not be called");
  }) as typeof fetch;

  try {
    const service = new HuggingFaceService(config);
    const answer = await service.answerRepositoryQuestion(
      "architecture เป็นแบบไหน",
      [
        "SELECTED EVIDENCE PATHS:",
        "package.json",
        "app/page.tsx",
        "lib/libraryService.ts",
        "lib/db.ts",
        "SELECTED FILE CONTENTS:",
        "--- FILE: package.json ---",
        '{"dependencies":{"next":"15.0.0"}}',
        "--- FILE: app/page.tsx ---",
        "export default function Page() {}",
        "--- FILE: lib/libraryService.ts ---",
        "export async function listBooks() {}",
        "--- FILE: lib/db.ts ---",
        "export async function query() {}",
      ].join("\n"),
    );
    assert.match(answer, /layered modular monolith/);
    assert.match(answer, /app\/page\.tsx/);
    assert.match(answer, /lib\/libraryService\.ts/);
    assert.match(answer, /lib\/db\.ts/);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("borrow workflow is traced across route, service, rules, database, and UI", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error("model should not be called");
  }) as typeof fetch;

  try {
    const service = new HuggingFaceService(config);
    const answer = await service.answerRepositoryQuestion(
      "การยืมทำงานยังไง",
      [
        "SELECTED EVIDENCE PATHS:",
        "app/page.tsx",
        "app/api/loans/borrow/route.ts",
        "lib/libraryService.ts",
        "lib/loanRules.ts",
        "lib/db.ts",
        "SELECTED FILE CONTENTS:",
        "--- FILE: app/page.tsx ---",
        "await api('/api/loans/borrow', { body: JSON.stringify({ bookId }) });",
        "--- FILE: app/api/loans/borrow/route.ts ---",
        "export async function POST() { return borrowBook(); }",
        "--- FILE: lib/libraryService.ts ---",
        "export async function borrowBook() { await query('BEGIN'); }",
        "--- FILE: lib/loanRules.ts ---",
        "export function dueDateForCategory() {}",
        "--- FILE: lib/db.ts ---",
        "export async function query() {}",
      ].join("\n"),
    );
    assert.match(answer, /app\/api\/loans\/borrow\/route\.ts/);
    assert.match(answer, /borrowBook\(\)/);
    assert.match(answer, /transaction\/lock/);
    assert.match(answer, /lib\/db\.ts/);
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
