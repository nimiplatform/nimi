#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const runtimeProtoDir = path.join(repoRoot, 'proto', 'runtime', 'v1');
const realmOperationMapPath = path.join(
  repoRoot,
  'sdk',
  'src',
  'realm',
  'generated',
  'operation-map.ts',
);
const outputPath = path.join(repoRoot, 'sdk', 'src', 'scope', 'generated', 'catalog.ts');

const READ_PREFIXES = ['get', 'list', 'search', 'check', 'validate', 'subscribe'];
const RUNTIME_SCOPE_DOMAIN_OVERRIDES = {
  RuntimeGrantService: 'app_auth',
};
const COGNITION_SCOPE_FAMILIES = {
  memory: {
    admin: new Set(['create_bank', 'delete_bank']),
    read: new Set(['get_bank', 'list_banks', 'recall', 'history', 'subscribe_memory_events']),
    write: new Set(['retain', 'delete_memory']),
  },
  knowledge: {
    admin: new Set(['create_knowledge_bank', 'delete_knowledge_bank']),
    read: new Set([
      'get_knowledge_bank',
      'list_knowledge_banks',
      'get_page',
      'list_pages',
      'search_keyword',
      'search_hybrid',
      'list_links',
      'list_backlinks',
      'traverse_graph',
      'get_ingest_task',
    ]),
    write: new Set(['put_page', 'delete_page', 'add_link', 'remove_link', 'ingest_document']),
  },
};

function toSnakeCase(value) {
  return String(value || '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function deriveRealmDomain(serviceName) {
  const withoutServiceSuffix = serviceName.replace(/Service$/, '');
  const withoutVersionTail = withoutServiceSuffix.replace(/V\d+.*/, '');
  const normalized = withoutVersionTail.length > 0 ? withoutVersionTail : withoutServiceSuffix;
  return toSnakeCase(normalized);
}

function countBraceDelta(line) {
  const source = String(line || '').split('//')[0] || '';
  const opened = (source.match(/\{/g) || []).length;
  const closed = (source.match(/}/g) || []).length;
  return opened - closed;
}

function addCognitionScopeFamilies(scopes, method) {
  for (const [domain, families] of Object.entries(COGNITION_SCOPE_FAMILIES)) {
    for (const [level, methods] of Object.entries(families)) {
      if (methods.has(method)) {
        scopes.add(`runtime.${domain}.${level}`);
        return true;
      }
    }
  }
  return false;
}

async function collectRuntimeScopes() {
  const scopes = new Set();

  const entries = await fs.readdir(runtimeProtoDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.proto')) {
      continue;
    }
    const source = await fs.readFile(path.join(runtimeProtoDir, entry.name), 'utf8');
    const lines = source.split('\n');
    let currentService = '';
    let currentServiceDepth = 0;
    for (const line of lines) {
      const serviceMatch = /^\s*service\s+([A-Za-z][A-Za-z0-9_]*)\s*\{/.exec(line);
      if (serviceMatch) {
        currentService = serviceMatch[1] || '';
        currentServiceDepth = countBraceDelta(line);
        if (currentServiceDepth <= 0) {
          currentService = '';
          currentServiceDepth = 0;
        }
        continue;
      }
      if (!currentService) {
        continue;
      }
      const rpcMatch = /^\s*rpc\s+([A-Za-z][A-Za-z0-9_]*)\s*\(/.exec(line);
      if (rpcMatch) {
        const method = toSnakeCase(rpcMatch[1] || '');
        if (currentService === 'RuntimeCognitionService') {
          addCognitionScopeFamilies(scopes, method);
          continue;
        }
        const service = deriveRuntimeDomain(currentService);
        if (!service || !method) {
          continue;
        }
        scopes.add(`runtime.${service}.${method}`);
        if (READ_PREFIXES.some((prefix) => method.startsWith(prefix))) {
          scopes.add(`runtime.${service}.read`);
        }
        if (service === 'app' && method.startsWith('send')) {
          scopes.add('runtime.app.message');
        }
      }

      currentServiceDepth += countBraceDelta(line);
      if (currentServiceDepth <= 0) {
        currentService = '';
        currentServiceDepth = 0;
      }
    }
  }

  return Array.from(scopes).sort();
}

function deriveRuntimeDomain(serviceName) {
  const override = RUNTIME_SCOPE_DOMAIN_OVERRIDES[serviceName];
  if (override) {
    return override;
  }
  if (!serviceName.startsWith('Runtime') || !serviceName.endsWith('Service')) {
    return '';
  }
  const core = serviceName.slice('Runtime'.length, -'Service'.length);
  return toSnakeCase(core);
}

async function collectRealmScopes() {
  const scopes = new Set();
  const source = await fs.readFile(realmOperationMapPath, 'utf8');
  const serviceNames = new Set(
    Array.from(source.matchAll(/"service"\s*:\s*"([A-Za-z0-9_]+Service)"/g)).map(
      (match) => String(match[1] || '').trim(),
    ).filter(Boolean),
  );

  for (const serviceName of serviceNames) {
    const domain = deriveRealmDomain(serviceName);
    if (!domain) {
      continue;
    }
    scopes.add(`realm.${domain}.read`);
  }

  return Array.from(scopes).sort();
}

function renderCatalog(realmScopes, runtimeScopes) {
  const renderScopeItems = (items) => items
    .map((scope) => `  '${scope}' as ScopeName,`)
    .join('\n');

  return `/* eslint-disable */\n// AUTO-GENERATED by scripts/generate-scope-catalog.mjs. DO NOT EDIT.\n\nimport type { ScopeName } from '../../types/index.js';\n\nexport const GENERATED_REALM_SCOPES: readonly ScopeName[] = Object.freeze([\n${renderScopeItems(realmScopes)}\n]);\n\nexport const GENERATED_RUNTIME_SCOPES: readonly ScopeName[] = Object.freeze([\n${renderScopeItems(runtimeScopes)}\n]);\n`;
}

async function main() {
  const checkMode = process.argv.includes('--check');
  const [realmScopes, runtimeScopes] = await Promise.all([
    collectRealmScopes(),
    collectRuntimeScopes(),
  ]);

  const rendered = renderCatalog(realmScopes, runtimeScopes);
  if (checkMode) {
    let current = '';
    try {
      current = await fs.readFile(outputPath, 'utf8');
    } catch {
      process.stderr.write(
        `scope catalog file missing: ${outputPath}\n` +
        'run `pnpm generate:scope-catalog` to regenerate.\n',
      );
      process.exitCode = 1;
      return;
    }
    if (current !== rendered) {
      process.stderr.write(
        `scope catalog drift detected: ${outputPath}\n` +
        'run `pnpm generate:scope-catalog` to regenerate.\n',
      );
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`up-to-date scope catalog: realm=${realmScopes.length} runtime=${runtimeScopes.length}\n`);
    return;
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, rendered, 'utf8');

  process.stdout.write(`generated scope catalog: realm=${realmScopes.length} runtime=${runtimeScopes.length}\n`);
}

main().catch((error) => {
  process.stderr.write(`generate-scope-catalog failed: ${String(error)}\n`);
  process.exitCode = 1;
});
