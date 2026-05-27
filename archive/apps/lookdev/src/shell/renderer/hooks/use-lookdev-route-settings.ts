import { useEffect, useMemo } from 'react';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { formatTargetOptionLabel, pickConfiguredRuntimeTargetKey } from '@renderer/features/lookdev/create-batch-page-helpers.js';
import { useTranslation } from 'react-i18next';

export function useLookdevRouteSettings() {
  const { t } = useTranslation();
  const runtimeDefaults = useAppStore((state) => state.runtimeDefaults);
  const runtimeProbe = useAppStore((state) => state.runtimeProbe);
  const routeSettings = useAppStore((state) => state.routeSettings);
  const setDialogueTargetKey = useAppStore((state) => state.setDialogueTargetKey);
  const setGenerationTargetKey = useAppStore((state) => state.setGenerationTargetKey);
  const setEvaluationTargetKey = useAppStore((state) => state.setEvaluationTargetKey);

  useEffect(() => {
    if (runtimeProbe.textTargets.length === 0) {
      return;
    }
    const hasCurrentDialogueTarget = runtimeProbe.textTargets.some((target) => target.key === routeSettings.dialogueTargetKey);
    if (!hasCurrentDialogueTarget) {
      setDialogueTargetKey(pickConfiguredRuntimeTargetKey({
        targets: runtimeProbe.textTargets,
        defaultTargetKey: runtimeProbe.textDefaultTargetKey,
        runtimeConnectorId: runtimeDefaults?.runtime.connectorId || runtimeProbe.textConnectorId,
        runtimeProvider: runtimeDefaults?.runtime.provider,
        localModelId: runtimeDefaults?.runtime.localProviderModel,
      }));
    }
  }, [
    routeSettings.dialogueTargetKey,
    runtimeDefaults?.runtime.connectorId,
    runtimeDefaults?.runtime.localProviderModel,
    runtimeDefaults?.runtime.provider,
    runtimeProbe.textTargets.length,
    runtimeProbe.textConnectorId,
    runtimeProbe.textDefaultTargetKey,
    runtimeProbe.textTargets,
    setDialogueTargetKey,
  ]);

  useEffect(() => {
    if (runtimeProbe.imageTargets.length === 0) {
      return;
    }
    const hasCurrentGenerationTarget = runtimeProbe.imageTargets.some((target) => target.key === routeSettings.generationTargetKey);
    if (!hasCurrentGenerationTarget) {
      setGenerationTargetKey(runtimeProbe.imageDefaultTargetKey || runtimeProbe.imageTargets[0]?.key || '');
    }
  }, [
    routeSettings.generationTargetKey,
    runtimeProbe.imageDefaultTargetKey,
    runtimeProbe.imageTargets.length,
    runtimeProbe.imageTargets,
    setGenerationTargetKey,
  ]);

  useEffect(() => {
    if (runtimeProbe.visionTargets.length === 0) {
      return;
    }
    const hasCurrentEvaluationTarget = runtimeProbe.visionTargets.some((target) => target.key === routeSettings.evaluationTargetKey);
    if (!hasCurrentEvaluationTarget) {
      setEvaluationTargetKey(runtimeProbe.visionDefaultTargetKey || runtimeProbe.visionTargets[0]?.key || '');
    }
  }, [
    routeSettings.evaluationTargetKey,
    runtimeProbe.visionDefaultTargetKey,
    runtimeProbe.visionTargets.length,
    runtimeProbe.visionTargets,
    setEvaluationTargetKey,
  ]);

  const localLabel = t('createBatch.localRuntimeLabel', { defaultValue: 'Local Runtime' });

  const dialogueTarget = useMemo(
    () => runtimeProbe.textTargets.find((target) => target.key === routeSettings.dialogueTargetKey) || null,
    [routeSettings.dialogueTargetKey, runtimeProbe.textTargets],
  );
  const generationTarget = useMemo(
    () => runtimeProbe.imageTargets.find((target) => target.key === routeSettings.generationTargetKey) || null,
    [routeSettings.generationTargetKey, runtimeProbe.imageTargets],
  );
  const evaluationTarget = useMemo(
    () => runtimeProbe.visionTargets.find((target) => target.key === routeSettings.evaluationTargetKey) || null,
    [routeSettings.evaluationTargetKey, runtimeProbe.visionTargets],
  );

  const dialogueTargetOptions = useMemo(
    () => runtimeProbe.textTargets.map((target) => ({ key: target.key, label: formatTargetOptionLabel(target, localLabel) })),
    [localLabel, runtimeProbe.textTargets],
  );
  const generationTargetOptions = useMemo(
    () => runtimeProbe.imageTargets.map((target) => ({ key: target.key, label: formatTargetOptionLabel(target, localLabel) })),
    [localLabel, runtimeProbe.imageTargets],
  );
  const evaluationTargetOptions = useMemo(
    () => runtimeProbe.visionTargets.map((target) => ({ key: target.key, label: formatTargetOptionLabel(target, localLabel) })),
    [localLabel, runtimeProbe.visionTargets],
  );

  return {
    dialogueTargetKey: routeSettings.dialogueTargetKey,
    generationTargetKey: routeSettings.generationTargetKey,
    evaluationTargetKey: routeSettings.evaluationTargetKey,
    dialogueTarget,
    generationTarget,
    evaluationTarget,
    dialogueTargetOptions,
    generationTargetOptions,
    evaluationTargetOptions,
    setDialogueTargetKey,
    setGenerationTargetKey,
    setEvaluationTargetKey,
  };
}
