import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import {
  isNimiProductControlPhaseTransient,
  projectNimiProductControlFirstRunScreen,
  type NimiProductControlRecordProjection,
  type NimiProductControlState,
} from '@nimiplatform/sdk/runtime';

import { FirstRunWizardChrome } from './first-run-wizard-chrome.js';
import { ProductControlWorkflowScreen } from './product-control-workflow-screen.js';
import type { DesktopRendererFirstRunPort } from '../renderer/first-run-port.js';

type ProductControlWorkflowProps = {
  readonly firstRun: DesktopRendererFirstRunPort;
  readonly projection: NimiProductControlRecordProjection | null;
  readonly onProjectionChange: (projection: NimiProductControlRecordProjection) => void;
};

export function ProductControlWorkflow(props: ProductControlWorkflowProps): ReactElement {
  const { t } = useTranslation();
  const firstRun = props.firstRun;
  const notifyProjectionChange = props.onProjectionChange;
  const state: NimiProductControlState = props.projection?.state ?? 'config_missing';
  const screen = projectNimiProductControlFirstRunScreen(state);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pickedPath, setPickedPath] = useState<string | null>(
    props.projection?.record?.dataRoot?.path ?? null,
  );
  const busy = pendingAction !== null;
  const error = actionError ?? props.projection?.error ?? null;

  useEffect(() => {
    const recordedPath = props.projection?.record?.dataRoot?.path;
    if (recordedPath) setPickedPath(recordedPath);
  }, [props.projection?.record?.dataRoot?.path]);

  useEffect(() => {
    if (state !== 'config_missing' || !firstRun.available()) return;
    let disposed = false;
    setPendingAction('create-product-control-record');
    setActionError(null);
    void firstRun.ensureRecordCreated()
      .then((next) => {
        if (!disposed) notifyProjectionChange(next);
      })
      .catch((nextError) => {
        if (!disposed) {
          setActionError(nextError instanceof Error
            ? nextError.message
            : t('FirstRun.errors.productControlCreateFailed', {
                defaultValue: 'Failed to create the local Nimi product record.',
              }));
        }
      })
      .finally(() => {
        if (!disposed) setPendingAction(null);
      });
    return () => {
      disposed = true;
    };
  }, [firstRun, notifyProjectionChange, state, t]);

  const chooseDataRootFolder = useCallback(async (): Promise<void> => {
    setPendingAction('pick-data-root');
    setActionError(null);
    try {
      const picked = await firstRun.pickDataRootDirectory();
      if (picked) setPickedPath(picked);
    } catch (nextError) {
      setActionError(nextError instanceof Error
        ? nextError.message
        : t('FirstRun.errors.dataRootPickFailed', {
            defaultValue: 'Failed to open the folder picker.',
          }));
    } finally {
      setPendingAction(null);
    }
  }, [firstRun, t]);

  const confirmDataRoot = useCallback(async (): Promise<void> => {
    const candidate = (pickedPath ?? '').trim();
    if (!candidate) {
      setActionError(t('FirstRun.errors.dataRootMissing', {
        defaultValue: 'Choose a folder for Nimi before continuing.',
      }));
      return;
    }
    setPendingAction('select-data-root');
    setActionError(null);
    try {
      notifyProjectionChange(await firstRun.selectDataRoot(candidate));
    } catch (nextError) {
      setActionError(nextError instanceof Error
        ? nextError.message
        : t('FirstRun.errors.dataRootRecordFailed', {
            defaultValue: 'Failed to record nimi_data.',
          }));
    } finally {
      setPendingAction(null);
    }
  }, [firstRun, notifyProjectionChange, pickedPath, t]);

  const changeDataRootFolder = useCallback(async (): Promise<void> => {
    setPendingAction('change-data-root');
    setActionError(null);
    try {
      const picked = await firstRun.pickDataRootDirectory();
      if (!picked) return;
      setPickedPath(picked);
      notifyProjectionChange(await firstRun.selectDataRoot(picked));
    } catch (nextError) {
      setActionError(nextError instanceof Error
        ? nextError.message
        : t('FirstRun.errors.dataRootRecordFailed', {
            defaultValue: 'Failed to record nimi_data.',
          }));
    } finally {
      setPendingAction(null);
    }
  }, [firstRun, notifyProjectionChange, t]);

  const requestAdmission = useCallback(async (): Promise<void> => {
    setPendingAction('admit-ready-for-use');
    setActionError(null);
    try {
      notifyProjectionChange(await firstRun.admitReadyForUse());
    } catch (nextError) {
      setActionError(nextError instanceof Error
        ? nextError.message
        : t('FirstRun.errors.finalizationRequestFailed', {
            defaultValue: 'Failed to validate Product Control setup.',
          }));
    } finally {
      setPendingAction(null);
    }
  }, [firstRun, notifyProjectionChange, t]);

  return (
    <section
      data-testid="product-first-run-workflow"
      data-product-state={state}
      data-pending-action={pendingAction ?? ''}
      aria-busy={busy || undefined}
      className="flex min-h-full flex-1 flex-col"
    >
      <FirstRunWizardChrome activePhase={screen.kind === 'phase' ? screen.phase : null}>
        {screen.kind === 'phase' && error ? (
          <p
            data-testid="product-first-run-error"
            className="mb-5 rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-danger)_24%,white)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_10%,white)] px-3 py-2 text-sm text-[var(--nimi-status-danger)]"
          >
            {error}
          </p>
        ) : null}
        <ProductControlWorkflowScreen
          busy={busy}
          error={error}
          onChangeDataRootFolder={() => void changeDataRootFolder()}
          onChooseDataRootFolder={() => void chooseDataRootFolder()}
          onConfirmDataRoot={() => void confirmDataRoot()}
          onRequestAdmission={() => void requestAdmission()}
          pickedPath={pickedPath}
          projection={props.projection}
          screen={screen}
          state={state}
          storageTransient={isNimiProductControlPhaseTransient(state)}
        />
      </FirstRunWizardChrome>
    </section>
  );
}
