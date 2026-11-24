import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, unlink } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { defineExtension, defineTool } from '@earendil-works/pi-durable';
import { obj, str } from '@earendil-works/pi-schema';
import type { NimiElectronAppBusinessServices } from '@nimiplatform/kit/shell/electron/main';
import { workspaceFile } from './workspace-files.js';

type Assets = NimiElectronAppBusinessServices['storage']['assets'];
const idPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const limit = 32 * 1024 * 1024;
const types: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.pdf': 'application/pdf',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
  '.flac': 'audio/flac', '.webm': 'audio/webm',
  '.txt': 'text/plain', '.md': 'text/markdown', '.markdown': 'text/markdown', '.csv': 'text/csv',
  '.json': 'application/json', '.yaml': 'text/plain', '.yml': 'text/plain', '.toml': 'text/plain',
  '.ts': 'text/plain', '.tsx': 'text/plain', '.js': 'text/plain', '.jsx': 'text/plain',
  '.py': 'text/plain', '.go': 'text/plain', '.rs': 'text/plain', '.sh': 'text/plain',
  '.css': 'text/plain', '.html': 'text/plain', '.xml': 'text/plain', '.sql': 'text/plain', '.log': 'text/plain',
};

export function sessionFilePath(sessionId: string, direction: 'in' | 'out', id: string) {
  if ((sessionId !== 'main' && !idPattern.test(sessionId)) || !idPattern.test(id)) throw new Error('Invalid session file reference.');
  return `sessions/${sessionId}/${direction}/${id}`;
}

export async function publishWorkspaceFile(assets: Assets, workspace: string, sessionId: string, ref: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const { path, info: before } = await workspaceFile(workspace, ref, signal);
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile() || before.dev !== stat.dev || before.ino !== stat.ino || stat.size < 1 || stat.size > limit) {
      throw new Error('Choose a nonempty regular file up to 32 MiB.');
    }
    const id = randomUUID();
    async function* bounded() {
      let offset = 0;
      while (offset < stat.size) {
        signal.throwIfAborted();
        const bytes = Buffer.allocUnsafe(Math.min(256 * 1024, stat.size - offset));
        const chunk = await file.read(bytes, 0, bytes.length, offset);
        if (!chunk.bytesRead) throw new Error('The file changed during publication.');
        offset += chunk.bytesRead;
        yield bytes.subarray(0, chunk.bytesRead);
      }
      const after = await file.stat();
      if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error('The file changed during publication.');
    }
    const relativePath = sessionFilePath(sessionId, 'out', id);
    const mediaType = types[extname(path).toLowerCase()] ?? 'application/octet-stream';
    const record = await assets.write({ relativePath, mediaType, body: bounded() });
    return {
      fileId: id,
      name: basename(path),
      relativePath,
      source: { mediaType: record.mediaType ?? mediaType, sizeBytes: record.sizeBytes ?? stat.size, sha256: record.sha256 },
    };
  } finally {
    await file.close();
  }
}

export function sessionFileTools(assets: Assets, workspace: string | (() => string), sessionId: string, account: AbortSignal) {
  const resolveWorkspace = () => (typeof workspace === 'function' ? workspace() : workspace);
  return defineExtension({ name: 'nimi-harness.session-files', tools: [
    defineTool({
      name: 'open_attachment',
      description: 'Copy an uploaded attachment into this session’s working directory. Use the attachment ID from the user and the returned filename with the file or transcription tools.',
      parameters: obj({ id: str() }), replay: 'unsafe',
      async execute({ id }, _api, ctx) {
        const signal = ctx.abortSignal ? AbortSignal.any([account, ctx.abortSignal]) : account;
        signal.throwIfAborted();
        const dir = resolveWorkspace();
        const read = await assets.read({ relativePath: sessionFilePath(sessionId, 'in', id) });
        const extension = Object.keys(types).find(key => types[key] === read.asset.mediaType) ?? '.bin';
        const name = `attachment-${randomUUID()}${extension}`;
        const file = await open(join(dir, name), 'wx', 0o600);
        try { await pipeline(read.body, file.createWriteStream(), { signal }); }
        catch (error) { await unlink(join(dir, name)).catch(() => {}); throw error; }
        finally { await file.close(); }
        return { output: [{ type: 'text', text: name }], details: { attachmentId: id, sha256: read.asset.sha256 } };
      },
    }),
    defineTool({
      name: 'share_result_file',
      description: 'When the user asks to share a result or download it on another device, publish one finished top-level workspace file for a remote source granted access in Home. Show the returned file ID. Desktop users can open a locally saved file directly in Session files.',
      parameters: obj({ filename: str() }), replay: 'unsafe',
      async execute({ filename }, _api, ctx) {
        const signal = ctx.abortSignal ? AbortSignal.any([account, ctx.abortSignal]) : account;
        signal.throwIfAborted();
        if (!filename || basename(filename) !== filename || /[/\\:\x00-\x1f]/.test(filename) || filename === '.' || filename === '..') {
          throw new Error('Choose one file in the top level of this session’s workspace.');
        }
        const dir = resolveWorkspace();
        // Read the opened regular file; do not follow a workspace link to an unrelated result.
        const path = join(dir, filename);
        const before = await lstat(path);
        if (!before.isFile()) throw new Error('Choose a regular file.');
        const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
        try {
          const stat = await file.stat();
          if (!stat.isFile() || before.dev !== stat.dev || before.ino !== stat.ino || stat.size < 1 || stat.size > limit) throw new Error('Choose a nonempty regular file up to 32 MiB.');
          const id = randomUUID();
          async function* bounded() {
            let offset = 0;
            while (offset < stat.size) {
              signal.throwIfAborted();
              const bytes = Buffer.allocUnsafe(Math.min(256 * 1024, stat.size - offset));
              const chunk = await file.read(bytes, 0, bytes.length, offset);
              if (!chunk.bytesRead) throw new Error('The file changed during publication.');
              offset += chunk.bytesRead;
              yield bytes.subarray(0, chunk.bytesRead);
            }
            const after = await file.stat();
            if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error('The file changed during publication.');
          }
          const record = await assets.write({ relativePath: sessionFilePath(sessionId, 'out', id), mediaType: types[extname(filename).toLowerCase()] ?? 'application/octet-stream', body: bounded() });
          return { output: [{ type: 'text', text: `Download ID: ${id}` }], details: { id, sha256: record.sha256 } };
        } finally { await file.close(); }
      },
    }),
  ] });
}
