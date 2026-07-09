import fs from 'node:fs';
import path from 'node:path';
import { readYamlResource } from './yaml-resource.mjs';

function normalizeProviderName(value) {
  return String(value || '').trim().toLowerCase();
}

function isLegacySourceFile(name) {
  return /\.source\.ya?ml$/iu.test(name);
}

function providerEntryName(entry) {
  if (entry.isDirectory()) {
    return entry.name;
  }
  return entry.name.replace(/\.source\.ya?ml$/iu, '');
}

export function listProviderSourceEntries(sourceDir) {
  return fs.readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || (entry.isFile() && isLegacySourceFile(entry.name)))
    .map((entry) => {
      const provider = normalizeProviderName(providerEntryName(entry));
      return {
        provider,
        legacy: entry.isFile(),
        absPath: path.join(sourceDir, entry.name),
      };
    })
    .filter((entry) => entry.provider)
    .sort((left, right) => left.provider.localeCompare(right.provider));
}

export function loadProviderSourceDoc(absPath) {
  const doc = readYamlResource(absPath);
  const provider = normalizeProviderName(doc?.provider || path.basename(absPath).replace(/\.source\.ya?ml$/iu, ''));
  return {
    provider,
    doc,
  };
}

export function listProviderSourceDocs(sourceDir) {
  const seen = new Map();
  return listProviderSourceEntries(sourceDir).map((entry) => {
    const loaded = loadProviderSourceDoc(entry.absPath);
    const provider = normalizeProviderName(loaded.provider || entry.provider);
    if (!provider) {
      throw new Error(`provider source entry is missing provider id: ${entry.absPath}`);
    }
    const existing = seen.get(provider);
    if (existing) {
      throw new Error(`duplicate provider source ${provider}: ${existing} and ${entry.absPath}`);
    }
    seen.set(provider, entry.absPath);
    return {
      ...entry,
      provider,
      doc: loaded.doc,
      relPath: path.relative(sourceDir, entry.absPath).replaceAll(path.sep, '/'),
    };
  });
}

export function assertNoLegacyProviderSourceFiles(sourceDir) {
  const legacyFiles = listProviderSourceEntries(sourceDir).filter((entry) => entry.legacy);
  if (legacyFiles.length > 0) {
    const rendered = legacyFiles.map((entry) => path.relative(sourceDir, entry.absPath)).join(', ');
    throw new Error(`legacy provider source files are forbidden; move to provider directories: ${rendered}`);
  }
}
