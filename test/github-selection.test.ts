import assert from "node:assert/strict";
import test from "node:test";
import { GitHubService } from "../src/services/github.service";
import type { GitHubTreeItem } from "../src/types";

const files: GitHubTreeItem[] = [
  "README.md",
  "package.json",
  "tsconfig.json",
  "wrangler.jsonc",
  "src/index.ts",
  "src/presenters/repository.presenter.ts",
  "src/services/bot.service.ts",
  "src/services/github.service.ts",
  "src/services/hugging-face.service.ts",
  "src/services/line.service.ts",
  "src/services/repository-state.service.ts",
  "src/services/intent-router.service.ts",
  "src/utils.ts",
  "test/bot-routing.test.ts",
].map((path) => ({ path, type: "blob", size: 1_000 }));

function select(question: string): string[] {
  const github = new GitHubService();
  const selector = github as unknown as {
    selectRelevantFiles(
      candidates: GitHubTreeItem[],
      userQuestion: string,
    ): GitHubTreeItem[];
  };
  return selector.selectRelevantFiles(files, question).map((file) => file.path);
}

test("tech-stack retrieval prioritizes manifests and runtime configuration", () => {
  const selected = select("ระบบนี้ใช้ tech stack อะไร");
  assert.ok(selected.includes("package.json"));
  assert.ok(selected.includes("wrangler.jsonc"));
  assert.ok(selected.includes("src/index.ts"));
});

test("business-logic retrieval includes orchestration and integration services", () => {
  const selected = select("business logic หลักคืออะไร");
  assert.ok(selected.includes("src/index.ts"));
  assert.ok(selected.includes("src/services/bot.service.ts"));
  assert.ok(selected.includes("src/services/repository-state.service.ts"));
});

test("tech-stack context derives structured facts from the root manifest", () => {
  const github = new GitHubService() as unknown as {
    buildStructuredEvidence(
      question: string,
      contents: string,
      paths: string[],
    ): string;
  };
  const summary = github.buildStructuredEvidence(
    "ระบบนี้ใช้ tech stack อะไร",
    [
      "--- FILE: package.json ---",
      JSON.stringify({
        engines: { node: ">=20 <23" },
        dependencies: { express: "^5.1.0" },
        devDependencies: { typescript: "^5.9.2", tsx: "^4.20.6" },
        scripts: { test: "tsx --test" },
      }),
    ].join("\n"),
    ["package.json", "wrangler.jsonc", "tsconfig.json"],
  );

  assert.match(summary, /express@\^5\.1\.0/);
  assert.match(summary, /typescript@\^5\.9\.2/);
  assert.match(summary, /script names: test/);
  assert.match(summary, /wrangler\.jsonc/);
});

test("GitHub requests retry transient network failures", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("fetch failed");
    return Response.json({
      name: "repo",
      default_branch: "main",
      full_name: "owner/repo",
      private: false,
    });
  }) as typeof fetch;

  try {
    const github = new GitHubService("token");
    const repository = await github.getRepository("owner", "repo");
    assert.equal(repository.full_name, "owner/repo");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("only successfully loaded files become evidence paths", () => {
  const github = new GitHubService() as unknown as {
    extractLoadedEvidencePaths(contents: string): string[];
  };

  assert.deepEqual(
    github.extractLoadedEvidencePaths([
      "--- FILE: README.md ---",
      "overview",
      "--- FILE: src/index.ts ---",
      "export default {}",
    ].join("\n")),
    ["README.md", "src/index.ts"],
  );
});
