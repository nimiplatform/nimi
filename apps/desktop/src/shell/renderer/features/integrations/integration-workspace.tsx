import { Blocks, Clock3, KeyRound, SearchX } from 'lucide-react';
import { Button, ScrollArea, SearchField, SidebarShell } from '@nimiplatform/kit/ui';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import type { NimiIntegrationTarget } from '@nimiplatform/sdk/app';

export const INTEGRATION_SERVICES = [
  'feishu',
  'weixin',
  'qq-official',
  'telegram',
  'mcp',
  'onebot-v11',
  'app',
] as const;
export type IntegrationTab = 'permissions' | 'calls' | 'settings';

export function serviceLabel(kind: string, t: (key: string, options?: { defaultValue: string }) => string) {
  return kind === 'app'
    ? t('Integrations.appProvided')
    : t(`Integrations.adapters.${kind}`, { defaultValue: kind });
}

// Vendored official marks; sources are listed alongside the assets.
const SERVICE_LOGOS: Readonly<Record<string, string>> = {
  feishu: './integration-logos/feishu.svg',
  weixin: './integration-logos/weixin.png',
  'qq-official': './integration-logos/qq-official.png',
  telegram: './integration-logos/telegram.svg',
  mcp: './integration-logos/mcp.svg',
  'onebot-v11': './integration-logos/onebot-v11.png',
};

export function IntegrationServiceIcon({ kind, large = false }: { kind: string; large?: boolean }) {
  const logo = SERVICE_LOGOS[kind];
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center ${logo ? 'bg-white' : 'bg-[var(--nimi-surface-active)] text-[var(--nimi-action-primary-bg)]'} ${large ? 'size-14 rounded-2xl' : 'size-7 rounded-lg'}`}
    >
      {logo ? (
        <img src={logo} alt="" aria-hidden="true" className={`object-contain ${large ? 'size-10' : 'size-6'}`} />
      ) : (
        <Blocks size={large ? 28 : 17} aria-hidden="true" />
      )}
    </span>
  );
}

export function IntegrationSidebar({
  targets,
  selected,
  onSelect,
  disabled,
}: {
  targets: readonly NimiIntegrationTarget[];
  selected: string;
  onSelect: (kind: string) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  // Retain Runtime kinds that are not represented by a built-in connection form.
  const services = [
    ...INTEGRATION_SERVICES,
    ...new Set(
      targets
        .map((target) => target.kind)
        .filter((kind) => !INTEGRATION_SERVICES.includes(kind as (typeof INTEGRATION_SERVICES)[number])),
    ),
  ];
  const visible = services.filter((kind) =>
    `${serviceLabel(kind, t)} ${kind}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const itemClass = (active: boolean) =>
    `flex min-h-9 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)] ${active ? 'bg-[var(--nimi-surface-active)] font-medium' : 'hover:bg-[var(--nimi-surface-hover)]'}`;
  return (
    <SidebarShell className="h-64 min-h-0 w-full lg:h-auto lg:w-[248px]" data-testid="integrations-sidebar">
      <div className="flex min-h-[var(--nimi-sidebar-header-height)] shrink-0 items-center px-4">
        <div>
          <h1 className="text-base font-semibold">{t('Integrations.title')}</h1>
          <p className="text-[11px] text-[var(--nimi-text-muted)]">
            {t('Integrations.serviceCount', { count: services.length })}
          </p>
        </div>
      </div>
      <div className="px-2 pb-2">
        <SearchField
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setQuery('');
          }}
          placeholder={t('Integrations.searchServices')}
          aria-label={t('Integrations.searchServices')}
          className="min-h-8"
          inputClassName="text-xs"
        />
      </div>
      <ScrollArea className="min-h-0 flex-1" contentClassName="space-y-0.5 px-2 pb-2">
        {visible.map((kind) => {
          const count = targets.filter((target) => target.kind === kind).length;
          return (
            <button
              type="button"
              key={kind}
              data-testid={`integration-service-${kind}`}
              aria-pressed={selected === kind}
              disabled={disabled}
              className={itemClass(selected === kind)}
              onClick={() => onSelect(kind)}
            >
              <IntegrationServiceIcon kind={kind} />
              <span className="min-w-0 flex-1 break-words">{serviceLabel(kind, t)}</span>
              {count > 0 ? (
                <span className="text-xs tabular-nums text-[var(--nimi-text-muted)]">{count}</span>
              ) : null}
            </button>
          );
        })}
        {!visible.length ? (
          <div className="px-2 py-4 text-center text-xs text-[var(--nimi-text-muted)]">
            <SearchX size={18} className="mx-auto mb-2" />
            <p>{t('Integrations.noMatchingServices')}</p>
            <Button tone="ghost" size="sm" onClick={() => setQuery('')}>
              {t('Integrations.clearFilters')}
            </Button>
          </div>
        ) : null}
      </ScrollArea>
      <div className="shrink-0 space-y-0.5 border-t border-[var(--nimi-border-subtle)] p-2">
        <button
          type="button"
          data-testid="integration-all-permissions"
          className={itemClass(selected === 'all-permissions')}
          disabled={disabled}
          aria-pressed={selected === 'all-permissions'}
          onClick={() => onSelect('all-permissions')}
        >
          <KeyRound size={16} aria-hidden="true" />
          {t('Integrations.allPermissions')}
        </button>
        <button
          type="button"
          data-testid="integration-all-calls"
          className={itemClass(selected === 'all-calls')}
          disabled={disabled}
          aria-pressed={selected === 'all-calls'}
          onClick={() => onSelect('all-calls')}
        >
          <Clock3 size={16} aria-hidden="true" />
          {t('Integrations.allCalls')}
        </button>
      </div>
    </SidebarShell>
  );
}
