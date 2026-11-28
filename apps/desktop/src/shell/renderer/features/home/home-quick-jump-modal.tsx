import {
  capabilityIcon,
  DialogDescription,
  DialogTitle,
  OverlayShell,
  ScrollArea,
  SearchField,
} from '@nimiplatform/kit/ui';
import type { TFunction } from 'i18next';
import {
  Activity,
  AppWindow,
  Cloud,
  Compass,
  Download,
  HardDrive,
  Layers,
  Network,
  Plug,
  UserRound,
  Wrench,
} from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalAgentListItem } from '../agents/local-agent-list-model.js';
import { AppArtworkIcon } from '../apps/apps-card-visuals.js';
import type { DesktopAppsEntry } from '../apps/apps-panel-projection.js';
import { BUNDLED_ZHIYU_APP_ID } from './home-recent-apps-model.js';
import { displayRuntimeConfigCapabilityLabel } from '../runtime-config/runtime-config-capability-labels.js';

const zhiyuIcon = new URL('../../../../../../zhiyu/src/shell/assets/app-icon.png', import.meta.url).href;

export type HomeQuickJumpGroup = 'apps' | 'partners' | 'capabilities' | 'pages';

export type HomeQuickJumpItem = Readonly<{
  id: string;
  group: HomeQuickJumpGroup;
  label: string;
  badge?: string;
  keywords: string;
  icon: ReactNode;
  onSelect: () => void;
}>;

export type HomeQuickJumpActions = Readonly<{
  onOpenZhiyu: () => void;
  onOpenHarness?: () => void;
  onOpenApp: (appId: string, entryKey: string) => void;
  onOpenPartner: (localAgentRef: string) => void;
  onOpenCapability: (capability: string) => void;
  onOpenExplore: () => void;
  onOpenApps: () => void;
  onOpenModelLibrary: () => void;
  onOpenAIProfiles: () => void;
  onOpenCloud: () => void;
  onOpenConnections: () => void;
  onOpenIntegrations: () => void;
  onOpenDownloads: () => void;
  onOpenAIActivity: () => void;
  onOpenTroubleshooting: () => void;
  onOpenDataStorage: () => void;
}>;

const QUICK_JUMP_CAPABILITIES = [
  'text.generate',
  'image.generate',
  'audio.synthesize',
  'audio.transcribe',
  'video.generate',
  'music.generate',
  'text.embed',
] as const;

export function buildHomeQuickJumpItems(input: {
  t: TFunction;
  apps: readonly DesktopAppsEntry[];
  iconUrls?: ReadonlyMap<string, string | null>;
  partners: readonly LocalAgentListItem[];
  capabilities?: readonly string[];
  actions: HomeQuickJumpActions;
}): HomeQuickJumpItem[] {
  const { t, apps, iconUrls, partners, actions } = input;
  const capabilityList = input.capabilities?.length ? input.capabilities : QUICK_JUMP_CAPABILITIES;

  const installedApps = [
    ...new Map(
      apps
        .filter((entry) => entry.committedRelease || entry.localDevelopment)
        .map((entry) => [entry.identity.appId, entry]),
    ).values(),
  ];

  const bundledZhiyuLabel = t('Apps.bundled.zhiyu');
  const hasOtherZhiyuSource = installedApps.some((entry) => (
    entry.identity.appId === BUNDLED_ZHIYU_APP_ID
    || entry.identity.displayName.trim().toLocaleLowerCase() === bundledZhiyuLabel.trim().toLocaleLowerCase()
  ));

  const appItems: HomeQuickJumpItem[] = [
    {
      id: 'app:zhiyu',
      group: 'apps',
      label: bundledZhiyuLabel,
      badge: hasOtherZhiyuSource ? t('runtimeConfig.overview.appsWorkbench.builtInBadge') : undefined,
      keywords: `${bundledZhiyuLabel} zhiyu nimi.zhiyu ${t('Apps.bundled.zhiyuDescription')}`,
      icon: <img src={zhiyuIcon} alt="" className="size-6 rounded-md object-contain" />,
      onSelect: actions.onOpenZhiyu,
    },
    ...installedApps.map((entry) => {
      const resolvedIcon = entry.iconUrl ?? iconUrls?.get(entry.identity.appId) ?? null;
      const isLocalDevOnly = Boolean(entry.localDevelopment && !entry.committedRelease);
      return {
        id: `app:${entry.identity.appId}`,
        group: 'apps' as const,
        label: entry.identity.displayName,
        badge: isLocalDevOnly ? t('Apps.sourceBadge.devTag') : undefined,
        keywords: `${entry.identity.displayName} ${entry.identity.appId} ${isLocalDevOnly ? `${t('Apps.sourceBadge.devTag')} ${t('runtimeConfig.overview.appsWorkbench.devBadge')}` : ''} ${entry.summary ?? ''}`,
        icon: (
          <AppArtworkIcon
            appId={entry.identity.appId}
            displayName={entry.identity.displayName}
            iconUrl={resolvedIcon}
            size="xs"
          />
        ),
        onSelect: () => actions.onOpenApp(entry.identity.appId, entry.identity.entryKey),
      };
    }),
  ];

  const partnerItems: HomeQuickJumpItem[] = partners.map((partner) => ({
    id: `partner:${partner.localAgentRef}`,
    group: 'partners' as const,
    label: partner.displayName,
    keywords: `${partner.displayName} partner agent companion`,
    icon: <UserRound size={15} aria-hidden="true" />,
    onSelect: () => actions.onOpenPartner(partner.localAgentRef),
  }));

  const capabilityItems: HomeQuickJumpItem[] = capabilityList.map((capability) => {
    const Icon = capabilityIcon(capability);
    const label = displayRuntimeConfigCapabilityLabel(capability, t);
    return {
      id: `capability:${capability}`,
      group: 'capabilities' as const,
      label,
      keywords: `${label} ${capability}`,
      icon: <Icon size={15} aria-hidden="true" />,
      onSelect: () => actions.onOpenCapability(capability),
    };
  });

  const pageItems: HomeQuickJumpItem[] = [
    {
      id: 'page:explore',
      group: 'pages',
      label: t('Navigation.explore'),
      keywords: `${t('Navigation.explore')} explore world character`,
      icon: <Compass size={15} aria-hidden="true" />,
      onSelect: actions.onOpenExplore,
    },
    {
      id: 'page:apps',
      group: 'pages',
      label: t('Navigation.apps'),
      keywords: `${t('Navigation.apps')} apps catalog store`,
      icon: <AppWindow size={15} aria-hidden="true" />,
      onSelect: actions.onOpenApps,
    },
    {
      id: 'page:ai-profiles',
      group: 'pages',
      label: t('runtimeConfig.overview.quickJump.items.aiProfiles'),
      keywords: `${t('runtimeConfig.overview.quickJump.items.aiProfiles')} profile loadout`,
      icon: <Layers size={15} aria-hidden="true" />,
      onSelect: actions.onOpenAIProfiles,
    },
    {
      id: 'page:model-library',
      group: 'pages',
      label: t('runtimeConfig.overview.quickJump.items.modelLibrary'),
      keywords: `${t('runtimeConfig.overview.quickJump.items.modelLibrary')} model local`,
      icon: <Layers size={15} aria-hidden="true" />,
      onSelect: actions.onOpenModelLibrary,
    },
    {
      id: 'page:cloud',
      group: 'pages',
      label: t('runtimeConfig.overview.quickJump.items.cloudServices'),
      keywords: `${t('runtimeConfig.overview.quickJump.items.cloudServices')} cloud api connector`,
      icon: <Cloud size={15} aria-hidden="true" />,
      onSelect: actions.onOpenCloud,
    },
    {
      id: 'page:ai-activity',
      group: 'pages',
      label: t('runtimeConfig.overview.quickJump.items.aiActivity'),
      keywords: `${t('runtimeConfig.overview.quickJump.items.aiActivity')} spend cost usage billing`,
      icon: <Activity size={15} aria-hidden="true" />,
      onSelect: actions.onOpenAIActivity,
    },
    {
      id: 'page:connections',
      group: 'pages',
      label: t('runtimeConfig.overview.quickJump.items.connections'),
      keywords: `${t('runtimeConfig.overview.quickJump.items.connections')} remote primary runtime`,
      icon: <Network size={15} aria-hidden="true" />,
      onSelect: actions.onOpenConnections,
    },
    {
      id: 'page:integrations',
      group: 'pages',
      label: t('runtimeConfig.overview.quickJump.items.integrations'),
      keywords: `${t('runtimeConfig.overview.quickJump.items.integrations')} mcp telegram feishu weixin`,
      icon: <Plug size={15} aria-hidden="true" />,
      onSelect: actions.onOpenIntegrations,
    },
    {
      id: 'page:downloads',
      group: 'pages',
      label: t('runtimeConfig.overview.quickJump.items.downloads'),
      keywords: `${t('runtimeConfig.overview.quickJump.items.downloads')} download transfer`,
      icon: <Download size={15} aria-hidden="true" />,
      onSelect: actions.onOpenDownloads,
    },
    {
      id: 'page:storage',
      group: 'pages',
      label: t('runtimeConfig.overview.quickJump.items.dataStorage'),
      keywords: `${t('runtimeConfig.overview.quickJump.items.dataStorage')} disk storage cache`,
      icon: <HardDrive size={15} aria-hidden="true" />,
      onSelect: actions.onOpenDataStorage,
    },
    {
      id: 'page:troubleshooting',
      group: 'pages',
      label: t('runtimeConfig.overview.quickJump.items.troubleshooting'),
      keywords: `${t('runtimeConfig.overview.quickJump.items.troubleshooting')} logs support repair`,
      icon: <Wrench size={15} aria-hidden="true" />,
      onSelect: actions.onOpenTroubleshooting,
    },
  ];

  return [...appItems, ...partnerItems, ...capabilityItems, ...pageItems];
}

export function filterHomeQuickJumpItems(
  items: readonly HomeQuickJumpItem[],
  query: string,
): HomeQuickJumpItem[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    let shownPartners = 0;
    return items.filter((item) => item.group !== 'partners' || ++shownPartners <= 12);
  }
  return items.filter(
    (item) =>
      item.label.toLowerCase().includes(normalized)
      || item.keywords.toLowerCase().includes(normalized),
  );
}

// @nimi-authority: rule.nimi.desktop.shell-ui.r018
// @nimi-authority: rule.nimi.desktop.shell-ui.standard-navigation
export function HomeQuickJumpModal({
  open,
  onClose,
  items,
}: {
  open: boolean;
  onClose: () => void;
  items: readonly HomeQuickJumpItem[];
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listId = useId();
  const activeOption = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setActiveIndex(0);
    }
  }, [open]);

  const filtered = useMemo(() => filterHomeQuickJumpItems(items, query), [items, query]);
  const boundedIndex = filtered.length === 0 ? -1 : Math.min(activeIndex, filtered.length - 1);
  const selectedItem = filtered[boundedIndex];
  useLayoutEffect(() => {
    if (open) activeOption.current?.scrollIntoView({ block: 'nearest' });
  }, [open, selectedItem?.id]);

  const grouped = useMemo(() => {
    const order: readonly HomeQuickJumpGroup[] = ['apps', 'partners', 'capabilities', 'pages'];
    return order
      .map((group) => ({
        group,
        entries: filtered.filter((item) => item.group === group),
      }))
      .filter((section) => section.entries.length > 0);
  }, [filtered]);

  const commitItem = (item: HomeQuickJumpItem) => {
    onClose();
    item.onSelect();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (filtered.length > 0) {
        setActiveIndex((boundedIndex + 1) % filtered.length);
      }
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (filtered.length > 0) {
        setActiveIndex((boundedIndex - 1 + filtered.length) % filtered.length);
      }
      return;
    }
    if (event.key === 'Enter' && boundedIndex >= 0) {
      event.preventDefault();
      const target = filtered[boundedIndex];
      if (target) commitItem(target);
    }
  };

  return (
    <OverlayShell
      open={open}
      kind="dialog"
      onClose={onClose}
      dataTestId="home-quick-jump-modal"
      panelClassName="w-full max-w-xl overflow-hidden rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)]"
      contentClassName="flex flex-col p-0"
    >
      <DialogTitle className="sr-only">{t('runtimeConfig.overview.quickJump.title')}</DialogTitle>
      <DialogDescription className="sr-only">{t('runtimeConfig.overview.quickJump.description')}</DialogDescription>
      <div className="border-b border-[var(--nimi-border-subtle)] p-3">
        <SearchField
          autoFocus
          role="combobox"
          aria-autocomplete="list"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={selectedItem ? `${listId}-${selectedItem.id}` : undefined}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={handleKeyDown}
          onClear={() => {
            setQuery('');
            setActiveIndex(0);
          }}
          clearLabel={t('Common.clear')}
          placeholder={t('runtimeConfig.overview.quickJump.placeholder')}
          aria-label={t('runtimeConfig.overview.quickJump.title')}
          data-testid="home-quick-jump-input"
        />
      </div>
      <ScrollArea className="max-h-96" contentClassName="p-2">
        <div id={listId} role="listbox" aria-label={t('runtimeConfig.overview.quickJump.title')} className="flex flex-col gap-3">
          {grouped.map((section) => (
            <div key={section.group} role="group" aria-labelledby={`${listId}-group-${section.group}`} className="flex flex-col gap-1">
              <p id={`${listId}-group-${section.group}`} className="px-2.5 py-1 text-xs font-semibold text-[var(--nimi-text-secondary)]">
                {t(`runtimeConfig.overview.quickJump.groups.${section.group}`)}
              </p>
              {section.entries.map((item) => {
                const selected = item === selectedItem;
                return (
                  <button
                    key={item.id}
                    id={`${listId}-${item.id}`}
                    ref={selected ? activeOption : undefined}
                    role="option"
                    aria-selected={selected}
                    tabIndex={-1}
                    type="button"
                    onPointerMove={() => { if (!selected) setActiveIndex(filtered.indexOf(item)); }}
                    onClick={() => commitItem(item)}
                    data-testid={`home-quick-jump-item:${item.id}`}
                    className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition-colors ${
                      selected
                        ? 'bg-[var(--nimi-surface-active)] font-medium text-[var(--nimi-text-primary)]'
                        : 'text-[var(--nimi-text-primary)] hover:bg-[var(--nimi-surface-panel)]'
                    }`}
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-secondary)]">
                      {item.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.badge ? (
                      <span className="shrink-0 rounded-md bg-[var(--nimi-surface-panel)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--nimi-text-secondary)]">
                        {item.badge}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        {grouped.length === 0 ? (
          <p role="status" className="py-8 text-center text-sm text-[var(--nimi-text-secondary)]" data-testid="home-quick-jump-empty">
            {t('runtimeConfig.overview.quickJump.empty')}
          </p>
        ) : null}
      </ScrollArea>
    </OverlayShell>
  );
}
