#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

function normalizeProviderId(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => normalizeProviderId(item))
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

function extractGoFunctionBody(source, signatureToken) {
  const sourceText = String(source || '');
  const signatureIndex = sourceText.indexOf(signatureToken);
  if (signatureIndex === -1) {
    return '';
  }
  const braceIndex = sourceText.indexOf('{', signatureIndex);
  if (braceIndex === -1) {
    return '';
  }

  let depth = 1;
  for (let index = braceIndex + 1; index < sourceText.length; index += 1) {
    const char = sourceText[index];
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return sourceText.slice(braceIndex + 1, index);
      }
    }
  }

  return '';
}

function addProviders(target, values) {
  for (const value of values) {
    const provider = normalizeProviderId(value);
    if (provider) {
      target.add(provider);
    }
  }
}

function parseCaseProviders(body) {
  const providers = new Set();
  const caseRegex = /case\s+([^:]+):/g;
  let match;
  while ((match = caseRegex.exec(body)) !== null) {
    const clause = String(match[1] || '');
    const itemRegex = /"([^"]+)"/g;
    let itemMatch;
    while ((itemMatch = itemRegex.exec(clause)) !== null) {
      addProviders(providers, [itemMatch[1]]);
    }
  }
  return providers;
}

function parseEqualityProviders(body) {
  const providers = new Set();
  const patterns = [
    /\b(?:p|provider)\s*==\s*"([^"]+)"/g,
    /strings\.EqualFold\([^,]+,\s*"([^"]+)"\)/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(body)) !== null) {
      addProviders(providers, [match[1]]);
    }
  }

  return providers;
}

function collectVoiceWorkflowProvidersFromSource(source) {
  const providers = new Set();
  const supportBody = extractGoFunctionBody(source, 'func SupportsVoiceWorkflowProvider(');
  const dispatchBody = extractGoFunctionBody(source, 'func ExecuteVoiceWorkflow(');

  addProviders(providers, parseCaseProviders(supportBody));
  addProviders(providers, parseEqualityProviders(supportBody));
  addProviders(providers, parseCaseProviders(dispatchBody));
  addProviders(providers, parseEqualityProviders(dispatchBody));

  return providers;
}

function parseVoiceWorkflowProviders(absPath) {
  return collectVoiceWorkflowProvidersFromSource(readText(absPath));
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
    if (inferred.workflowCount > 0 && !voiceWorkflowProviders.has(normalizeProviderId(provider))) {
      fail(`${relPath} provider ${provider} declares voice workflows but has no nimillm voice adapter`);
    }
  }

  if (failed) {
    process.exit(1);
  }

  console.log('runtime-provider-activation-alignment: OK');
}

function isDirectExecution() {
  const entry = String(process.argv[1] || '').trim();
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

export {
  collectVoiceWorkflowProvidersFromSource,
  extractGoFunctionBody,
  inferSourceCapabilities,
  main,
  parseCaseProviders,
  parseEqualityProviders,
  parseRegistryRecords,
  parseVoiceWorkflowProviders,
};

if (isDirectExecution()) {
  main();
}
