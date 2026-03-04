/**
 * Last Mile Route Switch Demo
 *
 * Run: npx tsx examples/sdk/last-mile-route-switch.ts
 */

import { Runtime } from '@nimiplatform/sdk';
import { createNimiAiProvider } from '@nimiplatform/sdk/ai-provider';
import { generateText } from 'ai';

const APP_ID = 'example.last-mile-route-switch';
const SUBJECT_USER_ID = 'local-user';

type RoutePolicy = 'local-runtime' | 'token-api';

type Scenario = {
  routePolicy: RoutePolicy;
  model: string;
  prompt: string;
};

function env(name: string, fallback: string): string {
  const value = String(process.env[name] || '').trim();
  return value || fallback;
}

function readNimiError(error: unknown): { reasonCode: string; actionHint: string; traceId: string } {
  if (!error || typeof error !== 'object') {
    return { reasonCode: 'UNKNOWN', actionHint: 'n/a', traceId: 'n/a' };
  }

  const candidate = error as { reasonCode?: unknown; actionHint?: unknown; traceId?: unknown };
  return {
    reasonCode: String(candidate.reasonCode || 'UNKNOWN'),
    actionHint: String(candidate.actionHint || 'n/a'),
    traceId: String(candidate.traceId || 'n/a'),
  };
}

async function runScenario(runtime: Runtime, scenario: Scenario): Promise<void> {
  const nimi = createNimiAiProvider({
    runtime,
    appId: APP_ID,
    subjectUserId: SUBJECT_USER_ID,
    routePolicy: scenario.routePolicy,
    fallback: 'deny',
    timeoutMs: 120_000,
  });

  const startedAt = Date.now();

  try {
    const result = await generateText({
      model: nimi.text(scenario.model),
      prompt: scenario.prompt,
      maxOutputTokens: 128,
    });

    const compactText = result.text.replace(/\s+/g, ' ').trim();
    process.stdout.write(`[${scenario.routePolicy}] model=${scenario.model}\n`);
    process.stdout.write(`[${scenario.routePolicy}] text=${compactText}\n`);
    process.stdout.write(`[${scenario.routePolicy}] usage=${JSON.stringify(result.usage)}\n`);
  } catch (error) {
    const nimiError = readNimiError(error);
    process.stdout.write(`[${scenario.routePolicy}] model=${scenario.model}\n`);
    process.stdout.write(`[${scenario.routePolicy}] failed reason=${nimiError.reasonCode} action=${nimiError.actionHint} trace=${nimiError.traceId}\n`);
  }

  process.stdout.write(`[${scenario.routePolicy}] elapsedMs=${Date.now() - startedAt}\n`);
}

async function main(): Promise<void> {
  const endpoint = env('NIMI_RUNTIME_GRPC_ENDPOINT', '127.0.0.1:46371');
  const localModel = env('NIMI_LAST_MILE_LOCAL_MODEL', 'local/qwen2.5');
  const cloudModel = env('NIMI_LAST_MILE_CLOUD_MODEL', 'cloud/gpt-4o-mini');

  const runtime = new Runtime({
    appId: APP_ID,
    transport: {
      type: 'node-grpc',
      endpoint,
    },
  });

  process.stdout.write(`runtime=${endpoint}\n`);
  process.stdout.write('same code path, only routePolicy changes\n');

  await runScenario(runtime, {
    routePolicy: 'local-runtime',
    model: localModel,
    prompt: 'In one sentence, what does Nimi solve for app developers?',
  });

  await runScenario(runtime, {
    routePolicy: 'token-api',
    model: cloudModel,
    prompt: 'In one sentence, what does Nimi solve for app developers?',
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error || 'unknown error');
  process.stderr.write(`[example-error] ${message}\n`);
  process.exitCode = 1;
});
