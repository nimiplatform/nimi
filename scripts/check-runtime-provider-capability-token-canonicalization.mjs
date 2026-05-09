#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const sourceDir = path.join(repoRoot, 'runtime', 'catalog', 'source', 'providers');
const snapshotDir = path.join(repoRoot, 'runtime', 'catalog', 'providers');
const capabilityVocabularyPath = path.join(
  repoRoot,
  '.nimi',
  'spec',
  'runtime',
  'kernel',
  'tables',
  'capability-vocabulary-mapping.yaml',
);

const historicalLegacyCapabilityTokens = [
  'video_generation',
  'llm.text.generate',
  'llm.embed',
  'llm.image.generate',
  'llm.video.generate',
  'llm.speech.synthesize',
  'llm.speech.transcribe',
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

function loadCapabilityVocabulary() {
  const doc = readYaml(capabilityVocabularyPath);
  const canonicalTokens = normalizeStringArray(doc?.canonical_tokens);
  const localManifestTokens = normalizeStringArray(doc?.local_manifest_tokens);
  const legacyCapabilityTokens = new Set(
    [...localManifestTokens, ...historicalLegacyCapabilityTokens]
      .map((token) => token.toLowerCase()),
  );
  const canonicalCapabilityTokens = new Set(canonicalTokens.map((token) => token.toLowerCase()));
  if (canonicalTokens.length === 0) {
    fail(`${path.relative(repoRoot, capabilityVocabularyPath)} must define canonical_tokens`);
  }
  if (localManifestTokens.length === 0) {
    fail(`${path.relative(repoRoot, capabilityVocabularyPath)} must define local_manifest_tokens`);
  }
  if (canonicalCapabilityTokens.size !== canonicalTokens.length) {
    fail(`${path.relative(repoRoot, capabilityVocabularyPath)} canonical_tokens must be unique`);
  }
  if (localManifestTokens.some((token) => canonicalCapabilityTokens.has(token.toLowerCase()))) {
    fail(`${path.relative(repoRoot, capabilityVocabularyPath)} local_manifest_tokens must not duplicate canonical_tokens`);
  }
  const mappings = Array.isArray(doc?.local_to_canonical) ? doc.local_to_canonical : [];
  mappings.forEach((mapping, index) => {
    const localToken = String(mapping?.local_token || '').trim().toLowerCase();
    const canonicalToken = String(mapping?.canonical_token || '').trim().toLowerCase();
    if (!legacyCapabilityTokens.has(localToken)) {
      fail(`${path.relative(repoRoot, capabilityVocabularyPath)} local_to_canonical[${index}] local_token is not listed in local_manifest_tokens: ${mapping?.local_token}`);
    }
    if (!canonicalCapabilityTokens.has(canonicalToken)) {
      fail(`${path.relative(repoRoot, capabilityVocabularyPath)} local_to_canonical[${index}] canonical_token is not listed in canonical_tokens: ${mapping?.canonical_token}`);
    }
  });
  return {
    canonicalTokens,
    canonicalCapabilityTokens,
    legacyCapabilityTokens,
  };
}

function checkCapabilityList(relPath, label, capabilities, vocabulary) {
  for (const capability of capabilities) {
    const normalized = capability.toLowerCase();
    if (vocabulary.legacyCapabilityTokens.has(normalized)) {
      fail(`${relPath} ${label} contains legacy capability token: ${capability}`);
      continue;
    }
    if (!vocabulary.canonicalCapabilityTokens.has(normalized)) {
      fail(`${relPath} ${label} contains non-canonical capability token: ${capability}`);
    }
  }
}

function checkSourceProviderFile(absPath, vocabulary) {
  const relPath = path.relative(repoRoot, absPath);
  const doc = readYaml(absPath);
  checkCapabilityList(relPath, 'defaults.capabilities', normalizeStringArray(doc?.defaults?.capabilities), vocabulary);
  const models = Array.isArray(doc?.models) ? doc.models : [];
  models.forEach((model, index) => {
    const modelID = String(model?.model_id || '').trim() || `#${index}`;
    checkCapabilityList(relPath, `models[${modelID}].capabilities`, normalizeStringArray(model?.capabilities), vocabulary);
  });
}

function checkSnapshotFile(absPath, vocabulary) {
  const relPath = path.relative(repoRoot, absPath);
  const doc = readYaml(absPath);
  const models = Array.isArray(doc?.models) ? doc.models : [];
  models.forEach((model, index) => {
    const modelID = String(model?.model_id || '').trim() || `#${index}`;
    checkCapabilityList(relPath, `models[${modelID}].capabilities`, normalizeStringArray(model?.capabilities), vocabulary);
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
  const vocabulary = loadCapabilityVocabulary();
  const sourceFiles = fs.readdirSync(sourceDir)
    .filter((entry) => entry.endsWith('.source.yaml'))
    .map((entry) => path.join(sourceDir, entry))
    .sort((left, right) => left.localeCompare(right));
  const snapshotFiles = fs.readdirSync(snapshotDir)
    .filter((entry) => entry.endsWith('.yaml'))
    .map((entry) => path.join(snapshotDir, entry))
    .sort((left, right) => left.localeCompare(right));

  sourceFiles.forEach((sourceFile) => checkSourceProviderFile(sourceFile, vocabulary));
  snapshotFiles.forEach((snapshotFile) => checkSnapshotFile(snapshotFile, vocabulary));

  checkDocPhrases(
    path.join(repoRoot, 'runtime', 'catalog', 'source', 'README.md'),
    [
      { label: 'When a model declares `tts`', regex: /When a model declares `tts`/ },
      { label: 'When a model declares `video_generation`', regex: /When a model declares `video_generation`/ },
      { label: '`tts` capability models', regex: /`tts` capability models/ },
      { label: '`video_generation` capability models', regex: /`video_generation` capability models/ },
    ],
    vocabulary.canonicalTokens,
  );
  checkDocPhrases(
    path.join(repoRoot, '.nimi', 'spec', 'runtime', 'kernel', 'model-catalog-contract.md'),
    [
      { label: 'when capability includes `tts`', regex: /when capability includes `tts`/ },
      { label: 'when capability includes `video_generation`', regex: /when capability includes `video_generation`/ },
      { label: '对于仅提供视频能力（不含 `tts`', regex: /对于仅提供视频能力（不含 `tts`/ },
    ],
    vocabulary.canonicalTokens,
  );

  if (failed) {
    process.exit(1);
  }

  console.log('runtime-provider-capability-token-canonicalization: OK');
}

main();
