import { createContext, useContext } from 'react';
import type { WorldCharacter } from './world-detail-types.js';

// A character can be added only after this device's partners are known, and
// one addition per source runs at a time: Runtime replays a request, but two
// requests for the same source would create two partners.
export type WorldMaterializationState = {
  readonly ready: boolean;
  readonly isPending: (character: WorldCharacter) => boolean;
};

export const WorldMaterializationContext = createContext<WorldMaterializationState>({ ready: true, isPending: () => false });

export function useWorldMaterialization(): WorldMaterializationState {
  return useContext(WorldMaterializationContext);
}
