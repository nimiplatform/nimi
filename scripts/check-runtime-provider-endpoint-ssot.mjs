#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const sourceDir = path.join(repoRoot, 'runtime', 'catalog', 'source', 'providers');
const providerCatalogPath = path.join(repoRoot, '.nimi', 'spec', 'runtime', 'kernel', 'tables', 'provider-catalog.yaml');
const providerCapabilitiesPath = path.join(repoRoot, '.nimi', 'spec', 'runtime', 'kernel', 'tables', 'provider-capabilities.yaml');
const registryPath = path.join(repoRoot, 'runtime', 'internal', 'providerregistry', 'generated.go');
const providerCatalogRuntimePath = path.join(repoRoot, 'runtime', 'internal', 'services', 'connector', 'provider_catalog.go');
const registryGeneratorPath = path.join(repoRoot, 'scripts', 'generate-runtime-provider-registry.mjs');

let failed = false;

function fail(message) {
  failed = true;
  console.error(`ERROR: ${message}`);
}

function readText(absPath) {
  return fs.readFileSync(absPath, 'utf8');
}

function readYaml(absPath) {
  return YAML.parse(readText(absPath)) || {};
}

function normalizeProvider(value) {
  return String(value || '').trim().toLowerCase();
}

function parseRegistryRecords(absPath) {
  const source = readText(absPath);
  const records = new Map();
  const recordRegex = /"([^"]+)":\s*\{([\s\S]*?)\n\t\},/g;
  let match;
  while ((match = recordRegex.exec(source)) !== null) {
    const provider = normalizeProvider(match[1]);
    const body = match[2];
    const parseString = (field) => {
      const fieldMatch = body.match(new RegExp(`${field}:\\s*"([^"]*)",`));
      return String(fieldMatch?.[1] || '').trim();
    };
    const parseBool = (field) => {
      const fieldMatch = body.match(new RegExp(`${field}:\\s*(true|false),`));
      return fieldMatch?.[1] === 'true';
    };
    records.set(provider, {
      runtimePlane: parseString('RuntimePlane'),
      managedConnectorSupported: parseBool('ManagedConnectorSupported'),
      inlineSupported: parseBool('InlineSupported'),
      defaultEndpoint: parseString('DefaultEndpoint'),
      requiresExplicitEndpoint: parseBool('RequiresExplicitEndpoint'),
    });
  }
  return records;
}

function endpointRequirement(runtimePlane, requiresExplicitEndpoint) {
  if (runtimePlane === 'local') {
    return 'empty_string_only';
  }
  return requiresExplicitEndpoint ? 'explicit_required' : 'default_or_explicit';
}

function main() {
  const providerCatalog = readYaml(providerCatalogPath);
  const providerCapabilities = readYaml(providerCapabilitiesPath);
  const registryRecords = parseRegistryRecords(registryPath);
  const catalogEntries = new Map(
    (Array.isArray(providerCatalog?.providers) ? providerCatalog.providers : [])
      .map((entry) => [normalizeProvider(entry?.provider), entry]),
  );
  const capabilityEntries = new Map(
    (Array.isArray(providerCapabilities?.providers) ? providerCapabilities.providers : [])
      .map((entry) => [normalizeProvider(entry?.provider), entry]),
  );

  for (const name of fs.readdirSync(sourceDir).filter((entry) => entry.endsWith('.source.yaml')).sort()) {
    const absPath = path.join(sourceDir, name);
    const relPath = path.relative(repoRoot, absPath);
    const doc = readYaml(absPath);
    const provider = normalizeProvider(doc?.provider || name.replace(/\.source\.yaml$/u, ''));
    const runtime = doc?.runtime && typeof doc.runtime === 'object' ? doc.runtime : null;
    if (!runtime) {
      fail(`${relPath} must include runtime metadata block`);
      continue;
    }
    const runtimePlane = String(runtime?.runtime_plane || '').trim();
    const managed = Boolean(runtime?.managed_connector_supported);
    const inline = Boolean(runtime?.inline_supported);
    const defaultEndpoint = String(runtime?.default_endpoint || '').trim();
    const requiresExplicitEndpoint = Boolean(runtime?.requires_explicit_endpoint);

    const registry = registryRecords.get(provider);
    if (!registry) {
      fail(`${relPath} provider ${provider} missing providerregistry record`);
      continue;
    }
    if (registry.runtimePlane !== runtimePlane) {
      fail(`${relPath} provider ${provider} runtime_plane mismatch with providerregistry`);
    }
    if (registry.managedConnectorSupported !== managed) {
      fail(`${relPath} provider ${provider} managed_connector_supported mismatch with providerregistry`);
    }
    if (registry.inlineSupported !== inline) {
      fail(`${relPath} provider ${provider} inline_supported mismatch with providerregistry`);
    }
    if (registry.defaultEndpoint !== defaultEndpoint) {
      fail(`${relPath} provider ${provider} default_endpoint mismatch with providerregistry`);
    }
    if (registry.requiresExplicitEndpoint !== requiresExplicitEndpoint) {
      fail(`${relPath} provider ${provider} requires_explicit_endpoint mismatch with providerregistry`);
    }

    const capability = capabilityEntries.get(provider);
    if (!capability) {
      fail(`${relPath} provider ${provider} missing provider-capabilities entry`);
      continue;
    }
    if (String(capability?.runtime_plane || '').trim() !== runtimePlane) {
      fail(`${relPath} provider ${provider} runtime_plane mismatch with provider-capabilities`);
    }
    if (Boolean(capability?.managed_connector_supported) !== managed) {
      fail(`${relPath} provider ${provider} managed_connector_supported mismatch with provider-capabilities`);
    }
    if (Boolean(capability?.inline_supported) !== inline) {
      fail(`${relPath} provider ${provider} inline_supported mismatch with provider-capabilities`);
    }
    if (String(capability?.endpoint_requirement || '').trim() !== endpointRequirement(runtimePlane, requiresExplicitEndpoint)) {
      fail(`${relPath} provider ${provider} endpoint_requirement mismatch with provider-capabilities`);
    }

    const catalog = catalogEntries.get(provider);
    if (runtimePlane === 'local') {
      if (catalog) {
        fail(`${relPath} local provider must not appear in provider-catalog.yaml`);
      }
    } else {
      if (!catalog) {
        fail(`${relPath} remote provider ${provider} missing provider-catalog entry`);
      } else {
        if (String(catalog?.default_endpoint || '').trim() !== defaultEndpoint) {
          fail(`${relPath} provider ${provider} default_endpoint mismatch with provider-catalog`);
        }
        if (Boolean(catalog?.requires_explicit_endpoint) !== requiresExplicitEndpoint) {
          fail(`${relPath} provider ${provider} requires_explicit_endpoint mismatch with provider-catalog`);
        }
      }
    }
  }

  const providerCatalogRuntime = readText(providerCatalogRuntimePath);
  if (!providerCatalogRuntime.includes('providerregistry.Lookup')) {
    fail(`${path.relative(repoRoot, providerCatalogRuntimePath)} must build catalog entries from providerregistry`);
  }
  if (!providerCatalogRuntime.includes('record.DefaultEndpoint')) {
    fail(`${path.relative(repoRoot, providerCatalogRuntimePath)} must read default endpoint from providerregistry`);
  }

  const registryGenerator = readText(registryGeneratorPath);
  if (registryGenerator.includes('loadSpecProviderCatalog(') || registryGenerator.includes('specProviderCatalogPath')) {
    fail(`${path.relative(repoRoot, registryGeneratorPath)} must not load provider endpoints from spec tables`);
  }

  if (failed) {
    process.exit(1);
  }

  console.log('runtime-provider-endpoint-ssot: OK');
}

main();
