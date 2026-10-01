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
    const fileContents = await this.loadSelectedFiles(state, selectedFiles);
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
      "REPOSITORY PATHS:",
      treePaths,
      "",
      "SELECTED FILE CONTENTS:",
      fileContents || "No readable file content was selected.",
    ]
      .filter((part) => part !== "")
      .join("\n");
  }

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(`${GITHUB_API_BASE_URL}${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "line-ai-bot",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) throw new GitHubApiError(response.status);
    return (await response.json()) as T;
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
      /\.(c|cc|cpp|cs|css|go|graphql|h|hpp|html|java|js|json|jsx|kt|kts|md|mjs|cjs|php|prisma|py|rb|rs|scss|sh|sql|svelte|swift|toml|ts|tsx|txt|vue|xml|ya?ml)$/i.test(item.path) ||
      /(^|\/)(dockerfile|makefile)$/i.test(item.path)
    );
  }

  private selectRelevantFiles(
    files: GitHubTreeItem[],
    question: string,
  ): GitHubTreeItem[] {
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
        if (/^readme(\.[a-z0-9]+)?$/i.test(file.path)) score += 75;
        if (/^(package\.json|pyproject\.toml|go\.mod|cargo\.toml|composer\.json)$/i.test(file.path)) score += 65;
        if (/(^|\/)(index|main|app|server|worker)\.(ts|tsx|js|jsx|mjs|py|go|rs|java|kt|swift)$/i.test(file.path)) score += 40;
        score -= Math.min(file.path.split("/").length, 10);
        return { file, score };
      })
      .sort(
        (left, right) =>
          right.score - left.score || left.file.path.localeCompare(right.file.path),
      )
      .slice(0, MAX_SOURCE_FILES)
      .map(({ file }) => file);
  }

  private async loadSelectedFiles(
    state: RepoState,
    files: GitHubTreeItem[],
  ): Promise<string> {
    const loaded = await Promise.all(
      files.map(async (file): Promise<string | null> => {
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
          return `\n--- FILE: ${contentFile.path} ---\n${this.decodeBase64Utf8(contentFile.content)}`;
        } catch (error: unknown) {
          console.warn(`Skipped GitHub file ${file.path}`, errorMessage(error));
          return null;
        }
      }),
    );

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
