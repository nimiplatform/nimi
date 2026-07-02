import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(root, '..', '..');

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function readRepoJson(relativePath) {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

test('zhiyu owns an Electron-first Nimi consuming app package', () => {
  for (const relativePath of [
    'package.json',
    'tsconfig.json',
    'tsconfig.electron.json',
    'vite.config.ts',
    'index.html',
    'src-electron/main.ts',
    'src-electron/preload.cts',
    'src-electron/runtime-auth.ts',
  ]) {
    assert.equal(existsSync(path.join(root, relativePath)), true, `${relativePath} should exist`);
  }

  const packageJson = readJson('package.json');
  assert.equal(packageJson.name, '@nimiplatform/zhiyu');
  assert.equal(packageJson.private, true);
  assert.match(packageJson.scripts['dev:electron'], /electron/);
  assert.match(packageJson.scripts['build:electron'], /tsconfig\.electron\.json/);
  assert.match(packageJson.scripts['test:e2e:electron'], /electron-acceptance/);
  assert.match(packageJson.scripts['test:e2e:electron:live-runtime'], /electron-live-runtime-acceptance/);
  assert.equal(packageJson.dependencies['@nimiplatform/sdk'], 'workspace:*');
  assert.equal(packageJson.dependencies['@nimiplatform/kit'], 'workspace:*');
  assert.equal(packageJson.devDependencies['@grpc/grpc-js'], undefined, 'zhiyu must not own raw gRPC');
});

test('repo exposes a first-class zhiyu Electron dev command', () => {
  const packageJson = readRepoJson('package.json');
  assert.equal(
    packageJson.scripts['dev:electron:zhiyu'],
    'pnpm --filter @nimiplatform/zhiyu dev:electron',
  );
});

test('zhiyu Electron host uses canonical app identity and secure standard shell', () => {
  const mainSource = read('src-electron/main.ts');
  const preloadSource = read('src-electron/preload.cts');
  const authSource = read('src-electron/runtime-auth.ts');

  assert.match(mainSource, /const APP_ID = 'nimi\.zhiyu'/);
  assert.match(mainSource, /registerNimiElectronRuntimeBridge/);
  assert.doesNotMatch(mainSource, /resolveOptionalZhiyuElectronLocalAgentIdentity/);
  assert.doesNotMatch(mainSource, /NIMI_ZHIYU_ELECTRON_LOCAL_AGENT_REF/);
  assert.doesNotMatch(mainSource, /assertOpaqueElectronLocalAgentRef/);
  assert.doesNotMatch(mainSource, /localAgentIdentity/);
  assert.match(mainSource, /contextIsolation:\s*true/);
  assert.match(mainSource, /nodeIntegration:\s*false/);
  assert.match(mainSource, /sandbox:\s*true/);
  assert.doesNotMatch(mainSource, /sandbox:\s*false/);
  assert.match(mainSource, /setWindowOpenHandler/);
  assert.match(mainSource, /will-navigate/);
  assert.doesNotMatch(mainSource, /runtime\/internal/);
  assert.doesNotMatch(mainSource, /apps\/desktop/);

  assert.match(preloadSource, /@nimiplatform\/kit\/shell\/electron\/preload-cjs/);
  assert.match(preloadSource, /installNimiElectronRuntimeBridge/);

  assert.match(authSource, /createNimiElectronRuntimeAccountTrustedMetadataProvider/);
  assert.doesNotMatch(authSource, /const runtimeProtectedScopes = \[[\s\S]*'runtime\.account\.read'/);
  assert.doesNotMatch(authSource, /\bwindow\b|\bdocument\b/);
});

test('zhiyu renderer exposes deterministic evidence without product truth', () => {
  const evidenceSource = read('src/shell/app/evidence.ts');
  const mainRendererSource = read('src/main.tsx');
  const appSource = read('src/shell/app/App.tsx');
  const homeSurfaceSource = [
    read('src/shell/app/HomeSurface.tsx'),
    read('src/shell/app/home-surface-sections.tsx'),
  ].join('\n');
  const homeMemorySurfaceSource = read('src/shell/app/home-memory-observatory-section.tsx');
  const homeCompanionSurfaceSource = read('src/shell/app/home-companion-state-section.tsx');
  const homeProposalSurfaceSource = read('src/shell/app/home-proposal-intake-section.tsx');
  const homeDelegationSurfaceSource = read('src/shell/app/home-delegation-ux-section.tsx');
  const homeDiaryReflectionSurfaceSource = read('src/shell/app/home-diary-reflection-section.tsx');
  const capabilityStudioSource = read('src/shell/capability-studio/zhiyu-ai-consume.ts');
  const runtimeAgentChatSource = read('src/shell/agent/runtime-agent-chat.ts');
  const homeProductStateSource = read('src/shell/app/home-product-state.ts');
  const capabilityRoomSource = read('src/shell/app/capability-room-state.ts');
  const identityFloorSource = read('src/shell/app/identity-floor-state.ts');
  const diagnosticStateSource = read('src/shell/app/diagnostic-state.ts');
  const companionStateSource = read('src/shell/agent/companion-state.ts');
  const delegationUxSource = [
    read('src/shell/agent/delegation-ux.ts'),
    read('src/shell/agent/delegation-ux-types.ts'),
    read('src/shell/agent/delegation-ux-projection.ts'),
  ].join('\n');
  const diaryReflectionSource = read('src/shell/agent/diary-reflection.ts');
  const avatarPresenceSource = read('src/shell/avatar/avatar-presence.ts');
  const aiConfigStoreSource = read('src/shell/ai-config/zhiyu-ai-config-store.ts');
  const aiConfigSettingsSource = read('src/shell/ai-config/zhiyu-ai-config-settings.tsx');
  const runtimeModelProviderSource = read('src/shell/ai-config/zhiyu-runtime-model-provider.ts');
  const liveFixtureSource = read('src/shell/agent/live-runtime-fixture.ts');
  const rendererSurfaceSource = [
    appSource,
    homeSurfaceSource,
    homeMemorySurfaceSource,
    homeCompanionSurfaceSource,
    homeProposalSurfaceSource,
    homeDelegationSurfaceSource,
    homeDiaryReflectionSurfaceSource,
    capabilityStudioSource,
  ].join('\n');
  const runtimeStatusSource = read('src/shell/runtime/runtime-status.ts');
  const sdkAcceptanceSource = read('src/shell/auth/electron-sdk-acceptance.ts');
  const runtimePlatformSource = read('src/shell/auth/runtime-platform.ts');
  const acceptanceSource = read('test/electron-acceptance.mjs');

  assert.match(evidenceSource, /appId:\s*'nimi\.zhiyu'/);
  assert.match(evidenceSource, /phase:\s*'electron-bootstrap'/);
  assert.match(evidenceSource, /reasonCode:\s*string/);
  assert.match(evidenceSource, /readonly auth:/);
  assert.match(evidenceSource, /readonly source:/);
  assert.match(evidenceSource, /readonly inventory:/);
  assert.match(evidenceSource, /readonly companion:/);
  assert.match(evidenceSource, /readonly diaryReflection:/);
  assert.match(evidenceSource, /readonly delegation:/);
  assert.match(evidenceSource, /readonly proposal:/);
  assert.match(evidenceSource, /readonly avatar:/);
  assert.match(evidenceSource, /readonly capabilityStudio:/);
  assert.match(evidenceSource, /readonly chat:/);
  assert.match(evidenceSource, /'diagnostics'/);
  assert.match(evidenceSource, /'companion'/);
  assert.match(evidenceSource, /'diary'/);
  assert.match(evidenceSource, /'proposal'/);
  assert.match(evidenceSource, /'delegation'/);
  assert.match(evidenceSource, /'avatar'/);
  assert.match(rendererSurfaceSource, /data-zhiyu-screen="home"/);
  assert.match(rendererSurfaceSource, /data-zhiyu-region="presence"/);
  assert.match(rendererSurfaceSource, /data-zhiyu-region="conversation"/);
  assert.match(rendererSurfaceSource, /data-zhiyu-region="memory"/);
  assert.match(rendererSurfaceSource, /data-zhiyu-gated-surface="memory"/);
  assert.match(rendererSurfaceSource, /data-zhiyu-region="capability"/);
  assert.match(rendererSurfaceSource, /data-zhiyu-gated-surface="capability"/);
  assert.match(rendererSurfaceSource, /data-zhiyu-region="capability-studio"/);
  assert.match(rendererSurfaceSource, /data-zhiyu-capability-studio/);
  assert.match(rendererSurfaceSource, /'text\.generate', 'chat\.stream', 'text\.embed'/);
  assert.match(rendererSurfaceSource, /data-zhiyu-capability-studio-run=\{capabilityId\}/);
  assert.match(rendererSurfaceSource, /data-zhiyu-capability-studio-result-kind/);
  assert.match(rendererSurfaceSource, /data-zhiyu-region="proposal"/);
  assert.match(rendererSurfaceSource, /data-zhiyu-gated-surface="proposal"/);
  assert.match(rendererSurfaceSource, /data-zhiyu-region="delegation"/);
  assert.match(rendererSurfaceSource, /data-zhiyu-gated-surface="delegation"/);
  assert.match(rendererSurfaceSource, /data-zhiyu-region="identity"/);
  assert.match(rendererSurfaceSource, /data-zhiyu-gated-surface="identity"/);
  assert.match(rendererSurfaceSource, /data-zhiyu-region="companion"/);
  assert.match(rendererSurfaceSource, /data-zhiyu-gated-surface="companion"/);
  assert.match(rendererSurfaceSource, /data-zhiyu-region="diary"/);
  assert.match(rendererSurfaceSource, /data-zhiyu-gated-surface="diary"/);
  assert.match(rendererSurfaceSource, /data-zhiyu-region="avatar"/);
  assert.match(rendererSurfaceSource, /data-zhiyu-gated-surface="avatar"/);
  assert.match(appSource, /probeZhiyuRuntimeStatus/);
  assert.match(appSource, /probeZhiyuRuntimeAccountStatus/);
  assert.match(appSource, /probeZhiyuRuntimeSourceProjection/);
  assert.match(appSource, /probeZhiyuRuntimeAgentInventory/);
  assert.match(appSource, /probeZhiyuLocalAgentDiscovery/);
  assert.match(appSource, /resolveZhiyuRuntimeLocalAgentSelection/);
  assert.match(appSource, /probeZhiyuRuntimeConversationHome/);
  assert.match(appSource, /probeZhiyuRuntimeMemoryObservatory/);
  assert.match(appSource, /probeZhiyuRuntimeRouteProjection/);
  assert.match(appSource, /probeZhiyuRuntimeTurnReadiness/);
  assert.match(appSource, /runZhiyuRuntimeAgentChatTurn/);
  assert.match(appSource, /chatStatusFromProjection/);
  assert.match(appSource, /<HomeSurface/);
  assert.match(appSource, /projectZhiyuHomeProductState/);
  assert.match(appSource, /@nimiplatform\/kit\/core\/runtime-capabilities/);
  assert.match(appSource, /CANONICAL_CAPABILITY_CATALOG/);
  assert.match(appSource, /CANONICAL_CAPABILITY_DEFERRED/);
  assert.match(appSource, /projectZhiyuCapabilityRoomState/);
  assert.match(appSource, /projectZhiyuDiagnosticState/);
  assert.match(appSource, /projectZhiyuIdentityFloorState/);
  assert.match(appSource, /projectNimiRuntimeAgentIdentitySafety/);
  assert.match(appSource, /probeZhiyuRuntimeCompanionState/);
  assert.match(appSource, /probeZhiyuRuntimeDelegationUx/);
  assert.match(appSource, /submitZhiyuRuntimeDelegationApproval/);
  assert.match(appSource, /projectZhiyuProposalIntakeStatus/);
  assert.match(appSource, /submitZhiyuCapabilityProposal/);
  assert.match(appSource, /projectZhiyuDiaryReflectionArtifacts/);
  assert.match(appSource, /probeZhiyuAvatarPresence/);
  assert.match(appSource, /runZhiyuCapabilityStudioAIConsume/);
  assert.match(rendererSurfaceSource, /data-zhiyu-auth-state/);
  assert.match(rendererSurfaceSource, /data-zhiyu-source-state/);
  assert.match(rendererSurfaceSource, /data-zhiyu-agent-inventory-state/);
  assert.match(rendererSurfaceSource, /data-zhiyu-local-agent-state/);
  assert.match(rendererSurfaceSource, /data-zhiyu-conversation-state/);
  assert.match(rendererSurfaceSource, /data-zhiyu-route-state/);
  assert.match(rendererSurfaceSource, /data-zhiyu-turn-state/);
  assert.match(rendererSurfaceSource, /data-zhiyu-agent-chat-state/);
  assert.match(rendererSurfaceSource, /data-zhiyu-agent-chat-ready/);
  assert.match(rendererSurfaceSource, /data-zhiyu-agent-chat-event-types/);
  assert.match(rendererSurfaceSource, /data-zhiyu-composer-state/);
  assert.match(rendererSurfaceSource, /data-zhiyu-submit-enabled/);
  assert.match(mainRendererSource, /@nimiplatform\/kit\/ui\/styles\.css/);
  assert.match(mainRendererSource, /@nimiplatform\/kit\/ui\/themes\/light\.css/);
  assert.match(mainRendererSource, /@nimiplatform\/kit\/ui\/themes\/nimi-accent\.css/);
  assert.match(mainRendererSource, /NimiThemeProvider/);
  assert.match(mainRendererSource, /accentPack="nimi-accent"/);
  assert.match(mainRendererSource, /defaultScheme="light"/);
  assert.match(homeSurfaceSource, /@nimiplatform\/kit\/ui/);
  assert.match(homeSurfaceSource, /Surface/);
  assert.match(homeSurfaceSource, /StatusBadge/);
  assert.match(homeSurfaceSource, /TextareaField/);
  assert.match(homeSurfaceSource, /Button/);
  assert.match(homeSurfaceSource, /CanonicalTranscriptView/);
  assert.match(homeSurfaceSource, /CanonicalComposer/);
  assert.match(homeSurfaceSource, /ChatStreamStatus/);
  assert.match(homeSurfaceSource, /data-zhiyu-product-stage/);
  assert.match(homeSurfaceSource, /data-zhiyu-readiness-score/);
  assert.match(homeSurfaceSource, /data-zhiyu-region="presence"/);
  assert.match(homeSurfaceSource, /data-zhiyu-region="conversation"/);
  assert.match(rendererSurfaceSource, /data-zhiyu-region="memory"/);
  assert.match(rendererSurfaceSource, /data-zhiyu-gated-surface="memory"/);
  assert.match(homeSurfaceSource, /data-zhiyu-region="capability"/);
  assert.match(homeSurfaceSource, /data-zhiyu-gated-surface="capability"/);
  assert.match(homeSurfaceSource, /data-zhiyu-region="capability-studio"/);
  assert.match(homeSurfaceSource, /data-zhiyu-capability-studio-disabled/);
  assert.match(homeProposalSurfaceSource, /data-zhiyu-region="proposal"/);
  assert.match(homeProposalSurfaceSource, /data-zhiyu-gated-surface="proposal"/);
  assert.match(homeProposalSurfaceSource, /data-zhiyu-proposal-kind/);
  assert.match(homeProposalSurfaceSource, /data-zhiyu-proposal-owner/);
  assert.match(homeProposalSurfaceSource, /data-zhiyu-proposal-risk/);
  assert.match(homeProposalSurfaceSource, /data-zhiyu-proposal-audit-ref/);
  assert.match(homeDelegationSurfaceSource, /data-zhiyu-region="delegation"/);
  assert.match(homeDelegationSurfaceSource, /data-zhiyu-gated-surface="delegation"/);
  assert.match(homeDelegationSurfaceSource, /data-zhiyu-delegation-ux/);
  assert.match(homeDelegationSurfaceSource, /data-zhiyu-delegation-candidate-state/);
  assert.match(homeDelegationSurfaceSource, /data-zhiyu-delegation-preview-state/);
  assert.match(homeDelegationSurfaceSource, /data-zhiyu-delegation-output-firewall-state/);
  assert.match(homeDelegationSurfaceSource, /data-zhiyu-delegation-audit-state/);
  assert.match(homeDelegationSurfaceSource, /data-zhiyu-delegation-approval/);
  assert.match(homeDelegationSurfaceSource, /data-zhiyu-delegation-diagnostic/);
  assert.match(homeDelegationSurfaceSource, /data-zhiyu-delegation-audit-replay-id/);
  assert.match(homeSurfaceSource, /data-zhiyu-region="identity"/);
  assert.match(homeSurfaceSource, /data-zhiyu-gated-surface="identity"/);
  assert.match(rendererSurfaceSource, /data-zhiyu-region="companion"/);
  assert.match(rendererSurfaceSource, /data-zhiyu-gated-surface="companion"/);
  assert.match(rendererSurfaceSource, /data-zhiyu-region="diary"/);
  assert.match(rendererSurfaceSource, /data-zhiyu-gated-surface="diary"/);
  assert.match(homeSurfaceSource, /data-zhiyu-region="avatar"/);
  assert.match(homeSurfaceSource, /data-zhiyu-gated-surface="avatar"/);
  assert.match(rendererSurfaceSource, /data-zhiyu-memory-observatory/);
  assert.match(rendererSurfaceSource, /data-zhiyu-memory-state/);
  assert.match(rendererSurfaceSource, /data-zhiyu-memory-record/);
  assert.match(rendererSurfaceSource, /data-zhiyu-memory-lineage/);
  assert.match(rendererSurfaceSource, /data-zhiyu-memory-bank-review-readiness/);
  assert.match(rendererSurfaceSource, /data-zhiyu-memory-lifecycle-field/);
  assert.match(homeSurfaceSource, /data-zhiyu-capability-room/);
  assert.match(homeSurfaceSource, /data-zhiyu-capability-catalog-count/);
  assert.match(homeSurfaceSource, /data-zhiyu-capability-route-state/);
  assert.match(homeSurfaceSource, /data-zhiyu-capability-current-state/);
  assert.match(homeSurfaceSource, /data-zhiyu-capability-data-movement/);
  assert.match(homeSurfaceSource, /data-zhiyu-capability-retention/);
  assert.match(homeSurfaceSource, /data-zhiyu-capability-revocation-path/);
  assert.match(homeSurfaceSource, /data-zhiyu-capability-audit-ref/);
  assert.match(homeSurfaceSource, /data-zhiyu-capability-unsupported-reason/);
  assert.match(homeSurfaceSource, /data-zhiyu-capability-setup-requirement/);
  assert.match(homeSurfaceSource, /data-zhiyu-capability-item/);
  assert.match(homeSurfaceSource, /data-zhiyu-capability-owner/);
  assert.match(homeSurfaceSource, /data-zhiyu-capability-governance-owner/);
  assert.match(homeSurfaceSource, /data-zhiyu-capability-governance-retention/);
  assert.match(homeSurfaceSource, /data-zhiyu-identity-floor/);
  assert.match(homeSurfaceSource, /data-zhiyu-identity-state/);
  assert.match(homeSurfaceSource, /data-zhiyu-identity-item/);
  assert.match(homeSurfaceSource, /data-zhiyu-identity-unsupported-field/);
  assert.match(homeSurfaceSource, /data-zhiyu-identity-overwrite-policy/);
  assert.match(homeSurfaceSource, /Identity cannot be overwritten by one message or by a stored memory conflict\./);
  assert.match(rendererSurfaceSource, /data-zhiyu-companion-state/);
  assert.match(rendererSurfaceSource, /data-zhiyu-companion-status-text/);
  assert.match(rendererSurfaceSource, /data-zhiyu-companion-state-updated-at/);
  assert.match(rendererSurfaceSource, /data-zhiyu-companion-current-emotion/);
  assert.match(rendererSurfaceSource, /data-zhiyu-companion-participation-mode/);
  assert.match(rendererSurfaceSource, /data-zhiyu-companion-participation-source/);
  assert.match(rendererSurfaceSource, /data-zhiyu-companion-unsupported-field/);
  assert.match(rendererSurfaceSource, /data-zhiyu-proactive-interruptibility/);
  assert.match(rendererSurfaceSource, /data-zhiyu-proactive-audit-ref/);
  assert.match(rendererSurfaceSource, /data-zhiyu-diary-reflection/);
  assert.match(rendererSurfaceSource, /data-zhiyu-diary-reflection-missing-owner/);
  assert.match(rendererSurfaceSource, /data-zhiyu-diary-reflection-missing-storage-policy/);
  assert.match(rendererSurfaceSource, /data-zhiyu-diary-reflection-missing-sdk-projection/);
  assert.match(rendererSurfaceSource, /data-zhiyu-diary-reflection-artifact-class/);
  assert.match(rendererSurfaceSource, /data-zhiyu-diary-reflection-required-field/);
  assert.match(homeSurfaceSource, /data-zhiyu-avatar-presence/);
  assert.match(homeSurfaceSource, /data-zhiyu-avatar-ready/);
  assert.match(homeSurfaceSource, /data-zhiyu-avatar-reason/);
  assert.match(homeSurfaceSource, /data-zhiyu-avatar-launch-available/);
  assert.match(homeSurfaceSource, /data-zhiyu-avatar-manage-available/);
  assert.match(homeSurfaceSource, /data-zhiyu-avatar-projection-ref/);
  assert.match(homeSurfaceSource, /data-zhiyu-avatar-backend-kind/);
  assert.match(homeSurfaceSource, /data-zhiyu-avatar-visual-readiness/);
  assert.match(homeSurfaceSource, /data-zhiyu-avatar-voice-readiness/);
  assert.match(homeSurfaceSource, /data-zhiyu-region="diagnostics"/);
  assert.match(homeSurfaceSource, /data-zhiyu-diagnostic-surface/);
  assert.match(homeSurfaceSource, /data-zhiyu-diagnostic-mode/);
  assert.match(homeSurfaceSource, /data-zhiyu-diagnostic-primary-blocker/);
  assert.match(homeSurfaceSource, /data-zhiyu-diagnostic-item/);
  assert.match(homeSurfaceSource, /data-zhiyu-diagnostic-trace-id/);
  assert.doesNotMatch(homeSurfaceSource, /runtime-source:|SourceMaterializationPacket|nimi-guide-archivist/);
  assert.doesNotMatch(homeProductStateSource, /runtime-source:|SourceMaterializationPacket|nimi-guide-archivist/);
  assert.doesNotMatch(rendererSurfaceSource, /apiKey|providerId|runtime\/internal|apps\/desktop/);
  assert.doesNotMatch(rendererSurfaceSource, /queryMemory|writeMemory|getCanonicalMemoryStatus|bindCanonicalMemoryStandard/);
  assert.doesNotMatch(capabilityRoomSource, /apiKey|providerId|runtime\/internal|apps\/desktop/);
  assert.doesNotMatch(capabilityRoomSource, /queryMemory|writeMemory|getCanonicalMemoryStatus|bindCanonicalMemoryStandard/);
  assert.doesNotMatch(capabilityRoomSource, /SourceMaterializationPacket|runtime-source:|nimi-guide-archivist/);
  assert.doesNotMatch(capabilityRoomSource, /\.nimi\/spec|canonical-capability-catalog\.yaml/);
  assert.match(delegationUxSource, /createNimiHostRuntimeAgentDelegatedCapabilitySurface/);
  assert.match(delegationUxSource, /runtime\.agent\.delegation\.read/);
  assert.match(delegationUxSource, /runtime\.agent\.delegation\.write/);
  assert.match(delegationUxSource, /submitApprovalDecision/);
  assert.match(delegationUxSource, /resumeApprovedCapability/);
  assert.doesNotMatch(delegationUxSource, /upsertDelegatedProviderProfile|setDelegatedProviderState|buildNimiRuntimeAgentDelegatedProviderProfileFromDraft/);
  assert.doesNotMatch(delegationUxSource, /providerProfileId:\s*['"]|capabilityId:\s*['"]|toolName:\s*['"]/);
  assert.doesNotMatch(delegationUxSource, /NIMI_STANDARD_SHELL_COMMANDS|PowerShell|powershell|Remove-Item|installer|clipboard|screenshot|browserHistory|localStorage|indexedDB/);
  assert.doesNotMatch(delegationUxSource, /apiKey|providerId|modelId|runtime\/internal|apps\/desktop/);
  assert.doesNotMatch(delegationUxSource, /queryMemory|writeMemory|getCanonicalMemoryStatus|bindCanonicalMemoryStandard/);
  assert.match(identityFloorSource, /P-AGID-\*/);
  assert.match(identityFloorSource, /zhiyu-identity-floor-user-visible-projection-not-admitted/);
  assert.match(identityFloorSource, /runtime-agent-identity-conflict-event-not-projected/);
  assert.match(identityFloorSource, /runtime-agent-output-firewall-verdict-not-projected/);
  assert.doesNotMatch(identityFloorSource, /local-agent\.identity|NIMI_STANDARD_SHELL_COMMANDS/);
  assert.doesNotMatch(identityFloorSource, /apiKey|providerId|runtime\/internal|apps\/desktop/);
  assert.doesNotMatch(identityFloorSource, /queryMemory|writeMemory|getCanonicalMemoryStatus|bindCanonicalMemoryStandard/);
  assert.doesNotMatch(identityFloorSource, /SourceMaterializationPacket|runtime-source:|nimi-guide-archivist/);
  assert.match(companionStateSource, /getAgentState/);
  assert.match(companionStateSource, /buildRuntimeAgentRequestContext/);
  assert.match(companionStateSource, /runtime\.agent\.read/);
  assert.match(companionStateSource, /withZhiyuElectronRuntimeProtectedScopes/);
  assert.match(companionStateSource, /runtime-agent-state-timestamp-required/);
  assert.match(companionStateSource, /zhiyu-runtime-owned-local-agent-required/);
  assert.match(companionStateSource, /unsupportedExplainabilityFields/);
  assert.doesNotMatch(companionStateSource, /apiKey|providerId|runtime\/internal|apps\/desktop/);
  assert.doesNotMatch(companionStateSource, /queryMemory|writeMemory|getCanonicalMemoryStatus|bindCanonicalMemoryStandard|runtime\.memory/);
  assert.doesNotMatch(companionStateSource, /SourceMaterializationPacket|runtime-source:|nimi-guide-archivist|local-agent\.identity/);
  assert.doesNotMatch(companionStateSource, /relationshipStage|relationshipScore|moodScore|trustScore|affection|intimacy|therapy|proactiveScheduler|diaryWriter/);
  assert.match(diaryReflectionSource, /zhiyu-diary-reflection-artifact-authority-not-admitted/);
  assert.match(diaryReflectionSource, /cognition-runtime-diary-reflection-artifact-owner/);
  assert.match(diaryReflectionSource, /platform-diary-reflection-retention-export-policy/);
  assert.match(diaryReflectionSource, /sdk-runtime-diary-reflection-artifact-projection/);
  assert.doesNotMatch(diaryReflectionSource, /writeFile|readFile|localStorage|indexedDB|diaryWriter|runtime\.memory/);
  assert.doesNotMatch(diaryReflectionSource, /runtime\/internal|apps\/desktop|apiKey|providerId/);
  assert.match(avatarPresenceSource, /readAvatarPresence/);
  assert.match(avatarPresenceSource, /readRuntimeAgentPresentationProfile/);
  assert.match(avatarPresenceSource, /readNimiRuntimeAgentPresentationProfile/);
  assert.match(avatarPresenceSource, /runtime\.agents\.getAgent/);
  assert.match(avatarPresenceSource, /runtime\.agent\.read/);
  assert.match(avatarPresenceSource, /set_runtime_agent_presentation_profile/);
  assert.doesNotMatch(avatarPresenceSource, /apiKey|providerId|runtime\/internal|apps\/desktop/);
  assert.doesNotMatch(avatarPresenceSource, /queryMemory|writeMemory|getCanonicalMemoryStatus|bindCanonicalMemoryStandard|runtime\.memory/);
  assert.doesNotMatch(avatarPresenceSource, /SourceMaterializationPacket|runtime-source:|nimi-guide-archivist|local-agent\.identity/);
  assert.doesNotMatch(avatarPresenceSource, /visualPackage|packageDescriptor|packagePath|manifestPayload|motionPayload|expressionInventory/);
  assert.doesNotMatch(avatarPresenceSource, /configurationRef:\s*profile\.avatarAssetRef/);
  assert.doesNotMatch(avatarPresenceSource, /projectionRef:\s*profile\.avatarAssetRef/);
  assert.doesNotMatch(diagnosticStateSource, /apiKey|providerId|runtime\/internal|apps\/desktop/);
  assert.doesNotMatch(diagnosticStateSource, /queryMemory|writeMemory|getCanonicalMemoryStatus|bindCanonicalMemoryStandard/);
  assert.doesNotMatch(diagnosticStateSource, /SourceMaterializationPacket|runtime-source:|nimi-guide-archivist/);
  assert.match(runtimeStatusSource, /new Runtime/);
  const authStatusSource = read('src/shell/auth/runtime-account-status.ts');
  assert.match(authStatusSource, /getAccountSessionStatus/);
  assert.match(authStatusSource, /getRuntimeAccountCaller/);
  assert.match(runtimePlatformSource, /createNimiLocalFirstPartyRuntimeAccountCaller/);
  assert.match(runtimePlatformSource, /deviceId:\s*runtimeAccountDeviceId/);
  assert.doesNotMatch(authStatusSource, /accessToken|refreshToken|subjectUserId/);
  assert.match(evidenceSource, /readonly localAgent:/);
  assert.match(evidenceSource, /readonly conversation:/);
  assert.match(evidenceSource, /readonly memory:/);
  assert.match(evidenceSource, /'identity'/);
  assert.match(evidenceSource, /readonly companion:/);
  assert.match(evidenceSource, /readonly diaryReflection:/);
  assert.match(evidenceSource, /readonly delegation:/);
  assert.match(evidenceSource, /readonly avatar:/);
  assert.match(evidenceSource, /unsupportedLifecycleFields/);
  assert.match(evidenceSource, /unsupportedExplainabilityFields/);
  assert.match(evidenceSource, /unsupportedFields/);
  assert.match(evidenceSource, /readonly route:/);
  assert.match(evidenceSource, /readonly turn:/);
  assert.match(evidenceSource, /readonly messages:/);
  assert.match(evidenceSource, /readonly eventTypes:/);
  assert.match(evidenceSource, /readonly composer:/);
  assert.match(evidenceSource, /readonly lastCapabilityId:/);
  assert.match(evidenceSource, /readonly streamingText:/);
  assert.match(evidenceSource, /readonly submitState:/);
  assert.match(evidenceSource, /readonly draftLength:/);
  assert.match(evidenceSource, /actionHint:\s*'await_admitted_runtime_source_projection'/);
  assert.match(evidenceSource, /actionHint:\s*'list_runtime_local_agents'/);
  assert.match(evidenceSource, /actionHint:\s*'probe_local_agent_discovery'/);
  assert.match(evidenceSource, /actionHint:\s*'open_runtime_conversation_anchor'/);
  assert.match(evidenceSource, /actionHint:\s*'select_runtime_agent_route'/);
  assert.match(runtimeStatusSource, /appId:\s*'nimi\.zhiyu'/);
  assert.match(sdkAcceptanceSource, /appId:\s*'nimi\.zhiyu'/);
  assert.match(sdkAcceptanceSource, /nimiElectronSdkAcceptance/);
  assert.match(acceptanceSource, /searchParams\.set\('nimiElectronSdkAcceptance', '1'\)/);
  const sourceProjectionSource = read('src/shell/agent/source-projection.ts');
  const agentInventorySource = read('src/shell/agent/agent-inventory.ts');
  const localAgentSource = read('src/shell/agent/local-agent-discovery.ts');
  const localAgentSelectionSource = read('src/shell/agent/local-agent-selection.ts');
  const conversationSource = read('src/shell/agent/conversation-home.ts');
  const memoryObservatorySource = read('src/shell/agent/memory-observatory.ts');
  const delegationSource = [
    read('src/shell/agent/delegation-ux.ts'),
    read('src/shell/agent/delegation-ux-types.ts'),
    read('src/shell/agent/delegation-ux-projection.ts'),
  ].join('\n');
  const routeSource = read('src/shell/agent/route-projection.ts');
  const turnSource = read('src/shell/agent/turn-readiness.ts');
  const runtimeAgentScopesSource = read('src/shell/agent/runtime-agent-scopes.ts');
  assert.match(sourceProjectionSource, /zhiyu-admitted-source-projection-required/);
  assert.match(sourceProjectionSource, /readZhiyuLiveRuntimeFixtureProjection/);
  assert.match(sourceProjectionSource, /await_admitted_runtime_source_projection/);
  assert.doesNotMatch(sourceProjectionSource, /nimi-guide-archivist|runtime-source:|SourceMaterializationPacket/);
  assert.doesNotMatch(sourceProjectionSource, /local-agent\.identity|NIMI_STANDARD_SHELL_COMMANDS/);
  assert.match(agentInventorySource, /createNimiRuntimeAgentClient/);
  assert.match(agentInventorySource, /listLocalAgents/);
  assert.match(agentInventorySource, /withScopes:\s*withZhiyuElectronRuntimeProtectedScopes/);
  assert.match(agentInventorySource, /zhiyu-runtime-account-required/);
  assert.doesNotMatch(agentInventorySource, /nimi-guide-archivist|runtime-source:|SourceMaterializationPacket/);
  assert.doesNotMatch(agentInventorySource, /local-agent\.identity|NIMI_STANDARD_SHELL_COMMANDS/);
  assert.match(localAgentSource, /createNimiRuntimeAgentClient/);
  assert.match(localAgentSource, /discoverBySource/);
  assert.match(localAgentSource, /withScopes:\s*withZhiyuElectronRuntimeProtectedScopes/);
  assert.match(localAgentSource, /hasElectronRuntime/);
  assert.match(localAgentSource, /zhiyu-runtime-source-required/);
  assert.doesNotMatch(localAgentSource, /local-agent\.identity/);
  assert.doesNotMatch(localAgentSource, /NIMI_STANDARD_SHELL_COMMANDS/);
  assert.match(localAgentSelectionSource, /runtime-local-agent-selected-from-inventory/);
  assert.match(localAgentSelectionSource, /zhiyu-runtime-local-agent-inventory-empty/);
  assert.match(localAgentSelectionSource, /zhiyu-runtime-local-agent-selection-required/);
  assert.doesNotMatch(localAgentSelectionSource, /nimi-guide-archivist|runtime-source:|SourceMaterializationPacket/);
  assert.doesNotMatch(localAgentSelectionSource, /local-agent\.identity|NIMI_STANDARD_SHELL_COMMANDS/);
  assert.match(conversationSource, /createNimiRuntimeAgentClient/);
  assert.match(conversationSource, /openConversation/);
  assert.match(conversationSource, /withScopes:\s*withZhiyuElectronRuntimeProtectedScopes/);
  assert.match(conversationSource, /zhiyu-local-agent-required/);
  assert.doesNotMatch(conversationSource, /local-agent\.identity/);
  assert.doesNotMatch(conversationSource, /queryMemory|writeMemory|getCanonicalMemoryStatus|bindCanonicalMemoryStandard/);
  assert.match(memoryObservatorySource, /createNimiRuntimeAgentMemoryObservatory/);
  assert.match(memoryObservatorySource, /runtime\.agents/);
  assert.match(memoryObservatorySource, /withScopes:\s*withZhiyuElectronRuntimeProtectedScopes/);
  assert.match(memoryObservatorySource, /zhiyu-local-agent-required/);
  assert.match(memoryObservatorySource, /unsupportedLifecycleFields/);
  assert.doesNotMatch(memoryObservatorySource, /local-agent\.identity/);
  assert.doesNotMatch(memoryObservatorySource, /queryMemory|writeMemory|getCanonicalMemoryStatus|bindCanonicalMemoryStandard|runtime\.memory/);
  assert.match(delegationSource, /probeZhiyuRuntimeDelegationUx/);
  assert.match(delegationSource, /submitZhiyuRuntimeDelegationApproval/);
  assert.match(delegationSource, /createNimiHostRuntimeAgentDelegatedCapabilitySurface/);
  assert.match(delegationSource, /withScopes:\s*withZhiyuElectronRuntimeProtectedScopes/);
  assert.match(delegationSource, /zhiyu-conversation-anchor-required/);
  assert.match(delegationSource, /runtime-delegation-approval-pending/);
  assert.match(delegationSource, /runtime-delegation-firewall-not-projected/);
  assert.doesNotMatch(delegationSource, /upsertDelegatedProviderProfile|setDelegatedProviderState|buildNimiRuntimeAgentDelegatedProviderProfileFromDraft/);
  assert.doesNotMatch(delegationSource, /local-agent\.identity|NIMI_STANDARD_SHELL_COMMANDS/);
  assert.doesNotMatch(delegationSource, /queryMemory|writeMemory|getCanonicalMemoryStatus|bindCanonicalMemoryStandard|runtime\.memory/);
  assert.match(routeSource, /buildNimiRuntimeRouteCapabilityProjection/);
  assert.match(routeSource, /createDefaultNimiRuntimeRouteCapabilitySelectionStore/);
  assert.match(routeSource, /loadZhiyuAIConfig/);
  assert.match(routeSource, /ZHIYU_AI_CONFIG_ENABLED_CAPABILITIES/);
  assert.match(routeSource, /ZHIYU_AI_CONFIG_BINDING_CAPABILITIES/);
  assert.match(routeSource, /createZhiyuRuntimeRouteCapabilityRuntime/);
  assert.doesNotMatch(routeSource, /readZhiyuLiveRuntimeFixtureProjection/);
  assert.match(routeSource, /text\.generate/);
  assert.match(routeSource, /chat\.stream/);
  assert.match(routeSource, /text\.embed/);
  assert.match(routeSource, /image\.generate/);
  assert.match(routeSource, /zhiyu-ai-config-route-selection-required/);
  assert.doesNotMatch(routeSource, /getDesktopAIConfigService|conversationCapabilityProjectionByCapability|apps\/desktop/);
  assert.doesNotMatch(routeSource, /modelId:\s*['"]/);
  assert.match(aiConfigStoreSource, /createNimiAIConfigStore/);
  assert.match(aiConfigStoreSource, /createNimiAIHostSurface/);
  assert.match(aiConfigStoreSource, /createNimiAppAIScopeRef/);
  assert.match(aiConfigStoreSource, /zhiyu-agent-home/);
  assert.doesNotMatch(aiConfigStoreSource, /apps\/tester|apps\/desktop|runtime\/internal/);
  assert.match(aiConfigSettingsSource, /ModelConfigAiModelHub/);
  assert.match(aiConfigSettingsSource, /useModelConfigProfileController/);
  assert.match(aiConfigSettingsSource, /ZHIYU_AI_CONFIG_ENABLED_CAPABILITIES/);
  assert.doesNotMatch(aiConfigSettingsSource, /apps\/tester|apps\/desktop|runtime\/internal/);
  assert.match(runtimeModelProviderSource, /createRuntimeRouteModelPickerProviderCache/);
  assert.match(runtimeModelProviderSource, /listNimiRuntimeRouteOptionsWithHost/);
  assert.match(runtimeModelProviderSource, /createNimiRuntimeRouteCapabilityRuntimeWithHost/);
  assert.doesNotMatch(runtimeModelProviderSource, /apps\/tester|apps\/desktop|runtime\/internal/);
  assert.match(turnSource, /zhiyu-conversation-anchor-required/);
  assert.match(turnSource, /zhiyu-runtime-route-required/);
  assert.doesNotMatch(turnSource, /sendTurn|streamTurn|createNimiRuntimeAgentClient/);
  assert.doesNotMatch(turnSource, /local-agent\.identity/);
  assert.doesNotMatch(turnSource, /modelId:\s*['"]/);
  assert.doesNotMatch(turnSource, /queryMemory|writeMemory|getCanonicalMemoryStatus|bindCanonicalMemoryStandard/);
  assert.match(runtimeAgentChatSource, /streamRuntimeAgentTurnRunnerPartsAsConversationEvents/);
  assert.match(runtimeAgentChatSource, /reduceRuntimeAgentConversationProjectionEvent/);
  assert.match(runtimeAgentChatSource, /createRuntimeAgentConversationProjectionState/);
  assert.match(runtimeAgentChatSource, /createNimiRuntimeAgentClient/);
  assert.match(runtimeAgentChatSource, /\.streamTurn\(/);
  assert.match(runtimeAgentChatSource, /withScopes:\s*withZhiyuElectronRuntimeProtectedScopes/);
  assert.match(runtimeAgentChatSource, /zhiyu-runtime-agent-chat-attachments-not-admitted/);
  assert.match(runtimeAgentChatSource, /zhiyu-conversation-anchor-mismatch/);
  assert.doesNotMatch(runtimeAgentChatSource, /\.sendTurn\(/);
  assert.doesNotMatch(runtimeAgentChatSource, /apiKey|providerId|runtime\/internal|apps\/desktop/);
  assert.doesNotMatch(runtimeAgentChatSource, /modelId:\s*['"]/);
  assert.doesNotMatch(runtimeAgentChatSource, /nimi-guide-archivist|runtime-source:|SourceMaterializationPacket/);
  assert.doesNotMatch(runtimeAgentChatSource, /queryMemory|writeMemory|getCanonicalMemoryStatus|bindCanonicalMemoryStandard/);
  assert.match(liveFixtureSource, /nimiElectronSdkAcceptance/);
  assert.match(liveFixtureSource, /nimiZhiyuLiveRuntimeFixture/);
  assert.doesNotMatch(liveFixtureSource, /SourceMaterializationPacket|runtime-source:|apps\/desktop|runtime\/internal|apiKey|providerId/);
  assert.match(runtimeAgentScopesSource, /withZhiyuElectronRuntimeProtectedScopes/);
  assert.match(runtimeAgentScopesSource, /register_zhiyu_runtime_protected_scope/);
  assert.doesNotMatch(runtimeAgentScopesSource, /SourceMaterializationPacket|runtime-source:|apps\/desktop|runtime\/internal|apiKey|providerId|modelId/);
  for (const source of [
    appSource,
    runtimeStatusSource,
    authStatusSource,
    sourceProjectionSource,
    agentInventorySource,
    localAgentSource,
    localAgentSelectionSource,
    conversationSource,
    memoryObservatorySource,
    companionStateSource,
    delegationSource,
    avatarPresenceSource,
    runtimeAgentScopesSource,
  ]) {
    assert.doesNotMatch(source, /apiKey|providerId|modelId|runtime\/internal|apps\/desktop/);
  }
  assert.doesNotMatch(routeSource, /apiKey|providerId|runtime\/internal|apps\/desktop/);
  assert.doesNotMatch(turnSource, /apiKey|providerId|runtime\/internal|apps\/desktop/);
});
