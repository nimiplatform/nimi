#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();

const targets = [
  'proto/runtime/v1/ai.proto',
  'proto/runtime/v1/voice.proto',
  'runtime/internal/services/ai',
  'runtime/internal/nimillm',
  'runtime/catalog/source/providers',
  'runtime/catalog/providers',
  'sdk/src/runtime',
  'sdk/src/ai-provider',
  'apps/desktop/src/runtime',
  'spec/runtime',
  'spec/sdk',
  'spec/desktop',
];

const banned = [
  { key: 'submit_media_job', label: 'legacy RPC SubmitMediaJob', regex: /\bSubmitMediaJob\b/g },
  { key: 'get_media_job', label: 'legacy RPC GetMediaJob', regex: /\bGetMediaJob\b/g },
  { key: 'cancel_media_job', label: 'legacy RPC CancelMediaJob', regex: /\bCancelMediaJob\b/g },
  { key: 'subscribe_media_job_events', label: 'legacy RPC SubscribeMediaJobEvents', regex: /\bSubscribeMediaJobEvents\b/g },
  { key: 'get_media_artifacts', label: 'legacy RPC GetMediaArtifacts', regex: /\bGetMediaArtifacts\b/g },
  { key: 'get_media_result', label: 'legacy RPC GetMediaResult', regex: /\bGetMediaResult\b/g },
  { key: 'stream_generate', label: 'legacy RPC StreamGenerate', regex: /\bStreamGenerate\b/g },
  { key: 'synthesize_speech_stream', label: 'legacy RPC SynthesizeSpeechStream', regex: /\bSynthesizeSpeechStream\b/g },
  { key: 'media_job_type', label: 'legacy type MediaJob', regex: /\bMediaJob\b/g },
  { key: 'media_artifact_type', label: 'legacy type MediaArtifact', regex: /\bMediaArtifact\b/g },
  { key: 'provider_options', label: 'legacy free field provider_options', regex: /\bprovider_options\b/g },
  { key: 'provider_raw', label: 'legacy free field provider_raw', regex: /\bprovider_raw\b/g },
  { key: 'compat_namespace', label: 'legacy extension namespace nimi.runtime.compat', regex: /nimi\.runtime\.compat/g },
  { key: 'local_next', label: 'legacy provider local-next', regex: /\blocal-next\b/g },
];

const allowLineMatch = [
  {
    key: 'provider_options',
    rel: 'proto/runtime/v1/voice.proto',
    allow: (line) => line.includes('reserved "provider_options"'),
  },
  {
    key: 'stream_generate',
    rel: 'spec/runtime/kernel/rpc-surface.md',
    allow: (line) => line.includes('StreamGenerateText'),
  },
  {
    key: 'stream_generate',
    rel: 'scripts/check-runtime-spec-kernel-consistency.mjs',
    allow: (line) => line.includes('StreamGenerateText'),
  },
];

const rpcSurfaceForbiddenListAllowKeys = new Set([
  'submit_media_job',
  'get_media_job',
  'cancel_media_job',
  'subscribe_media_job_events',
  'get_media_result',
  'stream_generate',
  'synthesize_speech_stream',
]);

const includeExt = new Set(['.go', '.ts', '.tsx', '.md', '.yaml', '.yml', '.proto', '.mjs']);
const failures = [];

function walk(absPath, out) {
  const stat = fs.statSync(absPath);
  if (stat.isFile()) {
    if (includeExt.has(path.extname(absPath))) {
      out.push(absPath);
    }
    return;
  }
  const entries = fs.readdirSync(absPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'generated' || entry.name === 'gen') {
      continue;
    }
    walk(path.join(absPath, entry.name), out);
  }
}

function isRpcSurfaceForbiddenNameListLine(rel, lines, lineIndex) {
  if (rel !== 'spec/runtime/kernel/rpc-surface.md') {
    return false;
  }
  const line = String(lines[lineIndex] || '');
  if (!/^\s*-\s+`[^`]+`\s*$/.test(line)) {
    return false;
  }
  for (let i = lineIndex; i >= 0; i -= 1) {
    const text = String(lines[i] || '').trim();
    if (!text.startsWith('## ')) {
      continue;
    }
    return text === '## K-RPC-006 对外契约禁用名';
  }
  return false;
}

function isAllowed(key, rel, line, lines, lineIndex) {
  if (rpcSurfaceForbiddenListAllowKeys.has(key) && isRpcSurfaceForbiddenNameListLine(rel, lines, lineIndex)) {
    return true;
  }
  for (const item of allowLineMatch) {
    if (item.key !== key) {
      continue;
    }
    if (item.rel !== rel) {
      continue;
    }
    if (item.allow(line)) {
      return true;
    }
  }
  return false;
}

const files = [];
for (const rel of targets) {
  const abs = path.join(cwd, rel);
  if (!fs.existsSync(abs)) {
    continue;
  }
  walk(abs, files);
}

for (const abs of files) {
  const rel = path.relative(cwd, abs).replace(/\\/g, '/');
  const content = fs.readFileSync(abs, 'utf8');
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] || '';
    for (const token of banned) {
      token.regex.lastIndex = 0;
      if (!token.regex.test(line)) {
        continue;
      }
      if (isAllowed(token.key, rel, line, lines, i)) {
        continue;
      }
      failures.push(`${rel}:${i + 1}: ${token.label}: ${line.trim()}`);
    }
  }
}

if (failures.length > 0) {
  process.stderr.write('AI scenario hard-cut drift check failed:\n');
  for (const item of failures) {
    process.stderr.write(`- ${item}\n`);
  }
  process.exit(1);
}

process.stdout.write(`AI scenario hard-cut drift check passed (${files.length} file(s) scanned)\n`);
