import { httpServerHandler } from "cloudflare:node";
import { env, waitUntil } from "cloudflare:workers";
import express, { type Request, type Response } from "express";
import { BotService } from "./services/bot.service";
import { GitHubService } from "./services/github.service";
import { HuggingFaceService } from "./services/hugging-face.service";
import { LineService } from "./services/line.service";
import { RepositoryStateService } from "./services/repository-state.service";
import type { AppEnv, LineWebhookBody, LineWebhookEvent } from "./types";
import { errorMessage } from "./utils";

const bindings = env as AppEnv;
const lineService = new LineService(
  bindings.LINE_CHANNEL_SECRET,
  bindings.LINE_CHANNEL_ACCESS_TOKEN,
);
const botService = new BotService(
  new GitHubService(bindings.GITHUB_TOKEN),
  new HuggingFaceService({
    baseUrl: bindings.HF_BASE_URL,
    token: bindings.HF_TOKEN,
    model: bindings.HF_MODEL,
    systemPrompt: bindings.SYSTEM_PROMPT,
  }),
  new RepositoryStateService(bindings.REPO_STATE),
);

const app = express();
app.disable("x-powered-by");

app.get("/", (_request: Request, response: Response) => {
  response.json({
    service: "line-ai-worker",
    status: "ok",
    webhook: "/webhooks/line",
  });
});

app.get("/health", (_request: Request, response: Response) => {
  response.json({ status: "ok" });
});

app.post(
  "/webhooks/line",
  express.raw({ type: "application/json", limit: "1mb" }),
  async (request: Request, response: Response) => {
    const signature = request.header("x-line-signature");
    const rawBody = request.body;
    if (
      !signature ||
      !Buffer.isBuffer(rawBody) ||
      !(await lineService.verifySignature(new Uint8Array(rawBody), signature))
    ) {
      response.status(401).json({ error: "Invalid LINE webhook signature" });
      return;
    }

    let webhook: LineWebhookBody;
    try {
      webhook = JSON.parse(rawBody.toString("utf8")) as LineWebhookBody;
    } catch {
      response.status(400).json({ error: "Invalid JSON payload" });
      return;
    }

    const processing = Promise.all(
      (webhook.events ?? []).map(handleLineEvent),
    ).catch((error: unknown) => {
      console.error("LINE webhook processing failed", errorMessage(error));
    });
    waitUntil(processing);
    response.status(200).json({ ok: true });
  },
);

async function handleLineEvent(event: LineWebhookEvent): Promise<void> {
  if (
    event.type !== "message" ||
    event.message?.type !== "text" ||
    !event.message.text ||
    !event.replyToken
  ) {
    return;
  }

  try {
    if (event.source?.type === "user" && event.source.userId) {
      await lineService.showLoadingAnimation(event.source.userId);
    }
    const answer = await botService.createReply(
      event.message.text.trim(),
      lineService.getConversationKey(event),
    );
    await lineService.reply(event.replyToken, answer);
  } catch (error: unknown) {
    console.error(
      `Failed to handle LINE event ${event.webhookEventId ?? "unknown"}`,
      errorMessage(error),
    );
    await lineService.reply(
      event.replyToken,
      "ขออภัย ระบบ AI ขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง",
    ).catch((replyError: unknown) => {
      console.error("Failed to send fallback LINE reply", errorMessage(replyError));
    });
  }
}

app.listen(3000);

export default httpServerHandler({ port: 3000 });
