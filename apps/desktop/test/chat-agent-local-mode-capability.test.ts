import {
  assert,
  test,
  resolveAgentChatThinkingSupport,
  resolveChatThinkingConfig,
  buildAgentEffectiveCapabilityResolution,
  createNimiConversationAISnapshot,
  createEmptyNimiAIConfig,
  readWorkspaceFile,
} from './chat-agent-local-mode-test-utils.js';

function healthyRoute(provider: string) {
  return {
    healthy: true,
    status: 'healthy' as const,
    provider,
    detail: 'ready',
    actionHint: 'use_runtime_route',
  };
}

test('agent submit fail-closes when AgentEffectiveCapabilityResolution.ready is false', () => {
  const supportedProjection = {
    capability: 'text.generate' as const,
    selectedBinding: { source: 'local' as const, connectorId: '', model: 'qwen3' },
    resolvedBinding: { capability: 'text.generate' as const, resolvedBindingRef: 'local:llama:qwen3', source: 'local' as const, provider: 'llama', model: 'qwen3', modelId: 'qwen3', connectorId: '' },
    health: healthyRoute('llama'),
    metadata: { capability: 'text.generate' as const, metadataVersion: 'v1' as const, resolvedBindingRef: 'local:llama:qwen3', metadataKind: 'text.generate' as const, metadata: { supportsThinking: false, traceModeSupport: 'none' as const, supportsImageInput: false, supportsAudioInput: false, supportsVideoInput: false, supportsArtifactRefInput: false } },
    supported: true,
    reasonCode: null,
  };

  // projection_unavailable
  const res1 = buildAgentEffectiveCapabilityResolution({
    textProjection: null,
  });
  assert.equal(res1.ready, false);
  assert.equal(res1.reason, 'projection_unavailable');

  // route_unresolved (supported but no resolvedBinding)
  const noBindingProjection = { ...supportedProjection, resolvedBinding: null };
  const res2 = buildAgentEffectiveCapabilityResolution({
    textProjection: noBindingProjection,
  });
  assert.equal(res2.ready, false);
  assert.equal(res2.reason, 'route_unresolved');

  // ok
  const res3 = buildAgentEffectiveCapabilityResolution({
    textProjection: supportedProjection,
  });
  assert.equal(res3.ready, true);
  assert.equal(res3.reason, 'ok');
});

test('agent capability resolution keeps image and voice optional while exposing readiness truth', () => {
  const textProjection = {
    capability: 'text.generate' as const,
    selectedBinding: { source: 'local' as const, connectorId: '', model: 'qwen3' },
    resolvedBinding: {
      capability: 'text.generate' as const,
      resolvedBindingRef: 'local:text:qwen3',
      source: 'local' as const,
      provider: 'llama',
      model: 'qwen3',
      modelId: 'qwen3',
      connectorId: '',
    },
    health: healthyRoute('llama'),
    metadata: {
      capability: 'text.generate' as const,
      metadataVersion: 'v1' as const,
      resolvedBindingRef: 'local:text:qwen3',
      metadataKind: 'text.generate' as const,
      metadata: {
        supportsThinking: false,
        traceModeSupport: 'none' as const,
        supportsImageInput: false,
        supportsAudioInput: false,
        supportsVideoInput: false,
        supportsArtifactRefInput: false,
      },
    },
    supported: true,
    reasonCode: null,
  };
  const readyImageProjection = {
    capability: 'image.generate' as const,
    selectedBinding: { source: 'local' as const, connectorId: '', model: 'flux' },
    resolvedBinding: {
      capability: 'image.generate' as const,
      resolvedBindingRef: 'local:image:flux',
      source: 'local' as const,
      provider: 'local-image',
      model: 'flux',
      modelId: 'flux',
      connectorId: '',
      endpoint: 'http://127.0.0.1:7860',
    },
    health: healthyRoute('local-image'),
    metadata: null,
    supported: true,
    reasonCode: null,
  };
  const readyVoiceProjection = {
    capability: 'audio.synthesize' as const,
    selectedBinding: { source: 'cloud' as const, connectorId: 'connector-voice', model: 'gpt-4o-mini-tts' },
    resolvedBinding: {
      capability: 'audio.synthesize' as const,
      resolvedBindingRef: 'cloud:audio:connector-voice:gpt-4o-mini-tts',
      source: 'cloud' as const,
      provider: 'openai',
      model: 'gpt-4o-mini-tts',
      modelId: 'gpt-4o-mini-tts',
      connectorId: 'connector-voice',
    },
    health: healthyRoute('openai'),
    metadata: null,
    supported: true,
    reasonCode: null,
  };

  const withoutImage = buildAgentEffectiveCapabilityResolution({
    textProjection,
    imageProjection: null,
    voiceProjection: null,
  });
  assert.equal(withoutImage.ready, true);
  assert.equal(withoutImage.imageProjection, null);
  assert.equal(withoutImage.imageReady, false);
  assert.equal(withoutImage.voiceProjection, null);
  assert.equal(withoutImage.voiceReady, false);
  assert.equal(withoutImage.voiceWorkflowReadyByCapability['voice_workflow.voice_clone'], false);
  assert.equal(withoutImage.voiceWorkflowReadyByCapability['voice_workflow.voice_design'], false);

  const readyVoiceWorkflowCloneProjection = {
    capability: 'voice_workflow.voice_clone' as const,
    selectedBinding: { source: 'cloud' as const, connectorId: 'connector-voice-clone', model: 'qwen3-tts-vc' },
    resolvedBinding: {
      capability: 'voice_workflow.voice_clone' as const,
      resolvedBindingRef: 'cloud:voice_workflow.voice_clone:connector-voice-clone:qwen3-tts-vc',
      source: 'cloud' as const,
      provider: 'dashscope',
      model: 'qwen3-tts-vc',
      modelId: 'qwen3-tts-vc',
      connectorId: 'connector-voice-clone',
    },
    health: healthyRoute('dashscope'),
    metadata: {
      capability: 'voice_workflow.voice_clone' as const,
      metadataVersion: 'v1' as const,
      resolvedBindingRef: 'cloud:voice_workflow.voice_clone:connector-voice-clone:qwen3-tts-vc',
      metadataKind: 'voice_workflow.voice_clone' as const,
      metadata: {
        workflowType: 'voice_clone' as const,
        requiresTargetSynthesisBinding: true,
        textPromptMode: 'unsupported' as const,
        supportsLanguageHints: false,
        supportsPreferredName: true,
        referenceAudioUriInput: true,
        referenceAudioBytesInput: true,
        allowedReferenceAudioMimeTypes: ['audio/wav', 'audio/mpeg'],
      },
    },
    supported: true,
    reasonCode: null,
  };
  const readyVoiceWorkflowDesignProjection = {
    capability: 'voice_workflow.voice_design' as const,
    selectedBinding: { source: 'cloud' as const, connectorId: 'connector-voice-design', model: 'qwen3-tts-vd' },
    resolvedBinding: {
      capability: 'voice_workflow.voice_design' as const,
      resolvedBindingRef: 'cloud:voice_workflow.voice_design:connector-voice-design:qwen3-tts-vd',
      source: 'cloud' as const,
      provider: 'dashscope',
      model: 'qwen3-tts-vd',
      modelId: 'qwen3-tts-vd',
      connectorId: 'connector-voice-design',
    },
    health: healthyRoute('dashscope'),
    metadata: {
      capability: 'voice_workflow.voice_design' as const,
      metadataVersion: 'v1' as const,
      resolvedBindingRef: 'cloud:voice_workflow.voice_design:connector-voice-design:qwen3-tts-vd',
      metadataKind: 'voice_workflow.voice_design' as const,
      metadata: {
        workflowType: 'voice_design' as const,
        requiresTargetSynthesisBinding: true,
        instructionTextMode: 'required' as const,
        previewTextMode: 'optional' as const,
        supportsLanguage: true,
        supportsPreferredName: true,
      },
    },
    supported: true,
    reasonCode: null,
  };

  const withReadyImage = buildAgentEffectiveCapabilityResolution({
    textProjection,
    imageProjection: readyImageProjection,
    voiceProjection: readyVoiceProjection,
    voiceWorkflowCloneProjection: readyVoiceWorkflowCloneProjection,
    voiceWorkflowDesignProjection: readyVoiceWorkflowDesignProjection,
  });
  assert.equal(withReadyImage.ready, true);
  assert.equal(withReadyImage.imageProjection?.capability, 'image.generate');
  assert.equal(withReadyImage.imageReady, true);
  assert.equal(withReadyImage.voiceProjection?.capability, 'audio.synthesize');
  assert.equal(withReadyImage.voiceReady, true);
  assert.equal(withReadyImage.voiceWorkflowProjections['voice_workflow.voice_clone']?.capability, 'voice_workflow.voice_clone');
  assert.equal(withReadyImage.voiceWorkflowProjections['voice_workflow.voice_design']?.capability, 'voice_workflow.voice_design');
  assert.equal(withReadyImage.voiceWorkflowReadyByCapability['voice_workflow.voice_clone'], true);
  assert.equal(withReadyImage.voiceWorkflowReadyByCapability['voice_workflow.voice_design'], true);

  const unresolvedImage = buildAgentEffectiveCapabilityResolution({
    textProjection,
    imageProjection: {
      ...readyImageProjection,
      resolvedBinding: null,
    },
    voiceProjection: {
      ...readyVoiceProjection,
      resolvedBinding: null,
    },
    voiceWorkflowCloneProjection: {
      ...readyVoiceWorkflowCloneProjection,
      resolvedBinding: null,
    },
  });
  assert.equal(unresolvedImage.ready, true);
  assert.equal(unresolvedImage.imageReady, false);
  assert.equal(unresolvedImage.voiceReady, false);
  assert.equal(unresolvedImage.voiceWorkflowReadyByCapability['voice_workflow.voice_clone'], false);
});

test('agent local mode creates image execution snapshot for runtime-authoritative local image routes with endpoint', () => {
  const textProjection = {
    capability: 'text.generate' as const,
    selectedBinding: { source: 'local' as const, connectorId: '', model: 'llama3' },
    resolvedBinding: {
      capability: 'text.generate' as const,
      resolvedBindingRef: 'local:text:llama3',
      source: 'local' as const,
      provider: 'llama',
      model: 'llama3',
      modelId: 'llama3',
      localModelId: 'local-model-1',
      connectorId: '',
      endpoint: 'http://127.0.0.1:11434/v1',
      localProviderEndpoint: 'http://127.0.0.1:11434/v1',
    },
    health: healthyRoute('llama'),
    metadata: {
      capability: 'text.generate' as const,
      metadataVersion: 'v1' as const,
      resolvedBindingRef: 'local:text:llama3',
      metadataKind: 'text.generate' as const,
      metadata: {
        supportsThinking: false,
        traceModeSupport: 'none' as const,
        supportsImageInput: false,
        supportsAudioInput: false,
        supportsVideoInput: false,
        supportsArtifactRefInput: false,
      },
    },
    supported: true,
    reasonCode: null,
  };
  const imageProjection = {
    capability: 'image.generate' as const,
    selectedBinding: { source: 'local' as const, connectorId: '', model: 'z_image_turbo' },
    resolvedBinding: {
      capability: 'image.generate' as const,
      resolvedBindingRef: 'local:image:z_image_turbo',
      source: 'local' as const,
      provider: 'media',
      model: 'media/z_image_turbo',
      modelId: 'z_image_turbo',
      localModelId: '01JIMAGE',
      connectorId: '',
      engine: 'media',
      endpoint: 'http://127.0.0.1:8321/v1',
      localProviderEndpoint: 'http://127.0.0.1:8321/v1',
      goRuntimeLocalModelId: 'go-z-image',
      goRuntimeStatus: 'active',
    },
    health: healthyRoute('media'),
    metadata: null,
    supported: true,
    reasonCode: null,
  };

  const agentResolution = buildAgentEffectiveCapabilityResolution({
    textProjection,
    imageProjection,
  });
  const imageExecutionSnapshot = createNimiConversationAISnapshot({
    config: createEmptyNimiAIConfig(),
    capability: 'image.generate',
    projection: imageProjection,
    agentResolution,
  });
  const resolvedBinding = imageExecutionSnapshot.conversationCapabilitySlice?.resolvedTarget as {
    endpoint?: string;
    goRuntimeLocalModelId?: string;
    goRuntimeStatus?: string;
  } | undefined;

  assert.equal(agentResolution.ready, true);
  assert.equal(agentResolution.imageReady, true);
  assert.equal(imageExecutionSnapshot.conversationCapabilitySlice?.capability, 'image.generate');
  assert.equal(resolvedBinding?.endpoint, 'http://127.0.0.1:8321/v1');
  assert.equal(resolvedBinding?.goRuntimeLocalModelId, 'go-z-image');
  assert.equal(resolvedBinding?.goRuntimeStatus, 'active');
});

test('agent local mode keeps thinking unsupported and forces effective off config', () => {
  assert.deepEqual(resolveAgentChatThinkingSupport(), {
    supported: false,
    reason: 'agent_route_unsupported',
  });
  assert.deepEqual(
    resolveChatThinkingConfig('on', resolveAgentChatThinkingSupport()),
    {
      mode: 'off',
      traceMode: 'hide',
    },
  );
});

test('agent shell stays a Runtime Agent projection consumer with local UI state', () => {
  const adapterSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-shell-adapter.tsx');
  const adapterHostFeedbackSource = readWorkspaceFile(
    'src/shell/renderer/features/chat/chat-agent-shell-adapter-host-feedback.ts',
  );
  const adapterSessionSnapshotSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-shell-adapter-session-snapshot.ts');
  const adapterStateSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-shell-adapter-state.ts');
  const sessionHydrationSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-session-hydration.ts');
  const hostActionHelpersSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-shell-host-actions-helpers.ts');
  const hostActionSubmitSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-shell-host-actions-submit.ts');
  const hostActionSubmitRunSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-shell-host-actions-submit-run.ts');
  const voiceAdapterSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-shell-adapter-voice.ts');
  const presentationSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-shell-presentation.tsx');
  const effectsSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-shell-effects.ts');
  const humanAdapterSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-human-adapter.tsx');
  const runtimeProviderSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-runtime-provider.ts');
  const runtimeAgentTurnSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-runtime-agent.ts');
  const runtimeAgentMemorySource = readWorkspaceFile('src/shell/renderer/infra/runtime-agent-memory.ts');
  const runtimeAgentInspectSource = readWorkspaceFile('src/shell/renderer/infra/runtime-agent-inspect.ts');
  assert.match(adapterSource, /createRuntimeAgentChatConversationProvider/);
  assert.match(adapterSource, /useAgentConversationEffects/);
  assert.match(adapterSource, /useAgentConversationPresentation/);
  assert.match(adapterSource, /useAgentRuntimeSessionSnapshotHydration/);
  assert.match(adapterSessionSnapshotSource, /createNimiRuntimeAgentConsumeClient/);
  assert.match(adapterSessionSnapshotSource, /getDesktopRuntime\(\)\.agents/);
  assert.match(adapterSessionSnapshotSource, /getDesktopAppId\(\)/);
  assert.match(adapterSessionSnapshotSource, /turns\.getSessionSnapshot/);
  assert.doesNotMatch(adapterSessionSnapshotSource, /getPlatformClient/);
  assert.doesNotMatch(adapterSessionSnapshotSource, /runtime\.agent\.turns\.getSessionSnapshot/);
  assert.match(adapterSessionSnapshotSource, /hydrateAgentThreadBundleFromRuntimeSessionSnapshot/);
  assert.match(adapterSessionSnapshotSource, /lastRuntimeSessionSnapshotRequestKeyRef/);
  assert.match(adapterSessionSnapshotSource, /pendingRuntimeSessionSnapshotRequestKeyRef/);
  assert.match(adapterSessionSnapshotSource, /desktop_runtime_agent_session_snapshot_request_deduped_total/);
  assert.match(adapterStateSource, /realmSocialData\.loadSocialSnapshot\(\)/);
  assert.match(adapterStateSource, /loadDesktopRouteOptions\('text\.generate'\)/);
  assert.match(adapterStateSource, /findNimiRuntimeRouteModelProfile/);
  assert.match(sessionHydrationSource, /snapshot\.transcript/);
  assert.match(hostActionHelpersSource, /createNimiHostRuntimeAgentLifecycleSurface/);
  assert.match(hostActionHelpersSource, /createNimiHostRuntimeAgentPresentationProfileSurface/);
  assert.match(hostActionHelpersSource, /createNimiRuntimeAgentConsumeClient/);
  assert.match(hostActionHelpersSource, /withScopes:\s*withDesktopRuntimeProtectedScopes/);
  assert.match(runtimeAgentTurnSource, /withScopes:\s*withDesktopRuntimeProtectedScopes/);
  assert.match(runtimeAgentMemorySource, /withScopes:\s*withDesktopRuntimeProtectedScopes/);
  assert.match(runtimeAgentInspectSource, /withScopes:\s*withDesktopRuntimeProtectedScopes/);
  assert.match(hostActionHelpersSource, /ensureLocalAgentInitialized/);
  assert.doesNotMatch(hostActionHelpersSource, /createRuntimeProtectedScopeHelper/);
  assert.doesNotMatch(hostActionHelpersSource, /runtime\.agent\.initializeAgent/);
  assert.match(hostActionHelpersSource, /client\.anchors\.getSnapshot/);
  assert.match(hostActionHelpersSource, /clearAgentConversationAnchorBinding/);
  assert.doesNotMatch(hostActionHelpersSource, /runtimeAgentExecutionBindingsMatch/);
  assert.doesNotMatch(hostActionHelpersSource, /withScopes\(\s*\['runtime\.agent\.write'\]/);
  assert.doesNotMatch(hostActionHelpersSource, /withScopes\(\s*\['runtime\.agent\.read'\]/);
  assert.match(hostActionHelpersSource, /record\.anchor/);
  assert.match(hostActionSubmitRunSource, /matchConversationTurnEvent/);
  assert.match(hostActionSubmitSource, /createInitialAgentSubmitDriverState/);
  assert.match(hostActionSubmitSource, /previewUrl/);
  assert.doesNotMatch(hostActionSubmitSource, /input\.payload\.attachments\.length === 0\s*\?/);
  assert.match(hostActionSubmitRunSource, /reduceAgentSubmitDriverEvent/);
  assert.match(hostActionSubmitRunSource, /resolveCompletedAgentSubmitDriverCheckpoint/);
  assert.match(hostActionSubmitSource, /resolveInterruptedAgentSubmitDriverCheckpoint/);
  assert.match(hostActionSubmitRunSource, /resolveAgentSubmitDriverProjectionRefresh/);
  assert.doesNotMatch(hostActionSubmitSource, /resolveAuthoritativeAgentThreadBundle/);
  assert.match(hostActionSubmitRunSource, /assertAgentTurnLifecycleCompleted/);
  assert.match(hostActionSubmitSource, /const activeTarget = input\.hostInput\.activeTarget;/);
  assert.doesNotMatch(hostActionSubmitSource, /resolveRuntimeAgentExecutionBindingFromTextResolvedBinding/);
  assert.match(hostActionSubmitSource, /const threadContext = await ensureThreadAnchorBindingForTarget\(\{/);
  assert.doesNotMatch(hostActionSubmitSource, /expectedExecutionBinding,/);
  assert.match(hostActionSubmitSource, /setSubmittingThreadId\(effectiveThreadId\)/);
  assert.match(hostActionSubmitSource, /setFooterHostState\(effectiveThreadId,\s*null\)/);
  assert.match(hostActionSubmitSource, /releaseSubmittingIfCurrent/);
  assert.ok(
    hostActionSubmitSource.indexOf('const refreshedAgentResolution = await ensureAgentConversationSubmitRouteReady({')
    < hostActionSubmitSource.indexOf('const threadContext = await ensureThreadAnchorBindingForTarget({'),
    'agent host actions must verify Runtime route readiness before creating local projection cache rows',
  );
  const readinessIndex = hostActionSubmitSource.indexOf('const refreshedAgentResolution = await ensureAgentConversationSubmitRouteReady({');
  const finalUserProjectionIndex = hostActionSubmitSource.indexOf('const userProjection = buildAgentUserProjection({');
  assert.ok(
    readinessIndex < finalUserProjectionIndex,
    'agent host actions must verify Runtime route readiness before applying in-memory user projection messages',
  );
  assert.match(hostActionSubmitSource, /userProjectionApplied = true/);
  assert.match(hostActionSubmitSource, /setAgentVisibleProjection\(effectiveThreadId,\s*userBundle\)/);
  assert.doesNotMatch(hostActionSubmitSource, /chatAgentStoreClient\.commitTurnResult/);
  assert.match(hostActionSubmitRunSource, /if \(projectionEffects\.awaitRefresh\) \{\s+const rebuiltBundle =/s);
  assert.match(adapterHostFeedbackSource, /logRendererEvent/);
  assert.match(adapterSource, /conversationCapabilityProjectionByCapability\['audio\.transcribe'\]/);
  assert.match(adapterSource, /voiceSessionState/);
  assert.match(voiceAdapterSource, /handleVoiceSessionToggle/);
  assert.match(voiceAdapterSource, /resolveIsVoiceSessionForeground/);
  assert.match(voiceAdapterSource, /document\.addEventListener\('visibilitychange', syncForegroundState\)/);
  assert.match(voiceAdapterSource, /autoStopMode:\s*'silence'/);
  assert.match(voiceAdapterSource, /onAutoStop:\s*\(recording\)/);
  assert.match(voiceAdapterSource, /handleHandsFreeAutoStopRecording\(recording, conversationAnchorId\)/);
  assert.match(voiceAdapterSource, /activeConversationAnchorId/);
  assert.match(voiceAdapterSource, /\[input\.activeConversationAnchorId,\s*input\.activeTarget\?\.localAgentRef,\s*input\.activeThreadId\]/);
  assert.match(voiceAdapterSource, /sessionAnchorId !== activeConversationAnchorId/);
  assert.match(voiceAdapterSource, /Voice input stopped because the conversation anchor changed\./);
  assert.match(voiceAdapterSource, /cancelStream\(activeThreadId\)/);
  assert.match(voiceAdapterSource, /conversationAnchorId:\s*sessionAnchorId/);
  assert.match(voiceAdapterSource, /applyVoiceTranscriptComposerText\(\{\s*text: result\.text,\s*conversationAnchorId: sessionAnchorId,\s*\}\)/);
  assert.doesNotMatch(hostActionSubmitSource, /latestVoiceCapture\?\.conversationAnchorId === conversationAnchorId/);
  assert.match(adapterSource, /return createReadyConversationSetupState\('agent'\);/);
  assert.match(adapterSource, /const composerReady = setupState\.status === 'ready'\s+&& !isBundleLoading\s+&& !bundleError/);
  assert.match(hostActionSubmitSource, /ensureAgentConversationSubmitRouteReady/);
  assert.match(runtimeProviderSource, /case 'text-delta':/);
  assert.match(runtimeProviderSource, /feedStreamEvent\(input\.baseInput\.threadId,\s*\{\s*type:\s*'keepalive'\s*\}\)/);
  assert.doesNotMatch(runtimeProviderSource, /chat-agent-continuity|commitProviderOutcome|createAgentLocalChatContinuityAdapter/);
  assert.doesNotMatch(runtimeProviderSource, /chatAgentStoreClient\.commitTurnResult/);
  assert.doesNotMatch(runtimeProviderSource, /buildAgentLocalChatExecutionTextRequest/);
  assert.doesNotMatch(runtimeProviderSource, /runResolvedEnvelopeActions/);
  assert.match(presentationSource, /showStreamingText=\{false\}/);
  assert.match(presentationSource, /resolveAgentFooterViewState/);
  assert.match(presentationSource, /resolveAgentConversationSurfaceState/);
  assert.match(presentationSource, /resolveAgentConversationHostView/);
  assert.match(presentationSource, /resolveAgentConversationHostSnapshot/);
  assert.match(presentationSource, /resolveAgentTargetSummaries/);
  assert.match(presentationSource, /resolveAgentCanonicalMessages/);
  assert.match(presentationSource, /resolveAgentSelectedTargetId/);
  assert.match(presentationSource, /voiceState=\{resolveAgentComposerVoiceState/);
  assert.match(effectsSource, /applyDriverEffects/);
  assert.match(effectsSource, /applyHostInteractionPatch/);
  assert.match(effectsSource, /setAgentVisibleProjection\(threadId,\s*patch\.bundle\)/);
  assert.doesNotMatch(effectsSource, /setAgentVisibleProjection\(threadId,\s*null\)/);
  assert.doesNotMatch(humanAdapterSource, /voice session mode stays on/);
  assert.doesNotMatch(adapterSource, /chatAgentStoreClient\.createThread/);
  assert.doesNotMatch(adapterSource, /chatAgentStoreClient\.commitTurnResult/);
  assert.doesNotMatch(adapterSource, /matchConversationTurnEvent/);
  assert.doesNotMatch(adapterSource, /createInitialAgentSubmitDriverState/);
  assert.doesNotMatch(adapterSource, /reduceAgentSubmitDriverEvent/);
  assert.doesNotMatch(adapterSource, /resolveCompletedAgentSubmitDriverCheckpoint/);
  assert.doesNotMatch(adapterSource, /resolveInterruptedAgentSubmitDriverCheckpoint/);
  assert.doesNotMatch(adapterSource, /resolveAgentSubmitDriverProjectionRefresh/);
  assert.doesNotMatch(adapterSource, /resolveAuthoritativeAgentThreadBundle/);
  assert.doesNotMatch(adapterSource, /assertAgentTurnLifecycleCompleted/);
  assert.doesNotMatch(adapterSource, /streamState\s*&&\s*streamState\.phase === 'waiting'/);
  assert.doesNotMatch(adapterSource, /streamState\s*&&\s*\(streamState\.phase === 'waiting' \|\| streamState\.phase === 'streaming'\)/);
  assert.doesNotMatch(adapterSource, /overlayAgentAssistantVisibleState/);
  assert.doesNotMatch(adapterSource, /createInitialAgentSubmitSessionState/);
  assert.doesNotMatch(adapterSource, /reduceAgentSubmitSessionEvent/);
  assert.doesNotMatch(adapterSource, /resolveCompletedAgentSubmitSession/);
  assert.doesNotMatch(adapterSource, /resolveInterruptedAgentSubmitSession/);
  assert.doesNotMatch(adapterSource, /resolveProjectionRefreshAgentSubmitSession/);
  assert.doesNotMatch(adapterSource, /resolveCompletedAgentSubmitHostFlow/);
  assert.doesNotMatch(adapterSource, /resolveInterruptedAgentSubmitHostFlow/);
  assert.doesNotMatch(adapterSource, /resolveAgentProjectionRefreshOutcome/);
  assert.doesNotMatch(adapterSource, /resolveCompletedAgentHostInteraction/);
  assert.doesNotMatch(adapterSource, /resolveInterruptedAgentHostInteraction/);
  assert.doesNotMatch(adapterSource, /resolveProjectionRefreshAgentHostInteraction/);
  assert.doesNotMatch(adapterSource, /applyAuthoritativeBundle/);
  assert.doesNotMatch(adapterSource, /applySubmitOutcome/);
  assert.doesNotMatch(adapterSource, /if \(!refreshOutcome\.hostInteractionPatch\)/);
  assert.doesNotMatch(adapterSource, /let streamedText =/);
  assert.doesNotMatch(adapterSource, /let streamedReasoningText =/);
  assert.doesNotMatch(adapterSource, /let runtimeTraceId =/);
  assert.doesNotMatch(adapterSource, /let promptTraceId =/);
  assert.doesNotMatch(adapterSource, /let assistantVisible =/);
  assert.doesNotMatch(adapterSource, /let workingBundle =/);
  assert.doesNotMatch(adapterSource, /chatAgentStoreClient\.createMessage/);
  assert.doesNotMatch(adapterSource, /chatAgentStoreClient\.updateMessage/);
  assert.doesNotMatch(adapterSource, /relay:/);
  assert.doesNotMatch(adapterSource, /retired-authoring-runtime\//);
  assert.doesNotMatch(adapterSource, /RuntimeStatusSidebar/);
});
