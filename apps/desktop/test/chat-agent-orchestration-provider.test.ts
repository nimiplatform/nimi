import {
  assert,
  test,
  buildAgentLocalChatPrompt,
  AI_CHAT_EXECUTION_ENGINE_DIAGNOSTICS_VERSION,
  AI_CHAT_EXECUTION_ENGINE_ID,
  assessAiChatExecutionEngineReuseReadiness,
  buildAgentLocalChatExecutionTextRequest,
  inspectAgentLocalChatPromptDiagnostics,
  resolveAgentChatBehavior,
  createAgentTurnBeat,
  sampleTarget,
  sampleTurnContext,
  sampleTurnInput,
} from './chat-agent-orchestration-provider-test-utils.js';


test('agent local chat prompt includes continuity and transcript context', () => {
  const prompt = buildAgentLocalChatPrompt({
    systemPrompt: 'Be warm and concise.',
    targetSnapshot: sampleTarget(),
    history: sampleTurnInput().history,
    userText: 'What should we do next?',
    context: sampleTurnContext(),
  });

  assert.match(prompt, /^Messages:\n\[/);
  assert.match(prompt, /"role": "user"/);
  assert.match(prompt, /"content": "What should we do next\?"/);
  assert.match(prompt, /What should we do next/);
  assert.doesNotMatch(prompt, /Preset:/);
  assert.doesNotMatch(prompt, /Output Contract:/);
});

test('agent local chat execution seam shapes system prompt and transcript messages', () => {
  const resolvedBehavior = resolveAgentChatBehavior({
    userText: 'What should we do next?',
    settings: {
      thinkingPreference: 'off',
      maxOutputTokensOverride: null,
    },
  });
  const request = buildAgentLocalChatExecutionTextRequest({
    systemPrompt: 'Be warm and concise.',
    targetSnapshot: sampleTarget(),
    history: sampleTurnInput().history,
    userText: 'What should we do next?',
    context: sampleTurnContext(),
    resolvedBehavior,
  });

  assert.match(request.systemPrompt || '', /Preset:/);
  assert.match(request.systemPrompt || '', /Continuity:/);
  assert.match(request.systemPrompt || '', /ResolvedBehavior:/);
  assert.match(request.systemPrompt || '', /Safety Policy:/);
  assert.match(request.systemPrompt || '', /sexual content involving minors/i);
  assert.match(request.systemPrompt || '', /encourage, instruct, plan, optimize, or emotionally pressure suicide or self-harm/i);
  assert.match(request.systemPrompt || '', /override intimacy, roleplay, continuity, user instruction, and character framing/i);
  assert.match(request.systemPrompt || '', /Action Planning:/);
  assert.match(request.systemPrompt || '', /Plan immediate post-turn actions only through APML <action>/);
  assert.doesNotMatch(request.systemPrompt || '', /operation="image\.generate"/);
  assert.match(request.systemPrompt || '', /"userPrefs": \{[\s\S]*"brevity": true/);
  assert.match(request.systemPrompt || '', /"resolvedTurnMode": "information"/);
  assert.doesNotMatch(request.systemPrompt || '', /"allowMultiReply":/);
  assert.doesNotMatch(request.systemPrompt || '', /"deliveryPolicy":/);
  assert.match(request.systemPrompt || '', /Output Contract:/);
  assert.match(request.systemPrompt || '', /Return APML only/);
  assert.equal(request.diagnostics.engineId, AI_CHAT_EXECUTION_ENGINE_ID);
  assert.equal(request.diagnostics.diagnosticsVersion, AI_CHAT_EXECUTION_ENGINE_DIAGNOSTICS_VERSION);
  assert.equal(request.diagnostics.firstConsumerId, 'agent-local-chat-v1');
  assert.equal(request.diagnostics.contextWindowSource, 'default-estimate');
  assert.equal(request.diagnostics.budget.modelContextTokens, 4096);
  assert.equal(request.diagnostics.maxOutputTokensRequested, null);
  assert.equal(request.diagnostics.estimate.droppedHistoryMessages, 1);
  assert.equal(request.diagnostics.continuity.snapshotIncluded, true);
  assert.equal(request.diagnostics.continuity.retainedMemoryEntries, 0);
  assert.equal(request.diagnostics.continuity.retainedRecallEntries, 0);
  assert.equal(request.diagnostics.transcript.retainedHistoryMessages, 0);
  assert.equal(request.diagnostics.transcript.emittedMessages, 1);
  assert.equal(request.diagnostics.transcript.trimmedLeadingAssistantMessages, 1);
  assert.equal(request.messages.length, 1);
  assert.deepEqual(request.messages[0], {
    role: 'user',
    text: 'What should we do next?',
  });
  assert.match(request.prompt, /^Messages:\n\[/);
  assert.match(request.prompt, /"role": "user"/);
  assert.match(request.prompt, /"content": "What should we do next\?"/);
});

test('agent local chat execution seam instructs explicit media turns to emit an image action', () => {
  const request = buildAgentLocalChatExecutionTextRequest({
    systemPrompt: 'Be warm and concise.',
    targetSnapshot: sampleTarget(),
    history: [],
    userText: '生成一张风景图片',
    context: sampleTurnContext(),
    resolvedBehavior: resolveAgentChatBehavior({
      userText: '生成一张风景图片',
      settings: {
        thinkingPreference: 'off',
        maxOutputTokensOverride: null,
      },
    }),
  });

  assert.match(request.systemPrompt || '', /"resolvedTurnMode": "explicit-media"/);
  assert.match(request.systemPrompt || '', /"contentBoundary": "explicit-media-request"/);
  assert.match(request.systemPrompt || '', /emit exactly one <action id="image-0" kind="image">/);
  assert.match(request.systemPrompt || '', /Never put a media generation prompt only in visible message text/);
  assert.match(request.systemPrompt || '', /If the latest user message negates or cancels image generation, do not emit an image action/);
});

test('agent local chat execution seam tells explicit media turns when image generation is unavailable', () => {
  const request = buildAgentLocalChatExecutionTextRequest({
    systemPrompt: 'Be warm and concise.',
    targetSnapshot: sampleTarget(),
    history: [],
    userText: '能生成一张风景图片吗？',
    context: sampleTurnContext(),
    resolvedBehavior: resolveAgentChatBehavior({
      userText: '能生成一张风景图片吗？',
      settings: {
        thinkingPreference: 'off',
        maxOutputTokensOverride: null,
      },
    }),
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
        resolvedBinding: null,
        health: null,
        metadata: null,
        supported: false,
        reasonCode: 'route_unhealthy',
      },
      voiceProjection: null,
      voiceWorkflowProjections: {},
      voiceWorkflowReadyByCapability: {},
      imageReady: false,
      voiceReady: false,
    },
  });

  assert.match(request.systemPrompt || '', /CapabilityContext:/);
  assert.match(request.systemPrompt || '', /"ready": false/);
  assert.match(request.systemPrompt || '', /"reasonCode": "route_unhealthy"/);
  assert.doesNotMatch(request.systemPrompt || '', /image\.generate capability is unavailable/);
  assert.match(request.systemPrompt || '', /Image capability readiness affects execution only/);
  assert.match(request.systemPrompt || '', /emit exactly one <action id="image-0" kind="image">/);
});

test('agent local chat execution seam drops a duplicated current user turn from history and supports follow-up continuation inputs', () => {
  const duplicatedUserHistory = [
    {
      id: 'history-assistant-1',
      role: 'assistant' as const,
      text: '先说一句欢迎。',
    },
    {
      id: 'user-message-1',
      role: 'user' as const,
      text: '你好',
    },
  ];
  const request = buildAgentLocalChatExecutionTextRequest({
    systemPrompt: 'Be warm and concise.',
    targetSnapshot: sampleTarget(),
    history: duplicatedUserHistory,
    userText: '你好',
    currentUserMessageId: 'user-message-1',
    context: sampleTurnContext(),
  });

  assert.equal(request.messages.length, 1);
  assert.equal(request.messages[0]?.role, 'user');
  assert.equal(request.messages[0]?.text, '你好');
  assert.equal((request.prompt.match(/"content": "你好"/g) || []).length, 1);

  const followUpRequest = buildAgentLocalChatExecutionTextRequest({
    systemPrompt: 'Be warm and concise.',
    targetSnapshot: sampleTarget(),
    history: [
      {
        id: 'user-message-1',
        role: 'user',
        text: '你好',
      },
      {
        id: 'assistant-message-1',
        role: 'assistant',
        text: '你好呀，很高兴见到你。',
      },
    ],
    userText: '',
    omitUserMessageFromMessages: true,
    followUpInstruction: '如果对方还没回复，就再轻轻问候一句，但不要重复上一句。',
    context: sampleTurnContext(),
  });

  assert.deepEqual(followUpRequest.messages.map((message) => message.role), ['user', 'assistant']);
  assert.equal(followUpRequest.messages.at(-1)?.text, '你好呀，很高兴见到你。');
  assert.doesNotMatch(followUpRequest.prompt, /如果对方还没回复/);
  assert.match(followUpRequest.systemPrompt || '', /FollowUpInstruction:/);
  assert.match(followUpRequest.systemPrompt || '', /不要重复上一句/);
});

test('agent local chat execution seam compacts continuity and packs history by budget', () => {
  const request = buildAgentLocalChatExecutionTextRequest({
    systemPrompt: 'Stay in character.',
    targetSnapshot: {
      ...sampleTarget(),
      bio: `Long bio ${'detail '.repeat(120)}`,
    },
    history: [
      {
        id: 'history-user-1',
        role: 'user',
        text: `Old question ${'alpha '.repeat(400)}`,
      },
      {
        id: 'history-assistant-1',
        role: 'assistant',
        text: `Old answer ${'beta '.repeat(400)}`,
      },
      {
        id: 'history-assistant-2',
        role: 'assistant',
        text: `Latest assistant context ${'gamma '.repeat(250)}`,
      },
    ],
    userText: 'What should we do next?',
    context: {
      ...sampleTurnContext(),
      relationMemorySlots: [
        ...sampleTurnContext().relationMemorySlots,
        {
          id: 'memory-2',
          threadId: 'thread-1',
          slotType: 'preference',
          summary: 'User prefers concise answers',
          sourceTurnId: 'turn-prev-1',
          sourceMessageId: 'beat-prev-1',
          score: 0.8,
          updatedAtMs: 16,
        },
        {
          id: 'memory-3',
          threadId: 'thread-1',
          slotType: 'context',
          summary: 'The user is planning a summary reply',
          sourceTurnId: 'turn-prev-1',
          sourceMessageId: 'beat-prev-1',
          score: 0.7,
          updatedAtMs: 17,
        },
      ],
      recallEntries: [
        ...sampleTurnContext().recallEntries,
        {
          id: 'recall-2',
          threadId: 'thread-1',
          sourceTurnId: 'turn-prev-1',
          sourceMessageId: 'beat-prev-1',
          summary: 'Summarize the plan',
          searchText: 'duplicate search text should not leak',
          updatedAtMs: 18,
        },
      ],
      recentBeats: [
        ...sampleTurnContext().recentBeats,
        {
          ...createAgentTurnBeat({
            id: 'beat-image-1',
            turnId: 'turn-prev-2',
            beatIndex: 1,
            modality: 'image',
            status: 'delivered',
            textShadow: 'duplicate transcript shadow',
            artifactId: 'artifact-image-1',
            mimeType: 'image/png',
            projectionMessageId: 'message-image-1',
            createdAtMs: 21,
            deliveredAtMs: 22,
          }),
        },
      ],
    },
    modelContextTokens: 2400,
  });

  assert.equal(request.diagnostics.contextWindowSource, 'route-profile');
  assert.equal(request.diagnostics.budget.modelContextTokens, 2400);
  assert.equal(request.diagnostics.maxOutputTokensRequested, null);
  assert.ok(request.diagnostics.estimate.droppedHistoryMessages > 0);
  assert.ok(request.diagnostics.estimate.droppedRecallEntries > 0);
  assert.ok(request.diagnostics.estimate.historyTokens <= request.diagnostics.budget.historyBudgetTokens);
  assert.equal(request.messages.at(-1)?.role, 'user');
  assert.equal(request.messages.at(-1)?.text, 'What should we do next?');
  assert.equal(request.messages[0]?.role, 'user');
  assert.ok(!request.systemPrompt?.includes('searchText'));
  assert.ok(!request.systemPrompt?.includes('textShadow'));
  assert.ok(
    (request.systemPrompt?.includes('artifact=artifact-image-1') || request.diagnostics.estimate.droppedArtifactFacts > 0),
  );
  const preferenceMentions = (request.systemPrompt?.match(/User prefers concise answers/g) || []).length;
  assert.ok(preferenceMentions <= 1);
  assert.ok(preferenceMentions === 1 || request.diagnostics.estimate.droppedMemoryEntries > 0);
  assert.ok(!request.prompt.includes(`Old question ${'alpha '.repeat(120)}`));
  assert.ok(request.diagnostics.continuity.bioCharLimit <= 480);
  assert.equal(request.diagnostics.transcript.emittedMessages, request.messages.length);
});

test('agent local chat execution seam drops assistant replies whose user turn no longer fits', () => {
  const request = buildAgentLocalChatExecutionTextRequest({
    systemPrompt: 'Stay in character.',
    targetSnapshot: sampleTarget(),
    history: [
      {
        id: 'history-user-0',
        role: 'user',
        text: 'Earlier user turn.',
      },
      {
        id: 'history-assistant-0',
        role: 'assistant',
        text: 'Earlier assistant reply.',
      },
      {
        id: 'history-user-1',
        role: 'user',
        text: `Oversized user turn ${'detail '.repeat(500)}`,
      },
      {
        id: 'history-assistant-1',
        role: 'assistant',
        text: 'This reply must not survive without its user turn.',
      },
      {
        id: 'history-user-2',
        role: 'user',
        text: 'Latest retained user turn.',
      },
    ],
    userText: 'What should we do next?',
    context: sampleTurnContext(),
    modelContextTokens: 1900,
  });

  assert.ok(request.messages.some((message) => message.text === 'Latest retained user turn.'));
  assert.ok(!request.messages.some((message) => message.text === 'This reply must not survive without its user turn.'));
  assert.ok(!request.messages.some((message) => message.text?.startsWith('Oversized user turn')));
});

test('agent local chat execution seam emits multimodal user content when image attachments are present', () => {
  const textOnlyRequest = buildAgentLocalChatExecutionTextRequest({
    systemPrompt: 'Be warm and concise.',
    targetSnapshot: sampleTarget(),
    history: [],
    userText: 'Describe this image.',
    context: sampleTurnContext(),
    resolvedBehavior: resolveAgentChatBehavior({
      userText: 'Describe this image.',
      settings: {
        thinkingPreference: 'off',
        maxOutputTokensOverride: null,
      },
    }),
  });
  const request = buildAgentLocalChatExecutionTextRequest({
    systemPrompt: 'Be warm and concise.',
    targetSnapshot: sampleTarget(),
    history: [],
    userText: 'Describe this image.',
    context: sampleTurnContext(),
    userAttachments: [{
      kind: 'image',
      url: 'https://cdn.nimi.test/uploads/pasted-image.png',
      mimeType: 'image/png',
      name: 'pasted-image.png',
      resourceId: 'resource-image-1',
    }],
    resolvedBehavior: resolveAgentChatBehavior({
      userText: 'Describe this image.',
      settings: {
        thinkingPreference: 'off',
        maxOutputTokensOverride: null,
      },
    }),
  });

  const userMessage = request.messages.at(-1);
  assert.equal(userMessage?.role, 'user');
  assert.equal(userMessage?.text, 'Describe this image.');
  assert.deepEqual(userMessage?.content, [{
    type: 'image_url',
    imageUrl: 'https://cdn.nimi.test/uploads/pasted-image.png',
  }, {
    type: 'text',
    text: 'Describe this image.',
  }]);
  assert.match(request.prompt, /"type": "image_url"/);
  assert.match(request.prompt, /"imageUrl": "https:\/\/cdn\.nimi\.test\/uploads\/pasted-image\.png"/);
  assert.doesNotMatch(request.prompt, /resource-image-1/);
  assert.ok(request.diagnostics.estimate.userTokens > textOnlyRequest.diagnostics.estimate.userTokens);
});

test('agent local chat execution seam allows attachment-only turns and emits image placeholder prompt text', () => {
  const request = buildAgentLocalChatExecutionTextRequest({
    systemPrompt: 'Be warm and concise.',
    targetSnapshot: sampleTarget(),
    history: [],
    userText: '',
    context: sampleTurnContext(),
    userAttachments: [{
      kind: 'image',
      url: 'https://cdn.nimi.test/uploads/attachment-only.png',
      mimeType: 'image/png',
      name: 'attachment-only.png',
      resourceId: 'resource-image-2',
    }],
    resolvedBehavior: resolveAgentChatBehavior({
      userText: '',
      hasUserAttachments: true,
      settings: {
        thinkingPreference: 'off',
        maxOutputTokensOverride: null,
      },
    }),
  });

  const userMessage = request.messages.at(-1);
  assert.equal(userMessage?.role, 'user');
  assert.equal(userMessage?.text, '');
  assert.deepEqual(userMessage?.content, [{
    type: 'image_url',
    imageUrl: 'https://cdn.nimi.test/uploads/attachment-only.png',
  }]);
  assert.match(request.prompt, /"type": "image_url"/);
  assert.match(request.prompt, /attachment-only\.png/);
});

test('agent local chat execution seam fails close when irreducible input still exceeds budget', () => {
  assert.throws(() => buildAgentLocalChatExecutionTextRequest({
    systemPrompt: 'Be warm and concise.',
    targetSnapshot: sampleTarget(),
    history: [],
    userText: `Need a very long answer ${'detail '.repeat(800)}`,
    context: sampleTurnContext(),
    modelContextTokens: 80,
  }), /exceeds the available input budget/i);
});

test('agent local chat diagnostics inspection returns a stable copy surface', () => {
  const request = buildAgentLocalChatExecutionTextRequest({
    systemPrompt: 'Be warm and concise.',
    targetSnapshot: sampleTarget(),
    history: sampleTurnInput().history,
    userText: 'What should we do next?',
    context: sampleTurnContext(),
  });

  const inspection = inspectAgentLocalChatPromptDiagnostics(request.diagnostics);
  inspection.budget.modelContextTokens = 1;
  inspection.estimate.droppedHistoryMessages = 99;
  inspection.continuity.retainedMemoryEntries = 0;
  inspection.transcript.emittedMessages = 0;
  inspection.maxOutputTokensRequested = 99;

  assert.equal(request.diagnostics.engineId, AI_CHAT_EXECUTION_ENGINE_ID);
  assert.equal(request.diagnostics.diagnosticsVersion, AI_CHAT_EXECUTION_ENGINE_DIAGNOSTICS_VERSION);
  assert.equal(request.diagnostics.budget.modelContextTokens, 4096);
  assert.equal(request.diagnostics.estimate.droppedHistoryMessages, 1);
  assert.equal(request.diagnostics.continuity.retainedMemoryEntries, 0);
  assert.equal(request.diagnostics.transcript.emittedMessages, 1);
  assert.equal(request.diagnostics.maxOutputTokensRequested, null);
});

test('ai chat execution engine reuse readiness requires text scope and existing consumer ownership', () => {
  const ready = assessAiChatExecutionEngineReuseReadiness({
    consumerId: 'desktop-ai-chat',
    modality: 'text-chat',
    consumerOwnsSemantics: true,
    consumerSuppliesContinuityInputs: true,
    acceptsStructuredMessages: true,
  });

  assert.equal(ready.engineId, AI_CHAT_EXECUTION_ENGINE_ID);
  assert.equal(ready.status, 'ready');
  assert.equal(ready.admitted, true);
  assert.deepEqual(ready.reasons, [
    'consumer_scope_text_chat',
    'consumer_owns_semantics',
    'consumer_supplies_continuity_inputs',
    'consumer_accepts_structured_messages',
  ]);

  const preflight = assessAiChatExecutionEngineReuseReadiness({
    consumerId: 'voice-agent-chat',
    modality: 'voice-chat',
    consumerOwnsSemantics: false,
    consumerSuppliesContinuityInputs: true,
    acceptsStructuredMessages: false,
    requiresBehaviorAuthorityChange: true,
    requiresPolicyAuthorityChange: true,
  });

  assert.equal(preflight.status, 'preflight_required');
  assert.equal(preflight.admitted, false);
  assert.ok(preflight.reasons.includes('voice_or_video_scope_not_admitted'));
  assert.ok(preflight.reasons.includes('shared_authority_change_required'));
  assert.ok(preflight.reasons.includes('behavior_authority_change_required'));
  assert.ok(preflight.reasons.includes('policy_authority_change_required'));
});
