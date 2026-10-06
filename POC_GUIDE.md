# LINE AI Code Reader — POC Guide

เอกสารนี้อธิบายสิ่งที่ POC ทำ วิธีติดตั้ง การไหลของข้อมูล ข้อจำกัด และจุดที่ควรแก้เมื่อต่อยอด โดยตั้งใจให้ทั้งนักพัฒนาและ AI coding agent อ่านแล้วเริ่มทำงานต่อได้ทันที

## 1. เป้าหมายของ POC

ระบบนี้เป็น **AI Developer Assistant บน LINE** ที่เชื่อมกับ GitHub repository เพื่อช่วยนักพัฒนาเข้าใจ ตรวจสอบ และปรับปรุงระบบ ผู้ใช้เลือก repository และ branch แล้วถามเกี่ยวกับ source code ได้ คำตอบสร้างด้วยโมเดลที่เรียกผ่าน Hugging Face OpenAI-compatible API และ backend ทำงานบน Cloudflare Workers ระบบรองรับบทสนทนาสั้นๆ และความรู้ด้าน software แต่ไม่ใช่ chatbot ทั่วไป

ฟังก์ชันที่มีแล้ว:

- รับ LINE webhook และตรวจ `x-line-signature`
- แสดง loading animation ระหว่างประมวลผลในห้องแชตแบบ 1:1
- แสดง repository เป็น LINE Flex Message แบบ carousel
- รองรับ public และ private repository ตามสิทธิ์ของ `GITHUB_TOKEN`
- เลือก repository และ branch ด้วยคำสั่งหรือภาษาธรรมชาติ
- สนทนาทักทาย/ถามไถ่สั้นๆ และตอบคำถาม programming/technology ได้
- อธิบายการทำงานและ business logic ของโค้ด, review ความเสี่ยง และเสนอแนวทางแก้/refactor จาก repository context
- คำถามที่อ้างถึง “ระบบนี้/แอปนี้/โปรเจกต์นี้” เช่น tech stack และ architecture จะอ่าน manifest กับ config ที่เกี่ยวข้องจาก repo
- ใช้ system prompt กำหนดให้ AI ปฏิเสธคำถามนอกขอบเขต เช่น คณิตศาสตร์ทั่วไป อากาศ ร้านอาหาร และงานเขียนสร้างสรรค์ โดยไม่ต้องมี intent classifier อีกชั้น
- จำคำถามล่าสุดเพื่อช่วยให้ follow-up เช่น “อธิบายเพิ่ม” มีบริบทต่อเนื่อง
- จำ repository/branch แยกตาม LINE user, group หรือ room ด้วย Cloudflare KV
- อ่าน tree ของ repository แล้วเลือกไฟล์ที่เกี่ยวข้องกับคำถาม
- ส่งบริบทของโค้ดให้ LLM และตอบกลับใน LINE
- มี Rich Menu 3 รายการ โดยเมนู Database และ UI ยังตอบว่าไม่พร้อมใช้งาน

## 2. Architecture

```text
LINE user
   |
   v
LINE Messaging API
   |  POST /webhooks/line
   v
src/index.ts
   |-- LineService: signature, loading, reply API
   |-- BotService: command routing และ orchestration
   |     |-- GitHubService: repositories, branches, tree, file contents
   |     |-- RepositoryStateService: selected repo/branch ใน KV
   |     `-- HuggingFaceService: ส่ง context ไปยัง LLM
   `-- repository.presenter.ts: สร้าง Flex Message carousel
```

Webhook ตอบ HTTP `200` ทันทีหลังตรวจ signature แล้วส่งงานต่อด้วย Cloudflare `waitUntil()` เพื่อไม่ให้ LINE รอ request หลักจน timeout

## 3. โครงสร้างไฟล์

```text
LineAI/
├── src/
│   ├── index.ts                         # Express routes และประกอบ dependencies
│   ├── types.ts                         # Shared domain/API types
│   ├── utils.ts                         # Utility ที่ไม่ผูกกับ integration
│   ├── presenters/
│   │   └── repository.presenter.ts      # Repo list และ Flex carousel
│   └── services/
│       ├── bot.service.ts               # Use cases, commands และ routing override
│       ├── github.service.ts            # GitHub REST API และสร้าง repo context
│       ├── hugging-face.service.ts       # LLM client, project scope และ safety prompt
│       ├── line.service.ts               # LINE Messaging API client
│       └── repository-state.service.ts   # Cloudflare KV access
├── assets/
│   ├── rich-menu.svg
│   └── rich-menu.png
├── scripts/
│   └── publish-rich-menu.mjs
├── test/
│   └── local-smoke.mjs
├── .env.example
├── wrangler.jsonc
└── package.json
```

หลักการแบ่ง responsibility:

- `index.ts` ไม่ควรมี business logic
- API call ของผู้ให้บริการแต่ละรายต้องอยู่ใน service ของตัวเอง
- `BotService` จัดการคำสั่งและเลือกเส้นทางจาก state: ถ้ามี selected repo ข้อความปกติจะอ่าน repo เสมอ ถ้าไม่มีก็ถาม AI แบบ software ทั่วไป
- `HuggingFaceService` เป็นจุดเดียวที่กำหนด project scope, คำขอที่อนุญาต/ปฏิเสธ และกฎไม่เปิดเผย secret
- รูปแบบข้อความ LINE ที่ยาวหรือซับซ้อนควรอยู่ใน `presenters`
- secret ต้องมาจาก environment/Cloudflare secret เท่านั้น

## 4. การไหลของคำถามเกี่ยวกับโค้ด

1. ผู้ใช้เลือก repo จาก carousel หรือพิมพ์ `/repo owner/repository`
2. `BotService` ขอข้อมูล repo จาก GitHub และบันทึก default branch ลง KV
3. ผู้ใช้อาจพิมพ์ `/branches` และ `/branch branch-name` เพื่อเปลี่ยน branch
4. เมื่อมี selected repo ข้อความปกติทุกข้อความจะเข้าเส้นทาง repository โดยไม่ผ่าน intent classifier; `/ask` ใช้ข้าม repo และ `/code` ใช้บังคับอ่าน repo
5. `GitHubService` โหลด branch, recursive tree และไฟล์ที่เกี่ยวข้อง โดยใช้คำถามปัจจุบันกับคำถามก่อนหน้าเป็น retrieval context สำหรับ follow-up
6. ระบบให้คะแนน path จากคำในคำถาม แล้วเลือกไม่เกิน 12 ไฟล์ โดยคำถามภาพรวม/วัตถุประสงค์จะให้น้ำหนัก `README`, manifest, entry point, route/controller และเอกสาร architecture มากขึ้น
7. context รวมรายชื่อ path และเนื้อหาไฟล์ โดยจำกัดขนาดเพื่อไม่ให้ prompt ใหญ่เกินไป
8. `HuggingFaceService` ส่งคำถามพร้อม scope prompt ไปยังโมเดล คำตอบเกี่ยวกับ repo ต้องอ้าง path ที่เป็นหลักฐาน แยกข้อเท็จจริงออกจากคำแนะนำ และห้ามแต่งข้อมูลที่ไม่มีใน context
9. `LineService` แบ่งข้อความยาวตามข้อจำกัดของ LINE แล้ว reply

ถ้าผู้ใช้ถามเป็นภาษาไทยแต่โมเดลตอบโดยไม่มีภาษาไทยหรือมีอักษรจีน/ญี่ปุ่น/เกาหลีปน ระบบจะ retry หนึ่งครั้งด้วยข้อกำหนดภาษาแบบเข้มงวด

### Retrieval และ grounding ที่ใช้จริง

- คำถาม overview ให้น้ำหนัก README, manifest และ entry point เพื่อให้โมเดลเห็น purpose/feature/workflow ก่อน setup detail
- คำถาม tech stack ให้น้ำหนัก `package.json` และ runtime config ส่วน business logic ให้น้ำหนัก entry point, orchestration, state/storage และ integration services
- คำถาม component กว้างๆ เช่น `Service ใช้ทำอะไร` จะส่งหลักฐานที่เกี่ยวข้องให้โมเดล และ prompt กำหนดให้ถามกลับเมื่อระบุเป้าหมายไม่ได้จริง
- path จะถูกเพิ่มใน `SELECTED EVIDENCE PATHS` ต่อเมื่อโหลดเนื้อหาไฟล์สำเร็จเท่านั้น path ที่เลือกไว้แต่ fetch ไม่สำเร็จไม่ถือเป็นหลักฐาน
- GitHub request retry transient network error, HTTP 429 และ 5xx สูงสุด 3 ครั้ง และโหลดไฟล์เป็น batch จำกัด concurrency
- คำตอบจากโมเดลต้องอ้าง path ใน allowlist, ไม่มี path/เลขบรรทัดแต่ง, ไม่ถูกตัดกลาง, ไม่ยาวหรือซ้ำเกินเกณฑ์ และไม่มี CJK ปนในคำตอบไทย หากไม่ผ่านจะ retry หนึ่งครั้งแล้วใช้ safe fallback

### การทดสอบคุณภาพแบบหลาย agent

raw transcript และผล judge อยู่ใน `artifacts/evals/` รอบทดสอบจะให้ tester ยิงคำถามผ่าน `BotService` จริงกับ GitHub/Hugging Face แล้วให้ judge อีก agent ตรวจคำตอบกับ source code โดยไม่แก้โค้ด เกณฑ์ final คือทุกข้ออย่างน้อย 26/30 และต้องไม่มี hallucination, invalid citation, fallback หรือ routing ผิด ดู rubric และประวัติรอบได้ใน `artifacts/evals/README.md`

กฎ routing สนทนามีเพียง:

1. จัดการคำสั่ง repository/branch และ explicit override (`/ask`, `/code`)
2. ถ้ามี selected repo ให้โหลด context แล้วส่งข้อความปกติทุกแบบเข้า project-scoped AI
3. ถ้าไม่มี selected repo ให้ส่งเข้า software-scoped AI
4. ให้ system prompt ของ AI ตัดสินใจตอบทักทาย ตอบเรื่อง software/project หรือปฏิเสธคำถามนอกขอบเขต

การให้คะแนน path ภายใน `GitHubService` เป็น retrieval optimization เพื่อเลือกไฟล์ ไม่ใช่ intent gate และไม่ตัดสินว่าผู้ใช้มีสิทธิ์ถามอะไร

ค่าจำกัดปัจจุบันอยู่ใน service ที่เกี่ยวข้อง:

- LINE text: 5,000 ตัวอักษรต่อ message และไม่เกิน 5 messages ต่อ reply
- Flex carousel: แสดงไม่เกิน 12 repositories
- GitHub file: ไม่อ่านไฟล์ที่ใหญ่กว่า 100 KB
- Repository context: ไม่เกิน 48,000 ตัวอักษร
- Source files: เลือกไม่เกิน 12 ไฟล์
- Tree paths ใน prompt: ไม่เกิน 800 paths

## 5. Environment และ secrets

คัดลอก `.env.example` เป็น `.env` สำหรับ local development:

```env
LINE_CHANNEL_ID=...
LINE_CHANNEL_SECRET=...
LINE_CHANNEL_ACCESS_TOKEN=...

HF_TOKEN=hf_...
HF_BASE_URL=https://router.huggingface.co/v1
HF_MODEL=meta-llama/Llama-3.1-8B-Instruct:novita

SYSTEM_PROMPT=You are a helpful assistant. Reply in the same language as the user.
PORT=3000

NGROK_AUTHTOKEN=...
GITHUB_TOKEN=github_pat_...
```

ห้าม commit `.env` หรือวางค่า secret ลงใน source code, README, screenshot หรือคำสั่ง shell ที่จะถูกเก็บใน history

### ตัวแปรแต่ละตัวเอามาจากไหน

| ตัวแปร | เป็น secret | เอามาจากไหน / ใช้ทำอะไร |
| --- | --- | --- |
| `LINE_CHANNEL_ID` | ไม่ใช่ secret | LINE Developers Console → เลือก Provider และ Messaging API channel → **Basic settings** → Channel ID ปัจจุบันเก็บไว้เป็นข้อมูลอ้างอิง แต่ Worker ยังไม่ได้อ่านค่านี้โดยตรง |
| `LINE_CHANNEL_SECRET` | ใช่ | LINE Developers Console → Messaging API channel → **Basic settings** → Channel secret ใช้ตรวจ HMAC signature ว่า webhook มาจาก LINE จริง ผู้ใช้ต้องมีสิทธิ์ที่มองเห็น secret ได้ |
| `LINE_CHANNEL_ACCESS_TOKEN` | ใช่ | LINE Developers Console → Messaging API channel → **Messaging API** → Channel access token ใช้เรียก reply, loading animation และ Rich Menu API |
| `HF_TOKEN` | ใช่ | [Hugging Face Settings → Access Tokens](https://huggingface.co/settings/tokens) → สร้าง token สำหรับแอปนี้ และให้สิทธิ์ **Make calls to Inference Providers** ใช้เป็น Bearer token เรียก AI API |
| `HF_BASE_URL` | ไม่ใช่ secret | URL ของ AI API ปัจจุบันคือ Hugging Face Router `https://router.huggingface.co/v1` ซึ่งรองรับรูปแบบ OpenAI-compatible |
| `HF_MODEL` | ไม่ใช่ secret | Model ID ที่ Hugging Face Inference Providers รองรับ รูปแบบอาจมี provider ต่อท้าย เช่น `model-name:novita` ดู model/provider ที่พร้อมใช้งานจาก Hugging Face Inference Providers |
| `SYSTEM_PROMPT` | ไม่ใช่ secret | ข้อกำหนดพฤติกรรมของ AI ที่ทีมเขียนเอง ไม่ได้เอามาจาก dashboard ใด |
| `PORT` | ไม่ใช่ secret | ค่า port สำหรับ local tooling เดิม ปัจจุบัน Worker ใช้ port ภายในจาก `src/index.ts` และ Wrangler เปิด dev server ที่ `8787` ดังนั้นตัวแปรนี้ยังไม่ถูกใช้งานโดย runtime |
| `NGROK_AUTHTOKEN` | ใช่ | [ngrok Dashboard → Your Authtoken](https://dashboard.ngrok.com/get-started/your-authtoken) ใช้เฉพาะเมื่อรันผ่าน ngrok รุ่นก่อนย้ายไป Cloudflare Workers ปัจจุบัน Worker ไม่ได้ใช้ค่านี้ |
| `GITHUB_TOKEN` | ใช่ | [GitHub Settings → Fine-grained personal access tokens](https://github.com/settings/personal-access-tokens) ใช้อ่านรายชื่อ repo, branches, tree และ file contents |

เอกสารอ้างอิง: [LINE channel secret](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/), [LINE channel access token](https://developers.line.biz/en/docs/basics/channel-access-token/), [Hugging Face access tokens](https://huggingface.co/docs/hub/security-tokens), [Hugging Face Chat Completion](https://huggingface.co/docs/inference-providers/tasks/chat-completion) และ [GitHub fine-grained token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)

### LINE credentials

- `LINE_CHANNEL_SECRET` มีไว้ตรวจ webhook ขาเข้า ห้ามใช้ Channel ID หรือ access token แทน
- `LINE_CHANNEL_ACCESS_TOKEN` มีไว้ยืนยันสิทธิ์ตอน Worker เรียก Messaging API ขาออก
- หาก reissue ค่าใด ต้องอัปเดตทั้ง `.env` สำหรับ local และ Cloudflare Worker secret สำหรับ production

### Hugging Face และ AI API

โค้ดปัจจุบันใช้ Hugging Face เป็น **AI API provider** ไม่ใช่ส่วนที่ผูกตายกับ LINE หรือ GitHub โดย `HuggingFaceService` ส่ง request แบบ OpenAI-compatible ไปที่:

```text
POST {HF_BASE_URL}/chat/completions
Authorization: Bearer {HF_TOKEN}
Model: {HF_MODEL}
```

สร้าง Hugging Face token จากหน้า [Access Tokens](https://huggingface.co/settings/tokens) โดยสร้าง token แยกสำหรับแอปนี้และให้สิทธิ์ `Make calls to Inference Providers` จากนั้นตั้ง model และ base URL ใน `.env` สำหรับ local และ `wrangler.jsonc`/Worker secret สำหรับ production Hugging Face ระบุว่า Router รองรับ OpenAI-compatible Chat Completion จึงสลับ provider ได้ง่าย

#### ใช้ API key ของ AI เจ้าอื่นแทน Hugging Face

ถ้า AI provider อื่นรองรับ OpenAI-compatible `POST /v1/chat/completions` สามารถแทน Hugging Face ได้ เช่น OpenAI-compatible gateway, OpenRouter, Groq, Together หรือ local gateway อย่าง Ollama โดยต้องเปลี่ยน 3 ค่า:

```env
# ตัวอย่างเชิงโครงสร้าง ต้องใช้ค่าจริงตามเอกสารของ provider ที่เลือก
HF_TOKEN=api_key_from_another_ai_provider
HF_BASE_URL=https://provider.example.com/v1
HF_MODEL=provider-model-name
```

วิธีข้างบนเร็วที่สุดสำหรับ POC และไม่ต้องแก้โค้ด เพราะ service ใช้ Bearer token กับ Chat Completions อยู่แล้ว แต่ชื่อ `HF_*` จะทำให้สับสน สำหรับการต่อยอดจริงควร refactor เป็นชื่อกลาง:

```env
AI_API_KEY=...
AI_BASE_URL=https://provider.example.com/v1
AI_MODEL=provider-model-name
```

แล้วเปลี่ยนพร้อมกันใน:

1. `.env` และ `.env.example`
2. `wrangler.jsonc`
3. `src/index.ts`
4. `src/services/hugging-face.service.ts` โดยเปลี่ยนชื่อเป็น `ai.service.ts` หรือ `openai-compatible.service.ts`
5. Cloudflare secret ด้วย `npx wrangler secret put AI_API_KEY`

ถ้า provider ไม่รองรับ OpenAI-compatible Chat Completions ห้ามเปลี่ยนเฉพาะ API key เพราะ request/response schema อาจไม่เหมือนกัน ให้สร้าง adapter service ใหม่ที่แปลง request และ response ของ provider นั้น แต่คง public method เป็น `answerRepositoryQuestion()` เพื่อให้ `BotService` ไม่ต้องเปลี่ยน

ไม่ว่าจะใช้ provider ใด ต้องตรวจราคา, rate limit, context window, data retention และนโยบายการส่ง private source code ก่อนใช้งานจริง

### GitHub fine-grained token

สำหรับ private repository:

1. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens
2. `Resource owner` ต้องเป็นเจ้าของ repo ซึ่งคือชื่อหน้ `/` เช่น repo `MyCompany/api` มี owner เป็น `MyCompany`
3. เลือก `Only select repositories` แล้วเลือก repo ที่ต้องการ หรือเลือก `All repositories`
4. ตั้ง `Repository permissions → Contents → Read-only`
5. ถ้า owner เป็น Organization อาจต้องรอ organization owner อนุมัติ token ระหว่างที่ยัง `Pending` token จะอ่านได้เฉพาะ public resources

Fine-grained token หนึ่งอันผูกกับ resource owner เดียว หากต้องอ่านหลาย organization ควรออกแบบ credential strategy ใหม่ เช่น GitHub App แทนการเพิ่ม token หลายตัวลงโค้ดโดยตรง

## 6. ติดตั้งและรันในเครื่อง

ต้องใช้ Node.js 20–22 ตาม `package.json`

```bash
npm install
npm run dev
```

Wrangler เปิด local Worker ที่ `http://127.0.0.1:8787`

ตรวจ health endpoint:

```bash
curl http://127.0.0.1:8787/health
```

ผลที่คาดหวัง:

```json
{"status":"ok"}
```

รัน smoke test จากอีก terminal:

```bash
npm run test:local
```

Smoke test ตรวจ health endpoint, ปฏิเสธ webhook ที่ไม่มี signature และยอมรับ webhook ที่เซ็นถูกต้อง

## 7. Deploy ไป Cloudflare Workers

ล็อกอินและสร้าง type definitions:

```bash
npx wrangler login
npm run check
```

อัปโหลด secret แบบ interactive:

```bash
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put HF_TOKEN
npx wrangler secret put GITHUB_TOKEN
```

Deploy:

```bash
npm run deploy
```

Webhook URL คือ:

```text
https://YOUR_WORKER.workers.dev/webhooks/line
```

นำ URL ไปใส่ที่ LINE Developers Console → Messaging API → Webhook URL จากนั้นกด `Verify` และเปิด `Use webhook`

ค่า KV binding ชื่อ `REPO_STATE` ถูกประกาศใน `wrangler.jsonc` หากสร้าง Worker ใหม่ต้องสร้าง KV namespace ใหม่และแก้ `id` ให้ตรงกับ account นั้น

## 8. Rich Menu

Rich Menu ถูกสร้างผ่าน Messaging API ด้วย script:

```bash
npm run richmenu:publish
```

Script ใช้ `LINE_CHANNEL_ACCESS_TOKEN` จาก `.env`, สร้าง menu, อัปโหลด `assets/rich-menu.png` และตั้งเป็น default Rich Menu

ข้อความที่ปุ่มส่ง:

- `ดู Code ใน Repo` → โหลด repositories และแสดง Flex carousel
- `อ่านข้อมูลบน Database` → ตอบว่ายังไม่พร้อมใช้งาน
- `ตรวจสอบหน้า UI` → ตอบว่ายังไม่พร้อมใช้งาน

การ publish ซ้ำจะสร้าง Rich Menu ใหม่ ควรเพิ่มขั้นตอนลบหรือ reuse menu เดิมก่อนใช้ใน production เพื่อไม่ให้มี resource ค้างจำนวนมาก

## 9. คำสั่งที่รองรับ

```text
/repo owner/repository   เลือก repository
/repo                    ดู repository และ branch ปัจจุบัน
/branches                ดู branches หน้าแรก
/branches 2              ดู branches หน้าที่สอง
/branch feature/example  เลือก branch
/code คำถาม             บังคับให้อ่าน repo ที่เลือก
/ask คำถาม              ถามความรู้ software ทั่วไปโดยไม่อ่าน repo
/help                    แสดงวิธีใช้
```

รองรับประโยคธรรมชาติบางรูปแบบ เช่น:

```text
มี repo อะไรบ้าง
ดูโค้ดใน repo owner/repository
มี branch อะไรบ้าง
เปลี่ยน branch เป็น develop
```

Natural-language parser ใช้ deterministic rules เฉพาะคำสั่งเลือก repo/branch เท่านั้น ข้อความสนทนาปกติไม่มี intent classifier: เมื่อเลือก repo แล้วทุกข้อความจะเข้า project-scoped AI ส่วน `/ask` ใช้ถามความรู้ software โดยไม่อ่าน repo

ระบบเก็บ `lastQuestion` เพื่อช่วย retrieval ของ follow-up เช่น `อธิบายเพิ่ม` แต่โมเดลยังต้องตอบคำถามปัจจุบันเป็นหลัก

## 10. Security ที่ทำแล้ว

- ตรวจ HMAC-SHA256 ของ LINE webhook จาก raw body ก่อน parse JSON
- ไม่เก็บ token ใน repository
- จำกัด timeout ของ LINE loading, GitHub และ LLM requests
- retry/backoff สำหรับ GitHub transient network error, HTTP 429 และ 5xx
- ไม่ถือ path เป็นหลักฐานจนกว่าจะโหลด file content สำเร็จ
- ตรวจ path allowlist, output truncation, ความยาว, CJK และเลขบรรทัดก่อนส่งคำตอบเกี่ยวกับ repo
- จำกัดจำนวนและขนาด source files ที่อ่าน
- บอกโมเดลให้ถือว่า repository content เป็น untrusted data และไม่ทำตามคำสั่งในไฟล์
- GitHub integration ใช้สิทธิ์ read-only ตามหลัก least privilege

สิ่งที่ควรทำก่อน production:

- เพิ่ม webhook event deduplication ด้วย `webhookEventId`
- เพิ่ม structured logging, request ID และ latency metrics
- เพิ่ม retry/backoff สำหรับ LINE และ AI upstream failures (GitHub ทำแล้ว)
- เพิ่ม rate limiting และ quota ต่อ user/conversation
- เพิ่ม secret rotation และ runbook
- เพิ่ม unit/integration tests ของ command routing และ GitHub failures
- ตรวจเรื่อง license และการส่ง private source code ไปยัง LLM provider
- พิจารณา GitHub App สำหรับ organization/multi-tenant use case

## 11. Troubleshooting

### `Cannot GET /webhooks/line`

Webhook route รองรับ `POST` เท่านั้น การเปิดด้วย browser จะเป็น `GET` จึงไม่ใช่วิธีทดสอบ route ใช้ปุ่ม `Verify` ใน LINE Developers Console หรือ smoke test แทน

### Health endpoint ตอบ `{"status":"ok"}` แต่บอตไม่ตอบ

ตรวจตามลำดับ:

1. Webhook URL ลงท้าย `/webhooks/line`
2. เปิด `Use webhook`
3. ปิด Auto-reply messages หากไม่ต้องการข้อความซ้ำ
4. Secret ใน Cloudflare ตรงกับ channel ปัจจุบัน
5. ดู Worker logs ด้วย `npx wrangler tail`
6. ตรวจ quota/error ของ Hugging Face และ GitHub

### เห็นเฉพาะ public repositories

แปลว่า token ใช้งานได้แต่ไม่มีสิทธิ์ private repo ที่ต้องการ ตรวจ `Resource owner`, `Repository access`, `Contents: Read-only` และสถานะอนุมัติของ Organization

### ตอบช้าหรือเหมือนค้าง

ระบบแสดง loading animation สูงสุด 60 วินาที แต่ LLM timeout ที่ 45 วินาที งานอ่าน repo ต้องเรียก GitHub หลาย request ตามจำนวนไฟล์ หากต้องการ latency ต่ำลงให้ลด `MAX_SOURCE_FILES`, ทำ cache หรือสร้าง repository index ล่วงหน้า

## 12. แนวทางต่อยอด

### เพิ่ม Database feature

สร้าง service ใหม่ เช่น `database.service.ts` แล้วให้ `BotService` เรียกผ่าน interface ที่จำกัดเฉพาะ read-only query อย่าให้ LLM สร้าง SQL แล้วรันโดยไม่มี allowlist, parameterization และ authorization

### เพิ่ม UI inspection

แยก browser/screenshot integration เป็น service ใหม่ กำหนด URL allowlist, timeout และการป้องกัน SSRF ก่อนเปิดใช้กับ URL จากผู้ใช้

### เปลี่ยนโมเดลหรือ provider

ดูขั้นตอนเต็มในหัวข้อ **Hugging Face และ AI API** หาก provider ใหม่รองรับ OpenAI-compatible Chat Completions สามารถเปลี่ยน API key, base URL และ model ได้ หาก schema ไม่ compatible ให้สร้าง implementation ใหม่โดยรักษา method `answerRepositoryQuestion()` เพื่อไม่ให้ `BotService` ต้องรู้รายละเอียด API

## 13. Checklist ก่อนส่งมอบ

```bash
npm run check
npm test
npm run dev
npm run test:local
npm run deploy
```

หลัง deploy ให้ทดสอบใน LINE จริง:

1. กด Rich Menu “ดู Code ใน Repo”
2. เลือก repo จาก carousel
3. ดูและเปลี่ยน branch
4. ถามคำถามที่อ้างถึงไฟล์จริง
5. ถาม project overview, tech stack, architecture, business logic และขอคำแนะนำ refactor
6. ตรวจว่าคำถามปกติหลังเลือก repo ถูกตอบโดยอิง repo และ `/ask` ไม่ส่ง repo context
7. ตรวจว่า AI ปฏิเสธคำถามนอกขอบเขต เช่น `1 + 1 ได้อะไร` โดยไม่คำนวณคำตอบให้
8. ทดสอบ private repo
9. ตรวจว่า Database/UI ตอบว่ายังไม่พร้อมใช้งาน

## 14. Notes for AI coding agents

ก่อนแก้โค้ดให้ AI อ่าน `AGENTS.md`, เอกสารนี้, `wrangler.jsonc` และ service ที่เกี่ยวข้อง ห้ามอ่านหรือแสดงค่า `.env` ใน output

จุดแก้หลัก:

- HTTP route/webhook lifecycle → `src/index.ts`
- Commands, overrides และ conversational flow → `src/services/bot.service.ts`
- Project scope, safety policy และ model call → `src/services/hugging-face.service.ts`
- GitHub API/file selection → `src/services/github.service.ts`
- Prompt/model call → `src/services/hugging-face.service.ts`
- LINE API/signature/message splitting → `src/services/line.service.ts`
- KV state → `src/services/repository-state.service.ts`
- Flex Message → `src/presenters/repository.presenter.ts`
- Rich Menu provisioning → `scripts/publish-rich-menu.mjs`

รักษา behavior สำคัญ: signature ต้องตรวจจาก raw body, webhook ต้องตอบเร็วและใช้ `waitUntil`, secret ต้องไม่เข้า source control, repository content ต้องถูกถือเป็น untrusted input และทุกการเปลี่ยนแปลงต้องผ่าน `npm run check`, `npm test` กับ smoke test
