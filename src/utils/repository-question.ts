const CODE_SYMBOL_DETAIL =
  /(?:ชื่อ\s*(?:functions?|ฟังก์ชัน)\s*จริง|code[-\s]*level|symbols?|ในไฟล์|signature|exported)/i;

export function normalizeRepositoryQuestion(message: string): string {
  return message
    .normalize("NFKC")
    .toLowerCase()
    .replace(
      /(?:ฟีเจอร์|คุณสมบัติ|ความสามารถ|features?|functionalit(?:y|ies)|capabilit(?:y|ies))/gi,
      " capability ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

export function isCapabilityQuestion(message: string): boolean {
  if (CODE_SYMBOL_DETAIL.test(message)) return false;

  const normalized = normalizeRepositoryQuestion(message);
  if (
    /(?:ทำอะไรได้บ้าง|รองรับอะไร)/i.test(message) ||
    /(?:สมาชิก|ผู้ใช้|user|member|admin|แอดมิน|role|สิทธิ์).*(?:ทำอะไรได้|สามารถทำอะไร|ความสามารถ|สิทธิ์)/i.test(message) ||
    /(?:มี|บอก|สรุป)\s*(?:functions?|ฟังก์ชัน)\s*(?:อะไร)?\s*(?:บ้าง|หลัก)?/i.test(message)
  ) {
    return true;
  }

  if (!/\bcapability\b/i.test(normalized)) return false;
  return (
    /(?:มี|อะไร|ไหน|บ้าง|หลัก|ทั้งหมด|สรุป|บอก|แสดง|list|show|what|which|main|all|does|have)/i.test(normalized) ||
    /^capability$/i.test(normalized)
  );
}
