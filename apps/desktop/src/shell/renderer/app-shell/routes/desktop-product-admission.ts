import { useCallback, useEffect, useState } from 'react';
import { projectNimiProductControlAdmission } from '@nimiplatform/sdk/runtime';
import type { AuthStatus } from '../providers/app-store.js';
import type { DesktopHomeProfileStatus } from '../../bridge/runtime-bridge/product-control.js';
import type { DesktopRendererEventPort } from '../../renderer/contract.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';

type Observation = Parameters<Parameters<DesktopRendererEventPort['subscribeProductControlRecord']>[0]>[0];

export function useDesktopProductAdmission(authStatus: AuthStatus) {
  const { app: { commands: { firstRun }, events } } = useDesktopRendererBindings();
  const [record, setRecord] = useState<Observation | null>(null);
  const [homeProfile, setHomeProfile] = useState<DesktopHomeProfileStatus | null>(null);
  const [profileUnavailable, setProfileUnavailable] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [admissionFailed, setAdmissionFailed] = useState(false);
  const retry = useCallback(() => {
    setAdmissionFailed(false);
    setAttempt(value => value + 1);
    setRefresh(value => value + 1);
  }, []);
  const accountActive = authStatus === 'authenticated' || authStatus === 'refresh-pending';

  // @nimi-authority: rule.nimi.platform.product-lifecycle.p-cold-017a
  useEffect(() => {
    let active = true;
    let currentRoot: string | null | undefined = null;
    let pending: Promise<DesktopHomeProfileStatus> | undefined;
    const unsubscribe = events.subscribeProductControlRecord((result) => {
      if (!active) return;
      setRecord(result);
      const readyRoot = !accountActive ? null
        : !result.ok ? undefined
        : result.projection.state === 'ready_for_use' ? result.projection.record?.dataRoot?.path ?? ''
        : null;
      if (readyRoot !== currentRoot) {
        pending = undefined;
        if (currentRoot !== null) {
          setHomeProfile(null);
          setProfileUnavailable(false);
        }
        currentRoot = readyRoot;
      }
      if (readyRoot === null) {
        setHomeProfile(null);
        setProfileUnavailable(false);
        return;
      }
      if (pending) return;
      const read = firstRun.getHomeProfileStatus();
      pending = read;
      void read.then(
        status => {
          if (!active || pending !== read) return;
          setHomeProfile(status);
          setProfileUnavailable(false);
        },
        () => {
          if (!active || pending !== read) return;
          setHomeProfile(null);
          setProfileUnavailable(true);
        },
      ).finally(() => { if (pending === read) pending = undefined; });
    });
    return () => { active = false; unsubscribe(); };
  }, [accountActive, events, firstRun, refresh]);

  const decision = record?.ok ? projectNimiProductControlAdmission(record.projection.state).kind : undefined;
  const canAdmit = decision === 'login' && authStatus === 'authenticated';
  useEffect(() => {
    if (!canAdmit) {
      setAdmissionFailed(false);
      return;
    }
    let active = true;
    // Product Control alone may advance a persisted not_logged_in verdict.
    // Observe the record again after the write rather than pinning its return.
    void firstRun.admitReadyForUse().then(
      result => {
        if (!active) return;
        if (result.state === 'not_logged_in') setAdmissionFailed(true);
        else setRefresh(value => value + 1);
      },
      () => { if (active) setAdmissionFailed(true); },
    );
    return () => { active = false; };
  }, [attempt, canAdmit, firstRun]);

  return {
    retry,
    homeProfile,
    profileUnavailable,
    projection: record?.ok ? record.projection : null,
    error: record?.ok === false ? record.error : undefined,
    admission: record?.ok === false ? 'unavailable'
      : decision === 'ordinary-shell' ? 'ready'
      : decision === 'login' ? canAdmit ? admissionFailed ? 'admission-failed' : 'requesting-admission'
        : authStatus === 'refresh-pending' ? 'checking' : 'login'
      : decision ? 'first-run' : 'checking',
  } as const;
}
