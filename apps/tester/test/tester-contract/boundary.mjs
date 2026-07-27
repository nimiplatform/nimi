import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  RUNTIME_EXECUTION_MODE_STREAM,
  RUNTIME_EXECUTION_MODE_SYNC,
  RUNTIME_ROUTE_POLICY_CLOUD,
  RUNTIME_ROUTE_POLICY_LOCAL,
  RUNTIME_SCENARIO_TYPE_TEXT_EMBED,
  RUNTIME_SCENARIO_TYPE_TEXT_GENERATE,
  RUNTIME_SCHEDULING_DENIED,
  cleanupBehaviorModules,
  createMemoryStorage,
  importBehaviorModule,
  listSourceFiles,
  read,
  readTesterAiTestingSurface,
  readTesterKitComponentGallerySurface,
  root,
  runnableSchedulingResponse,
  textEmbedScenarioResponse,
  textGenerateScenarioResponse,
  textScenarioStream,
} from './helpers.mjs';

test.after(cleanupBehaviorModules);

test('tester workbench is app-owned and rejects Desktop private imports', () => {
  const sources = listSourceFiles(path.join(root, 'src')).map((filePath) => readFileSync(filePath, 'utf8')).join('\n');
  assert.match(sources, /TesterWorkbench/);
  assert.match(sources, /KitComponentGallery/);
  assert.match(sources, /typed unavailable/i);
  assert.doesNotMatch(sources, /from ['"]@renderer\//);
  assert.doesNotMatch(sources, /from ['"]@runtime\//);
  assert.doesNotMatch(sources, /getDesktopAIConfigService/);
  assert.doesNotMatch(sources, /runtime-config-profile-library/);
  assert.doesNotMatch(sources, /mock.*success/i);
  assert.doesNotMatch(sources, /pseudo/i);
});

test('tester workbench lazy-loads secondary routes instead of pinning them in the first route bundle', () => {
  const workbench = read('src/tester/tester-workbench.tsx');
  assert.match(workbench, /lazy\(async \(\) => \(\{/);
  assert.match(workbench, /import\('\.\.\/shell\/routes\/settings-route\.js'\)/);
  assert.match(workbench, /import\('\.\/kit-component-gallery\.js'\)/);
  assert.doesNotMatch(workbench, /import \{ SettingsRoute \} from '\.\.\/shell\/routes\/settings-route\.js';/);
  assert.doesNotMatch(workbench, /import \{ KitComponentGallery \} from '\.\/kit-component-gallery\.js';/);
});

test('tester auth and runtime bootstrap consume Kit shell bridge primitives', () => {
  const main = read('src/main.tsx');
  const runtimePlatform = read('src/shell/auth/runtime-platform.ts');
  const localAppClient = read('src/shell/local-app-runtime-platform.ts');

  assert.match(main, /installNimiShellRuntimeBridge/);
  assert.match(main, /from '@nimiplatform\/kit\/shell\/renderer\/bridge'/);
  assert.match(main, /rendererRoot\.classList\.add\('nimi-ui-module--tester'\)/);
  assert.match(main, /overlayRoot\.classList\.add\('nimi-ui-module--tester'\)/);
  assert.match(localAppClient, /createNimiClient/);
  assert.match(localAppClient, /createNimiLocalAppStandardShellSurface/);
  assert.match(runtimePlatform, /runtimeAccountLoginEnabled = false/);
  assert.match(runtimePlatform, /mode: 'local-app'/);
  assert.match(runtimePlatform, /testerLocalAppClient\.auth\.status\(\)/);
  assert.match(runtimePlatform, /status\.sessionBound/);
  assert.doesNotMatch(runtimePlatform, /readonly client:|readonly auth:/);
  assert.doesNotMatch(runtimePlatform, /createNimi(?:DeveloperRegistered|LocalFirstParty)RuntimeAccountCaller/);
  assert.doesNotMatch(runtimePlatform, /createNimiRuntimeFullAppRegistration|createNimiRuntimeAppSessionMetadataProvider/);
  assert.doesNotMatch(runtimePlatform, /new Runtime|new Realm|createRuntimeAccountMediatedRealmTransport/);
  assert.doesNotMatch(runtimePlatform, /developerRegistration|local-developer|getAccessToken|refreshAccountSession/);
});

test('tester app-private storage uses the final local-app SDK and Kit carrier', () => {
  const runtimePlatform = read('src/shell/auth/runtime-platform.ts');
  const client = read('src/shell/local-app-runtime-platform.ts');

  assert.match(runtimePlatform, /testerLocalAppClient\.auth\.status/);
  assert.match(client, /createNimiClient/);
  assert.doesNotMatch(client, /artifacts\.readRuntimeBytes|agentInventory|openConversation/);
  assert.match(client, /createNimiClient/);
  assert.doesNotMatch(runtimePlatform, /client\.runtime|new Runtime|runtimeEndpoint/);
  for (const retired of [
    'src/tester/tester-runtime-invokers.ts',
    'src/tester/tester-runtime-invokers-core.ts',
    'src/tester/tester-runtime-invokers-media.ts',
  ]) {
    assert.equal(existsSync(path.join(root, retired)), false, `${retired} must stay hardcut`);
  }
});

test('tester visible product identity hard-cuts to Nimi Lab', () => {
  const appIdentity = read('src/shell/auth/app-identity.ts');
  const productArea = read('src/shell/routes/product-area.tsx');
  const devPreview = read('src/dev-preview.tsx');
  const tauriConfig = read('src-tauri/tauri.conf.json');
  const rustMain = read('src-tauri/src/main.rs');
  const indexHtml = read('index.html');
  const devPreviewHtml = read('dev-preview.html');
  const appManifest = read('nimi.app.yaml');
  const sideNav = read('src/tester/workbench/workbench-side-nav.tsx');
  const styles = read('src/tester/tester-workbench.css');
  const workbench = read('src/tester/tester-workbench.tsx');

  assert.match(appIdentity, /export const appTitle = 'Nimi Lab'/);
  assert.match(productArea, /<TesterWorkbench title="Nimi Lab" \/>/);
  assert.match(devPreview, /<TesterWorkbench title="Nimi Lab" \/>/);
  assert.match(tauriConfig, /"productName": "Nimi Lab"/);
  assert.match(tauriConfig, /"title": "Nimi Lab"/);
  assert.match(indexHtml, /<title>Nimi Lab<\/title>/);
  assert.match(devPreviewHtml, /<title>Nimi Lab · Dev Preview<\/title>/);
  assert.match(appManifest, /display_name: Nimi Lab/);
  assert.match(rustMain, /failed to run Nimi Lab shell/);
  assert.match(sideNav, /aria-label="Nimi Lab workspace navigation"/);
  assert.match(styles, /aside\[aria-label="Nimi Lab workspace navigation"\]/);
  assert.doesNotMatch(workbench, /workbench-topbar__brand/);
  assert.doesNotMatch(styles, /workbench-topbar__brand/);
  for (const source of [
    appIdentity,
    productArea,
    devPreview,
    tauriConfig,
    rustMain,
    indexHtml,
    devPreviewHtml,
    appManifest,
    sideNav,
    styles,
    workbench,
  ]) {
    assert.doesNotMatch(source, /Nimi Tester|Nimi App Lab/);
  }
});

test('tester left rail keeps compact icon spacing and solid green active state', () => {
  const styles = read('src/tester/tester-workbench.css');

  assert.match(styles, /aside\[aria-label="Nimi Lab workspace navigation"\]\{[^}]*padding: 24px 14px 18px/);
  assert.match(styles, /@container nimi-ui-module-tester-surface \(max-width: 720px\)\{[^}]*grid-template-columns: 48px minmax\(0, 1fr\)/);
  assert.match(styles, /@container nimi-ui-module-tester-surface \(max-width: 720px\)[\s\S]*?aside\[aria-label="Nimi Lab workspace navigation"\]\{ display: grid; width: 48px;/);
  assert.doesNotMatch(styles, /aside\[aria-label="Nimi Lab workspace navigation"\]\{ display: none;/);
  assert.match(styles, /aside\[aria-label="Nimi Lab workspace navigation"\] nav\{[^}]*gap: 8px/);
  assert.match(styles, /aside\[aria-label="Nimi Lab workspace navigation"\] ul\{[^}]*gap: 8px/);
  assert.match(styles, /\[data-nav-placement="bottom"\]\{ margin-top: auto;/);
  assert.match(styles, /\[data-workbench-rail-item\]\[aria-current="page"\],[^{}]*\[data-workbench-account-trigger\]\[data-open="true"\]\{[^}]*background: var\(--nimi-action-primary-bg\);[^}]*color: var\(--nimi-action-primary-text\);/);
  assert.doesNotMatch(styles, /\[data-workbench-rail-item\]\[aria-current="page"\],[^{}]*\[data-workbench-account-trigger\]\[data-open="true"\]\{[^}]*rgba\(201,\s*246,\s*238/);
  assert.doesNotMatch(styles, /\[data-workbench-rail-item\]\[aria-current="page"\],[^{}]*\[data-workbench-account-trigger\]\[data-open="true"\]\{[^}]*inset 0 0 0 1px/);
});

test('tester left rail anchors UI Recipes above the framed account avatar', () => {
  const sideNav = read('src/tester/workbench/workbench-side-nav.tsx');
  const accountPanel = read('src/shell/account/account-panel.tsx');
  const styles = read('src/tester/tester-workbench.css');
  const bottomGroup = sideNav.match(/<div className="workbench-side-nav__group" data-nav-placement="bottom">[\s\S]*?<\/div>\s*<\/nav>/)?.[0] ?? '';

  assert.match(sideNav, /workbenchLibraryCapabilityId[\s\S]*data-nav-placement="bottom"/);
  assert.doesNotMatch(bottomGroup, /workbenchLibraryCapabilityId|<Compass/);
  assert.match(bottomGroup, /aria-label="UI Recipes"[\s\S]*\{accountSlot/);
  assert.match(styles, /\.workbench\{[^}]*--nimi-ui-module-tester-account-avatar-size: 28px;/);
  assert.match(styles, /\[data-workbench-account-root\]\{[^}]*align-self: end;[^}]*border-radius: 999px;/);
  assert.match(styles, /\[data-workbench-account-trigger\]\{[^}]*border-radius: 999px;[^}]*background: transparent;[^}]*box-shadow: none;/);
  assert.match(accountPanel, /className="lab-account-menu__avatar-glyph"/);
  assert.match(styles, /\[data-workbench-account-trigger\] \.nimi-action__icon\{[^}]*width: var\(--nimi-ui-module-tester-account-avatar-size\);[^}]*height: var\(--nimi-ui-module-tester-account-avatar-size\);/);
  assert.match(styles, /\.lab-account-menu__avatar-glyph\{[^}]*width: var\(--nimi-ui-module-tester-account-avatar-size\);[^}]*height: var\(--nimi-ui-module-tester-account-avatar-size\);[^}]*box-shadow: inset 0 0 0 1px/);
});

test('tester account menu consumes the shared Kit AccountPanel without owning Runtime logout truth', () => {
  const accountPanel = read('src/shell/account/account-panel.tsx');
  const workbench = read('src/tester/tester-workbench.tsx');
  const sideNav = read('src/tester/workbench/workbench-side-nav.tsx');

  assert.match(accountPanel, /from '@nimiplatform\/kit\/ui'/);
  assert.doesNotMatch(accountPanel, /RuntimeLoginPage|loginOpen|handleOpenLogin/);
  assert.match(accountPanel, /AccountPanel/);
  for (const label of ['Identity protected by Nimi Desktop', 'Open Nimi Desktop', 'Nimi Lab Settings']) {
    assert.match(accountPanel, new RegExp(label));
  }
  assert.match(accountPanel, /disabled:\s*true/);
  assert.doesNotMatch(accountPanel, /Log out|Logging out/);
  for (const desktopOnly of [
    'Profile',
    'Wallet',
    'Support',
    'Developer Tools',
    'Terms of Service',
    'Privacy Policy',
    'Edit profile',
  ]) {
    assert.doesNotMatch(accountPanel, new RegExp(desktopOnly));
  }
  assert.match(accountPanel, /projection\.localAppSession/);
  assert.doesNotMatch(accountPanel, /subjectUserId|projection\.auth/);
  assert.doesNotMatch(accountPanel, /runtime\.account|getRuntimeAccountCaller|loadRuntimeAccountUser/);
  assert.doesNotMatch(accountPanel, /logoutRuntimeAccount|handleLogout|handleLoginComplete/);
  assert.doesNotMatch(accountPanel, /setLoginOpen\(true\)|handleOpenLogin/);
  assert.doesNotMatch(accountPanel, /localStorage\.removeItem|sessionStorage\.removeItem|getAccessToken|refreshAccountSession/);
  assert.match(workbench, /accountSlot=\{\(\s*<NimiLabAccountMenu[\s\S]*onOpenSettings=\{\(\) => setView\(\{ kind: 'settings' \}\)\}/);
  assert.match(sideNav, /accountSlot\?: ReactNode/);
  assert.match(sideNav, /data-nav-placement="bottom"[\s\S]*\{accountSlot/);
  const headerActionsSource = workbench.match(/headerActions=\{\([\s\S]*?\)\}/)?.[0] ?? '';
  assert.doesNotMatch(headerActionsSource, /NimiLabAccountMenu/);
});

test('tester runtime unavailable flow consumes Kit offline coordinator', () => {
  const authGate = read('src/shell/auth/auth-gate.tsx');
  const unavailablePage = read('src/shell/auth/runtime-unavailable-page.tsx');

  assert.match(authGate, /from '@nimiplatform\/kit\/core\/offline-coordinator'/);
  assert.match(authGate, /new OfflineCoordinator\(\)/);
  assert.match(authGate, /markRuntimeReachability\('unreachable'\)/);
  assert.match(authGate, /markRuntimeReachability\('reachable'\)/);
  assert.match(unavailablePage, /Protection state: offline tier \{offlineTier\}/);
  assert.match(unavailablePage, /Open Nimi Desktop, confirm Runtime is available, then retry\./);
  assert.doesNotMatch(unavailablePage, />\{projection\?\.actionHint\}</);
});

test('tester kit gallery showcases real kit components for local apps', () => {
  const gallery = readTesterKitComponentGallerySurface(root);
  for (const required of [
    'Button',
    'IconButton',
    'AppCardSurface',
    'CompactAction',
    'IconToggleAction',
    'FieldTrigger',
    'ScrollShell',
    'TextField',
    'TextareaField',
    'SelectField',
    'Toggle',
    'Checkbox',
    'Slider',
    'SegmentedControl',
    'ProgressIndicator',
    'InlineAlert',
    'StatusBadge',
    'Surface',
    'EmptyState',
    'LoadingSkeleton',
    'NimiText',
    'DataTable',
    'DataList',
    'Pagination',
    'Breadcrumb',
    'Steps',
    'Statistic',
    'StatisticGroup',
  ]) {
    assert.match(gallery, new RegExp(`\\b${required}\\b`));
  }
  // Components are consumed from the kit design authority, not re-implemented.
  assert.match(gallery, /from '@nimiplatform\/kit\/ui'/);
});

test('tester UI Recipes is an industrial two-pane kit component workbench', () => {
  const gallery = readTesterKitComponentGallerySurface(root);
  const galleryEntry = read('src/tester/kit-component-gallery.tsx');
  // Ontology taxonomy: seven canonical categories.
  for (const category of ['Foundations', 'Actions', 'Inputs', 'Selection', 'Overlays', 'Layouts', 'Data & Status']) {
    assert.match(gallery, new RegExp(category));
  }
  assert.doesNotMatch(galleryEntry, /categoryDescriptions/);
  assert.doesNotMatch(galleryEntry, /\{countFor\(category\)\} recipes/);
  for (const subtitle of [
    'Theme tokens, type roles and spacing primitives for stable app shells.',
    'Reusable actions for command surfaces, compact controls and icon-only tools.',
    'Field patterns for bounded user input, route selection and numeric controls.',
    'Stateful selection controls with caller-owned labels and controlled state.',
    'Reusable overlay interaction patterns for dialogs, drawers, popovers and tooltips.',
    'Navigation and structure recipes for dense product workflows.',
    'Status, table and summary patterns for operational app surfaces.',
  ]) {
    assert.doesNotMatch(galleryEntry, new RegExp(subtitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(galleryEntry, /Grid2X2|>\s*Grid\s*</);
  // Foundations show real color tokens + text roles without locking explanatory subtitles.
  assert.match(gallery, /Color roles/);
  assert.match(gallery, /--nimi-action-primary-bg/);
  assert.match(gallery, /Text roles/);
  assert.match(gallery, /NimiText/);
  // Glass material tiers are demonstrated.
  for (const tier of ['glass-thin', 'glass-regular', 'glass-thick', 'glass-chrome']) {
    assert.match(gallery, new RegExp(tier));
  }
  // Ant Design reference coverage: enterprise data display and navigation
  // primitives are first-class Kit recipes, not app-local widgets.
  for (const recipe of [
    'Breadcrumb, Steps, Pagination',
    'Statistic summary',
    'DataList',
    'DataTable',
  ]) {
    assert.match(gallery, new RegExp(recipe));
  }
  // Two-pane structure: taxonomy library + shared inspector workspace.
  assert.match(gallery, /kit-doc__library/);
  assert.match(gallery, /kit-doc__main/);
  assert.match(gallery, /kit-doc__canvas/);
  assert.match(galleryEntry, /grid-cols-\[260px_minmax\(0,1fr\)\]/);
  assert.doesNotMatch(galleryEntry, /grid-cols-\[300px_minmax\(0,1fr\)\]/);
  assert.match(galleryEntry, /kit-doc__library[^"]*h-\[calc\(100cqh-2rem\)\]/);
  assert.doesNotMatch(galleryEntry, /kit-doc__library[^"]*max-h-\[calc\(100cqh-2rem\)\][^"]*self-start/);
  assert.match(gallery, /RecipeWorkspace/);
  assert.match(gallery, /Recipe Inspector/);
  assert.match(gallery, /Copy selected recipe/);
  assert.doesNotMatch(gallery, /kit-card__tabs/);
  assert.doesNotMatch(gallery, /RecipeModeContent/);
  assert.doesNotMatch(gallery, /RecipeCards/);
  assert.match(gallery, />Use</);
  assert.match(gallery, /Key props/);
  assert.match(gallery, />Access</);
  assert.match(gallery, /Design tokens/);
  assert.doesNotMatch(gallery, /label: 'Live'|label: 'Code'|label: 'Props'|label: 'A11y'|label: 'Tokens'/);
  assert.doesNotMatch(gallery, /options=\{lanes\}|onChange=\{\.\.\.\}|value=\{n\}|\{rows\}|<Button \/>|title message confirmLabel/);
  assert.doesNotMatch(gallery, /kit-doc__modebar|kit-doc__modetabs|kit-doc__import|kit-doc__evidence|Selected recipe|Coverage map/);
  assert.match(galleryEntry, /kit-tax--active[^']*border-transparent[^']*bg-\[var\(--nimi-sidebar-item-active\)\][^']*text-\[var\(--nimi-text-primary\)\]/);
  assert.doesNotMatch(galleryEntry, /kit-tax--active[^']*border-\[var\(--nimi-border-strong\)\]/);
  assert.match(galleryEntry, /hover:bg-\[var\(--nimi-sidebar-item-hover\)\] hover:text-\[var\(--nimi-text-primary\)\]/);
  assert.match(galleryEntry, /kit-tax__symbol[^`]*isActive \? 'border-\[color-mix\(in_srgb,var\(--nimi-action-primary-bg\)_34%,transparent\)\] bg-\[var\(--nimi-surface-active\)\] text-\[var\(--nimi-action-primary-bg\)\]/);
  assert.match(galleryEntry, /isActive \? 'bg-\[var\(--nimi-surface-active\)\] text-\[var\(--nimi-action-primary-bg\)\]' : 'bg-\[color-mix\(in_srgb,var\(--nimi-text-muted\)_14%,transparent\)\] text-\[var\(--nimi-text-secondary\)\]'/);
  assert.doesNotMatch(galleryEntry, /var\(--nimi-action-primary-bg\)_9%,var\(--nimi-surface-card\)/);
  // It is pure component documentation - no runtime work.
  assert.match(gallery, /component documentation/);
  // The scenario-first composer was replaced by a component-first doc.
  assert.doesNotMatch(gallery, /Surface Scenario Rail|surfaceScenarios|Recipe Composer/);
});

test('tester UI Recipes use an inspect-driven recipe inspector workspace', () => {
  const gallery = readTesterKitComponentGallerySurface(root);

  assert.match(gallery, /RecipeWorkspace/);
  assert.match(gallery, /Recipe Inspector/);
  assert.match(gallery, /Copy selected recipe/);
  assert.match(gallery, /<IconButton[\s\S]*aria-label="Copy recipe imports"[\s\S]*icon=\{<Copy size=\{14\} aria-hidden="true" \/>}/);
  assert.doesNotMatch(gallery, /<Button tone="ghost" size="sm" onClick=\{\(\) => copyTextToClipboard\(importBlock\)\}>copy<\/Button>/);
  assert.match(gallery, /Inspect \$\{recipe\.name\}/);
  assert.match(gallery, /active=\{active\}[\s\S]*className="kit-recipe-inspect-action/);
  assert.match(gallery, /className="flex min-w-0 items-start justify-between gap-3"[\s\S]*<strong className="min-w-0 truncate text-base">\{recipe\.name\}<\/strong>[\s\S]*Inspect/);
  assert.match(gallery, /inspectorOpen \? 'kit-recipe-workspace grid min-w-0 gap-5 lg:grid-cols-\[minmax\(0,1fr\)_340px\]'/);
  assert.doesNotMatch(gallery, /kit-recipe-workspace grid min-w-0 gap-5 xl:grid-cols/);
  assert.match(gallery, /setInspectorOpen\(true\)/);
  assert.match(gallery, /aria-label="Close recipe inspector"/);
  assert.match(gallery, /inspectorPanelRef/);
  assert.match(gallery, /onBlur=\{\(event\) =>/);
  assert.match(gallery, /event\.currentTarget\.contains\(event\.relatedTarget\)/);
  assert.doesNotMatch(gallery, /document\.(?:addEventListener|removeEventListener)/);
  assert.doesNotMatch(gallery, /OverlayRecipeMetrics|OverlayStatPill/);
  assert.doesNotMatch(gallery, /OverlayRecipeHero|kit-overlay-hero/);
  assert.doesNotMatch(gallery, /overlayRecipeDescription|overlayRecipeIcon|line-clamp-3/);
  assert.doesNotMatch(gallery, /shrink-0 place-items-center rounded-2xl/);
  assert.match(gallery, /recipes\.map\(\(recipe\) =>/);
  assert.doesNotMatch(gallery, /Reusable overlay interaction patterns for dialogs, drawers, popovers and tooltips/);
  assert.doesNotMatch(gallery, /function selectRecipe|function applyFilter/);
  assert.doesNotMatch(gallery, /OverlayFilter|overlayFilters|overlayMatchesFilter/);
  assert.doesNotMatch(gallery, /aria-label=\{`Use \$\{recipe\.name\}`\}/);
  assert.doesNotMatch(gallery, /leadingIcon=\{<Play/);
  assert.doesNotMatch(gallery, /<Button[^>]*>\s*Use\s*<\/Button>/);
  assert.doesNotMatch(gallery, /rounded-2xl border border-\[color-mix\(in_srgb,var\(--nimi-border-subtle\)_78%,white\)\]/);
  assert.doesNotMatch(gallery, /<Check size=\{18\} strokeWidth=\{2\.2\}/);
  assert.doesNotMatch(gallery, /recipe\.props\.length\} props|recipeAccessChecks\(recipe\)\.length\} access|recipeTokenFootprint\(recipe\)\.length\} tokens/);
  for (const recipe of ['Button / IconButton', 'Field system', 'Selection controls', 'Dialog', 'NimiTabs / PillTabs', 'DataList']) {
    assert.match(gallery, new RegExp(recipe));
  }
});

test('tester UI Recipes applies the inspector workspace to every non-foundations category', () => {
  const galleryEntry = read('src/tester/kit-component-gallery.tsx');

  assert.match(galleryEntry, /\bRecipeWorkspace\b/);
  assert.match(galleryEntry, /category === 'foundations'\s*\?\s*\(\s*<FoundationsCanvas \/>[\s\S]*:\s*\(\s*<RecipeWorkspace recipes=\{recipesInCategory\} \/>/);
  assert.doesNotMatch(galleryEntry, /category === 'overlays'/);
  assert.doesNotMatch(galleryEntry, /\bRecipeCards\b/);
});

test('tester UI Recipes deep links and per-recipe evidence use product language', () => {
  const devPreview = read('src/dev-preview.tsx');
  const gallery = readTesterKitComponentGallerySurface(root);
  const recipes = read('src/tester/kit-component-gallery-recipes.tsx');
  const foundationsSurface = read('src/tester/kit-component-gallery-surface.tsx');

  assert.match(devPreview, /'ui-recipes': 'UI Recipes'/);
  assert.doesNotMatch(devPreview, /'ui-recipes': 'Nimi Kit'/);
  assert.match(gallery, /accessChecks/);
  assert.match(gallery, /tokenFootprint/);
  assert.doesNotMatch(gallery, /CHECKLIST\.map/);
  assert.doesNotMatch(recipes, /export const CHECKLIST/);
  assert.doesNotMatch(recipes, /RecipeMode|RECIPE_MODES/);
  assert.match(recipes, /aria-label is required for icon-only actions/);
  assert.match(recipes, /--nimi-action-primary-bg/);
  assert.match(recipes, /tables\/nimi-ui-tokens\.yaml/);
  assert.match(foundationsSurface, /<NimiText role=\{entry\.role\}/);
});

test('tester UI Recipes field system keeps input labels aligned', () => {
  const recipes = read('src/tester/kit-component-gallery-recipes.tsx');

  assert.match(recipes, /<div className="kit-fields-recipe grid w-full min-w-0 max-w-sm gap-3">[\s\S]*<FieldShell label="App identity">[\s\S]*<FieldShell label="Capability route">[\s\S]*<\/div>/);
  assert.match(recipes, /snippet: `<div className="kit-fields-recipe grid w-full min-w-0 max-w-sm gap-3">[\s\S]*<FieldShell label="App identity">[\s\S]*<FieldShell label="Capability route">[\s\S]*<\/div>`/);
});

test('tester UI Recipes selection controls stack each control shape on its own row', () => {
  const recipes = read('src/tester/kit-component-gallery-recipes.tsx');

  assert.match(recipes, /<div className="kit-selection-recipe grid w-full min-w-0 max-w-md gap-3 justify-items-start">[\s\S]*<ToggleDemo \/>[\s\S]*<CheckboxDemo \/>[\s\S]*<SegmentedDemo \/>[\s\S]*<\/div>/);
  assert.match(recipes, /snippet: `function SelectionControls\(\) \{[\s\S]*<div className="kit-selection-recipe grid w-full min-w-0 max-w-md gap-3 justify-items-start">[\s\S]*<Toggle checked=\{toggleOn\} onChange=\{setToggleOn\} \/>[\s\S]*<Checkbox[\s\S]*<SegmentedControl[\s\S]*<\/div>[\s\S]*\}`/);
});

test('tester UI Recipes layout controls stack each control shape with larger vertical spacing', () => {
  const recipes = read('src/tester/kit-component-gallery-recipes.tsx');

  assert.match(recipes, /<div className="kit-layout-tabs-recipe grid w-full min-w-0 max-w-2xl gap-6 justify-items-start">[\s\S]*<TabsDemo \/>[\s\S]*<PillTabsDemo \/>[\s\S]*<\/div>/);
  assert.match(recipes, /snippet: `function TabsRecipe\(\) \{[\s\S]*<div className="kit-layout-tabs-recipe grid w-full min-w-0 max-w-2xl gap-6 justify-items-start">[\s\S]*<NimiTabs[\s\S]*<PillTabs[\s\S]*<\/div>[\s\S]*\}`/);
  assert.match(recipes, /<div className="kit-layout-navigation-recipe grid w-full min-w-0 max-w-2xl gap-6 justify-items-start">[\s\S]*<Breadcrumb[\s\S]*<Steps[\s\S]*<PaginationDemo \/>[\s\S]*<\/div>/);
  assert.match(recipes, /snippet: `function NavigationRecipe\(\) \{[\s\S]*<div className="kit-layout-navigation-recipe grid w-full min-w-0 max-w-2xl gap-6 justify-items-start">[\s\S]*<Breadcrumb[\s\S]*<Steps[\s\S]*<Pagination page=\{page\} pageCount=\{7\} onPageChange=\{setPage\} \/>[\s\S]*<\/div>[\s\S]*\}`/);
});

test('tester UI Recipes data status preview panes stretch evenly and InlineAlert spacing breathes', () => {
  const surface = read('src/tester/kit-component-gallery-surface.tsx');
  const dataRecipes = read('src/tester/kit-component-gallery-data-recipes.tsx');

  assert.match(surface, /compact \? 'min-h-36 h-full p-4' : 'min-h-64 p-7'/);
  assert.match(surface, /className="kit-recipe-tile grid h-full min-w-0 grid-rows-\[auto_minmax\(9rem,1fr\)\] gap-4 p-4 min-\[1700px\]:grid-cols-\[minmax\(0,1fr\)_184px\]"/);
  assert.match(dataRecipes, /<div className="kit-inline-alert-recipe grid w-full min-w-0 gap-6">[\s\S]*<InlineAlert tone="info">[\s\S]*<InlineAlert tone="warning">[\s\S]*<\/div>/);
  assert.match(dataRecipes, /snippet: `<div className="kit-inline-alert-recipe grid w-full min-w-0 gap-6">[\s\S]*<InlineAlert tone="info">[\s\S]*<InlineAlert tone="warning">[\s\S]*<\/div>`/);
});

test('tester UI Recipes foundations keep raw token evidence out of the startup canvas', () => {
  const galleryEntry = read('src/tester/kit-component-gallery.tsx');
  const foundationsSurface = read('src/tester/kit-component-gallery-surface.tsx');

  assert.match(galleryEntry, /<IconButton[\s\S]*tone="ghost"[\s\S]*aria-label=\{category === 'foundations' \? 'Copy CSS setup' : 'Copy imports'\}[\s\S]*className="kit-doc__copy-action[^"]*bg-\[color-mix\(in_srgb,var\(--nimi-surface-card\)_32%,transparent\)\][^"]*hover:bg-\[var\(--nimi-action-primary-bg\)\][^"]*hover:border-\[var\(--nimi-action-primary-bg\)\][^"]*hover:text-\[var\(--nimi-action-primary-text\)\][\s\S]*icon=\{<Copy size=\{14\} aria-hidden="true" \/>}/);
  assert.doesNotMatch(galleryEntry, />Copy CSS setup</);
  assert.doesNotMatch(galleryEntry, />Copy imports</);
  assert.doesNotMatch(galleryEntry, /entries/);
  assert.doesNotMatch(galleryEntry, /ProgressIndicator/);
  assert.doesNotMatch(galleryEntry, /Copy tokens/);
  assert.doesNotMatch(galleryEntry, /Nimi UI Kit.{0,8}Reference/);
  assert.doesNotMatch(galleryEntry, /Preview overlay shell/);
  assert.doesNotMatch(galleryEntry, /Maximize2/);
  assert.doesNotMatch(galleryEntry, /kit-doc__hero/);
  assert.match(galleryEntry, /foundationCode/);
  assert.match(foundationsSurface, /kit-found-card grid min-w-0 overflow-hidden/);
  assert.match(foundationsSurface, /kit-type-row flex min-w-0 overflow-hidden/);
  assert.doesNotMatch(foundationsSurface, /<code[^>]*>\{entry\.token\}<\/code>/);
  assert.doesNotMatch(foundationsSurface, /role=&quot;\{entry\.role\}&quot;/);
});

test('tester capability runs consume Kit renderer telemetry', () => {
  const workbench = read('src/tester/tester-workbench.tsx');
  const productionBindings = read('src/renderer/production-bindings.ts');
  const testerAiConfig = read('src/tester/tester-ai-config.ts');
  const testerRuntime = read('src/tester/tester-runtime.ts');

  assert.match(workbench, /useTesterRendererHost/);
  assert.match(workbench, /rendererHost\.app\.projection\.aiConfigSummary\(\)/);
  assert.match(workbench, /rendererHost\.app\.projection\.runHistory\(\)/);
  assert.match(workbench, /rendererHost\.app\.commands\.runtimeLog\(/);
  assert.match(workbench, /rendererHost\.app\.commands\.rendererLog\(/);
  assert.match(workbench, /rendererHost\.app\.commands\.nextRunIdentity\(\)/);
  assert.match(productionBindings, /from '@nimiplatform\/kit\/telemetry'/);
  assert.match(productionBindings, /jsonValuesEqual/);
  assert.match(productionBindings, /from '@nimiplatform\/kit\/core\/json-value'/);
  assert.doesNotMatch(productionBindings, /JSON\.stringify\(read\.value\)/);
  assert.match(productionBindings, /from '@nimiplatform\/sdk'/);
  assert.match(productionBindings, /from '@nimiplatform\/sdk\/types'/);
  assert.match(productionBindings, /loadTesterAIConfigSummary/);
  assert.match(testerAiConfig, /inspectRuntimeReadiness/);
  assert.match(testerRuntime, /from '\.\.\/shell\/auth\/runtime-platform\.js'/);
  assert.doesNotMatch(workbench, /from '@nimiplatform\/sdk\/runtime'/);
  assert.doesNotMatch(workbench, /from '@nimiplatform\/(?:kit\/telemetry|sdk(?:\/types)?)'/);
  assert.match(productionBindings, /createNimiClientId\('run'\)/);
  assert.match(productionBindings, /requestWithRetry/);
  assert.match(productionBindings, /executor:\s*loadTesterRunHistory/);
  assert.match(productionBindings, /logRendererEvent\(/);
  assert.match(productionBindings, /emitRuntimeLog/);
  assert.match(workbench, /action:tester-capability-run:recorded/);
  assert.match(workbench, /history-load-failed/);
  assert.doesNotMatch(workbench, /runtime-bridge\/logging|@renderer\/.*telemetry/);
  assert.doesNotMatch(workbench, /Math\.random\(\)/);
});

test('tester derives production and Simulator truth from their host projections without a renderer host discriminator', () => {
  const productionBindings = read('src/renderer/production-bindings.ts');
  const simulatorFixture = read('src/simulator/fixture.ts');
  const simulatorBindings = read('src/simulator/bindings.ts');
  const workbench = read('src/tester/tester-workbench.tsx');

  assert.match(productionBindings, /runtimePlatform:\s*getRuntimePlatformProjection/);
  assert.match(productionBindings, /aiConfigSummary:\s*loadTesterAIConfigSummary/);
  assert.match(simulatorFixture, /runtimePlatform:\s*\{[\s\S]*status:\s*'unavailable'/);
  assert.match(simulatorFixture, /runtime:\s*\{[\s\S]*status:\s*'simulated'/);
  assert.match(simulatorBindings, /return \{ state: 'unavailable', sessionBound: false \}/);
  assert.match(workbench, /summary\.runtime\.status === 'simulated'/);
  assert.match(workbench, /localAppProjection\?\.status === 'ready'/);
  assert.doesNotMatch(workbench, /isSimulator|simulatorHost|hostKind/);
});

test('tester product-local preferences stay app-owned while platform AIConfig and storage fail closed', () => {
  const preferences = read('src/tester/tester-preferences.ts');
  const store = read('src/tester/tester-ai-config-store.ts');

  assert.match(preferences, /from '@nimiplatform\/kit\/core\/storage-json'/);
  for (const helper of [
    'resolveBrowserStorage',
    'readStorageJsonFrom',
    'writeStorageJsonTo',
    'removeStorageKeyFrom',
  ]) {
    assert.match(preferences, new RegExp(helper));
  }
  assert.match(store, /createNimiError/);
  assert.match(store, /TESTER_LOCAL_APP_AI_CONFIG_UNAVAILABLE/);
  assert.doesNotMatch(store, /standardShellSurface\.aiConfig/);
  assert.doesNotMatch(store, /localStorage|sessionStorage/);
  assert.doesNotMatch(store, /from '@nimiplatform\/kit\/core\/storage-json'/);
  assert.doesNotMatch(store, /resolveBrowserStorage\('local'\)/);
  assert.doesNotMatch(store, /createNimiAIConfigStore/);
});

test('tester app-owned Tauri commands are registered in standalone shell', () => {
  const main = read('src-tauri/src/main.rs');
  assert.match(main, /resolve_world_tour_fixture/);
  assert.match(main, /save_world_tour_viewer_preset/);
  assert.match(main, /open_world_tour_window/);
  assert.match(main, /claim_world_tour_viewer_launch/);
  // Run/image history and artifact materialization are unadmitted and fail
  // closed in the renderer; they do not become app-owned Tauri commands.
  assert.doesNotMatch(main, /tester_run_history_load/);
  assert.doesNotMatch(main, /tester_image_history_save/);
  assert.doesNotMatch(main, /tester_artifact_save/);
  assert.doesNotMatch(main, /tester_export_save/);
  assert.doesNotMatch(main, /StandardAppStorageRootSlot/);
  assert.match(main, /RuntimeBridgeLocalAppHost::platform_default/);
});

test('tester scaffold boundary expands beyond the product route', () => {
  const agents = read('AGENTS.md');
  assert.match(agents, /src\/shell\/routes\/product-area\.tsx/);
  assert.match(agents, /src\/tester\/\*\*/);
  assert.match(agents, /src-tauri\/src\/world_tour\.rs/);
  assert.doesNotMatch(agents, /tester_storage\.rs/);
  assert.match(agents, /tester contract tests/);
});
