// @nimi-authority: rule.nimi.platform.app-ecosystem.p-scaf-019c

function frozenSourceMapping(sourceRoot, targetRoot = sourceRoot) {
  return Object.freeze({ sourceRoot, targetRoot });
}

function frozenModule(definition) {
  const cargoDependencies = Object.fromEntries(
    Object.entries(definition.cargoDependencies || {}).map(([name, value]) => [
      name,
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.freeze({
            ...value,
            ...(Array.isArray(value.features) ? { features: Object.freeze([...value.features]) } : {}),
          })
        : value,
    ]),
  );
  return Object.freeze({
    ...definition,
    requires: Object.freeze([...(definition.requires || [])]),
    sourceMappings: Object.freeze([...(definition.sourceMappings || [])]),
    appAccessItems: Object.freeze([...(definition.appAccessItems || [])]),
    npmDependencies: Object.freeze({ ...(definition.npmDependencies || {}) }),
    cargoDependencies: Object.freeze(cargoDependencies),
    views: Object.freeze([...(definition.views || [])]),
    navigation: Object.freeze([...(definition.navigation || [])]),
    styles: Object.freeze([...(definition.styles || [])]),
    assets: Object.freeze([...(definition.assets || [])]),
  });
}

export const APP_SCAFFOLD_MODULE_REGISTRY = Object.freeze({
  'ai-studio-core': frozenModule({
    id: 'ai-studio-core',
    kind: 'internal',
    order: 0,
    requires: [],
    sourceMappings: [frozenSourceMapping('src/ai-studio-core', 'src/capabilities/ai-studio-core')],
    appAccessItems: [],
    npmDependencies: {
      i18next: '$versions.i18nextVersion',
      'lucide-react': '$versions.lucideReactVersion',
    },
    cargoDependencies: {},
    hostAdapterContract: 'ai-studio-host-v1',
    views: [],
    navigation: [],
    styles: ['src/ai-studio-core/ai-studio-core.css'],
    assets: [],
    productEntry: Object.freeze({
      kind: 'ai-studio-core',
      modulePath: 'src/ai-studio-core/index.ts',
      componentExport: 'AIStudioWorkspace',
      messageExport: 'aiStudioCoreMessageBundles',
    }),
  }),
  'studio-create': frozenModule({
    id: 'studio-create',
    kind: 'feature',
    lifecycle: 'admitted',
    order: 10,
    label: 'Create',
    requires: ['ai-studio-core'],
    sourceMappings: [frozenSourceMapping('src/studio-modules/studio-create', 'src/capabilities/studio-create')],
    appAccessItems: ['runtime.consume'],
    npmDependencies: {},
    cargoDependencies: {},
    hostAdapterContract: 'ai-studio-host-v1',
    views: ['text.generate', 'chat.stream', 'text.embed'],
    navigation: ['text.generate', 'chat.stream', 'text.embed'],
    styles: [],
    assets: [],
    productEntry: Object.freeze({
      kind: 'ai-studio-module',
      modulePath: 'src/studio-modules/studio-create/index.ts',
      registrationExport: 'studioCreateModule',
      runtimeExport: 'studioCreateRuntimeHandlers',
      messageExport: 'studioCreateMessageBundles',
    }),
  }),
  'studio-media': frozenModule({
    id: 'studio-media',
    kind: 'feature',
    lifecycle: 'admitted',
    order: 20,
    label: 'Media',
    requires: ['ai-studio-core'],
    sourceMappings: [frozenSourceMapping('src/studio-modules/studio-media', 'src/capabilities/studio-media')],
    appAccessItems: ['runtime.consume'],
    npmDependencies: {},
    cargoDependencies: {},
    hostAdapterContract: 'ai-studio-host-v1',
    views: ['image.generate', 'video.generate'],
    navigation: ['image.generate', 'video.generate'],
    styles: [],
    assets: [],
    productEntry: Object.freeze({
      kind: 'ai-studio-module',
      modulePath: 'src/studio-modules/studio-media/index.ts',
      registrationExport: 'studioMediaModule',
      runtimeExport: 'studioMediaRuntimeHandlers',
      messageExport: 'studioMediaMessageBundles',
    }),
  }),
  'studio-voice': frozenModule({
    id: 'studio-voice',
    kind: 'feature',
    lifecycle: 'admitted',
    order: 30,
    label: 'Voice',
    requires: ['ai-studio-core'],
    sourceMappings: [frozenSourceMapping('src/studio-modules/studio-voice', 'src/capabilities/studio-voice')],
    appAccessItems: ['runtime.consume'],
    npmDependencies: {},
    cargoDependencies: {},
    hostAdapterContract: 'ai-studio-host-v1',
    views: ['audio.synthesize', 'audio.transcribe', 'voice.create', 'speech.bundle'],
    navigation: ['audio.synthesize', 'audio.transcribe', 'voice.create', 'speech.bundle'],
    styles: [],
    assets: [],
    productEntry: Object.freeze({
      kind: 'ai-studio-module',
      modulePath: 'src/studio-modules/studio-voice/index.ts',
      registrationExport: 'studioVoiceModule',
      runtimeExport: 'studioVoiceRuntimeHandlers',
      messageExport: 'studioVoiceMessageBundles',
    }),
  }),
  'kit-recipes': frozenModule({
    id: 'kit-recipes',
    kind: 'feature',
    lifecycle: 'admitted',
    order: 40,
    label: 'UI Recipes',
    requires: [],
    sourceMappings: [frozenSourceMapping('src/product-modules/kit-recipes', 'src/capabilities/kit-recipes')],
    appAccessItems: [],
    npmDependencies: {
      'lucide-react': '$versions.lucideReactVersion',
    },
    cargoDependencies: {},
    hostAdapterContract: 'clipboard-copy-v1',
    views: ['kit-recipes'],
    navigation: ['kit-recipes'],
    styles: [],
    assets: [],
    productEntry: Object.freeze({
      kind: 'component',
      modulePath: 'src/product-modules/kit-recipes/index.tsx',
      componentExport: 'KitRecipesCapability',
      identityProp: 'exampleAppId',
    }),
  }),
});

function registryEntries(registry) {
  return Object.entries(registry).sort(([, left], [, right]) => (
    left.order - right.order || left.id.localeCompare(right.id)
  ));
}

function assertRelativePosixPath(value, label) {
  const normalized = String(value || '');
  if (
    !normalized
    || normalized.startsWith('/')
    || normalized.endsWith('/')
    || normalized.includes('..')
    || normalized.includes('\\')
    || normalized.split('/').some((segment) => !segment || segment === '.')
  ) {
    throw new Error(`App scaffold module has invalid ${label}: ${normalized || 'missing'}`);
  }
}

function assertUniqueStrings(values, label) {
  if (!Array.isArray(values)) throw new Error(`App scaffold module ${label} must be an array`);
  const seen = new Set();
  for (const value of values) {
    if (typeof value !== 'string' || !value || value !== value.trim() || seen.has(value)) {
      throw new Error(`App scaffold module has invalid or duplicate ${label}: ${String(value || 'missing')}`);
    }
    seen.add(value);
  }
}

function pathsOverlap(left, right) {
  const normalizedLeft = left.toLowerCase();
  const normalizedRight = right.toLowerCase();
  return normalizedLeft === normalizedRight
    || normalizedLeft.startsWith(`${normalizedRight}/`)
    || normalizedRight.startsWith(`${normalizedLeft}/`);
}

function targetPathForOwnedSource(entry, sourcePath) {
  const mapping = entry.sourceMappings.find((candidate) => (
    sourcePath === candidate.sourceRoot || sourcePath.startsWith(`${candidate.sourceRoot}/`)
  ));
  if (!mapping) throw new Error(`App scaffold module owned source is outside its mappings: ${entry.id}: ${sourcePath}`);
  const suffix = sourcePath === mapping.sourceRoot
    ? ''
    : sourcePath.slice(mapping.sourceRoot.length + 1);
  return suffix ? `${mapping.targetRoot}/${suffix}` : mapping.targetRoot;
}

function canonicalDependencyValue(value) {
  if (Array.isArray(value)) return value.map(canonicalDependencyValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalDependencyValue(value[key])]),
  );
}

function dependencyValuesEqual(left, right) {
  return JSON.stringify(canonicalDependencyValue(left)) === JSON.stringify(canonicalDependencyValue(right));
}

function assertCargoDependencyValue(value, label) {
  if (typeof value === 'string' && value && value === value.trim()) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`App scaffold module Cargo dependency is invalid: ${label}`);
  }
  const allowed = new Set(['version', 'package', 'features', 'default-features', 'optional']);
  const entries = Object.entries(value);
  if (entries.length === 0) throw new Error(`App scaffold module Cargo dependency is empty: ${label}`);
  for (const [key, field] of entries) {
    if (!allowed.has(key)) throw new Error(`App scaffold module Cargo dependency field is invalid: ${label}.${key}`);
    if (typeof field === 'string' && field && field === field.trim()) continue;
    if (typeof field === 'boolean') continue;
    if (Array.isArray(field) && field.every((item) => typeof item === 'string' && item && item === item.trim())) continue;
    throw new Error(`App scaffold module Cargo dependency value is invalid: ${label}.${key}`);
  }
}

function assertPublicNpmDependencyVersion(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized !== value) {
    throw new Error(`App scaffold module npm dependency is invalid: ${label}`);
  }
  if (
    /^(?:workspace|file|link|portal|patch|git(?:\+[^:]*)?|https?):/iu.test(normalized)
    || /^[./\\]/u.test(normalized)
    || /^[A-Za-z]:[\\/]/u.test(normalized)
    || /\.tgz(?:$|[?#])/iu.test(normalized)
  ) {
    throw new Error(`App scaffold module npm dependency must use a public registry version: ${label}`);
  }
}

function assertProductEntry(id, entry) {
  const productEntry = entry.productEntry;
  if (!productEntry || typeof productEntry !== 'object' || Array.isArray(productEntry)) {
    throw new Error(`App scaffold module productEntry is missing: ${id}`);
  }
  if (!['ai-studio-core', 'ai-studio-module', 'component'].includes(productEntry.kind)) {
    throw new Error(`App scaffold module productEntry kind is invalid: ${id}`);
  }
  assertRelativePosixPath(productEntry.modulePath, `${id} productEntry modulePath`);
  if (!entry.sourceMappings.some((mapping) => (
    productEntry.modulePath === mapping.sourceRoot
    || productEntry.modulePath.startsWith(`${mapping.sourceRoot}/`)
  ))) {
    throw new Error(`App scaffold module productEntry is outside its source mappings: ${id}`);
  }
  const exportNames = productEntry.kind === 'ai-studio-module'
    ? [productEntry.registrationExport, productEntry.runtimeExport, productEntry.messageExport]
    : productEntry.kind === 'ai-studio-core'
      ? [productEntry.componentExport, productEntry.messageExport]
      : [productEntry.componentExport];
  if (exportNames.some((value) => typeof value !== 'string' || !/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(value))) {
    throw new Error(`App scaffold module productEntry export is invalid: ${id}`);
  }
  if (productEntry.identityProp !== undefined
    && (productEntry.kind !== 'component'
      || typeof productEntry.identityProp !== 'string'
      || !/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(productEntry.identityProp))) {
    throw new Error(`App scaffold module productEntry identity prop is invalid: ${id}`);
  }
}

function assertModuleEntry(id, entry, registry) {
  if (!entry || entry.id !== id) throw new Error(`App scaffold module registry id mismatch: ${id}`);
  if (!['feature', 'internal'].includes(entry.kind)) {
    throw new Error(`App scaffold module has invalid kind: ${id}`);
  }
  if (!Number.isSafeInteger(entry.order) || entry.order < 0) {
    throw new Error(`App scaffold module has invalid order: ${id}`);
  }
  if (entry.kind === 'feature') {
    if (!['candidate', 'admitted'].includes(entry.lifecycle)) {
      throw new Error(`App scaffold feature has invalid lifecycle: ${id}`);
    }
    if (typeof entry.label !== 'string' || !entry.label.trim()) {
      throw new Error(`App scaffold feature label is missing: ${id}`);
    }
  } else if (Object.hasOwn(entry, 'lifecycle')) {
    throw new Error(`App scaffold internal module cannot declare lifecycle: ${id}`);
  }
  assertUniqueStrings(entry.requires, `${id} requires`);
  assertUniqueStrings(entry.appAccessItems, `${id} appAccessItems`);
  assertUniqueStrings(entry.views, `${id} views`);
  assertUniqueStrings(entry.navigation, `${id} navigation`);
  assertUniqueStrings(entry.styles, `${id} styles`);
  assertUniqueStrings(entry.assets, `${id} assets`);
  if (entry.kind === 'internal' && entry.appAccessItems.length > 0) {
    throw new Error(`App scaffold internal module cannot declare App access: ${id}`);
  }
  if (!Array.isArray(entry.sourceMappings) || entry.sourceMappings.length === 0) {
    throw new Error(`App scaffold module sourceMappings are missing: ${id}`);
  }
  for (const mapping of entry.sourceMappings) {
    assertRelativePosixPath(mapping?.sourceRoot, `${id} sourceRoot`);
    assertRelativePosixPath(mapping?.targetRoot, `${id} targetRoot`);
  }
  for (const [kind, paths] of [['style', entry.styles], ['asset', entry.assets]]) {
    for (const itemPath of paths) {
      assertRelativePosixPath(itemPath, `${id} ${kind}`);
      if (!entry.sourceMappings.some((mapping) => (
        itemPath === mapping.sourceRoot || itemPath.startsWith(`${mapping.sourceRoot}/`)
      ))) {
        throw new Error(`App scaffold module ${kind} is outside its source mappings: ${id}: ${itemPath}`);
      }
    }
  }
  for (const dependency of entry.requires) {
    if (!Object.hasOwn(registry, dependency)) {
      throw new Error(`App scaffold module ${id} requires unknown module: ${dependency}`);
    }
  }
  for (const viewId of entry.navigation) {
    if (!entry.views.includes(viewId)) {
      throw new Error(`App scaffold module ${id} navigation references unknown view: ${viewId}`);
    }
  }
  if (!entry.npmDependencies || typeof entry.npmDependencies !== 'object' || Array.isArray(entry.npmDependencies)) {
    throw new Error(`App scaffold module npmDependencies are missing: ${id}`);
  }
  if (!entry.cargoDependencies || typeof entry.cargoDependencies !== 'object' || Array.isArray(entry.cargoDependencies)) {
    throw new Error(`App scaffold module cargoDependencies are missing: ${id}`);
  }
  for (const [name, version] of Object.entries(entry.npmDependencies)) {
    if (!name || name !== name.trim() || typeof version !== 'string' || !version.trim()) {
      throw new Error(`App scaffold module npm dependency is invalid: ${id}: ${name || 'missing'}`);
    }
    assertPublicNpmDependencyVersion(version, `${id}:${name}`);
  }
  for (const [name, value] of Object.entries(entry.cargoDependencies)) {
    if (!name || name !== name.trim() || value === undefined || value === null) {
      throw new Error(`App scaffold module Cargo dependency is invalid: ${id}: ${name || 'missing'}`);
    }
    assertCargoDependencyValue(value, `${id}:${name}`);
  }
  if (typeof entry.hostAdapterContract !== 'string' || !entry.hostAdapterContract.trim()) {
    throw new Error(`App scaffold module hostAdapterContract is missing: ${id}`);
  }
  assertProductEntry(id, entry);
}

export function validateAppScaffoldModuleRegistry(registry = APP_SCAFFOLD_MODULE_REGISTRY) {
  const orders = new Map();
  const sourceRoots = new Map();
  const targetRoots = new Map();
  const viewOwners = new Map();
  const navigationOwners = new Map();
  const styleOwners = new Map();
  const assetOwners = new Map();
  for (const [id, entry] of registryEntries(registry)) {
    assertModuleEntry(id, entry, registry);
    if (orders.has(entry.order)) {
      throw new Error(`App scaffold module order collision: ${orders.get(entry.order)} and ${id}`);
    }
    orders.set(entry.order, id);
    for (const mapping of entry.sourceMappings) {
      for (const [otherRoot, otherOwner] of sourceRoots) {
        if (pathsOverlap(mapping.sourceRoot, otherRoot)) {
          throw new Error(`App scaffold module source collision: ${otherOwner} and ${id}`);
        }
      }
      sourceRoots.set(mapping.sourceRoot, id);
      for (const [otherRoot, otherOwner] of targetRoots) {
        if (pathsOverlap(mapping.targetRoot, otherRoot)) {
          throw new Error(`App scaffold module target collision: ${otherOwner} and ${id}`);
        }
      }
      targetRoots.set(mapping.targetRoot, id);
    }
    for (const viewId of entry.views) {
      if (viewOwners.has(viewId)) {
        throw new Error(`App scaffold module view collision: ${viewOwners.get(viewId)} and ${id}: ${viewId}`);
      }
      viewOwners.set(viewId, id);
    }
    for (const navigationId of entry.navigation) {
      if (navigationOwners.has(navigationId)) {
        throw new Error(`App scaffold module navigation collision: ${navigationOwners.get(navigationId)} and ${id}: ${navigationId}`);
      }
      navigationOwners.set(navigationId, id);
    }
    for (const [value, owners, label] of [
      ...entry.styles.map((style) => [style, styleOwners, 'style']),
      ...entry.assets.map((asset) => [asset, assetOwners, 'asset']),
    ]) {
      for (const [otherPath, otherOwner] of owners) {
        if (pathsOverlap(value, otherPath)) {
          throw new Error(`App scaffold module ${label} collision: ${otherOwner} and ${id}: ${value}`);
        }
      }
      owners.set(value, id);
    }
  }
  return true;
}

function normalizeSelectionInput(input, { allowAll, requireArray }) {
  if (input === undefined || input === null || input === '') return [];
  if (requireArray && !Array.isArray(input)) {
    throw new Error('Candidate feature selection must be an explicit feature id array');
  }
  const source = Array.isArray(input) ? input : [input];
  if (requireArray && source.some((value) => typeof value !== 'string')) {
    throw new Error('Candidate feature selection must contain only feature id strings');
  }
  const values = source.flatMap((value) => (
    requireArray ? [String(value)] : String(value).split(',')
  ));
  const normalized = values.map((value) => value.trim());
  if (normalized.some((value) => value.length === 0)) {
    throw new Error('Feature selection contains an empty feature id');
  }
  if (normalized.includes('all')) {
    if (!allowAll) throw new Error('Candidate feature selection does not accept "all"');
    if (normalized.length !== 1) {
      throw new Error('Feature selection "all" cannot be combined with explicit feature ids');
    }
  }
  return normalized;
}

function resolveAppScaffoldGraph(input, registry, mode) {
  validateAppScaffoldModuleRegistry(registry);
  const ordered = registryEntries(registry);
  const admittedFeatureIds = ordered
    .filter(([, entry]) => entry.kind === 'feature' && entry.lifecycle === 'admitted')
    .map(([id]) => id);
  const normalized = normalizeSelectionInput(input, {
    allowAll: mode === 'public',
    requireArray: mode !== 'public',
  });
  const requested = normalized[0] === 'all'
    ? (() => {
        if (admittedFeatureIds.length === 0) {
          throw new Error('No app scaffold capabilities are currently admitted');
        }
        return admittedFeatureIds;
      })()
    : normalized;
  const requestedSet = new Set();
  for (const id of requested) {
    const entry = registry[id];
    if (!entry) throw new Error(`Unknown app scaffold feature: ${id}`);
    if (entry.kind === 'internal') {
      throw new Error(`App scaffold internal module cannot be selected directly: ${id}`);
    }
    if (mode === 'public' && entry.lifecycle !== 'admitted') {
      throw new Error(`App scaffold feature is not admitted: ${id}`);
    }
    requestedSet.add(id);
  }

  const visiting = new Set();
  const included = new Set();
  const visit = (id, lineage = []) => {
    if (included.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(`App scaffold module dependency cycle: ${[...lineage, id].join(' -> ')}`);
    }
    const entry = registry[id];
    if (!entry) {
      throw new Error(`App scaffold module dependency is unknown: ${[...lineage, id].join(' -> ')}`);
    }
    if (mode === 'public' && entry.kind === 'feature' && entry.lifecycle !== 'admitted') {
      throw new Error(`Admitted app scaffold feature depends on non-admitted feature: ${id}`);
    }
    visiting.add(id);
    for (const dependency of entry.requires) visit(dependency, [...lineage, id]);
    visiting.delete(id);
    included.add(id);
  };
  for (const id of requestedSet) visit(id);

  const directFeatureIds = ordered
    .map(([id]) => id)
    .filter((id) => requestedSet.has(id));
  const resolvedModuleIds = ordered
    .map(([id]) => id)
    .filter((id) => included.has(id));
  const resolvedFeatureIds = resolvedModuleIds.filter((id) => registry[id].kind === 'feature');
  if (mode === 'existing-intent') {
    if (JSON.stringify(requested) !== JSON.stringify(directFeatureIds)) {
      throw new Error('Existing scaffold intent directFeatures must be canonical registry order without duplicates');
    }
  }

  const appAccessItems = [];
  const appAccessSeen = new Set();
  const npmDependencies = {};
  const cargoDependencies = {};
  const views = [];
  const navigation = [];
  const styles = [];
  const assets = [];
  const hostAdapterContracts = [];
  const hostAdapterSeen = new Set();
  for (const id of resolvedFeatureIds) {
    const entry = registry[id];
    for (const item of entry.appAccessItems) {
      if (!appAccessSeen.has(item)) {
        appAccessSeen.add(item);
        appAccessItems.push(item);
      }
    }
  }
  for (const id of resolvedModuleIds) {
    const entry = registry[id];
    views.push(...entry.views);
    navigation.push(...entry.navigation);
    styles.push(...entry.styles.map((style) => targetPathForOwnedSource(entry, style)));
    assets.push(...entry.assets.map((asset) => targetPathForOwnedSource(entry, asset)));
    if (!hostAdapterSeen.has(entry.hostAdapterContract)) {
      hostAdapterSeen.add(entry.hostAdapterContract);
      hostAdapterContracts.push(entry.hostAdapterContract);
    }
    for (const [name, version] of Object.entries(entry.npmDependencies)) {
      if (Object.hasOwn(npmDependencies, name) && npmDependencies[name] !== version) {
        throw new Error(`App scaffold module dependency version collision for ${name}`);
      }
      npmDependencies[name] = version;
    }
    for (const [name, version] of Object.entries(entry.cargoDependencies)) {
      if (Object.hasOwn(cargoDependencies, name) && !dependencyValuesEqual(cargoDependencies[name], version)) {
        throw new Error(`App scaffold module Cargo dependency version collision for ${name}`);
      }
      cargoDependencies[name] = version;
    }
  }

  return Object.freeze({
    directFeatureIds: Object.freeze(directFeatureIds),
    resolvedFeatureIds: Object.freeze(resolvedFeatureIds),
    resolvedModuleIds: Object.freeze(resolvedModuleIds),
    modules: Object.freeze(resolvedModuleIds.map((id) => registry[id])),
    appAccessItems: Object.freeze(appAccessItems),
    npmDependencies: Object.freeze(npmDependencies),
    cargoDependencies: Object.freeze(cargoDependencies),
    views: Object.freeze(views),
    navigation: Object.freeze(navigation),
    styles: Object.freeze(styles),
    assets: Object.freeze(assets),
    hostAdapterContracts: Object.freeze(hostAdapterContracts),
  });
}

export function resolveAppScaffoldFeatures(input, registry = APP_SCAFFOLD_MODULE_REGISTRY) {
  return resolveAppScaffoldGraph(input, registry, 'public');
}

export function resolveAppScaffoldCandidateFeatures(input, registry = APP_SCAFFOLD_MODULE_REGISTRY) {
  return resolveAppScaffoldGraph(input, registry, 'candidate-validation');
}

export function resolveAppScaffoldIntentFeatures(input, registry = APP_SCAFFOLD_MODULE_REGISTRY) {
  if (
    !Array.isArray(input)
    || input.some((value) => typeof value !== 'string' || value !== value.trim() || value.includes(','))
  ) {
    throw new Error('Existing scaffold canonical resolved intent directFeatures must be a canonical feature id array');
  }
  return resolveAppScaffoldGraph(input, registry, 'existing-intent');
}

function resolveAdmittedModuleIds(registry) {
  validateAppScaffoldModuleRegistry(registry);
  const admittedFeatureIds = registryEntries(registry)
    .filter(([, entry]) => entry.kind === 'feature' && entry.lifecycle === 'admitted')
    .map(([id]) => id);
  if (admittedFeatureIds.length === 0) return Object.freeze([]);
  return resolveAppScaffoldGraph(admittedFeatureIds, registry, 'public').resolvedModuleIds;
}

export const APP_SCAFFOLD_FEATURE_IDS = Object.freeze(
  registryEntries(APP_SCAFFOLD_MODULE_REGISTRY)
    .filter(([, entry]) => entry.kind === 'feature' && entry.lifecycle === 'admitted')
    .map(([id]) => id),
);

export const APP_SCAFFOLD_ADMITTED_MODULE_IDS = resolveAdmittedModuleIds(
  APP_SCAFFOLD_MODULE_REGISTRY,
);
