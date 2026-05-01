import assert from 'node:assert/strict';
import test from 'node:test';

import {
  asNimiError,
  Runtime,
  RuntimeMethodIds,
  setNodeGrpcBridge,
  type NodeGrpcBridge,
} from '../../src/runtime/index.js';
import { ReasonCode, isRetryableReasonCode } from '../../src/types/index.js';
import {
  AuthorizeExternalPrincipalRequest,
  AuthorizeExternalPrincipalResponse,
  PolicyMode,
  AuthorizationPreset,
} from '../../src/runtime/generated/runtime/v1/grant';
import { OpenSessionResponse } from '../../src/runtime/generated/runtime/v1/auth';
import { ReasonCode as RuntimeProtoReasonCode } from '../../src/runtime/generated/runtime/v1/common';
import {
  ExecuteScenarioRequest,
  ExecuteScenarioResponse,
  FinishReason,
  ScenarioJobEvent,
  ScenarioJobEventType,
  ScenarioJobStatus,
  ScenarioType,
  RoutePolicy,
} from '../../src/runtime/generated/runtime/v1/ai';
import { WorkflowEvent, WorkflowEventType } from '../../src/runtime/generated/runtime/v1/workflow';
import { Timestamp } from '../../src/runtime/generated/google/protobuf/timestamp';
import { textGenerateOutput } from '../helpers/runtime-ai-shapes.js';

const APP_ID = 'nimi.runtime.class.test';

function installNodeGrpcBridge(bridge: NodeGrpcBridge): void {
  setNodeGrpcBridge(bridge);
}

function clearNodeGrpcBridge(): void {
  setNodeGrpcBridge(null);
}

export {
  assert,
  test,
  asNimiError,
  Runtime,
  RuntimeMethodIds,
  ReasonCode,
  isRetryableReasonCode,
  AuthorizeExternalPrincipalRequest,
  AuthorizeExternalPrincipalResponse,
  PolicyMode,
  AuthorizationPreset,
  OpenSessionResponse,
  RuntimeProtoReasonCode,
  ExecuteScenarioRequest,
  ExecuteScenarioResponse,
  FinishReason,
  ScenarioJobEvent,
  ScenarioJobEventType,
  ScenarioJobStatus,
  ScenarioType,
  RoutePolicy,
  WorkflowEvent,
  WorkflowEventType,
  Timestamp,
  textGenerateOutput,
  APP_ID,
  installNodeGrpcBridge,
  clearNodeGrpcBridge,
};

export type { NodeGrpcBridge };
