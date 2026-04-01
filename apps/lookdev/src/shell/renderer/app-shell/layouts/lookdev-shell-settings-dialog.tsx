import { useTranslation } from 'react-i18next';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  SelectField,
  StatusBadge,
  type SelectFieldOption,
} from '@nimiplatform/nimi-kit/ui';
import { useRuntimeReadiness } from '@renderer/hooks/use-runtime-readiness.js';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { useLookdevRouteSettings } from '@renderer/hooks/use-lookdev-route-settings.js';

const DIALOG_SELECT_CONTENT_CLASSNAME = 'z-[calc(var(--nimi-z-dialog)+1)] bg-[rgb(11_18_32)]';

function runtimeTone(status: ReturnType<typeof useAppStore.getState>['runtimeStatus']) {
  switch (status) {
    case 'ready':
      return 'success';
    case 'degraded':
      return 'warning';
    case 'unavailable':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function LookdevShellSettingsDialog(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const { t } = useTranslation();
  const readinessQuery = useRuntimeReadiness();
  const runtimeStatus = useAppStore((state) => state.runtimeStatus);
  const runtimeProbe = useAppStore((state) => state.runtimeProbe);
  const {
    dialogueTargetKey,
    generationTargetKey,
    evaluationTargetKey,
    dialogueTarget,
    generationTarget,
    evaluationTarget,
    dialogueTargetOptions,
    generationTargetOptions,
    evaluationTargetOptions,
    setDialogueTargetKey,
    setGenerationTargetKey,
    setEvaluationTargetKey,
  } = useLookdevRouteSettings();
  const dialogueOptions: SelectFieldOption[] = dialogueTargetOptions.map((option) => ({ value: option.key, label: option.label }));
  const generationOptions: SelectFieldOption[] = generationTargetOptions.map((option) => ({ value: option.key, label: option.label }));
  const evaluationOptions: SelectFieldOption[] = evaluationTargetOptions.map((option) => ({ value: option.key, label: option.label }));

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-[760px] border-[var(--ld-panel-border)] bg-[rgb(8_15_24/0.98)] text-white shadow-[0_28px_80px_rgba(0,0,0,0.42)]">
        <DialogHeader>
          <DialogTitle>{t('layout.shellSettingsTitle')}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-5">
          <p className="text-sm leading-6 text-white/66">
            {t('layout.shellSettingsDescription')}
          </p>

          <section className="space-y-3 rounded-3xl border border-white/8 bg-black/16 px-5 py-5">
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-[0.16em] text-[var(--ld-gold)]">{t('layout.shellSettingsRuntime')}</div>
              <div className="text-sm text-white/60">{t('layout.shellSettingsRuntimeDescription')}</div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge tone={runtimeTone(runtimeStatus)} className="px-3 py-1 text-[11px] uppercase tracking-[0.18em]">
                {t('layout.runtimeStatus', { status: t(`layout.runtimeStatus${runtimeStatus.charAt(0).toUpperCase()}${runtimeStatus.slice(1)}`) })}
              </StatusBadge>
              <div className="text-sm text-white/56">
                {t('layout.runtimeIssues', { count: runtimeProbe.issues.length })}
              </div>
            </div>
            {runtimeProbe.issues.length > 0 ? (
              <div className="rounded-2xl border border-amber-300/18 bg-amber-300/10 px-4 py-4">
                <div className="mb-2 text-xs uppercase tracking-[0.16em] text-[var(--ld-gold)]">{t('layout.shellSettingsIssuesTitle')}</div>
                <ul className="space-y-2 text-sm text-amber-50">
                  {runtimeProbe.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          <section className="rounded-3xl border border-white/8 bg-black/16 px-5 py-5">
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-[0.16em] text-[var(--ld-gold)]">{t('layout.shellSettingsDefaultRoutes')}</div>
              <div className="text-sm text-white/60">{t('layout.shellSettingsDefaultRoutesDescription')}</div>
            </div>
            <div className="mt-4 grid gap-4">
              <div className="grid gap-2">
                <label htmlFor="lookdev-route-settings-dialogue" className="text-sm text-white/74">{t('layout.shellSettingsDialogueRoute')}</label>
                <SelectField
                  id="lookdev-route-settings-dialogue"
                  value={dialogueTargetKey}
                  options={dialogueOptions}
                  onValueChange={setDialogueTargetKey}
                  aria-label={t('layout.shellSettingsDialogueRoute')}
                  placeholder={t('layout.shellSettingsDialogueRouteMissing')}
                  className="rounded-2xl border-white/10 bg-black/12 text-white"
                  contentClassName={DIALOG_SELECT_CONTENT_CLASSNAME}
                />
                <div className="text-sm text-white/52">{dialogueTarget ? t('layout.shellSettingsDialogueRouteDescription') : t('layout.shellSettingsRouteMissing')}</div>
              </div>
              <div className="grid gap-2">
                <label htmlFor="lookdev-route-settings-image" className="text-sm text-white/74">{t('layout.shellSettingsImageRoute')}</label>
                <SelectField
                  id="lookdev-route-settings-image"
                  value={generationTargetKey}
                  options={generationOptions}
                  onValueChange={setGenerationTargetKey}
                  aria-label={t('layout.shellSettingsImageRoute')}
                  placeholder={t('layout.shellSettingsImageRouteMissing')}
                  className="rounded-2xl border-white/10 bg-black/12 text-white"
                  contentClassName={DIALOG_SELECT_CONTENT_CLASSNAME}
                />
                <div className="text-sm text-white/52">{generationTarget ? t('layout.shellSettingsImageRouteDescription') : t('layout.shellSettingsRouteMissing')}</div>
              </div>
              <div className="grid gap-2">
                <label htmlFor="lookdev-route-settings-evaluation" className="text-sm text-white/74">{t('layout.shellSettingsEvaluationRoute')}</label>
                <SelectField
                  id="lookdev-route-settings-evaluation"
                  value={evaluationTargetKey}
                  options={evaluationOptions}
                  onValueChange={setEvaluationTargetKey}
                  aria-label={t('layout.shellSettingsEvaluationRoute')}
                  placeholder={t('layout.shellSettingsEvaluationRouteMissing')}
                  className="rounded-2xl border-white/10 bg-black/12 text-white"
                  contentClassName={DIALOG_SELECT_CONTENT_CLASSNAME}
                />
                <div className="text-sm text-white/52">{evaluationTarget ? t('layout.shellSettingsEvaluationRouteDescription') : t('layout.shellSettingsRouteMissing')}</div>
              </div>
            </div>
          </section>
        </DialogBody>
        <DialogFooter className="justify-between">
          <Button
            tone="secondary"
            className="rounded-2xl border-white/10 bg-black/12 text-white hover:bg-white/6"
            onClick={() => {
              void readinessQuery.refetch();
            }}
          >
            {t('layout.shellSettingsRefresh')}
          </Button>
          <Button tone="primary" className="rounded-2xl text-sm" onClick={() => props.onOpenChange(false)}>
            {t('layout.shellSettingsClose')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
