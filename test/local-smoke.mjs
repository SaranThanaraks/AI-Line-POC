import { createHmac } from "node:crypto";
import assert from "node:assert/strict";

const baseUrl = process.env.TEST_BASE_URL ?? "http://127.0.0.1:8787";
const channelSecret = process.env.LINE_CHANNEL_SECRET;

assert(channelSecret, "LINE_CHANNEL_SECRET is required");

const healthResponse = await fetch(`${baseUrl}/health`);
assert.equal(healthResponse.status, 200);
assert.deepEqual(await healthResponse.json(), { status: "ok" });

const unsignedResponse = await fetch(`${baseUrl}/webhooks/line`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ destination: "test", events: [] }),
});
assert.equal(unsignedResponse.status, 401);

const body = JSON.stringify({ destination: "test", events: [] });
const signature = createHmac("sha256", channelSecret)
  .update(body)
  .digest("base64");
const signedResponse = await fetch(`${baseUrl}/webhooks/line`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-line-signature": signature,
  },
  body,
});
assert.equal(signedResponse.status, 200);
assert.deepEqual(await signedResponse.json(), { ok: true });

console.log("Local smoke tests passed.");
