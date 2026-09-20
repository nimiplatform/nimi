import { Button, InlineAlert, LoadingSkeleton, ProgressIndicator, ScrollArea, Surface, TextField } from '@nimiplatform/kit/ui';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  ArrowUpCircle,
  CircleAlert,
  Download,
  LoaderCircle,
  MessageSquare,
  SendHorizontal,
  Sparkles,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { chatAiStoreClient } from '../../bridge/runtime-bridge/chat-ai-store.js';
import { formatBytes, formatTransferRate } from '../../components/download-format.js';
import { useDesktopRendererCommands, useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { hasAvailableCatalogUpdate } from '../apps/apps-card-actions.js';
import { AppArtworkIcon } from '../apps/apps-card-visuals.js';
import { useAppsOverview } from '../apps/use-apps-overview.js';
import { sortThreadSummaries, THREADS_QUERY_KEY } from '../chat/chat-nimi-shell-core.js';
import { downloadModelName } from '../runtime-config/global-downloads-presentation.js';
import { useGlobalDownloads } from '../runtime-config/global-downloads-context.js';
import {
  capabilityPreparationState,
  useCapabilityInventory,
} from '../runtime-config/runtime-capability-inventory.js';
import {
  capabilityIcon,
  capabilityModelIdentity,
} from '../runtime-config/runtime-capability-presentation.js';
import { displayRuntimeConfigCapabilityLabel } from '../runtime-config/runtime-config-capability-labels.js';
import { isDownloadTerminal } from '../runtime-config/runtime-config-model-center-utils.js';
import { useRuntimeModelLibrary } from '../runtime-config/use-runtime-model-library.js';

function greetingKey(hour: number): string {
  if (hour < 5) return 'runtimeConfig.overview.greetingNight';
  if (hour < 12) return 'runtimeConfig.overview.greetingMorning';
  if (hour < 18) return 'runtimeConfig.overview.greetingAfternoon';
  return 'runtimeConfig.overview.greetingEvening';
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r015
export function NimiOverview() {
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const commands = useDesktopRendererCommands();
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setChatMode = useAppStore((state) => state.setChatMode);
  const setAppsDetailAppId = useAppStore((state) => state.setAppsDetailAppId);
  const setPendingNimiComposerPrefill = useAppStore((state) => state.setPendingNimiComposerPrefill);
  const setNimiConversationSelection = useAppStore((state) => state.setNimiConversationSelection);
  const authUser = useAppStore((state) => state.auth.user);
  const inventory = useCapabilityInventory();
  const library = useRuntimeModelLibrary();
  const downloads = useGlobalDownloads();
  const apps = useAppsOverview();
  const threads = useQuery({
    queryKey: THREADS_QUERY_KEY,
    queryFn: () => chatAiStoreClient.listThreads(),
    staleTime: 15_000,
  });
  const health = useQuery({
    queryKey: ['nimi-overview', 'runtime-health'],
    queryFn: () => sdk.machineProduct().audit.getRuntimeHealth({}),
    staleTime: 15_000,
  });
  const [draft, setDraft] = useState('');
  const entries = apps.data?.status === 'loaded' ? apps.data.entries : [];
  const unique = [
    ...new Map(
      entries
        .filter((entry) => entry.committedRelease || entry.localDevelopment)
        .sort(
          (left, right) =>
            Number(hasAvailableCatalogUpdate(left)) - Number(hasAvailableCatalogUpdate(right)) ||
            Number(Boolean(left.committedRelease)) - Number(Boolean(right.committedRelease)),
        )
        .map((entry) => [entry.identity.appId, entry]),
    ).values(),
  ];
  const updates = unique.filter(hasAvailableCatalogUpdate);
  const capabilityRows = inventory.capabilities.map((capability) => {
    const state = capabilityPreparationState({
      capability,
      inventory: inventory.data,
      tasks: inventory.tasks,
      unavailable: inventory.isError,
    });
    const selection = inventory.data?.aggregate.selections.find((item) => item.capabilityContract === capability);
    const selected = inventory.data?.aggregate.loadouts.find((item) => item.loadoutId === selection?.loadoutId);
    return { capability, state, model: capabilityModelIdentity(selected, inventory.data?.recipes ?? []).shortTitle };
  });
  const prepared = capabilityRows.filter((row) => row.state.state === 'ready');
  const failed = inventory.tasks.filter(
    (task) => task.status === 'failed' || task.status === 'needs-attention',
  );
  const activeTransfers = downloads?.transfers.filter((item) => !isDownloadTerminal(item.state)) ?? [];
  const recentThreads = sortThreadSummaries(threads.data ?? [])
    .filter((thread) => thread.lastMessageAtMs !== null)
    .slice(0, 3);
  const displayName = authUser ? String(authUser.displayName || authUser.handle || '') : '';
  const hour = new Date().getHours();
  const firstRun = !apps.isError && apps.data?.status === 'loaded'
    && !apps.data.runtimeError && apps.data.catalogStatus !== 'unavailable'
    && !inventory.isPending && unique.length === 0 && prepared.length === 0 && !inventory.isError;
  const statusLine = [
    inventory.isError ? t('runtimeConfig.capabilities.readFailed')
      : inventory.isPending ? '' : t('runtimeConfig.overview.statusCapabilities', { count: prepared.length }),
    activeTransfers.length ? t('runtimeConfig.overview.statusDownloading', { count: activeTransfers.length }) : '',
    health.isError ? t('runtimeConfig.overview.runtimeUnavailable') : '',
  ].filter(Boolean);
  const openApp = (appId: string) => {
    setAppsDetailAppId(appId);
    setActiveTab('apps');
  };
  const openCapability = (capability: string) => {
    commands.runtimeConfigNavigation.openCapability(capability);
    setActiveTab('runtime');
  };
  const openChat = (threadId?: string) => {
    if (threadId) setNimiConversationSelection({ threadId });
    setChatMode('ai');
    setActiveTab('chat');
  };
  const submitDraft = () => {
    const text = draft.trim();
    if (!text) {
      openChat();
      return;
    }
    setPendingNimiComposerPrefill(text);
    setDraft('');
    openChat();
  };
  const attention = [
    ...activeTransfers.slice(0, 2).map((item) => ({
      key: `transfer:${item.installSessionId}`,
      icon: <Download size={17} className="text-[var(--nimi-status-info)]" />,
      title: downloadModelName(item.sourceLabel, library.data?.catalog ?? []) ?? item.sourceLabel ?? item.installSessionId,
      detail: [
        item.bytesTotal ? `${formatBytes(item.bytesReceived)} / ${formatBytes(item.bytesTotal)}` : formatBytes(item.bytesReceived),
        formatTransferRate(item.speedBytesPerSec),
      ].filter(Boolean).join(' · '),
      progress: item.bytesTotal ? { value: item.bytesReceived, max: item.bytesTotal } : null,
      action: t('runtimeConfig.overview.view'),
      onAction: () => setActiveTab('downloads'),
      tone: 'info' as const,
    })),
    ...failed.slice(0, 2).map((task) => ({
      key: `task:${task.taskId}`,
      icon: <CircleAlert size={17} className="text-[var(--nimi-status-warning)]" />,
      title: t('runtimeConfig.overview.setupFailed', { capability: displayRuntimeConfigCapabilityLabel(task.capabilityContract, t) }),
      detail: task.failure?.message ?? '',
      progress: null,
      action: t('runtimeConfig.overview.view'),
      onAction: () => {
        commands.runtimeConfigNavigation.openSetupTask(task.taskId);
        setActiveTab('runtime');
      },
      tone: 'warning' as const,
    })),
    ...(updates.length
      ? [{
          key: 'updates',
          icon: <ArrowUpCircle size={17} className="text-[var(--nimi-text-secondary)]" />,
          title: t('runtimeConfig.overview.updates', { count: updates.length }),
          detail: updates.slice(0, 3).map((entry) => entry.identity.displayName).join(' · ') + (updates.length > 3 ? ' …' : ''),
          progress: null,
          action: t('runtimeConfig.overview.view'),
          onAction: () => openApp(updates[0]!.identity.appId),
          tone: 'neutral' as const,
        }]
      : []),
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col p-3">
      <Surface tone="panel" padding="none" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ScrollArea
          className="min-h-0 flex-1"
          contentClassName="mx-auto w-full max-w-6xl space-y-8 px-6 pb-8 pt-6 lg:px-10 lg:pt-7"
        >
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {displayName
                  ? t('runtimeConfig.overview.greetingWithName', { greeting: t(greetingKey(hour)), name: displayName })
                  : t(greetingKey(hour))}
              </h1>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-sm text-[var(--nimi-text-secondary)]">
                {statusLine.length ? (
                  statusLine.map((line, index) => (
                    <span key={line} className={health.isError && index === statusLine.length - 1 ? 'text-[var(--nimi-status-warning)]' : ''}>
                      {index > 0 ? <span className="mr-2 text-[var(--nimi-text-muted)]">·</span> : null}
                      {line}
                    </span>
                  ))
                ) : (
                  t('runtimeConfig.overview.runtimeChecking')
                )}
                {health.isError ? (
                  <Button tone="ghost" size="sm" onClick={() => setActiveTab('diagnostics')}>
                    {t('runtimeConfig.nav.advancedDiagnostics')}
                  </Button>
                ) : null}
              </p>
            </div>
            <Button tone="ghost" size="sm" onClick={() => setActiveTab('activity')}>
              {t('runtimeConfig.overview.activity')}
              <ArrowRight size={16} />
            </Button>
          </header>

          <section className="rounded-[var(--nimi-radius-lg)] bg-[var(--nimi-surface-active)] p-5 lg:p-6" data-testid="home-composer">
            <div className="flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--nimi-surface-card)] text-[var(--nimi-action-primary-bg)]">
                <MessageSquare size={21} strokeWidth={1.6} />
              </span>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold">{t('runtimeConfig.product.chatTitle')}</h2>
                <p className="text-sm text-[var(--nimi-text-secondary)]">{t('runtimeConfig.product.chatPurpose')}</p>
              </div>
            </div>
            <form
              className="mt-4 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                submitDraft();
              }}
            >
              <TextField
                aria-label={t('runtimeConfig.overview.composerPlaceholder')}
                placeholder={t('runtimeConfig.overview.composerPlaceholder')}
                value={draft}
                onChange={(event) => setDraft(event.currentTarget.value)}
                className="min-w-0 flex-1"
                data-testid="home-composer-input"
              />
              <Button type="submit" tone="primary" data-testid="home-open-chat">
                {draft.trim() ? <SendHorizontal size={17} /> : null}
                {t(draft.trim() ? 'runtimeConfig.overview.composerSend' : 'runtimeConfig.product.startChat')}
                {draft.trim() ? null : <ArrowRight size={17} />}
              </Button>
            </form>
            {recentThreads.length ? (
              <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.overview.recentConversations')}</span>
                {recentThreads.map((thread) => (
                  <button
                    key={thread.id}
                    type="button"
                    onClick={() => openChat(thread.id)}
                    className="max-w-64 truncate rounded-full bg-[var(--nimi-surface-card)] px-3 py-1 text-xs text-[var(--nimi-text-primary)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,var(--nimi-surface-card))]"
                  >
                    {thread.title}
                  </button>
                ))}
              </div>
            ) : null}
          </section>

          {firstRun ? (
            <section className="space-y-4" data-testid="home-first-run">
              <h2 className="text-lg font-semibold">{t('runtimeConfig.overview.firstRunTitle')}</h2>
              <ol className="grid gap-3 md:grid-cols-3">
                {(['model', 'chat', 'apps'] as const).map((step, index) => (
                  <li key={step} className="flex flex-col gap-3 rounded-2xl bg-[var(--nimi-surface-card)] p-5">
                    <span className="flex size-8 items-center justify-center rounded-full bg-[var(--nimi-surface-active)] text-sm font-semibold text-[var(--nimi-action-primary-bg)]">
                      {index + 1}
                    </span>
                    <div className="flex-1">
                      <h3 className="font-semibold">{t(`runtimeConfig.overview.firstRun.${step}.title`)}</h3>
                      <p className="mt-1 text-sm text-[var(--nimi-text-secondary)]">{t(`runtimeConfig.overview.firstRun.${step}.body`)}</p>
                    </div>
                    <Button
                      tone={index === 0 ? 'primary' : 'secondary'}
                      size="sm"
                      onClick={() => (step === 'model' ? setActiveTab('runtime') : step === 'chat' ? openChat() : setActiveTab('apps'))}
                    >
                      {t(`runtimeConfig.overview.firstRun.${step}.action`)}
                      <ArrowRight size={14} />
                    </Button>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {attention.length ? (
            <section className="space-y-2" data-testid="home-attention">
              <h2 className="text-base font-semibold">{t('runtimeConfig.overview.attention')}</h2>
              <div className="divide-y divide-[var(--nimi-border-subtle)] rounded-2xl border border-[var(--nimi-border-subtle)]">
                {attention.map((item) => (
                  <div key={item.key} className="flex items-center gap-3 px-4 py-3">
                    <span className="shrink-0">{item.icon}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.title}</p>
                      {item.progress ? (
                        <ProgressIndicator value={item.progress.value} max={item.progress.max} className="mt-1.5" aria-label={item.title} />
                      ) : null}
                      {item.detail ? <p className="mt-0.5 truncate text-xs tabular-nums text-[var(--nimi-text-secondary)]">{item.detail}</p> : null}
                    </div>
                    <Button size="sm" tone="secondary" onClick={item.onAction}>
                      {item.action}
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {!firstRun ? (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold">{t('runtimeConfig.overview.apps')}</h2>
                <Button tone="ghost" size="sm" onClick={() => setActiveTab('apps')}>
                  {t('runtimeConfig.overview.allApps')}
                  <ArrowRight size={14} />
                </Button>
              </div>
              {apps.isError ||
              apps.data?.status === 'error' ||
              (apps.data?.status === 'loaded' &&
                (apps.data.catalogStatus === 'unavailable' || apps.data.runtimeError)) ? (
                <InlineAlert tone="warning">{t('runtimeConfig.overview.appsUnavailable')}</InlineAlert>
              ) : null}
              {apps.isPending ? <LoadingSkeleton lines={2} label={t('Common.loading')} /> : null}
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {unique.slice(0, 6).map((entry) => (
                  <button
                    key={entry.identity.appId}
                    type="button"
                    className="group flex items-center gap-3 rounded-2xl bg-[var(--nimi-surface-card)] p-3 text-left transition-colors hover:bg-[var(--nimi-surface-active)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
                    onClick={() => openApp(entry.identity.appId)}
                    data-testid={`home-app:${entry.identity.appId}`}
                  >
                    <AppArtworkIcon
                      appId={entry.identity.appId}
                      displayName={entry.identity.displayName}
                      iconUrl={entry.iconUrl}
                      size="xl"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{entry.identity.displayName}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--nimi-text-secondary)]">
                        {entry.committedRelease ? (
                          <span className="truncate">{entry.committedRelease.version}</span>
                        ) : (
                          <span className="rounded-md bg-[var(--nimi-surface-active)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                            {t('runtimeConfig.overview.devTag')}
                          </span>
                        )}
                        {hasAvailableCatalogUpdate(entry) ? (
                          <span className="text-[var(--nimi-status-info)]">{t('runtimeConfig.overview.updateTag')}</span>
                        ) : null}
                      </span>
                    </span>
                    <ArrowRight
                      size={16}
                      className="text-[var(--nimi-text-muted)] transition-transform group-hover:translate-x-0.5"
                    />
                  </button>
                ))}
              </div>
              {!apps.isPending && !unique.length ? (
                <p className="text-sm text-[var(--nimi-text-secondary)]">
                  {t('runtimeConfig.overview.noApps')}
                </p>
              ) : null}
            </section>
          ) : null}

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold">{t('runtimeConfig.product.yourAi')}</h2>
              <Button tone="ghost" size="sm" onClick={() => setActiveTab('runtime')}>
                {t('runtimeConfig.product.allCapabilities')}
                <ArrowRight size={14} />
              </Button>
            </div>
            {inventory.isError ? (
              <InlineAlert tone="warning">{t('runtimeConfig.capabilities.readFailed')}</InlineAlert>
            ) : null}
            {inventory.isPending ? <LoadingSkeleton lines={2} label={t('Common.loading')} /> : null}
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {capabilityRows.map((row) => {
                const Icon = capabilityIcon(row.capability);
                const state = row.state.state;
                const exception = state === 'attention' || state === 'preparing';
                return (
                  <button
                    type="button"
                    key={row.capability}
                    onClick={() => openCapability(row.capability)}
                    data-testid={`home-capability:${row.capability}`}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors hover:bg-[var(--nimi-surface-active)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)] ${state === 'unset' ? 'opacity-70' : ''}`}
                  >
                    <span className="relative flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--nimi-surface-card)] text-[var(--nimi-text-secondary)]">
                      <Icon size={17} strokeWidth={1.6} />
                      {state === 'attention' ? (
                        <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-[var(--nimi-surface-panel)] bg-[var(--nimi-status-warning)]" />
                      ) : null}
                      {state === 'preparing' ? (
                        <LoaderCircle size={11} className="absolute -right-0.5 -top-0.5 animate-spin text-[var(--nimi-status-info)]" />
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{displayRuntimeConfigCapabilityLabel(row.capability, t)}</span>
                      <span className={`block truncate text-xs ${exception ? 'text-[var(--nimi-status-warning)]' : 'text-[var(--nimi-text-secondary)]'}`}>
                        {state === 'ready'
                          ? row.model
                          : state === 'unset'
                            ? t('runtimeConfig.capabilities.state.unset')
                            : t(`runtimeConfig.capabilities.state.${state}`)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            {!inventory.isPending && !capabilityRows.length && !inventory.isError ? (
              <p className="flex items-center gap-2 text-sm text-[var(--nimi-text-secondary)]">
                <Sparkles size={15} />
                {t('runtimeConfig.aiSettings.emptyDescription')}
              </p>
            ) : null}
          </section>
        </ScrollArea>
      </Surface>
    </div>
  );
}
