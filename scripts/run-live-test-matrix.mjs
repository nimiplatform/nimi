#!/usr/bin/env node

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const runtimeDir = path.join(repoRoot, 'runtime');
const sdkTestFile = path.join(
  repoRoot,
  'sdk/test/runtime/contract/providers/nimi-sdk-ai-provider-live-smoke.test.ts',
);
const reportDir = path.join(repoRoot, 'dev', 'report');
const reportPath = path.join(reportDir, 'live-test-coverage.yaml');

// ---------------------------------------------------------------------------
// Matrix definition
// ---------------------------------------------------------------------------

const RUNTIME_PROVIDERS = [
  'local', 'nimillm', 'openai', 'anthropic', 'dashscope', 'volcengine',
  'gemini', 'minimax', 'kimi', 'glm', 'deepseek', 'openrouter',
];

const RUNTIME_INTERFACES = {
  generate: { pattern: (p) => `TestLiveSmoke${canonicalName(p)}GenerateText` },
  embed: { pattern: (p) => `TestLiveSmoke${canonicalName(p)}Embed` },
  image: { pattern: (p) => `TestLiveSmoke${canonicalName(p)}SubmitMediaJobModalities/image` },
  video: { pattern: (p) => `TestLiveSmoke${canonicalName(p)}SubmitMediaJobModalities/video` },
  tts: { pattern: (p) => `TestLiveSmoke${canonicalName(p)}SubmitMediaJobModalities/tts` },
  stt: { pattern: (p) => `TestLiveSmoke${canonicalName(p)}SubmitMediaJobModalities/stt` },
  connector_tts: { pattern: (p) => `TestLiveSmokeConnector${canonicalName(p)}TTS` },
};

const SDK_PROVIDERS = [
  'local', 'nimillm', 'openai', 'anthropic', 'dashscope', 'volcengine',
  'gemini', 'deepseek',
];

const SDK_INTERFACES = {
  generate: { pattern: (p) => `${sdkCanonicalName(p)} generate text` },
};

// Maps provider IDs to the test function naming convention.
const CANONICAL_NAMES = {
  local: 'Local',
  nimillm: 'NimiLLM',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  dashscope: 'DashScope',
  volcengine: 'Volcengine',
  gemini: 'Gemini',
  minimax: 'MiniMax',
  kimi: 'Kimi',
  glm: 'GLM',
  deepseek: 'DeepSeek',
  openrouter: 'OpenRouter',
};

// Aliases for media tests that use different naming (e.g., "Alibaba" for dashscope, "Bytedance" for volcengine).
const RUNTIME_ALIASES = {
  dashscope: ['DashScope', 'Alibaba'],
  volcengine: ['Volcengine', 'Bytedance'],
};

const SDK_CANONICAL_NAMES = {
  local: 'local provider',
  nimillm: 'nimillm',
  openai: 'openai',
  anthropic: 'anthropic',
  dashscope: 'dashscope',
  volcengine: 'volcengine',
  gemini: 'gemini',
  deepseek: 'deepseek',
};

function canonicalName(provider) {
  return CANONICAL_NAMES[provider] || provider;
}

function sdkCanonicalName(provider) {
  return SDK_CANONICAL_NAMES[provider] || provider;
}

// ---------------------------------------------------------------------------
// Test runners
// ---------------------------------------------------------------------------

function runRuntimeTests() {
  process.stdout.write('[live-test-matrix] running runtime live smoke tests...\n');
  const result = spawnSync(
    'go',
    ['test', './internal/services/ai/', '-v', '-run', 'TestLiveSmoke', '-timeout', '15m', '-count=1'],
    {
      cwd: runtimeDir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 15 * 60 * 1000,
    },
  );

  const output = [
    typeof result.stdout === 'string' ? result.stdout : '',
    typeof result.stderr === 'string' ? result.stderr : '',
  ].join('\n');

  return output;
}

function runSdkTests() {
  process.stdout.write('[live-test-matrix] running SDK live smoke tests...\n');
  const result = spawnSync(
    'npx',
    ['tsx', '--test', sdkTestFile],
    {
      cwd: repoRoot,
      env: { ...process.env, NIMI_SDK_LIVE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 20 * 60 * 1000,
    },
  );

  const output = [
    typeof result.stdout === 'string' ? result.stdout : '',
    typeof result.stderr === 'string' ? result.stderr : '',
  ].join('\n');

  return output;
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/**
 * Parse Go test output for PASS/FAIL/SKIP status.
 * Lines like:
 *   --- PASS: TestLiveSmokeOpenAIGenerateText (1.23s)
 *   --- FAIL: TestLiveSmokeOpenAIGenerateText (0.50s)
 *   --- SKIP: TestLiveSmokeOpenAIGenerateText (0.00s)
 */
function parseGoTestOutput(output) {
  const results = new Map();
  const lines = output.split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(/---\s+(PASS|FAIL|SKIP):\s+(\S+)/);
    if (!match) {
      continue;
    }
    const [, status, testName] = match;
    results.set(testName, status.toLowerCase());
  }

  // Also capture skip reasons from t.Skipf output lines.
  const skipReasons = new Map();
  for (const line of lines) {
    const skipMatch = line.match(/live_provider_smoke_test\.go:\d+:\s+(.+)/);
    if (skipMatch) {
      // Find the most recent test name above this line.
      const reasonText = skipMatch[1].trim();
      if (reasonText.startsWith('set ')) {
        // Extract env var name from "set NIMI_LIVE_XXX to run live smoke test"
        const envMatch = reasonText.match(/set\s+(\S+)\s+to/);
        if (envMatch) {
          skipReasons.set(envMatch[1], reasonText);
        }
      }
    }
  }

  return { results, skipReasons };
}

/**
 * Parse Node.js test runner output for pass/fail/skip status.
 * Lines like:
 *   # pass 2
 *   # fail 0
 *   # skip 1
 * And individual test lines:
 *   ok 1 - nimi sdk ai-provider live smoke: openai generate text
 *   not ok 2 - nimi sdk ai-provider live smoke: anthropic generate text
 *   ok 3 - nimi sdk ai-provider live smoke: local provider generate text # SKIP
 */
function parseNodeTestOutput(output) {
  const results = new Map();
  const lines = output.split(/\r?\n/);

  for (const line of lines) {
    // TAP format: "ok N - description" or "not ok N - description"
    const tapMatch = line.match(/^(ok|not ok)\s+\d+\s+-\s+(.+?)(?:\s+#\s+(.+))?$/);
    if (tapMatch) {
      const [, okStatus, description, directive] = tapMatch;
      const testName = description.trim();
      if (directive && directive.toUpperCase().startsWith('SKIP')) {
        results.set(testName, 'skip');
      } else if (okStatus === 'ok') {
        results.set(testName, 'pass');
      } else {
        results.set(testName, 'fail');
      }
      continue;
    }

    // Node test runner v20+ format: "✓ description" / "✗ description" / "- description (skipped)"
    const nodePass = line.match(/^\s*[✓✔]\s+(.+?)(?:\s+\(\d+[\d.]*m?s\))?$/);
    if (nodePass) {
      results.set(nodePass[1].trim(), 'pass');
      continue;
    }
    const nodeFail = line.match(/^\s*[✗✘]\s+(.+?)(?:\s+\(\d+[\d.]*m?s\))?$/);
    if (nodeFail) {
      results.set(nodeFail[1].trim(), 'fail');
      continue;
    }
    const nodeSkip = line.match(/^\s*[-–]\s+(.+?)\s+\(skipped\)/);
    if (nodeSkip) {
      results.set(nodeSkip[1].trim(), 'skip');
      continue;
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Matrix mapping
// ---------------------------------------------------------------------------

function lookupTestStatus(goResults, testName) {
  // Direct match.
  const direct = goResults.get(testName);
  if (direct) {
    return direct;
  }
  // For subtest patterns like "TestFoo/image", check if the parent "TestFoo" has a status.
  // When a Go parent test skips, subtests never run and only the parent name appears in output.
  const slashIdx = testName.indexOf('/');
  if (slashIdx > 0) {
    const parent = testName.slice(0, slashIdx);
    return goResults.get(parent) || null;
  }
  return null;
}

function mapRuntimeResults(goResults) {
  const matrix = {};

  for (const provider of RUNTIME_PROVIDERS) {
    matrix[provider] = {};

    for (const [iface, def] of Object.entries(RUNTIME_INTERFACES)) {
      const expectedTestName = def.pattern(provider);

      // Check primary name and aliases.
      let status = lookupTestStatus(goResults, expectedTestName);

      if (!status) {
        // Try aliases (e.g., dashscope → Alibaba for media tests, volcengine → Bytedance).
        const aliases = RUNTIME_ALIASES[provider] || [];
        for (const alias of aliases) {
          const aliasPattern = expectedTestName.replace(canonicalName(provider), alias);
          status = lookupTestStatus(goResults, aliasPattern);
          if (status) {
            break;
          }
        }
      }

      if (status === 'pass') {
        matrix[provider][iface] = { status: 'passed' };
      } else if (status === 'fail') {
        matrix[provider][iface] = { status: 'failed' };
      } else if (status === 'skip') {
        matrix[provider][iface] = { status: 'skipped', reason: 'env var not set' };
      } else {
        matrix[provider][iface] = { status: 'no_test', reason: 'no test exists for this cell' };
      }
    }
  }

  return matrix;
}

function mapSdkResults(nodeResults) {
  const matrix = {};

  for (const provider of SDK_PROVIDERS) {
    matrix[provider] = {};

    for (const [iface, def] of Object.entries(SDK_INTERFACES)) {
      const expectedTestName = `nimi sdk ai-provider live smoke: ${def.pattern(provider)}`;

      let status = null;
      // Try exact match first, then partial match.
      if (nodeResults.has(expectedTestName)) {
        status = nodeResults.get(expectedTestName);
      } else {
        // Partial match.
        for (const [name, result] of nodeResults) {
          if (name.includes(def.pattern(provider))) {
            status = result;
            break;
          }
        }
      }

      if (status === 'pass') {
        matrix[provider][iface] = { status: 'passed' };
      } else if (status === 'fail') {
        matrix[provider][iface] = { status: 'failed' };
      } else if (status === 'skip') {
        matrix[provider][iface] = { status: 'skipped', reason: 'env var not set' };
      } else {
        matrix[provider][iface] = { status: 'no_test', reason: 'no test exists for this cell' };
      }
    }
  }

  return matrix;
}

// ---------------------------------------------------------------------------
// YAML emitter (minimal, no dependency)
// ---------------------------------------------------------------------------

function toYaml(obj, indent = 0) {
  const prefix = '  '.repeat(indent);
  let out = '';

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      out += `${prefix}${key}: null\n`;
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      out += `${prefix}${key}:\n`;
      out += toYaml(value, indent + 1);
    } else if (typeof value === 'string') {
      out += `${prefix}${key}: "${value}"\n`;
    } else {
      out += `${prefix}${key}: ${value}\n`;
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const skipRuntime = process.argv.includes('--skip-runtime');
  const skipSdk = process.argv.includes('--skip-sdk');

  let runtimeMatrix = {};
  let sdkMatrix = {};
  let summary = { total_cells: 0, passed: 0, skipped: 0, failed: 0, no_test: 0 };

  if (!skipRuntime) {
    const runtimeOutput = runRuntimeTests();
    const { results: goResults } = parseGoTestOutput(runtimeOutput);
    runtimeMatrix = mapRuntimeResults(goResults);
  }

  if (!skipSdk) {
    const sdkOutput = runSdkTests();
    const nodeResults = parseNodeTestOutput(sdkOutput);
    sdkMatrix = mapSdkResults(nodeResults);
  }

  // Count summary.
  for (const providerData of [...Object.values(runtimeMatrix), ...Object.values(sdkMatrix)]) {
    for (const cell of Object.values(providerData)) {
      summary.total_cells += 1;
      if (cell.status === 'passed') {
        summary.passed += 1;
      } else if (cell.status === 'failed') {
        summary.failed += 1;
      } else if (cell.status === 'skipped') {
        summary.skipped += 1;
      } else {
        summary.no_test += 1;
      }
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    summary,
    runtime: runtimeMatrix,
    sdk: sdkMatrix,
  };

  const yaml = toYaml(report);

  if (!existsSync(reportDir)) {
    mkdirSync(reportDir, { recursive: true });
  }
  writeFileSync(reportPath, yaml, 'utf8');

  process.stdout.write(`[live-test-matrix] report written to ${reportPath}\n`);
  process.stdout.write(`[live-test-matrix] summary: ${summary.passed} passed, ${summary.skipped} skipped, ${summary.failed} failed, ${summary.no_test} no_test (${summary.total_cells} total cells)\n`);

  if (summary.failed > 0) {
    process.stdout.write('[live-test-matrix] WARNING: some tests failed\n');
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[live-test-matrix] fatal: ${message}\n`);
  process.exit(1);
}
