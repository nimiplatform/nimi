import { useId, useMemo, useRef, useState } from 'react';
import { cn } from '@nimiplatform/kit/ui';
import { X } from 'lucide-react';
import { parseProfileList } from './profile-edit-model.js';

export const COMMON_LANGUAGE_PRESETS = [
  { code: 'zh', nativeLabel: '中文' },
  { code: 'en', nativeLabel: 'English' },
  { code: 'ja', nativeLabel: '日本語' },
  { code: 'ko', nativeLabel: '한국어' },
  { code: 'fr', nativeLabel: 'Français' },
  { code: 'de', nativeLabel: 'Deutsch' },
  { code: 'es', nativeLabel: 'Español' },
  { code: 'pt', nativeLabel: 'Português' },
  { code: 'ru', nativeLabel: 'Русский' },
] as const;

const PRESET_BY_CODE = new Map<string, string>(
  COMMON_LANGUAGE_PRESETS.map((preset) => [preset.code, preset.nativeLabel]),
);

export function formatLanguageChipLabel(raw: string): string {
  const preset = PRESET_BY_CODE.get(raw.trim().toLowerCase());
  return preset ? `${preset} (${raw})` : raw;
}

export function formatProfileLanguages(languages: readonly string[], locale: string): string {
  if (!languages.length) return '';
  let displayNames: Intl.DisplayNames | null = null;
  try {
    displayNames = new Intl.DisplayNames([locale], { type: 'language' });
  } catch {
    displayNames = null;
  }
  const labels = languages.map((raw) => {
    const trimmed = raw.trim();
    if (!trimmed) return raw;
    if (/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(trimmed) && displayNames) {
      try {
        return displayNames.of(trimmed) || PRESET_BY_CODE.get(trimmed.toLowerCase()) || trimmed;
      } catch {
        return PRESET_BY_CODE.get(trimmed.toLowerCase()) || trimmed;
      }
    }
    return trimmed;
  });
  try {
    return new Intl.ListFormat(locale, { style: 'narrow', type: 'conjunction' }).format(labels);
  } catch {
    return labels.join(', ');
  }
}

type ChipInputProps = {
  id?: string;
  label: string;
  value: readonly string[];
  maxItems: number;
  maxItemLength: number;
  placeholder: string;
  disabled?: boolean;
  error?: string | null;
  removeLabel: (item: string) => string;
  duplicateMessage: string;
  maxItemsMessage: string;
  maxLengthMessage: string;
  formatItem?: (item: string) => string;
  suggestions?: readonly { value: string; label: string; searchText: string }[];
  suggestionsHint?: string;
  testId?: string;
  onChange: (next: string[]) => void;
};

function ProfileChipField({
  id,
  label,
  value,
  maxItems,
  maxItemLength,
  placeholder,
  disabled,
  error,
  removeLabel,
  duplicateMessage,
  maxItemsMessage,
  maxLengthMessage,
  formatItem,
  suggestions,
  suggestionsHint,
  testId,
  onChange,
}: ChipInputProps) {
  const generatedId = useId();
  const inputId = id || `${generatedId}-input`;
  const messageId = `${generatedId}-message`;
  const listboxId = `${generatedId}-listbox`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [draftText, setDraftText] = useState('');
  const [focused, setFocused] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const [localError, setLocalError] = useState<string | null>(null);

  const visibleError = error || localError;
  const nearLimit = value.length >= maxItems;

  const commitRaw = (raw: string): boolean => {
    const tokens = parseProfileList(raw);
    if (!tokens.length) {
      setDraftText('');
      return true;
    }
    const next = [...value];
    let added = false;
    let duplicateSkipped = false;
    for (const token of tokens) {
      if (token.length > maxItemLength) {
        setLocalError(maxLengthMessage);
        return false;
      }
      if (next.some((existing) => existing.toLocaleLowerCase() === token.toLocaleLowerCase())) {
        duplicateSkipped = true;
        continue;
      }
      if (next.length >= maxItems) {
        setLocalError(maxItemsMessage);
        return false;
      }
      next.push(token);
      added = true;
    }
    setLocalError(duplicateSkipped && !added ? duplicateMessage : null);
    setDraftText('');
    if (added) onChange(next);
    return true;
  };

  const removeAt = (index: number) => {
    setLocalError(null);
    onChange(value.filter((_, idx) => idx !== index));
  };

  const filteredSuggestions = useMemo(() => {
    if (!suggestions?.length) return [];
    const existingLower = new Set(value.map((item) => item.toLocaleLowerCase()));
    const query = draftText.trim().toLocaleLowerCase();
    return suggestions.filter((option) => (
      !existingLower.has(option.value.toLocaleLowerCase())
      && (!query || option.searchText.includes(query))
    ));
  }, [suggestions, value, draftText]);

  const showSuggestions = Boolean(focused && !disabled && suggestions?.length && filteredSuggestions.length > 0 && value.length < maxItems);
  const boundedSuggestionIndex = showSuggestions && activeSuggestionIndex >= 0 && activeSuggestionIndex < filteredSuggestions.length
    ? activeSuggestionIndex
    : -1;
  const activeSuggestionId = boundedSuggestionIndex >= 0
    ? `${listboxId}-option-${boundedSuggestionIndex}`
    : undefined;

  return (
    <div className="nimi-field-shell relative flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={inputId}
          className="nimi-field-shell__label text-[length:var(--nimi-type-label-size)] font-medium text-[var(--nimi-text-secondary)]"
        >
          {label}
        </label>
        <span
          className={cn(
            'text-[length:var(--nimi-type-caption-size)] tabular-nums',
            nearLimit ? 'font-medium text-[var(--nimi-status-warning)]' : 'text-[var(--nimi-text-muted)]',
          )}
        >
          {value.length} / {maxItems}
        </span>
      </div>

      <div
        data-testid={testId}
        onClick={() => { if (!disabled) inputRef.current?.focus(); }}
        className={cn(
          'flex min-h-[var(--nimi-sizing-field-md-height)] w-full flex-wrap items-center gap-1.5 rounded-[var(--nimi-radius-field)] border bg-[var(--nimi-field-bg)] px-2.5 py-1.5 text-[var(--nimi-field-text)] transition-colors duration-[var(--nimi-motion-fast)]',
          visibleError
            ? 'border-[var(--nimi-status-danger)] focus-within:border-[var(--nimi-status-danger)] focus-within:ring-[length:var(--nimi-focus-ring-width)] focus-within:ring-[var(--nimi-status-danger)]'
            : 'border-[var(--nimi-field-border)] focus-within:border-[var(--nimi-field-focus)] focus-within:ring-[length:var(--nimi-focus-ring-width)] focus-within:ring-[var(--nimi-focus-ring-color)]',
          disabled ? 'cursor-not-allowed opacity-[var(--nimi-opacity-disabled)]' : 'cursor-text',
        )}
      >
        {value.map((item, index) => (
          <span
            key={item}
            className="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] py-0.5 pl-2.5 pr-1.5 text-xs text-[var(--nimi-text-primary)]"
          >
            <span className="truncate">{formatItem ? formatItem(item) : item}</span>
            <button
              type="button"
              disabled={disabled}
              aria-label={removeLabel(item)}
              onClick={(event) => {
                event.stopPropagation();
                removeAt(index);
              }}
              className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--nimi-text-muted)] hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nimi-field-focus)]"
            >
              <X size={11} aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role={suggestions?.length ? 'combobox' : undefined}
          aria-autocomplete={suggestions?.length ? 'list' : undefined}
          aria-expanded={suggestions?.length ? showSuggestions : undefined}
          aria-controls={showSuggestions ? listboxId : undefined}
          aria-activedescendant={activeSuggestionId}
          disabled={disabled}
          value={draftText}
          placeholder={value.length < maxItems ? placeholder : ''}
          aria-invalid={visibleError ? true : undefined}
          aria-describedby={visibleError ? messageId : undefined}
          data-testid={testId ? `${testId}-input` : undefined}
          className="min-w-[180px] flex-1 bg-transparent py-0.5 text-sm text-[var(--nimi-field-text)] outline-none placeholder:text-[var(--nimi-field-placeholder)]"
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setActiveSuggestionIndex(-1);
            if (draftText.trim()) commitRaw(draftText);
          }}
          onChange={(event) => {
            const raw = event.target.value;
            setLocalError(null);
            setActiveSuggestionIndex(-1);
            if (/[,，、\n]/u.test(raw)) {
              commitRaw(raw);
            } else {
              setDraftText(raw);
            }
          }}
          onKeyDown={(event) => {
            if (showSuggestions && event.key === 'ArrowDown') {
              event.preventDefault();
              setActiveSuggestionIndex((idx) => (idx + 1) % filteredSuggestions.length);
              return;
            }
            if (showSuggestions && event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveSuggestionIndex((idx) => (idx <= 0 ? filteredSuggestions.length - 1 : idx - 1));
              return;
            }
            if (event.key === 'Enter' && showSuggestions && boundedSuggestionIndex >= 0) {
              event.preventDefault();
              const selected = filteredSuggestions[boundedSuggestionIndex];
              if (selected) {
                commitRaw(selected.value);
                setActiveSuggestionIndex(-1);
              }
              return;
            }
            if (event.key === 'Enter' && draftText.trim()) {
              event.preventDefault();
              commitRaw(draftText);
            } else if (event.key === 'Backspace' && !draftText && value.length > 0) {
              event.preventDefault();
              removeAt(value.length - 1);
            } else if (event.key === 'Escape') {
              setFocused(false);
              setActiveSuggestionIndex(-1);
            }
          }}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData('text');
            if (/[,，、\n]/u.test(pasted)) {
              event.preventDefault();
              commitRaw(`${draftText}${pasted}`);
            }
          }}
        />
      </div>

      {showSuggestions ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label={label}
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-[var(--nimi-z-popover)] rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-overlay)] p-2 shadow-[var(--nimi-elevation-floating)]"
        >
          {suggestionsHint ? (
            <p className="mb-1.5 px-1 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">
              {suggestionsHint}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            {filteredSuggestions.map((option, index) => {
              const selected = index === boundedSuggestionIndex;
              return (
                <button
                  key={option.value}
                  id={`${listboxId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    commitRaw(option.value);
                    setActiveSuggestionIndex(-1);
                  }}
                  onMouseDown={(event) => {
                    if (event.defaultPrevented) {
                      return;
                    }
                    event.preventDefault();
                    commitRaw(option.value);
                    setActiveSuggestionIndex(-1);
                  }}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs transition-[transform,border-color,color,background-color] duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nimi-focus-ring-color)]',
                    selected
                      ? 'border-[var(--nimi-field-focus)] bg-[var(--nimi-action-ghost-hover)] text-[var(--nimi-action-primary-bg)]'
                      : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-primary)] hover:border-[var(--nimi-field-focus)] hover:text-[var(--nimi-action-primary-bg)]',
                  )}
                >
                  + {option.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {visibleError ? (
        <div
          id={messageId}
          role="alert"
          className="nimi-field-shell__message text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-status-danger)]"
        >
          {visibleError}
        </div>
      ) : null}
    </div>
  );
}

export function ProfileTagInput(props: Omit<ChipInputProps, 'formatItem' | 'suggestions' | 'suggestionsHint'>) {
  return <ProfileChipField {...props} />;
}

export function ProfileLanguageInput(
  props: Omit<ChipInputProps, 'formatItem' | 'suggestions'> & { locale: string },
) {
  const { locale, ...rest } = props;
  const suggestions = useMemo(() => {
    let displayNames: Intl.DisplayNames | null = null;
    try {
      displayNames = new Intl.DisplayNames([locale], { type: 'language' });
    } catch {
      displayNames = null;
    }
    return COMMON_LANGUAGE_PRESETS.map((preset) => {
      const localized = displayNames?.of(preset.code) || preset.nativeLabel;
      return {
        value: preset.code,
        label: `${preset.nativeLabel} (${preset.code})`,
        searchText: `${preset.code} ${preset.nativeLabel} ${localized}`.toLocaleLowerCase(),
      };
    });
  }, [locale]);

  return (
    <ProfileChipField
      {...rest}
      formatItem={formatLanguageChipLabel}
      suggestions={suggestions}
    />
  );
}
