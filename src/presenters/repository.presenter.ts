import type { GitHubRepository, LineFlexMessage } from "../types";
import { truncateText } from "../utils";

const MAX_REPOSITORY_CARDS = 12;

export function createRepositoryCarousel(
  repositories: GitHubRepository[],
): LineFlexMessage {
  const cards = repositories.slice(0, MAX_REPOSITORY_CARDS).map((repository) => {
    const [owner] = repository.full_name.split("/");
    const status = repository.private ? "PRIVATE REPOSITORY" : "PUBLIC REPOSITORY";
    const statusColor = repository.private ? "#F59E0B" : "#22C55E";
    const description = truncateText(
      repository.description?.trim() || "ไม่มีคำอธิบายสำหรับ repository นี้",
      150,
    );
    const metadata = [
      repository.language ? `ภาษา: ${repository.language}` : null,
      `Branch: ${repository.default_branch}`,
    ].filter(Boolean).join("  •  ");

    return {
      type: "bubble",
      size: "kilo",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#111827",
        paddingAll: "20px",
        contents: [
          { type: "text", text: status, color: statusColor, size: "xs", weight: "bold" },
          {
            type: "text",
            text: truncateText(repository.name, 80),
            color: "#FFFFFF",
            size: "xl",
            weight: "bold",
            wrap: true,
            margin: "md",
          },
          {
            type: "text",
            text: truncateText(owner, 60),
            color: "#9CA3AF",
            size: "sm",
            margin: "sm",
            wrap: true,
          },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "20px",
        contents: [
          { type: "text", text: description, color: "#374151", size: "sm", wrap: true, maxLines: 4 },
          { type: "separator", margin: "xl", color: "#E5E7EB" },
          { type: "text", text: metadata, color: "#6B7280", size: "xs", wrap: true, margin: "xl" },
          repository.archived
            ? { type: "text", text: "ARCHIVED", color: "#EF4444", size: "xs", weight: "bold", margin: "md" }
            : { type: "text", text: "พร้อมให้อ่านโค้ด", color: "#16A34A", size: "xs", weight: "bold", margin: "md" },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        paddingAll: "16px",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#16A34A",
            height: "sm",
            action: {
              type: "message",
              label: "เลือก Repo",
              text: `ดูโค้ดใน repo ${repository.full_name}`,
            },
          },
        ],
      },
    };
  });

  return {
    type: "flex",
    altText: `เลือก Repository (${repositories.length} รายการ)`,
    contents: { type: "carousel", contents: cards },
  };
}

export function formatRepositoryList(repositories: GitHubRepository[]): string {
  const visible = repositories.slice(0, 30);
  return [
    `Repo ที่ GitHub token เข้าถึงได้ (${repositories.length}${repositories.length === 100 ? "+" : ""})`,
    ...visible.map(
      (repo, index) =>
        `${index + 1}. ${repo.full_name}${repo.private ? " 🔒" : ""}${repo.archived ? " (archived)" : ""}`,
    ),
    repositories.length > visible.length
      ? `แสดง ${visible.length} รายการแรก เรียงจากที่อัปเดตล่าสุด`
      : "",
    "",
    "เลือกได้โดยพิมพ์ เช่น: ดูโค้ดใน repo ชื่อ-repo ให้หน่อย",
  ].filter(Boolean).join("\n");
}
