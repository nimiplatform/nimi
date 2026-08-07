import type { IncomingMessage, ServerResponse } from 'node:http';

const MAX_REQUEST_BYTES = 32 * 1024;

export async function readLocalDevelopmentJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_REQUEST_BYTES) throw new Error('local-development-intent-invalid');
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

export function writeLocalDevelopmentJson(response: ServerResponse, body: unknown): void {
  response.statusCode = 200;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

export function exactNestedLocalDevelopmentPayload(
  payload: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  if (Object.keys(payload).join('|') !== 'payload') throw new Error('local-development-command-payload-invalid');
  return exactLocalDevelopmentObject(payload.payload, Object.keys(localDevelopmentRecord(payload.payload)));
}

export function exactLocalDevelopmentObject(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  const row = localDevelopmentRecord(value);
  if (Object.keys(row).sort().join('|') !== [...keys].sort().join('|')) {
    throw new Error('local-development-intent-invalid');
  }
  return row;
}

export function localDevelopmentText(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096
    || value.trim() !== value || value.includes('\0')) {
    throw new Error('local-development-intent-invalid');
  }
  return value;
}

export function localDevelopmentCdpPort(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1024 || Number(value) > 65535) {
    throw new Error('local-development-cdp-port-invalid');
  }
  return Number(value);
}

export function localDevelopmentSelector(value: unknown, prefix: string): string {
  const selected = localDevelopmentText(value);
  if (!selected.startsWith(`${prefix}-`) || selected.length > 160
    || !/^[A-Za-z0-9_-]+$/u.test(selected)) {
    throw new Error('local-development-selector-invalid');
  }
  return selected;
}

function localDevelopmentRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('local-development-intent-invalid');
  }
  return value as Record<string, unknown>;
}
