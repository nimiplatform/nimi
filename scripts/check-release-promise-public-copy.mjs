#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import YAML from 'yaml';

const FREEZE_PATH = 'config/platform-release-promise-freeze.yaml';

const PUBLIC_COPY_FILES = Object.freeze([
  'README.md',
  'RELEASE.md',
  'app-tools/README.md',
  'apps/tester/README.md',
  'docs/platform/agents/chat-and-life-tracks.md',
  'docs/platform/agents/hook-intent.md',
  'docs/platform/agents/participation-authority.md',
  'docs/runtime/agent-execution.md',
  'docs/runtime/delegated-capability.md',
  'docs/runtime/mcp-integration.md',
  'docs/sdk/agent-participation-client.md',
  'sdks/README.md',
]);

const REQUIRED_SNIPPETS = Object.freeze([
  {
    id: 'readme-positioning-statement',
    file: 'README.md',
    fromFreeze: 'positioning.statement',
  },
  {
    id: 'readme-product-release-channel-boundary',
    file: 'README.md',
    text: 'Their stable public product release channels remain release-gated and are not opened by the source checkout itself.',
  },
  {
    id: 'readme-source-checkout-quickstart-boundary',
    file: 'README.md',
    text: 'These commands are for a source checkout or locally built runtime binary.',
  },
  {
    id: 'app-tools-non-admission-boundary',
    file: 'app-tools/README.md',
    text: 'The CLI does not create public admission truth, permission grants, registry visibility, release descriptors, or installed-app update truth.',
  },
  {
    id: 'sdk-adapter-public-package-boundary',
    file: 'sdks/README.md',
    text: 'Adapter packages stay source-local/private until owner-approved public package names and compatibility promises are accepted.',
  },
]);

const CLAIM_RULES = Object.freeze([
  {
    id: 'runtime-openai-compatible-rest-endpoint',
    pattern: /(?:\/v1\/(?:chat\/completions|responses|embeddings|audio|images|models)\b|stable\s+OpenAI-compatible\s+Runtime\s+REST\s+endpoint|Runtime\s+REST\s+OpenAI-compatible)/i,
    allow: /\b(?:unsupported|not\s+expose|does\s+not\s+expose|not\s+a\s+public|fail(?:s|ed)?\s+closed|forbidden|adapter\s+migration\s+bridge\s+only)\b/i,
    message: 'Runtime OpenAI-compatible REST is unsupported; public copy may only mention it as an unsupported/non-public boundary.',
  },
  {
    id: 'general-reminders-appointments-scheduler',
    pattern: /\b(?:general\s+reminders?|reminders?|appointments?|app-authored\s+scheduling|app\s+scheduler|broad\s+automation|proactive\s+(?:scheduler|autonomy)|tomorrow\s+reminder|kind\s*=\s*remind)\b/i,
    allow: /\b(?:unsupported|outside|not\s+promised|not\s+admitted|deferred|fail(?:s|ed)?\s+closed|forbidden|anti-target|not\s+general|narrow\s+follow-up-turn)\b/i,
    message: 'General reminders, appointments, broad automation, and app scheduling are outside the first release promise.',
  },
  {
    id: 'participation-sdk-overclaim',
    pattern: /\b(?:participation\s+SDK|agent\s+participation\s+client.*(?:admitted|build-out|public|production|exposes)|external_a2a_participation|SDK\s+exposes\s+typed\s+calls|public\s+production\s+participation\s+SDK)\b/i,
    allow: /\b(?:deferred|no\s+public\s+production|not\s+a\s+public\s+production|not\s+promised|proto-unavailable|semantic-contract-only|not\s+admitted|outside|anti-target|contract\s+only)\b/i,
    message: 'Runtime Agent Participation SDK is deferred and must not be described as a public production SDK surface.',
  },
  {
    id: 'a2a-raw-mcp-overclaim',
    pattern: /\b(?:A2A\s+production|raw\s+MCP\s+ontology|MCP\s+resources|MCP\s+external\s+execution|production\s+MCP|MCP\s+adapter\s+ships|running\s+shipped\s+surface|stdio\s+transport\s+running)\b/i,
    allow: /\b(?:unsupported|outside|not\s+promised|does\s+not\s+promise|does\s+not\s+allow|not\s+admitted|deferred|partial|contract\s+evidence|fail(?:s|ed)?\s+closed|forbidden|not\s+production|not\s+shipped|not\s+a\s+current)\b/i,
    message: 'A2A production, raw MCP ontology promotion, MCP resources, and MCP external execution are not first release promises.',
  },
  {
    id: 'app-owned-canonical-memory',
    pattern: /\b(?:app(?:s)?\s+(?:own|owns|owned)\s+canonical\s+memory|SDK\s+owns\s+canonical\s+memory|Kit\s+owns\s+canonical\s+memory|app-private\s+canonical-write)\b/i,
    allow: /\b(?:must\s+not|never|not\s+own|does\s+not\s+own|fail(?:s|ed)?\s+closed|forbidden)\b/i,
    message: 'Canonical memory truth remains Runtime/Cognition owned, not app/SDK/Kit owned.',
  },
  {
    id: 'app-tools-admission-overclaim',
    pattern: /\b(?:creates?|generates?|grants?|publishes?)\b.*\b(?:public\s+admission\s+truth|permission\s+grants?|registry\s+visibility|release\s+descriptors?|installed-app\s+update\s+truth)\b/i,
    allow: /\b(?:does\s+not|do\s+not|does\s+not\s+open|must\s+not|not\s+create|not\s+listing|not\s+.*truth|forbidden)\b/i,
    message: 'App tooling must not claim to create admission, grant, registry, descriptor, or installed-app update truth.',
  },
  {
    id: 'mod-catalog-release-overclaim',
    pattern: /\b(?:mods?\s+catalog|official\s+mod\s+package|release-mod-package|extension\s+apps?|mod\s+capabilities)\b/i,
    allow: /\b(?:future|not\s+promised|not\s+release-promised|outside|retired|forbidden|source\s+checkout\s+only|not\s+an\s+extension)\b/i,
    message: 'Mods/extensions/catalog release surfaces are not in the first public release promise.',
  },
  {
    id: 'non-target-adapter-public-overclaim',
    pattern: /\b(?:LangGraph|LlamaIndex|React|Next)\b.*\b(?:stable|supported|public\s+package|release\s+promise|first-batch)\b/i,
    allow: /\b(?:not|deferred|outside|source-root|not\s+first-batch|not\s+root\s+stable|private|fail(?:s|ed)?\s+closed)\b/i,
    message: 'Non-target source-root adapters are deferred and must not be described as stable first-batch public packages.',
  },
]);

export function checkReleasePromisePublicCopy(rootDir = process.cwd()) {
  const errors = [];
  const freezePath = path.join(rootDir, FREEZE_PATH);
  let freeze;
  try {
    freeze = YAML.parse(fs.readFileSync(freezePath, 'utf8'));
  } catch (error) {
    return [`failed to read ${FREEZE_PATH}: ${String(error?.message ?? error)}`];
  }

  const fileTexts = new Map();
  for (const relPath of PUBLIC_COPY_FILES) {
    const absPath = path.join(rootDir, relPath);
    try {
      fileTexts.set(relPath, fs.readFileSync(absPath, 'utf8'));
    } catch (error) {
      errors.push(`failed to read public copy file ${relPath}: ${String(error?.message ?? error)}`);
    }
  }
  if (errors.length > 0) return errors;

  for (const requirement of REQUIRED_SNIPPETS) {
    const text = fileTexts.get(requirement.file) ?? '';
    const requiredText = requirement.fromFreeze === 'positioning.statement'
      ? String(freeze?.positioning?.statement ?? '')
      : requirement.text;
    if (!requiredText) {
      errors.push(`${requirement.id}: freeze source did not resolve a required snippet`);
      continue;
    }
    if (!containsSnippet(text, requiredText)) {
      errors.push(`${requirement.id}: ${requirement.file} must contain "${requiredText}"`);
    }
  }

  for (const [relPath, text] of fileTexts.entries()) {
    const lines = text.split(/\r?\n/u);
    for (const [index, line] of lines.entries()) {
      for (const rule of CLAIM_RULES) {
        if (!rule.pattern.test(line)) continue;
        const context = [lines[index - 1] ?? '', line, lines[index + 1] ?? ''].join(' ');
        if (rule.allow.test(context)) continue;
        errors.push(`${relPath}:${index + 1}: ${rule.id}: ${rule.message}`);
      }
    }
  }

  return errors;
}

function containsSnippet(text, snippet) {
  return normalizeWhitespace(text).includes(normalizeWhitespace(snippet));
}

function normalizeWhitespace(text) {
  return String(text).replace(/\s+/gu, ' ').trim();
}

function main() {
  const errors = checkReleasePromisePublicCopy(process.cwd());
  if (errors.length > 0) {
    process.stderr.write(`release-promise public copy check: FAIL (${errors.length} error(s))\n`);
    for (const error of errors) {
      process.stderr.write(`  - ${error}\n`);
    }
    process.exit(1);
  }
  process.stdout.write(`release-promise public copy check: OK (${PUBLIC_COPY_FILES.length} file(s))\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}

export const releasePromisePublicCopyTestInternals = {
  CLAIM_RULES,
  FREEZE_PATH,
  PUBLIC_COPY_FILES,
  REQUIRED_SNIPPETS,
  tmpRootPrefix: path.join(os.tmpdir(), 'nimi-release-promise-copy-'),
};
