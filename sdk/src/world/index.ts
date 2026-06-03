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
  projection,
  projectWorldRuntimePayload,
} from './projection.js';
import {
  session,
  createInspectWorldSession,
} from './session.js';
import {
  display,
} from './display.js';
import type {
  WorldGenerateSubmitInput,
  WorldGenerateSubmitResult,
  WorldRuntimeProjectionRequest,
  WorldRuntimeProjectionResult,
  WorldTruthAnchor,
  WorldTruthDetail,
  WorldTruthListItem,
  WorldTruthSummary,
  WorldTruthWorldStatus,
} from './types.js';

export type * from './types.js';
export * from './display.js';

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
  projection,
  projectWorldRuntimePayload,
  session,
  createInspectWorldSession,
};

export type WorldFacade = {
  truth: {
    normalize: typeof normalizeWorldTruthSummary;
    list: (status?: WorldTruthWorldStatus) => Promise<WorldTruthListItem[]>;
    read: (worldId: string) => Promise<WorldTruthSummary>;
    readAnchor: (worldId: string) => Promise<WorldTruthAnchor>;
    readList: (status?: WorldTruthWorldStatus) => Promise<WorldTruthListItem[]>;
    readSummary: (worldId: string) => Promise<WorldTruthSummary>;
    readDetail: (worldId: string, recommendedAgentLimit?: number) => Promise<WorldTruthDetail>;
  };
  generate: {
    project: typeof buildWorldInputProjection;
    toRuntimeInput: typeof toRuntimeWorldGenerateInput;
    submit: (input: WorldGenerateSubmitInput) => Promise<WorldGenerateSubmitResult>;
  };
  projection: {
    projectRuntimePayload: (input: WorldRuntimeProjectionRequest) => Promise<WorldRuntimeProjectionResult>;
  };
  fixture: typeof fixture;
  render: typeof render;
  session: typeof session;
  display: typeof display;
};

export function createWorldFacade(
  client: PlatformClient,
): WorldFacade {
  return {
    truth: {
      normalize: truth.normalize,
      list: (status) => readWorldTruthList(client, status),
      read: (worldId: string) => readWorldTruthSummary(client, worldId),
      readAnchor: (worldId: string) => readWorldTruthAnchor(client, worldId),
      readList: (status) => readWorldTruthList(client, status),
      readSummary: (worldId: string) => readWorldTruthSummary(client, worldId),
      readDetail: (worldId: string, recommendedAgentLimit?: number) =>
        readWorldTruthDetail(client, worldId, recommendedAgentLimit),
    },
    generate: {
      project: generate.project,
      toRuntimeInput: generate.toRuntimeInput,
      submit: (input) =>
        submitWorldGenerate(client, input),
    },
    projection: {
      projectRuntimePayload: (input) =>
        projectWorldRuntimePayload(client, input),
    },
    fixture,
    render,
    session,
    display,
  };
}
