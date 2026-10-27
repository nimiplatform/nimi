import { createContext, useContext, type RefObject } from 'react';
import type { ItemDraft } from '../domain/items.js';
import type { FollowUpDraft } from './followup-draft.js';
import type { LifeItem } from '../domain/types.js';

export type NewItemOptions = { readonly draftKey?: string; readonly onCreated?: (item: LifeItem) => void };

export type NoteTarget = { readonly noteId?: string; readonly circleId: string | null };

export type UiApi = {
  readonly followUpDraft: RefObject<FollowUpDraft | null>;
  readonly openItem: (itemId: string) => void;
  readonly newItem: (draft?: Partial<ItemDraft>, options?: NewItemOptions) => void;
  readonly openRun: (runId: string) => void;
  readonly editCircle: (circleId: string | null) => void;
  readonly editNote: (target: NoteTarget) => void;
  readonly appointAgent: () => void;
};

export const UiContext = createContext<UiApi | null>(null);

export function useUi(): UiApi {
  const value = useContext(UiContext);
  if (!value) throw new Error('NimiDay UI context is missing.');
  return value;
}
