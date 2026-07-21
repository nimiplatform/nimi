import { createContext, useContext, type PropsWithChildren } from 'react';
import type { LocalModelCenterProgressCache } from './runtime-config-local-model-center-progress-cache.js';

const LocalModelCenterProgressContext = createContext<LocalModelCenterProgressCache | null>(null);

export function LocalModelCenterProgressProvider(
  props: PropsWithChildren<{ readonly cache: LocalModelCenterProgressCache }>,
) {
  return (
    <LocalModelCenterProgressContext.Provider value={props.cache}>
      {props.children}
    </LocalModelCenterProgressContext.Provider>
  );
}

export function useLocalModelCenterProgressCache(): LocalModelCenterProgressCache {
  const cache = useContext(LocalModelCenterProgressContext);
  if (!cache) throw new Error('LOCAL_MODEL_CENTER_PROGRESS_CACHE_MISSING');
  return cache;
}
