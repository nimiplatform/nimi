import { MockDriver } from '../mock/MockDriver.js';
import { SdkDriver } from '../sdk/SdkDriver.js';
import { loadScenarioFromJson } from '../mock/scenario-loader.js';
import type { AgentDataDriver } from './types.js';

export type DriverKind = 'mock' | 'sdk';

export function resolveDriverKind(): DriverKind {
  const explicit = import.meta.env['VITE_AVATAR_DRIVER'];
  if (explicit === 'sdk') return 'sdk';
  return 'mock';
}

export type CreateDriverInput = {
  kind?: DriverKind;
  scenarioJson?: string;
  scenarioSource?: string;
};

export function createDriver(input: CreateDriverInput = {}): AgentDataDriver {
  const kind = input.kind ?? resolveDriverKind();
  if (kind === 'sdk') {
    return new SdkDriver();
  }
  const json = input.scenarioJson;
  if (!json) {
    throw new Error('MockDriver requires scenarioJson (pass the loaded scenario file contents)');
  }
  const scenario = loadScenarioFromJson(json, input.scenarioSource ?? 'unknown');
  return new MockDriver({ scenario });
}
