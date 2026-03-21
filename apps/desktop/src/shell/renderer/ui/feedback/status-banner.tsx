import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/providers/app-store';

const STATUS_BANNER_MAX_MESSAGE_LENGTH = 200;

function formatStatusBannerMessage(value: string): string {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= STATUS_BANNER_MAX_MESSAGE_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, STATUS_BANNER_MAX_MESSAGE_LENGTH - 3).trimEnd()}...`;
}

export function StatusBanner() {
  const { t } = useTranslation();
  const statusBanner = useAppStore((state) => state.statusBanner);
  const clear = useAppStore((state) => state.setStatusBanner);

  useEffect(() => {
    if (!statusBanner) return;
    const timer = setTimeout(() => clear(null), 10_000);
    return () => clearTimeout(timer);
  }, [statusBanner, clear]);

  if (!statusBanner) {
    return null;
  }

  const colorClass =
    statusBanner.kind === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : statusBanner.kind === 'warning'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : statusBanner.kind === 'error'
          ? 'border-red-200 bg-red-50 text-red-700'
          : 'border-gray-200 bg-gray-100 text-gray-700';
  const message = formatStatusBannerMessage(statusBanner.message);

  return (
    <div className={`fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg border px-3 py-2 text-sm shadow-lg ${colorClass}`}>
      <div className="flex items-center justify-between gap-3">
        <span>{message}</span>
        <div className="flex items-center gap-2">
          {statusBanner.actionLabel && statusBanner.onAction ? (
            <button
              type="button"
              className="rounded border border-current/30 px-2 py-1 text-xs hover:bg-black/5"
              onClick={() => {
                statusBanner.onAction?.();
                clear(null);
              }}
            >
              {statusBanner.actionLabel}
            </button>
          ) : null}
          <button
            type="button"
            className="rounded px-2 py-1 text-xs hover:bg-black/5"
            onClick={() => {
              clear(null);
            }}
          >
            {t('Common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
