import { createContext, useContext, type PropsWithChildren } from 'react';

import type { ScenarioJobController } from './scenario-job-controller.js';

const ScenarioJobControllerContext = createContext<ScenarioJobController | null>(null);

export function ScenarioJobControllerProvider(
  props: PropsWithChildren<{ readonly controller: ScenarioJobController }>,
) {
  return (
    <ScenarioJobControllerContext.Provider value={props.controller}>
      {props.children}
    </ScenarioJobControllerContext.Provider>
  );
}

export function useScenarioJobController(): ScenarioJobController {
  const controller = useContext(ScenarioJobControllerContext);
  if (!controller) throw new Error('DESKTOP_SCENARIO_JOB_CONTROLLER_MISSING');
  return controller;
}
