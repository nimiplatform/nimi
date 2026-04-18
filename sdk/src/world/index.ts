import type { PlatformClient } from '../platform-client.js';
import {
  truth,
  normalizeWorldTruthAnchor,
  normalizeWorldTruthListItem,
  normalizeWorldTruthSummary,
  normalizeWorldTruthDetail,
  readWorldTruthList,
  readWorldTruthAnchor,
  readWorldTruthSummary,
  readWorldTruthDetail,
} from './truth.js';
import {
  generate,
  buildWorldInputProjection,
  toRuntimeWorldGenerateInput,
  submitWorldGenerate,
} from './generate.js';
import {
  fixture,
  normalizeWorldFixturePackage,
  normalizeWorldInspectVector,
  normalizeWorldInspectViewPreset,
  worldFixtureFromResolvedPaths,
  pickWorldFixturePreviewSpzUrl,
  resolveWorldFixtureTitle,
} from './fixture.js';
import {
  render,
  createInspectWorldRenderPlan,
} from './render.js';
import {
  session,
  createInspectWorldSession,
} from './session.js';

export type * from './types.js';

export {
  truth,
  normalizeWorldTruthAnchor,
  normalizeWorldTruthListItem,
  normalizeWorldTruthSummary,
  normalizeWorldTruthDetail,
  readWorldTruthList,
  readWorldTruthAnchor,
  readWorldTruthSummary,
  readWorldTruthDetail,
  generate,
  buildWorldInputProjection,
  toRuntimeWorldGenerateInput,
  submitWorldGenerate,
  fixture,
  normalizeWorldFixturePackage,
  normalizeWorldInspectVector,
  normalizeWorldInspectViewPreset,
  worldFixtureFromResolvedPaths,
  pickWorldFixturePreviewSpzUrl,
  resolveWorldFixtureTitle,
  render,
  createInspectWorldRenderPlan,
  session,
  createInspectWorldSession,
};

export function createWorldFacade(
  client: PlatformClient,
) {
  return {
    truth: {
      normalize: truth.normalize,
      list: (status?: Parameters<typeof readWorldTruthList>[1]) => readWorldTruthList(client, status),
      read: (worldId: string) => readWorldTruthSummary(client, worldId),
      readAnchor: (worldId: string) => readWorldTruthAnchor(client, worldId),
      readList: (status?: Parameters<typeof readWorldTruthList>[1]) => readWorldTruthList(client, status),
      readSummary: (worldId: string) => readWorldTruthSummary(client, worldId),
      readDetail: (worldId: string, recommendedAgentLimit?: number) =>
        readWorldTruthDetail(client, worldId, recommendedAgentLimit),
    },
    generate: {
      project: generate.project,
      toRuntimeInput: generate.toRuntimeInput,
      submit: (input: Parameters<typeof submitWorldGenerate>[1]) =>
        submitWorldGenerate(client, input),
    },
    fixture,
    render,
    session,
  };
}
