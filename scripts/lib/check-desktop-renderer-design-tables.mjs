import fs from 'node:fs';
import path from 'node:path';

import {
  fileExists,
  read,
  readYaml,
  sourceRoot,
} from './check-desktop-spec-kernel-consistency-shared.mjs';

export function checkRendererDesignTables(fail) {
  const rendererRoot = path.join(sourceRoot, 'shell/renderer');
  const tokensPath = '.nimi/spec/desktop/kernel/tables/renderer-design-tokens.yaml';
  const surfacesPath = '.nimi/spec/desktop/kernel/tables/renderer-design-surfaces.yaml';
  const sidebarsPath = '.nimi/spec/desktop/kernel/tables/renderer-design-sidebars.yaml';
  const overlaysPath = '.nimi/spec/desktop/kernel/tables/renderer-design-overlays.yaml';
  const allowlistsPath = '.nimi/spec/desktop/kernel/tables/renderer-design-allowlists.yaml';

  const allowedTokenCategories = new Set(['brand', 'surface', 'text', 'radius', 'elevation', 'z', 'motion', 'typography', 'spacing', 'stroke', 'state']);
  const allowedSurfaceProfiles = new Set(['baseline', 'secondary', 'exception']);
  const allowedSidebarFamily = new Set(['desktop-sidebar-v1']);
  const allowedSidebarItemKinds = new Set(['entity-row', 'category-row', 'nav-row']);
  const allowedExceptionPolicies = new Set(['none', 'allowlisted_arbitrary', 'controlled']);
  const allowedOverlayKinds = new Set(['dialog', 'drawer', 'popover', 'tooltip']);
  const allowedSurfaceTones = new Set(['canvas', 'panel', 'card', 'hero', 'overlay']);
  const allowedElevations = new Set(['base', 'raised', 'floating', 'modal']);
  const allowedPatternTypes = new Set(['raw_color', 'token_bypass', 'class_pattern', 'inline_style', 'overlay_local_shell']);

  const tokensDoc = readYaml(tokensPath) || {};
  const tokens = Array.isArray(tokensDoc?.tokens) ? tokensDoc.tokens : [];
  if (tokens.length === 0) {
    fail(`${tokensPath} must define at least one token row`);
  }
  for (const item of tokens) {
    const id = String(item?.id || '').trim();
    const category = String(item?.category || '').trim();
    const name = String(item?.name || '').trim();
    const cssVar = String(item?.css_var || '').trim();
    const alias = String(item?.tailwind_alias || '').trim();
    const scope = String(item?.scope || '').trim();
    if (!id || !category || !name || !cssVar || !alias || !scope) {
      fail(`${tokensPath} token rows require id/category/name/css_var/tailwind_alias/scope`);
      continue;
    }
    if (!allowedTokenCategories.has(category)) {
      fail(`${tokensPath} token ${id} has invalid category: ${category}`);
    }
  }

  const surfacesDoc = readYaml(surfacesPath) || {};
  const surfaces = Array.isArray(surfacesDoc?.surfaces) ? surfacesDoc.surfaces : [];
  if (surfaces.length === 0) {
    fail(`${surfacesPath} must define at least one surface row`);
  }
  const baselineModules = new Set();
  let hasWorldException = false;
  for (const item of surfaces) {
    const id = String(item?.id || '').trim();
    const module = String(item?.module || '').trim();
    const role = String(item?.role || '').trim();
    const profile = String(item?.surface_profile || '').trim();
    const exceptionPolicy = String(item?.exception_policy || '').trim();
    if (!id || !module || !role || !profile || !exceptionPolicy) {
      fail(`${surfacesPath} surface rows require id/module/role/surface_profile/exception_policy`);
      continue;
    }
    if (!allowedSurfaceProfiles.has(profile)) {
      fail(`${surfacesPath} surface ${id} has invalid surface_profile: ${profile}`);
    }
    if (!allowedExceptionPolicies.has(exceptionPolicy)) {
      fail(`${surfacesPath} surface ${id} has invalid exception_policy: ${exceptionPolicy}`);
    }
    if (typeof item?.testid_required !== 'boolean') {
      fail(`${surfacesPath} surface ${id} must declare boolean testid_required`);
    }
    if (!fs.existsSync(path.join(rendererRoot, module))) {
      fail(`${surfacesPath} surface ${id} module does not exist under renderer root: ${module}`);
    }
    if (profile === 'baseline') {
      baselineModules.add(module);
    }
    if (profile === 'exception' && module.includes('world-detail')) {
      hasWorldException = true;
    }
  }
  for (const requiredModule of ['features/chat/chat-page.tsx', 'features/explore/explore-view.tsx']) {
    if (!baselineModules.has(requiredModule)) {
      fail(`${surfacesPath} missing baseline module: ${requiredModule}`);
    }
  }
  if (!hasWorldException) {
    fail(`${surfacesPath} must declare a controlled world-detail exception row`);
  }

  const requiredSecondaryDomains = new Map([
    ['.nimi/spec/desktop/home.md', 'features/home/'],
    ['.nimi/spec/desktop/notification.md', 'features/notification/'],
    ['.nimi/spec/desktop/profile.md', 'features/profile/'],
  ]);
  for (const [docRel, modulePrefix] of requiredSecondaryDomains) {
    if (!fileExists(docRel)) {
      continue;
    }
    const docContent = read(docRel);
    if (!docContent.includes('secondary consumer')) {
      continue;
    }
    const hasRegisteredSurface = surfaces.some((item) => String(item?.surface_profile || '').trim() === 'secondary'
      && String(item?.module || '').trim().startsWith(modulePrefix));
    if (!hasRegisteredSurface) {
      fail(`${surfacesPath} must register at least one secondary surface for ${docRel}`);
    }
  }

  const sidebarsDoc = readYaml(sidebarsPath) || {};
  const sidebars = Array.isArray(sidebarsDoc?.sidebars) ? sidebarsDoc.sidebars : [];
  if (sidebars.length === 0) {
    fail(`${sidebarsPath} must define at least one sidebar row`);
  }
  const requiredSidebarModules = new Set([
    'features/runtime-config/runtime-config-panel-view.tsx',
    'features/settings/settings-panel-body.tsx',
  ]);
  const registeredSidebarModules = new Set();
  for (const item of sidebars) {
    const id = String(item?.id || '').trim();
    const module = String(item?.module || '').trim();
    const surfaceProfile = String(item?.surface_profile || '').trim();
    const family = String(item?.family || '').trim();
    const itemKinds = Array.isArray(item?.item_kinds) ? item.item_kinds : [];
    if (!id || !module || !surfaceProfile || !family) {
      fail(`${sidebarsPath} sidebar rows require id/module/surface_profile/family`);
      continue;
    }
    if (!allowedSurfaceProfiles.has(surfaceProfile) || surfaceProfile === 'exception') {
      fail(`${sidebarsPath} sidebar ${id} has invalid surface_profile: ${surfaceProfile}`);
    }
    if (!allowedSidebarFamily.has(family)) {
      fail(`${sidebarsPath} sidebar ${id} has invalid family: ${family}`);
    }
    if (itemKinds.length === 0) {
      fail(`${sidebarsPath} sidebar ${id} must declare non-empty item_kinds`);
    }
    for (const itemKind of itemKinds) {
      if (!allowedSidebarItemKinds.has(String(itemKind).trim())) {
        fail(`${sidebarsPath} sidebar ${id} has invalid item_kinds entry: ${String(itemKind).trim()}`);
      }
    }
    for (const boolField of ['has_search', 'has_primary_action', 'has_sections', 'has_resize_handle', 'testid_required']) {
      if (typeof item?.[boolField] !== 'boolean') {
        fail(`${sidebarsPath} sidebar ${id} must declare boolean ${boolField}`);
      }
    }
    const modulePath = path.join(rendererRoot, module);
    if (!fs.existsSync(modulePath)) {
      fail(`${sidebarsPath} sidebar ${id} module does not exist under renderer root: ${module}`);
      continue;
    }
    registeredSidebarModules.add(module);
    const sidebarSource = fs.readFileSync(modulePath, 'utf8');
    if (item?.testid_required === true && !(/data-testid=/u.test(sidebarSource) || /E2E_IDS\./u.test(sidebarSource))) {
      fail(`${sidebarsPath} sidebar ${id} testid_required=true but module lacks stable testability markup: ${module}`);
    }
  }
  for (const module of requiredSidebarModules) {
    if (!registeredSidebarModules.has(module)) {
      fail(`${sidebarsPath} missing governed sidebar module: ${module}`);
    }
  }

  const overlaysDoc = readYaml(overlaysPath) || {};
  const overlays = Array.isArray(overlaysDoc?.overlays) ? overlaysDoc.overlays : [];
  if (overlays.length === 0) {
    fail(`${overlaysPath} must define at least one overlay row`);
  }
  for (const item of overlays) {
    const id = String(item?.id || '').trim();
    const module = String(item?.module || '').trim();
    const kind = String(item?.kind || '').trim();
    const tone = String(item?.surface_tone || '').trim();
    const elevation = String(item?.elevation || '').trim();
    const zToken = String(item?.z_token || '').trim();
    if (!id || !module || !kind || !tone || !elevation || !zToken) {
      fail(`${overlaysPath} overlay rows require id/module/kind/surface_tone/elevation/z_token`);
      continue;
    }
    if (!allowedOverlayKinds.has(kind)) {
      fail(`${overlaysPath} overlay ${id} has invalid kind: ${kind}`);
    }
    if (!allowedSurfaceTones.has(tone)) {
      fail(`${overlaysPath} overlay ${id} has invalid surface_tone: ${tone}`);
    }
    if (!allowedElevations.has(elevation)) {
      fail(`${overlaysPath} overlay ${id} has invalid elevation: ${elevation}`);
    }
    const overlayModulePath = path.join(rendererRoot, module);
    if (!fs.existsSync(overlayModulePath)) {
      fail(`${overlaysPath} overlay ${id} module does not exist under renderer root: ${module}`);
      continue;
    }
    const overlaySource = fs.readFileSync(overlayModulePath, 'utf8');
    if (!/(?:components\/overlay\.js|\.\/overlay\.js|@nimiplatform\/nimi-ui|@nimiplatform\/nimi-kit\/ui)/.test(overlaySource)) {
      fail(`${overlaysPath} overlay ${id} module must import shared overlay authority: ${module}`);
    }
    if (typeof item?.testid_required !== 'boolean') {
      fail(`${overlaysPath} overlay ${id} must declare boolean testid_required`);
    }
    if (typeof item?.reduced_motion !== 'boolean') {
      fail(`${overlaysPath} overlay ${id} must declare boolean reduced_motion`);
    }
    if (item?.testid_required === true && !(/data-testid=/u.test(overlaySource) || /E2E_IDS\./u.test(overlaySource))) {
      fail(`${overlaysPath} overlay ${id} testid_required=true but module lacks stable testability markup: ${module}`);
    }
  }

  for (const item of surfaces) {
    const module = String(item?.module || '').trim();
    if (!module || item?.testid_required !== true) {
      continue;
    }
    const surfaceSource = fs.readFileSync(path.join(rendererRoot, module), 'utf8');
    if (!(/data-testid=/u.test(surfaceSource) || /E2E_IDS\./u.test(surfaceSource))) {
      fail(`${surfacesPath} surface ${String(item?.id || '').trim()} testid_required=true but module lacks stable testability markup: ${module}`);
    }
  }

  const allowlistsDoc = readYaml(allowlistsPath) || {};
  const patterns = Array.isArray(allowlistsDoc?.patterns) ? allowlistsDoc.patterns : [];
  if (patterns.length === 0) {
    fail(`${allowlistsPath} must define at least one allowlist row`);
  }
  for (const item of patterns) {
    const id = String(item?.id || '').trim();
    const patternType = String(item?.pattern_type || '').trim();
    const pattern = String(item?.pattern || '').trim();
    const scope = String(item?.scope || '').trim();
    const reason = String(item?.reason || '').trim();
    if (!id || !patternType || !pattern || !scope || !reason) {
      fail(`${allowlistsPath} allowlist rows require id/pattern_type/pattern/scope/reason`);
      continue;
    }
    if (!allowedPatternTypes.has(patternType)) {
      fail(`${allowlistsPath} allowlist ${id} has invalid pattern_type: ${patternType}`);
    }
    if (!fileExists(scope)) {
      fail(`${allowlistsPath} allowlist ${id} scope path does not exist: ${scope}`);
    }
  }
}
