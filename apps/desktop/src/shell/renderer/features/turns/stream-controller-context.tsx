import { createContext, useContext, type PropsWithChildren } from 'react';

import type { StreamController } from './stream-controller.js';

const StreamControllerContext = createContext<StreamController | null>(null);

export function StreamControllerProvider(
  props: PropsWithChildren<{ readonly controller: StreamController }>,
) {
  return (
    <StreamControllerContext.Provider value={props.controller}>
      {props.children}
    </StreamControllerContext.Provider>
  );
}

export function useStreamController(): StreamController {
  const controller = useContext(StreamControllerContext);
  if (!controller) throw new Error('DESKTOP_STREAM_CONTROLLER_MISSING');
  return controller;
}
