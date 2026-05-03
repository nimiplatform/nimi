import {
  assert,
  test,
  createAgentLocalChatConversationProvider,
  createRuntimeAdapter,
  createBeatActionEnvelopeText,
  createContinuityAdapter,
  sampleTurnInput,
  collectEvents,
} from './chat-agent-orchestration-provider-test-utils.js';
import type {
  ConversationRuntimeTextStreamPart,
  AgentCommitInput,
  AgentRuntimeStreamRequest,
  TestVoiceWorkflowSubmitRequest,
} from './chat-agent-orchestration-provider-test-utils.js';

test('agent local chat provider executes admitted voice actions', async () => {
  const committed: AgentCommitInput[] = [];
  const provider = createAgentLocalChatConversationProvider({
    runtimeAdapter: createRuntimeAdapter({
      async streamText() {
        const envelopeText = createBeatActionEnvelopeText({
          beats: [{
            beatId: 'beat-voice-turn',
            beatIndex: 0,
            text: '我先只用文字回复你。',
          }],
          actions: [{
            actionId: 'action-voice-1',
            actionIndex: 0,
            modality: 'voice',
            promptText: '一段轻声回应',
            sourceMessageId: 'beat-voice-turn',
            sourceBeatIndex: 0,
          }],
        });
        async function* stream(): AsyncIterable<ConversationRuntimeTextStreamPart> {
          yield { type: 'start' };
          yield { type: 'text-delta', textDelta: envelopeText };
          yield {
            type: 'finish',
            finishReason: 'stop',
            trace: {
              traceId: 'trace-voice-turn',
              promptTraceId: 'prompt-voice-turn',
            },
          };
        }
        return { stream: stream() };
      },
      async synthesizeVoice(request) {
        assert.equal(request.prompt, '一段轻声回应');
        return {
          mediaUrl: 'file:///tmp/voice-turn.mp3',
          mimeType: 'audio/mpeg',
          artifactId: 'artifact-voice-1',
          traceId: 'trace-voice-1',
          playbackCueEnvelope: null,
        };
      },
      async generateImage() {
        throw new Error('image generation should stay unopened for voice-only actions');
      },
    }),
    continuityAdapter: createContinuityAdapter(committed, 'truth:153:t1:b1:s0:m0:r0'),
  });

  const events = await collectEvents(provider, sampleTurnInput({
    userText: '你能用声音或者视频回复我吗？',
    agentLocalChat: {
      agentResolution: {
        ready: true,
        reason: 'ok',
        textProjection: {
          capability: 'text.generate',
          selectedBinding: { source: 'cloud', connectorId: 'connector-text', model: 'gpt-5.4-mini' },
          resolvedBinding: { capability: 'text.generate', source: 'cloud', provider: 'openai', model: 'gpt-5.4-mini', modelId: 'gpt-5.4-mini', connectorId: 'connector-text' },
          health: null,
          metadata: null,
          supported: true,
          reasonCode: null,
        },
        imageProjection: null,
        voiceProjection: {
          capability: 'audio.synthesize',
          selectedBinding: { source: 'local', connectorId: '', model: 'kokoro-82m' },
          resolvedBinding: { capability: 'audio.synthesize', source: 'local', provider: 'kokoro', model: 'kokoro-82m', modelId: 'kokoro-82m', connectorId: '', endpoint: 'http://127.0.0.1:8010' },
          health: null,
          metadata: null,
          supported: true,
          reasonCode: null,
        },
        imageReady: false,
        voiceReady: true,
      },
      textExecutionSnapshot: { executionId: 'text-snapshot' },
      voiceExecutionSnapshot: { executionId: 'voice-snapshot' },
    },
  }));

  assert.deepEqual(
    events.map((event) => event.type),
    [
      'turn-started',
      'text-delta',
      'message-sealed',
      'beat-planned',
      'beat-delivery-started',
      'artifact-ready',
      'beat-delivered',
      'projection-rebuilt',
      'turn-completed',
    ],
  );
  assert.equal(events.some((event) => event.type === 'artifact-ready'), true);
  assert.equal(committed[0]?.voiceState?.status, 'complete');
  assert.equal(committed[0]?.voiceState?.mediaUrl, 'file:///tmp/voice-turn.mp3');
  assert.equal(committed[0]?.imageState?.status, 'none');
});

test('agent local chat provider consumes typed image prompt payloads from the model envelope', async () => {
  const committed: AgentCommitInput[] = [];
  const provider = createAgentLocalChatConversationProvider({
    runtimeAdapter: createRuntimeAdapter({
      async streamText() {
        const envelopeText = createBeatActionEnvelopeText({
          beats: [{
            beatId: 'beat-innkeeper',
            beatIndex: 0,
            text: '她抬头看了你一眼。',
          }],
          actions: [{
            actionId: 'action-innkeeper-image',
            actionIndex: 0,
            modality: 'image',
            promptText: 'subject: 客栈老板娘\nscene: 抬头看向来客的瞬间\nstyle: 写实电影感插画\nmood: 克制、略带审视\ncontinuity: 古风客栈, 夜色室内\navoid: 不要多余人物, 不要夸张表情',
            sourceMessageId: 'beat-innkeeper',
            sourceBeatIndex: 0,
          }],
        });
        async function* stream(): AsyncIterable<ConversationRuntimeTextStreamPart> {
          yield { type: 'start' };
          yield { type: 'text-delta', textDelta: envelopeText };
          yield {
            type: 'finish',
            finishReason: 'stop',
            trace: {
              traceId: 'trace-planner-turn',
              promptTraceId: 'prompt-planner-turn',
            },
          };
        }
        return { stream: stream() };
      },
      async generateImage(request) {
        assert.match(request.prompt, /subject: 客栈老板娘/);
        assert.match(request.prompt, /scene: 抬头看向来客的瞬间/);
        assert.match(request.prompt, /style: 写实电影感插画/);
        assert.match(request.prompt, /avoid: 不要多余人物, 不要夸张表情/);
        return {
          mediaUrl: 'https://cdn.nimi.test/planner-image.png',
          mimeType: 'image/png',
          artifactId: 'artifact-planner-image',
          traceId: 'trace-planner-image',
        };
      },
    }),
    continuityAdapter: createContinuityAdapter(committed, 'truth:151:t1:b2:s0:m0:r0'),
  });

  const events = await collectEvents(provider, sampleTurnInput({
    userText: '她现在是什么表情？',
    agentLocalChat: {
      agentResolution: {
        ready: true,
        reason: 'ok',
        textProjection: {
          capability: 'text.generate',
          selectedBinding: { source: 'cloud', connectorId: 'connector-text', model: 'gpt-5.4-mini' },
          resolvedBinding: { capability: 'text.generate', source: 'cloud', provider: 'openai', model: 'gpt-5.4-mini', modelId: 'gpt-5.4-mini', connectorId: 'connector-text' },
          health: null,
          metadata: null,
          supported: true,
          reasonCode: null,
        },
        imageProjection: {
          capability: 'image.generate',
          selectedBinding: { source: 'local', connectorId: '', model: 'flux' },
          resolvedBinding: { capability: 'image.generate', source: 'local', provider: 'forge', model: 'flux', modelId: 'flux', connectorId: '', endpoint: 'http://127.0.0.1:7860' },
          health: null,
          metadata: null,
          supported: true,
          reasonCode: null,
        },
        imageReady: true,
      },
      textExecutionSnapshot: { executionId: 'text-snapshot' },
      imageExecutionSnapshot: { executionId: 'image-snapshot' },
    },
  }));

  assert.equal(events.some((event) => event.type === 'artifact-ready'), true);
  assert.equal(committed[0]?.imageState?.status, 'complete');
  assert.match(committed[0]?.imageState?.prompt || '', /subject: 客栈老板娘/);
  assert.match(committed[0]?.imageState?.prompt || '', /continuity: 古风客栈, 夜色室内/);
});

test('agent local chat provider submits workflow voice actions without silently reusing audio.synthesize', async () => {
  const committed: AgentCommitInput[] = [];
  let synthesizeVoiceCalled = false;
  let submitRequest: TestVoiceWorkflowSubmitRequest | null = null;
  const provider = createAgentLocalChatConversationProvider({
    runtimeAdapter: createRuntimeAdapter({
      async streamText() {
        const envelopeText = createBeatActionEnvelopeText({
          beats: [{
            beatId: 'beat-voice-clone',
            beatIndex: 0,
            text: '我可以先把音色方向给你定下来。',
          }],
          actions: [{
            actionId: 'action-voice-clone',
            actionIndex: 0,
            modality: 'voice',
            operation: 'voice_workflow.voice_clone',
            promptText: '参考这句的温柔低声线，保留亲密但清晰的咬字。',
            sourceMessageId: 'beat-voice-clone',
            sourceBeatIndex: 0,
          }],
        });
        async function* stream(): AsyncIterable<ConversationRuntimeTextStreamPart> {
          yield { type: 'start' };
          yield { type: 'text-delta', textDelta: envelopeText };
          yield {
            type: 'finish',
            finishReason: 'stop',
            trace: {
              traceId: 'trace-voice-workflow',
              promptTraceId: 'prompt-voice-workflow',
            },
          };
        }
        return { stream: stream() };
      },
      async synthesizeVoice() {
        synthesizeVoiceCalled = true;
        throw new Error('workflow voice action must not silently call narrow synth runtime');
      },
      async submitVoiceWorkflow(request) {
        submitRequest = request as TestVoiceWorkflowSubmitRequest;
        return {
          jobId: 'voice-workflow-job-clone',
          traceId: 'trace-voice-workflow-submit',
          workflowStatus: 'submitted',
          voiceReference: {
            kind: 'voice_asset_id',
            stableRef: 'voice-asset-clone',
          },
          voiceAssetId: 'voice-asset-clone',
          providerVoiceRef: 'provider-voice-clone',
        };
      },
    }),
    continuityAdapter: createContinuityAdapter(committed, 'truth:156:t1:b1:s0:m0:r0'),
  });

  const events = await collectEvents(provider, sampleTurnInput({
    userText: '帮我定一个新的声音分身吧',
    agentLocalChat: {
      agentResolution: {
        ready: true,
        reason: 'ok',
        textProjection: {
          capability: 'text.generate',
          selectedBinding: { source: 'cloud', connectorId: 'connector-text', model: 'gpt-5.4-mini' },
          resolvedBinding: { capability: 'text.generate', source: 'cloud', provider: 'openai', model: 'gpt-5.4-mini', modelId: 'gpt-5.4-mini', connectorId: 'connector-text' },
          health: null,
          metadata: null,
          supported: true,
          reasonCode: null,
        },
        imageProjection: null,
        voiceProjection: null,
        voiceWorkflowProjections: {
          'voice_workflow.voice_clone': {
            capability: 'voice_workflow.voice_clone',
            selectedBinding: { source: 'cloud', connectorId: 'connector-voice-clone', model: 'qwen3-tts-vc' },
            resolvedBinding: { capability: 'voice_workflow.voice_clone', source: 'cloud', provider: 'dashscope', model: 'qwen3-tts-vc', modelId: 'qwen3-tts-vc', connectorId: 'connector-voice-clone' },
            health: null,
            metadata: {
              capability: 'voice_workflow.voice_clone',
              metadataVersion: 'v1',
              resolvedBindingRef: 'voice-clone-ref',
              metadataKind: 'voice_workflow.voice_clone',
              metadata: {
                workflowType: 'voice_clone',
              },
            },
            supported: true,
            reasonCode: null,
          },
          'voice_workflow.voice_design': null,
        },
        voiceWorkflowReadyByCapability: {
          'voice_workflow.voice_clone': true,
          'voice_workflow.voice_design': false,
        },
        imageReady: false,
        voiceReady: false,
      },
      textExecutionSnapshot: { executionId: 'text-snapshot' },
      voiceExecutionSnapshot: null,
      latestVoiceCapture: {
        bytes: new Uint8Array([1, 2, 3, 4]),
        mimeType: 'audio/wav',
        transcriptText: '帮我定一个新的声音分身吧',
      },
      voiceWorkflowExecutionSnapshotByCapability: {
        'voice_workflow.voice_clone': {
          executionId: 'workflow-clone-snapshot',
          conversationCapabilitySlice: {
            capability: 'voice_workflow.voice_clone',
            resolvedBinding: {
              capability: 'voice_workflow.voice_clone',
            },
          },
        },
      },
    },
  }));

  assert.equal(synthesizeVoiceCalled, false);
  assert.equal(submitRequest, null);
  assert.equal(events.some((event) => event.type === 'artifact-ready'), false);
  assert.equal(committed[0]?.voiceState?.status, 'error');
  assert.match(committed[0]?.voiceState?.message || '', /Voice playback is unavailable because no voice route is configured/i);
});

test('agent local chat provider fails close when workflow voice clone has no current-thread reference audio', async () => {
  const committed: AgentCommitInput[] = [];
  let synthesizeVoiceCalled = false;
  let submitRequest: TestVoiceWorkflowSubmitRequest | null = null;
  const provider = createAgentLocalChatConversationProvider({
    runtimeAdapter: createRuntimeAdapter({
      async streamText() {
        const envelopeText = createBeatActionEnvelopeText({
          beats: [{
            beatId: 'beat-voice-clone',
            beatIndex: 0,
            text: '我需要先拿到这一线程里的参考音频。',
          }],
          actions: [{
            actionId: 'action-voice-clone',
            actionIndex: 0,
            modality: 'voice',
            operation: 'voice_workflow.voice_clone',
            promptText: '参考这句的温柔低声线，保留亲密但清晰的咬字。',
            sourceMessageId: 'beat-voice-clone',
            sourceBeatIndex: 0,
          }],
        });
        async function* stream(): AsyncIterable<ConversationRuntimeTextStreamPart> {
          yield { type: 'start' };
          yield { type: 'text-delta', textDelta: envelopeText };
          yield {
            type: 'finish',
            finishReason: 'stop',
            trace: {
              traceId: 'trace-voice-workflow',
              promptTraceId: 'prompt-voice-workflow',
            },
          };
        }
        return { stream: stream() };
      },
      async synthesizeVoice() {
        synthesizeVoiceCalled = true;
        throw new Error('workflow voice action must not silently call narrow synth runtime');
      },
      async submitVoiceWorkflow(request) {
        submitRequest = request as TestVoiceWorkflowSubmitRequest;
        if (!request.referenceAudio) {
          throw new Error('voice clone workflow requires current-thread reference audio');
        }
        return {
          jobId: 'voice-workflow-job-clone',
          traceId: 'trace-voice-workflow-submit',
          workflowStatus: 'submitted',
          voiceReference: null,
          voiceAssetId: null,
          providerVoiceRef: null,
        };
      },
    }),
    continuityAdapter: createContinuityAdapter(committed, 'truth:156:t1:b1:s0:m0:r0'),
  });

  const events = await collectEvents(provider, sampleTurnInput({
    userText: '帮我定一个新的声音分身吧',
    agentLocalChat: {
      agentResolution: {
        ready: true,
        reason: 'ok',
        textProjection: {
          capability: 'text.generate',
          selectedBinding: { source: 'cloud', connectorId: 'connector-text', model: 'gpt-5.4-mini' },
          resolvedBinding: { capability: 'text.generate', source: 'cloud', provider: 'openai', model: 'gpt-5.4-mini', modelId: 'gpt-5.4-mini', connectorId: 'connector-text' },
          health: null,
          metadata: null,
          supported: true,
          reasonCode: null,
        },
        imageProjection: null,
        voiceProjection: null,
        voiceWorkflowProjections: {
          'voice_workflow.voice_clone': {
            capability: 'voice_workflow.voice_clone',
            selectedBinding: { source: 'cloud', connectorId: 'connector-voice-clone', model: 'qwen3-tts-vc' },
            resolvedBinding: { capability: 'voice_workflow.voice_clone', source: 'cloud', provider: 'dashscope', model: 'qwen3-tts-vc', modelId: 'qwen3-tts-vc', connectorId: 'connector-voice-clone' },
            health: null,
            metadata: {
              capability: 'voice_workflow.voice_clone',
              metadataVersion: 'v1',
              resolvedBindingRef: 'voice-clone-ref',
              metadataKind: 'voice_workflow.voice_clone',
              metadata: {
                workflowType: 'voice_clone',
              },
            },
            supported: true,
            reasonCode: null,
          },
          'voice_workflow.voice_design': null,
        },
        voiceWorkflowReadyByCapability: {
          'voice_workflow.voice_clone': true,
          'voice_workflow.voice_design': false,
        },
        imageReady: false,
        voiceReady: false,
      },
      textExecutionSnapshot: { executionId: 'text-snapshot' },
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
        },
      },
    },
  }));

  assert.equal(synthesizeVoiceCalled, false);
  assert.equal(submitRequest, null);
  assert.equal(events.some((event) => event.type === 'artifact-ready'), false);
  assert.equal(committed[0]?.voiceState?.status, 'error');
  assert.match(committed[0]?.voiceState?.message || '', /Voice playback is unavailable because no voice route is configured/i);
});

test('agent local chat provider fails close when runtime stream finishes without output text', async () => {
  const committed: AgentCommitInput[] = [];
  const provider = createAgentLocalChatConversationProvider({
    runtimeAdapter: createRuntimeAdapter({
      async streamText() {
        async function* stream(): AsyncIterable<ConversationRuntimeTextStreamPart> {
          yield { type: 'start' };
          yield {
            type: 'finish',
            finishReason: 'stop',
            usage: {},
            trace: {
              traceId: 'trace-empty',
              promptTraceId: 'prompt-empty',
            },
          };
        }
        return { stream: stream() };
      },
    }),
    continuityAdapter: createContinuityAdapter(committed, 'truth:142:t1:b0:s0:m0:r0'),
  });

  const events = await collectEvents(provider, sampleTurnInput());

  assert.equal(committed.length, 1);
  assert.equal(committed[0]?.outcome, 'failed');
  const failedEvent = events.at(-1);
  assert.equal(failedEvent?.type, 'turn-failed');
  assert.match(failedEvent?.type === 'turn-failed' ? failedEvent.error.message : '', /without output text/);
});

test('agent local chat provider fails fenced APML outputs without recovery', async () => {
  const committed: AgentCommitInput[] = [];
  let capturedRequest: AgentRuntimeStreamRequest | null = null;
  const rawModelOutput = `\`\`\`xml\n${createBeatActionEnvelopeText({
    beats: [{ beatIndex: 0, text: 'Fenced APML must fail.' }],
  })}\n\`\`\``;
  const provider = createAgentLocalChatConversationProvider({
    runtimeAdapter: createRuntimeAdapter({
      async streamText(request) {
        capturedRequest = request;
        async function* stream(): AsyncIterable<ConversationRuntimeTextStreamPart> {
          yield { type: 'start' };
          yield {
            type: 'text-delta',
            textDelta: rawModelOutput,
          };
          yield {
            type: 'finish',
            finishReason: 'stop',
            usage: {
              inputTokens: 12,
              outputTokens: 18,
            },
            trace: {
              traceId: 'trace-fenced',
              promptTraceId: 'prompt-fenced',
            },
          };
        }
        return { stream: stream() };
      },
    }),
    continuityAdapter: createContinuityAdapter(committed, 'truth:144:t1:b1:s0:m0:r0'),
  });

  const events = await collectEvents(provider, sampleTurnInput({
    agentLocalChat: {
      textModelContextTokens: 2400,
      textMaxOutputTokensRequested: 321,
    },
  }));

  if (!capturedRequest) {
    assert.fail('expected runtime stream request to be captured');
  }
  const fencedRequest = capturedRequest as AgentRuntimeStreamRequest;
  assert.equal(fencedRequest.maxOutputTokensRequested, 321);
  assert.equal(committed[0]?.outcome, 'failed');
  const failedEvent = events.at(-1);
  assert.equal(failedEvent?.type, 'turn-failed');
  if (failedEvent?.type !== 'turn-failed') {
    assert.fail('expected a failed terminal event');
  }
  assert.equal(failedEvent.finishReason, 'stop');
  assert.equal(failedEvent.trace?.traceId, 'trace-fenced');
  assert.equal(failedEvent.trace?.promptTraceId, 'prompt-fenced');
  assert.equal(failedEvent.usage?.inputTokens, 12);
  assert.equal(failedEvent.usage?.outputTokens, 18);
  const diagnostics = failedEvent.diagnostics as Record<string, unknown> | undefined;
  assert.equal(diagnostics?.classification, 'invalid-apml');
  assert.equal(diagnostics?.recoveryPath, 'none');
  assert.equal(diagnostics?.suspectedTruncation, false);
  assert.match(String(diagnostics?.parseErrorDetail || ''), /begin with <message>/);
  assert.equal(diagnostics?.rawOutputChars, rawModelOutput.length);
  assert.equal(diagnostics?.normalizedOutputChars, rawModelOutput.length);
  assert.equal(diagnostics?.finishReason, 'stop');
  assert.equal(diagnostics?.traceId, 'trace-fenced');
  assert.equal(diagnostics?.promptTraceId, 'prompt-fenced');
  assert.deepEqual(diagnostics?.usage, {
    inputTokens: 12,
    outputTokens: 18,
  });
  assert.equal(diagnostics?.contextWindowSource, 'route-profile');
  assert.equal(diagnostics?.maxOutputTokensRequested, 321);
  assert.equal(diagnostics?.promptOverflow, false);
  assert.match(String(diagnostics?.requestPrompt || ''), /^Messages:\n\[/);
  assert.match(String(diagnostics?.requestSystemPrompt || ''), /Output Contract:/);
  assert.equal(diagnostics?.rawModelOutputText, rawModelOutput);
  assert.equal(diagnostics?.normalizedModelOutputText, rawModelOutput);
  assert.equal(events.some((event) => event.type === 'message-sealed'), false);
});

test('agent local chat provider fails wrapped APML outputs without recovery', async () => {
  const committed: AgentCommitInput[] = [];
  const provider = createAgentLocalChatConversationProvider({
    runtimeAdapter: createRuntimeAdapter({
      async streamText() {
        async function* stream(): AsyncIterable<ConversationRuntimeTextStreamPart> {
          yield { type: 'start' };
          yield {
            type: 'text-delta',
            textDelta: `Here is the envelope:\n${createBeatActionEnvelopeText({
              beats: [{ beatIndex: 0, text: 'Wrapped APML must fail.' }],
            })}\nThanks.`,
          };
          yield {
            type: 'finish',
            finishReason: 'stop',
            usage: {
              inputTokens: 9,
              outputTokens: 14,
            },
            trace: {
              traceId: 'trace-wrapper',
              promptTraceId: 'prompt-wrapper',
            },
          };
        }
        return { stream: stream() };
      },
    }),
    continuityAdapter: createContinuityAdapter(committed, 'truth:145:t1:b1:s0:m0:r0'),
  });

  const events = await collectEvents(provider, sampleTurnInput());

  assert.equal(committed[0]?.outcome, 'failed');
  const failedEvent = events.at(-1);
  assert.equal(failedEvent?.type, 'turn-failed');
  if (failedEvent?.type !== 'turn-failed') {
    assert.fail('expected a failed terminal event');
  }
  const diagnostics = failedEvent.diagnostics as Record<string, unknown> | undefined;
  assert.equal(diagnostics?.classification, 'invalid-apml');
  assert.equal(diagnostics?.recoveryPath, 'none');
  assert.equal(diagnostics?.finishReason, 'stop');
});

test('agent local chat provider fails closed when the model emits scratchpad plain text', async () => {
  const committed: AgentCommitInput[] = [];
  const provider = createAgentLocalChatConversationProvider({
    runtimeAdapter: createRuntimeAdapter({
      async streamText() {
        async function* stream(): AsyncIterable<ConversationRuntimeTextStreamPart> {
          yield { type: 'start' };
          yield {
            type: 'text-delta',
            textDelta: [
              '*分析：用户连续发送了“在吗？”',
              '',
              '策略：先安抚，再确认状态。',
              '',
              '执行：回复一句自然问候。',
            ].join('\n'),
          };
          yield {
            type: 'finish',
            finishReason: 'stop',
            trace: {
              traceId: 'trace-scratchpad',
              promptTraceId: 'prompt-scratchpad',
            },
          };
        }
        return { stream: stream() };
      },
    }),
    continuityAdapter: createContinuityAdapter(committed, 'truth:145a:t1:b1:s0:m0:r0'),
  });

  const events = await collectEvents(provider, sampleTurnInput());

  assert.equal(committed[0]?.outcome, 'failed');
  const failedEvent = events.at(-1);
  assert.equal(failedEvent?.type, 'turn-failed');
  if (failedEvent?.type !== 'turn-failed') {
    assert.fail('expected a failed terminal event');
  }
  assert.match(failedEvent.error.message, /format was invalid/i);
  const diagnostics = failedEvent.diagnostics as Record<string, unknown> | undefined;
  assert.equal(diagnostics?.classification, 'invalid-apml');
  assert.equal(diagnostics?.recoveryPath, 'none');
  assert.equal(diagnostics?.traceId, 'trace-scratchpad');
  assert.equal(diagnostics?.promptTraceId, 'prompt-scratchpad');
  assert.equal(events.some((event) => event.type === 'message-sealed'), false);
});

test('agent local chat provider fails partial APML outputs with truncation diagnostics', async () => {
  const committed: AgentCommitInput[] = [];
  let capturedRequest: AgentRuntimeStreamRequest | null = null;
  const provider = createAgentLocalChatConversationProvider({
    runtimeAdapter: createRuntimeAdapter({
      async streamText(request) {
        capturedRequest = request;
        async function* stream(): AsyncIterable<ConversationRuntimeTextStreamPart> {
          yield { type: 'start' };
          yield {
            type: 'text-delta',
            textDelta: '<message id="message-0"><emotion>focus</emotion>unfinished',
          };
          yield {
            type: 'finish',
            finishReason: 'length',
            usage: {
              inputTokens: 40,
              outputTokens: 41,
            },
            trace: {
              traceId: 'trace-partial',
              promptTraceId: 'prompt-partial',
            },
          };
        }
        return { stream: stream() };
      },
    }),
    continuityAdapter: createContinuityAdapter(committed, 'truth:146:t1:b0:s0:m0:r0'),
  });

  const events = await collectEvents(provider, sampleTurnInput({
    agentLocalChat: {
      textModelContextTokens: 4096,
      textMaxOutputTokensRequested: 111,
    },
  }));

  if (!capturedRequest) {
    assert.fail('expected runtime stream request to be captured');
  }
  const partialRequest = capturedRequest as AgentRuntimeStreamRequest;
  assert.equal(partialRequest.maxOutputTokensRequested, 111);
  assert.equal(committed[0]?.outcome, 'failed');
  const failedEvent = events.at(-1);
  assert.equal(failedEvent?.type, 'turn-failed');
  if (failedEvent?.type !== 'turn-failed') {
    assert.fail('expected a failed terminal event');
  }
  assert.match(failedEvent.error.message, /truncated/i);
  assert.match(failedEvent.error.message, /Partial output:/);
  assert.match(failedEvent.error.message, /<message id="message-0"/);
  assert.equal(failedEvent.finishReason, 'length');
  assert.equal(failedEvent.trace?.traceId, 'trace-partial');
  assert.equal(failedEvent.trace?.promptTraceId, 'prompt-partial');
  assert.equal(failedEvent.usage?.inputTokens, 40);
  assert.equal(failedEvent.usage?.outputTokens, 41);
  const diagnostics = failedEvent.diagnostics as Record<string, unknown> | undefined;
  assert.equal(diagnostics?.classification, 'partial-apml');
  assert.equal(diagnostics?.recoveryPath, 'none');
  assert.equal(diagnostics?.suspectedTruncation, true);
  assert.equal(diagnostics?.finishReason, 'length');
  assert.equal(diagnostics?.traceId, 'trace-partial');
  assert.equal(diagnostics?.promptTraceId, 'prompt-partial');
  assert.equal(diagnostics?.contextWindowSource, 'route-profile');
  assert.equal(diagnostics?.maxOutputTokensRequested, 111);
  assert.equal(diagnostics?.promptOverflow, false);
});

test('agent local chat provider fails close before runtime when prompt preflight still overflows after reduction', async () => {
  const committed: AgentCommitInput[] = [];
  let runtimeCalled = 0;
  const provider = createAgentLocalChatConversationProvider({
    runtimeAdapter: createRuntimeAdapter({
      async streamText() {
        runtimeCalled += 1;
        async function* stream(): AsyncIterable<ConversationRuntimeTextStreamPart> {
          yield { type: 'start' };
        }
        return { stream: stream() };
      },
    }),
    continuityAdapter: createContinuityAdapter(committed, 'truth:147:t1:b0:s0:m0:r0'),
  });

  const events = await collectEvents(provider, sampleTurnInput({
    userMessage: {
      id: 'user-overflow-1',
      text: `Need a very long answer ${'detail '.repeat(800)}`,
    },
    agentLocalChat: {
      textModelContextTokens: 80,
      textMaxOutputTokensRequested: 111,
    },
  }));

  assert.equal(runtimeCalled, 0);
  assert.equal(committed[0]?.outcome, 'failed');
  assert.equal(events[0]?.type, 'turn-started');
  const failedEvent = events.at(-1);
  assert.equal(failedEvent?.type, 'turn-failed');
  if (failedEvent?.type !== 'turn-failed') {
    assert.fail('expected a failed terminal event');
  }
  assert.match(failedEvent.error.message, /available input budget/i);
  const diagnostics = failedEvent.diagnostics as Record<string, unknown> | undefined;
  assert.equal(diagnostics?.classification, 'preflight-rejected');
  assert.equal(diagnostics?.recoveryPath, 'none');
  assert.equal(diagnostics?.promptOverflow, true);
  assert.equal(diagnostics?.contextWindowSource, 'route-profile');
  assert.match(String(diagnostics?.requestPrompt || ''), /^Messages:\n\[/);
  const preflight = diagnostics?.preflight as Record<string, unknown> | undefined;
  assert.equal(typeof preflight?.totalInputTokens, 'number');
  assert.equal(typeof preflight?.promptBudgetTokens, 'number');
  assert.equal(typeof preflight?.systemTokens, 'number');
  assert.equal(typeof preflight?.historyTokens, 'number');
  assert.equal(typeof preflight?.userTokens, 'number');
  assert.ok(Number(preflight?.totalInputTokens) > Number(preflight?.promptBudgetTokens));
  assert.ok(Number(preflight?.promptBudgetTokens) >= 0);
  assert.ok(Number(preflight?.systemTokens) >= 0);
  assert.ok(Number(preflight?.historyTokens) >= 0);
  assert.ok(Number(preflight?.userTokens) >= 0);
});

test('agent local chat provider fails close when runtime stream ends without terminal event', async () => {
  const committed: AgentCommitInput[] = [];
  const provider = createAgentLocalChatConversationProvider({
    runtimeAdapter: createRuntimeAdapter({
      async streamText() {
        async function* stream(): AsyncIterable<ConversationRuntimeTextStreamPart> {
          yield { type: 'start' };
          yield { type: 'text-delta', textDelta: 'partial answer' };
        }
        return { stream: stream() };
      },
    }),
    continuityAdapter: createContinuityAdapter(committed, 'truth:143:t1:b1:s0:m0:r0'),
  });

  const events = await collectEvents(provider, sampleTurnInput());

  assert.equal(committed.length, 1);
  assert.equal(committed[0]?.outcome, 'failed');
  const failedEvent = events.at(-1);
  assert.equal(failedEvent?.type, 'turn-failed');
  assert.match(failedEvent?.type === 'turn-failed' ? failedEvent.error.message : '', /without a terminal event/);
});
