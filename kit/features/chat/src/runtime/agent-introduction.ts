import { useCallback, useEffect, useState } from 'react';
import type { NimiLocalAppAgentIntroduction, NimiLocalAppAgentIntroductionClient, NimiLocalAppAgentHandle } from '@nimiplatform/kit/core/sdk-contract';

// @nimi-authority: rule.nimi.sdks.feature-clients.agent-introduction
export function useAgentIntroduction(input: {
  agentHandle: string | null | undefined;
  getIntroduction: NimiLocalAppAgentIntroductionClient['getIntroduction'];
}) {
  const { agentHandle, getIntroduction } = input;
  const [generation, setGeneration] = useState(0);
  const retry = useCallback(() => setGeneration(value => value + 1), []);
  const [state, setState] = useState<{
    agentHandle: string;
    reader: typeof getIntroduction;
    introduction: NimiLocalAppAgentIntroduction | null;
    unavailable: boolean;
  } | null>(null);
  useEffect(() => {
    let disposed = false;
    setState(null);
    if (agentHandle) {
      void Promise.resolve().then(() => getIntroduction({ agentHandle: agentHandle as NimiLocalAppAgentHandle })).then(
        introduction => { if (!disposed) setState({ agentHandle, reader: getIntroduction, introduction, unavailable: false }); },
        () => { if (!disposed) setState({ agentHandle, reader: getIntroduction, introduction: null, unavailable: true }); },
      );
    }
    return () => { disposed = true; };
  }, [agentHandle, getIntroduction, generation]);
  const current = state?.agentHandle === agentHandle && state?.reader === getIntroduction ? state : null;
  return { introduction: current?.introduction ?? null, unavailable: current?.unavailable ?? false, loading: Boolean(agentHandle && !current), retry };
}
