# Round 1 — Independent Judge

Evaluator: subagent `answer_judge`  
Result: **119/180, average 19.8/30 — ไม่ผ่านเกณฑ์ deploy**

| # | คำถาม | ตรงคำถาม | หลักฐาน/path | ไม่ hallucinate | ภาษา | กระชับ | Routing | รวม |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | Repo นี้เป็นระบบอะไร | 5 | 2 | 5 | 5 | 5 | 5 | 27 |
| 2 | เป็นระบบใช้ทำอะไร | 5 | 2 | 5 | 5 | 5 | 5 | 27 |
| 3 | ระบบนี้ใช้ tech stack อะไร | 1 | 1 | 1 | 4 | 4 | 5 | 16 |
| 4 | business logic หลักคืออะไร | 1 | 0 | 1 | 5 | 2 | 5 | 14 |
| 5 | TEST-CMD: Repo นี้เป็นระบบอะไร | 4 | 0 | 1 | 5 | 4 | 5 | 19 |
| 6 | TEST-CMD: Service ใช้ทำอะไร | 2 | 0 | 1 | 5 | 3 | 5 | 16 |

## Critical findings

- Routing ผ่านทั้ง 6 ข้อแล้ว ปัญหาหลักอยู่ที่ retrieval และ answer grounding
- System prompt สั่งให้อ้าง path แต่โมเดลละเลยครบทั้ง 6 คำตอบ จึงต้องมี validator หลังโมเดลตอบ
- คำตอบ tech stack กล่าวถึงเพียง `HF_MODEL` และอ้าง `src/presenters/repository.presenter.ts` อย่างไม่ตรงสาระ แทนที่จะสรุป TypeScript, Express, Cloudflare Workers/KV, LINE, GitHub และ Hugging Face จาก `package.json`, `wrangler.jsonc` และ `src/index.ts`
- คำตอบ business logic อธิบาย routing ของคำถามแทน logic ของระบบ และกล่าวผิดว่า GitHub API ใช้เก็บ repo/branch ทั้งที่ state อยู่ใน `RepositoryStateService`/Cloudflare KV
- คำถามกำกวม `Service ใช้ทำอะไร` ถูกตีความเป็นทั้งระบบโดยไม่ระบุว่า Service ใด และไม่มี path รองรับ
- Repository temperature `0.7` สูงเกินไปสำหรับงานตอบจากหลักฐาน
- Transcript รอบต่อไปต้องเก็บ `selectedEvidencePaths`, expected mode และ actual mode เพื่อให้ตรวจย้อนกลับได้

## Required changes before round 2

1. เพิ่ม retrieval profile แยก project purpose, tech stack และ business logic
2. ลด repository temperature เป็น `0.1–0.2`
3. validate ว่าคำตอบอ้าง path ที่มีอยู่จริงใน context; retry หนึ่งครั้ง และใช้ safe fallback ถ้ายังไม่ผ่าน
4. ส่ง allowed evidence paths และรูปแบบคำตอบที่ต้องการให้โมเดลอย่างชัดเจน
5. สำหรับคำว่า Service ที่ไม่ระบุชื่อ ให้ระบุการตีความหรือถามกลับเมื่อมีหลายตัว ห้ามเดาเป็นภาพรวมโดยเงียบๆ
6. เพิ่ม semantic regression tests สำหรับ tech stack, business logic และ valid evidence path
