import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import YAML from 'yaml';

import {
  AuthorizationPreset,
  ExternalPrincipalType,
  PolicyMode,
} from '../../sdks/typescript/runtime/generated.js';
import { Runtime } from '../../sdks/typescript/runtime/index.js';
import { createNimiRuntimeFullAppRegistration } from '../../sdks/typescript/runtime/app-session.js';
import { withNimiRuntimeIdempotencyMetadata } from '../../sdks/typescript/runtime/scenario-jobs.js';
import { toNimiRuntimeTimestamp } from '../../sdks/typescript/runtime/runtime-agent-values.js';
import { withRuntimeDaemon } from '../../sdks/typescript/runtime/live-runtime-daemon.test-helper.js';
import {
  GOLD_REPORT_PATH,
  loadGoldFixture,
  loadGoldFixtures,
  missingFixtureEnv,
  runtimeEnvForFixture,
  summarizeGoldReport,
} from './fixtures.mjs';

type LayerResult = {
  status: 'passed' | 'failed' | 'skipped' | 'reserved';
  traceId?: string;
  reasonCode?: string;
  actionHint?: string;
  error?: string;
  jobId?: string;
  artifactSummary?: Record<string, unknown>;
  bridgeLayer?: string;
};

type JsonCommandResult = {
  ok: true;
  value: Record<string, unknown>;
} | {
  ok: false;
  error: string;
};

type FixtureRecord = {
  fixture_id: string;
  capability: string;
  provider: string;
  model_id: string;
  target_model_id?: string;
  gated: boolean;
  path: string;
  missing_env: string[];
  first_failing_layer: string | null;
  layers: Record<string, LayerResult>;
};

const GOLD_APP_ID = 'nimi.gold-path';
const GOLD_APP_INSTANCE_ID = 'gold-path-live';
const GOLD_DEVICE_ID = 'gold-path-live';
const GOLD_SCOPE_CATALOG_VERSION = 'sdk-v2';
const GOLD_SUBJECT_USER_ID = String(process.env.NIMI_LIVE_GOLD_SUBJECT_USER_ID || 'gold-user').trim();

function readArg(flag: string): string {
  const index = process.argv.indexOf(flag);
  if (index < 0) {
    return '';
  }
  return String(process.argv[index + 1] || '').trim();
}

function parseArgs(): { reportPath: string; fixturePath: string; provider: string } {
  const reportPath = readArg('--report');
  const fixturePath = readArg('--fixture');
  const provider = readArg('--provider');
  return {
    reportPath: reportPath
      ? (path.isAbsolute(reportPath) ? reportPath : path.resolve(process.cwd(), reportPath))
      : GOLD_REPORT_PATH,
    fixturePath,
    provider: String(provider || '').trim().toLowerCase(),
  };
}

function normalizeLayerResult(value: Record<string, unknown>): LayerResult {
  const status = String(value.status || '').trim() || 'failed';
  return {
    status: (status === 'passed' || status === 'failed' || status === 'skipped' ? status : 'failed') as 'passed' | 'failed' | 'skipped',
    traceId: String(value.traceId || '').trim() || undefined,
    reasonCode: String(value.reasonCode || '').trim() || undefined,
    actionHint: String(value.actionHint || '').trim() || undefined,
    error: String(value.error || '').trim() || undefined,
    jobId: String(value.jobId || '').trim() || undefined,
    artifactSummary: value.artifactSummary && typeof value.artifactSummary === 'object'
      ? value.artifactSummary as Record<string, unknown>
      : undefined,
    bridgeLayer: String(value.bridgeLayer || '').trim() || undefined,
  };
}

function failedLayer(error: unknown): LayerResult {
  return {
    status: 'failed',
    error: error instanceof Error ? error.message : String(error || 'unknown error'),
  };
}

function parseTrailingJson(stdout: string): Record<string, unknown> {
  const normalized = String(stdout || '').trim();
  if (!normalized) {
    return {};
  }
  try {
    return JSON.parse(normalized) as Record<string, unknown>;
  } catch {
    let depth = 0;
    let inString = false;
    let escaped = false;
    let objectStart = -1;
    const topLevelCandidates: string[] = [];

    for (let index = 0; index < normalized.length; index += 1) {
      const char = normalized[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) {
        continue;
      }
      if (char === '{') {
        if (depth === 0) {
          objectStart = index;
        }
        depth += 1;
        continue;
      }
      if (char !== '}') {
        continue;
      }
      if (depth === 0) {
        continue;
      }
      depth -= 1;
      if (depth === 0 && objectStart >= 0) {
        topLevelCandidates.push(normalized.slice(objectStart, index + 1).trim());
      }
    }

    for (let index = topLevelCandidates.length - 1; index >= 0; index -= 1) {
      try {
        return JSON.parse(topLevelCandidates[index]) as Record<string, unknown>;
      } catch {
        continue;
      }
    }
    throw new Error('invalid json output');
  }
}

function summarizeOutput(label: string, value: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return `${label}=<empty>`;
  }
  if (normalized.length <= 1200) {
    return `${label}=${normalized}`;
  }
  const head = normalized.slice(0, 600);
  const tail = normalized.slice(-600);
  return `${label}=${head}\n...\n${tail}`;
}

function runJsonCommand(command: string, args: string[], cwd: string, extraEnv: Record<string, string> = {}): JsonCommandResult {
  const result = spawnSync(command, args, {
    cwd,
    env: {
      ...process.env,
      ...extraEnv,
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 12 * 60 * 1000,
  });
  const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
  if (result.error) {
    return {
      ok: false,
      error: result.error.message,
    };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      error: `${command} ${args.join(' ')} failed: ${stderr || stdout || 'unknown error'}`,
    };
  }
  try {
    return {
      ok: true,
      value: parseTrailingJson(stdout),
    };
  } catch (error) {
    return {
      ok: false,
      error: [
        error instanceof Error ? error.message : String(error || 'invalid json output'),
        summarizeOutput('stdout', stdout),
        summarizeOutput('stderr', stderr),
      ].join('\n'),
    };
  }
}

function runCommandLayer(command: string, args: string[], cwd: string, extraEnv: Record<string, string> = {}): LayerResult {
  const result = runJsonCommand(command, args, cwd, extraEnv);
  if (!result.ok) {
    return failedLayer(result.error);
  }
  return normalizeLayerResult(result.value);
}

function skippedLayer(reason: string, extra?: Partial<LayerResult>): LayerResult {
  return {
    status: 'skipped',
    error: reason,
    ...extra,
  };
}

function reservedLayer(reason: string): LayerResult {
  return {
    status: 'reserved',
    error: reason,
  };
}

function toFirstFailingLayer(record: FixtureRecord): string | null {
  if (!record.gated) {
    return null;
  }
  for (const layer of ['L0', 'L1', 'L2', 'L3', 'L4']) {
    const status = record.layers[layer]?.status;
    if (status === 'failed' || status === 'skipped') {
      return layer;
    }
  }
  return null;
}

function createRuntimeModule(endpoint: string): Runtime {
  return new Runtime({
    appId: GOLD_APP_ID,
    transport: {
      type: 'node-grpc',
      endpoint,
    },
  });
}

async function issueGoldPathAccessEnv(endpoint: string): Promise<Record<string, string>> {
  const runtime = createRuntimeModule(endpoint);
  const ensureRegistered = createNimiRuntimeFullAppRegistration(
    () => ({ auth: runtime.auth }),
    {
      appId: GOLD_APP_ID,
      appInstanceId: GOLD_APP_INSTANCE_ID,
      deviceId: GOLD_DEVICE_ID,
      capabilities: ['ai.spend.meter'],
      developerRegistration: true,
    },
  );
  await ensureRegistered();
  const token = await runtime.grants.authorizeExternalPrincipal({
    domain: 'app-auth',
    appId: GOLD_APP_ID,
    externalPrincipalId: GOLD_APP_ID,
    externalPrincipalType: ExternalPrincipalType.APP,
    subjectUserId: GOLD_SUBJECT_USER_ID,
    consentId: 'gold-path-live',
    consentVersion: 'v1',
    decisionAt: toNimiRuntimeTimestamp(new Date()),
    policyVersion: 'gold-path-live-v1',
    policyMode: PolicyMode.CUSTOM,
    preset: AuthorizationPreset.UNSPECIFIED,
    scopes: ['ai.spend.meter'],
    resourceSelectors: { conversationIds: [], messageIds: [], documentIds: [], labels: {} },
    canDelegate: false,
    maxDelegationDepth: 0,
    ttlSeconds: 3600,
    scopeCatalogVersion: GOLD_SCOPE_CATALOG_VERSION,
    policyOverride: false,
  }, withNimiRuntimeIdempotencyMetadata({
    metadata: { domain: 'app-auth' },
  }, randomUUID()));
  const tokenID = String(token.tokenId || '').trim();
  const secret = String(token.secret || '').trim();
  if (!tokenID || !secret) {
    throw new Error('gold-path protected access token response was empty');
  }
  return {
    NIMI_LIVE_GOLD_ACCESS_TOKEN_ID: tokenID,
    NIMI_LIVE_GOLD_ACCESS_TOKEN_SECRET: secret,
  };
}

async function evaluateFixture(fixture: ReturnType<typeof loadGoldFixture>): Promise<FixtureRecord> {
  const missingEnv = missingFixtureEnv(fixture);
  const record: FixtureRecord = {
    fixture_id: fixture.fixture_id,
    capability: fixture.capability,
    provider: fixture.provider,
    model_id: fixture.model_id,
    ...(fixture.target_model_id ? { target_model_id: fixture.target_model_id } : {}),
    gated: fixture.gated,
    path: fixture.path,
    missing_env: missingEnv,
    first_failing_layer: null,
    layers: {},
  };

  if (!fixture.gated) {
    record.layers.L0 = reservedLayer('fixture reserved for architecture only');
    record.layers.L1 = reservedLayer('fixture reserved for architecture only');
    record.layers.L2 = reservedLayer('fixture reserved for architecture only');
    record.layers.L3 = reservedLayer('fixture reserved for architecture only');
    record.layers.L4 = reservedLayer('fixture reserved for architecture only');
    return record;
  }

  if (missingEnv.length > 0) {
    const reason = `missing env: ${missingEnv.join(', ')}`;
    record.layers.L0 = skippedLayer(reason);
    record.layers.L1 = skippedLayer(reason);
    record.layers.L2 = skippedLayer(reason);
    record.layers.L3 = skippedLayer(reason);
    record.layers.L4 = reservedLayer('legacy mod consumer layer removed');
    record.first_failing_layer = toFirstFailingLayer(record);
    return record;
  }

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const runtimeDir = path.join(repoRoot, 'runtime');
  const sdkGoldRunnerPath = path.join(
    repoRoot,
    'scripts/ai-gold-path/sdk-vnext-runner.ts',
  );

  record.layers.L0 = runCommandLayer(
    'go',
    ['run', './cmd/nimi', 'ai', 'provider-raw', '--fixture', fixture.path],
    runtimeDir,
  );

  try {
    await withRuntimeDaemon({
      appId: GOLD_APP_ID,
      runtimeEnv: runtimeEnvForFixture(fixture),
      run: async ({ endpoint }) => {
        const protectedAccessEnv = await issueGoldPathAccessEnv(endpoint);
        record.layers.L1 = runCommandLayer(
          'go',
          ['run', './cmd/nimi', 'ai', 'replay', '--grpc-addr', endpoint, '--fixture', fixture.path],
          runtimeDir,
          protectedAccessEnv,
        );
        record.layers.L2 = runCommandLayer(
          'pnpm',
          [
            '--filter',
            '@nimiplatform/sdk',
            'exec',
            'tsx',
            sdkGoldRunnerPath,
            '--endpoint',
            endpoint,
            '--fixture',
            fixture.path,
          ],
          repoRoot,
          protectedAccessEnv,
        );
        record.layers.L3 = reservedLayer('legacy desktop bridge replay layer removed');
        record.layers.L4 = reservedLayer('legacy mod consumer layer removed');
      },
    });
  } catch (error) {
    const daemonFailure = failedLayer(error);
    record.layers.L1 = record.layers.L1 || daemonFailure;
    record.layers.L2 = record.layers.L2 || daemonFailure;
    record.layers.L3 = record.layers.L3 || reservedLayer('legacy desktop bridge replay layer removed');
    record.layers.L4 = record.layers.L4 || reservedLayer('legacy mod consumer layer removed');
  }

  record.first_failing_layer = toFirstFailingLayer(record);
  return record;
}

async function main(): Promise<void> {
  const { reportPath, fixturePath, provider } = parseArgs();
  const fixtures = fixturePath
    ? [loadGoldFixture(fixturePath)]
    : loadGoldFixtures().filter((fixture) => !provider || fixture.provider.toLowerCase() === provider);
  if (fixtures.length === 0) {
    throw new Error(provider ? `no gold fixtures found for provider ${provider}` : 'no gold fixtures found');
  }
  const records: FixtureRecord[] = [];
  for (const fixture of fixtures) {
    records.push(await evaluateFixture(fixture));
  }

  const report = {
    generated_at: new Date().toISOString(),
    fixtures: records,
  };
  const summary = summarizeGoldReport(report);
  const fullReport = {
    ...report,
    summary,
  };

  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, YAML.stringify(fullReport), 'utf8');
  process.stdout.write(`${JSON.stringify({ reportPath, summary }, null, 2)}\n`);
}

void main().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error || '');
  process.stderr.write(`${detail}\n`);
  process.exitCode = 1;
});
