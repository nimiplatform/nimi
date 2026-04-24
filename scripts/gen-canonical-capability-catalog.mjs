#!/usr/bin/env node
// Emits kit/core/src/runtime-capabilities/generated/canonical-capability-catalog.ts
// from .nimi/spec/platform/kernel/tables/canonical-capability-catalog.yaml.
// Deterministic, offline-safe, idempotent.

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { renderCanonicalCapabilityCatalogModule } from './lib/canonical-capability-catalog-codegen.mjs';

const cwd = process.cwd();
const catalogPath = path.join(cwd, '.nimi', 'spec', 'platform', 'kernel', 'tables', 'canonical-capability-catalog.yaml');
const outPath = path.join(cwd, 'kit', 'core', 'src', 'runtime-capabilities', 'generated', 'canonical-capability-catalog.ts');

const raw = fs.readFileSync(catalogPath, 'utf8');
const doc = YAML.parse(raw);
const rendered = renderCanonicalCapabilityCatalogModule(doc);

const outDir = path.dirname(outPath);
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}
fs.writeFileSync(outPath, rendered);

process.stdout.write(`wrote ${path.relative(cwd, outPath)}\n`);
