# LINE AI Worker

Express webhook running on Cloudflare Workers. It verifies LINE signatures,
calls the Hugging Face OpenAI-compatible router, and replies through the LINE
Messaging API. Each LINE conversation can select a GitHub repository and branch;
the Worker stores that selection in Cloudflare KV and supplies relevant source
files to the model.

คู่มือฉบับเต็มสำหรับศึกษา ติดตั้ง และต่อยอดอยู่ที่
[`POC_GUIDE.md`](./POC_GUIDE.md)

## Architecture

```text
LINE webhook -> Express route -> LINE service -> Bot service
                                            |-> GitHub service
                                            |-> Hugging Face service
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
HF_TOKEN=hf_...
# Optional for private repositories:
GITHUB_TOKEN=github_pat_...
```

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
npx wrangler secret put HF_TOKEN
```

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
/help
```

After selecting a repository and branch, send a normal message to ask about the
code. Repository and branch selection is remembered per LINE conversation.

## Commands

```bash
npm run dev
npm run check
npm run test:local
npm run deploy
```
