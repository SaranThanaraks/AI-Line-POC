import type { RepoState } from "../types";

export class RepositoryStateService {
  constructor(private readonly storage: KVNamespace) {}

  get(key: string): Promise<RepoState | null> {
    return this.storage.get<RepoState>(key, "json");
  }

  async put(key: string, state: RepoState): Promise<void> {
    await this.storage.put(key, JSON.stringify(state));
  }

  async require(conversationKey: string | null): Promise<RepoState | string> {
    if (!conversationKey) {
      return "ไม่พบรหัสห้องสนทนา จึงยังจำ repo ให้ไม่ได้";
    }
    const state = await this.get(conversationKey);
    return state ?? "ยังไม่ได้เลือก repo\nเริ่มด้วย: /repo owner/repository";
  }
}
