#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const vocabularyRel = '.nimi/spec/runtime/kernel/tables/capability-vocabulary-mapping.yaml';
const assetKindRel = '.nimi/spec/runtime/kernel/tables/capability-to-asset-kind.yaml';
const outputRel = 'sdk/src/runtime/runtime-capability-vocabulary.generated.ts';

const vocabularyPath = path.join(repoRoot, vocabularyRel);
const assetKindPath = path.join(repoRoot, assetKindRel);
const outputPath = path.join(repoRoot, outputRel);
const checkOnly = process.argv.includes('--check');

function readYaml(absPath) {
  return YAML.parse(fs.readFileSync(absPath, 'utf8')) || {};
}

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeArray(value) {
  return Array.isArray(value)
    ? value.map(normalizeString).filter(Boolean)
    : [];
}

function unique(values, label) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) {
      throw new Error(`${label} contains duplicate token: ${value}`);
    }
    seen.add(key);
    output.push(value);
  }
  return output;
}

function dedupe(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      output.push(value);
    }
  }
  return output;
}

function quote(value) {
  return JSON.stringify(value);
}

function renderConstArray(name, values) {
  return [
    `export const ${name} = [`,
    ...values.map((value) => `  ${quote(value)},`),
    '] as const;',
    '',
  ].join('\n');
}

function renderTypeUnion(name, values) {
  if (values.length === 0) {
    return `export type ${name} = never;\n`;
  }
  return [
    `export type ${name} =`,
    ...values.map((value, index) => `  ${index === values.length - 1 ? '| ' : '| '}${quote(value)}${index === values.length - 1 ? ';' : ''}`),
    '',
  ].join('\n');
}

function renderObject(name, entries, keyName, valueName, keyType, valueType) {
  return [
    `export const ${name} = Object.freeze({`,
    ...entries.map((entry) => `  ${quote(entry[keyName])}: ${quote(entry[valueName])},`),
    `} satisfies Record<${keyType}, ${valueType}>);`,
    '',
  ].join('\n');
}

function renderMappings(name, mappings) {
  return [
    `export const ${name} = [`,
    ...mappings.map((entry) => (
      `  { token: ${quote(entry.token)}, source: ${quote(entry.source)}, assetKind: ${quote(entry.assetKind)} },`
    )),
    '] as const satisfies readonly RuntimeCapabilityAssetKindMapping[];',
    '',
  ].join('\n');
}

function buildProjection() {
  const vocabulary = readYaml(vocabularyPath);
  const assetKind = readYaml(assetKindPath);

  const canonicalTokens = unique(normalizeArray(vocabulary.canonical_tokens), 'canonical_tokens');
  const localManifestTokens = unique(normalizeArray(vocabulary.local_manifest_tokens), 'local_manifest_tokens');
  const canonicalSet = new Set(canonicalTokens.map((token) => token.toLowerCase()));
  const localManifestSet = new Set(localManifestTokens.map((token) => token.toLowerCase()));

  if (canonicalTokens.length === 0) {
    throw new Error(`${vocabularyRel} canonical_tokens must not be empty`);
  }
  if (localManifestTokens.length === 0) {
    throw new Error(`${vocabularyRel} local_manifest_tokens must not be empty`);
  }

  const localMappings = (Array.isArray(vocabulary.local_to_canonical) ? vocabulary.local_to_canonical : [])
    .map((entry, index) => {
      const localToken = normalizeString(entry?.local_token);
      const canonicalToken = normalizeString(entry?.canonical_token);
      if (!localManifestSet.has(localToken.toLowerCase())) {
        throw new Error(`${vocabularyRel} local_to_canonical[${index}] local_token is not admitted: ${localToken || '<empty>'}`);
      }
      if (!canonicalSet.has(canonicalToken.toLowerCase())) {
        throw new Error(`${vocabularyRel} local_to_canonical[${index}] canonical_token is not admitted: ${canonicalToken || '<empty>'}`);
      }
      return { localToken, canonicalToken };
    });
  if (localMappings.length === 0) {
    throw new Error(`${vocabularyRel} local_to_canonical must not be empty`);
  }

  const admittedAssetKinds = new Set([
    'chat',
    'embedding',
    'image',
    'video',
    'tts',
    'stt',
    'vae',
    'clip',
    'controlnet',
    'lora',
    'auxiliary',
  ]);
  const admittedSources = new Set(['canonical', 'local_manifest', 'offline_migration_input']);
  const assetMappings = (Array.isArray(assetKind.mappings) ? assetKind.mappings : [])
    .map((entry, index) => {
      const token = normalizeString(entry?.token);
      const source = normalizeString(entry?.source);
      const assetKindValue = normalizeString(entry?.asset_kind);
      if (!token) {
        throw new Error(`${assetKindRel} mappings[${index}] token must not be empty`);
      }
      if (!admittedSources.has(source)) {
        throw new Error(`${assetKindRel} mappings[${index}] source is not admitted: ${source || '<empty>'}`);
      }
      if (!admittedAssetKinds.has(assetKindValue)) {
        throw new Error(`${assetKindRel} mappings[${index}] asset_kind is not admitted: ${assetKindValue || '<empty>'}`);
      }
      if (
        source === 'canonical'
        && !canonicalSet.has(token.toLowerCase())
        && !localManifestSet.has(token.toLowerCase())
      ) {
        throw new Error(`${assetKindRel} canonical mapping token is absent from capability vocabulary: ${token}`);
      }
      if (source === 'local_manifest' && !localManifestSet.has(token.toLowerCase())) {
        throw new Error(`${assetKindRel} local_manifest mapping token is absent from capability vocabulary: ${token}`);
      }
      return { token, source, assetKind: assetKindValue };
    });
  if (assetMappings.length === 0) {
    throw new Error(`${assetKindRel} mappings must not be empty`);
  }

  const assetKindValues = dedupe(assetMappings.map((entry) => entry.assetKind));
  const sourceValues = dedupe(assetMappings.map((entry) => entry.source));

  return [
    '// Generated by scripts/generate-sdk-runtime-capability-vocabulary.mjs',
    `// Source: ${vocabularyRel}`,
    `// Source: ${assetKindRel}`,
    '// Do not edit by hand.',
    '',
    renderConstArray('RUNTIME_CANONICAL_CAPABILITY_TOKENS', canonicalTokens),
    'export type RuntimeCanonicalCapabilityToken = (typeof RUNTIME_CANONICAL_CAPABILITY_TOKENS)[number];',
    '',
    renderConstArray('RUNTIME_LOCAL_MANIFEST_CAPABILITY_TOKENS', localManifestTokens),
    'export type RuntimeLocalManifestCapabilityToken = (typeof RUNTIME_LOCAL_MANIFEST_CAPABILITY_TOKENS)[number];',
    '',
    renderTypeUnion('RuntimeCapabilityAssetKindId', assetKindValues),
    renderTypeUnion('RuntimeCapabilityAssetKindMappingSource', sourceValues),
    'export type RuntimeCapabilityAssetKindMapping = {',
    '  token: string;',
    '  source: RuntimeCapabilityAssetKindMappingSource;',
    '  assetKind: RuntimeCapabilityAssetKindId;',
    '};',
    '',
    renderObject(
      'RUNTIME_LOCAL_MANIFEST_TO_CANONICAL_CAPABILITY',
      localMappings,
      'localToken',
      'canonicalToken',
      'RuntimeLocalManifestCapabilityToken',
      'RuntimeCanonicalCapabilityToken',
    ),
    renderMappings('RUNTIME_CAPABILITY_TO_ASSET_KIND_MAPPINGS', assetMappings),
    'const RUNTIME_CANONICAL_CAPABILITY_TOKEN_SET = new Set<string>(',
    '  RUNTIME_CANONICAL_CAPABILITY_TOKENS,',
    ');',
    '',
    'const RUNTIME_LOCAL_MANIFEST_CAPABILITY_TOKEN_SET = new Set<string>(',
    '  RUNTIME_LOCAL_MANIFEST_CAPABILITY_TOKENS,',
    ');',
    '',
    'const RUNTIME_LOCAL_TO_CANONICAL_CAPABILITY = RUNTIME_LOCAL_MANIFEST_TO_CANONICAL_CAPABILITY as Record<string, RuntimeCanonicalCapabilityToken | undefined>;',
    '',
    'export function parseRuntimeCanonicalCapabilityToken(value: unknown): RuntimeCanonicalCapabilityToken | null {',
    "  const normalized = String(value || '').trim().toLowerCase();",
    '  return RUNTIME_CANONICAL_CAPABILITY_TOKEN_SET.has(normalized)',
    '    ? normalized as RuntimeCanonicalCapabilityToken',
    '    : null;',
    '}',
    '',
    'export function runtimeCanonicalCapabilityForLocalManifestToken(value: unknown): RuntimeCanonicalCapabilityToken | null {',
    "  const normalized = String(value || '').trim().toLowerCase();",
    '  if (!RUNTIME_LOCAL_MANIFEST_CAPABILITY_TOKEN_SET.has(normalized)) {',
    '    return null;',
    '  }',
    '  return RUNTIME_LOCAL_TO_CANONICAL_CAPABILITY[normalized] || null;',
    '}',
    '',
    'export function normalizeRuntimeCapabilityToken(value: unknown): RuntimeCanonicalCapabilityToken | null {',
    '  return parseRuntimeCanonicalCapabilityToken(value)',
    '    || runtimeCanonicalCapabilityForLocalManifestToken(value);',
    '}',
    '',
    'export function runtimeCapabilityTokenToAssetKind(value: unknown): RuntimeCapabilityAssetKindId | null {',
    "  const normalized = String(value || '').trim().toLowerCase();",
    '  return RUNTIME_CAPABILITY_TO_ASSET_KIND_MAPPINGS.find((entry) => entry.token === normalized)?.assetKind || null;',
    '}',
    '',
    'export function runtimeCanonicalCapabilityToAssetKind(value: unknown): RuntimeCapabilityAssetKindId | null {',
    '  const canonical = parseRuntimeCanonicalCapabilityToken(value);',
    '  return canonical ? runtimeCapabilityTokenToAssetKind(canonical) : null;',
    '}',
    '',
  ].join('\n');
}

function main() {
  const generated = buildProjection();
  const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
  if (checkOnly) {
    if (current !== generated) {
      console.error(`${outputRel} is stale; run node scripts/generate-sdk-runtime-capability-vocabulary.mjs`);
      process.exit(1);
    }
    console.log('sdk-runtime-capability-vocabulary: OK');
    return;
  }
  fs.writeFileSync(outputPath, generated);
  console.log(`generated ${outputRel}`);
}

main();
