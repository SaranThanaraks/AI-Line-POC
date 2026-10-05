import type { AssistantMode } from "../types";

export type ConversationIntent =
  | { mode: "casual"; reply: string }
  | { mode: "out_of_scope"; reply: string }
  | { mode: AssistantMode; question: string; inherited?: boolean };

export interface IntentContext {
  hasSelectedRepository: boolean;
  previousMode?: AssistantMode;
}

export class IntentRouterService {
  classify(message: string, context: IntentContext): ConversationIntent {
    const trimmed = message.trim();

    const generalOverride = trimmed.match(/^\/ask\s+([\s\S]+)$/i);
    if (generalOverride) {
      const question = generalOverride[1].trim();
      return !this.isClearlyOutOfScope(question) && this.isDeveloperQuestion(question)
        ? { mode: "general", question }
        : this.outOfScope();
    }

    const repositoryOverride = trimmed.match(/^\/code\s+([\s\S]+)$/i);
    if (repositoryOverride) {
      const question = repositoryOverride[1].trim();
      return this.isClearlyOutOfScope(question)
        ? this.outOfScope()
        : { mode: "repository", question };
    }

    const casualReply = this.createCasualReply(trimmed);
    if (casualReply) return { mode: "casual", reply: casualReply };

    if (this.isClearlyOutOfScope(trimmed)) return this.outOfScope();

    if (this.hasRepositoryAnchor(trimmed)) {
      return { mode: "repository", question: trimmed };
    }

    if (
      context.hasSelectedRepository &&
      this.isRepositoryAnalysisRequest(trimmed)
    ) {
      return { mode: "repository", question: trimmed };
    }

    if (context.previousMode && this.isFollowUp(trimmed)) {
      return { mode: context.previousMode, question: trimmed, inherited: true };
    }

    if (this.isDeveloperQuestion(trimmed)) {
      return { mode: "general", question: trimmed };
    }

    return this.outOfScope();
  }

  private outOfScope(): ConversationIntent {
    return {
      mode: "out_of_scope",
      reply: "ขออภัยครับ ผมช่วยเฉพาะเรื่อง programming, software, tech stack และการวิเคราะห์โค้ดใน repo เท่านั้นครับ",
    };
  }

  private createCasualReply(message: string): string | null {
    const normalized = message
      .toLowerCase()
      .replace(/[!,.?？。]+$/g, "")
      .trim();

    if (
      /^(?:สวัสดี|หวัดดี|ดี)(?:ครับ|ค่ะ|คะ|คับ|จ้า|จ๊ะ)?$/.test(normalized) ||
      /^(?:hi|hello|hey|good\s+(?:morning|afternoon|evening))$/.test(normalized)
    ) {
      return [
        "สวัสดีครับ 👋",
        "ผมช่วยตอบคำถาม programming ทั่วไป หรืออ่าน repo เพื่ออธิบาย project, tech stack, business logic และแนะนำการแก้โค้ดได้ครับ",
        "เริ่มอ่านโค้ดได้จากเมนู “ดู Code ใน Repo”",
      ].join("\n");
    }

    if (
      /^(?:ขอบคุณ|ขอบใจ)(?:มาก)?(?:ครับ|ค่ะ|คะ|คับ|จ้า|จ๊ะ)?$/.test(normalized) ||
      /^(?:thanks(?:\s+a\s+lot)?|thank\s+you(?:\s+so\s+much)?)$/.test(normalized)
    ) {
      return "ยินดีครับ 😊 ถามเรื่อง programming หรือให้ช่วยวิเคราะห์ repo ต่อได้เลย";
    }

    if (/^(?:เป็นไง|เป็นไงบ้าง|เป็นยังไงบ้าง|เป็นอย่างไรบ้าง|วันนี้เป็นไง|สบายดีไหม|สบายดีมั้ย|โอเคไหม|โอเคมั้ย|how\s+are\s+you)$/.test(normalized)) {
      return "สบายดีครับ พร้อมช่วยดูโค้ดเต็มที่ 😄 วันนี้อยากให้ช่วยอธิบายหรือ review ส่วนไหนครับ";
    }

    if (/^(?:กินข้าวยัง|กินข้าวหรือยัง|ทำอะไรอยู่|ชื่ออะไร|คุณชื่ออะไร)$/.test(normalized)) {
      return "ผมเป็น AI Developer Assistant ครับ ตอนนี้กำลังรอช่วยตอบคำถามและวิเคราะห์โค้ดให้คุณอยู่ 😄";
    }

    if (/^(?:คุณคือใคร|เธอคือใคร|who\s+are\s+you)$/.test(normalized)) {
      return "ผมเป็น AI Developer Assistant บน LINE ครับ ช่วยตอบเรื่อง programming และอ่าน repo เพื่ออธิบาย project, tech stack, business logic รวมถึงแนะนำการแก้โค้ดได้ครับ";
    }

    if (
      /^(?:ทำอะไรได้บ้าง|ช่วยอะไรได้บ้าง|คุณทำอะไรได้บ้าง|แนะนำตัว(?:หน่อย)?|what\s+can\s+you\s+do)$/.test(normalized)
    ) {
      return [
        "ผมเป็น AI developer assistant ครับ ช่วยได้ทั้ง:",
        "• ตอบคำถาม programming และ tech stack ทั่วไป",
        "• อธิบาย project, architecture และ business logic จาก repo",
        "• review bug, security, performance และ test coverage",
        "• แนะนำวิธีแก้หรือ refactor พร้อมอ้างอิงไฟล์",
      ].join("\n");
    }

    return null;
  }

  private hasRepositoryAnchor(message: string): boolean {
    const normalized = message.toLowerCase();

    if (
      /(?:ระบบ|แอป|application|โปรแกรม|โปรเจกต์|โปรเจค|project|repo|repository|codebase|โค้ด|code|line(?:\s*oa)?|บอท|bot|assistant)\s*(?:นี้|ที่เลือก|ปัจจุบัน|current)/i.test(normalized) ||
      /(?:โปรเจกต์|โปรเจค|project|repo|repository)\s*(?:ทำอะไร|ใช้|มี|รองรับ|เกี่ยวกับ)/i.test(normalized) ||
      /(?:ใน|ของ|จาก)\s*(?:ระบบ|แอป|โปรเจกต์|โปรเจค|project|repo|repository|codebase|รีโป|เรโป|branch|โค้ด|code)(?:นี้|ที่เลือก)?/i.test(normalized) ||
      /(?:สรุป|อธิบาย|วิเคราะห์|review|รีวิว).*(?:โปรเจกต์|โปรเจค|project|repo|repository|codebase)/i.test(normalized) ||
      /(?:ตอน|เมื่อ).*(?:เลือก|อ่าน|เปลี่ยน).*(?:repo|repository|branch|รีโป|เรโป)/i.test(normalized)
    ) {
      return true;
    }

    if (
      /(?:ไฟล์|file|โฟลเดอร์|folder|path|directory)\s+(?:นี้|ไหน|อะไร|ที่|ใน|ของ)/i.test(normalized) ||
      /\b[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|php|rb|cs|cpp|c|h|html|css|scss|sql|jsonc?|ya?ml|toml|md)\b/i.test(message) ||
      /(?:โค้ด|code|source|ฟังก์ชัน|function|method|class|service|controller|module|component)\s*(?:นี้|ชุดนี้|แบบนี้|[`'"][^`'"]+[`'"])/i.test(message) ||
      /(?:ฟังก์ชัน|function|method|class|service|controller|module|component)\s+(?:[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*|[A-Z][A-Za-z0-9]+)/.test(message) ||
      /[`'][^`'\n]+[`']/.test(message)
    ) {
      return true;
    }

    return /(?:^|\s)(?:[\w.-]+\/)+[\w.-]+(?:\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|php|rb|cs|cpp|c|h|html|css|scss|sql|jsonc?|ya?ml|toml|md))?(?:\s|$)/i.test(message) ||
      /\b[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*\b/.test(message);
  }

  private isRepositoryAnalysisRequest(message: string): boolean {
    const normalized = message.toLowerCase();

    if (
      /^(?:business\s*logic|logic\s*ธุรกิจ|ลอจิก(?:ทาง)?ธุรกิจ|refactor|entry\s*point)\s*(?:คืออะไร|หมายถึงอะไร|what\s+is)\s*$/i.test(normalized)
    ) {
      return false;
    }

    return (
      /(?:entry\s*point|จุดเริ่มต้น).*(?:อยู่ไหน|ไฟล์ไหน|ตรงไหน)/i.test(normalized) ||
      /(?:ทำไม|เพราะอะไร).*(?:เลือก|ใช้).*(?:cloudflare|framework|library|database|runtime|worker)/i.test(normalized) ||
      /(?:dependencies?|dependency|แพ็กเกจ|package).*(?:สำคัญ|ใช้อยู่|มีอะไร|ตัวไหน)/i.test(normalized) ||
      /(?:deploy|deployment).*(?:ด้วยอะไร|ยังไง|อย่างไร|ที่ไหน)/i.test(normalized) ||
      /(?:tech\s*stack|techstack|technology\s*stack|เทค\s*สแตก|architecture|สถาปัตยกรรม).*(?:ใช้|มี|เป็นยังไง|อย่างไร|อะไรบ้าง)/i.test(normalized) ||
      /(?:business\s*logic|logic\s*ธุรกิจ|ลอจิก(?:ทาง)?ธุรกิจ).*(?:หลัก|ทำงาน|เป็นยังไง|อย่างไร|มีอะไร)/i.test(normalized) ||
      /(?:flow|data\s*flow|control\s*flow|ลำดับการทำงาน).*(?:ตั้งแต่|ถึง|ของระบบ|ในระบบ|เป็นยังไง)/i.test(normalized) ||
      /(?:github\s*token|line\s*webhook|reply\s*token|signature|cloudflare\s*kv|repo\s*state).*(?:ใช้|เก็บ|ทำงาน|ตรวจ|ตอนไหน|ที่ไหน)/i.test(normalized) ||
      /(?:มี|หา|ตรวจ|เช็ก|check|review|รีวิว).*(?:bugs?|security\s*risk|ช่องโหว่|ความเสี่ยง|คอขวด|bottleneck)/i.test(normalized) ||
      /(?:ควร|ช่วย|แนะนำ).*(?:refactor|แก้|ปรับ|optimi[sz]e).*(?:ส่วนไหน|ตรงไหน|จุดไหน|ไฟล์ไหน|อย่างไร|ยังไง)?/i.test(normalized) ||
      /(?:performance|ประสิทธิภาพ|test\s*coverage|coverage).*(?:คอขวด|เพิ่ม|ปรับ|ขาด|ตรงไหน|จุดไหน)/i.test(normalized) ||
      /(?:ถ้า|หาก).*(?:รองรับ|เพิ่ม|เปลี่ยน|ย้าย).*(?:ควร|ต้อง).*(?:แก้|ปรับ|เปลี่ยน)/i.test(normalized) ||
      /(?:ถ้า|หาก).*(?:timeout|ล้มเหลว|error|ผิดพลาด).*(?:ระบบ|แอป|โค้ด).*(?:ทำอะไร|เกิดอะไร)/i.test(normalized)
    );
  }

  private isFollowUp(message: string): boolean {
    if (message.length > 100) return false;
    return /^(?:แล้ว|แล้วถ้า|แล้วส่วนนี้|ส่วนนี้ล่ะ|ตรงนี้ล่ะ|อันนี้ล่ะ|งั้น|ถ้าอย่างนั้น|ต่อเลย|อธิบาย(?:ให้)?(?:เพิ่ม|สั้น|ละเอียด|ง่าย)|สรุป(?:ให้)?สั้น|สั้นกว่านี้|ขยายความ|มีทางแก้ไหม|แก้ยังไง|ทำยังไงต่อ|มัน(?:ทำงาน|แก้|ปรับ))/i.test(
      message.trim(),
    );
  }

  private isClearlyOutOfScope(message: string): boolean {
    const normalized = message.trim().toLowerCase();
    return (
      /^(?:แล้ว\s*)?\d+(?:\.\d+)?(?:\s*[-+*/x×÷]\s*\d+(?:\.\d+)?)+(?:\s*(?:ได้|เท่ากับ|คือ))?(?:\s*(?:อะไร|เท่าไหร่|เท่าไร))?\s*$/i.test(normalized) ||
      /(?:อากาศ|ฝนตก|อุณหภูมิ|พยากรณ์อากาศ)/i.test(normalized) ||
      /(?:แต่งกลอน|แต่งเพลง|เขียนนิยาย|เล่านิทาน)/i.test(normalized) ||
      /(?:ร้านอาหาร|ร้านกาแฟ|ที่เที่ยว|โรงแรม|เที่ยวไหนดี)/i.test(normalized) ||
      /(?:ผลบอล|ผลบอลสด|เลขเด็ด|ดูดวง|หวย)/i.test(normalized)
    );
  }

  private isDeveloperQuestion(message: string): boolean {
    return /(?:programming|software|developer|development|code|coding|source|โค้ด|โปรแกรม|พัฒนา|typescript|javascript|node(?:\.js)?|nestjs?|express|react|next(?:\.js)?|vue|angular|svelte|python|django|flask|fastapi|java|spring|kotlin|swift|golang|\bgo\b|rust|php|laravel|ruby|rails|c#|\.net|c\+\+|html|css|sass|tailwind|sql|database|ฐานข้อมูล|redis|mongodb|postgres|mysql|api|rest|graphql|grpc|webhook|frontend|backend|fullstack|ui|ux|cloud|cloudflare|aws|azure|gcp|devops|docker|kubernetes|terraform|serverless|git|github|gitlab|branch|commit|pull request|merge request|ci\/cd|pipeline|deploy|runtime|framework|library|package|dependency|architecture|business\s*logic|tech\s*stack|techstack|algorithm|data\s*structure|security|auth|oauth|jwt|token|bug|error|exception|debug|test|coverage|refactor|performance|optimi[sz]e|function|method|class|service|controller|module|component|endpoint|regex|solid|design\s*pattern|microservice|queue|cache|worker)/i.test(
      message,
    );
  }
}
