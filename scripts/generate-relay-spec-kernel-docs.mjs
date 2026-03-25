#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readYamlWithFragments } from './lib/read-yaml-with-fragments.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const tablesDir = path.join(repoRoot, 'apps', 'relay', 'spec', 'kernel', 'tables');
const outDir = path.join(repoRoot, 'apps', 'relay', 'spec', 'kernel', 'generated');
const relayRoot = path.join(repoRoot, 'apps', 'relay');

const specs = [
  {
    input: 'bootstrap-phases.yaml',
    output: 'bootstrap-phases.md',
    render: renderBootstrapPhases,
  },
  {
    input: 'feature-capabilities.yaml',
    output: 'feature-capabilities.md',
    render: renderFeatureCapabilities,
  },
  {
    input: 'ipc-channels.yaml',
    output: 'ipc-channels.md',
    render: renderIpcChannels,
  },
  {
    input: 'rule-evidence.yaml',
    output: 'rule-evidence.md',
    render: renderRuleEvidence,
  },
];

function normalizeMarkdown(markdown) {
  return `${markdown.replace(/\n{3,}/gu, '\n\n').replace(/\n+$/u, '\n')}`;
}

function header(title, sourceName) {
  return normalizeMarkdown([
    `# ${title}`,
    '',
    `> Auto-generated from \`tables/${sourceName}\` — do not edit manually`,
    '',
  ].join('\n'));
}

function yesNo(value) {
  return value ? 'yes' : 'no';
}

function formatRule(value) {
  return String(value || '').trim() || '—';
}

function formatSdkModule(value) {
  const normalized = String(value || '').trim();
  return normalized ? `\`${normalized}\`` : '— (renderer)';
}

function formatNote(value) {
  return String(value || '').trim() || '';
}

function trimRelayPrefix(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return '—';
  const fullPath = path.join(repoRoot, normalized);
  if (fullPath.startsWith(relayRoot)) {
    return `\`${path.relative(relayRoot, fullPath).replace(/\\/gu, '/')}\``;
  }
  return `\`${normalized}\``;
}

function renderBootstrapPhases(doc, sourceName) {
  const phases = Array.isArray(doc?.phases) ? doc.phases : [];
  let out = header('Relay Bootstrap Phases', sourceName);
  out += '| Order | Phase | Process | Description | Blocking | Timeout | Rule |\n';
  out += '|-------|-------|---------|-------------|----------|---------|------|\n';
  for (const item of phases) {
    const id = String(item?.id || '').trim();
    if (!id) continue;
    const order = Number(item?.order);
    const process = String(item?.process || '').trim() || '—';
    const description = String(item?.description || '').trim() || '—';
    const blocking = yesNo(Boolean(item?.blocking));
    const timeout = Number.isFinite(Number(item?.timeout_ms))
      ? `${Math.round(Number(item.timeout_ms))}ms`
      : '—';
    out += `| ${Number.isFinite(order) ? order : '—'} | ${id} | ${process} | ${description} | ${blocking} | ${timeout} | ${formatRule(item?.source_rule)} |\n`;
  }
  return normalizeMarkdown(out);
}

function renderFeatureCapabilities(doc, sourceName) {
  const features = Array.isArray(doc?.features) ? doc.features : [];
  let out = header('Relay Feature Capabilities', sourceName);
  out += '| Feature | Display Name | Runtime | Realm | Agent | Socket | Async | SDK Module | Rule | Notes |\n';
  out += '|---------|-------------|---------|-------|-------|--------|-------|------------|------|-------|\n';
  for (const item of features) {
    const id = String(item?.id || '').trim();
    if (!id) continue;
    const displayName = String(item?.display_name || '').trim() || id;
    const runtime = yesNo(Boolean(item?.requires_runtime));
    const realm = yesNo(Boolean(item?.requires_realm));
    const agent = item?.requires_agent === false ? '**no**' : yesNo(Boolean(item?.requires_agent));
    const socket = yesNo(Boolean(item?.requires_socket));
    const asyncJob = yesNo(Boolean(item?.async_job));
    out += `| ${id} | ${displayName} | ${runtime} | ${realm} | ${agent} | ${socket} | ${asyncJob} | ${formatSdkModule(item?.sdk_module)} | ${formatRule(item?.source_rule)} | ${formatNote(item?.note)} |\n`;
  }
  return normalizeMarkdown(out);
}

function renderIpcChannels(doc, sourceName) {
  const channels = Array.isArray(doc?.channels) ? doc.channels : [];
  let out = header('Relay IPC Channels', sourceName);
  out += '| Channel | Type | Module | SDK Method | Rule |\n';
  out += '|---------|------|--------|------------|------|\n';
  for (const item of channels) {
    const channel = String(item?.channel || '').trim();
    if (!channel) continue;
    const type = String(item?.type || '').trim() || '—';
    const direction = String(item?.direction || '').trim();
    const module = String(item?.module || '').trim() || (type === 'event' ? 'stream' : '—');
    const sdkMethod = String(item?.sdk_method || '').trim();
    const renderedType =
      type === 'event' && direction === 'main-to-renderer'
        ? 'event (main→renderer)'
        : type || '—';
    out += `| \`${channel}\` | ${renderedType} | ${module} | ${sdkMethod ? `\`${sdkMethod}\`` : '—'} | ${formatRule(item?.source_rule)} |\n`;
  }
  return normalizeMarkdown(out);
}

function renderRuleEvidence(doc, sourceName) {
  const rules = Array.isArray(doc?.rules) ? doc.rules : [];
  let out = header('Relay Rule Evidence', sourceName);
  out += '| Rule | Contract | Status | Evidence Path | Test | Notes |\n';
  out += '|------|----------|--------|--------------|------|-------|\n';
  for (const item of rules) {
    const id = String(item?.id || '').trim();
    if (!id) continue;
    const contract = path.basename(String(item?.contract || '').trim() || '—');
    const status = String(item?.status || '').trim() || '—';
    const evidencePath = trimRelayPrefix(item?.evidence_path);
    const testPath = trimRelayPrefix(item?.test);
    const note = formatNote(item?.note);
    out += `| ${id} | ${contract} | ${status} | ${evidencePath} | ${testPath} | ${note} |\n`;
  }
  return normalizeMarkdown(out);
}

async function main() {
  const checkMode = process.argv.includes('--check');
  await fs.mkdir(outDir, { recursive: true });

  const renderedEntries = specs.map((spec) => {
    const inputPath = path.join(tablesDir, spec.input);
    const outputPath = path.join(outDir, spec.output);
    const parsed = readYamlWithFragments(inputPath);
    return {
      ...spec,
      outputPath,
      rendered: spec.render(parsed, spec.input),
    };
  });

  if (checkMode) {
    const drifted = [];
    for (const entry of renderedEntries) {
      let current = '';
      try {
        current = await fs.readFile(entry.outputPath, 'utf8');
      } catch {
        drifted.push(entry.outputPath);
        continue;
      }
      if (current !== entry.rendered) {
        drifted.push(entry.outputPath);
      }
    }
    if (drifted.length > 0) {
      process.stderr.write('relay kernel generated docs drift detected:\n');
      for (const filePath of drifted) {
        process.stderr.write(`  - ${path.relative(repoRoot, filePath)}\n`);
      }
      process.stderr.write('run `pnpm generate:relay-spec-kernel-docs` to regenerate.\n');
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`relay kernel generated docs are up-to-date (${renderedEntries.length} files)\n`);
    return;
  }

  for (const entry of renderedEntries) {
    await fs.writeFile(entry.outputPath, entry.rendered, 'utf8');
  }
  process.stdout.write(`generated relay kernel docs (${renderedEntries.length} files)\n`);
}

main().catch((error) => {
  process.stderr.write(`generate-relay-spec-kernel-docs failed: ${String(error)}\n`);
  process.exitCode = 1;
});
