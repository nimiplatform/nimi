import { useQueryClient, type FetchStatus, type QueryKey } from '@tanstack/react-query';
import { useEffect } from 'react';

/** A retained, disabled page must not hold an in-flight read open. */
export function useUnobservedRuntimeRead(queryKey: QueryKey, enabled: boolean, fetchStatus: FetchStatus): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const cancelWhenUnobserved = () => queueMicrotask(() => {
      const current = queryClient.getQueryCache().find({ queryKey, exact: true });
      if (current && !current.isActive() && current.state.fetchStatus !== 'idle') {
        void queryClient.cancelQueries({ queryKey, exact: true });
      }
    });
    if (!enabled) cancelWhenUnobserved();
    return cancelWhenUnobserved;
  }, [queryKey, enabled, fetchStatus, queryClient]);
}
