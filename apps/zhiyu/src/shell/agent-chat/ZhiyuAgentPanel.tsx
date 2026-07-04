import { Button, Surface } from '@nimiplatform/kit/ui';
import { useState } from 'react';
import {
  Bell,
  Database,
  Image,
  MessageSquare,
  PanelRightOpen,
  Plus,
  Settings,
  X,
} from 'lucide-react';
import nimiLogoImage from '../assets/logo.png';
import type { ZhiyuEvidence } from '../app/evidence';
import type { ZhiyuHomeProductState } from '../app/home-product-state';
import { HiddenEvidenceStatus, StatusRow } from '../app/home-surface-sections';

type DesktopPresenceRailProps = {
  readonly evidence: ZhiyuEvidence;
  readonly product: ZhiyuHomeProductState;
  readonly diagnosticsOpen: boolean;
  readonly onOpenDiagnostics: () => void;
};

type RelationshipRailProps = {
  readonly agents: readonly {
    readonly itemKey: string;
    readonly localAgentRef: string | null;
    readonly displayName?: string | null;
  }[];
  readonly currentLocalAgentRef: string | null;
  readonly currentPartnerName: string;
  readonly hasCurrentPartner: boolean;
  readonly primaryActionKind: 'connect-service' | 'select-partner' | 'configure-model' | 'start-chat';
  readonly runtimeReady: boolean;
  readonly onPrimaryAction: () => void;
  readonly onOpenDiagnostics: () => void;
  readonly onOpenSettings: () => void;
  readonly onSelectLocalAgent: (localAgentRef: string) => void;
};

export function DesktopPresenceRail({
  evidence,
  product,
  diagnosticsOpen,
  onOpenDiagnostics,
}: DesktopPresenceRailProps) {
  return (
    <Surface
      as="section"
      className="zhiyu-home__presence"
      data-zhiyu-region="presence"
      material="solid"
      elevation="base"
      padding="md"
    >
      <div className="zhiyu-home__desktop-logo" aria-label="Nimi" data-zhiyu-desktop-logo-image="nimi">
        <img src={nimiLogoImage} alt="" aria-hidden="true" />
      </div>
      <nav className="zhiyu-home__desktop-nav" aria-label="织语主导航">
        <button type="button" className="zhiyu-home__desktop-nav-button is-active" aria-label="对话">
          <MessageSquare size={22} aria-hidden="true" />
        </button>
        <button type="button" className="zhiyu-home__desktop-nav-button" aria-label="记忆" onClick={onOpenDiagnostics}>
          <Database size={21} aria-hidden="true" />
        </button>
        <button type="button" className="zhiyu-home__desktop-nav-button" aria-label="图像" onClick={onOpenDiagnostics}>
          <Image size={21} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="zhiyu-home__desktop-nav-button"
          aria-label="诊断"
          data-zhiyu-diagnostics-toggle="open"
          data-zhiyu-diagnostics-entry="nav"
          onClick={onOpenDiagnostics}
        >
          <Settings size={21} aria-hidden="true" />
        </button>
      </nav>
      <details
        className="zhiyu-home__status-details"
        data-zhiyu-status-collapsed="true"
      >
        <summary className="zhiyu-home__status-summary">
          本地环境状态 · {product.readinessScore} 项就绪
        </summary>
        <div className="zhiyu-home__status-grid" aria-label="本地环境状态">
          {product.statusCards.map((card) => (
            <StatusRow key={card.key} card={card} />
          ))}
        </div>
      </details>
      <Button
        type="button"
        tone="secondary"
        size="sm"
        className="zhiyu-home__diagnostics-open"
        leadingIcon={<PanelRightOpen size={15} aria-hidden="true" />}
        data-zhiyu-diagnostics-toggle="open"
        data-zhiyu-diagnostics-entry="summary"
        aria-expanded={diagnosticsOpen}
        aria-controls="zhiyu-diagnostics-drawer"
        onClick={onOpenDiagnostics}
      >
        打开诊断
      </Button>
      <HiddenEvidenceStatus evidence={evidence} />
    </Surface>
  );
}

export function RelationshipRail({
  agents,
  currentLocalAgentRef,
  currentPartnerName,
  hasCurrentPartner,
  primaryActionKind,
  runtimeReady,
  onPrimaryAction,
  onOpenDiagnostics,
  onOpenSettings,
  onSelectLocalAgent,
}: RelationshipRailProps) {
  const [openTopbarMenu, setOpenTopbarMenu] = useState<'notifications' | 'account' | null>(null);
  const toggleTopbarMenu = (menu: 'notifications' | 'account') => {
    setOpenTopbarMenu((current) => (current === menu ? null : menu));
  };

  return (
    <div className="zhiyu-home__right-rail" aria-label="伙伴与工具">
      <div className="zhiyu-home__topbar-chrome" data-zhiyu-topbar-chrome="true" aria-label="全局状态与账户">
        <button
          type="button"
          className="zhiyu-home__topbar-button"
          aria-label="通知中心"
          aria-expanded={openTopbarMenu === 'notifications'}
          data-zhiyu-topbar-notifications="true"
          onClick={() => toggleTopbarMenu('notifications')}
        >
          <Bell size={21} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="zhiyu-home__topbar-button zhiyu-home__topbar-button--account"
          aria-label="账户与设置"
          aria-expanded={openTopbarMenu === 'account'}
          data-zhiyu-topbar-account="true"
          onClick={() => toggleTopbarMenu('account')}
        >
          <span>{partnerInitial(currentPartnerName)}</span>
        </button>

        {openTopbarMenu === 'notifications' ? (
          <div
            className="zhiyu-home__topbar-popover"
            data-zhiyu-notification-popover="true"
            data-zhiyu-notification-state="deferred"
            role="status"
          >
            <div className="zhiyu-home__topbar-popover-head">
              <strong>通知中心</strong>
              <button
                type="button"
                aria-label="关闭通知中心"
                data-zhiyu-topbar-popover-close="notifications"
                onClick={() => setOpenTopbarMenu(null)}
              >
                <X size={15} aria-hidden="true" />
              </button>
            </div>
            <p>通知流由 Desktop 全局 shell 承载；Zhiyu 先保留入口，等待 Runtime/SDK 通知 surface 准入。</p>
          </div>
        ) : null}

        {openTopbarMenu === 'account' ? (
          <div
            className="zhiyu-home__topbar-popover"
            data-zhiyu-account-menu="true"
            role="menu"
            aria-label="账户与设置"
          >
            <div className="zhiyu-home__topbar-popover-head">
              <strong>账户与设置</strong>
              <button
                type="button"
                aria-label="关闭账户菜单"
                data-zhiyu-topbar-popover-close="account"
                onClick={() => setOpenTopbarMenu(null)}
              >
                <X size={15} aria-hidden="true" />
              </button>
            </div>
            <p>当前伙伴：{currentPartnerName}</p>
            <button
              type="button"
              className="zhiyu-home__account-menu-action"
              data-zhiyu-account-menu-action="settings"
              role="menuitem"
              onClick={() => {
                setOpenTopbarMenu(null);
                onOpenSettings();
              }}
            >
              打开设置
            </button>
          </div>
        ) : null}
      </div>
      <div
        className="zhiyu-home__relationship-stack"
        data-zhiyu-region="relationship-rail"
        data-zhiyu-relationship-rail-density="desktop"
      >
        {agents.map((agent) => {
          const displayName = normalizedDisplayName(agent.displayName) ?? currentPartnerName;
          const isCurrent = hasCurrentPartner && agent.localAgentRef === currentLocalAgentRef;
          const canSelect = Boolean(agent.localAgentRef) && !isCurrent;
          return (
            <button
              key={agent.localAgentRef ?? agent.itemKey}
              type="button"
              className={`zhiyu-home__agent-bubble${isCurrent ? ' is-active' : ''}`}
              aria-label={isCurrent ? `当前伙伴：${displayName}` : `选择伙伴：${displayName}`}
              data-zhiyu-local-agent-candidate="true"
              data-zhiyu-local-agent-candidate-active={String(isCurrent)}
              data-zhiyu-local-agent-ref={agent.localAgentRef ?? ''}
              onClick={() => {
                if (canSelect && agent.localAgentRef) {
                  onSelectLocalAgent(agent.localAgentRef);
                  return;
                }
                if (isCurrent) {
                  onPrimaryAction();
                  return;
                }
                onOpenDiagnostics();
              }}
            >
              {partnerInitial(agent.displayName)}
            </button>
          );
        })}
        <button
          type="button"
          className="zhiyu-home__agent-bubble zhiyu-home__agent-bubble--add"
          aria-label="选择已有本地伙伴"
          data-zhiyu-primary-action={primaryActionKind}
          disabled={primaryActionKind === 'configure-model' && !runtimeReady}
          onClick={onPrimaryAction}
        >
          <Plus size={19} aria-hidden="true" />
        </button>
      </div>
      <div className="zhiyu-home__rail-tools" aria-label="关系栏设置">
        <button type="button" aria-label="设置" data-zhiyu-settings-entry="relationship-rail" onClick={onOpenSettings}>
          <Settings size={20} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function normalizedDisplayName(value: string | null | undefined): string | null {
  const displayName = value?.trim();
  return displayName || null;
}

function partnerInitial(value: string | null | undefined): string {
  const displayName = normalizedDisplayName(value);
  if (!displayName) {
    return '本';
  }
  const firstLetter = displayName.match(/[A-Za-z]/)?.[0];
  if (firstLetter) {
    return firstLetter.toUpperCase();
  }
  return Array.from(displayName)[0] || '本';
}
