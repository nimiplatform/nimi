import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { Runtime } from '@nimiplatform/sdk';
import { createNimiAiProvider } from '@nimiplatform/sdk/ai-provider';

export type ProviderRoute = 'local' | 'cloud';

export type ProviderContext = {
  endpoint: string;
  appId: string;
  subjectUserId: string;
  provider: ReturnType<typeof createNimiAiProvider>;
};

export function env(name: string, fallback = ''): string {
  const value = String(process.env[name] || '').trim();
  if (value) {
    return value;
  }
  return fallback;
}

export function requiredEnv(name: string, hint: string): string {
  const value = env(name);
  if (!value) {
    throw new Error(`Missing env ${name}. ${hint}`);
  }
  return value;
}

export function print(line: string): void {
  process.stdout.write(`${line}\n`);
}

export async function saveBytes(outputPath: string, bytes: Uint8Array): Promise<string> {
  const abs = resolve(outputPath);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, bytes);
  return abs;
}

export async function saveBase64(outputPath: string, data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string'
    ? Buffer.from(data, 'base64')
    : data;
  return await saveBytes(outputPath, bytes);
}

export function firstTextFromGenerateContent(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((item) => item.type === 'text')
    .map((item) => String(item.text || '').trim())
    .join(' ')
    .trim();
}

export function createProviderContext(input: {
  appId: string;
  subjectUserId: string;
  routePolicy: ProviderRoute;
  fallback?: 'deny' | 'allow';
  timeoutMs?: number;
}): ProviderContext {
  const endpoint = env('NIMI_RUNTIME_GRPC_ENDPOINT', '127.0.0.1:46371');

  const runtime = new Runtime({
    appId: input.appId,
    transport: {
      type: 'node-grpc',
      endpoint,
    },
    defaults: {
      callerKind: 'desktop-core',
      callerId: 'docs-example-provider',
    },
  });

  const provider = createNimiAiProvider({
    runtime,
    appId: input.appId,
    subjectUserId: input.subjectUserId,
    routePolicy: input.routePolicy,
    fallback: input.fallback || 'deny',
    timeoutMs: input.timeoutMs || 120_000,
  });

  return {
    endpoint,
    appId: input.appId,
    subjectUserId: input.subjectUserId,
    provider,
  };
}

export async function mainWithErrorGuard(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'unknown error');
    process.stderr.write(`[example-error] ${message}\n`);
    process.exitCode = 1;
  }
}
