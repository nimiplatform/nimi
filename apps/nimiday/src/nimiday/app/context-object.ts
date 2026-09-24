import { createContext } from 'react';
import type { Language } from '../domain/types.js';
import type { Copy } from '../i18n/zh.js';
import type { ActivityBridge } from '../platform/activity-bridge.js';
import type { AgentDesk } from '../platform/agent-desk.js';
import type { DayEngine, NavTarget } from '../platform/engine.js';
import type { DayActions } from '../store/actions.js';
import type { DayStore } from '../store/day-store.js';

// Kept apart from the provider so a development hot update never replaces the
// context identity that mounted consumers already read from.

export type Services = {
  readonly store: DayStore;
  readonly actions: DayActions;
  readonly desk: AgentDesk;
  readonly activity: ActivityBridge;
  readonly engine: DayEngine;
};

export type NimiDayContextValue = Services & {
  readonly nav: NavTarget;
  readonly navigate: (target: NavTarget) => void;
  readonly language: Language;
  readonly copy: Copy;
};

export const NimiDayContext = createContext<NimiDayContextValue | null>(null);
