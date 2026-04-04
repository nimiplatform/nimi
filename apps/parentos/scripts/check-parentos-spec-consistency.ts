/**
 * check-parentos-spec-consistency.ts
 * Validates routes.yaml ↔ routes.tsx/shell-layout.tsx consistency
 * and local-storage.yaml ↔ migrations.rs column alignment.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

let errors = 0;

function fail(msg: string) {
  console.error(`  FAIL: ${msg}`);
  errors++;
}

function pass(msg: string) {
  console.log(`  PASS: ${msg}`);
}

// ── Routes ──────────────────────────────────────────────────

console.log('\n=== Route Consistency ===\n');

const routesYaml = parseYaml(
  readFileSync(resolve(ROOT, 'spec/kernel/tables/routes.yaml'), 'utf-8'),
) as { routes: Array<{ path: string; gated?: boolean; phase?: number; icon?: string; displayName?: string }> };

const routesTsx = readFileSync(
  resolve(ROOT, 'src/shell/renderer/app-shell/routes.tsx'),
  'utf-8',
);

const shellLayout = readFileSync(
  resolve(ROOT, 'src/shell/renderer/app-shell/shell-layout.tsx'),
  'utf-8',
);

for (const route of routesYaml.routes) {
  const isGated = route.gated === true;
  const pathInRouter = routesTsx.includes(`path="${route.path}"`);

  if (isGated && pathInRouter) {
    fail(`Gated route ${route.path} (phase ${route.phase}) is registered in router — must be removed`);
  } else if (!isGated && !pathInRouter) {
    fail(`Route ${route.path} defined in routes.yaml but missing from routes.tsx`);
  } else if (isGated && !pathInRouter) {
    pass(`Gated route ${route.path} correctly excluded from router`);
  } else {
    pass(`Route ${route.path} registered in router`);
  }

  // Nav check: only routes with icon should appear in nav (top-level non-gated)
  if (route.icon && !isGated) {
    const navHasPath = shellLayout.includes(`to: '${route.path}'`);
    if (!navHasPath) {
      fail(`Nav-level route ${route.path} (${route.displayName}) missing from shell-layout.tsx navItems`);
    } else {
      pass(`Nav item for ${route.path} present`);
    }
  }
  if (isGated && route.icon) {
    const navHasPath = shellLayout.includes(`to: '${route.path}'`);
    if (navHasPath) {
      fail(`Gated route ${route.path} should NOT appear in navigation`);
    }
  }
}

// ── Local Storage ↔ Migrations ──────────────────────────────

console.log('\n=== Local Storage ↔ Migrations ===\n');

const storageYaml = parseYaml(
  readFileSync(resolve(ROOT, 'spec/kernel/tables/local-storage.yaml'), 'utf-8'),
) as { tables: Array<{ name: string; columns: Array<{ name: string }> }> };

const migrationsRs = readFileSync(
  resolve(ROOT, 'src-tauri/src/sqlite/migrations.rs'),
  'utf-8',
);

for (const table of storageYaml.tables) {
  // Extract column names from the CREATE TABLE block in migrations.rs
  const tableRegex = new RegExp(`CREATE TABLE IF NOT EXISTS ${table.name}\\s*\\(([^;]+?)\\);`, 's');
  const match = migrationsRs.match(tableRegex);

  if (!match) {
    fail(`Table '${table.name}' not found in migrations.rs`);
    continue;
  }

  const ddl = match[1];
  for (const col of table.columns) {
    // Column name should appear in DDL (case-sensitive, camelCase)
    if (!ddl.includes(col.name)) {
      fail(`Column '${table.name}.${col.name}' missing from migrations.rs`);
    }
  }
  pass(`Table '${table.name}' columns aligned (${table.columns.length} columns)`);
}

// ── Result ──────────────────────────────────────────────────

console.log(`\n${errors === 0 ? 'All checks passed.' : `${errors} error(s) found.`}\n`);
process.exit(errors > 0 ? 1 : 0);
