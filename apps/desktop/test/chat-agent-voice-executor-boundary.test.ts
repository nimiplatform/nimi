import { assert, test } from './chat-agent-local-mode-test-utils.js';
import { resolveVoiceStateFromResolvedAction } from '../src/shell/renderer/features/chat/chat-agent-turn-plan.js';

test('agent voice executor rejects voice workflow operations before dispatch planning', () => {
  assert.throws(() => resolveVoiceStateFromResolvedAction({
    turnId: 'turn-voice-executor',
    textMessageCount: 1,
    transcriptText: 'clone this voice',
    action: {
      actionId: 'action-voice-clone',
      actionIndex: 0,
      actionCount: 1,
      modality: 'voice',
      operation: 'voice_workflow.voice_clone',
      promptPayload: {
        kind: 'voice-prompt',
        promptText: 'clone this voice',
      },
      sourceMessageId: 'message-0',
      deliveryCoupling: 'after-message',
    },
    agentResolution: {
      ready: true,
      reason: 'ok',
      textProjection: null,
      imageProjection: null,
      voiceProjection: null,
      voiceWorkflowProjections: {
        'voice_workflow.voice_clone': {
          capability: 'voice_workflow.voice_clone',
          selectedBinding: { source: 'cloud', connectorId: 'connector-voice-clone', model: 'qwen3-tts-vc' },
          resolvedBinding: {
            capability: 'voice_workflow.voice_clone',
            source: 'cloud',
            provider: 'dashscope',
            model: 'qwen3-tts-vc',
            modelId: 'qwen3-tts-vc',
            connectorId: 'connector-voice-clone',
          },
          health: null,
          metadata: {
            capability: 'voice_workflow.voice_clone',
            metadataVersion: 'v1',
            resolvedBindingRef: 'voice-clone-ref',
            metadataKind: 'voice_workflow.voice_clone',
            metadata: { workflowType: 'voice_clone' },
          },
          supported: true,
          reasonCode: null,
        },
        'voice_workflow.voice_design': null,
      },
      imageReady: false,
      voiceReady: false,
      voiceWorkflowReadyByCapability: {
        'voice_workflow.voice_clone': true,
        'voice_workflow.voice_design': false,
      },
    } as never,
    voiceExecutionSnapshot: null,
    voiceWorkflowExecutionSnapshotByCapability: {
      'voice_workflow.voice_clone': {
        executionId: 'workflow-clone-snapshot',
        conversationCapabilitySlice: {
          capability: 'voice_workflow.voice_clone',
          resolvedBinding: {
            capability: 'voice_workflow.voice_clone',
          },
        },
      } as never,
    },
  }), /first-packet voice executor only admits audio\.synthesize/);
});

test('agent voice executor still admits audio synthesize operations', () => {
  const state = resolveVoiceStateFromResolvedAction({
    turnId: 'turn-voice-executor',
    textMessageCount: 1,
    transcriptText: 'say this aloud',
    action: {
      actionId: 'action-voice-synth',
      actionIndex: 0,
      actionCount: 1,
      modality: 'voice',
      operation: 'audio.synthesize',
      promptPayload: {
        kind: 'voice-prompt',
        promptText: 'say this aloud',
      },
      sourceMessageId: 'message-0',
      deliveryCoupling: 'after-message',
    },
    agentResolution: {
      ready: true,
      reason: 'ok',
      textProjection: null,
      imageProjection: null,
      voiceProjection: {
        capability: 'audio.synthesize',
        selectedBinding: { source: 'local', connectorId: '', model: 'kokoro-82m' },
        resolvedBinding: {
          capability: 'audio.synthesize',
          source: 'local',
          provider: 'kokoro',
          model: 'kokoro-82m',
          modelId: 'kokoro-82m',
          connectorId: '',
        },
        health: null,
        metadata: null,
        supported: true,
        reasonCode: null,
      },
      imageReady: false,
      voiceReady: true,
      voiceWorkflowProjections: {
        'voice_workflow.voice_clone': null,
        'voice_workflow.voice_design': null,
      },
      voiceWorkflowReadyByCapability: {
        'voice_workflow.voice_clone': false,
        'voice_workflow.voice_design': false,
      },
    } as never,
    voiceExecutionSnapshot: { executionId: 'voice-snapshot' } as never,
    voiceWorkflowExecutionSnapshotByCapability: {},
  });

  assert.equal(state.status, 'synthesize');
  assert.equal(state.prompt, 'say this aloud');
});
