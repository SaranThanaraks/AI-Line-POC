# Repository Answer Evaluations

ไฟล์ในโฟลเดอร์นี้เก็บ transcript และผลตรวจคำตอบจากการทดสอบแบบหลาย agent เพื่อให้ทีมย้อนดูได้ว่าถามอะไร ระบบตอบอะไร และปรับจากข้อบกพร่องใด

ข้อมูลที่บันทึกต้องไม่มี API token, LINE secret, source code เต็มไฟล์ หรือข้อมูลส่วนตัว โดยเก็บเฉพาะ repository/branch, คำถาม, คำตอบ, routing metadata ที่ไม่ลับ และผลประเมิน

Rubric ต่อคำตอบมี 6 ด้าน ด้านละ 0–5 คะแนน รวม 30 คะแนน:

1. ตอบตรงคำถาม
2. อ้างหลักฐานและ file path ที่ตรวจสอบได้
3. ไม่แต่งข้อเท็จจริงเกินหลักฐาน
4. ใช้ภาษาไทยสะอาด ไม่มีอักษรจีน/ญี่ปุ่น/เกาหลีปนโดยไม่จำเป็น
5. กระชับและอ่านง่ายใน LINE
6. ถูก routing ไปยัง casual, general, repository หรือ out-of-scope ตามเจตนา

เกณฑ์ผ่านรอบสุดท้าย: ทุกคำตอบอย่างน้อย 26/30, ไม่มี critical hallucination, ไม่มี routing ผิด, ไม่มี fallback/truncation และไม่มี path หรือเลขบรรทัดที่หลักฐานยืนยันไม่ได้

## รอบที่บันทึกไว้

- Round 1–3: baseline และรอบแก้ retrieval/grounding ชุดแรก ยังไม่ผ่านเพราะคำตอบกว้าง, อ้าง path ผิด และมีเลขบรรทัดหรือ feature ที่โมเดลแต่งขึ้น
- Round 4–11: รอบพัฒนาแบบ iterative เก็บ raw transcript เพื่อย้อนดู regression เช่น GitHub fetch ชั่วคราวล้มเหลว, validator ตีความ `LINE -` ผิด, README context ไม่ครบ และโมเดลตอบ business flow ยาวเกินไป
- Round 12: candidate แรกที่ผ่าน independent judge ที่ 178/180 หลังเพิ่ม evidence allowlist, retry, route-specific retrieval, structured overview/tech stack/business flow และ deterministic clarification เมื่อชื่อ component กำกวม
- Round 13: final regression ผ่าน 179/180 หลังตัด Wrangler ที่ซ้ำและเพิ่ม `evidenceExcerptSha256` เพื่อยืนยัน excerpt ที่เข้าสู่ context โดยไม่เก็บ source code
- `cmdtestv2-agent-evaluation.md`: การทดสอบสนทนาต่อเนื่องกับ repo ระบบห้องสมุดโดย agent แยกบทบาทเป็น ground-truth, interviewer และ judge ครอบคลุม function inventory, workflow, business rules, architecture, style, security, refactor และ test gaps

ไฟล์ `round-N.json` เก็บคำถามและคำตอบเต็มพร้อม repo, branch, routing, evidence paths และเวลา โดยไม่บันทึก secret ส่วน `round-N-runner.log` เก็บเฉพาะเหตุผลที่ grounding validator ปฏิเสธคำตอบในรอบนั้น ตั้งแต่ Round 13 มี `evidenceExcerptSha256` ซึ่งเป็น hash ของเนื้อหาส่วนที่ส่งเข้า context ไม่ใช่ hash ของ full Git blob
