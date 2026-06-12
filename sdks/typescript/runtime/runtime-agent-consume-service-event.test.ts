import assert from 'node:assert/strict';
import test from 'node:test';

import { projectNimiRuntimeAgentServiceEvent, type AgentEvent } from './index';
import { AgentPresentationEventFamily, AgentStateEventFamily } from '../core-generated/runtime-typed-client';

test('Runtime Agent consume projects AgentService presentation and state events', () => {
  const presentationEvent: AgentEvent = {
    eventType: 7,
    sequence: '1',
    agentId: 'local-agent:owner-1:agent-1',
    localAgentRef: 'local-agent:owner-1:agent-1',
    ownerUserId: 'owner-1',
    realmAgentId: 'agent-1',
    detail: {
      oneofKind: 'presentation',
      presentation: {
        family: AgentPresentationEventFamily.ACTIVITY_REQUESTED,
        conversationAnchorId: 'anchor-1',
        turnId: 'turn-1',
        streamId: 'stream-1',
        activityName: 'wave',
        activityCategory: 'interaction',
        activityIntensity: 'moderate',
        activitySource: 'apml_output',
        motionId: '',
        motionPriority: '',
        motionExpectedDurationMs: '0',
        expressionId: '',
        expressionExpectedDurationMs: '0',
        poseId: '',
        poseExpectedDurationMs: '0',
        previousPoseId: '',
        lookatTargetKind: '',
        lookatX: 0,
        lookatY: 0,
        lookatZ: 0,
        lookatHasX: false,
        lookatHasY: false,
        lookatHasZ: false,
      },
    },
  };
  const stateEvent: AgentEvent = {
    eventType: 6,
    sequence: '2',
    agentId: 'local-agent:owner-1:agent-1',
    localAgentRef: 'local-agent:owner-1:agent-1',
    ownerUserId: 'owner-1',
    realmAgentId: 'agent-1',
    detail: {
      oneofKind: 'state',
      state: {
        family: AgentStateEventFamily.EMOTION_CHANGED,
        conversationAnchorId: 'anchor-1',
        originatingTurnId: 'turn-1',
        originatingStreamId: 'stream-1',
        currentStatusText: '',
        previousStatusText: '',
        hasPreviousStatusText: false,
        currentExecutionState: 2,
        previousExecutionState: 1,
        currentEmotion: 'joy',
        previousEmotion: 'neutral',
        emotionSource: 'apml_output',
      },
    },
  };

  const presentation = projectNimiRuntimeAgentServiceEvent(presentationEvent);
  const state = projectNimiRuntimeAgentServiceEvent(stateEvent);

  assert.equal(presentation.eventName, 'runtime.agent.presentation.activity_requested');
  assert.equal(presentation.detail.activityName, 'wave');
  assert.equal(state.eventName, 'runtime.agent.state.emotion_changed');
  assert.equal(state.detail.currentEmotion, 'joy');
});
