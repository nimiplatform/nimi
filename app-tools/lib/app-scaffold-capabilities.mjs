// @nimi-authority: rule.nimi.platform.app-ecosystem.p-scaf-019c

const CAPABILITY_CATALOG = Object.freeze({
  'kit-recipes': Object.freeze({
    id: 'kit-recipes',
    label: 'Kit UI recipes',
    requires: Object.freeze([]),
    appAccessItems: Object.freeze([]),
    sourceRoot: 'src/lab/capabilities/kit-recipes',
    targetRoot: 'src/capabilities/kit-recipes',
    componentExport: 'KitRecipesCapability',
    npmDependencies: Object.freeze({}),
  }),
});

export const APP_SCAFFOLD_CAPABILITY_CATALOG = CAPABILITY_CATALOG;
export const APP_SCAFFOLD_FEATURE_IDS = Object.freeze(Object.keys(CAPABILITY_CATALOG));

function normalizeFeatureInput(input, featureIds = APP_SCAFFOLD_FEATURE_IDS) {
  if (input === undefined || input === null || input === '') return [];
  const source = Array.isArray(input) ? input : [input];
  const values = source.flatMap((value) => String(value).split(','));
  const normalized = values.map((value) => value.trim());
  if (normalized.some((value) => value.length === 0)) {
    throw new Error('Feature selection contains an empty feature id');
  }
  if (normalized.includes('all')) {
    if (normalized.length !== 1) {
      throw new Error('Feature selection "all" cannot be combined with explicit feature ids');
    }
    if (featureIds.length === 0) {
      throw new Error('No app scaffold capabilities are currently admitted');
    }
    return [...featureIds];
  }
  return normalized;
}

function assertCatalogEntry(id, entry, catalog) {
  if (!entry || entry.id !== id) throw new Error(`Capability catalog id mismatch: ${id}`);
  if (!Array.isArray(entry.requires) || !Array.isArray(entry.appAccessItems)) {
    throw new Error(`Capability catalog arrays are missing: ${id}`);
  }
  for (const dependency of entry.requires) {
    if (!Object.hasOwn(catalog, dependency)) {
      throw new Error(`Capability ${id} requires unknown feature: ${dependency}`);
    }
  }
  for (const field of ['sourceRoot', 'targetRoot', 'componentExport']) {
    const value = String(entry[field] || '');
    if (!value || value.startsWith('/') || value.includes('..') || value.includes('\\')) {
      throw new Error(`Capability ${id} has invalid ${field}: ${value || 'missing'}`);
    }
  }
}

export function validateAppScaffoldCapabilityCatalog(catalog = CAPABILITY_CATALOG) {
  const targetRoots = new Map();
  for (const [id, entry] of Object.entries(catalog)) {
    assertCatalogEntry(id, entry, catalog);
    for (const [otherRoot, otherId] of targetRoots) {
      if (
        entry.targetRoot === otherRoot
        || entry.targetRoot.startsWith(`${otherRoot}/`)
        || otherRoot.startsWith(`${entry.targetRoot}/`)
      ) {
        throw new Error(`Capability target collision: ${otherId} and ${id}`);
      }
    }
    targetRoots.set(entry.targetRoot, id);
  }
  return true;
}

export function resolveAppScaffoldFeatures(input, catalog = CAPABILITY_CATALOG) {
  validateAppScaffoldCapabilityCatalog(catalog);
  const requested = normalizeFeatureInput(input, Object.keys(catalog));
  const requestedSet = new Set();
  for (const id of requested) {
    if (!Object.hasOwn(catalog, id)) throw new Error(`Unknown app scaffold feature: ${id}`);
    requestedSet.add(id);
  }

  const visiting = new Set();
  const included = new Set();
  const visit = (id, lineage = []) => {
    if (included.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(`Capability dependency cycle: ${[...lineage, id].join(' -> ')}`);
    }
    visiting.add(id);
    for (const dependency of catalog[id].requires) visit(dependency, [...lineage, id]);
    visiting.delete(id);
    included.add(id);
  };
  for (const id of requestedSet) visit(id);

  const featureIds = Object.keys(catalog).filter((id) => included.has(id));
  const appAccessItems = [];
  const appAccessSeen = new Set();
  const npmDependencies = {};
  for (const id of featureIds) {
    const entry = catalog[id];
    for (const item of entry.appAccessItems) {
      if (!appAccessSeen.has(item)) {
        appAccessSeen.add(item);
        appAccessItems.push(item);
      }
    }
    for (const [name, version] of Object.entries(entry.npmDependencies || {})) {
      if (Object.hasOwn(npmDependencies, name) && npmDependencies[name] !== version) {
        throw new Error(`Capability dependency version collision for ${name}`);
      }
      npmDependencies[name] = version;
    }
  }

  return Object.freeze({
    featureIds: Object.freeze(featureIds),
    capabilities: Object.freeze(featureIds.map((id) => catalog[id])),
    appAccessItems: Object.freeze(appAccessItems),
    npmDependencies: Object.freeze(npmDependencies),
  });
}
