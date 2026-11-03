import { createContext, useContext } from 'react';
import type { HeroDemoSession } from './hero-demo-session.js';

export const DemoSessionContext = createContext<HeroDemoSession | null>(null);

export function useHeroDemoSession() {
  const session = useContext(DemoSessionContext);
  if (!session) throw new Error('The Home demo requires HeroDemoSessionProvider.');
  return session;
}
