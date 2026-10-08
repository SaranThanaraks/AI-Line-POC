import {
  createRepositoryCarousel,
  formatRepositoryList,
} from "../presenters/repository.presenter";
import type { GitHubRepository, LineReply, RepoState } from "../types";
import { errorMessage } from "../utils";
import { isCapabilityQuestion } from "../utils/repository-question";
import { GitHubApiError, GitHubService } from "./github.service";
import { AiService } from "./ai.service";
import { RepositoryStateService } from "./repository-state.service";

const GITHUB_BRANCHES_PER_PAGE = 20;
const NO_CONVERSATION_KEY = "ไม่พบรหัสห้องสนทนา จึงยังจำ repo ให้ไม่ได้";
const NO_REPOSITORIES = "GitHub token นี้ยังเข้าถึง repo ไม่ได้ กรุณาตรวจ Repository access ของ Fine-grained token";

export class BotService {
  constructor(
    private readonly github: GitHubService,
    private readonly ai: AiService,
    private readonly repoState: RepositoryStateService,
  ) {}

  async createReply(
    userMessage: string,
    conversationKey: string | null,
  ): Promise<LineReply> {
    if (userMessage === "ดู Code ใน Repo") return this.repositoryCarousel();
    if (userMessage === "อ่านข้อมูลบน Database" || userMessage === "ตรวจสอบหน้า UI") {
      return "ฟีเจอร์นี้ยังไม่พร้อมใช้งาน";
    }
    if (userMessage === "/help") return this.helpMessage();

    const directRepoPrompt = this.extractDirectRepoPrompt(userMessage);
    if (directRepoPrompt && conversationKey) {
      try {
        const target = this.parseGitHubRepo(directRepoPrompt.repo);
        if (target) {
          const repository = await this.github.getRepository(target.owner, target.repo);
          const state: RepoState = {
            owner: target.owner,
            repo: target.repo,
            branch: repository.default_branch,
          };
          await this.repoState.put(conversationKey, state);

          if (directRepoPrompt.question) {
            const answer = await this.answerRepositoryQuestion(directRepoPrompt.question, state);
            await this.repoState.put(conversationKey, {
              ...state,
              lastQuestion: directRepoPrompt.question,
            });
            return `${repository.full_name} (${state.branch})\n\n${answer}`;
          }
          return [
            `ได้ เลือก ${repository.full_name} แล้ว`,
            `ตอนนี้อ่าน branch ${state.branch}`,
            "ถามเกี่ยวกับโค้ดต่อได้เลย",
          ].join("\n");
        }
      } catch (error: unknown) {
        if (!(error instanceof GitHubApiError && error.status === 404)) {
          return this.githubCommandError(error, `อ่าน repo ${directRepoPrompt.repo} ไม่สำเร็จ`);
        }
      }
    }

    if (this.isNaturalBranchListRequest(userMessage)) {
      return this.createReply("/branches", conversationKey);
    }
    const naturalBranchName = this.extractNaturalBranchName(userMessage);
    if (naturalBranchName) return this.createReply(`/branch ${naturalBranchName}`, conversationKey);
    if (this.isNaturalRepoListRequest(userMessage)) return this.listRepositories();

    const naturalRepoName = this.extractNaturalRepoName(userMessage);
    if (naturalRepoName) {
      if (!conversationKey) return NO_CONVERSATION_KEY;
      return this.selectRepositoryByName(naturalRepoName, conversationKey);
    }
    if (this.isNaturalCurrentRepoRequest(userMessage)) {
      return this.createReply("/repo", conversationKey);
    }

    if (userMessage === "/repo") {
      if (!conversationKey) return NO_CONVERSATION_KEY;
      const state = await this.repoState.get(conversationKey);
      return state
        ? `Repo ปัจจุบัน: ${state.owner}/${state.repo}\nBranch: ${state.branch}`
        : "ยังไม่ได้เลือก repo\nเริ่มด้วย: /repo owner/repository";
    }

    const repoCommand = userMessage.match(/^\/repo\s+(.+)$/i);
    if (repoCommand) return this.selectRepository(repoCommand[1], conversationKey);

    const branchesCommand = userMessage.match(/^\/branches(?:\s+(\d+))?$/i);
    if (branchesCommand) {
      return this.listBranches(conversationKey, Number(branchesCommand[1] ?? "1"));
    }

    const branchCommand = userMessage.match(/^\/branch\s+(.+)$/i);
    if (branchCommand) {
      return this.selectBranch(conversationKey, branchCommand[1].trim());
    }

    const state = conversationKey ? await this.repoState.get(conversationKey) : null;
    const generalOverride = userMessage.match(/^\/ask\s+([\s\S]+)$/i);
    if (generalOverride) {
      return this.answerDeveloperQuestion(generalOverride[1].trim());
    }

    const repositoryOverride = userMessage.match(/^\/code\s+([\s\S]+)$/i);
    const question = repositoryOverride?.[1].trim() || userMessage;
    if (!state) {
      if (repositoryOverride) {
        return "ยังไม่ได้เลือก repo\nเริ่มด้วย: /repo owner/repository";
      }
      return this.answerDeveloperQuestion(question);
    }

    try {
      const answer = await this.answerRepositoryQuestion(question, state);
      await this.rememberQuestion(conversationKey, state, question);
      return answer;
    } catch (error: unknown) {
      console.error("Repository question failed", errorMessage(error));
      if (error instanceof GitHubApiError) {
        return this.githubCommandError(error, "อ่านโค้ดจาก GitHub ไม่สำเร็จ");
      }
      const aiFailure = this.aiFailureReply(error);
      if (aiFailure) return aiFailure;
      throw error;
    }
  }

  private async answerRepositoryQuestion(
    question: string,
    state: RepoState,
  ): Promise<string> {
    const repositoryContext = await this.github.buildRepositoryContext(
      state,
      question,
    );
    const context = state.lastQuestion
      ? [
          repositoryContext,
          "CONVERSATION CONTEXT:",
          `Previous user question: ${state.lastQuestion}`,
          "Use it only when the current message is clearly a follow-up. A new concrete topic in the current question always overrides it.",
        ].join("\n")
      : repositoryContext;
    return this.ai.answerRepositoryQuestion(question, context);
  }

  private async answerDeveloperQuestion(question: string): Promise<string> {
    try {
      return await this.ai.answerDeveloperQuestion(question);
    } catch (error: unknown) {
      console.error("Developer question failed", errorMessage(error));
      return this.aiFailureReply(error) ?? "ตอบคำถามไม่สำเร็จชั่วคราว กรุณาลองใหม่อีกครั้งครับ";
    }
  }

  private aiFailureReply(error: unknown): string | null {
    const message = errorMessage(error);
    const status = message.match(/AI provider request failed \((\d+)\)/)?.[1];
    if (!status) return null;
    if (status === "401" || status === "403") {
      return "AI API key ใช้งานไม่ได้หรือไม่มีสิทธิ์ครับ กรุณาตรวจ key ของ provider ที่ตั้งใน AI_PROVIDER";
    }
    if (status === "429") {
      return "AI provider มี quota เต็มหรือรับคำขอมากเกินไปชั่วคราวครับ กรุณารอสักครู่หรือตรวจ quota แล้วลองใหม่ โดย repo และ branch ที่เลือกไว้ยังไม่หาย";
    }
    return "AI API ตอบไม่สำเร็จชั่วคราวครับ กรุณาลองใหม่ โดย repo และ branch ที่เลือกไว้ยังไม่หาย";
  }

  private async rememberQuestion(
    conversationKey: string | null,
    state: RepoState | null,
    question: string,
  ): Promise<void> {
    if (!conversationKey || !state) return;
    await this.repoState.put(conversationKey, {
      ...state,
      lastQuestion: question.slice(-2_000),
    });
  }

  private async listRepositories(): Promise<string> {
    try {
      const repositories = await this.github.getAccessibleRepositories();
      return repositories.length === 0 ? NO_REPOSITORIES : formatRepositoryList(repositories);
    } catch (error: unknown) {
      if (error instanceof GitHubApiError && error.status === 401) {
        return "GITHUB_TOKEN ใช้งานไม่ได้หรือหมดอายุ กรุณาสร้าง token ใหม่";
      }
      return this.githubCommandError(error, "โหลดรายชื่อ repo ไม่สำเร็จ");
    }
  }

  private async repositoryCarousel(): Promise<LineReply> {
    try {
      const repositories = await this.github.getAccessibleRepositories();
      return repositories.length === 0
        ? NO_REPOSITORIES
        : createRepositoryCarousel(repositories);
    } catch (error: unknown) {
      if (error instanceof GitHubApiError && error.status === 401) {
        return "GITHUB_TOKEN ใช้งานไม่ได้หรือหมดอายุ กรุณาสร้าง token ใหม่";
      }
      return this.githubCommandError(error, "โหลดรายชื่อ repo ไม่สำเร็จ");
    }
  }

  private async selectRepository(
    input: string,
    conversationKey: string | null,
  ): Promise<string> {
    if (!conversationKey) return NO_CONVERSATION_KEY;
    const target = this.parseGitHubRepo(input);
    if (!target) {
      return "รูปแบบ repo ไม่ถูกต้อง\nใช้: /repo owner/repository\nหรือ: /repo https://github.com/owner/repository";
    }

    try {
      const repository = await this.github.getRepository(target.owner, target.repo);
      await this.repoState.put(conversationKey, {
        owner: target.owner,
        repo: target.repo,
        branch: repository.default_branch,
      });
      return [
        `เลือก repo แล้ว: ${repository.full_name}`,
        `Branch เริ่มต้น: ${repository.default_branch}`,
        "ดู branch ทั้งหมด: /branches",
        "เลือก branch: /branch ชื่อ-branch",
      ].join("\n");
    } catch (error: unknown) {
      return this.githubCommandError(error, "หา repo ไม่เจอ");
    }
  }

  private async listBranches(
    conversationKey: string | null,
    requestedPage: number,
  ): Promise<string> {
    const state = await this.repoState.require(conversationKey);
    if (typeof state === "string") return state;

    const page = Math.max(1, requestedPage);
    try {
      const branches = await this.github.getBranches(state, page, GITHUB_BRANCHES_PER_PAGE);
      if (branches.length === 0) {
        return page === 1 ? "Repo นี้ไม่มี branch ที่อ่านได้" : `ไม่มี branch ในหน้าที่ ${page}`;
      }
      const lines = branches.map((branch, index) => {
        const selected = branch.name === state.branch ? " ← เลือกอยู่" : "";
        return `${(page - 1) * GITHUB_BRANCHES_PER_PAGE + index + 1}. ${branch.name}${selected}`;
      });
      return [
        `${state.owner}/${state.repo} — branches หน้า ${page}`,
        ...lines,
        "",
        "เลือกด้วย: /branch ชื่อ-branch",
        branches.length === GITHUB_BRANCHES_PER_PAGE ? `หน้าถัดไป: /branches ${page + 1}` : "",
      ].filter(Boolean).join("\n");
    } catch (error: unknown) {
      return this.githubCommandError(error, "โหลดรายชื่อ branch ไม่สำเร็จ");
    }
  }

  private async selectBranch(
    conversationKey: string | null,
    branchName: string,
  ): Promise<string> {
    const state = await this.repoState.require(conversationKey);
    if (typeof state === "string") return state;

    try {
      const branch = await this.github.getBranch(state, branchName);
      await this.repoState.put(conversationKey!, { ...state, branch: branch.name });
      return `เปลี่ยน branch แล้ว: ${branch.name}\nถามเกี่ยวกับโค้ดใน branch นี้ได้เลย`;
    } catch (error: unknown) {
      return this.githubCommandError(error, `หา branch ${branchName} ไม่เจอ`);
    }
  }

  private async selectRepositoryByName(
    requestedName: string,
    conversationKey: string,
  ): Promise<string> {
    try {
      let repository: GitHubRepository;
      if (requestedName.includes("/")) {
        const target = this.parseGitHubRepo(requestedName);
        if (!target) return `ชื่อ repo ไม่ถูกต้อง: ${requestedName}`;
        repository = await this.github.getRepository(target.owner, target.repo);
      } else {
        const repositories = await this.github.getAccessibleRepositories();
        const exactMatches = repositories.filter(
          (repo) => repo.name.toLowerCase() === requestedName.toLowerCase(),
        );
        const matches = exactMatches.length > 0
          ? exactMatches
          : repositories.filter((repo) =>
              repo.name.toLowerCase().includes(requestedName.toLowerCase())
            );
        if (matches.length === 0) {
          return `หา repo ชื่อ ${requestedName} ไม่เจอ\nลองถามว่า “มี repo อะไรบ้าง”`;
        }
        if (matches.length > 1) {
          return [
            `พบ repo ที่ชื่อใกล้เคียง ${requestedName} หลายรายการ:`,
            ...matches.slice(0, 10).map((repo) => `- ${repo.full_name}`),
            "พิมพ์ชื่อเต็ม เช่น: ดูโค้ดใน repo owner/repository",
          ].join("\n");
        }
        repository = matches[0];
      }

      await this.repoState.put(conversationKey, {
        owner: repository.full_name.split("/")[0],
        repo: repository.name,
        branch: repository.default_branch,
      });
      return [
        `ได้ เลือก ${repository.full_name} แล้ว`,
        `ตอนนี้อ่าน branch ${repository.default_branch}`,
        "ถามเกี่ยวกับโค้ดต่อได้เลย หรือถามว่า “มี branch อะไรบ้าง”",
      ].join("\n");
    } catch (error: unknown) {
      return this.githubCommandError(error, `หา repo ${requestedName} ไม่เจอ`);
    }
  }

  private parseGitHubRepo(input: string): { owner: string; repo: string } | null {
    const trimmed = input.trim().replace(/\.git$/i, "");
    let candidate = trimmed;
    if (/^https?:\/\//i.test(trimmed)) {
      try {
        const url = new URL(trimmed);
        if (url.hostname !== "github.com") return null;
        candidate = url.pathname.replace(/^\/+|\/+$/g, "");
      } catch {
        return null;
      }
    }
    const match = candidate.match(
      /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9_.-]+)$/,
    );
    return match ? { owner: match[1], repo: match[2] } : null;
  }

  private isNaturalRepoListRequest(message: string): boolean {
    const lower = message.toLowerCase();
    if (isCapabilityQuestion(message)) return false;
    if (/(?:functions?|methods?|classes?|components?|endpoints?|apis?|ฟังก์ชัน|เมธอด|คลาส|คอมโพเนนต์|features?|ฟีเจอร์|ความสามารถ|business|architecture|code|โค้ด)/i.test(lower)) {
      return false;
    }
    const mentionsRepo = /\b(repos?|repositories|repository)\b/i.test(lower) ||
      /(รีโป|เรโป|โปรเจกต์)/.test(lower);
    return mentionsRepo && /(มี.*อะไร|อะไร.*บ้าง|ทั้งหมด|รายชื่อ|list|show|what|which)/i.test(lower);
  }

  private extractNaturalRepoName(message: string): string | null {
    const patterns = [
      /(?:ดู|อ่าน|เปิด|เลือก|ใช้|เช็ก|ตรวจ)(?:\s*(?:code|โค้ด))?\s*(?:ใน|ของ|จาก)?\s*(?:repo|repository|รีโป|เรโป)\s+(?:ชื่อ\s*)?([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?)/i,
      /(?:select|open|use|read|check)\s+(?:the\s+)?(?:repo|repository)\s+([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?)/i,
    ];
    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match) return match[1];
    }
    return null;
  }

  private isNaturalBranchListRequest(message: string): boolean {
    const lower = message.toLowerCase();
    return /(?:branch|บรานช์)/i.test(lower) &&
      /(มี.*อะไร|อะไร.*บ้าง|ทั้งหมด|รายชื่อ|list|show|what|which)/i.test(lower);
  }

  private extractNaturalBranchName(message: string): string | null {
    const patterns = [
      /(?:เลือก|ใช้|เปลี่ยน)(?:ไป)?\s*(?:branch|บรานช์)\s*(?:เป็น|ไป|to)?\s*([A-Za-z0-9._\/-]+)/i,
      /(?:switch|checkout|use|select)\s+(?:to\s+)?(?:branch\s+)?([A-Za-z0-9._\/-]+)/i,
    ];
    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match) return match[1];
    }
    return null;
  }

  private isNaturalCurrentRepoRequest(message: string): boolean {
    const lower = message.toLowerCase();
    return /(?:repo|repository|รีโป|เรโป)/i.test(lower) &&
      /(ตอนนี้|ปัจจุบัน|current|กำลัง.*(?:ดู|ใช้)|ไหนอยู่)/i.test(lower);
  }

  private extractDirectRepoPrompt(
    message: string,
  ): { repo: string; question: string } | null {
    const match = message.match(
      /^\s*([A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]+)\s*(?:\n+([\s\S]*))?$/,
    );
    return match
      ? { repo: match[1], question: (match[2] ?? "").trim() }
      : null;
  }

  private githubCommandError(error: unknown, fallback: string): string {
    if (error instanceof GitHubApiError) {
      if (error.status === 404) {
        return `${fallback}\nถ้าเป็น private repo ต้องเพิ่ม GitHub token ที่มีสิทธิ์ Contents: read`;
      }
      if (error.status === 403 || error.status === 429) {
        return "GitHub จำกัดจำนวน request ชั่วคราว กรุณาลองใหม่ภายหลัง";
      }
    }
    return fallback;
  }

  private helpMessage(): string {
    return [
      "คำสั่ง GitHub",
      "/repo owner/repository — เลือก repo",
      "/repo — ดู repo และ branch ปัจจุบัน",
      "/branches [หน้า] — ดูรายชื่อ branch",
      "/branch ชื่อ-branch — เปลี่ยน branch",
      "/code คำถาม — บังคับให้อ่าน context จาก repo ที่เลือก",
      "/ask คำถาม — ถามเรื่อง programming ทั่วไปโดยไม่อ่าน repo",
      "/help — ดูคำสั่ง",
      "",
      "เมื่อเลือก repo แล้ว AI จะตอบภายใต้ scope ของ repo นั้นโดยอัตโนมัติ",
    ].join("\n");
  }
}
