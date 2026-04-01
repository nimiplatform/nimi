/**
 * settings-page.tsx — ShiJi settings (SJ-SHELL-005, SJ-SHELL-006, SJ-SHELL-007)
 */
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import { ParentModePanel } from './parent-mode-panel.js';

// ── AI Model catalogue ──────────────────────────────────────────────────────

const AI_MODELS = [
  {
    id: 'gemini-2.0-flash',
    labelKey: 'settings.models.gemini20flash' as const,
    descKey: 'settings.models.gemini20flashDesc' as const,
  },
  {
    id: 'gemini-1.5-pro',
    labelKey: 'settings.models.gemini15pro' as const,
    descKey: 'settings.models.gemini15proDesc' as const,
  },
  {
    id: 'deepseek-chat',
    labelKey: 'settings.models.deepseekChat' as const,
    descKey: 'settings.models.deepseekChatDesc' as const,
  },
] as const;

// ── Timer options ───────────────────────────────────────────────────────────

const TIMER_OPTIONS = [null, 15, 30, 45, 60] as const;
type TimerOption = (typeof TIMER_OPTIONS)[number];

// ── Sub-components ──────────────────────────────────────────────────────────

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">{title}</h2>
      {description && <p className="text-xs text-neutral-400 mt-0.5">{description}</p>}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { t } = useTranslation();
  const aiModel = useAppStore((s) => s.aiModel);
  const setAiModel = useAppStore((s) => s.setAiModel);
  const sessionTimerMinutes = useAppStore((s) => s.sessionTimerMinutes);
  const setSessionTimerMinutes = useAppStore((s) => s.setSessionTimerMinutes);

  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="px-8 py-6 max-w-xl">
        <h1 className="text-2xl font-bold text-neutral-800 mb-8">{t('settings.title')}</h1>

        {/* ── AI Model — SJ-SHELL-005:1 ────────────────────────────────────── */}
        <section className="mb-8">
          <SectionHeader title={t('settings.aiSection')} />
          <div className="space-y-2">
            {AI_MODELS.map((model) => (
              <button
                key={model.id}
                onClick={() => setAiModel(model.id)}
                className={[
                  'w-full flex items-center justify-between rounded-xl px-4 py-3 border text-left transition-colors',
                  aiModel === model.id
                    ? 'border-amber-300 bg-amber-50'
                    : 'border-neutral-200 bg-white hover:border-amber-200',
                ].join(' ')}
              >
                <div>
                  <span className="text-sm font-medium text-neutral-800">{t(model.labelKey)}</span>
                  <p className="text-xs text-neutral-400 mt-0.5">{t(model.descKey)}</p>
                </div>
                {aiModel === model.id && (
                  <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0 ml-3" />
                )}
              </button>
            ))}
          </div>
        </section>

        {/* ── Session Timer — SJ-SHELL-005:4 ──────────────────────────────── */}
        <section className="mb-8">
          <SectionHeader
            title={t('settings.timerSection')}
            description={t('settings.timerDescription')}
          />
          <div className="flex flex-wrap gap-2">
            {TIMER_OPTIONS.map((minutes) => {
              const isActive = sessionTimerMinutes === minutes;
              const label =
                minutes === null
                  ? t('settings.timerOptions.off')
                  : `${minutes} ${t('settings.timerUnit')}`;
              return (
                <button
                  key={String(minutes)}
                  onClick={() => setSessionTimerMinutes(minutes as TimerOption)}
                  className={[
                    'rounded-full px-4 py-1.5 text-sm font-medium border transition-colors',
                    isActive
                      ? 'bg-amber-600 text-white border-amber-600'
                      : 'bg-white text-neutral-600 border-neutral-200 hover:border-amber-300',
                  ].join(' ')}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </section>

        {/* ── Voice — Phase 3 placeholder ──────────────────────────────────── */}
        <section className="mb-8">
          <SectionHeader title={t('settings.voiceSection')} />
          <div className="flex items-center gap-2 text-sm text-neutral-400">
            <span>{t('settings.voicePhase')}</span>
            <span className="bg-neutral-100 text-neutral-400 text-xs rounded-full px-2 py-0.5 font-medium">
              Phase 3
            </span>
          </div>
        </section>

        {/* ── Parent Mode — SJ-SHELL-005:5, SJ-SHELL-006 ──────────────────── */}
        <section className="mb-8">
          <SectionHeader
            title={t('settings.parentModeSection')}
            description={t('settings.parentMode.description')}
          />
          <ParentModePanel />
        </section>
      </div>
    </div>
  );
}
