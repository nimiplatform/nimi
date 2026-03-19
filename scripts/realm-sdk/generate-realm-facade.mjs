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
  lines.push('// AUTO-GENERATED FACADE from realm/generated/models/*.ts. DO NOT EDIT BY HAND.');
  lines.push('');

  for (const fileName of modelFiles) {
    const symbol = fileName.replace(/\.ts$/, '');
    const source = readFileSync(path.join(generatedModelsDir, fileName), 'utf8');
    const exportKind = classifyModelExport(source);
    if (exportKind === 'value') {
      lines.push(`export { ${symbol} } from './generated/models/${symbol}.js';`);
      continue;
    }
    if (exportKind === 'type') {
      lines.push(`export type { ${symbol} } from './generated/models/${symbol}.js';`);
      continue;
    }
    lines.push(`export type { ${symbol} } from './generated/models/${symbol}.js';`);
  }

  lines.push('');
  lines.push('// Account data extension exports.');
  lines.push("export type { AccountDataTaskStatus, RequestDataExportInput, RequestDataExportOutput, RequestAccountDeletionInput, RequestAccountDeletionOutput } from './extensions/account-data.js';");
  lines.push("export { requestDataExport, requestAccountDeletion } from './extensions/account-data.js';");
  lines.push('');
  lines.push('// Explicit service type exports for public naming checks.');
  lines.push("export type { MeTwoFactorService, SocialDefaultVisibilityService } from './client-types.js';");
  lines.push('');
  lines.push('// vNext realm client exports.');
  lines.push("export { Realm } from './client.js';");
  lines.push("export type * from './client-types.js';");
  lines.push("export * from './generated/property-enums.js';");
  lines.push('');

  writeFileSync(path.join(repoRoot, REALM_FACADE_RELATIVE_PATH), lines.join('\n'), 'utf8');
}
