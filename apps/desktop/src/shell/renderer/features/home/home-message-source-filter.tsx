import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Avatar, Button, IconButton, Popover, PopoverContent, PopoverTrigger, SearchField } from '@nimiplatform/kit/ui';
import { Check, ChevronDown, LayoutGrid, MessageCircle, Settings2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { messageSourceLabel } from './home-message-card.js';
import { compareTimelineMessages, messageCenterSourceKey, type HomeMessage, type HomeMessageDomain } from './home-messages-model.js';

type Translate = ReturnType<typeof useTranslation>['t'];
const DOMAINS = ['app', 'runtime-agent', 'system'] as const;
const DOMAIN_ICONS = { app: LayoutGrid, 'runtime-agent': MessageCircle, system: Settings2 };

export type MessageSourceOption = Readonly<{
  value: string;
  label: string;
  domain: HomeMessageDomain;
  appId: string | null;
  detail: string | null;
  searchText: string;
}>;

// @nimi-authority: rule.nimi.desktop.product-surfaces.r036
/** One App option per trusted appId; never merge different apps by their display name. */
export function messageSourceOptions(messages: readonly HomeMessage[], t: Translate): MessageSourceOption[] {
  const sources = new Map<string, MessageSourceOption>();
  for (const message of [...messages].sort(compareTimelineMessages)) {
    const value = messageCenterSourceKey(message);
    const label = message.sourceKind === 'runtime-agent' && message.record.agent
      ? message.record.agent.displayName
      : messageSourceLabel(message, t);
    const appId = message.sourceKind === 'app' ? message.record.source.appId : null;
    const existing = sources.get(value);
    sources.set(value, existing ? {
      ...existing,
      searchText: `${existing.searchText}\n${label}`,
    } : { value, label, domain: message.sourceKind, appId, detail: null, searchText: `${label}\n${appId ?? ''}` });
  }
  const options = [...sources.values()];
  return options.map((option) => ({
    ...option,
    detail: options.some((other) => other.value !== option.value && other.domain === option.domain && other.label === option.label)
      ? option.appId ?? option.value : null,
  })).sort((left, right) => DOMAINS.indexOf(left.domain) - DOMAINS.indexOf(right.domain)
    || left.label.localeCompare(right.label) || left.value.localeCompare(right.value));
}

export function searchMessageSources(options: readonly MessageSourceOption[], query: string): MessageSourceOption[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  return options.filter((option) => terms.every((term) => option.searchText.toLocaleLowerCase().includes(term)));
}

export function HomeMessageSourceFilter({ options, value, onChange, appIconUrl }: {
  options: readonly MessageSourceOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  appIconUrl: (appId: string | null) => string | null;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value);
  const visible = searchMessageSources(options, query);
  const allLabel = t('runtimeConfig.overview.messages.allSources');
  const selectedLabel = selected ? [selected.label, selected.detail].filter(Boolean).join(' · ') : allLabel;
  const setOpened = (next: boolean) => { setOpen(next); if (!next) setQuery(''); };
  const choose = (next: string | null) => { onChange(next); setOpened(false); };
  const optionButtons = () => {
    return Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
  };
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = optionButtons();
    const current = buttons.indexOf(event.target as HTMLButtonElement);
    if (current < 0) return;
    let target: number;
    switch (event.key) {
      case 'ArrowDown': target = Math.min(current + 1, buttons.length - 1); break;
      case 'ArrowUp': target = current - 1; break;
      case 'Home': target = 0; break;
      case 'End': target = buttons.length - 1; break;
      default: return;
    }
    event.preventDefault();
    if (target < 0) inputRef.current?.focus();
    else buttons[target]?.focus();
  };
  const option = (source: MessageSourceOption | null) => {
    const active = source ? source.value === value : !value;
    const Icon = source ? DOMAIN_ICONS[source.domain] : LayoutGrid;
    return (
      <Button
        key={source?.value ?? 'all'}
        role="option"
        aria-selected={active}
        tabIndex={active || (value && !visible.some((item) => item.value === value) && !source) ? 0 : -1}
        tone="ghost"
        size="sm"
        active={active}
        className="min-h-10 w-full justify-start rounded-lg px-2.5 py-2 text-left font-normal [&>span:nth-child(2)]:flex-1 [&>span:nth-child(2)]:justify-start"
        leadingIcon={source?.appId
          ? <Avatar src={appIconUrl(source.appId)} alt="" fallback={<LayoutGrid size={15} />} size="sm" shape="rounded" className="size-6 rounded-md" />
          : <span className="flex size-6 items-center justify-center"><Icon size={16} aria-hidden="true" /></span>}
        trailingIcon={active ? <Check size={16} aria-hidden="true" className="text-[var(--nimi-status-info)]" /> : undefined}
        onClick={() => choose(source?.value ?? null)}
      >
        <span className="flex min-w-0 flex-1 flex-col items-start">
          <span className="w-full truncate">{source?.label ?? allLabel}</span>
          {source?.detail ? <span className="w-full truncate text-xs text-[var(--nimi-text-muted)]">{source.detail}</span> : null}
        </span>
      </Button>
    );
  };
  return (
    <div className="flex w-full items-center gap-1 sm:w-auto">
      <Popover open={open} onOpenChange={setOpened}>
        <PopoverTrigger asChild>
          <Button
            ref={triggerRef}
            tone="secondary"
            size="sm"
            className="min-h-9 min-w-0 flex-1 justify-between text-left font-normal sm:w-64"
            aria-label={`${t('runtimeConfig.overview.messages.sourceFilterLabel')}：${selectedLabel}`}
            title={selectedLabel}
            trailingIcon={<ChevronDown size={15} aria-hidden="true" />}
            data-testid="home-message-center-source"
          >
            <span className="truncate">{selectedLabel}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end" sideOffset={6}
          className="flex max-h-[var(--radix-popover-content-available-height)] w-72 max-w-[calc(100vw-2rem)] flex-col overflow-hidden p-2"
          onOpenAutoFocus={(event) => { event.preventDefault(); inputRef.current?.focus(); }}
        >
          <div className="shrink-0 pb-2">
            <SearchField
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('runtimeConfig.overview.messages.searchSources')}
              aria-label={t('runtimeConfig.overview.messages.searchSources')}
              aria-controls={listId}
              className="min-h-9 text-sm"
              onKeyDown={(event) => {
                if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                event.preventDefault();
                const buttons = optionButtons();
                (event.key === 'ArrowDown' ? buttons[0] : buttons.at(-1))?.focus();
              }}
            />
          </div>
          <div ref={listRef} id={listId} role="listbox" aria-label={t('runtimeConfig.overview.messages.sourceFilterLabel')} onKeyDown={navigate} className="min-h-0 overflow-y-auto overscroll-contain">
            {option(null)}
            {DOMAINS.map((domain) => {
              const items = visible.filter((source) => source.domain === domain);
              return items.length ? (
                <div key={domain} role="group" aria-labelledby={`${listId}-${domain}`} className="mt-1 border-t border-[var(--nimi-border-subtle)] pt-1">
                  <div id={`${listId}-${domain}`} className="px-2.5 pb-1 pt-2 text-xs font-medium text-[var(--nimi-text-muted)]">{t(`runtimeConfig.overview.messages.sourceGroups.${domain}`)}</div>
                  {items.map(option)}
                </div>
              ) : null;
            })}
          </div>
          {!visible.length ? <p role="status" className="px-3 py-6 text-center text-sm text-[var(--nimi-text-secondary)]">{t('runtimeConfig.overview.messages.noMatchingSources')}</p> : null}
        </PopoverContent>
      </Popover>
      {value ? <IconButton
        tone="ghost" size="sm" icon={<X size={15} />}
        aria-label={t('runtimeConfig.overview.messages.clearSourceFilter')}
        title={t('runtimeConfig.overview.messages.clearSourceFilter')}
        onClick={() => { choose(null); triggerRef.current?.focus(); }}
        data-testid="home-message-center-clear-source"
      /> : null}
    </div>
  );
}
