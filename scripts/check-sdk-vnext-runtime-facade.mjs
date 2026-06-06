#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const runtimeFacadePath = path.join(repoRoot, 'sdks', 'typescript', 'runtime', 'index.ts');
const runtimeMethodGroupsPath = path.join(
  repoRoot,
  '.nimi',
  'spec',
  'sdks',
  'kernel',
  'tables',
  'runtime-method-groups.yaml',
);

const GROUP_TO_FACADE_ARRAYS = [
  {
    groups: ['ai_service_projection'],
    arrays: ['RUNTIME_AI_METHODS'],
  },
  {
    groups: ['connector_service_projection'],
    arrays: ['RUNTIME_CONNECTOR_METHODS'],
  },
  {
    groups: ['ai_realtime_service_projection'],
    arrays: ['RUNTIME_REALTIME_METHODS'],
  },
  {
    groups: ['local_service_projection'],
    arrays: ['RUNTIME_LOCAL_METHODS'],
  },
  {
    groups: ['auth_service_projection'],
    arrays: ['RUNTIME_AUTH_METHODS'],
  },
  {
    groups: ['grant_service_projection'],
    arrays: ['RUNTIME_GRANT_METHODS'],
  },
  {
    groups: ['external_agent_service_projection'],
    arrays: ['RUNTIME_EXTERNAL_AGENT_METHODS'],
  },
  {
    groups: ['account_service_projection'],
    arrays: ['RUNTIME_ACCOUNT_METHODS'],
  },
  {
    groups: ['health_monitoring_projection', 'audit_service_projection'],
    arrays: ['RUNTIME_AUDIT_METHODS'],
  },
  {
    groups: ['knowledge_service_projection'],
    arrays: ['RUNTIME_KNOWLEDGE_METHODS'],
  },
  {
    groups: ['app_service_projection'],
    arrays: ['RUNTIME_APP_MESSAGE_METHODS'],
  },
  {
    groups: ['memory_service_projection'],
    arrays: ['RUNTIME_MEMORY_METHODS'],
  },
  {
    groups: ['agent_service_projection'],
    arrays: ['RUNTIME_AGENT_METHODS'],
  },
];

const DEFERRED_OR_LOW_LEVEL_ONLY_GROUPS = [
  'workflow_service_projection',
  'model_service_projection',
];

const SDKS_WAVE4_ADMITTED_ARRAYS = [
  {
    array: 'RUNTIME_SCHEDULING_METHODS',
    methods: ['peekScheduling'],
    authority: 'config/sdk-vnext-migration/typescript-ai-capability-ledger.yaml#runtime-ai-route-and-scheduling',
  },
];

const FORBIDDEN_HIGH_LEVEL_METHODS = [
  'executeLocalStateCutover',
  'resolveLocalStateReconciliation',
  'uploadArtifact',
];

function lowerCamel(value) {
  return `${value.slice(0, 1).toLowerCase()}${value.slice(1)}`;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function parseFacadeArrays(source) {
  const arrays = new Map();
  const pattern = /export const (RUNTIME_[A-Z_]+_METHODS) = \[([\s\S]*?)\] as const/g;
  for (const match of source.matchAll(pattern)) {
    arrays.set(match[1], [...match[2].matchAll(/'([^']+)'/g)].map((method) => method[1]));
  }
  return arrays;
}

function parseRuntimeMethodGroups(source) {
  const groups = new Map();
  for (const chunk of source.split(/\n(?=  - group: )/g)) {
    const group = chunk.match(/^\s*- group:\s*([^\n]+)/m)?.[1]?.trim();
    if (!group) continue;
    const status = chunk.match(/\n\s+status:\s*([^\n]+)/)?.[1]?.trim() ?? '';
    const methodsSection = chunk.match(/\n\s+methods:\n([\s\S]*?)(?=\n\s+(?:excluded|forbidden_service_bindings|source_rule|note):|\n\s+- group:|\n?$)/)?.[1] ?? '';
    const excludedSection = chunk.match(/\n\s+excluded:\n([\s\S]*?)(?=\n\s+(?:source_rule|note):|\n\s+- group:|\n?$)/)?.[1] ?? '';
    const methods = [...methodsSection.matchAll(/^\s+-\s+([A-Za-z0-9_]+)\s*$/gm)].map((method) => lowerCamel(method[1]));
    const excluded = [...excludedSection.matchAll(/^\s+-\s+name:\s+([A-Za-z0-9_]+)\s*$/gm)].map((method) => lowerCamel(method[1]));
    groups.set(group, { group, status, methods, excluded });
  }
  return groups;
}

function collectMethodsForGroups(groups, groupNames) {
  const methods = [];
  const excluded = [];
  const missing = [];
  for (const groupName of groupNames) {
    const group = groups.get(groupName);
    if (!group) {
      missing.push(groupName);
      continue;
    }
    if (group.status !== 'active') {
      throw new Error(`expected active runtime method group ${groupName}, got status=${group.status}`);
    }
    methods.push(...group.methods);
    excluded.push(...group.excluded);
  }
  return {
    missing,
    methods: uniqueSorted(methods),
    excluded: uniqueSorted(excluded),
  };
}

async function main() {
  const violations = [];
  const facadeSource = await fs.readFile(runtimeFacadePath, 'utf8');
  const methodGroupsSource = await fs.readFile(runtimeMethodGroupsPath, 'utf8');
  const facadeArrays = parseFacadeArrays(facadeSource);
  const methodGroups = parseRuntimeMethodGroups(methodGroupsSource);

  const allHighLevelMethods = [];

  for (const mapping of GROUP_TO_FACADE_ARRAYS) {
    const expected = collectMethodsForGroups(methodGroups, mapping.groups);
    if (expected.missing.length > 0) {
      violations.push(`runtime method groups missing from authority: ${expected.missing.join(', ')}`);
      continue;
    }

    const actual = uniqueSorted(mapping.arrays.flatMap((arrayName) => {
      const methods = facadeArrays.get(arrayName);
      if (!methods) {
        violations.push(`Runtime facade missing array ${arrayName}`);
        return [];
      }
      return methods;
    }));
    allHighLevelMethods.push(...actual);

    const missingMethods = expected.methods.filter((method) => !actual.includes(method));
    const extraMethods = actual.filter((method) => !expected.methods.includes(method));
    if (missingMethods.length > 0) {
      violations.push(`${mapping.arrays.join('+')} missing active Runtime methods: ${missingMethods.join(', ')}`);
    }
    if (extraMethods.length > 0) {
      violations.push(`${mapping.arrays.join('+')} exposes methods outside active Runtime groups: ${extraMethods.join(', ')}`);
    }
    const exposedExcluded = expected.excluded.filter((method) => actual.includes(method));
    if (exposedExcluded.length > 0) {
      violations.push(`${mapping.arrays.join('+')} exposes excluded Runtime methods: ${exposedExcluded.join(', ')}`);
    }
  }

  for (const groupName of DEFERRED_OR_LOW_LEVEL_ONLY_GROUPS) {
    const group = methodGroups.get(groupName);
    if (!group) {
      violations.push(`deferred Runtime method group missing from authority: ${groupName}`);
      continue;
    }
    if (group.status !== 'deferred') {
      violations.push(`expected deferred Runtime method group ${groupName}, got status=${group.status}`);
    }
    const leaked = group.methods.filter((method) => allHighLevelMethods.includes(method));
    if (leaked.length > 0) {
      violations.push(`Runtime facade exposes deferred group ${groupName}: ${leaked.join(', ')}`);
    }
  }

  for (const mapping of SDKS_WAVE4_ADMITTED_ARRAYS) {
    const actual = uniqueSorted(facadeArrays.get(mapping.array) ?? []);
    allHighLevelMethods.push(...actual);
    const missingMethods = mapping.methods.filter((method) => !actual.includes(method));
    const extraMethods = actual.filter((method) => !mapping.methods.includes(method));
    if (missingMethods.length > 0) {
      violations.push(`${mapping.array} missing AI capability admitted Runtime methods from ${mapping.authority}: ${missingMethods.join(', ')}`);
    }
    if (extraMethods.length > 0) {
      violations.push(`${mapping.array} exposes methods outside ${mapping.authority}: ${extraMethods.join(', ')}`);
    }
  }

  for (const method of FORBIDDEN_HIGH_LEVEL_METHODS) {
    if (allHighLevelMethods.includes(method)) {
      violations.push(`Runtime facade exposes forbidden high-level method: ${method}`);
    }
  }

  if (facadeSource.includes('generate(input') || facadeSource.includes('stream(input')) {
    violations.push('Runtime facade must not add high-level generate()/stream() convenience');
  }

  if (violations.length > 0) {
    process.stderr.write('SDK vNext Runtime facade check failed:\n');
    for (const violation of violations) {
      process.stderr.write(`- ${violation}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`SDK vNext Runtime facade check passed (${uniqueSorted(allHighLevelMethods).length} high-level method(s))\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`check-sdk-vnext-runtime-facade failed: ${message}\n`);
  process.exitCode = 1;
});
