import assert from "node:assert/strict";
import test from "node:test";
import {
  IntentRouterService,
  type IntentContext,
} from "../src/services/intent-router.service";

const router = new IntentRouterService();
const selectedRepo: IntentContext = { hasSelectedRepository: true };

const cases: Array<{
  message: string;
  expected: "casual" | "general" | "repository" | "out_of_scope";
  context?: IntentContext;
}> = [
  { message: "สวัสดี", expected: "casual" },
  { message: "หวัดดีครับ", expected: "casual" },
  { message: "hello", expected: "casual" },
  { message: "ขอบคุณมาก", expected: "casual" },
  { message: "เป็นไงบ้าง", expected: "casual" },
  { message: "วันนี้เป็นไง", expected: "casual" },
  { message: "กินข้าวยัง", expected: "casual" },
  { message: "ชื่ออะไร", expected: "casual" },
  { message: "คุณคือใคร", expected: "casual" },
  { message: "ช่วยอะไรได้บ้าง", expected: "casual" },
  { message: "สวัสดี คุณช่วยอะไรได้บ้าง", expected: "casual", context: selectedRepo },
  { message: "JWT คืออะไร", expected: "general", context: selectedRepo },
  { message: "REST กับ GraphQL ต่างกันยังไง", expected: "general", context: selectedRepo },
  { message: "NestJS guard ทำงานยังไง", expected: "general", context: selectedRepo },
  { message: "เขียน debounce ใน TypeScript ให้หน่อย", expected: "general", context: selectedRepo },
  { message: "อธิบาย SOLID แบบง่ายๆ", expected: "general", context: selectedRepo },
  { message: "Cloudflare Worker จำกัด execution ยังไง", expected: "general", context: selectedRepo },
  { message: "refactor คืออะไร", expected: "general", context: selectedRepo },
  { message: "Service คืออะไร", expected: "general", context: selectedRepo },
  { message: "Project นี้ทำอะไร", expected: "repository", context: selectedRepo },
  { message: "repo นี้เกี่ยวกับอะไร", expected: "repository", context: selectedRepo },
  { message: "ระบบนี้มี feature อะไรบ้าง", expected: "repository", context: selectedRepo },
  { message: "มีฟีเจอร์อะไรบ้าง", expected: "repository", context: selectedRepo },
  { message: "มี feature อะไร", expected: "repository", context: selectedRepo },
  { message: "สรุปโปรเจกต์ให้หน่อย", expected: "repository", context: selectedRepo },
  { message: "Goal ของ line นี้คืออะไร", expected: "repository", context: selectedRepo },
  { message: "entry point อยู่ไหน", expected: "repository", context: selectedRepo },
  { message: "ระบบนี้ใช้ tech stack อะไร", expected: "repository", context: selectedRepo },
  { message: "architecture ของโปรเจกต์เป็นยังไง", expected: "repository", context: selectedRepo },
  { message: "architecture เป็นแบบไหน", expected: "repository", context: selectedRepo },
  { message: "deploy ด้วยอะไร", expected: "repository", context: selectedRepo },
  { message: "dependency สำคัญมีอะไรบ้าง", expected: "repository", context: selectedRepo },
  { message: "ทำไมเลือก Cloudflare Workers", expected: "repository", context: selectedRepo },
  { message: "business logic หลักคืออะไร", expected: "repository", context: selectedRepo },
  { message: "flow ตั้งแต่ LINE webhook ถึง AI เป็นยังไง", expected: "repository", context: selectedRepo },
  { message: "ตอนเลือก repo state ถูกเก็บที่ไหน", expected: "repository", context: selectedRepo },
  { message: "GitHub token ถูกใช้ตอนไหน", expected: "repository", context: selectedRepo },
  { message: "ถ้า AI timeout ระบบทำอะไรต่อ", expected: "repository", context: selectedRepo },
  { message: "bot.service.ts ทำงานยังไง", expected: "repository", context: selectedRepo },
  { message: "createReply ทำอะไร", expected: "repository", context: selectedRepo },
  { message: "ฟังก์ชันนี้มีหน้าที่อะไร", expected: "repository", context: selectedRepo },
  { message: "code นี้มี bug ไหม", expected: "repository", context: selectedRepo },
  { message: "มี security risk ตรงไหนบ้าง", expected: "repository", context: selectedRepo },
  { message: "ควร refactor ส่วนไหน", expected: "repository", context: selectedRepo },
  { message: "performance มีคอขวดตรงไหน", expected: "repository", context: selectedRepo },
  { message: "test coverage ควรเพิ่มตรงไหน", expected: "repository", context: selectedRepo },
  { message: "โครงสร้าง service แบบนี้โอเคไหม", expected: "repository", context: selectedRepo },
  { message: "Service ใช้ทำอะไร", expected: "repository", context: selectedRepo },
  { message: "มี function อะไรบ้าง", expected: "repository", context: selectedRepo },
  { message: "ฟังก์ชันมีอะไรบ้าง", expected: "repository", context: selectedRepo },
  { message: "แสดง API endpoints ทั้งหมด", expected: "repository", context: selectedRepo },
  { message: "แล้วฝั่ง admin ทำอะไรได้บ้าง", expected: "repository", context: selectedRepo },
  { message: "การยืมทำงานยังไง", expected: "repository", context: selectedRepo },
  { message: "แล้วขั้นตอนคืนหนังสือทำงานอย่างไร มี business rule อะไรบ้าง", expected: "repository", context: selectedRepo },
  { message: "มีกฎธุรกิจอะไร", expected: "repository", context: selectedRepo },
  { message: "style การเขียนล่ะ", expected: "repository", context: selectedRepo },
  { message: "auth ปลอดภัยไหม", expected: "repository", context: selectedRepo },
  { message: "test ยังขาดอะไร", expected: "repository", context: selectedRepo },
  { message: "จากที่วิเคราะห์มาทั้งหมด สรุปข้อเสนอปรับปรุง 3 ข้อ เรียงตาม priority", expected: "repository", context: selectedRepo },
  { message: "ถ้าจะ refactor ควรเริ่มตรงไหนก่อน เพราะอะไร อ้างอิงไฟล์จริง", expected: "repository", context: selectedRepo },
  { message: "Controller ทำหน้าที่อะไร", expected: "repository", context: selectedRepo },
  { message: "ถ้าจะรองรับ GitLab ควรแก้อะไร", expected: "repository", context: selectedRepo },
  { message: "/ask JWT คืออะไร", expected: "general", context: selectedRepo },
  { message: "/code JWT คืออะไร", expected: "repository", context: selectedRepo },
  { message: "/code 1 + 1 ได้อะไร", expected: "out_of_scope", context: selectedRepo },
  {
    message: "แล้วส่วนนี้ล่ะ",
    expected: "repository",
    context: { hasSelectedRepository: true, previousMode: "repository" },
  },
  {
    message: "อธิบายเพิ่มหน่อย",
    expected: "general",
    context: { hasSelectedRepository: true, previousMode: "general" },
  },
  {
    message: "อธิบายสั้นๆ",
    expected: "repository",
    context: { hasSelectedRepository: true, previousMode: "repository" },
  },
  {
    message: "เป็นระบบใช้ทำอะไร",
    expected: "repository",
    context: { hasSelectedRepository: true, previousMode: "repository" },
  },
  {
    message: "ใช้ทำอะไร",
    expected: "repository",
    context: { hasSelectedRepository: true, previousMode: "repository" },
  },
  { message: "1 + 1 ได้อะไร", expected: "out_of_scope", context: selectedRepo },
  {
    message: "แล้ว 1 + 1 ได้อะไร",
    expected: "out_of_scope",
    context: { hasSelectedRepository: true, previousMode: "repository" },
  },
  { message: "/ask 1 + 1 ได้อะไร", expected: "out_of_scope", context: selectedRepo },
  { message: "วันนี้ฝนตกไหม", expected: "out_of_scope", context: selectedRepo },
  { message: "แต่งกลอนรักให้หน่อย", expected: "out_of_scope", context: selectedRepo },
  { message: "แนะนำร้านอาหารใกล้ฉัน", expected: "out_of_scope", context: selectedRepo },
];

for (const entry of cases) {
  test(`${entry.expected}: ${entry.message}`, () => {
    const decision = router.classify(
      entry.message,
      entry.context ?? { hasSelectedRepository: false },
    );
    assert.equal(decision.mode, entry.expected);
  });
}
