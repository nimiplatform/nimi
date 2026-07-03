import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

async function readHomeSurfaceSource() {
  return [
    await readFile(path.join(root, 'src', 'shell', 'app', 'home-desktop-chat-shell-chrome.tsx'), 'utf8'),
    await readFile(path.join(root, 'src', 'shell', 'app', 'HomeSurface.tsx'), 'utf8'),
    await readFile(path.join(root, 'src', 'shell', 'app', 'home-developer-backstage.tsx'), 'utf8'),
    await readFile(path.join(root, 'src', 'shell', 'app', 'home-surface-sections.tsx'), 'utf8'),
    await readFile(path.join(root, 'src', 'shell', 'app', 'home-image-studio-section.tsx'), 'utf8'),
  ].join('\n');
}

async function readDeveloperBackstageSource() {
  return readFile(path.join(root, 'src', 'shell', 'app', 'home-developer-backstage.tsx'), 'utf8');
}

async function readImageStudioSource() {
  return readFile(path.join(root, 'src', 'shell', 'app', 'home-image-studio-section.tsx'), 'utf8');
}

test('home surface keeps the product hierarchy compact before diagnostics', async () => {
  const source = await readHomeSurfaceSource();
  const css = await readFile(path.join(root, 'src', 'shell', 'app', 'home-surface.css'), 'utf8');

  const primaryRailIndex = source.indexOf('className="zhiyu-home__right-rail"');
  const diagnosticIndex = source.indexOf('data-zhiyu-diagnostics-drawer');
  assert.ok(primaryRailIndex >= 0, 'expected primary Memory/Avatar rail to render');
  assert.ok(diagnosticIndex >= 0, 'expected diagnostic drawer evidence to render');
  assert.ok(
    primaryRailIndex < diagnosticIndex,
    'primary Memory/Avatar rail should render before diagnostic evidence',
  );

  assert.doesNotMatch(
    css,
    /font-size:\s*[^;]*(?:clamp\(|vw)/,
    'home typography must use stable compact sizes instead of viewport-scaled hero sizing',
  );

  assert.doesNotMatch(
    css,
    /\.zhiyu-home__presence\s*\{[^}]*grid-row:\s*span\s+3\b/s,
    'agent presence should not span multiple grid rows as a hero panel',
  );

  assert.match(
    css,
    /@media \(max-width: 720px\)[\s\S]*\.zhiyu-home__status-row\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*24px minmax\(0,\s*1fr\);/s,
    'narrow status rows must stack text instead of overlapping evidence labels',
  );

  assert.match(
    css,
    /@media \(max-width: 720px\)[\s\S]*\.zhiyu-home__diagnostic-row\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s,
    'narrow diagnostic rows must stack evidence labels and action hints',
  );
});

test('electron acceptance stores PP2 desktop and narrow visual evidence', async () => {
  const acceptance = await readFile(path.join(root, 'test', 'electron-acceptance.mjs'), 'utf8');

  assert.match(acceptance, /product-home-desktop\.png/);
  assert.match(acceptance, /product-home-narrow\.png/);
});

test('ZM6 product shell keeps diagnostics behind an explicit drawer', async () => {
  const source = await readHomeSurfaceSource();
  const css = await readFile(path.join(root, 'src', 'shell', 'app', 'home-surface.css'), 'utf8');

  assert.match(source, /data-zhiyu-product-shell="workspace"/);
  assert.match(source, /data-zhiyu-primary-ui="true"/);
  assert.match(source, /data-zhiyu-diagnostics-toggle="open"/);
  assert.match(source, /data-zhiyu-diagnostics-drawer=\{diagnosticsOpen \? 'open' : 'closed'\}/);
  assert.match(source, /hidden=\{!diagnosticsOpen\}/);
  assert.match(source, /technicalSurfaces\.map\(renderGatedSurface\)/);
  assert.match(source, /primaryMemorySurface \? renderGatedSurface\(primaryMemorySurface\) : null/);
  assert.match(source, /primaryAvatarSurface \? renderGatedSurface\(primaryAvatarSurface\) : null/);

  assert.match(css, /\.zhiyu-home__workspace\s*\{/);
  assert.match(css, /\.zhiyu-home__shell-grid\s*\{/);
  assert.match(css, /\.zhiyu-home__action-rail\s*\{/);
  assert.match(css, /\.zhiyu-home__right-rail\s*\{/);
  assert.match(css, /\.zhiyu-home__diagnostics-layer\s*\{/);
});

test('ZM6 primary product surfaces do not render raw projection tokens as user copy', async () => {
  const source = await readHomeSurfaceSource();
  const memory = await readFile(path.join(root, 'src', 'shell', 'app', 'home-memory-observatory-section.tsx'), 'utf8');

  assert.match(source, /formatProjectionValue/);
  assert.match(source, /formatReasonLabel/);
  assert.doesNotMatch(
    source,
    /<strong>\{value \?\? 'not_projected'\}<\/strong>/,
    'Avatar primary fields should show product copy while keeping not_projected in data attributes only',
  );
  assert.doesNotMatch(
    memory,
    />\{field\}: not_projected<\/span>/,
    'Memory lifecycle diagnostic tokens should not render as primary visible copy',
  );
  assert.doesNotMatch(
    memory,
    /<strong>not_projected<\/strong>/,
    'Memory graph should not render not_projected as primary visible copy',
  );
});

test('ZM6 AI action rail uses product copy instead of tester diagnostics', async () => {
  const source = await readHomeSurfaceSource();

  assert.match(source, /imageStudioResultText/);
  assert.doesNotMatch(source, /<p>\{evidence\.imageStudio\.message\}<\/p>/);
  assert.doesNotMatch(source, /AIConfig targetRef is required/);
  assert.doesNotMatch(source, /failed closed before request dispatch/);
  assert.doesNotMatch(source, /Run core Runtime AI capabilities through the shared Kit consume path\./);
  assert.doesNotMatch(source, /Run image\.generate through Runtime scenario jobs and Runtime-owned artifacts\./);
  assert.doesNotMatch(source, /placeholder="Write a short prompt for text, stream, or embedding\."/);
  assert.doesNotMatch(source, />Generate image<\/Button>/);
});

test('ZM8 no-runtime gate keeps raw Runtime transport detail out of primary copy', async () => {
  const source = await readFile(path.join(root, 'src', 'shell', 'auth', 'runtime-unavailable-page.tsx'), 'utf8');

  assert.match(source, /runtime-unavailable-diagnostic-detail/);
  assert.match(source, /data-zhiyu-runtime-offline-tier/);
  assert.match(source, /runtimeUnavailablePrimaryCopy/);
  assert.doesNotMatch(source, />Runtime session unavailable</);
  assert.doesNotMatch(source, />action required</);
  assert.doesNotMatch(source, />Retry Runtime check</);
  assert.doesNotMatch(source, /离线层级/);
  assert.doesNotMatch(source, /<span>\{body\}<\/span>/);
  assert.doesNotMatch(source, /projection\?\.actionHint \? <p className="runtime-action-hint">/);
});

test('ZM8 Capability Studio presents product text instead of raw Runtime envelopes', async () => {
  const source = await readDeveloperBackstageSource();

  assert.match(source, /formatCapabilityStudioProductText/);
  assert.match(source, /stripRuntimeTextEnvelope/);
  assert.doesNotMatch(source, /return studio\.streamingText \|\| studio\.text \|\| studio\.message;/);
  assert.doesNotMatch(source, /Embedding ready:/);
  assert.doesNotMatch(source, /<message id=/);
});

test('ZM8 Image Studio exposes a deliberate preview state for Runtime artifacts', async () => {
  const source = await readImageStudioSource();
  const css = await readFile(path.join(root, 'src', 'shell', 'app', 'home-surface.css'), 'utf8');

  assert.match(source, /imageStudioPreviewState/);
  assert.match(source, /data-zhiyu-image-generate-preview-state/);
  assert.match(source, /图片预览已就绪/);
  assert.match(css, /\.zhiyu-home__image-studio-preview-frame\s*\{/);
});

test('ZM8 product workspace styles local buttons and text areas instead of exposing browser defaults', async () => {
  const css = await readFile(path.join(root, 'src', 'shell', 'app', 'home-surface.css'), 'utf8');
  const authCss = await readFile(path.join(root, 'src', 'shell', 'auth', 'runtime-auth.css'), 'utf8');

  assert.match(css, /\.zhiyu-home :where\(button\)\s*\{/);
  assert.match(css, /\.zhiyu-home :where\(textarea\)\s*\{/);
  assert.match(css, /"presence conversation side"\s+"presence capability side"\s+"presence image side"/);
  assert.match(authCss, /\.runtime-unavailable-screen :where\(button\)\s*\{/);
});

test('ZM8 Electron evidence persists page problem arrays with screenshots', async () => {
  const noRuntimeAcceptance = await readFile(path.join(root, 'test', 'electron-acceptance.mjs'), 'utf8');
  const liveRuntimeAcceptance = await readFile(path.join(root, 'test', 'electron-live-runtime-acceptance.mjs'), 'utf8');

  assert.match(noRuntimeAcceptance, /captureProductHomeEvidence\(page,\s*pageProblems,/);
  assert.match(noRuntimeAcceptance, /pageProblems:\s*\[\.\.\.pageProblems\]/);
  assert.match(liveRuntimeAcceptance, /captureLiveRuntimeEvidence\(page,\s*[^,]+,\s*pageProblems,/);
  assert.match(liveRuntimeAcceptance, /pageProblems:\s*\[\.\.\.pageProblems\]/);
});

test('ZM12 primary product copy hides internal workbench terms while preserving diagnostics hooks', async () => {
  const source = await readHomeSurfaceSource();
  const productState = await readFile(path.join(root, 'src', 'shell', 'app', 'home-product-state.ts'), 'utf8');
  const memory = await readFile(path.join(root, 'src', 'shell', 'app', 'home-memory-observatory-section.tsx'), 'utf8');

  assert.doesNotMatch(source, /emptyEyebrow="Runtime Agent Chat"/);
  assert.doesNotMatch(source, />Capability Studio<\/h2>/);
  assert.doesNotMatch(source, />Image Studio<\/h2>/);
  assert.doesNotMatch(productState, /title: 'Avatar Presence'/);
  assert.doesNotMatch(memory, />graph-lite<\/span>/);
  assert.doesNotMatch(memory, /<strong>\{memory\.state\}<\/strong>/);
  assert.match(source, /chatPrimaryBindingLabel/);
  assert.match(source, /data-zhiyu-ai-config-raw-binding-label/);
});

test('ZM12 Image Studio renders one preview message with distinct missing-binding metadata-only and completed states', async () => {
  const source = await readImageStudioSource();

  assert.match(source, /readonly state: 'missing-binding' \| 'metadata-only' \| 'completed'/);
  assert.match(source, /图片模型还未绑定/);
  assert.match(source, /只收到产物元数据/);
  assert.match(source, /图片预览已就绪/);
  assert.doesNotMatch(
    source,
    /className="zhiyu-home__image-studio-empty"[\s\S]*className="zhiyu-home__image-studio-preview-caption"/,
    'fallback preview and caption must not render the same text twice',
  );
});

test('ZM12 model config drawer consumes Kit model-config glass chrome without blank top controls', async () => {
  const settings = await readFile(path.join(root, 'src', 'shell', 'ai-config', 'zhiyu-ai-config-settings.tsx'), 'utf8');
  const css = await readFile(path.join(root, 'src', 'shell', 'app', 'home-surface.css'), 'utf8');

  assert.match(settings, /@nimiplatform\/kit\/features\/model-config/);
  assert.match(settings, /@nimiplatform\/kit\/features\/model-picker/);
  assert.match(settings, /material="glass-regular"/);
  assert.match(settings, /data-zhiyu-ai-config-drawer-panel="kit-glass"/);
  assert.match(settings, /className="zhiyu-ai-config-drawer__model-hub"/);
  assert.doesNotMatch(css, /z-index:\s*auto;/);
  assert.match(css, /\.zhiyu-ai-config-drawer__model-hub[\s\S]*\[data-nimi-model-config-capability\]/);
});

test('ZM12 Electron acceptance records local panel screenshots instead of only repeated full pages', async () => {
  const liveRuntimeAcceptance = await readFile(path.join(root, 'test', 'electron-live-runtime-acceptance.mjs'), 'utf8');

  assert.match(liveRuntimeAcceptance, /capturePanelScreenshots/);
  assert.match(liveRuntimeAcceptance, /live-runtime-model-unconfigured-panel\.png/);
  assert.match(liveRuntimeAcceptance, /live-runtime-model-configured-panel\.png/);
  assert.match(liveRuntimeAcceptance, /live-runtime-no-partner-relationship-panel\.png/);
  assert.match(liveRuntimeAcceptance, /live-runtime-agent-chat-panel\.png/);
  assert.match(liveRuntimeAcceptance, /panelScreenshots:/);
});

test('ZM13R product naming is restored to 织羽 Zhiyu without drift leftovers', async () => {
  const { readdir } = await import('node:fs/promises');
  const files = [];
  const forbiddenDriftName = String.fromCodePoint(0x77e5, 0x9047);
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (/\.(tsx?|css|html)$/.test(entry.name)) {
        files.push(full);
      }
    }
  }
  await walk(path.join(root, 'src'));
  await walk(path.join(root, 'src-electron'));
  await walk(path.join(root, 'test'));
  files.push(path.join(root, 'index.html'));
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    assert.equal(content.includes(forbiddenDriftName), false, `${path.relative(root, file)} still uses the drifted brand name`);
  }
  const platform = await readFile(path.join(root, 'src', 'shell', 'auth', 'runtime-platform.ts'), 'utf8');
  assert.match(platform, /appTitle = '织羽 Zhiyu'/);
  const electronMain = await readFile(path.join(root, 'src-electron', 'main.ts'), 'utf8');
  assert.match(electronMain, /app\.setName\('织羽 Zhiyu'\)/);
  assert.match(electronMain, /title: '织羽 Zhiyu'/);
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /<title>织羽 Zhiyu<\/title>/);
  const registry = await readFile(path.resolve(root, '..', '..', '.nimi', 'spec', 'platform', 'kernel', 'tables', 'nimi-app-registry.yaml'), 'utf8');
  assert.match(registry, /app_id: nimi\.zhiyu[\s\S]*display_label: 织羽 Zhiyu/);
});

test('ZM13 image studio clears stale binding failure after the route binds image.generate', async () => {
  const appSource = await readFile(path.join(root, 'src', 'shell', 'app', 'App.tsx'), 'utf8');
  assert.match(appSource, /reconcileZhiyuImageStudioWithRoute/);

  const surface = await readImageStudioSource();
  assert.match(surface, /imageStudioBadgeLabel/);
  assert.doesNotMatch(
    surface,
    /if \(state === 'failed'\) return '需要配置';/,
    'image studio state chip must distinguish binding-missing from real generation failures',
  );
});

test('ZM13 conversation-centered IA collapses the ready checklist and promotes companion state', async () => {
  const surface = await readHomeSurfaceSource();

  assert.match(surface, /data-zhiyu-status-collapsed/);
  assert.match(surface, /<details/);
  assert.match(surface, /primaryCompanionSurface \? renderGatedSurface\(primaryCompanionSurface\) : null/);
  assert.match(
    surface,
    /surface\.key !== 'memory' && surface\.key !== 'avatar' && surface\.key !== 'companion'/,
    'companion must move out of the diagnostics drawer technical surfaces',
  );
});

test('ZM13 primary status chips are labeled and technical values stay in data attributes', async () => {
  const surface = await readFile(path.join(root, 'src', 'shell', 'app', 'HomeSurface.tsx'), 'utf8');

  assert.match(surface, /data-zhiyu-labeled-chip="conversation"/);
  assert.match(surface, /data-zhiyu-labeled-chip="route"/);
  assert.match(surface, /data-zhiyu-labeled-chip="chat"/);
  assert.match(surface, />会话</);
  assert.match(surface, />模型</);
  assert.match(surface, />回复</);
});

test('ZM13 memory and companion times render localized product labels instead of raw ISO strings', async () => {
  const memory = await readFile(path.join(root, 'src', 'shell', 'app', 'home-memory-observatory-section.tsx'), 'utf8');
  const companion = await readFile(path.join(root, 'src', 'shell', 'app', 'home-companion-state-section.tsx'), 'utf8');

  assert.match(memory, /formatZhiyuObservedAtLabel/);
  assert.doesNotMatch(memory, /\{memory\.observedAt \?\? '尚未观测'\}/);
  assert.match(companion, /formatZhiyuObservedAtLabel/);
  assert.doesNotMatch(companion, /\{companion\.observedAt \?\? '尚未观测'\}/);
  assert.match(
    companion,
    /\{label\}：\{companionStateValue\(value\) \?\? '尚未配置'\}/,
    'proactive fields must render an explicit product label instead of an empty value',
  );
});

test('ZM13 embedding results render Chinese product copy instead of raw English tokens', async () => {
  const surface = await readDeveloperBackstageSource();

  assert.doesNotMatch(surface, />vectors \{/);
  assert.doesNotMatch(surface, />dimensions \{/);
  assert.match(surface, /样本/);
});

test('ZM13 avatar waiting-authorization copy renders exactly once', async () => {
  const sections = await readFile(path.join(root, 'src', 'shell', 'app', 'home-surface-sections.tsx'), 'utf8');

  assert.doesNotMatch(
    sections,
    /fallback:\/\/\$\{avatar\.ready \? '形象已就绪' : '等待授权'\}/,
    'AvatarStage fallback text must not duplicate the 等待授权 status label',
  );
  assert.doesNotMatch(
    sections,
    /启动和管理入口会在授权后出现。/,
    'duplicate avatar authorization sentence must be removed',
  );
  assert.match(sections, /形象启动和管理会在获得授权后出现。/);
  assert.doesNotMatch(sections, /上游明确授权/);
});

test('ZM13 zhiyu consumes kit chat tailwind utilities through a single styles entry', async () => {
  const styles = await readFile(path.join(root, 'src', 'styles.css'), 'utf8');
  const main = await readFile(path.join(root, 'src', 'main.tsx'), 'utf8');

  assert.match(styles, /@import "@nimiplatform\/kit\/ui\/styles\.css";/);
  assert.match(styles, /@import "tailwindcss";/);
  assert.match(main, /import '\.\/styles\.css';/);
  assert.doesNotMatch(main, /import '@nimiplatform\/kit\/ui\/styles\.css';/);
});

test('ZM13 Electron acceptance strengthens stage evidence uniqueness and drawer captures', async () => {
  const liveRuntimeAcceptance = await readFile(path.join(root, 'test', 'electron-live-runtime-acceptance.mjs'), 'utf8');

  assert.match(liveRuntimeAcceptance, /live-runtime-diagnostics-open-panel\.png/);
  assert.match(liveRuntimeAcceptance, /live-runtime-model-unconfigured-viewport\.png/);
  assert.match(liveRuntimeAcceptance, /live-runtime-model-configured-viewport\.png/);
  assert.match(liveRuntimeAcceptance, /assertUniqueStageScreenshots/);
  assert.match(liveRuntimeAcceptance, /resetAcceptanceInputs/);
});

test('ZM14 diagnostics drawer capability matrix wraps readable cells and is checked in the real drawer', async () => {
  const sections = await readFile(path.join(root, 'src', 'shell', 'app', 'home-surface-sections.tsx'), 'utf8');
  const css = await readFile(path.join(root, 'src', 'shell', 'app', 'home-surface.css'), 'utf8');
  const liveRuntimeAcceptance = await readFile(path.join(root, 'test', 'electron-live-runtime-acceptance.mjs'), 'utf8');

  assert.match(sections, /data-zhiyu-capability-governance-chip/);
  assert.match(
    css,
    /\.zhiyu-home__capability-governance\s*\{[\s\S]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(120px,\s*1fr\)\);/s,
    'capability matrix should auto-fit readable cells instead of forcing three cramped columns',
  );
  assert.match(
    css,
    /\.zhiyu-home__capability-list\s*\{[^}]*display:\s*grid;[^}]*gap:\s*8px;/s,
    'capability list should space expanded governance rows instead of stacking them tightly',
  );
  assert.match(
    css,
    /\.zhiyu-home__capability-item\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*overflow:\s*visible;/s,
    'capability rows must grow vertically with the governance matrix',
  );
  assert.match(
    css,
    /\.zhiyu-home__capability-item-header\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto;[^}]*align-items:\s*start;/s,
    'capability row headers should keep title and status badge in a readable horizontal header',
  );
  assert.match(
    css,
    /\.zhiyu-home__capability-governance span\s*\{[^}]*overflow-wrap:\s*anywhere;[^}]*white-space:\s*normal;/s,
    'capability matrix cells need explicit wrapping for long capability and audit labels',
  );
  assert.doesNotMatch(
    css,
    /\.zhiyu-home__capability-governance span\s*\{[^}]*white-space:\s*nowrap;/s,
    'capability matrix cells must not inherit nowrap truncation in the diagnostics drawer',
  );
  assert.match(liveRuntimeAcceptance, /assertDiagnosticsCapabilityMatrixReadable/);
  assert.match(liveRuntimeAcceptance, /live-runtime-diagnostics-open-narrow\.png/);
});

test('ZM14 capability studio idle chip waits for input instead of saying it is syncing', async () => {
  const surface = await readDeveloperBackstageSource();
  const syncing = String.fromCodePoint(0x540c, 0x6b65, 0x4e2d);
  const waitingInput = String.fromCodePoint(0x7b49, 0x5f85, 0x8f93, 0x5165);
  const pendingStart = String.fromCodePoint(0x5f85, 0x5f00, 0x59cb);

  assert.match(surface, /capabilityStudioStatusLabel/);
  assert.doesNotMatch(
    surface,
    /label=\{formatReasonLabel\(evidence\.capabilityStudio\.ready,\s*evidence\.capabilityStudio\.reasonCode\)\}/,
    'capability studio must not reuse generic projection syncing copy for the idle chip',
  );
  assert.ok(
    surface.includes(waitingInput) || surface.includes(pendingStart),
    `idle capability studio copy should include ${waitingInput} or ${pendingStart}, not ${syncing}`,
  );
});

test('ZM15 live acceptance freezes product chat shell instead of workbench prompts', async () => {
  const liveRuntimeAcceptance = await readFile(path.join(root, 'test', 'electron-live-runtime-acceptance.mjs'), 'utf8');
  const css = await readFile(path.join(root, 'src', 'shell', 'app', 'home-surface.css'), 'utf8');

  assert.doesNotMatch(liveRuntimeAcceptance, /prompt:\s*'[^']+'/);
  assert.doesNotMatch(liveRuntimeAcceptance, /生成一张用于织羽图片能力验收/);
  assert.doesNotMatch(liveRuntimeAcceptance, /用于织羽验收的嵌入样本/);
  assert.doesNotMatch(liveRuntimeAcceptance, /织羽伙伴/);
  assert.match(liveRuntimeAcceptance, /当前伙伴/);
  assert.match(liveRuntimeAcceptance, /assertChatCompletedNarrowComposerUsable/);
  assert.match(liveRuntimeAcceptance, /live-runtime-agent-chat-completed-narrow\.png/);
  assert.doesNotMatch(css, /data-nimi-model-config-back="true"\]::after/);
});

test('ZM14R primary model treats 织羽 as the app shell, not the local partner', async () => {
  const surface = await readFile(path.join(root, 'src', 'shell', 'app', 'HomeSurface.tsx'), 'utf8');
  const chrome = await readFile(path.join(root, 'src', 'shell', 'app', 'home-desktop-chat-shell-chrome.tsx'), 'utf8');
  const productShell = [surface, chrome].join('\n');
  const productState = await readFile(path.join(root, 'src', 'shell', 'app', 'home-product-state.ts'), 'utf8');
  const sections = await readFile(path.join(root, 'src', 'shell', 'app', 'home-surface-sections.tsx'), 'utf8');
  const localAgentSelection = await readFile(path.join(root, 'src', 'shell', 'agent', 'local-agent-selection.ts'), 'utf8');

  assert.match(surface, /agentName=\{currentPartnerName\}/);
  assert.match(surface, /emptyEyebrow="ZH IYU"/);
  assert.ok(
    surface.includes("placeholder={hasCurrentPartner ? `向 ${currentPartnerName} 发送消息...` : '先选择本地伙伴...'}"),
    'composer placeholder should talk to the current partner, not to the app brand',
  );
  assert.match(productShell, /data-zhiyu-region="relationship-rail"/);
  assert.match(productState, /title: '选择已存在伙伴'/);
  assert.match(productState, /Desktop Explore/);
  assert.match(productState, /title: '需要先配置模型'/);
  assert.match(localAgentSelection, /zhiyu-realm-materialized-partner-required/);
  assert.doesNotMatch(
    [surface, chrome, productState, localAgentSelection].join('\n'),
    /选择或创建|创建本地伙伴|成为我的伙伴|Create local agent|materialize_runtime_owned_local_agent|select_or_create_realm_materialized_partner/,
    'Zhiyu must not present itself as a local partner creation or materialization surface',
  );
  assert.doesNotMatch(surface, /agentName="织羽"/);
  assert.doesNotMatch(surface, /emptyTitle="开始和织羽对话"/);
  assert.doesNotMatch(surface, /placeholder="向织羽发送消息/);
  assert.doesNotMatch(surface, /织羽是本地伙伴的 home shell/);
  assert.doesNotMatch(surface, /本地伙伴工作台/);
  assert.doesNotMatch(surface, /if \(value === 'Zhiyu Agent'\) return '织羽';/);
  assert.doesNotMatch(sections, /织羽形象/);
  assert.doesNotMatch(productState, /title: '织羽(?:正在|已)/);
  assert.doesNotMatch(productState, /description: '[^']*织羽(?:不会|只|必须|已)/);
});

test('Zhiyu partner empty state points to Desktop Explore without creation CTA', async () => {
  const source = await readHomeSurfaceSource();
  const productState = await readFile(path.join(root, 'src', 'shell', 'app', 'home-product-state.ts'), 'utf8');
  const capabilitySetup = await readFile(path.join(root, 'src', 'shell', 'app', 'home-capability-setup-section.tsx'), 'utf8');
  const imageStudio = await readFile(path.join(root, 'src', 'shell', 'app', 'home-image-studio-section.tsx'), 'utf8');
  const localAgentSelection = await readFile(path.join(root, 'src', 'shell', 'agent', 'local-agent-selection.ts'), 'utf8');
  const localAgentDiscovery = await readFile(path.join(root, 'src', 'shell', 'agent', 'local-agent-discovery.ts'), 'utf8');
  const combined = [
    source,
    productState,
    capabilitySetup,
    imageStudio,
    localAgentSelection,
    localAgentDiscovery,
  ].join('\n');

  assert.match(productState, /当前没有可打开的伙伴/);
  assert.match(productState, /Desktop Explore/);
  assert.doesNotMatch(
    combined,
    /选择或创建|创建本地伙伴|成为我的伙伴|Create local agent|materialize_runtime_owned_local_agent|select_or_create_realm_materialized_partner/,
  );
  assert.doesNotMatch(
    source,
    /localAgentRef:\s*evidence\.localAgent\.localAgentRef\s*\?\?\s*'partner-required'/,
    'empty partner rail must not synthesize a localAgentRef placeholder',
  );
});

test('ZM15 primary shell migrates Desktop agent chat chrome without importing Desktop internals', async () => {
  const surface = await readFile(path.join(root, 'src', 'shell', 'app', 'HomeSurface.tsx'), 'utf8');
  const chrome = await readFile(path.join(root, 'src', 'shell', 'app', 'home-desktop-chat-shell-chrome.tsx'), 'utf8');
  const productShell = [surface, chrome].join('\n');
  const css = await readFile(path.join(root, 'src', 'shell', 'app', 'home-surface.css'), 'utf8');

  assert.match(productShell, /className="zhiyu-home__desktop-logo"/);
  assert.match(productShell, /className="zhiyu-home__desktop-nav-button is-active"/);
  assert.match(surface, /className="zhiyu-home__stage-topbar"/);
  assert.match(productShell, /className="zhiyu-home__relationship-stack"/);
  assert.match(surface, /CanonicalTranscriptView/);
  assert.match(surface, /CanonicalComposer/);
  assert.doesNotMatch(productShell, /apps\/desktop|@renderer\/features\/chat|chat-agent-shell/);

  assert.match(
    css,
    /\.zhiyu-home__layout\.zhiyu-home__shell-grid\s*\{[\s\S]*grid-template-columns:\s*112px minmax\(0,\s*1fr\) 112px;/s,
    'primary shell should use Desktop-style left rail, center chat, and right rail',
  );
  assert.match(
    css,
    /\.zhiyu-home__capability-studio,\s*\.zhiyu-home__image-studio\s*\{[\s\S]*display:\s*none;/s,
    'capability and image workbench panels must not remain first-screen product chrome',
  );
  assert.match(
    css,
    /\.zhiyu-home__composer \[data-canonical-composer-width\]\s*\{[\s\S]*width:\s*min\(760px,\s*100%\);/s,
    'composer should follow the Desktop centered composer width',
  );
});

test('ZM14R primary workspace has no visible engineering copy', async () => {
  const surface = await readFile(path.join(root, 'src', 'shell', 'app', 'HomeSurface.tsx'), 'utf8');
  const chrome = await readFile(path.join(root, 'src', 'shell', 'app', 'home-desktop-chat-shell-chrome.tsx'), 'utf8');
  const productState = await readFile(path.join(root, 'src', 'shell', 'app', 'home-product-state.ts'), 'utf8');
  const memory = await readFile(path.join(root, 'src', 'shell', 'app', 'home-memory-observatory-section.tsx'), 'utf8');
  const companion = await readFile(path.join(root, 'src', 'shell', 'app', 'home-companion-state-section.tsx'), 'utf8');
  const sections = await readFile(path.join(root, 'src', 'shell', 'app', 'home-surface-sections.tsx'), 'utf8');
  const imageStudio = await readFile(path.join(root, 'src', 'shell', 'app', 'home-image-studio-section.tsx'), 'utf8');
  const capabilitySetup = await readFile(path.join(root, 'src', 'shell', 'app', 'home-capability-setup-section.tsx'), 'utf8');
  const primarySurface = surface.slice(0, surface.indexOf('id="zhiyu-diagnostics-drawer"'));
  const avatarSection = sections.slice(
    sections.indexOf('export function AvatarPresenceSection'),
    sections.indexOf('export function IdentityFloorSection'),
  );
  const primaryCopy = [
    extractProductFacingText(chrome),
    extractProductFacingText(primarySurface),
    extractProductFacingText(productState),
    extractProductFacingText(memory),
    extractProductFacingText(companion),
    extractProductFacingText(avatarSection),
    extractProductFacingText(imageStudio),
    extractProductFacingText(capabilitySetup),
  ].join('\n');

  assert.doesNotMatch(
    primaryCopy,
    /上游投影|准入来源|等待投影|not_projected|Runtime\b|SDK\b|sourceRef|localAgentRef|回显通路|身份地板|graph-lite/,
    'primary workspace copy must keep engineering vocabulary in diagnostics or data attributes only',
  );
  assert.match(primaryCopy, /本地环境状态/);
  assert.match(primaryCopy, /当前伙伴/);
  assert.match(primaryCopy, /本地伙伴/);
});

test('ZM14R unavailable capabilities collapse to a single action instead of disabled button piles', async () => {
  const developerBackstage = await readDeveloperBackstageSource();
  const capabilitySetup = await readFile(path.join(root, 'src', 'shell', 'app', 'home-capability-setup-section.tsx'), 'utf8');
  const imageStudio = await readFile(path.join(root, 'src', 'shell', 'app', 'home-image-studio-section.tsx'), 'utf8');
  const liveRuntimeAcceptance = await readFile(path.join(root, 'test', 'electron-live-runtime-acceptance.mjs'), 'utf8');

  assert.match(developerBackstage, /HomeCapabilitySetupSection/);
  assert.match(capabilitySetup, /data-zhiyu-capability-setup-action/);
  assert.match(developerBackstage, /showCapabilityStudio/);
  assert.match(imageStudio, /renderImageStudioSetup/);
  assert.match(liveRuntimeAcceptance, /data-zhiyu-capability-setup-action="configure-model"/);
  assert.match(liveRuntimeAcceptance, /data-zhiyu-image-studio-setup-action="configure-model"/);
  assert.doesNotMatch(
    liveRuntimeAcceptance,
    /data-zhiyu-capability-studio-run="text\.generate"\]\.isDisabled\(\), true/,
    'model-unconfigured acceptance should not expect a pile of disabled text capability buttons',
  );
  assert.doesNotMatch(
    liveRuntimeAcceptance,
    /data-zhiyu-image-generate-run="image\.generate"\]\.isDisabled\(\), true/,
    'model-unconfigured acceptance should not expect a disabled image-generation button as the primary state',
  );
});

test('ZM14R Electron acceptance records no-partner partner-selected and model configuration product states', async () => {
  const liveRuntimeAcceptance = await readFile(path.join(root, 'test', 'electron-live-runtime-acceptance.mjs'), 'utf8');

  assert.match(liveRuntimeAcceptance, /live-runtime-no-partner-desktop\.png/);
  assert.match(liveRuntimeAcceptance, /live-runtime-no-partner-narrow\.png/);
  assert.match(liveRuntimeAcceptance, /live-runtime-partner-selected-desktop\.png/);
  assert.match(liveRuntimeAcceptance, /live-runtime-partner-selected-narrow\.png/);
  assert.match(liveRuntimeAcceptance, /live-runtime-model-unconfigured-desktop\.png/);
  assert.match(liveRuntimeAcceptance, /live-runtime-model-unconfigured-narrow\.png/);
  assert.match(liveRuntimeAcceptance, /live-runtime-model-configured-desktop\.png/);
  assert.match(liveRuntimeAcceptance, /live-runtime-model-configured-narrow\.png/);
  assert.match(liveRuntimeAcceptance, /assertNoPartnerProductState/);
  assert.match(liveRuntimeAcceptance, /assertPartnerSelectedProductState/);
  assert.match(liveRuntimeAcceptance, /assertModelUnconfiguredProductState/);
  assert.match(liveRuntimeAcceptance, /assertModelConfiguredProductState/);
});

function stripTechnicalAttributes(source) {
  return String(source)
    .replace(/\sdata-[\w-]+=(?:"[^"]*"|\{[^}]*\})/g, '')
    .replace(/\saria-[\w-]+=(?:"[^"]*"|\{[^}]*\})/g, '')
    .replace(/\sclassName=(?:"[^"]*"|\{[^}]*\})/g, '')
    .replace(/\skey=(?:"[^"]*"|\{[^}]*\})/g, '')
    .replace(/\s(?:source|reasonCode|actionHint|traceId|runtimeSourceRef|localAgentRef|sourceRef):[^,\n]+[,;]/g, '');
}

function extractProductFacingText(source) {
  const stripped = stripTechnicalAttributes(source);
  const snippets = [];
  for (const match of stripped.matchAll(/>([^<>{}\n]*[\u4e00-\u9fff][^<>{}\n]*)</g)) {
    const text = match[1].replace(/\s+/g, ' ').trim();
    if (text) snippets.push(text);
  }
  for (const match of stripped.matchAll(/\b(?:title|description|placeholder|emptyTitle|emptyDescription|emptyEyebrow|aria-label):\s*'([^']*)'/g)) {
    snippets.push(match[1]);
  }
  for (const match of stripped.matchAll(/\b(?:placeholder|emptyTitle|emptyDescription|emptyEyebrow|aria-label)="([^"]*)"/g)) {
    snippets.push(match[1]);
  }
  for (const match of stripped.matchAll(/\b(?:title|description|actionHint|stateLabel):\s*'([^']*)'/g)) {
    snippets.push(match[1]);
  }
  if (stripped.includes('本地环境状态')) {
    snippets.push('本地环境状态');
  }
  return snippets.join('\n');
}
