# LINE AI Worker

Express webhook running on Cloudflare Workers. It verifies LINE signatures,
calls a configurable AI provider (Gemini by default, with Hugging Face available),
and replies through the LINE Messaging API. Each LINE conversation can select a GitHub repository and branch;
the Worker stores that selection in Cloudflare KV and supplies relevant source
files to the model.

คู่มือฉบับเต็มสำหรับศึกษา ติดตั้ง และต่อยอดอยู่ที่
[`POC_GUIDE.md`](./POC_GUIDE.md)

## Architecture

```text
LINE webhook -> Express route -> LINE service -> Bot service
                                            |-> GitHub service
                                            |-> AI provider resolver
                                            |-> AI service (Gemini / Hugging Face)
                                            `-> Cloudflare KV state
```

โค้ด integration ถูกแยกไว้ใน `src/services` ส่วน Flex Message อยู่ใน
`src/presenters` และ `src/index.ts` ทำหน้าที่ประกอบ service กับประกาศ HTTP route
เท่านั้น

## Local development

Keep these values in `.env`. Never commit or share this file:

```env
LINE_CHANNEL_SECRET=...
LINE_CHANNEL_ACCESS_TOKEN=...
AI_PROVIDER=gemini

GEMINI_API_KEY=...
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
GEMINI_MODEL=gemini-3.5-flash-lite
GEMINI_REASONING_EFFORT=low

HF_TOKEN=hf_...
HF_BASE_URL=https://router.huggingface.co/v1
HF_MODEL=meta-llama/Llama-3.1-8B-Instruct:novita

# Optional for private repositories:
GITHUB_TOKEN=github_pat_...
```

Set `AI_PROVIDER=gemini` (the default) or `AI_PROVIDER=huggingface`. Only the
selected provider's API key is required at runtime, but keeping both keys in the
local `.env` makes switching a one-line config change.

Gemini 3.x uses thinking tokens. Keep `GEMINI_REASONING_EFFORT=low` for this
interactive LINE use case so reasoning does not consume a small output budget
before the visible answer is produced.

Install dependencies and start Wrangler:

```bash
npm install
npm run dev
```

The local server runs at `http://127.0.0.1:8787`.

Run the local signed-webhook smoke test in another terminal:

```bash
npm run test:local
```

## Deploy to Cloudflare Workers

Authenticate Wrangler:

```bash
npx wrangler login
```

Upload production secrets interactively. Do not put the values in commands:

```bash
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put HF_TOKEN
```

Upload both AI secrets if you want to switch providers without another secret
setup step. Otherwise, uploading only the selected provider's secret is enough.
The production default is controlled by `AI_PROVIDER` in `wrangler.jsonc`.

Public GitHub repositories do not need a token. For private repositories,
create a fine-grained GitHub token limited to the selected repositories with
`Contents: Read-only`, then upload it without putting the value in the command:

```bash
npx wrangler secret put GITHUB_TOKEN
```

Deploy:

```bash
npm run deploy
```

Publish or update the default Rich Menu:

```bash
npm run richmenu:publish
```

Wrangler prints a public URL. Configure LINE Developers Console with:

```text
https://YOUR_WORKER.workers.dev/webhooks/line
```

Click **Verify**, then enable **Use webhook**.

## LINE commands

```text
/repo owner/repository
/repo
/branches
/branches 2
/branch feature/example
/code explain the architecture
/ask explain JWT
/help
```

After selecting a repository and branch, send a normal message to ask about the
code. Repository and branch selection is remembered per LINE conversation.
Repository retrieval reads the permitted Markdown content internally; internal
guides and all other `.md` files are excluded from model context.
LINE answers use the loaded files as internal evidence. They are concise by
default, show non-Markdown source paths only when requested, and never print Markdown
filenames or paths even when asked directly.

## Commands

```bash
npm run dev
npm run check
npm run test:local
npm run deploy
```
