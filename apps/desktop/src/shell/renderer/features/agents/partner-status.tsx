import { useCallback, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Brain, ChevronRight, MessageCircle, Sparkles } from 'lucide-react';
import type { AgentCenterSession, AgentCenterSectionId } from '@nimiplatform/kit/features/agent-center';

// @nimi-authority: rule.nimi.desktop.product-surfaces.partners
export function PartnerStatus({ session, onManage }: {
  session: AgentCenterSession;
  onManage: (section: AgentCenterSectionId) => void;
}) {
  const { t } = useTranslation();
  const snapshot = useSyncExternalStore(
    useCallback(listener => session.subscribe(listener), [session]),
    useCallback(() => session.getSnapshot(), [session]),
  );
  const { reads, state } = snapshot;
  const booleanStatus = (value: boolean | null) => reads.autonomy === 'pending' ? 'loading'
    : reads.autonomy === 'failed' || value === null ? 'unavailable' : value ? 'enabled' : 'disabled';
  const memory = reads.memory === 'pending' ? 'loading' : reads.memory === 'failed' ? 'unavailable'
    : state.cognition.memory?.enabled === false ? 'disabled' : state.cognition.memoryState;
  const items = [
    { key: 'life', icon: Sparkles, state: booleanStatus(state.autonomy.enabled), section: 'behavior' },
    { key: 'contact', icon: MessageCircle, state: booleanStatus(state.autonomy.freeContactEnabled), section: 'behavior' },
    { key: 'memory', icon: Brain, state: memory, section: 'cognition' },
  ] as const;
  return <div data-testid="partner-status" className="grid gap-3 sm:grid-cols-3">
    {items.map(item => <button key={item.key} type="button" onClick={() => onManage(item.section)}
      className="flex min-w-0 items-center gap-3 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-4 text-left transition-colors hover:bg-[var(--nimi-surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]">
      <item.icon aria-hidden size={19} className="shrink-0 text-[var(--nimi-action-primary-bg)]" />
      <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{t(`runtimeConfig.partners.status.${item.key}`)}</span>
        <span className="mt-1 block text-xs text-[var(--nimi-text-secondary)]">{t(`runtimeConfig.partners.status.${item.state}`)}</span></span>
      <ChevronRight aria-hidden size={15} className="shrink-0 text-[var(--nimi-text-muted)]" />
    </button>)}
  </div>;
}
