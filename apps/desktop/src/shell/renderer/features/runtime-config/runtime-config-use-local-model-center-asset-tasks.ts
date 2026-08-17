import { useCallback, useMemo, useState } from 'react';
import { type NimiRuntimeLocalVerifiedAssetDescriptor } from '@nimiplatform/sdk/runtime';
import { PROGRESS_RETENTION_MS, type LocalModelCenterProps } from './runtime-config-model-center-utils';
import {
  isAssetTaskTerminal,
  type AssetTaskEntry,
  type AssetTaskState,
} from './runtime-config-local-model-center-helpers';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';

export function useLocalModelCenterAssetTasks(input: {
  onInstallCatalogAsset: LocalModelCenterProps['onInstallCatalogAsset'];
  onInstalled: () => Promise<void>;
  verifiedAssetsByTemplateId: Map<string, NimiRuntimeLocalVerifiedAssetDescriptor>;
}) {
  const bindings = useDesktopRendererBindings();
  const [assetPendingTemplateIds, setAssetPendingTemplateIds] = useState<string[]>([]);
  const [assetTasks, setAssetTasks] = useState<AssetTaskEntry[]>([]);

  const visibleAssetTasks = useMemo(
    () => assetTasks.slice().sort((left, right) => right.updatedAtMs - left.updatedAtMs).slice(0, 4),
    [assetTasks],
  );

  const markAssetPending = useCallback((templateId: string, pending: boolean) => {
    const normalized = String(templateId || '').trim();
    if (!normalized) {
      return;
    }
    setAssetPendingTemplateIds((prev) => {
      if (pending) {
        return prev.includes(normalized) ? prev : [...prev, normalized];
      }
      return prev.filter((item) => item !== normalized);
    });
  }, []);

  const upsertAssetTask = useCallback((templateId: string, state: AssetTaskState, detail?: string) => {
    const normalizedTemplateId = String(templateId || '').trim();
    if (!normalizedTemplateId) {
      return;
    }
    const descriptor = input.verifiedAssetsByTemplateId.get(normalizedTemplateId);
    if (!descriptor) {
      return;
    }
    const nowMs = bindings.clock.now();
    setAssetTasks((prev) => {
      const next = prev.filter((task) => (
        task.templateId !== normalizedTemplateId
        && !(isAssetTaskTerminal(task.state) && nowMs - task.updatedAtMs > PROGRESS_RETENTION_MS)
      ));
      next.unshift({
        templateId: normalizedTemplateId,
        assetId: descriptor.assetId,
        title: descriptor.title,
        kind: descriptor.kind,
        taskKind: 'catalog-install',
        state,
        detail: String(detail || '').trim() || undefined,
        updatedAtMs: nowMs,
      });
      return next.slice(0, 8);
    });
  }, [input.verifiedAssetsByTemplateId]);

  const isAssetPending = useCallback((templateId: string) => (
    assetPendingTemplateIds.includes(String(templateId || '').trim())
  ), [assetPendingTemplateIds]);

  const installCatalogAsset = useCallback(async (templateId: string) => {
    const normalizedTemplateId = String(templateId || '').trim();
    if (!normalizedTemplateId) {
      return;
    }
    markAssetPending(normalizedTemplateId, true);
    upsertAssetTask(normalizedTemplateId, 'running');
    try {
      await input.onInstallCatalogAsset(normalizedTemplateId);
      await input.onInstalled();
      upsertAssetTask(normalizedTemplateId, 'running', 'Asset install queued.');
    } catch (error: unknown) {
      upsertAssetTask(
        normalizedTemplateId,
        'failed',
        error instanceof Error ? error.message : String(error || 'Asset install failed'),
      );
      throw error;
    } finally {
      markAssetPending(normalizedTemplateId, false);
    }
  }, [input, markAssetPending, upsertAssetTask]);

  return {
    assetPendingTemplateIds,
    installCatalogAsset,
    isAssetPending,
    visibleAssetTasks,
  };
}
