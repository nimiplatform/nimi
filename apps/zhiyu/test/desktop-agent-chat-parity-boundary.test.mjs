import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const appRoot = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(appRoot, '..', '..');
const productionRoot = path.join(appRoot, 'src');
const productionFilePattern = /\.(?:c|m)?(?:ts|tsx|js|jsx)$/;
const importSpecifierPattern =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;

const oldProductionPaths = [
  'src/shell/agent/runtime-agent-chat.ts',
  'src/shell/agent/runtime-agent-scopes.ts',
  'src/shell/agent/route-projection.ts',
  'src/shell/agent/turn-readiness.ts',
  'src/shell/app/home-desktop-chat-shell-chrome.tsx',
];

const oldImportFragments = [
  'shell/agent/runtime-agent-chat',
  'shell/agent/runtime-agent-scopes',
  'shell/agent/route-projection',
  'shell/agent/turn-readiness',
  'shell/app/home-desktop-chat-shell-chrome',
];

const agentChatParitySourceFiles = [
  'src/shell/agent-chat/ZhiyuAgentChatSurface.tsx',
  'src/shell/agent-chat/ZhiyuAgentRightPanel.tsx',
  'src/shell/agent-chat/ZhiyuAgentAppearancePanel.tsx',
  'src/shell/agent-chat/ZhiyuAgentChatPieces.tsx',
  'src/shell/agent-chat/ZhiyuAgentChatLabels.ts',
  'src/shell/agent-chat/ZhiyuAgentPanel.tsx',
];

const liveRuntimeAcceptanceSourceFiles = [
  'test/electron-live-runtime-acceptance.mjs',
  'test/electron-live-runtime-acceptance-helpers.mjs',
  'test/electron-live-runtime-delegation-helpers.mjs',
  'src/shell/auth/electron-sdk-acceptance.ts',
];

const requiredDesktopSources = [
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-adapter.tsx',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-mode-content.tsx',
  'apps/desktop/src/shell/renderer/features/chat/chat-canonical-mode-frame.tsx',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-presentation.tsx',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-presentation-types.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-presentation-settings.tsx',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-view-model.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-visible-state.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-adapter-state.ts',
  'runtime.agent.state.SubscribeAgentEvents',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-diagnostics-view-model.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-thread-model.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-visible-projection-store.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-adapter-session-snapshot.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-session-hydration.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-shared-runtime-stream-ui.tsx',
  'kit/features/chat/src/components/canonical-transcript-view.tsx',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-canonical-composer.tsx',
  'kit/features/chat/src/components/canonical-composer.tsx',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-submit-driver.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-submit-session.ts',
  'apps/desktop/src/shell/renderer/app-shell/providers/agent-conversation-anchor-binding-storage.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-host-actions-helpers.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-host-actions-submit.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-host-actions-submit-helpers.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-host-actions-submit-run.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-submit-outcome.ts',
  'apps/desktop/src/shell/renderer/features/chat/conversation-capability.ts',
  'apps/desktop/src/shell/renderer/features/chat/conversation-capability-projection.ts',
  'apps/desktop/src/shell/renderer/features/chat/conversation-submit-readiness.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-shared-settings-panel.tsx',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-runtime-agent.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-runtime-provider.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-adapter-attachments.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-user-projection.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-shared-thinking.ts',
  'kit/features/agent-center/src/components/AgentCenter.tsx',
  'apps/desktop/src/shell/renderer/features/chat/chat-shared-side-sheet.tsx',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-center-panel-components.tsx',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-cognition-panel.tsx',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-avatar-settings-content.tsx',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-center-avatar-config-types.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-center-local-config.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-center-avatar-config-mutation.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-center-avatar-config-validation.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-center-live2d-calibration-workbench.tsx',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-center-live2d-calibration-workbench-model.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-center-avatar-debug-workbench.tsx',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-center-avatar-debug-workbench-model.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-avatar-asset-diagnostics.ts',
  'apps/desktop/src/shell/renderer/bridge/runtime-bridge/chat-agent-center-local-config-store.ts',
  'apps/desktop/src-tauri/src/desktop_agent_center_store/resources_avatar_import.rs',
  'apps/desktop/src-tauri/src/desktop_agent_center_store/resources_background_import.rs',
  'apps/desktop/src-tauri/src/desktop_agent_center_store/resources_live2d_adapter_import.rs',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-local-avatar-launch-controls.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-local-avatar-controls.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-background-settings-content.tsx',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-avatar-live2d-viewport.tsx',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-avatar-vrm-viewport.tsx',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-avatar-live2d-diagnostics.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-avatar-vrm-diagnostics.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-voice-capture.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-adapter-voice.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-voice-transcribe-runtime.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-manual-voice-playback-button.tsx',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-manual-voice-request.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-diagnostics.tsx',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-diagnostics-content.tsx',
  'apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap.ts',
  'apps/desktop/src/shell/renderer/app-shell/layouts/main-layout-topbar.tsx',
  'apps/desktop/src/shell/renderer/app-shell/layouts/main-layout-settings-menu.tsx',
  'apps/desktop/src/shell/renderer/features/chat/chat-page.tsx',
];

test('Desktop Agent Chat hardcut removes old Zhiyu chat, binding, route, and shell paths', async () => {
  const files = await collectProductionFiles(productionRoot);
  const violations = [];

  for (const relativePath of oldProductionPaths) {
    if (existsSync(path.join(appRoot, relativePath))) {
      violations.push(`${relativePath}: old production file still exists`);
    }
  }

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const relativePath = path.relative(appRoot, file).replaceAll(path.sep, '/');

    for (const specifier of importSpecifiers(source)) {
      const normalized = specifier.replaceAll('\\', '/');
      if (oldImportFragments.some((fragment) => normalized.includes(fragment))) {
        violations.push(`${relativePath}: forbidden old-path import ${specifier}`);
      }
    }

    if (/\bexport\s+\*\s+from\s+['"][^'"]*(?:runtime-agent-chat|runtime-agent-scopes|route-projection|turn-readiness|home-desktop-chat-shell-chrome)/.test(source)) {
      violations.push(`${relativePath}: forbidden forwarding export for old path`);
    }
  }

  assert.deepEqual(violations, []);
});

test('Desktop Agent Chat hardcut forbids pseudo binding proof and transcript masking helpers', async () => {
  const files = await collectProductionFiles(productionRoot);
  const violations = [];

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const relativePath = path.relative(appRoot, file).replaceAll(path.sep, '/');

    if (/\bwithZhiyuElectronRuntimeProtectedScopes\b/.test(source)) {
      violations.push(`${relativePath}: old protected scopes helper is not Runtime binding proof`);
    }
    if (/\boperation\s*\(\s*\{\s*\}\s*\)/.test(source)) {
      violations.push(`${relativePath}: empty call options are not Runtime binding proof`);
    }
    for (const helperName of [
      'productGeneratedText',
      'productSenderName',
      'productPartnerDisplayName',
      'localAgentContactSubtitle',
    ]) {
      if (new RegExp(`\\b${helperName}\\b`).test(source)) {
        violations.push(`${relativePath}: transcript masking helper ${helperName}`);
      }
    }
    if (/\bsourceWorldId\s*\?\.\s*includes\s*\(/.test(source) || /\bsourceWorldId\s*&&\s*[^;\n]*\.includes\s*\(/.test(source)) {
      violations.push(`${relativePath}: source world id substring checks are not identity/world display proof`);
    }
    if (/['"]唐代文人世界['"]/.test(source)) {
      violations.push(`${relativePath}: hardcoded world display label is not Runtime/Inventory source projection`);
    }
  }

  assert.deepEqual(violations, []);
});

test('Desktop Agent Chat provenance map covers required UI and side-capability sources', async () => {
  const sourceMapPath = path.join(appRoot, 'src', 'shell', 'agent-chat', 'desktop-source-map.ts');
  assert.equal(existsSync(sourceMapPath), true, `${sourceMapPath} should exist`);

  const source = await readFile(sourceMapPath, 'utf8');
  for (const desktopSource of requiredDesktopSources) {
    assert.match(source, new RegExp(escapeRegExp(desktopSource)), `${desktopSource} missing from provenance map`);
  }

  const mappedPathLiterals = [...source.matchAll(/['"]((?:apps\/desktop|apps\/zhiyu|kit)\/[^'"]+)['"]/g)]
    .map((match) => match[1]);
  for (const mappedPath of mappedPathLiterals) {
    assert.equal(
      existsSync(path.join(repoRoot, mappedPath)),
      true,
      `${mappedPath} is listed in Desktop Agent Chat provenance but does not exist`,
    );
  }
});

test('Desktop Agent Chat Runtime binding host equivalence is Electron-host owned and fail-closed', async () => {
  const preloadSource = await readFile(path.join(appRoot, 'src-electron', 'preload.cts'), 'utf8');
  assert.match(preloadSource, /__nimiZhiyuRuntimeAgentBinding/);
  assert.match(preloadSource, /runtime-sdk-authority:kit-electron-runtime-bridge-local-first-party-host/);
  assert.match(preloadSource, /authority:\s*['"]runtime-sdk['"]/);
  assert.match(preloadSource, /failureSemantics:\s*['"]fail-closed['"]/);
});

test('primary agent chat surface does not import Capability Studio direct AI consume path', async () => {
  const files = await collectProductionFiles(path.join(productionRoot, 'shell'));
  const violations = [];

  for (const file of files) {
    const relativePath = path.relative(appRoot, file).replaceAll(path.sep, '/');
    if (!relativePath.includes('/agent-chat/') && !relativePath.endsWith('App.tsx')) {
      continue;
    }

    const source = await readFile(file, 'utf8');
    for (const specifier of importSpecifiers(source)) {
      if (specifier.includes('capability-studio/zhiyu-ai-consume')) {
        violations.push(`${relativePath}: primary chat path imports direct AI consume helper`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test('Agent Center appearance config keeps Desktop avatar, background, and Live2D workbench structure', async () => {
  const source = await readAgentChatSource();

  for (const marker of [
    'data-zhiyu-agent-appearance-panel="true"',
    'data-zhiyu-agent-center-local-config',
    'getZhiyuAgentCenterLocalConfig',
    'importZhiyuAgentCenterAvatarAsset',
    'data-zhiyu-avatar-import-action="live2d-adapter"',
    'data-zhiyu-avatar-import-action="clear"',
    'data-zhiyu-avatar-import-state={state}',
    'data-zhiyu-live2d-workbench="true"',
    'data-zhiyu-agent-background-card={localConfig.ready ? \'electron-local-config\' : \'blocked\'}',
    'data-zhiyu-background-import-action="import"',
    'data-zhiyu-background-import-action="clear"',
    'data-zhiyu-avatar-policy-row',
    'data-zhiyu-avatar-debug-shortcut',
    'data-zhiyu-avatar-advanced-diagnostics="deferred"',
  ]) {
    assert.match(source, new RegExp(escapeRegExp(marker)), `${marker} missing from Zhiyu Agent Center appearance config`);
  }

  assert.match(source, /kind="live2d"[\s\S]*title="导入 Live2D 文件夹"/);
  assert.match(source, /kind="vrm"[\s\S]*title="导入 VRM 文件"/);
  assert.match(source, /itemId:\s*'adapter_manifest'/);

  assert.doesNotMatch(
    source,
    /data-zhiyu-agent-background-card="deferred"/,
    'Background configuration must use Zhiyu Electron local config bridge instead of deferred proof',
  );
  assert.doesNotMatch(
    source,
    /data-zhiyu-avatar-import-state="deferred"/,
    'Avatar import controls must not pass parity by staying deferred',
  );
});

test('Agent Center placement delegates section navigation to Kit instead of owning checklist actions', async () => {
  const source = await readAgentChatSource();

  assert.match(
    source,
    /@nimiplatform\/kit\/features\/agent-center/,
    'Zhiyu Agent Center placement must consume the Kit Agent Center surface',
  );
  assert.match(
    source,
    /activeSection=\{props\.activeTab\}/,
    'Zhiyu placement must pass active section into Kit Agent Center',
  );
  assert.match(
    source,
    /onSectionChange=\{props\.onActiveTabChange\}/,
    'Zhiyu placement must let Kit section buttons drive section changes',
  );
  assert.doesNotMatch(
    source,
    /zhiyu-agent-center__setup-hero/,
    'Zhiyu must not keep a parallel overview checklist inside Agent Center',
  );
});

test('streaming chat exposes a product stop control wired to the active turn abort path', async () => {
  const surfaceSource = await readFile(path.join(appRoot, 'src', 'shell', 'agent-chat', 'ZhiyuAgentChatSurface.tsx'), 'utf8');
  const appSource = await readFile(path.join(appRoot, 'src', 'shell', 'app', 'App.tsx'), 'utf8');

  for (const marker of [
    'readonly onStopChat: () => void;',
    'data-zhiyu-chat-stop-action="true"',
    'aria-label="停止当前回复"',
    'onClick={onStopChat}',
    'data-zhiyu-agent-chat-stop-state="available"',
  ]) {
    assert.match(surfaceSource, new RegExp(escapeRegExp(marker)), `${marker} missing from streaming stop UI`);
  }

  assert.match(appSource, /function handleStopChat\(\)/, 'App must expose a product stop handler');
  assert.match(appSource, /activeChatAbortRef\.current\?\.abort\('zhiyu_chat_turn_user_stopped'\)/, 'Stop handler must abort the active Runtime turn');
  assert.match(appSource, /if \(activeChatAbort\.signal\.aborted\)/, 'Aborted turns must not overwrite the user-canceled state when the Runtime promise settles');
  assert.match(appSource, /onStopChat=\{handleStopChat\}/, 'Stop handler must be passed to the agent chat surface');
});

test('Runtime action and artifact events are product-visible or explicitly deferred', async () => {
  const surfaceSource = await readAgentChatSource();
  const acceptanceSource = await readLiveRuntimeAcceptanceSource();

  for (const marker of [
    'data-zhiyu-runtime-action-artifact-summary="true"',
    'data-zhiyu-runtime-action-count',
    'data-zhiyu-runtime-artifact-count',
    'data-zhiyu-runtime-action-artifact-preview={summary.previewState}',
    'data-zhiyu-runtime-action-artifact-preview-reason={summary.previewReason}',
    'runtime-agent-turn-artifact-ready-image-rendered',
    'zhiyu-runtime-artifact-preview-uri-not-admitted',
    'metadata?.artifacts',
  ]) {
    assert.match(`${surfaceSource}\n${acceptanceSource}`, new RegExp(escapeRegExp(marker)), `${marker} missing from Runtime action/artifact visible parity`);
  }

  for (const marker of [
    'actionArtifact',
    'artifact-ready',
    'beat-planned',
    'data-zhiyu-runtime-action-artifact-summary="true"',
    'live-runtime-action-artifact-desktop.png',
    'live-runtime-action-artifact-evidence.json',
  ]) {
    assert.match(acceptanceSource, new RegExp(escapeRegExp(marker)), `${marker} missing from live Runtime action/artifact acceptance`);
  }
});

test('live Runtime acceptance captures streaming UI before exercising stop cancel', async () => {
  const acceptanceSource = await readLiveRuntimeAcceptanceSource();
  const streamingCaptureIndex = acceptanceSource.indexOf("captureLiveRuntimeEvidence(page, 'chatStreaming'");
  const stopClickIndex = acceptanceSource.indexOf('await stopButton.click();');

  assert.notEqual(streamingCaptureIndex, -1, 'live Runtime acceptance must capture the active streaming UI state');
  assert.notEqual(stopClickIndex, -1, 'live Runtime acceptance must exercise the product stop action');
  assert.ok(
    streamingCaptureIndex < stopClickIndex,
    'streaming screenshot/evidence must be captured before clicking stop, otherwise U08 visual parity is unproven',
  );
});

test('live Runtime acceptance captures multi-turn transcript continuity', async () => {
  const acceptanceSource = await readLiveRuntimeAcceptanceSource();
  const completedCaptureIndex = acceptanceSource.indexOf("captureLiveRuntimeEvidence(page, 'chatCompleted'");
  const multiTurnCaptureIndex = acceptanceSource.indexOf("captureLiveRuntimeEvidence(page, 'chatMultiTurn'");

  assert.notEqual(completedCaptureIndex, -1, 'live Runtime acceptance must capture the first completed chat turn');
  assert.notEqual(multiTurnCaptureIndex, -1, 'live Runtime acceptance must capture multi-turn continuity evidence');
  assert.ok(
    completedCaptureIndex < multiTurnCaptureIndex,
    'multi-turn continuity must be verified after the first completed turn',
  );

  for (const marker of [
    'chatMultiTurn:',
    'live-runtime-agent-chat-multi-turn-desktop.png',
    'live-runtime-agent-chat-multi-turn-narrow.png',
    'live-runtime-agent-chat-multi-turn-evidence.json',
    'live-runtime-agent-chat-multi-turn-panel.png',
    'transcriptBottomGap',
  ]) {
    assert.match(
      acceptanceSource,
      new RegExp(escapeRegExp(marker)),
      `${marker} missing from live Runtime multi-turn acceptance evidence`,
    );
  }

  assert.match(acceptanceSource, /requestId:\s*firstRequestId/);
  assert.match(acceptanceSource, /conversationAnchorId:\s*readyEvidence\.conversation\.conversationAnchorId/);
  assert.match(acceptanceSource, /messageCount\s*>=\s*4/);
});

test('live Runtime acceptance captures restart snapshot hydration continuity', async () => {
  const acceptanceSource = await readLiveRuntimeAcceptanceSource();
  const multiTurnCaptureIndex = acceptanceSource.indexOf("captureLiveRuntimeEvidence(page, 'chatMultiTurn'");
  const restartCaptureIndex = acceptanceSource.indexOf("captureLiveRuntimeEvidence(relaunchedPage, 'chatRestartHydrated'");

  assert.notEqual(multiTurnCaptureIndex, -1, 'live Runtime acceptance must capture multi-turn continuity evidence');
  assert.notEqual(restartCaptureIndex, -1, 'live Runtime acceptance must capture restart hydration evidence');
  assert.ok(
    multiTurnCaptureIndex < restartCaptureIndex,
    'restart hydration must be verified after multi-turn transcript continuity is established',
  );

  for (const marker of [
    'chatRestartHydrated:',
    'restart hydrated Runtime Agent chat snapshot',
    'runtime-agent-session-snapshot-hydrated',
    'live-runtime-agent-chat-restart-hydrated-desktop.png',
    'live-runtime-agent-chat-restart-hydrated-narrow.png',
    'live-runtime-agent-chat-restart-hydrated-evidence.json',
    'live-runtime-agent-chat-restart-hydrated-panel.png',
    'const relaunchedApp = await launchLiveRuntimeZhiyuApp({ fixture, dataRoot });',
  ]) {
    assert.match(
      acceptanceSource,
      new RegExp(escapeRegExp(marker)),
      `${marker} missing from live Runtime restart hydration acceptance evidence`,
    );
  }

  assert.match(acceptanceSource, /await app\.close\(\);/);
  assert.match(acceptanceSource, /conversationAnchorId:\s*readyEvidence\.conversation\.conversationAnchorId/);
  assert.match(acceptanceSource, /messageCount\s*>=\s*4/);
});

test('live Runtime acceptance verifies Runtime-issued delegation scoped binding renewal', async () => {
  const acceptanceSource = await readLiveRuntimeAcceptanceSource();

  for (const marker of [
    'renewDelegationScopedBinding',
    'zhiyu-runtime-agent-scoped-binding-renewed',
    'Runtime scoped binding renewal must issue a fresh binding instead of replaying the initial idempotency key',
    'renewedScopedBinding',
    'bindingSource, \'runtime-account-service\'',
    'preConfigScopedBinding.bindingId',
  ]) {
    assert.match(
      acceptanceSource,
      new RegExp(escapeRegExp(marker)),
      `${marker} missing from live Runtime scoped-binding renewal acceptance`,
    );
  }
});

test('chat voice controls project Runtime voice truth without settings-only pseudo affordances', async () => {
  const surfaceSource = await readAgentChatSource();

  for (const marker of [
    'data-zhiyu-composer-tool="voice-capture"',
    'data-zhiyu-chat-voice-capture-state="deferred"',
    'data-zhiyu-chat-voice-capture-reason="zhiyu-chat-voice-capture-runtime-surface-deferred"',
    'data-zhiyu-composer-tool="hands-free"',
    'data-zhiyu-chat-voice-state={voiceState}',
    'data-zhiyu-chat-voice-reason={voiceReason}',
    'data-zhiyu-chat-voice-output-mode={voiceOutputMode}',
    'data-zhiyu-chat-voice-playback-state={voicePlaybackState}',
    'data-zhiyu-chat-voice-audio-artifact-id={voiceAudioArtifactId}',
    'data-zhiyu-chat-voice-playback-target={voicePlaybackTarget}',
    'zhiyu-chat-voice-runtime-projected',
    'zhiyu-chat-voice-runtime-surface-deferred',
    'disabled',
  ]) {
    assert.match(surfaceSource, new RegExp(escapeRegExp(marker)), `${marker} missing from Runtime voice UI`);
  }

  assert.doesNotMatch(
    surfaceSource,
    /voiceState=\{\{\s*status:\s*'idle'[\s\S]*?onToggle:\s*\(\)\s*=>\s*setRightPanelMode\('settings'\)/,
    'Chat voice must not appear as an idle interactive control that only opens settings',
  );
  assert.doesNotMatch(
    surfaceSource,
    /data-zhiyu-composer-tool="hands-free"[\s\S]{0,220}onClick=\{onOpenSettings\}/,
    'Hands-free voice tool must not be a settings-only pseudo action',
  );
  assert.doesNotMatch(
    surfaceSource,
    /data-zhiyu-composer-tool="voice-capture"[\s\S]{0,220}onClick=\{onOpenSettings\}/,
    'Voice capture tool must not be a settings-only pseudo action',
  );
});

test('Agent Center section buttons come from Kit active-page semantics', async () => {
  const surfaceSource = await readAgentChatSource();
  const kitSource = await readFile(path.join(repoRoot, 'kit', 'features', 'agent-center', 'src', 'components', 'AgentCenter.tsx'), 'utf8');

  assert.match(surfaceSource, /<AgentCenter/);
  assert.match(kitSource, /data-testid=\{`chat-agent-center-section:\$\{section\}`\}/);
  assert.match(kitSource, /aria-current=\{selected \? 'page' : undefined\}/);
  assert.match(kitSource, /aria-pressed=\{selected\}/);
});

test('Agent Center header mirrors Desktop side-sheet identity metadata', async () => {
  const surfaceSource = await readAgentChatSource();

  for (const marker of [
    'data-zhiyu-agent-center-eyebrow="AGENT CENTER"',
    'data-zhiyu-agent-center-local-agent-ref',
    'data-zhiyu-agent-center-world-chip',
    'agentCenterLocalAgentRef(props.evidence)',
    'agentCenterWorldLabel(props.evidence)',
  ]) {
    assert.match(sourceWithNormalizedWhitespace(surfaceSource), new RegExp(escapeRegExp(marker)), `${marker} missing from Desktop Agent Center header metadata`);
  }

  assert.doesNotMatch(
    surfaceSource,
    /<span>\{mode === 'settings' \? '织羽设置' : '伙伴中心'\}<\/span>/,
    'Agent mode header must use the Desktop AGENT CENTER eyebrow instead of the old Zhiyu-only label',
  );
});

test('Agent Center model section projects Runtime execution config and excludes Zhiyu AIConfig settings', async () => {
  const zhiyuSettingsSource = await readFile(path.join(appRoot, 'src', 'shell', 'ai-config', 'zhiyu-ai-config-settings.tsx'), 'utf8');
  const rightPanelSource = await readFile(path.join(appRoot, 'src', 'shell', 'agent-chat', 'ZhiyuAgentRightPanel.tsx'), 'utf8');
  const kitModelSource = await readFile(path.join(repoRoot, 'kit', 'features', 'agent-center', 'src', 'components', 'AgentCenterModelSection.tsx'), 'utf8');

  assert.match(rightPanelSource, /buildZhiyuAgentCenterState/);
  assert.match(rightPanelSource, /executionConfig:\s*buildExecutionConfig\(evidence\)/);
  assert.match(rightPanelSource, /readiness:\s*buildReadiness\(evidence\)/);
  assert.doesNotMatch(rightPanelSource, /ZhiyuAiConfigSettings|data-zhiyu-ai-config-embedded|modelConfigContent/);
  assert.doesNotMatch(zhiyuSettingsSource, /data-zhiyu-ai-config-embedded="agent-center"/);
  assert.match(kitModelSource, /capability\.editable \? 'Editable' : 'Read-only projection'/);
  assert.match(kitModelSource, /capability\.binding\?\.modelId \|\| 'Not configured'/);
});

test('Zhiyu presence rail does not keep migrated Desktop topbar, nav, or add chrome', async () => {
  const railSource = await readFile(path.join(appRoot, 'src', 'shell', 'agent-chat', 'ZhiyuAgentPanel.tsx'), 'utf8');

  for (const forbidden of [
    'data-zhiyu-topbar-chrome="true"',
    'data-zhiyu-topbar-notifications="true"',
    'data-zhiyu-topbar-account="true"',
    'data-zhiyu-notification-state="deferred"',
    'data-zhiyu-account-menu="true"',
    'data-zhiyu-primary-action',
    'data-zhiyu-diagnostics-entry',
    'data-zhiyu-diagnostics-toggle',
    'zhiyu-home__desktop-nav',
    'zhiyu-home__agent-bubble--add',
  ]) {
    assert.doesNotMatch(railSource, new RegExp(escapeRegExp(forbidden)), `${forbidden} must not remain in Zhiyu presence rail`);
  }

  assert.doesNotMatch(railSource, /\bBell\b/, 'Zhiyu must not keep the removed notification icon affordance');
  assert.doesNotMatch(railSource, /\bPlus\b/, 'Zhiyu must not keep the removed add-partner action chrome');
  assert.doesNotMatch(railSource, /\bMessageSquare\b|\bDatabase\b|\bImage\b|\bPanelRightOpen\b/, 'Zhiyu must not keep the deleted left navigation chrome');
  assert.match(railSource, /data-zhiyu-settings-entry="presence-rail"/, 'Presence rail must keep the Agent Center settings entry');
  assert.match(railSource, /onOpenSettings/, 'Presence rail settings must connect back to the merged Agent Center settings tab');
});

test('Desktop settings entry does not keep a second Zhiyu-only right panel implementation', async () => {
  const surfaceSource = await readAgentChatSource();

  for (const forbidden of [
    'RightSettingsPanel',
    'data-zhiyu-settings-panel="right"',
    'data-zhiyu-agent-panel-mode="settings"',
    "setRightPanelMode('settings')",
    "RightPanelMode = 'agent' | 'settings' | 'closed'",
    '偏好与后台',
    '设置项',
  ]) {
    assert.doesNotMatch(
      surfaceSource,
      new RegExp(escapeRegExp(forbidden)),
      `${forbidden} must not remain as a second Zhiyu-only settings implementation`,
    );
  }

  assert.match(
    surfaceSource,
    /const openAdvancedSettings = \(\) => \{[\s\S]{0,160}setRightPanelMode\('agent'\);[\s\S]{0,160}setActiveAgentTab\('advanced'\);[\s\S]{0,160}\};/,
    'Desktop rail settings entry must route into the merged Agent Center advanced/settings tab',
  );
  assert.match(
    surfaceSource,
    /onOpenSettings=\{openAdvancedSettings\}/,
    'Presence rail settings entry must use the merged Agent Center settings route',
  );
  assert.match(
    surfaceSource,
    /const openAppearanceConfig = \(\) => \{[\s\S]{0,160}setRightPanelMode\('agent'\);[\s\S]{0,160}setActiveAgentTab\('appearance'\);[\s\S]{0,160}\};/,
    'Avatar setup entry must route into the existing Agent Center appearance tab',
  );
  assert.match(
    surfaceSource,
    /const openBehaviorConfig = \(\) => \{[\s\S]{0,160}setRightPanelMode\('agent'\);[\s\S]{0,160}setActiveAgentTab\('behavior'\);[\s\S]{0,160}\};/,
    'Composer proactive entry must route into the existing Agent Center behavior tab',
  );
});

test('Desktop shell left rail uses migrated Nimi logo asset instead of a placeholder icon', async () => {
  const railSource = await readFile(path.join(appRoot, 'src', 'shell', 'agent-chat', 'ZhiyuAgentPanel.tsx'), 'utf8');
  const logoAssetPath = path.join(appRoot, 'src', 'shell', 'assets', 'logo.png');

  assert.equal(existsSync(logoAssetPath), true, 'Zhiyu must carry a local migrated Nimi logo PNG asset');
  assert.match(railSource, /import\s+nimiLogoImage\s+from\s+['"]\.\.\/assets\/logo\.png['"]/);
  assert.match(railSource, /data-zhiyu-desktop-logo-image="nimi"/);
  assert.match(railSource, /src=\{nimiLogoImage\}/);
  assert.doesNotMatch(
    railSource,
    /\bSparkles\b/,
    'Zhiyu Desktop shell left rail must not use a Sparkles placeholder as the brand mark',
  );
});

test('Desktop contacts rail keeps compact density inside the left presence rail', async () => {
  const railSource = await readFile(path.join(appRoot, 'src', 'shell', 'agent-chat', 'ZhiyuAgentPanel.tsx'), 'utf8');
  const css = await readFile(path.join(appRoot, 'src', 'shell', 'app', 'home-surface.css'), 'utf8');
  const shellGridRule = lastCssRule(css, '.zhiyu-agent-chat__layout');

  assert.match(railSource, /data-zhiyu-relationship-rail-density="desktop"/);
  assert.match(railSource, /data-zhiyu-settings-entry="presence-rail"/);
  assert.doesNotMatch(railSource, /data-zhiyu-model-config-entry="rail"/);
  assert.doesNotMatch(railSource, /data-zhiyu-diagnostics-entry="rail"/);
  assert.doesNotMatch(railSource, /data-zhiyu-avatar-launch-entry=\{avatarLaunchAction\.state\}/);
  assert.match(shellGridRule, /grid-template-columns:\s*76px minmax\(0,\s*1fr\) 500px;/);
  assert.match(shellGridRule, /gap:\s*0;/);
  assert.doesNotMatch(css, /zhiyu-home__right-rail|zhiyu-home__desktop-nav|zhiyu-home__agents-rail|grid-template-areas:\s*"[^"]*relationship/);
  assert.match(
    css,
    /\.zhiyu-agent-rail__agent,\s*\.zhiyu-agent-rail__tools button\s*\{[\s\S]*?width:\s*40px;[\s\S]*?height:\s*40px;/,
  );
  assert.doesNotMatch(css, /\.zhiyu-agent-rail__agent\s*\{[^}]*width:\s*56px;[^}]*height:\s*56px;/);
  assert.doesNotMatch(css, /zhiyu-home__topbar-(?:chrome|button|popover)/);
  assert.doesNotMatch(css, /zhiyu-home__agent-bubble--add/);
});

test('Desktop Agent Center is closed by default and closed layout centers the chat track', async () => {
  const surfaceSource = await readAgentChatSource();
  const css = await readFile(path.join(appRoot, 'src', 'shell', 'app', 'home-surface.css'), 'utf8');

  assert.match(
    surfaceSource,
    /const \[rightPanelMode,\s*setRightPanelMode\] = useState<RightPanelMode>\('closed'\);/,
    'Agent Center must be closed by default; explicit settings/model/avatar actions open it',
  );
  assert.match(
    css,
    /\.zhiyu-agent-chat__layout\.is-side-closed\s*\{\s*grid-template-columns:\s*76px minmax\(0,\s*1fr\);[\s\S]*grid-template-areas:\s*"presence conversation";/,
    'closed layout must only keep the presence rail and centered conversation track',
  );
  assert.doesNotMatch(
    css,
    /\.zhiyu-agent-chat__layout\.is-side-closed\s*\{[\s\S]*?grid-template-areas:\s*"presence conversation \. relationship";/,
    'closed layout must not reserve an Agent Center grid area when the panel is closed',
  );
  assert.match(
    css,
    /\.zhiyu-chat-canvas__transcript\s+\[data-canonical-transcript-width\][\s\S]*?\.zhiyu-chat-canvas__composer\s+\[data-canonical-composer-width\][\s\S]*?\{[\s\S]*?margin-right:\s*auto;[\s\S]*?margin-left:\s*auto;/,
    'closed layout must center transcript and composer content inside the conversation track',
  );
  assert.match(
    css,
    /\.zhiyu-chat-canvas__composer\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;/,
    'composer container must keep the Kit canonical composer responsive inside the chat canvas',
  );
  assert.match(
    css,
    /@media \(max-width:\s*980px\)[\s\S]*?\.zhiyu-agent-chat__layout,\s*\.zhiyu-agent-chat__layout\.is-side-closed\s*\{[\s\S]*?grid-template-columns:\s*58px minmax\(0,\s*1fr\);[\s\S]*?"presence conversation"[\s\S]*?"presence side";[\s\S]*?\.zhiyu-agent-chat__layout\.is-side-closed\s*\{[\s\S]*?grid-template-areas:\s*"presence conversation";/,
    'narrow layout must keep the compact relationship rail and remove the side sheet from the closed primary grid',
  );
  assert.match(
    css,
    /@media \(max-width:\s*640px\)[\s\S]*?\.zhiyu-agent-chat__layout,\s*\.zhiyu-agent-chat__layout\.is-side-closed\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);[\s\S]*?grid-template-rows:\s*52px auto;[\s\S]*?grid-template-areas:\s*"presence"\s*"conversation";[\s\S]*?\.zhiyu-agent-chat__layout:not\(\.is-side-closed\)\s*\{[\s\S]*?grid-template-rows:\s*52px auto auto;[\s\S]*?grid-template-areas:\s*"presence"\s*"conversation"\s*"side";/,
    'phone layout must move the relationship rail above the chat canvas so the canonical composer keeps its width floor',
  );
  assert.match(
    css,
    /@media \(max-width:\s*640px\)[\s\S]*?\.zhiyu-chat-canvas\s*\{[\s\S]*?height:\s*calc\(100vh - 52px\);[\s\S]*?min-height:\s*calc\(100vh - 52px\);/,
    'phone chat canvas height must subtract the top relationship rail instead of inheriting desktop 100vh and clipping the composer',
  );
});

test('Desktop Agent Center side sheet uses Desktop shared side-sheet density', async () => {
  const surfaceSource = await readAgentChatSource();
  const css = await readFile(path.join(appRoot, 'src', 'shell', 'app', 'home-surface.css'), 'utf8');

  assert.match(surfaceSource, /data-zhiyu-agent-center-side-sheet="desktop"/);
  assert.match(
    surfaceSource,
    /<AppCardSurface[\s\S]*?kind="promoted-glass"[\s\S]*?className="flex min-h-0 flex-1 flex-col overflow-hidden"/,
    'Agent Center must use the desktop shared promoted-glass card surface instead of a Zhiyu-only CSS shell',
  );
  assert.match(
    surfaceSource,
    /className="zhiyu-agent-center mr-2 my-12 flex h-\[calc\(100vh-96px\)\][\s\S]*?w-\[min\(500px,calc\(100vw-96px\)\)\][\s\S]*?\[grid-area:side\]/,
    'Agent Center side-sheet dimensions must live on the TSX structure that mirrors Desktop ChatSideSheet density',
  );
  assert.doesNotMatch(surfaceSource, /my-\[72px\]|h-\[calc\(100vh-144px\)\]/);
  assert.match(
    surfaceSource,
    /data-zhiyu-agent-center-kit-surface="true"/,
    'Zhiyu side sheet must host the Kit Agent Center surface instead of local tab density code',
  );
  assert.match(
    surfaceSource,
    /className="zhiyu-agent-center__body grid flex-1 content-start gap-3 overflow-auto px-5 py-3"/,
    'Agent Center body must keep the desktop sheet scroll density around the Kit surface',
  );
  assert.match(
    css,
    /\.zhiyu-agent-center > \[data-nimi-app-card-surface\]\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;/,
    'Agent Center AppCardSurface must keep the desktop flex column sheet root even though nested section cards use grid',
  );
  assert.doesNotMatch(css, /\.zhiyu-agent-center__header\s*\{/);
  assert.doesNotMatch(css, /\.zhiyu-agent-center__tabs(?:\s|,|\{)/);
  assert.doesNotMatch(css, /\.zhiyu-agent-center__body\s*\{/);
  assert.match(css, /:where\(\.zhiyu-agent-chat\)\s+:where\(button\)\s*\{/);
  assert.doesNotMatch(css, /\.zhiyu-agent-chat\s+:where\(button\)\s*\{/);
  assert.doesNotMatch(css, /\.zhiyu-agent-center__avatar\s*\{[\s\S]*?width:\s*72px;[\s\S]*?height:\s*72px;/);
});

async function collectProductionFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectProductionFiles(fullPath));
      continue;
    }
    if (entry.isFile() && productionFilePattern.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

async function readAgentChatSource() {
  return readAppFiles(agentChatParitySourceFiles);
}

async function readLiveRuntimeAcceptanceSource() {
  return readAppFiles(liveRuntimeAcceptanceSourceFiles);
}

async function readAppFiles(relativePaths) {
  const chunks = [];
  for (const relativePath of relativePaths) {
    chunks.push(await readFile(path.join(appRoot, relativePath), 'utf8'));
  }
  return chunks.join('\n');
}

function importSpecifiers(source) {
  const specifiers = [];
  for (const match of source.matchAll(importSpecifierPattern)) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sourceWithNormalizedWhitespace(value) {
  return value.replace(/\s+/g, ' ');
}

function lastCssRule(source, selector) {
  const matches = [...source.matchAll(new RegExp(`${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`, 'g'))];
  assert.ok(matches.length > 0, `${selector} rule missing`);
  return matches.at(-1)[1];
}

function stringArrayLiteralAfter(source, marker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${marker} missing`);
  const arrayStart = source.indexOf('[', start);
  assert.notEqual(arrayStart, -1, `${marker} array start missing`);
  const arrayEnd = source.indexOf(']', arrayStart);
  assert.notEqual(arrayEnd, -1, `${marker} array end missing`);
  return [...source.slice(arrayStart, arrayEnd + 1).matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]);
}
