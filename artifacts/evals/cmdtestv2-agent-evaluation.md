# CMDTESTV2 Agent Evaluation

วันที่ทดสอบ: 2026-10-06

Repository: `SaranThanaraks/CMDTESTV2`

Branch: `main`
Ground-truth commit: `def567a28312c2cc7dc0aeee14321d3b9fe46e3e`

เอกสารนี้เก็บคำถาม คำตอบ และการปรับปรุงจากการทดสอบแบบหลาย agent โดยไม่เก็บ token, secret หรือ source code เต็มไฟล์

## วิธีทดสอบ

- Agent 1 อ่าน source จริงและสร้าง ground truth ครอบคลุม purpose, functions, architecture, style, workflow, auth/security, business rules, refactor, risks และ test gaps
- Agent 2 สนทนากับ `BotService` ต่อเนื่องเหมือนผู้ใช้ LINE พร้อมเก็บ routed mode, evidence paths, call path และเวลา
- Agent 3 ตรวจคำตอบเทียบ ground truth โดยไม่แก้ source
- รอบที่ preflight เลือก repo ไม่สำเร็จถูกทำเครื่องหมาย invalid และไม่นำมาวัดคุณภาพคำตอบ

## สิ่งที่พบใน valid round ก่อนแก้

- คำถามหา function ถูก natural-language command แย่งไปตอบรายชื่อ repository
- คำถาม refactor หลุดไป general mode
- architecture, borrow/return flow, admin capability และ code analysis หลายข้อจบที่ grounding fallback
- คำถามทักทายที่มี “ช่วยอะไรได้บ้าง” ถูกปฏิเสธเป็น out-of-scope
- Retrieval ไม่มี profile เฉพาะ architecture, style, security, refactor และ test gaps
- Hugging Face ตอบ HTTP 402 หลังยิงหลายคำถามต่อเนื่อง จึงเพิ่ม deterministic answer สำหรับข้อเท็จจริงที่ parse จาก source ได้

## Final regression transcript

### 1. โปรเจคนี้ทำอะไร

> โปรเจกต์นี้เป็นเว็บระบบห้องสมุดสำหรับยืมหนังสือ สมาชิกสมัคร/ล็อกอิน ดูหนังสือและรายการยืม แล้วส่งคำขอยืมได้ ส่วนแอดมินเพิ่มหนังสือและดูรายการยืมตามสถานะได้
>
> หลักฐาน: `package.json`, `app/page.tsx`, `app/api/books/route.ts`, `app/api/borrow/route.ts`, `app/api/admin/loans/route.ts`

ผล: repository mode, ตรง domain และบทบาทหลัก

### 2. มี function อะไรบ้าง

> ถ้าหมายถึงความสามารถของโปรเจกต์ มี 6 กลุ่มหลัก: สมัคร/ล็อกอิน, catalog/เพิ่มหนังสือ, ยืมพร้อมตรวจ overdue/quota/stock, ดูประวัติ, แอดมินค้นหา loan/บันทึกคืน และคำนวณ due/fine/report (`app/page.tsx`, `app/admin/page.tsx`, `lib/libraryService.ts`, `lib/loanRules.ts`)

ผล: repository mode, ตีความคำสั้นตามบริบทเป็น business capabilities; ถ้าผู้ใช้ระบุ “ขอชื่อ function จริง” จึงแสดง code symbols

### 3. การยืมทำงานยังไง

> Client ส่ง `bookId` และ token ไป API; `app/api/loans/borrow/route.ts` ตรวจ auth/input แล้วเรียก `borrowBook()`; `lib/libraryService.ts` เปิด transaction/lock และตรวจ overdue, quota, stock; `lib/loanRules.ts` คำนวณ due date; service ลด stockและ insert loan ผ่าน `lib/db.ts` ก่อน commit

ผล: repository mode, trace ข้าม route → service/rules → database

### 4. มีกฎธุรกิจอะไร

> ยืมค้างสูงสุด 3 เล่ม, มี overdue แล้วยืมเพิ่มไม่ได้, ระยะยืม textbook/general/novel เท่ากับ 3/7/14 วัน, ค่าปรับ 20 บาทต่อ overdue weekday โดยข้ามเสาร์-อาทิตย์ และ stock ลดเมื่อยืม/เพิ่มเมื่อคืน (`lib/loanRules.ts`, `lib/libraryService.ts`, `lib/db.ts`)

ผล: repository mode, ตัวเลขตรง ground truth

### 5. architecture เป็นแบบไหน

> เป็น layered modular monolith บน Next.js App Router (`package.json`): UI อยู่ `app/page.tsx`, route ส่งงานไป use case/SQL ใน `lib/libraryService.ts`, PostgreSQL อยู่ `lib/db.ts`; จุดแลกเปลี่ยนคือ service ยังรวม orchestration กับ persistence

ผล: repository mode, ไม่เรียกผิดว่า microservices หรือ monorepo

### 6. style การเขียนล่ะ

> Functional TypeScript แบบ strict ใช้ function/type มากกว่า class; route เป็น thin adapter; SQL แบบ parameterized อยู่ใน `lib/libraryService.ts`; UI ใช้ React hooks ใน `app/page.tsx`/`app/admin/page.tsx`; แนะนำแยก SQL/repository และ shared page helpers

ผล: repository mode, มีทั้ง observed style และ recommendation

### 7. auth ปลอดภัยไหม

> มี scrypt/timing-safe password verification และ signed token พร้อม expiry (`lib/passwords.ts`, `lib/auth.ts`) แต่ `AUTH_SECRET` มี fallback ไป credential/ค่า dev และ token อยู่ใน localStorage แม้มี cookie จึงควรบังคับ secret แยกและเลือก auth transport ให้ชัด (`app/page.tsx`, `lib/auth.ts`)

ผล: repository mode, สมดุล safeguard กับ risk โดยไม่กล่าวอ้างว่าเคยถูกโจมตี

### 8. ควร refactor อะไรก่อน

> แยก `lib/libraryService.ts` ตาม use case และ persistence ก่อน จากนั้นรวม route aliases ให้ใช้ canonical handler และให้ `lib/loanRules.ts` เป็น source of truth แทนการคำนวณ due/fine ซ้ำใน `app/admin/page.tsx`

ผล: repository mode, จัดลำดับและผูกกับไฟล์จริง

### 9. test ยังขาดอะไร

> มี `scripts/fine-rules.mjs`, `scripts/acceptance-cases.mjs`, `scripts/happy-flow.mjs` แต่ happy-flow ยังไม่ได้ register เป็น npm script ใน `package.json`; ควรเพิ่ม auth tamper/expiry/role/secret/logout และ concurrency/rollback สำหรับการแย่ง stock/คืนซ้ำ/transaction fail โดยอิง `lib/auth.ts`, `lib/libraryService.ts`, `lib/db.ts`

ผล: repository mode, แยก existing suites ออกจาก recommendations

## Automated regression

- Intent/routing/retrieval/grounding tests: 115 tests passed
- TypeScript: `tsc --noEmit` passed
- Diff whitespace validation: passed

## Independent final judge

- Verdict: **PASS / PROMOTE**
- ผ่าน 9/9 คำถาม
- คะแนนรวม 106/108
- ไม่พบ path หรือ feature ที่แต่งขึ้น
- ผ่าน promotion gates เรื่อง bare `function` → project capabilities, canonical borrow route, weekend fine, test registration และลำดับ refactor

## Known limitation

Conversation state ยังจำเพียง mode และคำถามล่าสุด ไม่ได้เก็บ structured focus เช่น symbol/path/ข้อค้นพบหลาย turn การถาม “อันที่สองล่ะ” จึงยังควรพัฒนาเป็น structured conversation state ในรอบถัดไป
