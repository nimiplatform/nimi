import { createContext, useContext } from 'react';
import type { ItemDraft } from '../domain/items.js';

export type NoteTarget = { readonly noteId?: string; readonly circleId: string | null };

export type UiApi = {
  readonly openItem: (itemId: string) => void;
  readonly newItem: (draft?: Partial<ItemDraft>) => void;
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
