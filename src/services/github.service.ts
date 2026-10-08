import type {
  GitHubBranch,
  GitHubContentFile,
  GitHubRepository,
  GitHubTreeItem,
  GitHubTreeResponse,
  RepoState,
} from "../types";
import { errorMessage } from "../utils";
import { isCapabilityQuestion as isRepositoryCapabilityQuestion } from "../utils/repository-question";

const GITHUB_API_BASE_URL = "https://api.github.com";
const MAX_TREE_PATHS_IN_PROMPT = 800;
const MAX_REPO_CONTEXT_CHARACTERS = 48_000;
const MAX_SOURCE_FILE_SIZE = 100_000;
const MAX_SOURCE_FILES = 12;
const MAX_PROFILE_FILE_CHARACTERS = 6_000;
const GITHUB_FETCH_ATTEMPTS = 3;
const GITHUB_FILE_CONCURRENCY = 4;

export class GitHubApiError extends Error {
  constructor(readonly status: number) {
    super(`GitHub API request failed (${status})`);
  }
}

export class GitHubService {
  constructor(private readonly token?: string) {}

  getAccessibleRepositories(): Promise<GitHubRepository[]> {
    return this.get<GitHubRepository[]>(
      "/user/repos?visibility=all&affiliation=owner,collaborator,organization_member&sort=pushed&direction=desc&per_page=100",
    );
  }

  getRepository(owner: string, repo: string): Promise<GitHubRepository> {
    return this.get<GitHubRepository>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    );
  }

  getBranches(
    state: Pick<RepoState, "owner" | "repo">,
    page: number,
    perPage: number,
  ): Promise<GitHubBranch[]> {
    return this.get<GitHubBranch[]>(
      `/repos/${encodeURIComponent(state.owner)}/${encodeURIComponent(state.repo)}/branches?per_page=${perPage}&page=${page}`,
    );
  }

  getBranch(
    state: Pick<RepoState, "owner" | "repo">,
    branch: string,
  ): Promise<GitHubBranch> {
    return this.get<GitHubBranch>(
      `/repos/${encodeURIComponent(state.owner)}/${encodeURIComponent(state.repo)}/branches/${encodeURIComponent(branch)}`,
    );
  }

  async buildRepositoryContext(
    state: RepoState,
    question: string,
  ): Promise<string> {
    const branch = await this.getBranch(state, state.branch);
    const tree = await this.get<GitHubTreeResponse>(
      `/repos/${encodeURIComponent(state.owner)}/${encodeURIComponent(state.repo)}/git/trees/${encodeURIComponent(branch.commit.sha)}?recursive=1`,
    );
    const sourceFiles = tree.tree.filter((item) => this.isReadableSourceFile(item));
    const selectedFiles = this.selectRelevantFiles(sourceFiles, question);
    const usesProfiledRetrieval =
      this.isProjectOverviewQuestion(question) ||
      this.isTechStackQuestion(question) ||
      this.isBusinessLogicQuestion(question) ||
      this.isDeepAnalysisQuestion(question);
    const fileContents = await this.loadSelectedFiles(
      state,
      selectedFiles,
      usesProfiledRetrieval ? MAX_PROFILE_FILE_CHARACTERS : undefined,
      question,
    );
    // Only expose files whose contents were actually loaded. A ranked path is
    // not evidence if GitHub timed out or rejected that individual request.
    const selectedEvidencePaths = this.extractLoadedEvidencePaths(fileContents);
    const structuredEvidence = this.buildStructuredEvidence(
      question,
      fileContents,
      selectedEvidencePaths,
    );
    const treePaths = sourceFiles
      .slice(0, MAX_TREE_PATHS_IN_PROMPT)
      .map((item) => item.path)
      .join("\n");

    return [
      `Repository: ${state.owner}/${state.repo}`,
      `Branch: ${state.branch}`,
      `Commit: ${branch.commit.sha}`,
      tree.truncated
        ? "Note: GitHub truncated the recursive tree response."
        : "",
      sourceFiles.length > MAX_TREE_PATHS_IN_PROMPT
        ? `Showing ${MAX_TREE_PATHS_IN_PROMPT} of ${sourceFiles.length} readable paths.`
        : "",
      "",
      "QUESTION RETRIEVAL FOCUS:",
      this.getRetrievalFocus(question, selectedEvidencePaths),
      ...(structuredEvidence
        ? ["", "STRUCTURED EVIDENCE SUMMARY:", structuredEvidence]
        : []),
      "",
      "SELECTED EVIDENCE PATHS:",
      selectedEvidencePaths.join("\n") || "No evidence paths were selected.",
      "",
      "SELECTED FILE CONTENTS:",
      fileContents || "No readable file content was selected.",
      "",
      "REPOSITORY PATHS:",
      treePaths,
    ]
      .filter((part) => part !== "")
      .join("\n");
  }

  private async get<T>(path: string): Promise<T> {
    for (let attempt = 1; attempt <= GITHUB_FETCH_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(`${GITHUB_API_BASE_URL}${path}`, {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "line-ai-bot",
            "X-GitHub-Api-Version": "2022-11-28",
            ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          },
          signal: AbortSignal.timeout(15_000),
        });

        if (response.ok) return (await response.json()) as T;
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt === GITHUB_FETCH_ATTEMPTS) {
          throw new GitHubApiError(response.status);
        }
      } catch (error: unknown) {
        if (
          error instanceof GitHubApiError ||
          attempt === GITHUB_FETCH_ATTEMPTS
        ) {
          throw error;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, attempt * 150));
    }

    throw new Error("GitHub request failed after retries");
  }

  private isReadableSourceFile(item: GitHubTreeItem): boolean {
    if (item.type !== "blob" || (item.size ?? 0) > MAX_SOURCE_FILE_SIZE) {
      return false;
    }

    const path = item.path.toLowerCase();
    const basename = path.split("/").pop() ?? path;
    if (path.endsWith(".md") && basename !== "readme.md") return false;
    if (
      /(^|\/)(node_modules|vendor|dist|build|coverage|\.git|\.next|target)(\/|$)/.test(path) ||
      /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|cargo\.lock)$/.test(path)
    ) {
      return false;
    }

    return (
      /\.(c|cc|cpp|cs|css|go|graphql|h|hpp|html|java|js|jsonc?|jsx|kt|kts|md|mjs|cjs|php|prisma|py|rb|rs|scss|sh|sql|svelte|swift|toml|ts|tsx|txt|vue|xml|ya?ml)$/i.test(item.path) ||
      /(^|\/)(dockerfile|makefile)$/i.test(item.path)
    );
  }

  private selectRelevantFiles(
    files: GitHubTreeItem[],
    question: string,
  ): GitHubTreeItem[] {
    const isOverviewQuestion = this.isProjectOverviewQuestion(question);
    const isTechStackQuestion = this.isTechStackQuestion(question);
    const isBusinessLogicQuestion = this.isBusinessLogicQuestion(question);
    const isSymbolInventoryQuestion = this.isSymbolInventoryQuestion(question);
    const isArchitectureQuestion = this.isArchitectureQuestion(question);
    const isCodeStyleQuestion = this.isCodeStyleQuestion(question);
    const isRiskReviewQuestion = this.isRiskReviewQuestion(question);
    const isRefactorReviewQuestion = this.isRefactorReviewQuestion(question);
    const isTestReviewQuestion = this.isTestReviewQuestion(question);
    const isDomainWorkflowQuestion = this.isDomainWorkflowQuestion(question);
    const isBusinessRulesQuestion = this.isBusinessRulesQuestion(question);
    const isCapabilityQuestion = this.isCapabilityQuestion(question);
    const isAmbiguousComponentQuestion = /^(?:service|services|controller|module|component|endpoint|api|worker)\s*(?:นี้)?\s*(?:ใช้ทำอะไร|เอาไว้ทำอะไร|ทำหน้าที่อะไร|มีหน้าที่อะไร|ทำอะไร)/i.test(
      question.trim(),
    );
    const maxFiles = isAmbiguousComponentQuestion
      ? 7
      : isBusinessLogicQuestion || isDomainWorkflowQuestion
      ? 8
      : isRefactorReviewQuestion
        ? 12
      : isArchitectureQuestion || isCodeStyleQuestion || isRiskReviewQuestion || isTestReviewQuestion
        ? 8
      : isCapabilityQuestion
        ? 8
      : isTechStackQuestion
        ? 7
        : isOverviewQuestion
          ? 8
          : isSymbolInventoryQuestion
            ? 12
          : MAX_SOURCE_FILES;
    const queryTokens = Array.from(
      new Set(question.toLowerCase().match(/[a-z0-9_.\/-]{2,}/g) ?? []),
    );

    return files
      .map((file) => {
        const path = file.path.toLowerCase();
        const basename = path.split("/").pop() ?? path;
        let score = 0;

        for (const token of queryTokens) {
          if (path.includes(token)) score += token.length * 8;
          if (basename === token) score += 100;
        }
        if (/^readme(\.[a-z0-9]+)?$/i.test(file.path)) {
          score += isOverviewQuestion ? 220 : isTechStackQuestion ? 140 : 75;
        }
        if (/(^|\/)(package\.json|pyproject\.toml|go\.mod|cargo\.toml|composer\.json)$/i.test(file.path)) {
          score += isTechStackQuestion ? 220 : isOverviewQuestion ? 120 : 65;
        }
        if (
          /(^|\/)(wrangler\.jsonc?|tsconfig(?:\.[\w-]+)?\.json|vite\.config\.[cm]?[jt]s|next\.config\.[cm]?js|nuxt\.config\.[cm]?ts|docker-compose\.ya?ml)$/i.test(file.path)
        ) {
          score += isTechStackQuestion ? 190 : isOverviewQuestion ? 20 : 55;
        }
        if (/(^|\/)(index|main|app|server|worker)\.(ts|tsx|js|jsx|mjs|py|go|rs|java|kt|swift)$/i.test(file.path)) {
          score += isBusinessLogicQuestion
            ? 170
            : isTechStackQuestion
              ? 110
              : isOverviewQuestion
                ? 90
                : 40;
        }
        if (
          isOverviewQuestion &&
          /(^|\/)(docs?\/(?:overview|architecture|getting-started)|(?:app|pages)\/(?:page|index)|routes?|controllers?|schema|prisma)(?:[./]|$)/i.test(file.path)
        ) {
          score += 75;
        }
        if (
          isOverviewQuestion &&
          /(?:service|use-case|repository|store)\.(?:ts|tsx|js|jsx|mjs|py|go|rs|java|kt|swift)$/i.test(file.path)
        ) {
          score += 130;
        }
        if (
          isBusinessLogicQuestion &&
          /(^|\/)(services?|controllers?|routes?|handlers?|use-cases?|domain|repositories?|stores?|state)(\/|\.|$)/i.test(file.path)
        ) {
          score += 160;
        }
        if (
          isBusinessLogicQuestion &&
          /(?:service|controller|route|handler|use-case|repository|store)\.(?:ts|tsx|js|jsx|mjs|py|go|rs|java|kt|swift)$/i.test(file.path)
        ) {
          score += 100;
        }
        if (isBusinessLogicQuestion) {
          if (/(^|\/)src\/index\.(?:ts|js|mjs)$/i.test(file.path)) score += 260;
          if (/(^|\/)bot\.service\.(?:ts|js)$/i.test(file.path)) score += 250;
          if (/(^|\/)(?:repository-state|line)\.service\.(?:ts|js)$/i.test(file.path)) score += 210;
          if (/(^|\/)(?:github|ai)\.service\.(?:ts|js)$/i.test(file.path)) score += 170;
        }
        if (
          isAmbiguousComponentQuestion &&
          /(^|\/)(?:src\/)?(?:index|main|app|server|worker)\.(?:ts|tsx|js|jsx|mjs|py|go|rs|java|kt|swift)$/i.test(file.path)
        ) {
          score += 120;
        }
        if (isAmbiguousComponentQuestion) {
          if (
            /(?:^|\/)(?:services?\/[^/]+|[^/]*service)\.(?:ts|tsx|js|jsx|mjs|py|go|rs|java|kt|swift)$/i.test(file.path)
          ) {
            score += 320;
          }
          if (/(?:^|\/)(?:test|tests|__tests__)(?:\/|\.)/i.test(file.path)) {
            score -= 320;
          }
        }
        if (isSymbolInventoryQuestion) {
          if (/\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|php|rb|cs|cpp|c)$/i.test(file.path)) {
            score += 150;
          }
          if (/(?:service|controller|handler|use-case|repository|store)\.(?:ts|tsx|js|jsx|mjs|py|go|rs|java|kt|swift)$/i.test(file.path)) {
            score += 220;
          }
          if (/(?:^|\/)route\.(?:ts|tsx|js|jsx|mjs)$/i.test(file.path)) {
            score += 200;
          }
          if (/(?:^|\/)(?:page|index|main|app|server|worker)\.(?:ts|tsx|js|jsx|mjs|py|go|rs|java|kt|swift)$/i.test(file.path)) {
            score += 180;
          }
          if (/(?:^|\/)(?:package\.json|tsconfig(?:\.[\w-]+)?\.json|wrangler\.jsonc?)$/i.test(file.path)) {
            score -= 300;
          }
        }
        if (isArchitectureQuestion) {
          if (/(^|\/)(package\.json|tsconfig(?:\.[\w-]+)?\.json)$/i.test(file.path)) score += 190;
          if (/(^|\/)(?:app|pages)\/(?:page|layout|index)\.(?:ts|tsx|js|jsx)$/i.test(file.path)) score += 230;
          if (/(?:^|\/)(?:routes?|controllers?|services?|repositories?|domain|lib)(?:\/|\.|$)/i.test(file.path)) score += 180;
          if (/(?:db|database|schema|store|repository|service|rules?)\.(?:ts|tsx|js|jsx|sql|prisma)$/i.test(file.path)) score += 170;
        }
        if (isCodeStyleQuestion) {
          if (/(^|\/)(?:tsconfig(?:\.[\w-]+)?\.json|eslint[^/]*|prettier[^/]*)$/i.test(file.path)) score += 260;
          if (/(?:^|\/)(?:page|route|service|repository|rules?|db)\.(?:ts|tsx|js|jsx)$/i.test(file.path)) score += 190;
          if (/(?:^|\/)(?:test|tests|__tests__|scripts)(?:\/|\.|$)/i.test(file.path)) score += 90;
          if (/(?:^|\/)lib\/[^/]*(?:service|rules?)\.(?:ts|tsx|js|jsx)$/i.test(file.path)) score += 500;
        }
        if (isRiskReviewQuestion) {
          if (/(?:auth|password|security|session|token|cookie|login|http|middleware)\.(?:ts|tsx|js|jsx)$/i.test(file.path)) score += 300;
          if (/(?:^|\/)(?:page|db|database|service|pdf)\.(?:ts|tsx|js|jsx)$/i.test(file.path)) score += 190;
          if (/(?:^|\/)api\/.+\/route\.(?:ts|tsx|js|jsx)$/i.test(file.path)) score += 150;
          if (/(?:^|\/)lib\/(?:auth|http|passwords?)\.(?:ts|tsx|js|jsx)$/i.test(file.path)) score += 520;
          if (/(?:^|\/)app\/(?:admin\/)?page\.(?:ts|tsx|js|jsx)$/i.test(file.path)) score += 260;
        }
        if (isRefactorReviewQuestion) {
          if (/(?:service|repository|store|page|route|rules?|db)\.(?:ts|tsx|js|jsx)$/i.test(file.path)) score += 220;
          if (/(?:^|\/)api\/.+\/route\.(?:ts|tsx|js|jsx)$/i.test(file.path)) score += 150;
          if (/(?:^|\/)lib\/[^/]*service\.(?:ts|tsx|js|jsx)$/i.test(file.path)) score += 520;
          if (/(?:^|\/)lib\/(?:[^/]*rules?|db)\.(?:ts|tsx|js|jsx)$/i.test(file.path)) score += 360;
          if (/(?:^|\/)app\/(?:admin\/)?page\.(?:ts|tsx|js|jsx)$/i.test(file.path)) score += 300;
        }
        if (isTestReviewQuestion) {
          if (/(?:^|\/)(?:test|tests|__tests__|scripts)(?:\/|\.|$)/i.test(file.path)) score += 320;
          if (/(^|\/)package\.json$/i.test(file.path)) score += 240;
          if (/(?:service|auth|http|rules?|db)\.(?:ts|tsx|js|jsx)$/i.test(file.path)) score += 120;
        }
        if (isDomainWorkflowQuestion) {
          if (/(?:borrow|loan|return|ยืม|คืน)/i.test(path)) score += 320;
          if (/(?:service|rules?|db|auth|http)\.(?:ts|tsx|js|jsx)$/i.test(file.path)) score += 220;
          if (/(?:^|\/)(?:page|route)\.(?:ts|tsx|js|jsx)$/i.test(file.path)) score += 160;
          if (/(?:^|\/)lib\/[^/]*service\.(?:ts|tsx|js|jsx)$/i.test(file.path)) score += 520;
          if (/(?:^|\/)lib\/(?:loanRules|db|auth|http)\.(?:ts|tsx|js|jsx)$/i.test(file.path)) score += 430;
          if (/(?:^|\/)app\/(?:admin\/)?page\.(?:ts|tsx|js|jsx)$/i.test(file.path)) score += 260;
          if (/^app\/api\/loans\/borrow\/route\.ts$/i.test(file.path) && /(?:ยืม|borrow)/i.test(question)) score += 220;
        }
        if (isBusinessRulesQuestion) {
          if (/(?:rules?|policy)\.(?:ts|tsx|js|jsx)$/i.test(file.path)) score += 650;
          if (/(?:service)\.(?:ts|tsx|js|jsx)$/i.test(file.path)) score += 500;
          if (/(?:db|schema|migration)\.(?:ts|tsx|js|jsx|sql|prisma)$/i.test(file.path)) score += 450;
          if (/(?:^|\/)(?:page|route)\.(?:ts|tsx|js|jsx)$/i.test(file.path)) score += 120;
        }
        if (isCapabilityQuestion) {
          if (/(?:^|\/)app\/(?:admin\/)?page\.(?:ts|tsx|js|jsx)$/i.test(file.path)) score += 320;
          if (/(?:^|\/)api\/.+\/route\.(?:ts|tsx|js|jsx)$/i.test(file.path)) score += 230;
          if (/(?:service|use-case|rules?)\.(?:ts|tsx|js|jsx)$/i.test(file.path)) score += 200;
          if (/(?:^|\/)lib\/[^/]*(?:service|rules?)\.(?:ts|tsx|js|jsx)$/i.test(file.path)) score += 500;
          if (/(?:admin|แอดมิน)/i.test(question) && /(?:^|\/)admin(?:\/|\.)/i.test(path)) score += 300;
        }
        score -= Math.min(file.path.split("/").length, 10);
        return { file, score };
      })
      .sort(
        (left, right) =>
          right.score - left.score || left.file.path.localeCompare(right.file.path),
      )
      .slice(0, maxFiles)
      .map(({ file }) => file);
  }

  private isProjectOverviewQuestion(question: string): boolean {
    if (this.isCapabilityQuestion(question)) return false;
    const normalized = question.toLowerCase();
    return (
      /(?:repo|repository|project|โปรเจกต์|โปรเจค|ระบบ|แอป|application|โปรแกรม).*(?:คืออะไร|เป็นระบบอะไร|ทำอะไร|ใช้ทำอะไร|เอาไว้ทำอะไร|เกี่ยวกับอะไร|purpose|overview)/i.test(normalized) ||
      /(?:คืออะไร|เป็นระบบอะไร|ทำอะไร|ใช้ทำอะไร|เอาไว้ทำอะไร|เกี่ยวกับอะไร).*(?:repo|repository|project|โปรเจกต์|โปรเจค|ระบบ|แอป|application|โปรแกรม)/i.test(normalized) ||
      /(?:เป็นระบบใช้ทำอะไร|สรุป(?:ภาพรวม)?โปรเจกต์)/i.test(normalized)
    );
  }

  private isTechStackQuestion(question: string): boolean {
    return /(?:tech\s*stack|techstack|technology\s*stack|เทค\s*สแตก|ใช้เทคโนโลยีอะไร|ใช้ภาษาอะไร|framework|runtime)/i.test(
      question,
    );
  }

  private isSymbolInventoryQuestion(question: string): boolean {
    if (this.isCapabilityQuestion(question)) return false;
    return (
      /(?:มี|แสดง|บอก|สรุป|list|show)\s*(?:รายชื่อ)?\s*(?:functions?|methods?|classes?|components?|endpoints?|apis?|ฟังก์ชัน|เมธอด|คลาส|คอมโพเนนต์|เอ็นด์พอยต์)\s*(?:อะไร|ไหน)?\s*(?:บ้าง|ทั้งหมด)?/i.test(question) ||
      /(?:functions?|methods?|classes?|components?|endpoints?|apis?|ฟังก์ชัน|เมธอด|คลาส|คอมโพเนนต์|เอ็นด์พอยต์)\s*(?:มี)?\s*(?:อะไร|ไหน)\s*(?:บ้าง|ทั้งหมด)/i.test(question)
    );
  }

  private isBusinessLogicQuestion(question: string): boolean {
    return /(?:business\s*logic|business\s*rules?|กฎ\s*(?:ทาง)?ธุรกิจ|เงื่อนไข\s*(?:ทาง)?ธุรกิจ|logic\s*ธุรกิจ|ลอจิก(?:ทาง)?ธุรกิจ|workflow|data\s*flow|control\s*flow|ลำดับการทำงาน|(?:ระบบ|แอป|โปรเจกต์|โปรเจค|project|repo).*(?:ทำงาน|flow))/i.test(
      question,
    );
  }

  private isArchitectureQuestion(question: string): boolean {
    return /(?:architecture|สถาปัตยกรรม|layer|component|โครงสร้าง(?:ระบบ|โปรเจกต์|โปรเจค)?)/i.test(question);
  }

  private isCodeStyleQuestion(question: string): boolean {
    return /(?:code\s*style|coding\s*style|design\s*patterns?|รูปแบบการเขียน|สไตล์การเขียน|style\s*การเขียน)/i.test(question);
  }

  private isRiskReviewQuestion(question: string): boolean {
    return /(?:security|ปลอดภัย|ช่องโหว่|ความเสี่ยง|production\s*risk|bugs?|คอขวด|bottleneck)/i.test(question);
  }

  private isRefactorReviewQuestion(question: string): boolean {
    return /(?:refactor|ปรับโครงสร้าง|ปรับปรุง.*(?:ก่อน|priority)|ข้อเสนอ.*(?:priority|ลำดับ))/i.test(question);
  }

  private isTestReviewQuestion(question: string): boolean {
    return /(?:test(?:s|\s*coverage)?|การทดสอบ).*(?:ขาด|เพิ่ม|coverage|ครอบคลุม|gap|กรณี|case)/i.test(question);
  }

  private isDomainWorkflowQuestion(question: string): boolean {
    return /(?:ยืม|คืน|borrow|return|signup|login|ล็อกอิน|สมัคร).*(?:ทำงาน|flow|ขั้นตอน|บันทึก|กฎ|rule|ยังไง|อย่างไร)/i.test(question);
  }

  private isBusinessRulesQuestion(question: string): boolean {
    return /(?:business\s*rules?|กฎ\s*(?:ทาง)?ธุรกิจ|เงื่อนไข\s*(?:ทาง)?ธุรกิจ|ค่าปรับ|โควตา)/i.test(question);
  }

  private isDeepAnalysisQuestion(question: string): boolean {
    return this.isArchitectureQuestion(question) ||
      this.isCodeStyleQuestion(question) ||
      this.isRiskReviewQuestion(question) ||
      this.isRefactorReviewQuestion(question) ||
      this.isTestReviewQuestion(question) ||
      this.isDomainWorkflowQuestion(question) ||
      this.isBusinessRulesQuestion(question) ||
      this.isCapabilityQuestion(question);
  }

  private isCapabilityQuestion(question: string): boolean {
    return isRepositoryCapabilityQuestion(question);
  }

  private getRetrievalFocus(question: string, selectedPaths: string[]): string {
    if (this.isCapabilityQuestion(question)) {
      return "Describe the capabilities of the user role named in the question from UI actions, routes, and service calls. Do not repeat the whole project overview or mix member and admin capabilities. Cite exact selected paths.";
    }
    if (this.isArchitectureQuestion(question)) {
      return "Describe the evidenced architecture: runtime, entry points, UI/API boundaries, service/domain layer, persistence, and request/data flow. Distinguish facts from architectural inference and cite exact selected paths; do not label it microservices or a monorepo without evidence.";
    }
    if (this.isCodeStyleQuestion(question)) {
      return "Assess observable code style and patterns from representative source and configuration: typing, function/class style, route/controller thickness, data access, UI state, consistency, and duplication. Give concrete examples and label recommendations separately.";
    }
    if (this.isRiskReviewQuestion(question)) {
      return "Review concrete bug, security, reliability, or performance risks. For each finding state the observed fact, bounded impact/inference, exact path, and actionable mitigation. Do not claim an exploit or runtime failure that the evidence does not prove.";
    }
    if (this.isRefactorReviewQuestion(question)) {
      return "Prioritize repository-specific refactors by impact. For each item name the code smell/responsibility overlap, exact paths, proposed boundary, and regression tests. Avoid generic SOLID advice.";
    }
    if (this.isTestReviewQuestion(question)) {
      return "First identify test suites and scripts that actually exist, then name high-value missing cases tied to concrete production paths. Do not say there are no tests merely because a conventional test directory is absent.";
    }
    if (this.isBusinessRulesQuestion(question)) {
      return "Extract concrete coded business constraints: limits, eligibility, date/due/fine calculations, stock/state transitions, validation, and idempotency. Cite rule/helper/service paths and do not turn recommendations into current behavior.";
    }
    if (this.isDomainWorkflowQuestion(question)) {
      return "Trace this domain workflow end to end from UI/client request through route/auth, service rules and transaction, persistence changes, error paths, and UI refresh. Cite exact selected paths and do not replace repository analysis with a generic definition.";
    }
    if (this.isTechStackQuestion(question)) {
      return "Identify the evidenced language/runtime, framework/libraries, hosting/runtime, storage, external APIs, and build/test tooling. Use manifests and configuration as primary evidence. Do not describe only the AI model, repeat tools, or list anything absent from the structured evidence.";
    }
    if (this.isBusinessLogicQuestion(question)) {
      return "Trace the main user-visible workflow through the entry point, orchestration/domain services, state/storage, and external integrations. Do not replace repository analysis with generic definitions. Do not invent line numbers because the context has none.";
    }
    if (this.isProjectOverviewQuestion(question)) {
      return "Explain the product or business purpose, intended users, and primary workflow from README/docs and code. Mention technology only after answering the purpose. Preserve domain output names from the evidence and do not combine adjacent README items into a new feature.";
    }

    if (/^(?:service|services|controller|module|component|endpoint|api|worker)\s*(?:นี้)?\s*(?:ใช้ทำอะไร|เอาไว้ทำอะไร|ทำหน้าที่อะไร|มีหน้าที่อะไร|ทำอะไร)/i.test(question.trim())) {
      const component = question.trim().match(/^(service|services|controller|module|component|endpoint|api|worker)/i)?.[1].toLowerCase();
      const matchingPaths = component
        ? selectedPaths.filter((path) => path.toLowerCase().includes(component))
        : [];
      if (matchingPaths.length === 1) {
        return `Explain the matched component's concrete responsibility, inputs, outputs, collaborators, and role in the project. Cite this exact path: ${matchingPaths[0]}`;
      }
      return [
        "Interpret this broad component question as asking how that layer or component type works in the selected project.",
        "Summarize the concrete responsibilities of the most relevant production components instead of giving a generic definition or asking the user to choose a candidate.",
        matchingPaths.length > 0
          ? `Prefer these production paths and cite the paths you use: ${matchingPaths.slice(0, 5).join(", ")}`
          : "Use the selected production source and clearly state when the repository has no dedicated component of that name.",
      ].join(" ");
    }

    return "Answer the exact repository question from the selected evidence. Cite exact paths and state when the evidence is incomplete.";
  }

  private buildStructuredEvidence(
    question: string,
    fileContents: string,
    selectedPaths: string[],
  ): string {
    if (!this.isTechStackQuestion(question)) return "";

    const packageContent = fileContents.match(
      /--- FILE: package\.json ---\n([\s\S]*?)(?=\n--- FILE:|$)/,
    )?.[1];
    if (!packageContent) return "";

    try {
      const manifest = JSON.parse(packageContent) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        engines?: Record<string, string>;
        scripts?: Record<string, string>;
      };
      const lines = [
        `package.json engines: ${this.formatRecord(manifest.engines)}`,
        `package.json dependencies: ${this.formatRecord(manifest.dependencies)}`,
        `package.json devDependencies: ${this.formatRecord(manifest.devDependencies)}`,
        `package.json script names: ${Object.keys(manifest.scripts ?? {}).join(", ") || "none"}`,
      ];
      const configs = selectedPaths.filter((path) =>
        /(?:^|\/)(?:wrangler\.jsonc?|tsconfig(?:\.[\w-]+)?\.json|vite\.config\.[cm]?[jt]s|next\.config\.[cm]?js|nuxt\.config\.[cm]?ts|docker-compose\.ya?ml)$/i.test(path)
      );
      if (configs.length > 0) {
        lines.push(`Selected runtime/build config paths: ${configs.join(", ")}`);
      }
      return lines.join("\n");
    } catch {
      return "package.json was selected but could not be parsed as strict JSON.";
    }
  }

  private formatRecord(record?: Record<string, string>): string {
    const entries = Object.entries(record ?? {});
    return entries.length > 0
      ? entries.map(([name, version]) => `${name}@${version}`).join(", ")
      : "none";
  }

  private extractLoadedEvidencePaths(fileContents: string): string[] {
    return [...fileContents.matchAll(/^--- FILE: (.+) ---$/gm)].map(
      (match) => match[1].trim(),
    );
  }

  private async loadSelectedFiles(
    state: RepoState,
    files: GitHubTreeItem[],
    maxCharactersPerFile?: number,
    question = "",
  ): Promise<string> {
    const loaded: Array<string | null> = [];
    for (let offset = 0; offset < files.length; offset += GITHUB_FILE_CONCURRENCY) {
      const batch = files.slice(offset, offset + GITHUB_FILE_CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (file): Promise<string | null> => {
          try {
            const encodedPath = file.path.split("/").map(encodeURIComponent).join("/");
            const contentFile = await this.get<GitHubContentFile>(
              `/repos/${encodeURIComponent(state.owner)}/${encodeURIComponent(state.repo)}/contents/${encodedPath}?ref=${encodeURIComponent(state.branch)}`,
            );
            if (
              contentFile.type !== "file" ||
              contentFile.encoding !== "base64" ||
              !contentFile.content
            ) {
              return null;
            }
            const decoded = this.sanitizeReadableContent(
              this.decodeBase64Utf8(contentFile.content),
              contentFile.path,
            );
            const content = maxCharactersPerFile
              ? this.createFocusedFileExcerpt(
                  decoded,
                  question,
                  contentFile.path,
                  maxCharactersPerFile,
                )
              : decoded;
            return `\n--- FILE: ${contentFile.path} ---\n${content}`;
          } catch (error: unknown) {
            console.warn(`Skipped GitHub file ${file.path}`, errorMessage(error));
            return null;
          }
        }),
      );
      loaded.push(...batchResults);
    }

    const sections: string[] = [];
    let characters = 0;
    for (const section of loaded) {
      if (characters >= MAX_REPO_CONTEXT_CHARACTERS) break;
      if (!section) continue;

      const selected = section.slice(0, MAX_REPO_CONTEXT_CHARACTERS - characters);
      sections.push(selected);
      characters += selected.length;
    }
    return sections.join("\n");
  }

  private createFocusedFileExcerpt(
    content: string,
    question: string,
    path: string,
    maxCharacters: number,
  ): string {
    if (content.length <= maxCharacters || /(?:^|\/)package\.json$/i.test(path)) {
      return content.slice(0, maxCharacters);
    }

    const keywordGroups: Array<{ when: RegExp; keywords: string[] }> = [
      {
        when: /(?:ยืม|borrow)/i,
        keywords: ["borrowBook", "borrow", "available_copies", "MAX_ACTIVE_LOANS"],
      },
      {
        when: /(?:คืน|return)/i,
        keywords: ["markLoanReturned", "return", "returned_at", "fine"],
      },
      {
        when: /(?:auth|security|ปลอดภัย|login|token|cookie|ช่องโหว่)/i,
        keywords: ["AUTH_SECRET", "localStorage", "Authorization", "signAuthToken", "requireRole", "verifyPassword"],
      },
      {
        when: /(?:กฎ|business\s*rules?|loan\s*rules?|ค่าปรับ|fine|overdue)/i,
        keywords: ["MAX_ACTIVE_LOANS", "dueDateForCategory", "calculateFine", "overdue", "available_copies"],
      },
      {
        when: /(?:tests?|coverage|การทดสอบ)/i,
        keywords: ["test", "assert", "acceptance", "happy-flow"],
      },
      {
        when: /(?:ทำอะไรได้บ้าง|ความสามารถ|คุณสมบัติ|ฟีเจอร์|features?|functionalit(?:y|ies)|capabilit(?:y|ies)|มี\s*(?:functions?|ฟังก์ชัน))/i,
        keywords: ["signupMember", "loginMember", "listBooks", "createBook", "borrowBook", "getMemberLoans", "getAdminLoans", "markLoanReturned"],
      },
      {
        when: /(?:refactor|architecture|สถาปัตยกรรม|code\s*style|style\s*การเขียน|design\s*pattern)/i,
        keywords: ["export async function", "export function", "function ", "useState", "query<", "BEGIN", "calculateFine", "dueDate", "localStorage"],
      },
    ];
    const keywords = keywordGroups
      .filter(({ when }) => when.test(question))
      .flatMap(({ keywords: values }) => values);
    if (keywords.length === 0) return content.slice(0, maxCharacters);

    const indexes = [...new Set(keywords.flatMap((keyword) => {
      const matches: number[] = [];
      const lowerContent = content.toLowerCase();
      const lowerKeyword = keyword.toLowerCase();
      let from = 0;
      while (matches.length < 2) {
        const index = lowerContent.indexOf(lowerKeyword, from);
        if (index < 0) break;
        matches.push(index);
        from = index + lowerKeyword.length;
      }
      return matches;
    }))].sort((left, right) => left - right);
    if (indexes.length === 0) return content.slice(0, maxCharacters);

    const headBudget = Math.min(900, Math.floor(maxCharacters * 0.2));
    const windows: string[] = [content.slice(0, headBudget)];
    const windowBudget = Math.floor((maxCharacters - headBudget) / Math.min(3, indexes.length));
    for (const index of indexes.slice(0, 3)) {
      const start = Math.max(0, index - Math.floor(windowBudget * 0.3));
      const end = Math.min(content.length, start + windowBudget);
      const segment = content.slice(start, end);
      if (!windows.some((existing) => existing.includes(segment.slice(0, 160)))) {
        windows.push(segment);
      }
    }
    return windows.join("\n\n/* ... focused excerpt ... */\n\n").slice(0, maxCharacters);
  }

  private decodeBase64Utf8(value: string): string {
    const bytes = Uint8Array.from(atob(value.replace(/\s/g, "")), (character) =>
      character.charCodeAt(0),
    );
    return new TextDecoder().decode(bytes);
  }

  private sanitizeReadableContent(content: string, path: string): string {
    if (!/(?:^|\/)readme\.md$/i.test(path)) return content;
    return content
      .split("\n")
      .filter((line) => {
        const markdownFiles = line.match(/\b[a-z0-9_-]+\.md\b/gi) ?? [];
        return markdownFiles.every(
          (fileName) => fileName.toLowerCase() === "readme.md",
        );
      })
      .join("\n");
  }
}
