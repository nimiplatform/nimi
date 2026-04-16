#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const sourceDir = path.join(repoRoot, 'runtime', 'catalog', 'source', 'providers');
const snapshotDir = path.join(repoRoot, 'runtime', 'catalog', 'providers');

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set();
  const out = [];
  for (const item of value) {
    const normalized = normalizeString(item);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

async function main() {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  const sourceFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.source.yaml'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const failures = [];
  const now = new Date();

  for (const filename of sourceFiles) {
    const sourcePath = path.join(sourceDir, filename);
    const sourceDoc = YAML.parse(await fs.readFile(sourcePath, 'utf8')) || {};
    const provider = normalizeString(sourceDoc.provider || filename.replace(/\.source\.yaml$/u, ''));
    if (!provider) {
      continue;
    }

    const models = Array.isArray(sourceDoc.models) ? sourceDoc.models : [];
    const defaults = sourceDoc.defaults && typeof sourceDoc.defaults === 'object' ? sourceDoc.defaults : {};
    const defaultCapabilities = normalizeStringArray(defaults.capabilities).map((value) => value.toLowerCase());
    const modelIndex = new Map();
    for (const model of models) {
      const modelID = normalizeString(model?.model_id);
      if (!modelID) {
        continue;
      }
      const capabilities = normalizeStringArray(model?.capabilities).map((value) => value.toLowerCase());
      const effectiveCapabilities = capabilities.length > 0 ? capabilities : defaultCapabilities;
      modelIndex.set(modelID.toLowerCase(), effectiveCapabilities);
      for (const alias of normalizeStringArray(model?.aliases)) {
        modelIndex.set(alias.toLowerCase(), effectiveCapabilities);
      }
    }

    const selectionProfiles = Array.isArray(sourceDoc.selection_profiles) ? sourceDoc.selection_profiles : [];
    const sourceDefaultTextModel = normalizeString(defaults.default_text_model);
    const textGeneralProfiles = selectionProfiles.filter((profile) => normalizeString(profile?.profile_id).toLowerCase() === 'text.general');
    if (sourceDefaultTextModel && textGeneralProfiles.length === 0) {
      failures.push(`${provider}: defaults.default_text_model requires selection_profiles[text.general]`);
    }
    if (textGeneralProfiles.length > 1) {
      failures.push(`${provider}: selection_profiles[text.general] must be unique`);
    }

    const seenProfileIDs = new Set();
    for (const profile of selectionProfiles) {
      const profileID = normalizeString(profile?.profile_id);
      const capability = normalizeString(profile?.capability).toLowerCase();
      const modelID = normalizeString(profile?.model_id);
      const reviewedAt = normalizeString(profile?.reviewed_at);
      const freshnessSLADays = Number(profile?.freshness_sla_days);
      const dedupeKey = profileID.toLowerCase();
      if (!profileID || !capability || !modelID || !reviewedAt) {
        failures.push(`${provider}: selection_profiles entries must include profile_id/capability/model_id/reviewed_at`);
        continue;
      }
      if (seenProfileIDs.has(dedupeKey)) {
        failures.push(`${provider}: duplicate selection profile id ${profileID}`);
      }
      seenProfileIDs.add(dedupeKey);
      if (!Number.isInteger(freshnessSLADays) || freshnessSLADays <= 0) {
        failures.push(`${provider}: selection profile ${profileID} freshness_sla_days must be a positive integer`);
        continue;
      }
      const reviewedDate = new Date(reviewedAt);
      if (Number.isNaN(reviewedDate.getTime())) {
        failures.push(`${provider}: selection profile ${profileID} reviewed_at must be a valid ISO date`);
        continue;
      }
      const expiry = addDays(reviewedDate, freshnessSLADays);
      if (expiry.getTime() < now.getTime()) {
        failures.push(`${provider}: selection profile ${profileID} expired on ${expiry.toISOString().slice(0, 10)}`);
      }
      const capabilities = modelIndex.get(modelID.toLowerCase());
      if (!capabilities) {
        failures.push(`${provider}: selection profile ${profileID} references unknown model ${modelID}`);
        continue;
      }
      if (!capabilities.includes(capability)) {
        failures.push(`${provider}: selection profile ${profileID} references model ${modelID} without capability ${capability}`);
      }
    }

    if (textGeneralProfiles.length === 1) {
      const expectedDefault = normalizeString(textGeneralProfiles[0]?.model_id);
      const snapshotPath = path.join(snapshotDir, `${provider}.yaml`);
      const snapshotDoc = YAML.parse(await fs.readFile(snapshotPath, 'utf8')) || {};
      const actualDefault = normalizeString(snapshotDoc.default_text_model);
      if (expectedDefault && actualDefault.toLowerCase() !== expectedDefault.toLowerCase()) {
        failures.push(`${provider}: snapshot default_text_model ${actualDefault || '<empty>'} does not match selection_profiles[text.general]=${expectedDefault}`);
      }
    }
  }

  if (failures.length > 0) {
    process.stderr.write(`runtime selection freshness check failed:\n- ${failures.join('\n- ')}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write('runtime selection freshness check passed\n');
}

main().catch((error) => {
  process.stderr.write(`check-runtime-selection-freshness failed: ${String(error)}\n`);
  process.exitCode = 1;
});
