import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { REALM_GENERATED_RELATIVE_PATH } from './constants.mjs';
import { renderGeneratedIndexFile } from './render-generated-index-file.mjs';
import { renderOperationMapFile } from './render-operation-map-file.mjs';
import { renderServiceRegistryFile } from './render-service-registry-file.mjs';

export function writeOperationArtifacts(repoRoot, operations) {
  const generatedDir = path.join(repoRoot, REALM_GENERATED_RELATIVE_PATH);
  const operationMapFile = renderOperationMapFile(operations);
  const serviceRegistryFile = renderServiceRegistryFile();
  const generatedIndex = renderGeneratedIndexFile();

  writeFileSync(path.join(generatedDir, 'operation-map.ts'), operationMapFile, 'utf8');
  writeFileSync(path.join(generatedDir, 'service-registry.ts'), serviceRegistryFile, 'utf8');
  writeFileSync(path.join(generatedDir, 'index.ts'), generatedIndex, 'utf8');
}
