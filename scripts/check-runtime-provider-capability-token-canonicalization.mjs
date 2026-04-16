#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const sourceDir = path.join(repoRoot, 'runtime', 'catalog', 'source', 'providers');
const snapshotDir = path.join(repoRoot, 'runtime', 'catalog', 'providers');

const legacyCapabilityTokens = new Set([
  'chat',
  'embedding',
  'image',
  'tts',
  'stt',
  'video_generation',
  'llm.text.generate',
  'llm.embed',
  'llm.image.generate',
  'llm.video.generate',
  'llm.speech.synthesize',
  'llm.speech.transcribe',
]);

const canonicalCapabilityTokens = [
  'text.generate',
  'text.embed',
  'image.generate',
  'video.generate',
  'audio.synthesize',
  'audio.transcribe',
  'music.generate',
  'music.generate.iteration',
  'voice_workflow.tts_v2v',
  'voice_workflow.tts_t2v',
];

let failed = false;

function fail(message) {
  failed = true;
  console.error(`ERROR: ${message}`);
}

function readText(absPath) {
  return fs.readFileSync(absPath, 'utf8');
}

function readYaml(absPath) {
  return YAML.parse(readText(absPath)) || {};
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function checkCapabilityList(relPath, label, capabilities) {
  for (const capability of capabilities) {
    const normalized = capability.toLowerCase();
    if (legacyCapabilityTokens.has(normalized)) {
      fail(`${relPath} ${label} contains legacy capability token: ${capability}`);
    }
  }
}

function checkSourceProviderFile(absPath) {
  const relPath = path.relative(repoRoot, absPath);
  const doc = readYaml(absPath);
  checkCapabilityList(relPath, 'defaults.capabilities', normalizeStringArray(doc?.defaults?.capabilities));
  const models = Array.isArray(doc?.models) ? doc.models : [];
  models.forEach((model, index) => {
    const modelID = String(model?.model_id || '').trim() || `#${index}`;
    checkCapabilityList(relPath, `models[${modelID}].capabilities`, normalizeStringArray(model?.capabilities));
  });
}

function checkSnapshotFile(absPath) {
  const relPath = path.relative(repoRoot, absPath);
  const doc = readYaml(absPath);
  const models = Array.isArray(doc?.models) ? doc.models : [];
  models.forEach((model, index) => {
    const modelID = String(model?.model_id || '').trim() || `#${index}`;
    checkCapabilityList(relPath, `models[${modelID}].capabilities`, normalizeStringArray(model?.capabilities));
  });
}

function checkDocPhrases(absPath, bannedPatterns, requiredTokens) {
  const relPath = path.relative(repoRoot, absPath);
  const content = readText(absPath);
  for (const pattern of bannedPatterns) {
    if (pattern.regex.test(content)) {
      fail(`${relPath} still contains legacy normative phrase: ${pattern.label}`);
    }
  }
  for (const token of requiredTokens) {
    if (!content.includes(`\`${token}\``)) {
      fail(`${relPath} must mention canonical capability token ${token}`);
    }
  }
}

function main() {
  const sourceFiles = fs.readdirSync(sourceDir)
    .filter((entry) => entry.endsWith('.source.yaml'))
    .map((entry) => path.join(sourceDir, entry))
    .sort((left, right) => left.localeCompare(right));
  const snapshotFiles = fs.readdirSync(snapshotDir)
    .filter((entry) => entry.endsWith('.yaml'))
    .map((entry) => path.join(snapshotDir, entry))
    .sort((left, right) => left.localeCompare(right));

  sourceFiles.forEach(checkSourceProviderFile);
  snapshotFiles.forEach(checkSnapshotFile);

  checkDocPhrases(
    path.join(repoRoot, 'runtime', 'catalog', 'source', 'README.md'),
    [
      { label: 'When a model declares `tts`', regex: /When a model declares `tts`/ },
      { label: 'When a model declares `video_generation`', regex: /When a model declares `video_generation`/ },
      { label: '`tts` capability models', regex: /`tts` capability models/ },
      { label: '`video_generation` capability models', regex: /`video_generation` capability models/ },
    ],
    canonicalCapabilityTokens,
  );
  checkDocPhrases(
    path.join(repoRoot, '.nimi', 'spec', 'runtime', 'kernel', 'model-catalog-contract.md'),
    [
      { label: 'when capability includes `tts`', regex: /when capability includes `tts`/ },
      { label: 'when capability includes `video_generation`', regex: /when capability includes `video_generation`/ },
      { label: '对于仅提供视频能力（不含 `tts`', regex: /对于仅提供视频能力（不含 `tts`/ },
    ],
    canonicalCapabilityTokens,
  );

  if (failed) {
    process.exit(1);
  }

  console.log('runtime-provider-capability-token-canonicalization: OK');
}

main();
