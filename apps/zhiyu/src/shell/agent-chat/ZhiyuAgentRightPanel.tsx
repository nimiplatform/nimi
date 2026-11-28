import {
  AgentCenter,
  createAgentCenterI18n,
  type AgentCenterSectionId,
  type AgentCenterSession,
  type AgentCenterTranslationKey,
} from '@nimiplatform/kit/features/agent-center';
import { Button } from '@nimiplatform/kit/ui';
import {
  motion,
  nimiOverlayPanelMotion,
  useIsPresent,
  useNimiReducedMotion,
} from '@nimiplatform/kit/ui/motion';
import { ExternalLink, Globe2, RotateCcw, Settings2, X } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import type { ZhiyuEvidence } from '../app/evidence';
import {
  agentCenterHeaderStateLabel,
  agentCenterWorldLabel,
  currentPartnerAvatarUrl,
  partnerInitial,
} from './ZhiyuAgentChatLabels';

export type RightPanelMode = 'agent' | 'closed';
export type VisibleRightPanelMode = Exclude<RightPanelMode, 'closed'>;
export type AgentPanelTab = AgentCenterSectionId;

type RightAgentPanelProps = {
  readonly onDiscover?: () => void;
  readonly onOpenHomePartner?: () => void;
  readonly mode: VisibleRightPanelMode;
  readonly evidence: ZhiyuEvidence;
  readonly currentPartnerName: string;
  readonly activeTab: AgentPanelTab;
  readonly onActiveTabChange: (tab: AgentPanelTab) => void;
  readonly onClose: () => void;
  readonly onOpenDesktopRuntimeSettings: () => void;
  readonly onRetryAgentCenter: () => void;
  readonly onAvatarLaunch?: () => void;
  readonly session: AgentCenterSession | null;
  readonly managedReturnFocus?: boolean;
};

const ZHIYU_AGENT_CENTER_OVERRIDES = {
  'AgentCenter.chrome.title': '织羽伙伴中心',
  'AgentCenter.chrome.eyebrow': '伙伴设置',
  'AgentCenter.chrome.closeLabel': '关闭织羽伙伴中心',
  'AgentCenter.chrome.navLabel': '织羽伙伴中心分区',
  'AgentCenter.chrome.projectionLoadFailed': '织羽伙伴中心加载失败。',
} as const satisfies Partial<Record<AgentCenterTranslationKey, string>>;

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function listFocusableElements(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter((el) => {
    if (el.hasAttribute('disabled') || el.getAttribute('aria-hidden') === 'true') return false;
    if (el.closest('[inert], [aria-hidden="true"]')) return false;
    const style = typeof window !== 'undefined' ? window.getComputedStyle(el) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    return true;
  });
}

function hasExternalOpenOverlay(panel: HTMLElement | null): boolean {
  if (typeof document === 'undefined') return false;
  const dialogs = document.querySelectorAll('[role="dialog"][data-state="open"]');
  for (const dialog of dialogs) {
    if (dialog !== panel) return true;
  }
  const poppers = document.querySelectorAll('[data-radix-popper-content-wrapper]');
  for (const popper of poppers) {
    // Non-interactive tooltips render in a Radix popper wrapper too; only
    // interactive menus, listboxes, or popovers should defer drawer Escape/Tab.
    if (
      popper.querySelector(
        '[role="dialog"], [role="menu"], [role="listbox"], [data-radix-menu-content], [data-radix-select-content], [data-radix-popover-content]',
      )
    ) {
      return true;
    }
  }
  return false;
}

export function RightAgentPanel(props: RightAgentPanelProps) {
  const { onClose, managedReturnFocus = false } = props;
  const isPresent = useIsPresent();
  const isPresentRef = useRef(isPresent);
  isPresentRef.current = isPresent;
  const panelRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const reducedMotion = useNimiReducedMotion();
  const drawerMotion = useMemo(
    () => nimiOverlayPanelMotion({ kind: 'drawer', side: 'right', reducedMotion }),
    [reducedMotion],
  );
  const agentCenterI18n = useMemo(() => createAgentCenterI18n({
    language: 'zh',
    t(key) {
      return ZHIYU_AGENT_CENTER_OVERRIDES[key as keyof typeof ZHIYU_AGENT_CENTER_OVERRIDES] || key;
    },
  }), []);

  const restoreStandaloneFocus = () => {
    if (managedReturnFocus || typeof document === 'undefined') return;
    const panel = panelRef.current;
    const returnTarget = previousFocusRef.current;
    previousFocusRef.current = null;
    if (!returnTarget?.isConnected || returnTarget.matches(':disabled') || returnTarget.closest('[inert]')) return;
    const currentActive = document.activeElement;
    if (
      !currentActive
      || currentActive === document.body
      || currentActive === document.documentElement
      || Boolean(panel?.contains(currentActive))
    ) {
      returnTarget.focus({ preventScroll: true });
    }
  };

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const panel = panelRef.current;
    if (!panel) return undefined;
    const activeBeforeOpen = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!managedReturnFocus && activeBeforeOpen && !panel.contains(activeBeforeOpen)) {
      previousFocusRef.current = activeBeforeOpen;
    }
    if (!activeBeforeOpen || !panel.contains(activeBeforeOpen)) {
      const initialTarget = listFocusableElements(panel)[0] ?? panel;
      initialTarget.focus({ preventScroll: true });
    }
    return () => {
      restoreStandaloneFocus();
    };
  }, [managedReturnFocus]);

  useEffect(() => {
    if (!isPresent) {
      restoreStandaloneFocus();
    }
  }, [isPresent]);

  // When switching tabs inside the drawer (e.g. pressing Enter on an overview
  // checklist item), the previously focused item may unmount; keep keyboard
  // focus anchored inside the open drawer instead of falling to <body>.
  useEffect(() => {
    if (!isPresentRef.current || !isPresent || typeof document === 'undefined') return;
    const panel = panelRef.current;
    if (!panel || hasExternalOpenOverlay(panel)) return;
    const active = document.activeElement;
    if (!active || active === document.body || active === document.documentElement || !panel.contains(active)) {
      const target = listFocusableElements(panel)[0] ?? panel;
      target.focus({ preventScroll: true });
    }
  }, [isPresent, props.activeTab]);

  useEffect(() => {
    if (typeof window === 'undefined' || !isPresent) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isPresentRef.current || event.defaultPrevented || event.isComposing) return;
      const panel = panelRef.current;
      if (!panel) return;
      if (hasExternalOpenOverlay(panel)) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === 'Tab') {
        const focusables = listFocusableElements(panel);
        if (focusables.length === 0) {
          event.preventDefault();
          panel.focus({ preventScroll: true });
          return;
        }
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        if (!active || !panel.contains(active)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus({ preventScroll: true });
          return;
        }
        if (event.shiftKey && (active === first || active === panel)) {
          event.preventDefault();
          last.focus({ preventScroll: true });
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus({ preventScroll: true });
        }
      }
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (!isPresentRef.current) return;
      const panel = panelRef.current;
      if (!panel || hasExternalOpenOverlay(panel)) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target && !panel.contains(target)) {
        const first = listFocusableElements(panel)[0] ?? panel;
        first.focus({ preventScroll: true });
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('focusin', handleFocusIn, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('focusin', handleFocusIn, true);
    };
  }, [isPresent, onClose]);

  const agentCenterWorld = agentCenterWorldLabel(props.evidence);
  const moodLabel = agentCenterHeaderStateLabel(props.evidence.companion.currentEmotion);
  const activityLabel = agentCenterHeaderStateLabel(props.evidence.companion.executionState);
  const hasSelectedPartner = Boolean(props.evidence.localAgent?.agentHandle) && props.evidence.localAgent?.ready !== false;
  const hasLocalPartners = (props.evidence.inventory?.localAgents?.length ?? 0) > 0;
  return (
    <motion.aside
      ref={panelRef}
      role="dialog"
      aria-modal={isPresent ? 'true' : undefined}
      aria-hidden={!isPresent || undefined}
      tabIndex={-1}
      className="zhiyu-agent-center"
      data-zhiyu-region="agent-panel"
      data-zhiyu-agent-center-placement="kit"
      data-zhiyu-agent-panel-mode={props.mode}
      data-zhiyu-agent-center-side-sheet="desktop"
      data-zhiyu-agent-panel-tab={props.activeTab}
      aria-label="伙伴中心"
      {...drawerMotion}
      style={{ ...drawerMotion.style, ...(isPresent ? undefined : { pointerEvents: 'none' }) }}
    >
      {moodLabel || activityLabel || agentCenterWorld || props.onOpenHomePartner ? (
        <div
          className="zhiyu-agent-center__context flex min-w-0 shrink-0 flex-wrap items-center gap-1.5"
          data-zhiyu-agent-center-host-context="true"
        >
          {moodLabel ? (
            <span
              className="zhiyu-agent-center__state-chip rounded-full px-2 py-px text-[length:var(--nimi-type-caption-size)] font-semibold"
              data-zhiyu-agent-center-state-chip="mood"
            >
              {moodLabel}
            </span>
          ) : null}
          {activityLabel ? (
            <span
              className="zhiyu-agent-center__state-chip rounded-full px-2 py-px text-[length:var(--nimi-type-caption-size)] font-semibold"
              data-zhiyu-agent-center-state-chip="activity"
            >
              {activityLabel}
            </span>
          ) : null}
          {agentCenterWorld ? (
            <span className="inline-flex min-w-0 items-center gap-1 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-secondary)]" data-zhiyu-agent-center-world-name={agentCenterWorld}>
              <Globe2 aria-hidden="true" size={12} />
              <span className="truncate">{agentCenterWorld}</span>
            </span>
          ) : null}
          {props.onOpenHomePartner ? <Button size="sm" tone="ghost" className="ml-auto"
            leadingIcon={<ExternalLink size={14} aria-hidden />}
            aria-label={`在 Home 管理${props.currentPartnerName}`} onClick={props.onOpenHomePartner}>
            在 Home 管理
          </Button> : null}
        </div>
      ) : null}
      {props.activeTab === 'advanced' && props.evidence.chat.state === 'failed' ? (
        <section className="rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3 text-xs text-[var(--nimi-text-primary)]" aria-label="最近一次回复失败">
          <strong>最近一次回复失败</strong>
          <p>{props.evidence.chat.reasonCode}</p>
          <p>{props.evidence.chat.message}</p>
        </section>
      ) : null}
      {props.session ? <AgentCenter
        activeSection={props.activeTab}
        chrome="standalone"
        i18n={agentCenterI18n}
        identity={{
          displayName: props.currentPartnerName,
          avatarUrl: currentPartnerAvatarUrl(props.evidence),
          avatarFallback: partnerInitial(props.currentPartnerName),
        }}
        onSectionChange={props.onActiveTabChange}
        placementActions={{
          close: props.onClose,
          openRuntimeSettings: props.onOpenDesktopRuntimeSettings,
          launchAvatar: props.onAvatarLaunch,
        }}
        session={props.session}
        showResourcePack
      /> : !hasSelectedPartner ? (
        <section
          className="zhiyu-agent-center__unavailable flex min-h-0 flex-1 flex-col"
          data-zhiyu-agent-center-unavailable="no-partner"
          aria-label={hasLocalPartners ? '请先选择本地伙伴' : '还没有本地伙伴'}
        >
          <header className="zhiyu-agent-center__unavailable-header">
            <h2>伙伴设置</h2>
            <button
              type="button"
              className="zhiyu-agent-center__icon-button"
              aria-label="关闭织羽伙伴中心"
              data-zhiyu-agent-center-unavailable-close="true"
              onClick={props.onClose}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>
          <div className="zhiyu-agent-center__unavailable-content">
            <span className="zhiyu-agent-center__unavailable-icon" aria-hidden="true">
              <Settings2 size={26} strokeWidth={1.6} />
            </span>
            <div className="zhiyu-agent-center__unavailable-copy">
              <h3>{hasLocalPartners ? '请先选择本地伙伴' : '还没有本地伙伴'}</h3>
              <p>
                {hasLocalPartners
                  ? '从左侧伙伴栏选择一位伙伴后，就可以在这里查看与调整伙伴设置。'
                  : '先发现并添加一位本地伙伴，之后就可以在这里管理伙伴档案、模型、形象与主动设置。'}
              </p>
            </div>
            {!hasLocalPartners && props.onDiscover ? (
              <button
                type="button"
                className="zhiyu-agent-center__retry-button"
                data-zhiyu-agent-center-unavailable-action="discover"
                data-zhiyu-agent-center-unavailable-reason="no-partner"
                onClick={props.onDiscover}
              >
                <Globe2 size={15} aria-hidden="true" />
                <span>发现角色</span>
              </button>
            ) : (
              <button
                type="button"
                className="zhiyu-agent-center__retry-button"
                data-zhiyu-agent-center-unavailable-action="close"
                data-zhiyu-agent-center-unavailable-reason="no-partner"
                onClick={props.onClose}
              >
                <span>{hasLocalPartners ? '返回选择伙伴' : '关闭'}</span>
              </button>
            )}
          </div>
        </section>
      ) : (
        <section
          className="zhiyu-agent-center__unavailable flex min-h-0 flex-1 flex-col"
          data-zhiyu-agent-center-unavailable="owner-unavailable"
          aria-label="织羽伙伴中心暂不可用"
        >
          <header className="zhiyu-agent-center__unavailable-header">
            <h2>伙伴设置</h2>
            <button
              type="button"
              className="zhiyu-agent-center__icon-button"
              aria-label="关闭织羽伙伴中心"
              data-zhiyu-agent-center-unavailable-close="true"
              onClick={props.onClose}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>
          <div className="zhiyu-agent-center__unavailable-content">
            <span className="zhiyu-agent-center__unavailable-icon" aria-hidden="true">
              <Settings2 size={26} strokeWidth={1.6} />
            </span>
            <div className="zhiyu-agent-center__unavailable-copy">
              <h3>设置暂时不可用</h3>
              <p>伙伴设置暂时没有响应，请稍后重试。</p>
            </div>
            <button
              type="button"
              className="zhiyu-agent-center__retry-button"
              data-zhiyu-agent-center-unavailable-action="retry"
              data-zhiyu-agent-center-unavailable-reason="owner-unavailable"
              onClick={props.onRetryAgentCenter}
            >
              <RotateCcw size={15} aria-hidden="true" />
              <span>重新加载伙伴设置</span>
            </button>
          </div>
        </section>
      )}
    </motion.aside>
  );
}
