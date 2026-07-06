import assert from 'node:assert/strict';
import test from 'node:test';

import { projectNimiRuntimeAgentServiceEvent, type AgentEvent } from './index';
import {
  AgentPresentationEventFamily,
  AgentStateEventFamily,
  VoiceOutputMode,
  VoicePlaybackState,
} from '../core-generated/runtime-typed-client';

test('Runtime Agent consume projects AgentService presentation and state events', () => {
  const presentationEvent: AgentEvent = {
    eventType: 7,
    sequence: '1',
    agentId: 'local-agent:owner-1:agent-1',
    localAgentRef: 'local-agent:owner-1:agent-1',
    ownerUserId: 'owner-1',
    runtimeSourceRef: 'agent-1',
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
        audioArtifactId: '',
        audioMimeType: '',
        voiceStreamId: '',
        chunkTransportRef: '',
        messageId: '',
        chunkSequence: '0',
        finalChunk: false,
        voiceOutputMode: VoiceOutputMode.UNSPECIFIED,
        voicePlaybackState: VoicePlaybackState.UNSPECIFIED,
        playbackTarget: '',
        finalArtifact: false,
        terminalReason: '',
        reason: '',
        durationMs: '0',
        deadlineOffsetMs: '0',
        finalArtifactId: '',
      },
    },
  };
  const stateEvent: AgentEvent = {
    eventType: 6,
    sequence: '2',
    agentId: 'local-agent:owner-1:agent-1',
    localAgentRef: 'local-agent:owner-1:agent-1',
    ownerUserId: 'owner-1',
    runtimeSourceRef: 'agent-1',
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

test('Runtime Agent consume projects AgentService voice stream chunk presentation events', () => {
  const event = projectNimiRuntimeAgentServiceEvent({
    eventType: 7,
    sequence: '3',
    agentId: 'local-agent:owner-1:agent-1',
    localAgentRef: 'local-agent:owner-1:agent-1',
    ownerUserId: 'owner-1',
    runtimeSourceRef: 'agent-1',
    detail: {
      oneofKind: 'presentation',
      presentation: {
        family: AgentPresentationEventFamily.VOICE_STREAM_CHUNK_AVAILABLE,
        conversationAnchorId: 'anchor-1',
        turnId: 'turn-1',
        streamId: 'stream-1',
        activityName: '',
        activityCategory: '',
        activityIntensity: '',
        activitySource: '',
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
        audioArtifactId: '',
        audioMimeType: 'audio/wav',
        voiceStreamId: 'voice-stream-1',
        chunkTransportRef: 'runtime-agent-voice-stream://voice-stream-1/chunks/000001',
        messageId: 'message-1',
        chunkSequence: '1',
        finalChunk: false,
        voiceOutputMode: VoiceOutputMode.NATIVE_STREAM,
        voicePlaybackState: VoicePlaybackState.ACTIVE,
        playbackTarget: 'avatar_autoplay',
        finalArtifact: false,
        terminalReason: '',
        reason: 'native_stream_chunk_available',
        durationMs: '0',
        deadlineOffsetMs: '0',
        finalArtifactId: '',
      },
    },
  });

  assert.equal(event.eventName, 'runtime.agent.presentation.voice_stream_chunk_available');
  assert.equal(event.conversationAnchorId, 'anchor-1');
  assert.equal(event.turnId, 'turn-1');
  assert.equal(event.streamId, 'stream-1');
  assert.equal(event.detail.audioArtifactId, undefined);
  assert.equal(event.detail.audioMimeType, 'audio/wav');
  assert.equal(event.detail.voiceStreamId, 'voice-stream-1');
  assert.equal(event.detail.chunkTransportRef, 'runtime-agent-voice-stream://voice-stream-1/chunks/000001');
  assert.equal(event.detail.chunkSequence, 1);
  assert.equal(event.detail.finalChunk, false);
  assert.equal(event.detail.voiceOutputMode, 'native_stream');
  assert.equal(event.detail.voicePlaybackState, 'active');
  assert.equal(event.detail.playbackTarget, 'avatar_autoplay');
});
