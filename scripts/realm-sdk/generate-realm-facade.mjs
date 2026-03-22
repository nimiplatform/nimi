import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { REALM_FACADE_RELATIVE_PATH, REALM_GENERATED_RELATIVE_PATH } from './constants.mjs';
import { classifyModelExport } from './model-utils.mjs';

export function writeRealmFacade(repoRoot) {
  const generatedModelsDir = path.join(repoRoot, REALM_GENERATED_RELATIVE_PATH, 'models');
  if (!existsSync(generatedModelsDir) || !statSync(generatedModelsDir).isDirectory()) {
    throw new Error(`generated models directory not found: ${generatedModelsDir}`);
  }

  const modelFiles = readdirSync(generatedModelsDir)
    .filter((entry) => entry.endsWith('.ts'))
    .sort((left, right) => left.localeCompare(right));

  const lines = [];
  lines.push('/* eslint-disable */');
  lines.push('// AUTO-GENERATED FACADE from realm/generated/* and selected typed adapters. DO NOT EDIT BY HAND.');
  lines.push('');

  for (const fileName of modelFiles) {
    const symbol = fileName.replace(/\.ts$/, '');
    const source = readFileSync(path.join(generatedModelsDir, fileName), 'utf8');
    const exportKind = classifyModelExport(source);
    if (exportKind !== 'value') {
      continue;
    }
    lines.push(`export { ${symbol} } from './generated/models/${symbol}.js';`);
  }

  lines.push('');
  lines.push('// Generated type helpers.');
  lines.push("export type { RealmModels, RealmModelName, RealmModel, RealmOperations, RealmOperationName, RealmOperation, RealmServiceName, RealmServiceMethod, RealmServiceArgs, RealmServiceResult } from './generated/type-helpers.js';");
  lines.push('');
  lines.push('// Typed adapter exports.');
  lines.push("export type { AccountDataTaskStatus, RequestDataExportInput, RequestDataExportOutput, RequestAccountDeletionInput, RequestAccountDeletionOutput } from './extensions/account-data.js';");
  lines.push("export { requestDataExport, requestAccountDeletion } from './extensions/account-data.js';");
  lines.push("export type { AgentMemoryCommitInput, AgentMemoryCommitOutput, AgentMemoryListInput, AgentMemoryRecord, AgentMemorySliceInput } from './extensions/agent-memory.js';");
  lines.push("export { commitAgentMemories, listAgentCoreMemories, listAgentDyadicMemories } from './extensions/agent-memory.js';");
  lines.push('');
  lines.push('// Realm client exports.');
  lines.push("export { Realm } from './client.js';");
  lines.push("export type { RealmConnectionState, RealmTelemetryEvent, RealmTokenRefreshResult, RealmFetchImpl, RealmAuthOptions, RealmRetryOptions, RealmOptions, RealmUnsafeRawModule, RealmServiceRegistry, RealmEventsModule } from './client-types.js';");
  lines.push("export type { RealmOperationKey, RealmOperationResult, RealmOperationResultMap } from './generated/operation-map.js';");
  lines.push("export * from './generated/property-enums.js';");
  lines.push('');

  writeFileSync(path.join(repoRoot, REALM_FACADE_RELATIVE_PATH), lines.join('\n'), 'utf8');
}
