import { MockDriver } from '../mock/MockDriver.js';
import { SdkDriver, type SdkDriverOptions } from '../sdk/SdkDriver.js';
import { loadScenarioFromJson } from '../mock/scenario-loader.js';
import type { AgentDataDriver } from './types.js';

export type DriverKind = 'mock' | 'sdk';

export function resolveDriverKind(): DriverKind {
  const explicit = String(import.meta.env['VITE_AVATAR_DRIVER'] || '').trim().toLowerCase();
  if (!explicit) return 'sdk';
  if (explicit === 'sdk' || explicit === 'mock') {
    return explicit;
  }
  throw new Error(`Unsupported VITE_AVATAR_DRIVER=${explicit}. Expected "sdk" or "mock".`);
}

export type CreateDriverInput = {
  kind?: DriverKind;
  scenarioJson?: string;
  scenarioSource?: string;
  sdk?: SdkDriverOptions;
};

export function createDriver(input: CreateDriverInput = {}): AgentDataDriver {
  const kind = input.kind ?? resolveDriverKind();
  if (kind === 'sdk') {
    if (!input.sdk) {
      throw new Error('SdkDriver requires sdk bootstrap input');
    }
    return new SdkDriver(input.sdk);
  }
  const json = input.scenarioJson;
  if (!json) {
    throw new Error('MockDriver requires scenarioJson (pass the loaded scenario file contents)');
  }
  const scenario = loadScenarioFromJson(json, input.scenarioSource ?? 'unknown');
  return new MockDriver({ scenario });
}
