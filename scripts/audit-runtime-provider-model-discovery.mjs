#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const sourceDir = path.join(repoRoot, 'runtime', 'catalog', 'source', 'providers');
const defaultConfigPath = path.join(repoRoot, 'config', 'ai', 'runtime-provider-model-discovery.yaml');

const builtinAdapters = {
  openai_compat_models: {
    endpoint: {
      base_url_source: 'runtime_default_endpoint',
      path: '/models',
    },
    auth: {
      kind: 'bearer_provider_api_key',
    },
    response: {
      items_path: 'data',
      id_field: 'id',
    },
  },
  anthropic_models_v1: {
    endpoint: {
      absolute_url: 'https://api.anthropic.com/v1/models',
    },
    auth: {
      kind: 'header_provider_api_key',
      header_name: 'x-api-key',
    },
    request: {
      headers: {
        'anthropic-version': '2023-06-01',
      },
    },
    response: {
      items_path: 'data',
      id_field: 'id',
    },
  },
  google_generative_models_v1beta: {
    endpoint: {
      absolute_url: 'https://generativelanguage.googleapis.com/v1beta/models',
    },
    auth: {
      kind: 'query_provider_api_key',
      query_name: 'key',
    },
    response: {
      items_path: 'models',
      id_field: 'name',
    },
    normalize: {
      strip_prefixes: ['models/'],
    },
  },
  cohere_models_v1: {
    endpoint: {
      absolute_url: 'https://api.cohere.com/v1/models',
      query: {
        page_size: '1000',
      },
    },
    auth: {
      kind: 'bearer_provider_api_key',
    },
    response: {
      items_path: 'models',
      id_field: 'name',
    },
    pagination: {
      request_query_param: 'page_token',
      response_token_path: 'next_page_token',
      max_pages: 20,
    },
  },
  together_models_v1: {
    endpoint: {
      absolute_url: 'https://api.together.xyz/v1/models',
    },
    auth: {
      kind: 'bearer_provider_api_key',
    },
    response: {
      items_path: '',
      id_field: 'id',
    },
  },
  fireworks_models_v1: {
    endpoint: {
      absolute_url: 'https://api.fireworks.ai/v1/accounts/fireworks/models',
    },
    auth: {
      kind: 'bearer_provider_api_key',
    },
    response: {
      items_path: 'models',
      id_field: 'name',
    },
  },
  elevenlabs_models_v1: {
    endpoint: {
      absolute_url: 'https://api.elevenlabs.io/v1/models',
    },
    auth: {
      kind: 'header_provider_api_key',
      header_name: 'xi-api-key',
    },
    response: {
      items_path: '',
      id_field: 'model_id',
    },
  },
};

function parseArgs(argv) {
  const args = {
    configPath: defaultConfigPath,
    providerFilter: [],
    json: false,
    validateConfigOnly: false,
    strict: false,
    failOnDrift: false,
    writeReport: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || '').trim();
    if (!arg) {
      continue;
    }
    if (arg === '--json') {
      args.json = true;
      continue;
    }
    if (arg === '--validate-config') {
      args.validateConfigOnly = true;
      continue;
    }
    if (arg === '--strict') {
      args.strict = true;
      continue;
    }
    if (arg === '--fail-on-drift') {
      args.failOnDrift = true;
      continue;
    }
    if (arg === '--config') {
      index += 1;
      args.configPath = path.resolve(repoRoot, String(argv[index] || '').trim());
      continue;
    }
    if (arg === '--provider') {
      index += 1;
      args.providerFilter = String(argv[index] || '')
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
      continue;
    }
    if (arg === '--write-report') {
      index += 1;
      args.writeReport = path.resolve(repoRoot, String(argv[index] || '').trim());
      continue;
    }
    throw new Error(`unsupported argument: ${arg}`);
  }
  return args;
}

function readYaml(absPath) {
  return YAML.parse(fs.readFileSync(absPath, 'utf8')) || {};
}

function normalizeProviderID(value) {
  return String(value || '').trim().toLowerCase();
}

function providerEnvToken(providerID) {
  return normalizeProviderID(providerID)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function providerAPIKeyEnv(providerID) {
  const token = providerEnvToken(providerID);
  return token ? `NIMI_RUNTIME_CLOUD_${token}_API_KEY` : '';
}

function providerBaseURLEnv(providerID) {
  const token = providerEnvToken(providerID);
  return token ? `NIMI_RUNTIME_CLOUD_${token}_BASE_URL` : '';
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set();
  const out = [];
  for (const item of value) {
    const normalized = String(item || '').trim();
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

function getByPath(value, dottedPath) {
  const normalizedPath = String(dottedPath || '').trim();
  if (!normalizedPath) {
    return value;
  }
  return normalizedPath.split('.').reduce((current, segment) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    return current[segment];
  }, value);
}

function mergeConfig(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) {
    return structuredClone(base);
  }
  const out = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && out[key] && typeof out[key] === 'object' && !Array.isArray(out[key])) {
      out[key] = mergeConfig(out[key], value);
    } else {
      out[key] = structuredClone(value);
    }
  }
  return out;
}

function loadSourceProviders() {
  const entries = fs.readdirSync(sourceDir)
    .filter((entry) => entry.endsWith('.source.yaml'))
    .sort((left, right) => left.localeCompare(right));
  return entries.map((entry) => {
    const absPath = path.join(sourceDir, entry);
    const doc = readYaml(absPath);
    return {
      file: entry,
      path: absPath,
      provider: normalizeProviderID(doc.provider || entry.replace(/\.source\.yaml$/u, '')),
      document: doc,
    };
  });
}

function sourceModelSets(sourceDoc) {
  const models = Array.isArray(sourceDoc?.models) ? sourceDoc.models : [];
  const primary = normalizeStringArray(models.map((model) => model?.model_id));
  const aliases = [];
  for (const model of models) {
    aliases.push(...normalizeStringArray(model?.aliases));
  }
  const known = normalizeStringArray([...primary, ...aliases]);
  const selectionProfiles = Array.isArray(sourceDoc?.selection_profiles) ? sourceDoc.selection_profiles : [];
  const selectionModels = normalizeStringArray(selectionProfiles.map((item) => item?.model_id));
  return { primary, aliases, known, selectionModels };
}

function buildResolvedProviderConfig(providerID, sourceDoc, rootConfig) {
  const providerConfig = rootConfig?.providers?.[providerID];
  if (!providerConfig) {
    return null;
  }
  const adapterName = String(providerConfig.adapter || '').trim();
  const adapter = builtinAdapters[adapterName];
  if (!adapter) {
    throw new Error(`provider ${providerID} uses unknown discovery adapter ${adapterName || '<empty>'}`);
  }
  const resolved = mergeConfig(adapter, providerConfig);
  resolved.adapter = adapterName;
  resolved.provider = providerID;
  resolved.timeoutMs = Number(rootConfig?.defaults?.timeout_ms || 15000);
  if (!Number.isFinite(resolved.timeoutMs) || resolved.timeoutMs <= 0) {
    resolved.timeoutMs = 15000;
  }
  resolved.runtime = sourceDoc?.runtime && typeof sourceDoc.runtime === 'object' ? sourceDoc.runtime : {};
  return resolved;
}

function buildEndpointURL(providerID, resolvedConfig) {
  const endpoint = resolvedConfig.endpoint && typeof resolvedConfig.endpoint === 'object' ? resolvedConfig.endpoint : {};
  let baseURL = String(endpoint.absolute_url || '').trim();
  if (!baseURL) {
    const baseURLSource = String(endpoint.base_url_source || '').trim();
    if (baseURLSource === 'runtime_default_endpoint') {
      baseURL = String(resolvedConfig.runtime?.default_endpoint || '').trim();
    }
  }
  if (!baseURL) {
    const envKey = providerBaseURLEnv(providerID);
    if (envKey) {
      baseURL = String(process.env[envKey] || '').trim();
    }
  }
  if (!baseURL) {
    throw new Error(`provider ${providerID} has no discovery base URL`);
  }
  const requestURL = new URL(baseURL);
  const pathSuffix = String(endpoint.path || '').trim();
  if (pathSuffix) {
    requestURL.pathname = `${requestURL.pathname.replace(/\/+$/u, '')}/${pathSuffix.replace(/^\/+/u, '')}`;
  }
  const staticQuery = endpoint.query && typeof endpoint.query === 'object' ? endpoint.query : {};
  for (const [key, value] of Object.entries(staticQuery)) {
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue) {
      continue;
    }
    requestURL.searchParams.set(key, normalizedValue);
  }
  return requestURL;
}

function applyAuth(providerID, resolvedConfig, requestURL, headers) {
  const auth = resolvedConfig.auth && typeof resolvedConfig.auth === 'object' ? resolvedConfig.auth : {};
  const kind = String(auth.kind || 'none').trim();
  if (kind === 'none') {
    return { skipped: false };
  }
  const envKey = String(auth.env || '').trim() || providerAPIKeyEnv(providerID);
  const credential = String(process.env[envKey] || '').trim();
  if (!credential) {
    if (kind === 'optional_bearer_provider_api_key') {
      return { skipped: false };
    }
    return { skipped: true, reason: `missing credential env ${envKey}` };
  }
  if (kind === 'bearer_provider_api_key' || kind === 'optional_bearer_provider_api_key') {
    headers.set('authorization', `Bearer ${credential}`);
    return { skipped: false };
  }
  if (kind === 'header_provider_api_key') {
    const headerName = String(auth.header_name || '').trim();
    if (!headerName) {
      throw new Error(`provider ${providerID} header_provider_api_key requires auth.header_name`);
    }
    headers.set(headerName, credential);
    return { skipped: false };
  }
  if (kind === 'query_provider_api_key') {
    const queryName = String(auth.query_name || '').trim();
    if (!queryName) {
      throw new Error(`provider ${providerID} query_provider_api_key requires auth.query_name`);
    }
    requestURL.searchParams.set(queryName, credential);
    return { skipped: false };
  }
  throw new Error(`provider ${providerID} uses unsupported auth kind ${kind}`);
}

function normalizeDiscoveredIDs(rawIDs, resolvedConfig) {
  const normalizeConfig = resolvedConfig.normalize && typeof resolvedConfig.normalize === 'object' ? resolvedConfig.normalize : {};
  const stripPrefixes = normalizeStringArray(normalizeConfig.strip_prefixes);
  const includePatterns = normalizeStringArray(normalizeConfig.include_patterns).map((pattern) => new RegExp(pattern, 'u'));
  const excludePatterns = normalizeStringArray(normalizeConfig.exclude_patterns).map((pattern) => new RegExp(pattern, 'u'));
  const out = [];
  const seen = new Set();
  for (const raw of rawIDs) {
    let modelID = String(raw || '').trim();
    if (!modelID) {
      continue;
    }
    for (const prefix of stripPrefixes) {
      if (modelID.startsWith(prefix)) {
        modelID = modelID.slice(prefix.length);
      }
    }
    if (!modelID) {
      continue;
    }
    if (includePatterns.length > 0 && !includePatterns.some((pattern) => pattern.test(modelID))) {
      continue;
    }
    if (excludePatterns.some((pattern) => pattern.test(modelID))) {
      continue;
    }
    const key = modelID.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(modelID);
  }
  return out.sort((left, right) => left.localeCompare(right));
}

function normalizeComparableScalar(value) {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  return '';
}

function responseItemPassesFilters(item, responseConfig) {
  const filters = Array.isArray(responseConfig?.item_filters) ? responseConfig.item_filters : [];
  for (const filter of filters) {
    if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
      continue;
    }
    const fieldPath = String(filter.field || '').trim();
    if (!fieldPath) {
      continue;
    }
    const value = getByPath(item, fieldPath);
    if (filter.truthy === true && !value) {
      return false;
    }
    if (filter.falsy === true && value) {
      return false;
    }
    if (Object.prototype.hasOwnProperty.call(filter, 'equals')) {
      if (normalizeComparableScalar(value).toLowerCase() !== normalizeComparableScalar(filter.equals).toLowerCase()) {
        return false;
      }
    }
    if (Object.prototype.hasOwnProperty.call(filter, 'not_equals')) {
      if (normalizeComparableScalar(value).toLowerCase() === normalizeComparableScalar(filter.not_equals).toLowerCase()) {
        return false;
      }
    }
    if (Object.prototype.hasOwnProperty.call(filter, 'matches')) {
      const pattern = new RegExp(String(filter.matches || ''), 'u');
      if (!pattern.test(normalizeComparableScalar(value))) {
        return false;
      }
    }
    if (Object.prototype.hasOwnProperty.call(filter, 'not_matches')) {
      const pattern = new RegExp(String(filter.not_matches || ''), 'u');
      if (pattern.test(normalizeComparableScalar(value))) {
        return false;
      }
    }
    if (Array.isArray(filter.in)) {
      const allowed = new Set(normalizeStringArray(filter.in).map((entry) => entry.toLowerCase()));
      if (!allowed.has(normalizeComparableScalar(value).toLowerCase())) {
        return false;
      }
    }
    if (Array.isArray(filter.not_in)) {
      const disallowed = new Set(normalizeStringArray(filter.not_in).map((entry) => entry.toLowerCase()));
      if (disallowed.has(normalizeComparableScalar(value).toLowerCase())) {
        return false;
      }
    }
  }
  return true;
}

function resolvePaginationConfig(resolvedConfig) {
  const pagination = resolvedConfig.pagination && typeof resolvedConfig.pagination === 'object' ? resolvedConfig.pagination : {};
  const requestQueryParam = String(pagination.request_query_param || '').trim();
  const responseTokenPath = String(pagination.response_token_path || '').trim();
  const enabled = Boolean(requestQueryParam && responseTokenPath);
  const maxPages = Number(pagination.max_pages || 20);
  return {
    enabled,
    requestQueryParam,
    responseTokenPath,
    maxPages: Number.isFinite(maxPages) && maxPages > 0 ? Math.floor(maxPages) : 20,
  };
}

function resolveRequestVariants(resolvedConfig) {
  const variants = Array.isArray(resolvedConfig.request_variants) ? resolvedConfig.request_variants : [];
  if (variants.length === 0) {
    return [{
      label: '',
      config: resolvedConfig,
    }];
  }
  return variants.map((variant, index) => {
    const merged = mergeConfig(resolvedConfig, variant);
    delete merged.request_variants;
    return {
      label: String(variant?.label || `variant_${index + 1}`).trim(),
      config: merged,
    };
  });
}

async function fetchProviderDiscoveryVariant(providerID, resolvedConfig, variantLabel) {
  const baseRequestURL = buildEndpointURL(providerID, resolvedConfig);
  const headers = new Headers();
  const staticHeaders = resolvedConfig.request?.headers && typeof resolvedConfig.request.headers === 'object'
    ? resolvedConfig.request.headers
    : {};
  for (const [key, value] of Object.entries(staticHeaders)) {
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue) {
      continue;
    }
    headers.set(key, normalizedValue);
  }
  const authState = applyAuth(providerID, resolvedConfig, baseRequestURL, headers);
  if (authState.skipped) {
    return {
      status: 'missing_credentials',
      reason: authState.reason,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('timeout')), resolvedConfig.timeoutMs);
  try {
    const pagination = resolvePaginationConfig(resolvedConfig);
    const responseConfig = resolvedConfig.response && typeof resolvedConfig.response === 'object' ? resolvedConfig.response : {};
    const idField = String(responseConfig.id_field || 'id').trim();
    const paginationNotes = [];
    const rawIDs = [];
    let nextPageToken = '';
    let pagesFetched = 0;

    do {
      const requestURL = new URL(baseRequestURL);
      if (pagination.enabled && nextPageToken) {
        requestURL.searchParams.set(pagination.requestQueryParam, nextPageToken);
      }

      const response = await fetch(requestURL, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      const bodyText = await response.text();
      if (!response.ok) {
        return {
          status: 'request_failed',
          reason: `HTTP ${response.status} ${response.statusText}`.trim(),
          bodyPreview: bodyText.slice(0, 400),
          requestURL: requestURL.toString(),
        };
      }
      let payload;
      try {
        payload = JSON.parse(bodyText);
      } catch (error) {
        return {
          status: 'request_failed',
          reason: `invalid JSON response: ${String(error)}`,
          bodyPreview: bodyText.slice(0, 400),
          requestURL: requestURL.toString(),
        };
      }

      const items = getByPath(payload, responseConfig.items_path);
      if (!Array.isArray(items)) {
        return {
          status: 'request_failed',
          reason: `response items_path ${String(responseConfig.items_path || '<root>')} is not an array`,
          requestURL: requestURL.toString(),
        };
      }
      rawIDs.push(...items
        .filter((item) => responseItemPassesFilters(item, responseConfig))
        .map((item) => getByPath(item, idField)));
      pagesFetched += 1;

      if (!pagination.enabled) {
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
          if (payload.has_more === true) {
            paginationNotes.push('response indicates has_more=true; current runner uses first page only');
          }
          if (String(payload.next_page || payload.nextPageToken || payload.next_page_token || '').trim()) {
            paginationNotes.push('response indicates next page token; current runner uses first page only');
          }
        }
        break;
      }

      nextPageToken = String(getByPath(payload, pagination.responseTokenPath) || '').trim();
      if (nextPageToken && pagesFetched >= pagination.maxPages) {
        paginationNotes.push(`pagination truncated after ${pagesFetched} page(s)`);
        nextPageToken = '';
      }
    } while (nextPageToken);

    if (pagesFetched > 1) {
      paginationNotes.push(`fetched ${pagesFetched} page(s)`);
    }

    const discoveredIDs = normalizeDiscoveredIDs(rawIDs, resolvedConfig);
    return {
      status: 'fetched',
      requestURL: baseRequestURL.toString(),
      variantLabel,
      discoveredIDs,
      paginationNotes,
    };
  } catch (error) {
    return {
      status: 'request_failed',
      reason: String(error),
      requestURL: baseRequestURL.toString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchProviderDiscovery(providerID, resolvedConfig) {
  const variants = resolveRequestVariants(resolvedConfig);
  const discoveredIDs = [];
  const seen = new Set();
  const paginationNotes = [];
  const requestURLs = [];
  for (const variant of variants) {
    const result = await fetchProviderDiscoveryVariant(providerID, variant.config, variant.label);
    if (result.status !== 'fetched') {
      return result;
    }
    if (result.requestURL) {
      requestURLs.push(result.requestURL);
    }
    const labelPrefix = variant.label ? `[${variant.label}] ` : '';
    for (const note of result.paginationNotes || []) {
      paginationNotes.push(`${labelPrefix}${note}`.trim());
    }
    for (const modelID of result.discoveredIDs || []) {
      const key = String(modelID || '').trim().toLowerCase();
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      discoveredIDs.push(modelID);
    }
  }
  if (variants.length > 1) {
    paginationNotes.push(`combined ${variants.length} request variant(s)`);
  }
  return {
    status: 'fetched',
    requestURL: requestURLs[0] || '',
    requestURLs,
    discoveredIDs: discoveredIDs.sort((left, right) => left.localeCompare(right)),
    paginationNotes,
  };
}

function compareProviderState(providerID, sourceDoc, resolvedConfig, fetchResult) {
  const { primary, known, selectionModels } = sourceModelSets(sourceDoc);
  const compareConfig = resolvedConfig.compare && typeof resolvedConfig.compare === 'object' ? resolvedConfig.compare : {};
  const detectNewModels = compareConfig.detect_new_models !== false;
  const detectMissingPrimaryModels = compareConfig.detect_missing_primary_models !== false;
  const detectSelectionProfileMisses = compareConfig.detect_selection_profile_misses !== false;
  const compareNotes = normalizeStringArray(compareConfig.notes);
  const compareNote = String(compareConfig.note || '').trim();
  if (compareNote) {
    compareNotes.push(compareNote);
  }
  if (!detectNewModels) {
    compareNotes.push('new-model drift suppressed by compare policy');
  }
  if (!detectMissingPrimaryModels) {
    compareNotes.push('missing-primary drift suppressed by compare policy');
  }
  if (!detectSelectionProfileMisses) {
    compareNotes.push('selection-profile drift suppressed by compare policy');
  }
  const knownSet = new Set(known.map((item) => item.toLowerCase()));
  const discoveredIDs = fetchResult.discoveredIDs || [];
  const discoveredSet = new Set(discoveredIDs.map((item) => item.toLowerCase()));
  const newModels = detectNewModels ? discoveredIDs.filter((item) => !knownSet.has(item.toLowerCase())) : [];
  const missingPrimaryModels = detectMissingPrimaryModels ? primary.filter((item) => !discoveredSet.has(item.toLowerCase())) : [];
  const selectionProfileMisses = detectSelectionProfileMisses ? selectionModels.filter((item) => !discoveredSet.has(item.toLowerCase())) : [];
  const hasDrift = newModels.length > 0 || missingPrimaryModels.length > 0 || selectionProfileMisses.length > 0;
  return {
    provider: providerID,
    sourcePrimaryCount: primary.length,
    sourceKnownCount: known.length,
    discoveredCount: discoveredIDs.length,
    newModels,
    missingPrimaryModels,
    selectionProfileMisses,
    compareNotes,
    status: hasDrift ? 'drift_detected' : 'ok',
  };
}

function formatMarkdown(summary) {
  const lines = [];
  lines.push('# Provider Model Discovery Report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- providers scanned: ${summary.providers.length}`);
  lines.push(`- ok: ${summary.providers.filter((item) => item.status === 'ok').length}`);
  lines.push(`- drift_detected: ${summary.providers.filter((item) => item.status === 'drift_detected').length}`);
  lines.push(`- missing_credentials: ${summary.providers.filter((item) => item.status === 'missing_credentials').length}`);
  lines.push(`- request_failed: ${summary.providers.filter((item) => item.status === 'request_failed').length}`);
  lines.push(`- unsupported: ${summary.providers.filter((item) => item.status === 'unsupported').length}`);
  lines.push(`- providers with selection profile misses: ${summary.providers.filter((item) => (item.selectionProfileMisses?.length || 0) > 0).length}`);
  lines.push('');
  lines.push('## Providers');
  lines.push('');
  lines.push('| Provider | Status | Adapter | Primary | Known | Discovered | New | Missing Primary | Selection Miss | Notes |');
  lines.push('|---|---|---|---:|---:|---:|---:|---:|---:|---|');
  for (const item of summary.providers) {
    const note = String(item.note || '').replace(/\|/g, '/');
    lines.push(`| \`${item.provider}\` | \`${item.status}\` | \`${item.adapter || '—'}\` | ${item.sourcePrimaryCount || 0} | ${item.sourceKnownCount || 0} | ${item.discoveredCount || 0} | ${item.newModels?.length || 0} | ${item.missingPrimaryModels?.length || 0} | ${item.selectionProfileMisses?.length || 0} | ${note || '—'} |`);
  }
  const driftProviders = summary.providers.filter((item) => item.status === 'drift_detected');
  if (driftProviders.length > 0) {
    lines.push('');
    lines.push('## Drift Details');
    lines.push('');
    for (const item of driftProviders) {
      lines.push(`### ${item.provider}`);
      lines.push('');
      if (item.newModels.length > 0) {
        lines.push(`- new models: ${item.newModels.join(', ')}`);
      }
      if (item.missingPrimaryModels.length > 0) {
        lines.push(`- missing primary models: ${item.missingPrimaryModels.join(', ')}`);
      }
      if (item.selectionProfileMisses.length > 0) {
        lines.push(`- selection profile misses: ${item.selectionProfileMisses.join(', ')}`);
      }
      if (item.requestURL) {
        lines.push(`- request URL: ${item.requestURL}`);
      }
      if (Array.isArray(item.requestURLs) && item.requestURLs.length > 1) {
        lines.push(`- request URLs: ${item.requestURLs.join(', ')}`);
      }
      if (item.note) {
        lines.push(`- notes: ${item.note}`);
      }
      lines.push('');
    }
  }
  const reviewQueue = summary.providers.filter((item) => item.status === 'drift_detected' || (item.selectionProfileMisses?.length || 0) > 0);
  if (reviewQueue.length > 0) {
    lines.push('## Review Queue');
    lines.push('');
    for (const item of reviewQueue) {
      const reasons = [];
      if ((item.newModels?.length || 0) > 0) {
        reasons.push(`${item.newModels.length} new model(s)`);
      }
      if ((item.missingPrimaryModels?.length || 0) > 0) {
        reasons.push(`${item.missingPrimaryModels.length} missing primary model(s)`);
      }
      if ((item.selectionProfileMisses?.length || 0) > 0) {
        reasons.push(`${item.selectionProfileMisses.length} selection profile miss(es)`);
      }
      lines.push(`- \`${item.provider}\`: ${reasons.join(', ') || 'review required'}`);
    }
    lines.push('');
  }
  const skippedProviders = summary.providers.filter((item) => item.status === 'unsupported' || item.status === 'missing_credentials' || item.status === 'request_failed');
  if (skippedProviders.length > 0) {
    lines.push('## Skipped / Failed');
    lines.push('');
    for (const item of skippedProviders) {
      lines.push(`- \`${item.provider}\` \`${item.status}\`: ${item.note || 'no detail'}`);
    }
    lines.push('');
  }
  return `${lines.join('\n').trim()}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootConfig = readYaml(args.configPath);
  const sourceProviders = loadSourceProviders();
  const requestedProviders = new Set(args.providerFilter);
  const filteredProviders = sourceProviders.filter((item) => requestedProviders.size === 0 || requestedProviders.has(item.provider));

  const configuredProviders = Object.keys(rootConfig?.providers || {}).map((item) => normalizeProviderID(item));
  for (const providerID of configuredProviders) {
    if (!sourceProviders.some((item) => item.provider === providerID)) {
      throw new Error(`discovery config references unknown source provider ${providerID}`);
    }
    buildResolvedProviderConfig(providerID, sourceProviders.find((item) => item.provider === providerID)?.document || {}, rootConfig);
  }

  if (args.validateConfigOnly) {
    const payload = {
      ok: true,
      configPath: path.relative(repoRoot, args.configPath),
      configuredProviders: configuredProviders.sort((left, right) => left.localeCompare(right)),
      scannedProviders: filteredProviders.map((item) => item.provider),
    };
    if (args.json) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      return;
    }
    process.stdout.write(`runtime-provider-model-discovery config valid: ${configuredProviders.length} adapter entries\n`);
    return;
  }

  const providers = [];
  for (const sourceProvider of filteredProviders) {
    const providerID = sourceProvider.provider;
    const resolvedConfig = buildResolvedProviderConfig(providerID, sourceProvider.document, rootConfig);
    if (!resolvedConfig) {
      const state = {
        provider: providerID,
        status: 'unsupported',
        adapter: null,
        sourcePrimaryCount: sourceModelSets(sourceProvider.document).primary.length,
        sourceKnownCount: sourceModelSets(sourceProvider.document).known.length,
        discoveredCount: 0,
        newModels: [],
        missingPrimaryModels: [],
        selectionProfileMisses: [],
        note: 'no live discovery adapter configured',
      };
      providers.push(state);
      continue;
    }
    const fetchResult = await fetchProviderDiscovery(providerID, resolvedConfig);
    if (fetchResult.status !== 'fetched') {
      providers.push({
        provider: providerID,
        status: fetchResult.status,
        adapter: resolvedConfig.adapter,
        sourcePrimaryCount: sourceModelSets(sourceProvider.document).primary.length,
        sourceKnownCount: sourceModelSets(sourceProvider.document).known.length,
        discoveredCount: 0,
        newModels: [],
        missingPrimaryModels: [],
        selectionProfileMisses: [],
        note: fetchResult.reason || 'discovery skipped',
        requestURL: fetchResult.requestURL,
        requestURLs: fetchResult.requestURLs,
      });
      continue;
    }
    const comparison = compareProviderState(providerID, sourceProvider.document, resolvedConfig, fetchResult);
    providers.push({
      ...comparison,
      adapter: resolvedConfig.adapter,
      note: normalizeStringArray([...(fetchResult.paginationNotes || []), ...(comparison.compareNotes || [])]).join('; '),
      requestURL: fetchResult.requestURL,
      requestURLs: fetchResult.requestURLs,
    });
  }

  const summary = {
    configPath: path.relative(repoRoot, args.configPath),
    providers,
  };
  const reportPath = args.writeReport
    || (rootConfig?.defaults?.report_output ? path.resolve(repoRoot, String(rootConfig.defaults.report_output)) : null);
  if (reportPath) {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, formatMarkdown(summary), 'utf8');
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatMarkdown(summary)}\n`);
  }

  const hasDrift = providers.some((item) => item.status === 'drift_detected');
  const hasStrictFailure = providers.some((item) => item.status === 'request_failed' || item.status === 'missing_credentials');
  if ((args.failOnDrift && hasDrift) || (args.strict && hasStrictFailure)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`audit-runtime-provider-model-discovery failed: ${String(error)}\n`);
  process.exitCode = 1;
});
