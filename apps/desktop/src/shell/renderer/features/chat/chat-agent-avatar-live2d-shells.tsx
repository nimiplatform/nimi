import { useTranslation } from 'react-i18next';

export function Live2dLoadingShell({ label }: { label: string }) {
  const { t } = useTranslation();
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.98),rgba(224,242,254,0.94)_50%,rgba(191,219,254,0.82))]">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="h-11 w-11 animate-spin rounded-full border-2 border-cyan-200 border-t-cyan-500" />
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-700/80">
            {t('Chat.avatarLive2dLabel', { defaultValue: 'Live2D' })}
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-800">{label}</p>
        </div>
      </div>
    </div>
  );
}

export function Live2dErrorShell(props: {
  label: string;
  errorMessage: string;
  posterUrl?: string | null;
}) {
  const { t } = useTranslation();
  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_28%_18%,rgba(255,255,255,0.98),rgba(226,232,240,0.94)_54%,rgba(203,213,225,0.84))]">
      {props.posterUrl ? (
        <img
          src={props.posterUrl}
          alt={props.label}
          className="absolute inset-0 h-full w-full object-cover opacity-20"
        />
      ) : null}
      <div className="relative mx-6 max-w-[18rem] rounded-[24px] nimi-material-glass-thin border-[var(--nimi-material-glass-thin-border)] bg-[var(--nimi-material-glass-thin-bg)] px-5 py-4 text-center shadow-[0_18px_40px_rgba(15,23,42,0.12)] backdrop-blur-[var(--nimi-backdrop-blur-thin)]">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
          {t('Chat.avatarLive2dFallbackLabel', { defaultValue: 'Live2D Fallback' })}
        </p>
        <p className="mt-2 text-sm font-semibold text-slate-900">{props.label}</p>
        <p className="mt-2 text-xs leading-5 text-slate-600">{props.errorMessage}</p>
      </div>
    </div>
  );
}
