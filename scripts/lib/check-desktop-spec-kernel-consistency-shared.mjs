import fs from 'node:fs';
import path from 'node:path';
import { readYamlWithFragments } from './read-yaml-with-fragments.mjs';

export const cwd = process.cwd();
export const desktopRoot = path.join(cwd, 'spec/desktop');
export const sourceRoot = path.join(cwd, 'apps/desktop/src');

export const kernelFiles = [
  'spec/desktop/kernel/index.md',
  'spec/desktop/kernel/bootstrap-contract.md',
  'spec/desktop/kernel/bridge-ipc-contract.md',
  'spec/desktop/kernel/self-update-contract.md',
  'spec/desktop/kernel/state-contract.md',
  'spec/desktop/kernel/auth-session-contract.md',
  'spec/desktop/kernel/data-sync-contract.md',
  'spec/desktop/kernel/hook-capability-contract.md',
  'spec/desktop/kernel/mod-governance-contract.md',
  'spec/desktop/kernel/llm-adapter-contract.md',
  'spec/desktop/kernel/menu-bar-shell-contract.md',
  'spec/desktop/kernel/ui-shell-contract.md',
  'spec/desktop/kernel/error-boundary-contract.md',
  'spec/desktop/kernel/telemetry-contract.md',
  'spec/desktop/kernel/network-contract.md',
  'spec/desktop/kernel/security-contract.md',
  'spec/desktop/kernel/streaming-consumption-contract.md',
  'spec/desktop/kernel/codegen-contract.md',
  'spec/desktop/kernel/offline-degradation-contract.md',
  'spec/desktop/kernel/testing-gates-contract.md',
  'spec/desktop/kernel/tables/bootstrap-phases.yaml',
  'spec/desktop/kernel/tables/ipc-commands.yaml',
  'spec/desktop/kernel/tables/app-tabs.yaml',
  'spec/desktop/kernel/tables/store-slices.yaml',
  'spec/desktop/kernel/tables/hook-subsystems.yaml',
  'spec/desktop/kernel/tables/hook-capability-allowlists.yaml',
  'spec/desktop/kernel/tables/ui-slots.yaml',
  'spec/desktop/kernel/tables/turn-hook-points.yaml',
  'spec/desktop/kernel/tables/mod-kernel-stages.yaml',
  'spec/desktop/kernel/tables/mod-lifecycle-states.yaml',
  'spec/desktop/kernel/tables/mod-access-modes.yaml',
  'spec/desktop/kernel/tables/feature-flags.yaml',
  'spec/desktop/kernel/tables/data-sync-flows.yaml',
  'spec/desktop/kernel/tables/retry-status-codes.yaml',
  'spec/desktop/kernel/tables/error-codes.yaml',
  'spec/desktop/kernel/tables/log-areas.yaml',
  'spec/desktop/kernel/tables/build-chunks.yaml',
  'spec/desktop/kernel/tables/renderer-design-tokens.yaml',
  'spec/desktop/kernel/tables/renderer-design-surfaces.yaml',
  'spec/desktop/kernel/tables/renderer-design-sidebars.yaml',
  'spec/desktop/kernel/tables/renderer-design-overlays.yaml',
  'spec/desktop/kernel/tables/renderer-design-allowlists.yaml',
  'spec/desktop/kernel/tables/desktop-testing-gates.yaml',
  'spec/desktop/kernel/tables/desktop-feature-coverage.yaml',
  'spec/desktop/kernel/tables/rule-evidence.yaml',
  'spec/desktop/kernel/tables/codegen-import-allowlist.yaml',
  'spec/desktop/kernel/tables/codegen-capability-tiers.yaml',
  'spec/desktop/kernel/tables/codegen-static-scan-deny-patterns.yaml',
  'spec/desktop/kernel/tables/codegen-acceptance-gates.yaml',
];

export function read(rel) {
  return fs.readFileSync(path.join(cwd, rel), 'utf8');
}

export function readYaml(rel) {
  return readYamlWithFragments(path.join(cwd, rel));
}

export function fileExists(rel) {
  return fs.existsSync(path.join(cwd, rel));
}

function listDomainMarkdownFiles(domainDirRel) {
  const domainDir = path.join(cwd, domainDirRel);
  if (!fs.existsSync(domainDir)) return [];
  return fs.readdirSync(domainDir)
    .filter((name) => name.endsWith('.md'))
    .filter((name) => name !== 'index.md')
    .map((name) => path.posix.join(domainDirRel, name))
    .sort((a, b) => a.localeCompare(b));
}

export const domainFiles = listDomainMarkdownFiles('spec/desktop');

export function checkNoLocalRuleIds(content, rel, fail) {
  const localRuleIdPattern = /\b(?<![KSDPRF]-)(?:[A-Z]{2,12}-){1,2}\d{3}[a-z]?\b/g;
  const allowed = new Set(['HTTP-401', 'HTTP-403', 'HTTP-404', 'HTTP-429', 'HTTP-500', 'HTTP-501']);
  for (const match of content.matchAll(localRuleIdPattern)) {
    const token = match[0];
    if (allowed.has(token)) continue;
    fail(`${rel} must not define local rule ID token: ${token}`);
  }
}

export function checkNoRuleDefinitionHeadings(content, rel, fail) {
  const bannedHeadingPattern = /^##\s+.*(?:领域不变量|验收门(?:禁)?|变更规则|变更策略|Domain Invariants|Acceptance Gate|Acceptance Gates|Change Rules|Change Policy)\b/gmu;
  let match;
  while ((match = bannedHeadingPattern.exec(content)) !== null) {
    fail(`${rel} contains rule-definition style heading not allowed for thin domain docs: ${match[0]}`);
  }
}

export function walkSync(dir, extensions) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') {
        continue;
      }
      results.push(...walkSync(fullPath, extensions));
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}
