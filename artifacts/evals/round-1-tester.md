# Round 1 — Tester Notes

ผู้ทดสอบ: subagent `answer_tester`  
ผู้รัน harness: root agent เนื่องจาก network sandbox ของ subagent ปฏิเสธ external fetch  
วันที่: 2026-10-05

ทดสอบผ่าน `BotService` จริง โดยใช้ `GitHubService` และ `HuggingFaceService` จริงจาก `.env` และ in-memory KV ไม่มีการบันทึก secret

## ผลระดับ routing

- ทั้ง 6 คำถามเข้า `repository` mode ถูกต้อง
- ทุกข้อมี call path `github.buildRepositoryContext → ai.answerRepositoryQuestion`
- ไม่มีคำตอบที่มีอักษรจีน/ญี่ปุ่น/เกาหลีปน

## ปัญหาที่ tester พบ

- คำตอบยังไม่อ้าง file path ในคำถามภาพรวม 2 ข้อแรก
- คำตอบ tech stack กล่าวถึงเพียงโมเดล AI และอ้าง `repository.presenter.ts` อย่างคลุมเครือ จึงไม่ใช่ tech stack ที่ครบถ้วน
- คำตอบ business logic อธิบายการ routing คำถามแทน logic ของผลิตภัณฑ์ และไม่อ้าง source path
- คำตอบของ `TEST-CMD` ระบุ feature/role/workflow จากชื่อโฟลเดอร์โดยไม่มี path หรือหลักฐานในคำตอบ
- `Service ใช้ทำอะไร` ถูก routing ถูกแล้ว แต่โมเดลตีความเป็นภาพรวมทั้ง repo และแต่งรายละเอียดการอัปโหลด/ดาวน์โหลดเอกสาร

Transcript แบบเต็มอยู่ใน `round-1.json`
