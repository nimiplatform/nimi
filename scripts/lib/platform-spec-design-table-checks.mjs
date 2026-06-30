export function checkNimiDesignTables({
  cwd,
  definedRuleIds,
  designAdoptionTable,
  designAllowlistsTable,
  designCompositionsTable,
  designPrimitivesTable,
  designThemesTable,
  designTokensTable,
  fail,
  fs,
  path,
  read,
}) {
  const tokensRel = '.nimi/spec/platform/kernel/tables/nimi-ui-tokens.yaml';
  const primitivesRel = '.nimi/spec/platform/kernel/tables/nimi-ui-primitives.yaml';
  const themesRel = '.nimi/spec/platform/kernel/tables/nimi-ui-themes.yaml';
  const adoptionRel = '.nimi/spec/platform/kernel/tables/nimi-ui-adoption.yaml';
  const compositionsRel = '.nimi/spec/platform/kernel/tables/nimi-ui-compositions.yaml';
  const allowlistsRel = '.nimi/spec/platform/kernel/tables/nimi-ui-allowlists.yaml';

  const tokens = Array.isArray(designTokensTable?.tokens) ? designTokensTable.tokens : [];
  const allowedCategories = new Set([
    'surface',
    'text',
    'action',
    'overlay',
    'sidebar',
    'field',
    'status',
    'radius',
    'spacing',
    'typography',
    'stroke',
    'elevation',
    'motion',
    'z',
    'sizing',
    'border',
    'opacity',
    'focus',
    'scrollbar',
    'toggle',
    'material',
    'backdrop',
    'ambient',
  ]);
  const allowedThemeLayers = new Set(['foundation', 'accent']);
  const tokenIds = new Set();
  const accentTokenIds = new Set();
  for (const token of tokens) {
    const id = String(token?.id || '').trim();
    const category = String(token?.category || '').trim();
    const cssVar = String(token?.css_var || '').trim();
    const family = String(token?.primitive_family || '').trim();
    const source = String(token?.source_rule || '').trim();
    const themeLayer = String(token?.theme_layer || '').trim() || 'foundation';
    if (!id) fail(`${tokensRel}: token missing id`);
    if (tokenIds.has(id)) fail(`${tokensRel}: duplicate token id ${id}`);
    tokenIds.add(id);
    if (!allowedCategories.has(category)) fail(`${tokensRel}: ${id} has invalid category ${category}`);
    if (!cssVar.startsWith('--nimi-')) fail(`${tokensRel}: ${id} css_var must start with --nimi-`);
    if (!family) fail(`${tokensRel}: ${id} missing primitive_family`);
    if (!allowedThemeLayers.has(themeLayer)) fail(`${tokensRel}: ${id} has invalid theme_layer ${themeLayer}`);
    if (themeLayer === 'accent') accentTokenIds.add(id);
    if (!definedRuleIds.has(source)) fail(`${tokensRel}: ${id} references unknown source_rule ${source}`);
  }

  const primitives = Array.isArray(designPrimitivesTable?.primitives) ? designPrimitivesTable.primitives : [];
  for (const primitive of primitives) {
    const id = String(primitive?.id || '').trim();
    const family = String(primitive?.family || '').trim();
    const component = String(primitive?.component || '').trim();
    const source = String(primitive?.source_rule || '').trim();
    if (!id || !family || !component) fail(`${primitivesRel}: primitive rows require id, family, component`);
    const slotIds = new Set();
    for (const slot of Array.isArray(primitive?.slots) ? primitive.slots : []) {
      const slotId = String(slot?.id || '').trim();
      const className = String(slot?.class_name || '').trim();
      const selector = String(slot?.selector || '').trim();
      if (!slotId) fail(`${primitivesRel}: ${id} slots require id`);
      if (slotIds.has(slotId)) fail(`${primitivesRel}: ${id} duplicate slot id ${slotId}`);
      slotIds.add(slotId);
      if (!className && !selector) fail(`${primitivesRel}: ${id} slot ${slotId} requires class_name or selector`);
    }
    const classGroups = primitive?.class_groups && typeof primitive.class_groups === 'object' ? primitive.class_groups : {};
    for (const [groupId, entries] of Object.entries(classGroups)) {
      const groupEntries = Array.isArray(entries) ? entries : [];
      const seen = new Set();
      for (const entry of groupEntries) {
        const entryId = String(entry?.id || '').trim();
        const className = String(entry?.class_name || '').trim();
        const selector = String(entry?.selector || '').trim();
        if (!entryId) fail(`${primitivesRel}: ${id} class group ${groupId} entry missing id`);
        if (seen.has(entryId)) fail(`${primitivesRel}: ${id} class group ${groupId} duplicate entry ${entryId}`);
        seen.add(entryId);
        if (!className && !selector) fail(`${primitivesRel}: ${id} class group ${groupId} entry ${entryId} requires class_name or selector`);
      }
    }
    if (!definedRuleIds.has(source)) fail(`${primitivesRel}: ${id} references unknown source_rule ${source}`);
  }

  const themes = Array.isArray(designThemesTable?.packs) ? designThemesTable.packs : [];
  const themeCoverage = new Map();
  const themeKinds = new Map();
  for (const row of themes) {
    const themeId = String(row?.theme_id || '').trim();
    const packKind = String(row?.pack_kind || '').trim();
    const source = String(row?.source_rule || '').trim();
    const values = row?.values && typeof row.values === 'object' ? row.values : {};
    if (!themeId || !packKind) fail(`${themesRel}: theme packs require theme_id and pack_kind`);
    if (!allowedThemeLayers.has(packKind)) fail(`${themesRel}: ${themeId} has invalid pack_kind ${packKind}`);
    if (Array.isArray(row?.applies_to_apps) && row.applies_to_apps.length > 0) {
      fail(`${themesRel}: ${themeId} must not carry concrete app applicability; app usage belongs in app-local kit manifests`);
    }
    if (!definedRuleIds.has(source)) fail(`${themesRel}: ${themeId} references unknown source_rule ${source}`);
    if (!themeCoverage.has(themeId)) themeCoverage.set(themeId, new Set());
    for (const tokenId of Object.keys(values)) {
      if (!tokenIds.has(tokenId)) fail(`${themesRel}: ${themeId} references unknown token_id ${tokenId}`);
      themeCoverage.get(themeId).add(tokenId);
    }
    if (!themeKinds.has(themeId)) themeKinds.set(themeId, packKind);
    if (themeKinds.get(themeId) !== packKind) fail(`${themesRel}: ${themeId} mixes multiple pack_kind values`);
  }
  for (const [themeId, coverage] of themeCoverage) {
    const packKind = themeKinds.get(themeId);
    if (packKind === 'foundation') {
      for (const tokenId of tokenIds) {
        if (accentTokenIds.has(tokenId)) continue;
        if (!coverage.has(tokenId)) fail(`${themesRel}: foundation pack ${themeId} missing token ${tokenId}`);
      }
      continue;
    }
    for (const tokenId of accentTokenIds) {
      if (!coverage.has(tokenId)) fail(`${themesRel}: accent pack ${themeId} missing token ${tokenId}`);
    }
    for (const tokenId of coverage) {
      if (!accentTokenIds.has(tokenId)) fail(`${themesRel}: accent pack ${themeId} must not redefine foundation token ${tokenId}`);
    }
  }

  const modules = Array.isArray(designAdoptionTable?.modules) ? designAdoptionTable.modules : [];
  const platformCoreApps = new Set();
  for (const row of modules) {
    const id = String(row?.id || '').trim();
    const app = String(row?.app || '').trim();
    const relModule = String(row?.module || '').trim();
    const schemeSupport = Array.isArray(row?.scheme_support) ? row.scheme_support.map((item) => String(item || '').trim()).filter(Boolean) : [];
    const defaultScheme = String(row?.default_scheme || '').trim();
    const accentPack = String(row?.accent_pack || '').trim();
    const source = String(row?.source_rule || '').trim();
    if (!id || !relModule || !defaultScheme || !accentPack) fail(`${adoptionRel}: adoption rows require id, module, default_scheme, accent_pack`);
    if (app && !platformCoreApps.has(app)) fail(`${adoptionRel}: ${id} must move app ${app} adoption truth to the app-local kit manifest`);
    if (/^apps\//u.test(relModule)) fail(`${adoptionRel}: ${id} must not reference app module ${relModule}`);
    if (schemeSupport.length === 0) fail(`${adoptionRel}: ${id} must declare non-empty scheme_support`);
    if (!schemeSupport.every((scheme) => scheme === 'light' || scheme === 'dark')) fail(`${adoptionRel}: ${id} has invalid scheme_support values`);
    if (!schemeSupport.includes(defaultScheme)) fail(`${adoptionRel}: ${id} default_scheme must be included in scheme_support`);
    if (!themeCoverage.has(`nimi-${defaultScheme}`)) fail(`${adoptionRel}: ${id} references unknown foundation scheme nimi-${defaultScheme}`);
    if (themeKinds.get(accentPack) !== 'accent') fail(`${adoptionRel}: ${id} references unknown accent pack ${accentPack}`);
    if (!fs.existsSync(path.join(cwd, relModule))) fail(`${adoptionRel}: ${id} module does not exist ${relModule}`);
    if (!definedRuleIds.has(source)) fail(`${adoptionRel}: ${id} references unknown source_rule ${source}`);
  }

  const densityModes = Array.isArray(designCompositionsTable?.density_modes) ? designCompositionsTable.density_modes : [];
  const allowedDensityModeIds = new Set(['density.compact', 'density.regular', 'density.expressive']);
  for (const row of densityModes) {
    const id = String(row?.id || '').trim();
    const kind = String(row?.kind || '').trim();
    const title = String(row?.title || '').trim();
    const intent = String(row?.intent || '').trim();
    const source = String(row?.source_rule || '').trim();
    const useFor = Array.isArray(row?.use_for) ? row.use_for.map((item) => String(item || '').trim()).filter(Boolean) : [];
    const avoidFor = Array.isArray(row?.avoid_for) ? row.avoid_for.map((item) => String(item || '').trim()).filter(Boolean) : [];
    if (!id || !kind || !title || !intent) {
      fail(`${compositionsRel}: density mode rows require id, kind, title, intent`);
      continue;
    }
    if (!allowedDensityModeIds.has(id)) {
      fail(`${compositionsRel}: ${id} is not an admitted density mode id`);
    }
    if (kind !== 'density_mode') {
      fail(`${compositionsRel}: ${id} must declare kind density_mode`);
    }
    if (useFor.length === 0 || avoidFor.length === 0) {
      fail(`${compositionsRel}: ${id} must declare non-empty use_for and avoid_for guidance`);
    }
    if (!definedRuleIds.has(source)) fail(`${compositionsRel}: ${id} references unknown source_rule ${source}`);
  }

  const components = Array.isArray(designCompositionsTable?.components) ? designCompositionsTable.components : [];
  const allowedClassification = new Set(['thin_wrapper', 'app_owned_composition']);
  for (const row of components) {
    const id = String(row?.id || '').trim();
    const app = String(row?.app || '').trim();
    const relModule = String(row?.module || '').trim();
    const component = String(row?.component || '').trim();
    const classification = String(row?.classification || '').trim();
    const sharedTargets = Array.isArray(row?.shared_targets) ? row.shared_targets.map((item) => String(item || '').trim()).filter(Boolean) : [];
    const source = String(row?.source_rule || '').trim();
    if (!id || !app || !relModule || !component || !classification) {
      fail(`${compositionsRel}: composition rows require id, app, module, component, classification`);
      continue;
    }
    if (!platformCoreApps.has(app)) {
      fail(`${compositionsRel}: ${id} must move app ${app} composition truth to the app-local kit manifest`);
    }
    if (/^apps\//u.test(relModule)) {
      fail(`${compositionsRel}: ${id} must not reference app module ${relModule}`);
    }
    if (!allowedClassification.has(classification)) {
      fail(`${compositionsRel}: ${id} has invalid classification ${classification}`);
    }
    if (!fs.existsSync(path.join(cwd, relModule))) {
      fail(`${compositionsRel}: ${id} module does not exist ${relModule}`);
      continue;
    }
    const content = read(relModule);
    const componentPattern = new RegExp(`export\\s+(?:const|function)\\s+${component}\\b`, 'u');
    if (!componentPattern.test(content)) {
      fail(`${compositionsRel}: ${id} component ${component} not found in ${relModule}`);
    }
    if (classification === 'thin_wrapper' && sharedTargets.length === 0) {
      fail(`${compositionsRel}: ${id} thin_wrapper rows require non-empty shared_targets`);
    }
    if (classification === 'app_owned_composition' && sharedTargets.length > 0) {
      fail(`${compositionsRel}: ${id} app_owned_composition must not declare shared_targets`);
    }
    if (!definedRuleIds.has(source)) fail(`${compositionsRel}: ${id} references unknown source_rule ${source}`);
  }

  const allowlists = Array.isArray(designAllowlistsTable?.items) ? designAllowlistsTable.items : [];
  for (const item of allowlists) {
    const id = String(item?.id || '').trim();
    const pattern = String(item?.pattern || '').trim();
    const scope = String(item?.scope || '').trim();
    const source = String(item?.source_rule || '').trim();
    if (!id || !pattern || !scope) fail(`${allowlistsRel}: allowlist rows require id, pattern, scope`);
    if (/\bapps\/[^/\s]+/u.test(scope)) {
      fail(`${allowlistsRel}: ${id} must move app allowlist scope to the app-local kit manifest`);
    }
    if (!definedRuleIds.has(source)) fail(`${allowlistsRel}: ${id} references unknown source_rule ${source}`);
  }

  if (!tokenIds.has('motion.slow')) {
    fail(`${tokensRel}: toolkit token taxonomy must define motion.slow`);
  }
}
