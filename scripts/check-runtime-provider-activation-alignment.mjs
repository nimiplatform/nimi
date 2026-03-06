#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const sourceDir = path.join(repoRoot, 'runtime', 'catalog', 'source', 'providers');
const registryPath = path.join(repoRoot, 'runtime', 'internal', 'providerregistry', 'generated.go');
const voiceAdapterPath = path.join(repoRoot, 'runtime', 'internal', 'nimillm', 'adapter_voice.go');

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
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean);
}

function inferSourceCapabilities(doc) {
  const defaults = normalizeStringArray(doc?.defaults?.capabilities);
  const models = Array.isArray(doc?.models) ? doc.models : [];
  let supportsTTS = false;
  let supportsSTT = false;
  for (const model of models) {
    const capabilities = normalizeStringArray(model?.capabilities);
    const effective = capabilities.length > 0 ? capabilities : defaults;
    if (effective.includes('audio.synthesize')) {
      supportsTTS = true;
    }
    if (effective.includes('audio.transcribe')) {
      supportsSTT = true;
    }
  }
  const workflows = Array.isArray(doc?.voice_workflow_models) ? doc.voice_workflow_models : [];
  return {
    supportsTTS,
    supportsSTT,
    workflowCount: workflows.length,
  };
}

function parseRegistryRecords(absPath) {
  const source = readText(absPath);
  const records = new Map();
  const recordRegex = /"([^"]+)":\s*\{([\s\S]*?)\n\t\},/g;
  let match;
  while ((match = recordRegex.exec(source)) !== null) {
    const provider = String(match[1] || '').trim();
    const body = match[2];
    const parseBool = (field) => {
      const fieldMatch = body.match(new RegExp(`${field}:\\s*(true|false),`));
      return fieldMatch?.[1] === 'true';
    };
    records.set(provider, {
      supportsTTS: parseBool('SupportsTTS'),
      supportsSTT: parseBool('SupportsSTT'),
    });
  }
  return records;
}

function parseVoiceWorkflowProviders(absPath) {
  const source = readText(absPath);
  const fnMatch = source.match(/func SupportsVoiceWorkflowProvider\(provider string\) bool \{([\s\S]*?)\n\}/m);
  const providers = new Set();
  if (!fnMatch?.[1]) {
    return providers;
  }
  const caseRegex = /case\s+([^:]+):\s*return true/g;
  let match;
  while ((match = caseRegex.exec(fnMatch[1])) !== null) {
    const clause = String(match[1] || '');
    const itemRegex = /"([^"]+)"/g;
    let itemMatch;
    while ((itemMatch = itemRegex.exec(clause)) !== null) {
      providers.add(String(itemMatch[1] || '').trim());
    }
  }
  return providers;
}

function main() {
  const registryRecords = parseRegistryRecords(registryPath);
  const voiceWorkflowProviders = parseVoiceWorkflowProviders(voiceAdapterPath);
  const sourceFiles = fs.readdirSync(sourceDir)
    .filter((entry) => entry.endsWith('.source.yaml'))
    .map((entry) => path.join(sourceDir, entry))
    .sort((left, right) => left.localeCompare(right));

  for (const absPath of sourceFiles) {
    const relPath = path.relative(repoRoot, absPath);
    const doc = readYaml(absPath);
    const provider = String(doc?.provider || path.basename(absPath, '.source.yaml')).trim();
    const registry = registryRecords.get(provider);
    if (!registry) {
      fail(`${relPath} provider ${provider} is missing from runtime/internal/providerregistry/generated.go`);
      continue;
    }
    const inferred = inferSourceCapabilities(doc);
    if (inferred.supportsTTS !== registry.supportsTTS) {
      fail(`${relPath} provider ${provider} audio.synthesize mismatch with provider registry (source=${inferred.supportsTTS}, registry=${registry.supportsTTS})`);
    }
    if (inferred.supportsSTT !== registry.supportsSTT) {
      fail(`${relPath} provider ${provider} audio.transcribe mismatch with provider registry (source=${inferred.supportsSTT}, registry=${registry.supportsSTT})`);
    }
    if (provider === 'local' && inferred.workflowCount > 0) {
      fail(`${relPath} local must not declare voice_workflow_models while local workflow is disabled`);
    }
    if (provider === 'local') {
      const bindings = Array.isArray(doc?.model_workflow_bindings) ? doc.model_workflow_bindings : [];
      if (bindings.length > 0) {
        fail(`${relPath} local must not declare model_workflow_bindings while local workflow is disabled`);
      }
    }
    if (inferred.workflowCount > 0 && !voiceWorkflowProviders.has(provider)) {
      fail(`${relPath} provider ${provider} declares voice workflows but has no nimillm voice adapter`);
    }
  }

  if (failed) {
    process.exit(1);
  }

  console.log('runtime-provider-activation-alignment: OK');
}

main();
