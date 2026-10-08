import assert from "node:assert/strict";
import test from "node:test";
import { LineService } from "../src/services/line.service";

test("LINE text replies prevent root Markdown filenames from becoming link previews", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: { messages?: Array<{ type?: string; text?: string }> } = {};
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  try {
    await new LineService("secret", "token").reply(
      "reply-token",
      "อ่าน README.md และ src/guide.md",
    );

    const text = requestBody.messages?.[0]?.text ?? "";
    assert.equal(text, "อ่าน README\u2060.md และ src/guide.md");
    assert.ok(!text.includes("README.md"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
