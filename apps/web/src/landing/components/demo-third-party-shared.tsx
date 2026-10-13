import { useAppPreviewLocale } from '../i18n/app-preview-locale.js';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Check, Info } from 'lucide-react';

export function PreviewButton({
  children,
  primary,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={`tp-button${primary ? ' tp-button--primary' : ''}${props.className ? ` ${props.className}` : ''}`}
    >
      {children}
    </button>
  );
}

export function PreviewNotice({ children }: { children: ReactNode }) {
  const { t } = useAppPreviewLocale();
  return (
    <footer className="tp-notice">
      <Info size={14} aria-hidden="true" />
      <span>{children}</span>
      <a href="/demo/third-party-NOTICES.txt" target="_blank" rel="noreferrer">
        {t('shared.previewNotice.credits')}
      </a>
    </footer>
  );
}

export function PreviewSteps({
  steps,
  active,
  onSelect,
}: {
  steps: readonly string[];
  active: number;
  onSelect: (index: number) => void;
}) {
  const { t } = useAppPreviewLocale();
  return (
    <nav className="tp-steps" aria-label={t('shared.previewSteps.productionStages')}>
      {steps.map((step, index) => (
        <button
          type="button"
          key={step}
          aria-current={active === index ? 'step' : undefined}
          onClick={() => onSelect(index)}
        >
          <span>{index < active ? <Check size={13} aria-hidden="true" /> : index + 1}</span>
          {step}
        </button>
      ))}
    </nav>
  );
}

/** A schematic timeline, never a claim that an audio file has been generated. */
export function PreviewWaveform({ label }: { label: string }) {
  return (
    <div className="tp-waveform" role="img" aria-label={label}>
      {Array.from({ length: 64 }, (_, index) => (
        <i key={index} style={{ height: `${16 + ((index * 19 + index * index * 7) % 72)}%` }} />
      ))}
    </div>
  );
}
