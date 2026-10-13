import { useAppPreviewLocale } from '../i18n/app-preview-locale.js';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Check, Info } from 'lucide-react';

export function PreviewButton({
  children,
  primary,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  const { pText } = useAppPreviewLocale();
  return (
    <button
      type="button"
      {...props}
      className={`tp-button${primary ? ' tp-button--primary' : ''}${props.className ? ` ${props.className}` : ''}`}
    >
      {pText(children)}
    </button>
  );
}

export function PreviewNotice({ children }: { children: ReactNode }) {
  const { pText } = useAppPreviewLocale();
  return (
    <footer className="tp-notice">
      <Info size={14} aria-hidden="true" />
      <span>{pText(children)}</span>
      <a href="/demo/third-party-NOTICES.txt" target="_blank" rel="noreferrer">
        {pText('Credits')}
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
  const { pText } = useAppPreviewLocale();
  return (
    <nav className="tp-steps" aria-label={pText('制作阶段')}>
      {steps.map((step, index) => (
        <button
          type="button"
          key={step}
          aria-current={active === index ? 'step' : undefined}
          onClick={() => onSelect(index)}
        >
          <span>{index < active ? <Check size={13} aria-hidden="true" /> : index + 1}</span>
          {pText(step)}
        </button>
      ))}
    </nav>
  );
}

/** A schematic timeline, never a claim that an audio file has been generated. */
export function PreviewWaveform({ label }: { label: string }) {
  const { pText } = useAppPreviewLocale();
  return (
    <div className="tp-waveform" role="img" aria-label={pText(label)}>
      {Array.from({ length: 64 }, (_, index) => (
        <i key={index} style={{ height: `${16 + ((index * 19 + index * index * 7) % 72)}%` }} />
      ))}
    </div>
  );
}
