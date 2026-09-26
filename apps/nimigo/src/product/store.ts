import type { NimiLocalAppClient } from '@nimiplatform/sdk';
type JsonValue = Parameters<NimiLocalAppClient['storage']['writeJson']>[1];
import { createWorkspace, isMissing, type Work, type Workspace } from './model';
const root = 'nimigo/v1';

/** App business state and work exchanges. Canonical Conversation is never read here. */
export class GoStore {
  private writes = Promise.resolve();
  private workspaceId: string | null = null;
  private closed = false;
  close() { this.closed = true; }
  private check() { if (this.closed) throw new Error('此工作区执行范围已失效'); }
  constructor(private client: Pick<NimiLocalAppClient, 'storage'>) {}
  async load(): Promise<{ workspace: Workspace; works: Work[] }> {
    this.check();
    let workspace: Workspace;
    try { workspace = (await this.client.storage.readJson(`${root}/workspace.json`)).value as unknown as Workspace; }
    catch (error) { if (!isMissing(error)) throw error; this.check(); workspace = createWorkspace(); await this.client.storage.writeJson(`${root}/workspace.json`, workspace as unknown as JsonValue); }
    this.check();
    if (workspace.version !== 1 || !workspace.id || !Array.isArray(workspace.workIds) || !Array.isArray(workspace.projects) || !Array.isArray(workspace.skills)) throw new Error('工作区数据格式无法读取，原数据已保留。');
    this.workspaceId = workspace.id;
    const works = await Promise.all(workspace.workIds.map(async id => {
      const value = (await this.client.storage.readJson(`${root}/work-${id}.json`)).value as unknown as Work;
      if (value.version !== 1 || value.id !== id || !Array.isArray(value.attempts)) throw new Error('工作记录无法读取，原数据已保留。');
      return value;
    }));
    this.check(); return { workspace, works };
  }
  private write(path: string, value: unknown, check?: () => void): Promise<void> {
    // Snapshot when queued so an unrelated UI mutation cannot alter the write.
    const copy = JSON.parse(JSON.stringify(value)) as JsonValue;
    const operation = this.writes.then(async () => {
      this.check();
      check?.();
      const current = (await this.client.storage.readJson(`${root}/workspace.json`)).value as unknown as Workspace;
      this.check();
      check?.();
      if (!this.workspaceId || current.id !== this.workspaceId) throw new Error('工作区会话已变更，请重新打开 NimiGo。');
      await this.client.storage.writeJson(path, copy);
    });
    this.writes = operation.catch(() => {});
    return operation;
  }
  saveWorkspace(workspace: Workspace) { return this.write(`${root}/workspace.json`, workspace); }
  saveWork(work: Work, check?: () => void) { return this.write(`${root}/work-${work.id}.json`, work, check); }
  async writeText(path: string, content: string, check?: () => void) {
    this.check();
    check?.();
    const current = (await this.client.storage.readJson(`${root}/workspace.json`)).value as unknown as Workspace;
    this.check();
    check?.();
    if (current.id !== this.workspaceId) throw new Error('会话已变更，请重新打开应用');
    await this.client.storage.assets.write({ relativePath: path, body: new TextEncoder().encode(content), mediaType: 'text/markdown', overwrite: false });
  }
  async readText(path: string): Promise<string> {
    this.check();
    const result = await this.client.storage.assets.read({ relativePath: path });
    if (result.asset.sizeBytes > 128 * 1024) throw new Error('成果过大，无法在编辑器内打开');
    const chunks: Uint8Array[] = []; for await (const chunk of result.body) { this.check(); chunks.push(chunk); }
    this.check(); return new TextDecoder().decode(await new Blob(chunks.map(c => new Uint8Array(c))).arrayBuffer());
  }
}
