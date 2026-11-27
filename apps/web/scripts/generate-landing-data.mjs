#!/usr/bin/env node
// Landing data generator
// Reads admitted spec YAMLs and emits typed TS modules under
// apps/web/src/landing/generated/. The admitted provider and capability tables
// are the authority for this projection (AdmittedCapability union literals are
// type-enforced).

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(SCRIPT_DIR, '..');
const REPO_ROOT = resolve(APP_ROOT, '..', '..');

const PROVIDER_CATALOG_PATH = resolve(
  REPO_ROOT,
  'config/runtime-provider-catalog.yaml',
);
const PROVIDER_CAPABILITIES_PATH = resolve(
  REPO_ROOT,
  'config/runtime-provider-capabilities.yaml',
);
const LOCAL_CATALOG_PATH = resolve(
  REPO_ROOT,
  'runtime/catalog/providers/local.yaml',
);

const GENERATED_DIR = resolve(APP_ROOT, 'src/landing/generated');
const ADMITTED_PROVIDERS_OUT = resolve(GENERATED_DIR, 'admitted-providers.ts');
const PROVIDER_CAPABILITIES_OUT = resolve(GENERATED_DIR, 'provider-capabilities.ts');
const LOCAL_MODELS_OUT = resolve(GENERATED_DIR, 'local-model-catalog.ts');
const INDEX_OUT = resolve(GENERATED_DIR, 'index.ts');
const CLOUD_MODELS_OUT = resolve(GENERATED_DIR, 'cloud-model-catalog.ts');

const ADMITTED_INVENTORY_MODES = new Set(['static_source', 'dynamic_endpoint']);
const ADMITTED_RUNTIME_PLANES = new Set(['remote', 'local']);
const ADMITTED_ENDPOINT_REQUIREMENTS = new Set([
  'default_or_explicit',
  'explicit_required',
  'empty_string_only',
]);
const CAPABILITIES_ONLY_PROVIDERS = new Set(['local']);

// Per r5 (audit r4 F-002): the AdmittedCapability union is generated from
// DISTINCT capability values discovered in provider-capabilities.yaml.
// Generator fail-closes if YAML adds a capability not present in this admitted
// list (forces an authority update before drift can ship). To extend: add the new
// value here, regenerate, and ensure both en + zh content tree dicts include
// the matching label key in modelCatalog.capabilityLabels.
const ADMITTED_CAPABILITIES_ALLOWLIST = new Set([
  'audio.separate',
  'audio.synthesize',
  'audio.transcribe',
  'audio.voice.convert',
  'image.generate',
  'image.upscale',
  'music.generate',
  'music.transcribe',
  'realtime.interact',
  'text.decide',
  'text.embed',
  'text.generate',
  'video.generate',
  'video.upscale',
  'vision.locate',
  'voice.create',
  'world.generate',
]);

// Canonical vocabulary may precede a verified public product slice. Keep the
// contract type admitted while withholding provider-level supported claims
// that the current release posture explicitly defers.
const DEFERRED_PUBLIC_CAPABILITIES = new Set(['world.generate']);

function failClose(message) {
  process.stderr.write(`generate-landing-data: ${message}\n`);
  process.exit(1);
}

function readSource(path) {
  const raw = readFileSync(path);
  const text = raw.toString('utf8');
  return {
    text,
    sha256: createHash('sha256').update(raw).digest('hex'),
    parsed: parseYaml(text),
  };
}

function validateEnum(value, admitted, fieldName, providerName) {
  if (!admitted.has(value)) {
    failClose(
      `provider "${providerName}" has unadmitted ${fieldName}="${value}". ` +
        `Admitted values: [${[...admitted].join(', ')}]. ` +
        `Add the new value to the admitted union in this generator AND ensure ` +
        `downstream consumer (LandingContent.modelCatalog.capabilityLabels for ` +
        `capability values; component logic for plane/inventory/endpoint values) ` +
        `is updated in the same authority change.`,
    );
  }
}

function snakeToCamel(snake) {
  return snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function quoteString(value) {
  return JSON.stringify(value);
}

function repoRelativePath(path) {
  return relative(REPO_ROOT, path).replace(/\\/g, '/');
}

function formatHeader(sourcePath, sourceHash) {
  const relPath = repoRelativePath(sourcePath);
  return `/**
 * @generated
 * Source: ${relPath}
 *   sha256: ${sourceHash}
 * Generator: apps/web/scripts/generate-landing-data.mjs
 * DO NOT EDIT MANUALLY. Re-run generator (\`pnpm prebuild\` or
 * \`node scripts/generate-landing-data.mjs\` from apps/web/) to refresh.
 */`;
}

function formatHeaderMulti(sources) {
  const lines = [
    '/**',
    ' * @generated',
    ' * Sources:',
  ];
  for (const { path, sha256 } of sources) {
    const relPath = repoRelativePath(path);
    lines.push(` *   ${relPath}`);
    lines.push(` *     sha256: ${sha256}`);
  }
  lines.push(' * Generator: apps/web/scripts/generate-landing-data.mjs');
  lines.push(' * DO NOT EDIT MANUALLY. Re-run generator (`pnpm prebuild` or');
  lines.push(' * `node scripts/generate-landing-data.mjs` from apps/web/) to refresh.');
  lines.push(' */');
  return lines.join('\n');
}

function generateAdmittedProviders(catalogYaml, catalogHash) {
  const providers = catalogYaml.providers ?? [];
  if (!Array.isArray(providers)) {
    failClose('provider-catalog.yaml: top-level "providers" must be an array');
  }

  const rows = providers.map((row) => {
    const name = row.provider;
    if (typeof name !== 'string' || !name) {
      failClose(`provider-catalog.yaml row missing string "provider" field: ${JSON.stringify(row)}`);
    }
    validateEnum(row.inventory_mode, ADMITTED_INVENTORY_MODES, 'inventory_mode', name);
    return {
      provider: name,
      defaultEndpoint: row.default_endpoint ?? null,
      defaultTextModel: row.default_text_model ?? null,
      requiresExplicitEndpoint: Boolean(row.requires_explicit_endpoint),
      inventoryMode: row.inventory_mode,
      sourceRule: row.source_rule ?? '',
    };
  });

  // Stable sort by provider name (idempotence requirement)
  rows.sort((a, b) => (a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : 0));

  const header = formatHeader(PROVIDER_CATALOG_PATH, catalogHash);
  const body = `${header}

export type AdmittedInventoryMode = 'static_source' | 'dynamic_endpoint';

export type AdmittedProvider = {
  provider: string;
  defaultEndpoint: string | null;
  defaultTextModel: string | null;
  requiresExplicitEndpoint: boolean;
  inventoryMode: AdmittedInventoryMode;
  sourceRule: string;
};

export const ADMITTED_PROVIDERS: readonly AdmittedProvider[] = [
${rows
  .map(
    (r) =>
      `  {
    provider: ${quoteString(r.provider)},
    defaultEndpoint: ${r.defaultEndpoint === null ? 'null' : quoteString(r.defaultEndpoint)},
    defaultTextModel: ${r.defaultTextModel === null ? 'null' : quoteString(r.defaultTextModel)},
    requiresExplicitEndpoint: ${r.requiresExplicitEndpoint ? 'true' : 'false'},
    inventoryMode: ${quoteString(r.inventoryMode)},
    sourceRule: ${quoteString(r.sourceRule)},
  },`,
  )
  .join('\n')}
];
`;

  return { body, count: rows.length, providerNames: rows.map((r) => r.provider) };
}

function generateProviderCapabilities(capYaml, catalogHash, capHash) {
  const providers = capYaml.providers ?? [];
  if (!Array.isArray(providers)) {
    failClose('provider-capabilities.yaml: top-level "providers" must be an array');
  }

  const distinctCapabilities = new Set();

  const rows = providers.map((row) => {
    const name = row.provider;
    if (typeof name !== 'string' || !name) {
      failClose(`provider-capabilities.yaml row missing string "provider" field: ${JSON.stringify(row)}`);
    }
    validateEnum(row.runtime_plane, ADMITTED_RUNTIME_PLANES, 'runtime_plane', name);
    validateEnum(
      row.endpoint_requirement,
      ADMITTED_ENDPOINT_REQUIREMENTS,
      'endpoint_requirement',
      name,
    );
    validateEnum(row.inventory_mode, ADMITTED_INVENTORY_MODES, 'inventory_mode', name);
    if (typeof row.execution_module !== 'string' || !row.execution_module) {
      failClose(`provider "${name}" missing string "execution_module"`);
    }

    const sourceCapabilities = Array.isArray(row.capabilities) ? row.capabilities : [];
    for (const cap of sourceCapabilities) {
      if (typeof cap !== 'string' || !cap) {
        failClose(`provider "${name}" has non-string capability: ${JSON.stringify(cap)}`);
      }
      if (!ADMITTED_CAPABILITIES_ALLOWLIST.has(cap)) {
        failClose(
          `provider "${name}" has unadmitted capability="${cap}". ` +
            `Admitted values: [${[...ADMITTED_CAPABILITIES_ALLOWLIST].sort().join(', ')}]. ` +
            `Per audit r4 F-002 r5 strengthening: AdmittedCapability is a typed union. ` +
            `To admit a new capability: add it to ADMITTED_CAPABILITIES_ALLOWLIST in this ` +
            `generator AND add a matching label key to LandingContent.modelCatalog.capabilityLabels ` +
            `in both en + zh content trees (typecheck-enforced via Record<AdmittedCapability, string>).`,
        );
      }
      distinctCapabilities.add(cap);
    }
    const capabilities = sourceCapabilities.filter((cap) => !DEFERRED_PUBLIC_CAPABILITIES.has(cap));

    const sources = Array.isArray(row.sources) ? row.sources : [];

    return {
      provider: name,
      runtimePlane: row.runtime_plane,
      executionModule: row.execution_module,
      managedConnectorSupported: Boolean(row.managed_connector_supported),
      inlineSupported: Boolean(row.inline_supported),
      endpointRequirement: row.endpoint_requirement,
      inventoryMode: row.inventory_mode,
      capabilities: [...capabilities].sort(),
      sources: [...sources].sort(),
    };
  });

  // Stable sort by provider name
  rows.sort((a, b) => (a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : 0));

  const sortedCaps = [...distinctCapabilities].sort();

  // Verify exact match between yaml-distinct and ADMITTED_CAPABILITIES_ALLOWLIST
  // (allowlist may be a strict superset of yaml-distinct if an admitted capability has no provider yet)
  const allowlistArr = [...ADMITTED_CAPABILITIES_ALLOWLIST].sort();
  const missingFromYaml = allowlistArr.filter((c) => !distinctCapabilities.has(c));
  if (missingFromYaml.length > 0) {
    process.stderr.write(
      `generate-landing-data: WARNING — admitted capabilities with no provider in YAML: ` +
        `[${missingFromYaml.join(', ')}]. They remain in the AdmittedCapability union per r5 strengthening, ` +
        `but no provider currently ships them.\n`,
    );
  }

  const header = formatHeaderMulti([
    { path: PROVIDER_CAPABILITIES_PATH, sha256: capHash },
    { path: PROVIDER_CATALOG_PATH, sha256: catalogHash }, // referenced for the AdmittedInventoryMode union shared across files
  ]);

  const body = `${header}

import type { AdmittedInventoryMode } from './admitted-providers.js';

export type AdmittedRuntimePlane = 'remote' | 'local';

export type AdmittedEndpointRequirement =
  | 'default_or_explicit'
  | 'explicit_required'
  | 'empty_string_only';

// r5 added per audit r4 F-002 — generator emits union derived from
// admitted YAML so that downstream label coverage can be type-enforced.
// Members are the DISTINCT capability values across all rows of
// provider-capabilities.yaml plus any future-admitted capabilities not yet
// shipping. Generator fail-closes if YAML adds a value not in this union.
export type AdmittedCapability =
${allowlistArr.map((c) => `  | ${quoteString(c)}`).join('\n')};

// r5 also exported as readonly tuple for runtime iteration (e.g., to drive
// content-tree label coverage checks):
export const ADMITTED_CAPABILITIES = [
${allowlistArr.map((c) => `  ${quoteString(c)},`).join('\n')}
] as const satisfies readonly AdmittedCapability[];

export type ProviderCapability = {
  provider: string;
  runtimePlane: AdmittedRuntimePlane;
  executionModule: string;
  managedConnectorSupported: boolean;
  inlineSupported: boolean;
  endpointRequirement: AdmittedEndpointRequirement;
  inventoryMode: AdmittedInventoryMode;
  capabilities: readonly AdmittedCapability[];
  sources: readonly string[];
};

export const PROVIDER_CAPABILITIES: readonly ProviderCapability[] = [
${rows
  .map(
    (r) =>
      `  {
    provider: ${quoteString(r.provider)},
    runtimePlane: ${quoteString(r.runtimePlane)},
    executionModule: ${quoteString(r.executionModule)},
    managedConnectorSupported: ${r.managedConnectorSupported ? 'true' : 'false'},
    inlineSupported: ${r.inlineSupported ? 'true' : 'false'},
    endpointRequirement: ${quoteString(r.endpointRequirement)},
    inventoryMode: ${quoteString(r.inventoryMode)},
    capabilities: [${r.capabilities.map((c) => quoteString(c)).join(', ')}],
    sources: [${r.sources.map((s) => quoteString(s)).join(', ')}],
  },`,
  )
  .join('\n')}
];
`;

  return {
    body,
    count: rows.length,
    capabilityCount: sortedCaps.length,
    providerNames: rows.map((r) => r.provider),
  };
}

function formatLocalModelLabel(model, recipe, recipeModelCount) {
  if (!model) {
    if (recipe.recipe_id === 'insightface.image-face-swap.v1' || recipe.recipe_id === 'insightface.video-face-swap.v1') {
      return 'InsightFace';
    }
    if (recipe.recipe_id === 'sherpa-speaker-encoder.v1') {
      return 'Sherpa-ONNX Speaker Encoder';
    }
    return String(recipe.title ?? recipe.recipe_id)
      .replace(/\s*\(weight terms unconfirmed\)/i, '')
      .replace(/\s+(image|video)\s+face replacement$/i, '')
      .replace(/\s+singing voice conversion$/i, '')
      .replace(/\s+separation$/i, '')
      .trim();
  }

  const id = model.model_id;
  const spacyMatch = id.match(/^asset-nlp-spacy-(.+)-(\d+\.\d+\.\d+)$/);
  if (spacyMatch) {
    const pkg = spacyMatch[1].replace(/-/g, '_');
    const lang = String(recipe.title ?? '').replace(/\s+(transformer\s+)?language analysis$/i, '');
    return `spaCy ${pkg} (${lang})`;
  }
  if (id.startsWith('asset-decision-laya-')) {
    return String(recipe.title ?? id).trim();
  }
  const genericTextTitle = /^llama\.cpp GGUF text generation$/i.test(String(recipe.title ?? '').trim());
  if ((recipeModelCount > 1 || genericTextTitle) && model.install?.repo) {
    const repoName = model.install.repo.split('/').pop().replace(/-GGUF$/i, '');
    if (/^gemma-4-/i.test(repoName)) {
      return repoName.replace(/-/g, ' ').replace(/\bgemma\b/i, 'Gemma').replace(/\bit\b/i, 'IT');
    }
    if (/^grounding-dino-/i.test(repoName)) {
      const size = repoName.slice('grounding-dino-'.length);
      return `Grounding DINO ${size.charAt(0).toUpperCase()}${size.slice(1)}`;
    }
    return repoName;
  }

  return String(recipe.title ?? id)
    .replace(/\s*\(Windows CUDA\)/i, '')
    .replace(/\s*\(experimental\)/i, '')
    .replace(/\s*\(non-commercial\)/i, '')
    .replace(/\s+-\s+Built with Fish Audio/i, '')
    .replace(/\s+-\s+Powered by KittenML/i, '')
    .replace(/\s+audio\.cpp\s+(synthesis|transcription|reference voice|music generation)$/i, '')
    .replace(/\s+(base\s+)?text generation$/i, '')
    .replace(/\s+image and text$/i, '')
    .replace(/\s+unified image, audio and video$/i, ' Unified')
    .replace(/\s+text$/i, '')
    .replace(/\s+generation and editing$/i, '')
    .replace(/\s+generation$/i, '')
    .replace(/\s+(image|video)\s+upscaling$/i, '')
    .replace(/\s+silent video$/i, '')
    .replace(/\s+video$/i, '')
    .replace(/\s+image localization$/i, '')
    .replace(/\s+speech synthesis$/i, '')
    .replace(/\s+synthesis$/i, '')
    .replace(/\s+Transformers transcription$/i, '')
    .replace(/\s+transcription(\s+with.*)?$/i, '')
    .replace(/\s+with word alignment$/i, '')
    .replace(/\s+singing voice conversion$/i, '')
    .replace(/\s+score-guided music$/i, '')
    .replace(/\s+music$/i, '')
    .replace(/\s+note estimates$/i, '')
    .replace(/\s+CPU$/i, '')
    .replace(/\s+reference voice$/i, '')
    .replace(/^Qwen3 design and reference voice library$/i, 'Qwen3-TTS Base')
    .replace(/^Qwen3 local voice clone$/i, 'Qwen3-TTS Base')
    .replace(/^Qwen3 local voice design$/i, 'Qwen3-TTS VoiceDesign')
    .replace(/^Qwen3 TTS CustomVoice$/i, 'Qwen3-TTS CustomVoice')
    .replace(/^Qwen3 TTS Base$/i, 'Qwen3-TTS Base')
    .replace(/^Qwen3 TTS VoiceDesign$/i, 'Qwen3-TTS VoiceDesign')
    .replace(/^Qwen3 ASR$/i, 'Qwen3-ASR 0.6B')
    .replace(/^llama\.cpp GGUF embeddings$/i, 'Nomic Embed Text v1.5')
    .replace(/^Qwen3 last-token normalized embeddings$/i, 'Qwen3 Embedding 0.6B')
    .replace(/^EmbeddingGemma 2 text retrieval$/i, 'EmbeddingGemma 2')
    .replace(/^Whisper$/i, 'Whisper Large v3 Turbo')
    .replace(/^LocateAnything$/i, 'LocateAnything 3B')
    .trim();
}

function generateLocalModelCatalog(localYaml, localHash) {
  if (localYaml.provider !== 'local' || !Array.isArray(localYaml.models) || !Array.isArray(localYaml.loadout_recipes)) {
    failClose('local.yaml: expected provider="local" with models and loadout_recipes arrays');
  }

  const variantToModel = new Map();
  for (const model of localYaml.models) {
    for (const variant of model.variants ?? []) {
      if (typeof variant.variant_id === 'string' && variant.variant_id) {
        variantToModel.set(variant.variant_id, model);
      }
    }
  }

  const byCapability = new Map();
  for (const recipe of localYaml.loadout_recipes) {
    const capability = recipe.capability_contract;
    if (typeof capability !== 'string' || !capability || DEFERRED_PUBLIC_CAPABILITIES.has(capability)) {
      continue;
    }
    let entries = byCapability.get(capability);
    if (!entries) {
      entries = new Map();
      byCapability.set(capability, entries);
    }
    const primarySlot = Array.isArray(recipe.slot_metadata) ? recipe.slot_metadata[0] : null;
    const variantIds = Array.isArray(primarySlot?.recommended_variant_ids) ? primarySlot.recommended_variant_ids : [];
    if (variantIds.length > 0) {
      const recipeModels = [];
      const seenInRecipe = new Set();
      for (const variantId of variantIds) {
        const model = variantToModel.get(variantId);
        if (!model || seenInRecipe.has(model.model_id)) continue;
        seenInRecipe.add(model.model_id);
        recipeModels.push(model);
      }
      for (const model of recipeModels) {
        const label = formatLocalModelLabel(model, recipe, recipeModels.length);
        const dedupeKey = label.toLowerCase();
        if (!entries.has(dedupeKey)) {
          entries.set(dedupeKey, { id: model.model_id, label });
        }
      }
    } else {
      const label = formatLocalModelLabel(null, recipe, 0);
      const dedupeKey = label.toLowerCase();
      if (!entries.has(dedupeKey)) {
        entries.set(dedupeKey, { id: recipe.recipe_id, label, byo: true });
      }
    }
  }

  const sortedCapabilities = [...byCapability.keys()].sort();
  const header = formatHeader(LOCAL_CATALOG_PATH, localHash);
  const lines = [
    header,
    '',
    'export type LocalCapabilityModel = {',
    '  id: string;',
    '  label: string;',
    '  byo?: boolean;',
    '};',
    '',
    'export const LOCAL_MODEL_CATALOG: Readonly<Record<string, readonly LocalCapabilityModel[]>> = {',
  ];
  let totalModels = 0;
  for (const capability of sortedCapabilities) {
    const models = [...byCapability.get(capability).values()];
    totalModels += models.length;
    lines.push(`  ${quoteString(capability)}: [`);
    for (const model of models) {
      lines.push(`    ${JSON.stringify(model)},`);
    }
    lines.push('  ],');
  }
  lines.push('};', '');
  return {
    body: lines.join('\n'),
    capabilityCount: sortedCapabilities.length,
    modelCount: totalModels,
  };
}

function generateIndexBarrel(catalogHash, capHash, localHash) {
  const header = formatHeaderMulti([
    { path: PROVIDER_CATALOG_PATH, sha256: catalogHash },
    { path: PROVIDER_CAPABILITIES_PATH, sha256: capHash },
    { path: LOCAL_CATALOG_PATH, sha256: localHash },
  ]);
  return `${header}

export type {
  AdmittedInventoryMode,
  AdmittedProvider,
} from './admitted-providers.js';
export { ADMITTED_PROVIDERS } from './admitted-providers.js';

export type {
  AdmittedRuntimePlane,
  AdmittedEndpointRequirement,
  AdmittedCapability,
  ProviderCapability,
} from './provider-capabilities.js';
export {
  ADMITTED_CAPABILITIES,
  PROVIDER_CAPABILITIES,
} from './provider-capabilities.js';

export type { LocalCapabilityModel } from './local-model-catalog.js';
export { LOCAL_MODEL_CATALOG } from './local-model-catalog.js';
`;
}

function applyJoinPolicy(catalogProviders, capabilityProviders) {
  // Per D1.3.3: orphan rows in either YAML emit warning + keep row; no silent drop.
  // `local` is intentionally capabilities-only: runtime spec governance requires
  // exactly one local capability row and forbids it in provider-catalog.yaml.
  const catalogSet = new Set(catalogProviders);
  const capSet = new Set(capabilityProviders);
  const onlyInCatalog = [...catalogSet].filter((p) => !capSet.has(p));
  const onlyInCapabilities = [...capSet].filter(
    (p) => !catalogSet.has(p) && !CAPABILITIES_ONLY_PROVIDERS.has(p),
  );
  if (onlyInCatalog.length > 0) {
    process.stderr.write(
      `generate-landing-data: WARNING — provider(s) in catalog but not in capabilities: ` +
        `[${onlyInCatalog.sort().join(', ')}]. Kept in ADMITTED_PROVIDERS per D1.3.3 JOIN policy.\n`,
    );
  }
  if (onlyInCapabilities.length > 0) {
    process.stderr.write(
      `generate-landing-data: WARNING — provider(s) in capabilities but not in catalog: ` +
        `[${onlyInCapabilities.sort().join(', ')}]. Kept in PROVIDER_CAPABILITIES per D1.3.3 JOIN policy.\n`,
    );
  }
}

/** Public display fields only. Live endpoint discovery, account overrides and
 * execution bindings belong to Runtime and are not inputs to the Web demo. */
function generateCloudModelCatalog(capabilities) {
  const bundled = resolve(REPO_ROOT, 'runtime/catalog/providers');
  const managed = new Set(capabilities.providers.filter(row =>
    row.runtime_plane === 'remote' && row.managed_connector_supported && row.inventory_mode === 'static_source',
  ).map(row => row.provider));
  const lines = [
    '// Generated by apps/web/scripts/generate-landing-data.mjs from the bundled provider catalogs.',
    'export type DemoCloudModel = { label: string; id: string; capabilities: readonly string[] };',
    'export const cloudModelCatalog: Readonly<Record<string, readonly DemoCloudModel[]>> = {',
  ];
  for (const name of readdirSync(bundled).filter(name => name.endsWith('.yaml')).sort()) {
    const provider = name.slice(0, -5);
    if (!managed.has(provider)) continue;
    const catalog = readSource(resolve(bundled, name)).parsed;
    if (catalog.provider !== provider || !Array.isArray(catalog.models)) failClose(`Invalid model catalog: ${name}`);
    const models = new Map();
    for (const row of catalog.models) {
      if (typeof row.model_id !== 'string' || !row.model_id || !Array.isArray(row.capabilities)
        || row.capabilities.some(value => typeof value !== 'string')) failClose(`Invalid model entry: ${name}`);
      const id = row.api_model_id || row.model_id;
      const model = models.get(id) ?? { label: row.model_id, id, capabilities: [] };
      model.capabilities = [...new Set([...model.capabilities, ...row.capabilities])].sort();
      models.set(id, model);
    }
    lines.push(`  ${JSON.stringify(provider)}: [`, ...Array.from(models.values(), model => `    ${JSON.stringify(model)},`), '  ],');
  }
  return [...lines, '};', ''].join('\n');
}

function main() {
  process.stdout.write('generate-landing-data: reading admitted YAMLs...\n');
  const catalog = readSource(PROVIDER_CATALOG_PATH);
  const capabilities = readSource(PROVIDER_CAPABILITIES_PATH);
  const localCatalog = readSource(LOCAL_CATALOG_PATH);

  process.stdout.write(`  provider-catalog.yaml      sha256=${catalog.sha256}\n`);
  process.stdout.write(`  provider-capabilities.yaml sha256=${capabilities.sha256}\n`);
  process.stdout.write(`  local.yaml                 sha256=${localCatalog.sha256}\n`);

  const catalogResult = generateAdmittedProviders(catalog.parsed, catalog.sha256);
  const capResult = generateProviderCapabilities(capabilities.parsed, catalog.sha256, capabilities.sha256);
  const localResult = generateLocalModelCatalog(localCatalog.parsed, localCatalog.sha256);

  applyJoinPolicy(catalogResult.providerNames, capResult.providerNames);

  const outputs = [
    [ADMITTED_PROVIDERS_OUT, catalogResult.body],
    [PROVIDER_CAPABILITIES_OUT, capResult.body],
    [LOCAL_MODELS_OUT, localResult.body],
    [INDEX_OUT, generateIndexBarrel(catalog.sha256, capabilities.sha256, localCatalog.sha256)],
    [CLOUD_MODELS_OUT, generateCloudModelCatalog(capabilities.parsed)],
  ];

  // --check compares bytes without writing. Without it the only way drift
  // surfaced was a build leaving the working tree dirty, which is not a gate:
  // these artifacts recorded a stale source sha256 for as long as nobody
  // happened to run a build and read `git status`.
  if (process.argv.includes('--check')) {
    const drifted = outputs
      .filter(([target, body]) => {
        try {
          return readFileSync(target, 'utf8') !== body;
        } catch {
          return true;
        }
      })
      .map(([target]) => repoRelativePath(target));
    if (drifted.length > 0) {
      process.stderr.write(`generate-landing-data: generated artifact drift: ${drifted.join(', ')}\n`);
      process.stderr.write('  re-run node scripts/generate-landing-data.mjs from apps/web/\n');
      process.exit(1);
    }
    process.stdout.write('generate-landing-data: generated artifacts current\n');
    return;
  }

  for (const [target, body] of outputs) writeFileSync(target, body);

  process.stdout.write(
    `generate-landing-data: wrote ${catalogResult.count} ADMITTED_PROVIDERS, ` +
      `${capResult.count} PROVIDER_CAPABILITIES, ${capResult.capabilityCount} distinct capabilities, ` +
      `${localResult.modelCount} local models across ${localResult.capabilityCount} capabilities\n`,
  );
  process.stdout.write(`  -> ${repoRelativePath(ADMITTED_PROVIDERS_OUT)}\n`);
  process.stdout.write(`  -> ${repoRelativePath(PROVIDER_CAPABILITIES_OUT)}\n`);
  process.stdout.write(`  -> ${repoRelativePath(LOCAL_MODELS_OUT)}\n`);
  process.stdout.write(`  -> ${repoRelativePath(INDEX_OUT)}\n`);
  process.stdout.write(`  -> ${repoRelativePath(CLOUD_MODELS_OUT)}\n`);
}

main();
