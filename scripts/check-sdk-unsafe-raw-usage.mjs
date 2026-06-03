import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const nimiRoot = path.resolve(scriptDir, '..');
const sdkSrcRoot = path.join(nimiRoot, 'sdk', 'src');

const allowedFiles = new Set([
  path.join(sdkSrcRoot, 'realm', 'client.ts'),
  path.join(sdkSrcRoot, 'runtime', 'runtime.ts'),
  path.join(sdkSrcRoot, 'runtime', 'runtime-method-contracts.assertions.ts'),
]);

const rawUsagePattern = /\.(?:raw|unsafeRaw)\.(request|call)(<[^>(]+>)?\(/g;
const violations = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (!fullPath.endsWith('.ts') && !fullPath.endsWith('.tsx')) {
      continue;
    }
    const source = readFileSync(fullPath, 'utf8');
    if (!rawUsagePattern.test(source)) {
      continue;
    }
    rawUsagePattern.lastIndex = 0;
    if (!allowedFiles.has(fullPath)) {
      violations.push(fullPath);
    }
  }
}

walk(sdkSrcRoot);

if (violations.length > 0) {
  console.error('[check-sdk-unsafe-raw-usage] Found unexpected raw/unsafeRaw usage outside the approved escape-hatch set:');
  for (const violation of violations) {
    console.error(`- ${path.relative(nimiRoot, violation)}`);
  }
  process.exit(1);
}

console.log(`[check-sdk-unsafe-raw-usage] Passed. Approved raw usage files: ${allowedFiles.size}.`);
