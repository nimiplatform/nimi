#!/usr/bin/env node
// Emits kit/core/src/runtime-capabilities/generated/canonical-capability-catalog.ts
// from config/platform-canonical-capability-catalog.yaml.
// Deterministic, offline-safe, idempotent.

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { renderCanonicalCapabilityCatalogArtifacts } from './lib/canonical-capability-catalog-codegen.mjs';

const cwd = process.cwd();
const catalogPath = path.join(cwd, 'config', 'platform-canonical-capability-catalog.yaml');

const raw = fs.readFileSync(catalogPath, 'utf8');
const doc = YAML.parse(raw);
for (const artifact of renderCanonicalCapabilityCatalogArtifacts(doc)) {
  const outPath = path.join(cwd, artifact.path);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, artifact.content);
  process.stdout.write(`wrote ${artifact.path}\n`);
}
