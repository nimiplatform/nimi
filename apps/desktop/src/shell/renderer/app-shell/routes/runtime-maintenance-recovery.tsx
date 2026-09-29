import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDesktopRendererBindings } from '../../renderer/binding-context';
import { SharedStatusShell } from './status-shell';
import {
  RuntimeMaintenanceRecoveryContent,
  runtimeMaintenancePhaseForReplacement,
  type RuntimeMaintenanceRecoveryPhase,
} from './runtime-maintenance-recovery-view';

// @nimi-authority: rule.nimi.desktop.shell-runtime.r025
export function RuntimeMaintenanceRecoveryScreen({ reasonCode }: { readonly reasonCode: string }) {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const firstRun = bindings.app.commands.firstRun;
  const [currentRoot, setCurrentRoot] = useState<string | null>(null);
  const [sourceRuntime, setSourceRuntime] = useState(false);
  const [phase, setPhase] = useState<RuntimeMaintenanceRecoveryPhase>('idle');
  const [pendingTarget, setPendingTarget] = useState<string | null>(null);
  const [technicalDetail, setTechnicalDetail] = useState<string | null>(null);
  const [auditUnrecorded, setAuditUnrecorded] = useState(false);

  useEffect(() => {
    let active = true;
    void firstRun.getSelectedDataRoot()
      .then((projection) => { if (active) setCurrentRoot(projection.dataRoot?.path ?? null); })
      .catch(() => undefined);
    void bindings.app.commands.runtimeDaemon.status()
      .then((status) => { if (active) setSourceRuntime(status.launchMode === 'SOURCE'); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [bindings, firstRun]);

  const chooseFolder = useCallback(async () => {
    try {
      const target = await firstRun.pickNewEmptyDataRootDirectory(t('Bootstrap.maintenancePickerTitle'));
      if (target) setPendingTarget(target);
    } catch (error) {
      setPhase('failed');
      setTechnicalDetail(error instanceof Error ? error.message : String(error || ''));
    }
  }, [firstRun, t]);

  const confirm = useCallback(async () => {
    const target = pendingTarget;
    setPendingTarget(null);
    if (!target) return;
    setPhase('replacing');
    setTechnicalDetail(null);
    try {
      const projection = await firstRun.replaceDataRootInMaintenance(target);
      setAuditUnrecorded(Boolean(projection.auditDiagnostic));
      setPhase(runtimeMaintenancePhaseForReplacement(projection));
      setTechnicalDetail(projection.error ?? null);
    } catch (error) {
      setPhase('failed');
      setTechnicalDetail(error instanceof Error ? error.message : String(error || ''));
    }
  }, [firstRun, pendingTarget]);

  const reopen = useCallback(async () => {
    try {
      await firstRun.relaunchFromMaintenance();
    } catch (error) {
      setTechnicalDetail(error instanceof Error ? error.message : String(error || ''));
    }
  }, [firstRun]);

  return (
    <SharedStatusShell
      eyebrow="Nimi"
      title={t('Bootstrap.maintenanceTitle')}
      description={t('Bootstrap.maintenanceDescription')}
      wide
    >
      <RuntimeMaintenanceRecoveryContent
        reasonCode={reasonCode}
        currentRoot={currentRoot}
        phase={phase}
        pendingTarget={pendingTarget}
        technicalDetail={technicalDetail}
        auditUnrecorded={auditUnrecorded}
        sourceRuntime={sourceRuntime}
        onChooseFolder={() => { void chooseFolder(); }}
        onConfirm={() => { void confirm(); }}
        onCancel={() => setPendingTarget(null)}
        onReopen={() => { void reopen(); }}
      />
    </SharedStatusShell>
  );
}
