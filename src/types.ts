export type AppEnv = Cloudflare.Env & {
  GITHUB_TOKEN?: string;
  GEMINI_API_KEY?: string;
  HF_TOKEN?: string;
};

export interface LineWebhookBody {
  events?: LineWebhookEvent[];
}

export interface LineWebhookEvent {
  type: string;
  webhookEventId?: string;
  replyToken?: string;
  message?: { type: string; text?: string };
  source?: {
    type?: string;
    userId?: string;
    groupId?: string;
    roomId?: string;
  };
}

export interface LineTextMessage {
  type: "text";
  text: string;
}

export interface LineFlexMessage {
  type: "flex";
  altText: string;
  contents: Record<string, unknown>;
}

export type LineMessage = LineTextMessage | LineFlexMessage;
export type LineReply = string | LineMessage | LineMessage[];
export interface RepoState {
  owner: string;
  repo: string;
  branch: string;
  lastQuestion?: string;
}

export interface GitHubRepository {
  name: string;
  default_branch: string;
  full_name: string;
  private: boolean;
  archived?: boolean;
  description?: string | null;
  language?: string | null;
  updated_at?: string;
}

export interface GitHubBranch {
  name: string;
  commit: { sha: string };
}

export interface GitHubTreeItem {
  path: string;
  type: "blob" | "tree" | "commit";
  size?: number;
}

export interface GitHubTreeResponse {
  tree: GitHubTreeItem[];
  truncated: boolean;
}

export interface GitHubContentFile {
  type: string;
  path: string;
  encoding?: string;
  content?: string;
}
