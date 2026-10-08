import type { LineMessage, LineReply, LineWebhookEvent } from "../types";
import { errorMessage } from "../utils";

const LINE_API_BASE_URL = "https://api.line.me";
const LINE_TEXT_LIMIT = 5_000;
const LINE_MESSAGES_PER_REPLY_LIMIT = 5;

export class LineService {
  constructor(
    private readonly channelSecret: string,
    private readonly channelAccessToken: string,
  ) {}

  async verifySignature(rawBody: Uint8Array, signature: string): Promise<boolean> {
    let signatureBytes: Uint8Array<ArrayBuffer>;
    try {
      signatureBytes = Uint8Array.from(atob(signature), (character) =>
        character.charCodeAt(0),
      );
    } catch {
      return false;
    }

    const secretBytes = new TextEncoder().encode(this.channelSecret);
    const bodyBytes = Uint8Array.from(rawBody);
    const key = await crypto.subtle.importKey(
      "raw",
      secretBytes.buffer,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );

    return crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes.buffer,
      bodyBytes.buffer,
    );
  }

  async reply(replyToken: string, reply: LineReply): Promise<void> {
    const messages: LineMessage[] = typeof reply === "string"
      ? this.splitText(this.preventBareMarkdownAutoLinks(reply)).map((text) => ({ type: "text", text }))
      : Array.isArray(reply)
        ? reply.map((message) => this.sanitizeTextMessage(message))
        : [this.sanitizeTextMessage(reply)];

    const response = await fetch(`${LINE_API_BASE_URL}/v2/bot/message/reply`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.channelAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ replyToken, messages }),
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(
        `LINE reply failed (${response.status})${detail ? `: ${detail}` : ""}`,
      );
    }
  }

  async showLoadingAnimation(userId: string): Promise<void> {
    try {
      const response = await fetch(
        `${LINE_API_BASE_URL}/v2/bot/chat/loading/start`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.channelAccessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ chatId: userId, loadingSeconds: 60 }),
          signal: AbortSignal.timeout(5_000),
        },
      );

      if (!response.ok) {
        console.warn(`LINE loading animation failed (${response.status})`);
      }
    } catch (error: unknown) {
      console.warn("LINE loading animation failed", errorMessage(error));
    }
  }

  getConversationKey(event: LineWebhookEvent): string | null {
    const source = event.source;
    const id = source?.groupId ?? source?.roomId ?? source?.userId;
    return id ? `line:${source?.type ?? "unknown"}:${id}` : null;
  }

  private splitText(text: string): string[] {
    const chunks: string[] = [];
    for (let index = 0; index < text.length; index += LINE_TEXT_LIMIT) {
      chunks.push(text.slice(index, index + LINE_TEXT_LIMIT));
    }
    return chunks.slice(0, LINE_MESSAGES_PER_REPLY_LIMIT);
  }

  private sanitizeTextMessage(message: LineMessage): LineMessage {
    return message.type === "text"
      ? { ...message, text: this.preventBareMarkdownAutoLinks(message.text) }
      : message;
  }

  private preventBareMarkdownAutoLinks(text: string): string {
    return text.replace(
      /(^|[\s`'"([{])([a-z0-9_-]+)\.md\b/gim,
      "$1$2\u2060.md",
    );
  }
}
