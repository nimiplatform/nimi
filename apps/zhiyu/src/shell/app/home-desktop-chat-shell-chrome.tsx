import { Button, Surface } from '@nimiplatform/kit/ui';
import {
  Database,
  Image,
  MessageSquare,
  PanelRightOpen,
  Plus,
  Settings,
  SlidersHorizontal,
  Sparkles,
  UserRound,
} from 'lucide-react';
import type { ZhiyuEvidence } from './evidence';
import type { ZhiyuAvatarLaunchAction } from '../avatar/avatar-launch';
import type { ZhiyuHomeProductState } from './home-product-state';
import { HiddenEvidenceStatus, StatusRow } from './home-surface-sections';

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
  readonly currentPartnerName: string;
  readonly hasCurrentPartner: boolean;
  readonly primaryActionKind: 'connect-service' | 'select-partner' | 'configure-model' | 'start-chat';
  readonly avatarLaunchAction: ZhiyuAvatarLaunchAction;
  readonly runtimeReady: boolean;
  readonly onPrimaryAction: () => void;
  readonly onAvatarLaunch?: () => void;
  readonly onOpenDiagnostics: () => void;
  readonly onOpenModelConfig: () => void;
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
      <div className="zhiyu-home__desktop-logo" aria-label="织羽 Zhiyu">
        <Sparkles size={22} aria-hidden="true" />
      </div>
      <nav className="zhiyu-home__desktop-nav" aria-label="织羽主导航">
        <button type="button" className="zhiyu-home__desktop-nav-button is-active" aria-label="对话">
          <MessageSquare size={22} aria-hidden="true" />
        </button>
        <button type="button" className="zhiyu-home__desktop-nav-button" aria-label="记忆" onClick={onOpenDiagnostics}>
          <Database size={21} aria-hidden="true" />
        </button>
        <button type="button" className="zhiyu-home__desktop-nav-button" aria-label="图片" onClick={onOpenDiagnostics}>
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
  currentPartnerName,
  hasCurrentPartner,
  primaryActionKind,
  avatarLaunchAction,
  runtimeReady,
  onPrimaryAction,
  onAvatarLaunch,
  onOpenDiagnostics,
  onOpenModelConfig,
}: RelationshipRailProps) {
  return (
    <div className="zhiyu-home__right-rail" aria-label="伙伴与工具">
      <div className="zhiyu-home__relationship-stack" data-zhiyu-region="relationship-rail">
        {agents.map((agent, index) => {
          const displayName = productPartnerDisplayName(agent.displayName) ?? currentPartnerName;
          return (
            <button
              key={agent.localAgentRef ?? agent.itemKey}
              type="button"
              className={`zhiyu-home__agent-bubble${index === 0 && hasCurrentPartner ? ' is-active' : ''}`}
              aria-label={index === 0 && hasCurrentPartner ? `当前伙伴：${displayName}` : displayName}
              onClick={index === 0 && hasCurrentPartner ? onPrimaryAction : onOpenDiagnostics}
            >
              {partnerInitial(agent.displayName)}
            </button>
          );
        })}
        <button
          type="button"
          className="zhiyu-home__agent-bubble zhiyu-home__agent-bubble--add"
          aria-label="选择已存在本地伙伴"
          data-zhiyu-primary-action={primaryActionKind}
          disabled={primaryActionKind === 'configure-model' && !runtimeReady}
          onClick={onPrimaryAction}
        >
          <Plus size={24} aria-hidden="true" />
        </button>
      </div>
      <div className="zhiyu-home__rail-tools" aria-label="后台工具">
        {avatarLaunchAction.state === 'ready' ? (
          <button
            type="button"
            aria-label="????????"
            data-zhiyu-avatar-launch-entry={avatarLaunchAction.state}
            data-zhiyu-avatar-launch-reason={avatarLaunchAction.reasonCode}
            onClick={onAvatarLaunch}
          >
            <UserRound size={20} aria-hidden="true" />
          </button>
        ) : null}
        <button type="button" aria-label="模型配置" data-zhiyu-model-config-entry="rail" onClick={onOpenModelConfig}>
          <SlidersHorizontal size={20} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="打开诊断"
          data-zhiyu-diagnostics-toggle="open"
          data-zhiyu-diagnostics-entry="rail"
          onClick={onOpenDiagnostics}
        >
          <PanelRightOpen size={20} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function productPartnerDisplayName(value: string | null | undefined): string | null {
  const displayName = value?.trim();
  if (!displayName) {
    return null;
  }
  if (/runtime|localagent|local agent|fixture|e2e|source/i.test(displayName)) {
    return null;
  }
  return displayName;
}

function partnerInitial(value: string | null | undefined): string {
  const displayName = productPartnerDisplayName(value);
  if (!displayName) {
    return '本';
  }
  const firstLetter = displayName.match(/[A-Za-z]/)?.[0];
  if (firstLetter) {
    return firstLetter.toUpperCase();
  }
  return Array.from(displayName)[0] || '本';
}
