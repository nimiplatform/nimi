import React from 'react';
import { useTranslation } from 'react-i18next';
import { TextareaField, TextField } from '@nimiplatform/nimi-kit/ui';

export type AdvancedParamsScope = 'textGenerate' | 'textStream';

type AdvancedParamsPopoverProps = {
  scope: AdvancedParamsScope;
  system: string;
  onSystemChange: (value: string) => void;
  temperature: string;
  onTemperatureChange: (value: string) => void;
  maxTokens: string;
  onMaxTokensChange: (value: string) => void;
};

const SLIDERS_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="6" x2="14" y2="6" />
    <line x1="18" y1="6" x2="20" y2="6" />
    <circle cx="16" cy="6" r="2" />
    <line x1="4" y1="12" x2="6" y2="12" />
    <line x1="10" y1="12" x2="20" y2="12" />
    <circle cx="8" cy="12" r="2" />
    <line x1="4" y1="18" x2="14" y2="18" />
    <line x1="18" y1="18" x2="20" y2="18" />
    <circle cx="16" cy="18" r="2" />
  </svg>
);

const TEMP_MIN = 0;
const TEMP_MAX = 2;

export function AdvancedParamsPopover(props: AdvancedParamsPopoverProps) {
  const { scope, system, onSystemChange, temperature, onTemperatureChange, maxTokens, onMaxTokensChange } = props;
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const wrapperRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const node = wrapperRef.current;
      if (node && !node.contains(event.target as Node)) setOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const triggerLabel = t(`Tester.${scope}.advancedParams`, { defaultValue: 'Advanced Parameters' });
  const systemLabel = t(`Tester.${scope}.systemPrompt`, { defaultValue: 'System prompt' });
  const systemPlaceholder = t(`Tester.${scope}.systemPromptPlaceholder`, { defaultValue: 'Optional system prompt' });
  const temperatureLabel = t(`Tester.${scope}.temperature`, { defaultValue: 'Temperature' });
  const maxTokensLabel = t(`Tester.${scope}.maxTokens`, { defaultValue: 'Max tokens' });
  const maxTokensPlaceholder = t(`Tester.${scope}.maxTokensPlaceholder`, { defaultValue: 'Default' });

  const parsedTemp = Number(temperature);
  const tempValue = Number.isFinite(parsedTemp)
    ? Math.min(TEMP_MAX, Math.max(TEMP_MIN, parsedTemp))
    : 1;
  const tempFillPct = ((tempValue - TEMP_MIN) / (TEMP_MAX - TEMP_MIN)) * 100;
  const sliderBackground = `linear-gradient(to right, var(--nimi-action-primary-bg) 0%, var(--nimi-action-primary-bg) ${tempFillPct}%, var(--nimi-text-muted) ${tempFillPct}%, var(--nimi-text-muted) 100%)`;

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={triggerLabel}
        aria-expanded={open}
        title={triggerLabel}
        className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--nimi-border-subtle)] transition-colors hover:border-[var(--nimi-border-strong)] hover:text-[var(--nimi-text-secondary)] ${
          open
            ? 'bg-[var(--nimi-surface-canvas)] text-[var(--nimi-text-primary)]'
            : 'text-[var(--nimi-text-muted)]'
        }`}
      >
        {SLIDERS_ICON}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={triggerLabel}
          className="absolute top-[calc(100%+0.75rem)] left-0 z-[var(--nimi-z-popover,40)] w-[340px] rounded-[var(--nimi-radius-lg)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-4 shadow-[var(--nimi-elevation-floating)]"
        >
          <div className="flex flex-col gap-4 text-xs">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-[var(--nimi-text-primary)]">{systemLabel}</label>
              <TextareaField
                textareaClassName="h-16 text-xs"
                value={system}
                onChange={(event) => onSystemChange(event.target.value)}
                placeholder={systemPlaceholder}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-[var(--nimi-text-primary)]">{temperatureLabel}</label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={TEMP_MIN}
                  max={TEMP_MAX}
                  step={0.1}
                  value={tempValue}
                  onChange={(event) => onTemperatureChange(event.target.value)}
                  style={{ background: sliderBackground }}
                  className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full outline-none
                    [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--nimi-action-primary-bg)] [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:shadow-sm
                    [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-[var(--nimi-action-primary-bg)] [&::-moz-range-thumb]:cursor-pointer"
                />
                <TextField
                  className="w-16 font-mono text-xs"
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                  value={temperature}
                  onChange={(event) => onTemperatureChange(event.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-[var(--nimi-text-primary)]">{maxTokensLabel}</label>
              <TextField
                className="font-mono text-xs"
                type="number"
                min="1"
                value={maxTokens}
                onChange={(event) => onMaxTokensChange(event.target.value)}
                placeholder={maxTokensPlaceholder}
              />
            </div>
          </div>

          <div
            aria-hidden
            className="absolute -top-1.5 left-3 h-3 w-3 rotate-45 border-l border-t border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)]"
          />
        </div>
      ) : null}
    </div>
  );
}
