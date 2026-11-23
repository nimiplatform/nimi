import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { FieldShell, Popover, PopoverContent, PopoverTrigger, cn } from '@nimiplatform/kit/ui';
import { Check, ChevronDown, Search } from 'lucide-react';

// ISO 3166-1 alpha-2 values; Intl supplies the localized country/region names.
const COUNTRY_CODES = `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ
BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ
CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ
DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR
GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY
HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP
KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY
MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ
NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY
QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ
TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ
VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`.split(/\s+/);

const COUNTRY_CODE_SET = new Set(COUNTRY_CODES);

export function formatCountryName(countryCode: string | null | undefined, locale: string): string {
  const normalized = String(countryCode || '').trim().toUpperCase();
  if (!normalized) return '';
  try {
    const names = new Intl.DisplayNames([locale], { type: 'region' });
    return names.of(normalized) || normalized;
  } catch {
    return normalized;
  }
}

type CountryOption = {
  value: string;
  label: string;
  searchText: string;
  disabled?: boolean;
};

export function ProfileCountryField(input: {
  label: string;
  emptyLabel: string;
  searchPlaceholder?: string;
  noResultsLabel?: string;
  value: string;
  locale: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const value = input.value.trim().toUpperCase();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const options = useMemo<CountryOption[]>(() => {
    const localizedNames = new Intl.DisplayNames([input.locale], { type: 'region' });
    const englishNames = new Intl.DisplayNames(['en'], { type: 'region' });
    const collator = new Intl.Collator(input.locale);
    const countryOptions = COUNTRY_CODES.map((code) => {
      const label = localizedNames.of(code) || code;
      const english = englishNames.of(code) || code;
      return {
        value: code,
        label,
        searchText: `${label} ${english} ${code}`.toLocaleLowerCase(),
      };
    }).sort((left, right) => collator.compare(left.label, right.label));

    const allOptions: CountryOption[] = [
      {
        value: '',
        label: input.emptyLabel,
        searchText: input.emptyLabel.toLocaleLowerCase(),
      },
      ...countryOptions,
    ];
    if (value && !COUNTRY_CODE_SET.has(value)) {
      allOptions.push({ value, label: value, searchText: value.toLocaleLowerCase(), disabled: true });
    }
    return allOptions;
  }, [input.locale, input.emptyLabel, value]);

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLocaleLowerCase();
    if (!trimmed) return options;
    return options.filter((option) => option.searchText.includes(trimmed));
  }, [options, query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    const selectedIdx = filtered.findIndex((option) => option.value === value && !option.disabled);
    setActiveIndex(selectedIdx >= 0 ? selectedIdx : 0);
  }, [open, value]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const selectedLabel = useMemo(() => {
    if (!value) return input.emptyLabel;
    return options.find((option) => option.value === value)?.label || value;
  }, [input.emptyLabel, options, value]);

  const selectOption = (option: CountryOption) => {
    if (option.disabled) return;
    input.onChange(option.value);
    setOpen(false);
  };

  return (
    <FieldShell label={input.label}>
      <Popover open={open} onOpenChange={(next) => { if (!input.disabled) setOpen(next); }}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={input.disabled}
            aria-label={input.label}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            data-testid="profile-country-trigger"
            className={cn(
              'flex min-h-[var(--nimi-sizing-field-md-height)] w-full items-center justify-between gap-2 rounded-[var(--nimi-radius-field)] border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] px-3 text-left text-sm text-[var(--nimi-field-text)] transition-colors duration-[var(--nimi-motion-fast)] outline-none enabled:hover:border-[var(--nimi-field-focus)] focus-visible:border-[var(--nimi-field-focus)] focus-visible:ring-[length:var(--nimi-focus-ring-width)] focus-visible:ring-[var(--nimi-focus-ring-color)] disabled:cursor-not-allowed disabled:opacity-[var(--nimi-opacity-disabled)]',
              !value && 'text-[var(--nimi-text-secondary)]',
            )}
          >
            <span className="min-w-0 flex-1 truncate">{selectedLabel}</span>
            <ChevronDown size={16} className="shrink-0 text-[var(--nimi-text-muted)]" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] min-w-[240px] p-0 overflow-hidden"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            searchRef.current?.focus();
          }}
        >
          <div className="border-b border-[var(--nimi-border-subtle)] p-2">
            <label className="flex items-center gap-2 rounded-[var(--nimi-radius-sm)] border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] px-2.5 py-1.5 text-sm focus-within:border-[var(--nimi-field-focus)]">
              <Search size={14} className="shrink-0 text-[var(--nimi-text-muted)]" aria-hidden="true" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                placeholder={input.searchPlaceholder || input.label}
                aria-label={input.searchPlaceholder || input.label}
                data-testid="profile-country-search"
                className="min-w-0 flex-1 bg-transparent text-sm text-[var(--nimi-field-text)] outline-none placeholder:text-[var(--nimi-field-placeholder)] [&::-webkit-search-cancel-button]:appearance-none"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setActiveIndex((index) => Math.min(Math.max(filtered.length - 1, 0), index + 1));
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    setActiveIndex((index) => Math.max(0, index - 1));
                  } else if (event.key === 'Enter') {
                    const target = filtered[activeIndex];
                    if (target && !target.disabled) {
                      event.preventDefault();
                      selectOption(target);
                    }
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    setOpen(false);
                  }
                }}
              />
            </label>
          </div>
          <ul
            id={listId}
            role="listbox"
            aria-label={input.label}
            className="max-h-60 overflow-y-auto overscroll-contain p-1"
          >
            {filtered.length ? filtered.map((option, index) => {
              const selected = option.value === value;
              const active = index === activeIndex;
              return (
                <li key={option.value || '__unspecified__'} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    disabled={option.disabled}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectOption(option)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-[var(--nimi-radius-sm)] px-2.5 py-2 text-left text-sm text-[var(--nimi-text-primary)] outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-[var(--nimi-opacity-disabled)]',
                      active && 'bg-[var(--nimi-action-ghost-hover)]',
                      selected && 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] font-medium',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {option.value ? (
                        <span className="font-mono text-xs text-[var(--nimi-text-muted)]">{option.value}</span>
                      ) : null}
                      {selected ? <Check size={14} className="text-[var(--nimi-action-primary-bg)]" aria-hidden="true" /> : null}
                    </span>
                  </button>
                </li>
              );
            }) : (
              <li className="px-3 py-2.5 text-sm text-[var(--nimi-text-muted)]">
                {input.noResultsLabel || '—'}
              </li>
            )}
          </ul>
        </PopoverContent>
      </Popover>
    </FieldShell>
  );
}
