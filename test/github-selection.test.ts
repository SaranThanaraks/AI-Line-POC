import assert from "node:assert/strict";
import test from "node:test";
import { GitHubService } from "../src/services/github.service";
import type { GitHubTreeItem } from "../src/types";

const files: GitHubTreeItem[] = [
  "README.md",
  "POC_GUIDE.md",
  "package.json",
  "tsconfig.json",
  "wrangler.jsonc",
  "src/index.ts",
  "src/presenters/repository.presenter.ts",
  "src/services/bot.service.ts",
  "src/services/github.service.ts",
  "src/services/ai.service.ts",
  "src/services/line.service.ts",
  "src/services/repository-state.service.ts",
  "src/utils.ts",
  "test/bot-routing.test.ts",
  "app/page.tsx",
  "app/admin/page.tsx",
  "app/api/books/route.ts",
  "app/api/loans/borrow/route.ts",
  "app/api/admin/loans/[loanId]/return/route.ts",
  "lib/libraryService.ts",
  "lib/loanRules.ts",
  "lib/auth.ts",
  "lib/http.ts",
  "lib/db.ts",
  "scripts/acceptance-cases.mjs",
  "scripts/happy-flow.mjs",
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

test("only README.md is readable Markdown repository evidence", () => {
  const github = new GitHubService() as unknown as {
    isReadableSourceFile(candidate: GitHubTreeItem): boolean;
  };

  assert.equal(
    github.isReadableSourceFile({ path: "POC_GUIDE.md", type: "blob", size: 1_000 }),
    false,
  );
  assert.equal(
    github.isReadableSourceFile({ path: "docs/POC_GUIDE.md", type: "blob", size: 1_000 }),
    false,
  );
  assert.equal(
    github.isReadableSourceFile({ path: "AGENTS.md", type: "blob", size: 1_000 }),
    false,
  );
  assert.equal(
    github.isReadableSourceFile({ path: "docs/guide.md", type: "blob", size: 1_000 }),
    false,
  );
  assert.equal(
    github.isReadableSourceFile({ path: "README.md", type: "blob", size: 1_000 }),
    true,
  );
  assert.equal(
    github.isReadableSourceFile({ path: "docs/README.md", type: "blob", size: 1_000 }),
    true,
  );
  assert.ok(!select("โปรเจกต์นี้ทำอะไร").includes("POC_GUIDE.md"));
});

test("README context removes references to other Markdown files", () => {
  const github = new GitHubService() as unknown as {
    sanitizeReadableContent(content: string, path: string): string;
  };
  const sanitized = github.sanitizeReadableContent(
    [
      "# Project",
      "Read README.md first.",
      "Internal guide: [POC_GUIDE.md](./POC_GUIDE.md)",
      "Agent rules are in AGENTS.md",
      "Keep this feature description.",
    ].join("\n"),
    "README.md",
  );

  assert.match(sanitized, /README\.md/);
  assert.match(sanitized, /feature description/);
  assert.doesNotMatch(sanitized, /POC_GUIDE\.md|AGENTS\.md/);
});

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

test("symbol inventory retrieval prioritizes implementation source", () => {
  const selected = select("มี function อะไรบ้าง ขอชื่อ function จริงในไฟล์ source");
  assert.ok(selected.includes("lib/libraryService.ts"));
  assert.ok(selected.includes("app/api/books/route.ts"));
  assert.ok(selected.includes("app/page.tsx"));
  assert.equal(selected[0], "lib/libraryService.ts");
  assert.ok(!selected.includes("package.json"));
});

test("bare function follow-up retrieves project capability evidence", () => {
  const selected = select("มี function อะไรบ้าง");
  assert.ok(selected.includes("app/page.tsx"));
  assert.ok(selected.includes("app/admin/page.tsx"));
  assert.ok(selected.includes("lib/libraryService.ts"));
  assert.ok(selected.includes("lib/loanRules.ts"));
});

test("domain workflow retrieval selects route, rules, service, and persistence", () => {
  const selected = select("การยืมทำงานยังไง ตั้งแต่หน้า UI ถึง database");
  assert.ok(selected.includes("app/api/loans/borrow/route.ts"));
  assert.ok(selected.includes("lib/libraryService.ts"));
  assert.ok(selected.includes("lib/loanRules.ts"));
  assert.ok(selected.includes("lib/db.ts"));
});

test("security review retrieval prioritizes auth boundaries", () => {
  const selected = select("auth ปลอดภัยไหม มี security risk ตรงไหน");
  assert.ok(selected.includes("lib/auth.ts"));
  assert.ok(selected.includes("lib/http.ts"));
  assert.ok(selected.includes("app/page.tsx"));
});

test("test-gap retrieval includes existing suites and package scripts", () => {
  const selected = select("test ยังขาดอะไร");
  assert.ok(selected.includes("package.json"));
  assert.ok(selected.includes("scripts/acceptance-cases.mjs"));
  assert.ok(selected.includes("scripts/happy-flow.mjs"));
});

test("broad service questions prioritize production services over tests", () => {
  const selectedPaths = select("Service นี้ใช้ทำอะไร");
  assert.ok(selectedPaths.includes("src/services/bot.service.ts"));
  assert.ok(selectedPaths.includes("src/services/github.service.ts"));
  assert.ok(!selectedPaths.includes("test/bot-routing.test.ts"));
});

test("broad service focus asks the model to explain the layer instead of listing candidates", () => {
  const github = new GitHubService() as unknown as {
    getRetrievalFocus(question: string, selectedPaths: string[]): string;
  };
  const focus = github.getRetrievalFocus("Service นี้ใช้ทำอะไร", [
    "src/services/bot.service.ts",
    "src/services/github.service.ts",
  ]);

  assert.match(focus, /layer or component type/i);
  assert.match(focus, /concrete responsibilities/i);
  assert.doesNotMatch(focus, /ask which one/i);
});
