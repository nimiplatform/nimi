import { useEffect, useRef, useState } from 'react';
import { S } from '../../app-shell/page-style.js';

export interface ObservationFocusData {
  dimensionId: string;
  displayName: string;
  parentQuestion: string;
  observableSignals: string[];
  guidedQuestions: string[];
  experiment: string | null;
}

export interface ObservationFocusOption {
  dimensionId: string;
  displayName: string;
  parentQuestion: string;
}

export function ObservationFocusPanel({
  focus,
  options,
  onSwitchDimension,
  onClose,
}: {
  focus: ObservationFocusData;
  options: ObservationFocusOption[];
  onSwitchDimension: (dimensionId: string) => void;
  onClose?: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const switchRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const handle = (event: MouseEvent) => {
      if (!switchRef.current?.contains(event.target as Node)) {
        setPickerOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPickerOpen(false);
    };
    document.addEventListener('mousedown', handle);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('keydown', escape);
    };
  }, [pickerOpen]);

  const otherOptions = options.filter((option) => option.dimensionId !== focus.dimensionId);
  const canSwitch = otherOptions.length > 0;

  return (
    <div className="mx-5 mt-5 mb-2 rounded-[14px] p-4" style={{ background: '#f6f8f5' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-medium" style={{ color: S.accent }}>观察专题</p>
          <p className="mt-0.5 text-[15px] font-semibold" style={{ color: S.text }}>{focus.displayName}</p>
          <p className="mt-1 text-[13px] leading-relaxed" style={{ color: S.sub }}>{focus.parentQuestion}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <div ref={switchRef} className="relative">
            <button
              type="button"
              onClick={() => canSwitch && setPickerOpen((value) => !value)}
              disabled={!canSwitch}
              className="rounded-full px-2.5 py-1 text-[12px] transition-colors hover:bg-black/[0.04] disabled:cursor-not-allowed disabled:opacity-50"
              style={{ color: S.sub }}
              aria-haspopup="menu"
              aria-expanded={pickerOpen}
            >
              换一个 ▾
            </button>

            {pickerOpen ? (
              <div
                role="menu"
                className="absolute right-0 top-[calc(100%+4px)] z-30 w-[260px] overflow-hidden rounded-[12px] py-1.5"
                style={{
                  background: '#fff',
                  border: `1px solid ${S.border}`,
                  boxShadow: '0 10px 30px rgba(15,23,42,0.10)',
                }}
              >
                <p className="px-3 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wider" style={{ color: S.sub }}>
                  切换观察专题
                </p>
                <div className="max-h-[260px] overflow-y-auto">
                  {otherOptions.map((option) => (
                    <button
                      key={option.dimensionId}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setPickerOpen(false);
                        onSwitchDimension(option.dimensionId);
                      }}
                      className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors hover:bg-[#f4f7ea]"
                    >
                      <span className="text-[13px] font-medium" style={{ color: S.text }}>{option.displayName}</span>
                      <span className="line-clamp-1 text-[12px]" style={{ color: S.sub }}>{option.parentQuestion}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-black/[0.04]"
              style={{ color: S.sub }}
              aria-label="退出观察专题"
              title="退出观察专题"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18" /><path d="m6 6 12 12" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>

      {focus.observableSignals.length > 0 ? (
        <div className="mt-3">
          <p className="mb-1.5 text-[12px] font-medium" style={{ color: S.accent }}>可以观察的信号</p>
          <div className="flex flex-wrap gap-1.5">
            {focus.observableSignals.map((signal, i) => (
              <span
                key={i}
                className="rounded-full px-2.5 py-1 text-[12px]"
                style={{ background: '#fff', color: S.text }}
              >
                {signal}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {focus.guidedQuestions.length > 0 ? (
        <div className="mt-3">
          <p className="mb-1.5 text-[12px] font-medium" style={{ color: S.accent }}>引导问题</p>
          <div className="space-y-1">
            {focus.guidedQuestions.map((q, i) => (
              <p key={i} className="text-[13px] leading-relaxed" style={{ color: S.text }}>
                {i + 1}. {q}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      {focus.experiment ? (
        <div
          className={`mt-3 ${S.radiusSm} px-3 py-2.5`}
          style={{ background: '#faf9f6' }}
        >
          <p className="mb-1 text-[12px] font-medium" style={{ color: '#c9891a' }}>试试这个小实验</p>
          <p className="text-[13px] leading-relaxed" style={{ color: S.text }}>{focus.experiment}</p>
        </div>
      ) : null}
    </div>
  );
}
