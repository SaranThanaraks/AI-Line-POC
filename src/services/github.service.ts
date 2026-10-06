import type {
  GitHubBranch,
  GitHubContentFile,
  GitHubRepository,
  GitHubTreeItem,
  GitHubTreeResponse,
  RepoState,
} from "../types";
import { errorMessage } from "../utils";

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
      this.isBusinessLogicQuestion(question);
    const fileContents = await this.loadSelectedFiles(
      state,
      selectedFiles,
      usesProfiledRetrieval ? MAX_PROFILE_FILE_CHARACTERS : undefined,
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
    const isAmbiguousComponentQuestion = /^(?:service|services|controller|module|component|endpoint|api|worker)\s*(?:นี้)?\s*(?:ใช้ทำอะไร|เอาไว้ทำอะไร|ทำหน้าที่อะไร|มีหน้าที่อะไร|ทำอะไร)/i.test(
      question.trim(),
    );
    const maxFiles = isBusinessLogicQuestion
      ? 8
      : isTechStackQuestion
        ? 7
        : isOverviewQuestion
          ? 8
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
          score += isTechStackQuestion ? 190 : isOverviewQuestion ? 80 : 55;
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
          if (/(^|\/)(?:github|hugging-face)\.service\.(?:ts|js)$/i.test(file.path)) score += 170;
          if (/(^|\/)intent-router\.service\.(?:ts|js)$/i.test(file.path)) score -= 350;
        }
        if (
          isAmbiguousComponentQuestion &&
          /(^|\/)(?:src\/)?(?:index|main|app|server|worker)\.(?:ts|tsx|js|jsx|mjs|py|go|rs|java|kt|swift)$/i.test(file.path)
        ) {
          score += 120;
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

  private isBusinessLogicQuestion(question: string): boolean {
    return /(?:business\s*logic|logic\s*ธุรกิจ|ลอจิก(?:ทาง)?ธุรกิจ|workflow|data\s*flow|control\s*flow|ลำดับการทำงาน|(?:ระบบ|แอป|โปรเจกต์|โปรเจค|project|repo).*(?:ทำงาน|flow))/i.test(
      question,
    );
  }

  private getRetrievalFocus(question: string, selectedPaths: string[]): string {
    if (this.isTechStackQuestion(question)) {
      return "Identify the evidenced language/runtime, framework/libraries, hosting/runtime, storage, external APIs, and build/test tooling. Use manifests and configuration as primary evidence. Do not describe only the AI model, repeat tools, or list anything absent from the structured evidence.";
    }
    if (this.isBusinessLogicQuestion(question)) {
      return "Trace the main user-visible workflow through the entry point, orchestration/domain services, state/storage, and external integrations. Do not explain the question classifier unless the user explicitly asks about classification. Do not invent line numbers because the context has none.";
    }
    if (this.isProjectOverviewQuestion(question)) {
      return "Explain the product or business purpose, intended users, and primary workflow from README/docs and code. Mention technology only after answering the purpose. Preserve domain output names from the evidence and do not combine adjacent README items into a new feature.";
    }

    if (/^(?:service|services|controller|module|component|endpoint|api|worker)\s*(?:นี้)?\s*(?:ใช้ทำอะไร|เอาไว้ทำอะไร|ทำหน้าที่อะไร|มีหน้าที่อะไร|ทำอะไร)/i.test(question.trim())) {
      const component = question.trim().match(/^(service|services|controller|module|component|endpoint|api|worker)/i)?.[1].toLowerCase();
      const matchingPaths = component
        ? selectedPaths.filter((path) => path.toLowerCase().includes(component))
        : [];
      if (matchingPaths.length === 0) {
        return "The component name is ambiguous and no selected path uniquely matches it. State that clearly; if interpreting it as the whole repository, say so explicitly and ground the answer in README or manifests.";
      }
      if (matchingPaths.length > 1) {
        return `The component name is ambiguous. Name the matching paths and ask which one the user means before making component-specific claims: ${matchingPaths.join(", ")}`;
      }
      return `Explain only the matched component and cite this exact path: ${matchingPaths[0]}`;
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
            const decoded = this.decodeBase64Utf8(contentFile.content);
            const content = maxCharactersPerFile
              ? decoded.slice(0, maxCharactersPerFile)
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

  private decodeBase64Utf8(value: string): string {
    const bytes = Uint8Array.from(atob(value.replace(/\s/g, "")), (character) =>
      character.charCodeAt(0),
    );
    return new TextDecoder().decode(bytes);
  }
}
