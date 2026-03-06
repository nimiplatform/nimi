#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);

const scanRoots = [
  'sdk/src/mod',
  'sdk/README.md',
  'spec/sdk',
  'spec/desktop',
  'apps/desktop/src',
  'apps/desktop/scripts',
  'apps/desktop/test',
  'apps/desktop/src-tauri/resources/default-mods',
  'nimi-mods/AGENTS.md',
  'nimi-mods/audio-book/mod.manifest.yaml',
  'nimi-mods/audio-book/src',
  'nimi-mods/audio-book/spec',
  'nimi-mods/audio-book/test',
  'nimi-mods/audio-book/test/scripts',
  'nimi-mods/kismet/mod.manifest.yaml',
  'nimi-mods/kismet/src',
  'nimi-mods/kismet/spec',
  'nimi-mods/kismet/test',
  'nimi-mods/knowledge-base/mod.manifest.yaml',
  'nimi-mods/knowledge-base/src',
  'nimi-mods/knowledge-base/spec',
  'nimi-mods/knowledge-base/test',
  'nimi-mods/local-chat/mod.manifest.yaml',
  'nimi-mods/local-chat/src',
  'nimi-mods/local-chat/spec',
  'nimi-mods/local-chat/test',
  'nimi-mods/meeting-scribe/spec',
  'nimi-mods/mint-you/mod.manifest.yaml',
  'nimi-mods/mint-you/src',
  'nimi-mods/mint-you/spec',
  'nimi-mods/mint-you/test',
  'nimi-mods/test-chat-tts/mod.manifest.yaml',
  'nimi-mods/test-chat-tts/src',
  'nimi-mods/test-chat-tts/spec',
  'nimi-mods/test-chat-tts/test',
  'nimi-mods/textplay/mod.manifest.yaml',
  'nimi-mods/textplay/src',
  'nimi-mods/textplay/spec',
  'nimi-mods/textplay/test',
  'nimi-mods/textplay/scripts',
  'nimi-mods/videoplay/mod.manifest.yaml',
  'nimi-mods/videoplay/src',
  'nimi-mods/videoplay/spec',
  'nimi-mods/videoplay/test',
  'nimi-mods/videoplay/scripts',
  'nimi-mods/world-studio/mod.manifest.yaml',
  'nimi-mods/world-studio/src',
  'nimi-mods/world-studio/spec',
  'nimi-mods/world-studio/test',
];

const allowedExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.md', '.yaml', '.yml']);

const bannedChecks = [
  { label: 'legacy mod ai package', pattern: /@nimiplatform\/sdk\/mod\/ai\b/g },
  { label: 'legacy createAiClient surface', pattern: /\bcreateAiClient\b/g },
  { label: 'legacy ModAiClient surface', pattern: /\bModAiClient\b/g },
  { label: 'legacy hook.llm capability', pattern: /\bhook\.llm\b/g },
  {
    label: 'legacy llm capability key',
    pattern: /\bllm\.(?:text\.(?:generate|stream)|image\.generate|video\.generate|embedding\.generate|lifecycle\.read|speech\.(?:providers\.list|voices\.list|synthesize|transcribe|\*))\b/g,
  },
  { label: 'legacy speech providers list surface', pattern: /\bllm\.speech\.providers\.list\b/g },
  { label: 'legacy speech stream control surface', pattern: /\bllm\.speech\.stream\.(?:open|control|close)\b/g },
  { label: 'legacy agent profile read hook key', pattern: /\bhook\.agent-profile\.read\b/g },
  { label: 'legacy data route options capability', pattern: /\bdata\.query\.data-api\.runtime\.route\.options\b/g },
  { label: 'legacy routeHint field', pattern: /\brouteHint\b/g },
  { label: 'legacy routeOverride field', pattern: /\brouteOverride\b/g },
  {
    label: 'legacy route capability token',
    pattern: /\b(?:chat\/default|image\/default|video\/default|tts\/default|stt\/default|embedding\/default|chat\/coarse|chat\/fine|chat\/retry-low-temp)\b/g,
  },
];

const failures = [];

function shouldSkipPath(absPath) {
  const relPath = relative(repoRoot, absPath).replaceAll('\\', '/');
  return relPath.includes('/dist/')
    || relPath.includes('/generated/')
    || relPath.endsWith('/dist')
    || relPath.endsWith('/generated');
}

function walk(absPath) {
  if (shouldSkipPath(absPath)) {
    return;
  }

  const entryStat = statSync(absPath);
  if (entryStat.isDirectory()) {
    for (const name of readdirSync(absPath)) {
      walk(resolve(absPath, name));
    }
    return;
  }

  if (!allowedExtensions.has(extname(absPath))) {
    return;
  }

  const relPath = relative(repoRoot, absPath).replaceAll('\\', '/');
  const content = readFileSync(absPath, 'utf8');
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || '';
    for (const check of bannedChecks) {
      check.pattern.lastIndex = 0;
      if (check.pattern.test(line)) {
        failures.push(`${relPath}:${index + 1}: ${check.label}: ${line.trim()}`);
      }
    }
  }
}

for (const root of scanRoots) {
  const absoluteRoot = resolve(repoRoot, root);
  if (!existsSync(absoluteRoot)) {
    continue;
  }
  walk(absoluteRoot);
}

if (failures.length > 0) {
  process.stderr.write(`runtime-aligned hook/mod hard-cut check failed:\n${failures.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('runtime-aligned hook/mod hard-cut check passed\n');
}
