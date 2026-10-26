import { useCallback, useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '@nimiplatform/kit/ui';
import { useTranslation } from 'react-i18next';
import { useHomeNavigation } from '../../app-shell/providers/app-store.js';

type SaveResult = { ok: boolean; revision: number };
// @nimi-authority: rule.nimi.desktop.shell-ui.settings-navigation
export function useSettingsSaveGuard(input: {
  dirty: boolean;
  revision: number;
  currentRevision: () => number;
  pending?: boolean;
  cancelScheduled: () => void;
  commit: (isCurrent: () => boolean) => Promise<boolean>;
}) {
  const navigation = useHomeNavigation();
  const { t } = useTranslation();
  const latest = useRef(input);
  latest.current = input;
  const flight = useRef<Promise<SaveResult> | null>(null);
  const finishPrompt = useRef<((discard: boolean) => void) | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const save = useCallback((): Promise<SaveResult> => {
    if (flight.current) return flight.current;
    const current = latest.current;
    if (!current.dirty) return Promise.resolve({ ok: true, revision: current.revision });
    const generation = navigation.getSnapshot().generation;
    const promise = current.commit(() => navigation.getSnapshot().generation === generation).then(ok => ({ ok, revision: current.revision }), () => ({ ok: false, revision: current.revision }));
    flight.current = promise;
    void promise.then(() => { if (flight.current === promise) flight.current = null; });
    return promise;
  }, [navigation]);

  useEffect(() => {
    const unregister = navigation.registerLeaveGuard(async ({ from, signal }) => {
      if (from.id !== 'settings') return 'allow';
      if (latest.current.pending) return 'busy';
      latest.current.cancelScheduled();
      while (!signal.aborted) {
        if (!latest.current.dirty && !flight.current) return 'allow';
        const result = await save();
        if (signal.aborted) return 'cancel';
        if (latest.current.pending) return 'busy';
        if (!result.ok) {
          return new Promise<'allow' | 'cancel'>(resolve => {
            const finish = (discard: boolean) => {
              signal.removeEventListener('abort', cancel);
              finishPrompt.current = null;
              setPromptOpen(false);
              resolve(discard && !signal.aborted ? 'allow' : 'cancel');
            };
            const cancel = () => finish(false);
            finishPrompt.current = finish;
            signal.addEventListener('abort', cancel, { once: true });
            setPromptOpen(true);
          });
        }
        if (result.revision === latest.current.currentRevision()) return 'allow';
        // Let edits made during the request render before saving that newer draft.
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      return 'cancel';
    });
    return () => { unregister(); finishPrompt.current?.(false); };
  }, [navigation, save]);

  return {
    save,
    dialog: <ConfirmDialog open={promptOpen} title={t('Settings.unsavedTitle')} message={t('Settings.unsavedBody')}
      confirmTone="danger" confirmLabel={t('Settings.discardAndLeave')} cancelLabel={t('Settings.stayAndRetry')}
      onConfirm={() => finishPrompt.current?.(true)} onClose={() => finishPrompt.current?.(false)} />,
  };
}
