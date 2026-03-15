import { useEffect, useRef } from 'react';
import type { WorldStudioCreateStep } from '@world-engine/contracts.js';
import { getWorldDraft } from '@renderer/data/world-data-client.js';

type UseWorldCreatePageDraftPersistenceInput = {
  hydrateForUser: (userId: string) => void;
  patchSnapshot: (patch: { sourceRef?: string; sourceText?: string }) => void;
  persistForUser: (userId: string) => void;
  resumeDraftId: string;
  setCreateStep: (step: WorldStudioCreateStep) => void;
  setNotice: (message: string | null) => void;
  snapshot: unknown;
  userId: string;
};

export function useWorldCreatePageDraftPersistence(input: UseWorldCreatePageDraftPersistenceInput) {
  useEffect(() => {
    if (input.userId) {
      input.hydrateForUser(input.userId);
    }
  }, [input.hydrateForUser, input.userId]);

  const draftLoadedRef = useRef(false);
  useEffect(() => {
    if (!input.resumeDraftId || draftLoadedRef.current) {
      return;
    }
    draftLoadedRef.current = true;

    async function loadDraft() {
      try {
        const data = await getWorldDraft(input.resumeDraftId);
        if (data && typeof data === 'object') {
          const record = data as Record<string, unknown>;
          if (record.sourceText) {
            input.patchSnapshot({ sourceText: String(record.sourceText || '') });
          }
          if (record.sourceRef) {
            input.patchSnapshot({ sourceRef: String(record.sourceRef || '') });
          }
          const status = String(record.status || 'DRAFT');
          if (status === 'SYNTHESIZE') {
            input.setCreateStep('SYNTHESIZE');
          } else if (status === 'REVIEW') {
            input.setCreateStep('CHECKPOINTS');
          } else if (status === 'PUBLISH') {
            input.setCreateStep('PUBLISH');
          }
        }
      } catch {
        input.setNotice('Failed to load draft. Starting fresh.');
      }
    }

    void loadDraft();
  }, [input.patchSnapshot, input.resumeDraftId, input.setCreateStep, input.setNotice]);

  useEffect(() => {
    if (input.userId) {
      input.persistForUser(input.userId);
    }
  }, [input.persistForUser, input.snapshot, input.userId]);
}
