import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const helperDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(helperDir, '../..');
const rendererE2eIdsPath = path.join(desktopRoot, 'src/shell/renderer/testability/e2e-ids.ts');

function readRendererSelectorFactory(name, parameterName) {
  const source = fs.readFileSync(rendererE2eIdsPath, 'utf8');
  const expression = new RegExp(`${name}:\\s*\\(${parameterName}:\\s*string\\)\\s*=>\\s*\`([^\`$]+)\\$\\{${parameterName}\\}([^\`]*)\``);
  const match = source.match(expression);
  if (!match?.[1]) {
    throw new Error(`${name} selector truth missing from ${rendererE2eIdsPath}`);
  }
  const prefix = match[1];
  const suffix = match[2] || '';
  return (value) => `${prefix}${value}${suffix}`;
}

const runtimeSidebarPageTestId = readRendererSelectorFactory('runtimeSidebarPage', 'pageId');
const runtimeModelsPaneTestId = readRendererSelectorFactory('runtimeModelsPane', 'paneId');
const runtimeEnvironmentPaneTestId = readRendererSelectorFactory('runtimeEnvironmentPane', 'paneId');
const exploreSectionTabTestId = readRendererSelectorFactory('exploreSectionTab', 'sectionId');
const exploreSectionTestId = readRendererSelectorFactory('exploreSection', 'sectionId');
const explorePersonaSourceCardTestId = readRendererSelectorFactory('explorePersonaSourceCard', 'sourceId');
const explorePersonaSourcePrimaryActionTestId = readRendererSelectorFactory('explorePersonaSourcePrimaryAction', 'sourceId');

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
  runtimeModelsPane: runtimeModelsPaneTestId,
  runtimeEnvironmentPane: runtimeEnvironmentPaneTestId,
  exploreSectionTab: exploreSectionTabTestId,
  exploreSection: exploreSectionTestId,
  explorePersonaSourceCard: explorePersonaSourceCardTestId,
  explorePersonaSourcePrimaryAction: explorePersonaSourcePrimaryActionTestId,
  chatPage: 'chat-page',
  chatList: 'chat-list',
  chatRow: (chatId) => `chat-row:${chatId}`,
  chatTarget: (targetId) => `chat-target:${targetId}`,
  localAgentRef: (localAgentRef) => localAgentRef,
  chatHeaderProfileToggle: 'chat-header-profile-toggle',
  chatSettingsToggle: 'chat-settings-toggle',
  chatAgentCenterSection: (sectionId) => `chat-agent-center-section:${sectionId}`,
  chatOpenUserProfile: 'chat-open-user-profile',
  messageTimeline: 'message-timeline',
  runtimeSidebarPage: runtimeSidebarPageTestId,
  runtimePageRoot: (pageId) => `runtime-page:${pageId}`,
  feedPostAuthor: (postId) => `feed-post-author:${postId}`,
  profileDetailModal: 'profile-detail-modal',
  profileDetailModalClose: 'profile-detail-modal-close',
  profileDetailSurface: 'profile-detail-surface',
};
