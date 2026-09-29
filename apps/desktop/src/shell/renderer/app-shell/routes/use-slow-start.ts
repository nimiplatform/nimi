import { useEffect, useState } from 'react';

/** True once a start has taken longer than `slowAfterMs`; never with none. */
export function useSlowStart(slowAfterMs: number | undefined): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!slowAfterMs) return undefined;
    const timer = setTimeout(() => setSlow(true), slowAfterMs);
    return () => clearTimeout(timer);
  }, [slowAfterMs]);
  return slow;
}
