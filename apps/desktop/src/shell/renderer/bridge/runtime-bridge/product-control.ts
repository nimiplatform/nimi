import {
  hasElectronInvoke,
  openShellFileDialog,
  type ShellFileDialogOpenResult,
} from '@nimiplatform/kit/shell/renderer/bridge';
import { invokeChecked } from './invoke';
import {
  parseNimiProductControlRecordProjection,
  parseNimiProductControlSelectedDataRootProjection,
  projectUnavailableNimiProductControlRecord,
  projectUnavailableNimiProductControlSelectedDataRoot,
  type NimiProductControlRecordProjection,
  type NimiProductControlSelectedDataRootProjection,
} from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { getRuntimeBridgeStatus, restartRuntimeBridge } from './runtime-daemon';

export type {
  NimiProductControlRecord,
  NimiProductControlRecordProjection,
  NimiProductControlSelectedDataRootProjection,
  NimiProductControlState,
} from '@nimiplatform/sdk/runtime';

function firstDialogPath(result: ShellFileDialogOpenResult): string | null {
  if (result.canceled) return null;
  const path = typeof result.paths[0] === 'string' ? result.paths[0].trim() : '';
  return path || null;
}

export async function getProductControlRecord(): Promise<NimiProductControlRecordProjection> {
  if (hasElectronInvoke()) {
    return invokeChecked('product_control_record_get', {}, parseNimiProductControlRecordProjection);
  }
  return projectUnavailableNimiProductControlRecord('product_control_record_get requires standard shell Runtime');
}

export async function getProductControlSelectedDataRoot(): Promise<NimiProductControlSelectedDataRootProjection> {
  if (hasElectronInvoke()) {
    return invokeChecked(
      'product_control_selected_data_root_get',
      {},
      parseNimiProductControlSelectedDataRootProjection,
    );
  }
  return projectUnavailableNimiProductControlSelectedDataRoot(
    'product_control_selected_data_root_get requires standard shell Runtime',
  );
}

export async function ensureProductControlRecordCreated(): Promise<NimiProductControlRecordProjection> {
  if (hasElectronInvoke()) {
    return invokeChecked('product_control_record_ensure_created', {}, parseNimiProductControlRecordProjection);
  }
  throw new Error('product_control_record_ensure_created requires standard shell Runtime');
}

export async function selectProductDataRoot(dataRoot: string): Promise<NimiProductControlRecordProjection> {
  if (hasElectronInvoke()) {
    const selected = await invokeChecked('product_control_record_select_data_root', {
      payload: { dataRoot },
    }, parseNimiProductControlRecordProjection);
    if (selected.configMutation?.reasonCode === ReasonCode.CONFIG_RESTART_REQUIRED) {
      const status = await getRuntimeBridgeStatus();
      if (status.launchMode === 'SOURCE') {
        return selected;
      }
      await restartRuntimeBridge();
      return getProductControlRecord();
    }
    return selected;
  }
  throw new Error('product_control_record_select_data_root requires standard shell Runtime');
}

/**
 * Opens the OS native directory picker for the first-run Storage phase.
 *
 * Returns the picked absolute directory path, or `null` when the user
 * cancelled the dialog. The path is only a candidate; the caller must pass it
 * to {@link selectProductDataRoot}, which is the sole owner of recording and
 * fail-closed validation of the selected `nimi_data` root (P-COLD-010).
 */
export async function pickProductDataRootDirectory(): Promise<string | null> {
  if (!hasElectronInvoke()) {
    throw new Error('Product data-root picker requires standard shell file dialog');
  }
  return firstDialogPath(await openShellFileDialog({
    kind: 'directory',
    title: 'Choose where Nimi stores models and data',
  }));
}

/**
 * Requests Runtime product-control admission of `ready_for_use`.
 *
 * Desktop does not write admission; Runtime evaluates its current readiness
 * gates and commits or routes the Product Control state.
 */
export async function admitProductReadyForUse(): Promise<NimiProductControlRecordProjection> {
  if (!hasElectronInvoke()) {
    throw new Error('product_control_record_admit_ready_for_use requires standard shell Runtime');
  }
  return invokeChecked('product_control_record_admit_ready_for_use', {}, parseNimiProductControlRecordProjection);
}
