import { useMemo } from 'react';
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
} from '@nimiplatform/nimi-kit/ui';
import { useRuntimeReadiness } from '@renderer/hooks/use-runtime-readiness.js';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';

export function RouteSettingsDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const query = useRuntimeReadiness();
  const runtimeProbe = useAppStore((state) => state.runtimeProbe);
  const preferences = useAppStore((state) => state.preferences);
  const setTextTargetKey = useAppStore((state) => state.setTextTargetKey);
  const setVisionTargetKey = useAppStore((state) => state.setVisionTargetKey);

  const formatRouteLabel = (target: typeof runtimeProbe.textTargets[number]) => {
    if (target.source === 'local') {
      return `${t('settings.routeLocal')} / ${target.modelLabel}`;
    }
    const connectorLabel = String(target.connectorLabel || target.provider || target.connectorId).trim();
    return `${t('settings.routeCloud')} / ${connectorLabel} / ${target.modelLabel}`;
  };

  const textOptions = useMemo(
    () => runtimeProbe.textTargets.map((target) => ({
      value: target.key,
      label: formatRouteLabel(target),
    })),
    [formatRouteLabel, runtimeProbe.textTargets],
  );

  const visionOptions = useMemo(
    () => runtimeProbe.visionTargets.map((target) => ({
      value: target.key,
      label: formatRouteLabel(target),
    })),
    [formatRouteLabel, runtimeProbe.visionTargets],
  );

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-[680px]">
        <DialogHeader>
          <DialogTitle>{t('settings.title')}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-5">
          <p className="text-sm leading-6 text-[var(--nimi-text-secondary)]">
            {t('settings.description')}
          </p>

          {runtimeProbe.issues.length > 0 ? (
            <div className="moment-settings-issues">
              <div className="moment-settings-issues-title">{t('settings.issuesTitle')}</div>
              <ul className="moment-settings-issues-list">
                {runtimeProbe.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="text-sm font-medium text-[var(--nimi-text-primary)]">{t('settings.textRoute')}</div>
            <SelectField
              value={preferences.textTargetKey || runtimeProbe.textDefaultTargetKey || ''}
              options={textOptions}
              placeholder={t('settings.noTextTarget')}
              selectClassName="moment-route-select-trigger"
              contentClassName="moment-route-select-content max-h-[280px]"
              onValueChange={(value) => setTextTargetKey(value)}
            />
            {textOptions.length === 0 ? (
              <div className="text-xs text-[var(--nimi-status-danger)]">{t('settings.noTextTarget')}</div>
            ) : null}
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium text-[var(--nimi-text-primary)]">{t('settings.visionRoute')}</div>
            <SelectField
              value={preferences.visionTargetKey || runtimeProbe.visionDefaultTargetKey || ''}
              options={visionOptions}
              placeholder={t('settings.noVisionTarget')}
              selectClassName="moment-route-select-trigger"
              contentClassName="moment-route-select-content max-h-[280px]"
              onValueChange={(value) => setVisionTargetKey(value)}
            />
            {visionOptions.length === 0 ? (
              <div className="text-xs text-[var(--nimi-status-danger)]">{t('settings.noVisionTarget')}</div>
            ) : null}
          </div>
        </DialogBody>
        <DialogFooter className="justify-between">
          <Button
            tone="secondary"
            onClick={() => {
              void query.refetch();
            }}
          >
            {t('settings.refresh')}
          </Button>
          <Button tone="primary" onClick={() => props.onOpenChange(false)}>
            {t('settings.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
