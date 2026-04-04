import { useTranslation } from 'react-i18next';
import { RuntimeModelPickerPanel } from '@nimiplatform/nimi-kit/features/model-picker/ui';
import { useRuntimeModelPickerPanel } from '@nimiplatform/nimi-kit/features/model-picker/runtime';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import { ParentModePanel } from './parent-mode-panel.js';

const TIMER_OPTIONS = [null, 15, 30, 45, 60] as const;
type TimerOption = (typeof TIMER_OPTIONS)[number];

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">{title}</h2>
      {description ? <p className="mt-0.5 text-xs text-neutral-400">{description}</p> : null}
    </div>
  );
}

function ModelSettingsSection() {
  const { t } = useTranslation();
  const runtimeDefaults = useAppStore((state) => state.runtimeDefaults);
  const aiModel = useAppStore((state) => state.aiModel);
  const setAiModel = useAppStore((state) => state.setAiModel);

  const provider = runtimeDefaults?.runtime.provider.trim() ?? '';
  const pickerState = useRuntimeModelPickerPanel({
    provider,
    selectedId: aiModel || undefined,
    initialSelectedId: aiModel || runtimeDefaults?.runtime.localProviderModel || undefined,
    onSelectModel: (modelId) => {
      setAiModel(modelId);
    },
  });

  return (
    <section className="mb-8">
      <SectionHeader
        title={t('settings.aiSection')}
        description={provider ? undefined : '当前运行时未提供可用的 provider catalog，模型选择已硬切关闭。'}
      />
      {provider ? (
        <RuntimeModelPickerPanel
          state={pickerState}
          className="space-y-4"
          pickerClassName="rounded-2xl border border-neutral-200 p-3"
          detailClassName="rounded-2xl border border-neutral-200 p-3"
          emptyDetailMessage="选择一个模型以查看详情。"
        />
      ) : (
        <div className="rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-500">
          {aiModel
            ? `当前已选模型：${aiModel}。运行时未提供 provider catalog，无法在此页切换。`
            : '当前无可用的模型目录。'}
        </div>
      )}
    </section>
  );
}

export default function SettingsPage() {
  const { t } = useTranslation();
  const sessionTimerMinutes = useAppStore((state) => state.sessionTimerMinutes);
  const setSessionTimerMinutes = useAppStore((state) => state.setSessionTimerMinutes);

  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="max-w-5xl px-8 py-6">
        <h1 className="mb-8 text-2xl font-bold text-neutral-800">{t('settings.title')}</h1>

        <ModelSettingsSection />

        <section className="mb-8">
          <SectionHeader title={t('settings.timerSection')} description={t('settings.timerDescription')} />
          <div className="flex flex-wrap gap-2">
            {TIMER_OPTIONS.map((minutes) => {
              const isActive = sessionTimerMinutes === minutes;
              const label = minutes === null
                ? t('settings.timerOptions.off')
                : `${minutes} ${t('settings.timerUnit')}`;

              return (
                <button
                  key={String(minutes)}
                  onClick={() => setSessionTimerMinutes(minutes as TimerOption)}
                  className={[
                    'rounded-full border px-4 py-1.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'border-amber-600 bg-amber-600 text-white'
                      : 'border-neutral-200 bg-white text-neutral-600 hover:border-amber-300',
                  ].join(' ')}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </section>

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
