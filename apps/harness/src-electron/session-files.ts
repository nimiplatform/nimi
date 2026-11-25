import { randomUUID } from 'node:crypto';
import { basename, extname } from 'node:path';
import { defineExtension, defineTool } from '@earendil-works/pi-durable';
import { obj, str } from '@earendil-works/pi-schema';
import type { NimiElectronAppBusinessServices } from '@nimiplatform/kit/shell/electron/main';
import { validateRawWorkspacePathInput } from './security-policy.js';

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

type ReadWorkspace = (ref: string, maxBytes: number) => Promise<Uint8Array>;

export async function publishWorkspaceFile(assets: Assets, sessionId: string, ref: string, signal: AbortSignal, read: ReadWorkspace) {
  signal.throwIfAborted();
  const bytes = await read(ref, limit);
  signal.throwIfAborted();
  if (!bytes.length || bytes.length > limit) throw new Error('Choose a nonempty file up to 32 MiB.');
  const fileId = randomUUID();
  const relativePath = sessionFilePath(sessionId, 'out', fileId);
  const mediaType = types[extname(ref).toLowerCase()] ?? 'application/octet-stream';
  const record = await assets.write({ relativePath, mediaType, body: (async function* () { yield bytes; })() });
  return { fileId, name: basename(ref), relativePath, source: {
    mediaType: record.mediaType ?? mediaType, sizeBytes: record.sizeBytes ?? bytes.length, sha256: record.sha256,
  } };
}

export function sessionFileTools(assets: Assets, sessionId: string, account: AbortSignal, createExclusive: (ref: string, data: Uint8Array) => Promise<void>, readWorkspace: ReadWorkspace) {
  return defineExtension({ name: 'nimi-harness.session-files', tools: [
    defineTool({
      name: 'open_attachment',
      description: 'Copy an uploaded attachment into this session’s working directory. Use the attachment ID from the user and the returned filename with the file or transcription tools.',
      parameters: obj({ id: str() }), replay: 'unsafe',
      async execute({ id }, _api, ctx) {
        const signal = ctx.abortSignal ? AbortSignal.any([account, ctx.abortSignal]) : account;
        signal.throwIfAborted();
        const read = await assets.read({ relativePath: sessionFilePath(sessionId, 'in', id) });
        const extension = Object.keys(types).find(key => types[key] === read.asset.mediaType) ?? '.bin';
        const name = `attachment-${randomUUID()}${extension}`;
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of read.body) {
          signal.throwIfAborted();
          size += chunk.byteLength;
          if (size > limit) throw new Error('Attachment exceeds 32 MiB.');
          chunks.push(Buffer.from(chunk));
        }
        signal.throwIfAborted();
        await createExclusive(name, Buffer.concat(chunks, size));
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
        validateRawWorkspacePathInput(filename);
        const result = await publishWorkspaceFile(assets, sessionId, filename, signal, readWorkspace);
        return { output: [{ type: 'text', text: 'Download ID: ' + result.fileId }], details: { id: result.fileId, sha256: result.source.sha256 } };
      },
    }),
  ] });
}
