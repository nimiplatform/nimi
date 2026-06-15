import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const helperDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(helperDir, '../..');
const rendererE2eIdsPath = path.join(desktopRoot, 'src/shell/renderer/testability/e2e-ids.ts');

function readRendererSelectorFactory(name, parameterName) {
  const source = fs.readFileSync(rendererE2eIdsPath, 'utf8');
  const expression = new RegExp(`${name}:\\s*\\(${parameterName}:\\s*string\\)\\s*=>\\s*\`([^\`$]+)\\$\\{${parameterName}\\}\``);
  const match = source.match(expression);
  if (!match?.[1]) {
    throw new Error(`${name} selector truth missing from ${rendererE2eIdsPath}`);
  }
  const prefix = match[1];
  return (value) => `${prefix}${value}`;
}

const runtimeSidebarPageTestId = readRendererSelectorFactory('runtimeSidebarPage', 'pageId');
const exploreAgentCardTestId = readRendererSelectorFactory('exploreAgentCard', 'agentId');
const exploreAgentPrimaryActionTestId = readRendererSelectorFactory('exploreAgentPrimaryAction', 'agentId');

export const E2E_IDS = {
  appLoadingScreen: 'app-loading-screen',
  appBootstrapErrorScreen: 'app-bootstrap-error-screen',
  loginScreen: 'login-screen',
  loginLogoTrigger: 'login-logo-trigger',
  loginEmailInput: 'login-email-input',
  loginAlternativeToggle: 'login-alternative-toggle',
  loginAlternativePanel: 'login-alternative-panel',
  loginPasswordInput: 'login-password-input',
  loginEmailSubmitArrow: 'login-email-submit-arrow',
  loginOtpButton: 'login-otp-button',
  loginBackButton: 'login-back-button',
  mainShell: 'main-shell',
  shellSidebarRail: 'shell-sidebar-rail',
  topbarLoginButton: 'topbar-login-button',
  desktopReleaseStrip: 'desktop-release-strip',
  desktopReleaseOpenUpdates: 'desktop-release-open-updates',
  offlineStrip: 'offline-strip',
  panel: (name) => `panel:${name}`,
  navTab: (tabId) => `nav-tab:${tabId}`,
  runtimeConnectorScopeBadge: (connectorId) => `runtime-connector-scope-badge:${connectorId}`,
  exploreAgentCard: exploreAgentCardTestId,
  exploreAgentPrimaryAction: exploreAgentPrimaryActionTestId,
  chatPage: 'chat-page',
  chatList: 'chat-list',
  chatRow: (chatId) => `chat-row:${chatId}`,
  chatTarget: (targetId) => `chat-target:${targetId}`,
  localAgentRef: (ownerUserId, agentId) => `local-agent:${ownerUserId}:${agentId}`,
  chatHeaderProfileToggle: 'chat-header-profile-toggle',
  chatSettingsToggle: 'chat-settings-toggle',
  chatAgentCenterSection: (sectionId) => `chat-agent-center-section:${sectionId}`,
  chatOpenUserProfile: 'chat-open-user-profile',
  chatMemoryModeCard: 'chat-memory-mode-card',
  chatMemoryModeStatus: 'chat-memory-mode-status',
  chatMemoryModeUpgradeButton: 'chat-memory-mode-upgrade-button',
  messageTimeline: 'message-timeline',
  runtimeSidebarPage: runtimeSidebarPageTestId,
  runtimePageRoot: (pageId) => `runtime-page:${pageId}`,
  feedPostAuthor: (postId) => `feed-post-author:${postId}`,
  profileDetailModal: 'profile-detail-modal',
  profileDetailModalClose: 'profile-detail-modal-close',
  profileDetailSurface: 'profile-detail-surface',
};
