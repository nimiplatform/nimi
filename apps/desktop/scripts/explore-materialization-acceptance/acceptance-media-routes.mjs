import { randomUUID } from 'node:crypto';
import { withNimiRuntimeIdempotencyMetadata } from '@nimiplatform/sdk/runtime';
import { ConnectorAuthKind } from '@nimiplatform/sdk/runtime/wire-types';

const imageModelId = 'gpt-image-1.5';
const transcriptionModelId = 'gpt-4o-mini-transcribe-runtime-live';
const voiceModelId = 'qwen3-tts-runtime-live-native-stream';

function options(scope) {
  return withNimiRuntimeIdempotencyMetadata({}, `local-agent-product:${scope}:${randomUUID()}`);
}

function requireModel(models, modelId, capability) {
  const model = (models || []).find((candidate) => candidate?.providerModelId === modelId
    && (candidate.capabilities || []).includes(capability));
  if (!model?.remoteModelCatalogId) throw new Error(`deterministic ${capability} connector model is unavailable: ${modelId}`);
  return model;
}

function targetRef(connectorId, model, provider) {
  return {
    kind: 'cloud-connector',
    version: 'v2',
    connectorId,
    remoteModelCatalogId: model.remoteModelCatalogId,
    providerModelId: model.providerModelId,
    provider: model.provider || provider,
  };
}

export async function createDeterministicMediaRoutes(runtime, providerBaseUrl) {
  const openAI = await runtime.connectors.createConnector({
    provider: 'openai',
    endpoint: providerBaseUrl,
    label: 'LocalAgent product Journey image and transcription fixture',
    apiKey: 'local-agent-product-openai-fixture-key',
    authKind: ConnectorAuthKind.API_KEY,
    providerAuthProfile: '',
    credentialJson: '',
  }, options('create-openai-media-connector'));
  const openAIConnectorId = String(openAI.connector?.connectorId || '').trim();
  if (!openAIConnectorId) throw new Error('deterministic OpenAI media connector returned no id');
  const openAIModels = await runtime.connectors.listConnectorModels({
    connectorId: openAIConnectorId,
    forceRefresh: false,
    pageSize: 200,
    pageToken: '',
  }, options('list-openai-media-models'));
  const imageModel = requireModel(openAIModels.models, imageModelId, 'image.generate');
  const transcriptionModel = requireModel(openAIModels.models, transcriptionModelId, 'audio.transcribe');

  const voice = await runtime.connectors.createConnector({
    provider: 'dashscope',
    endpoint: providerBaseUrl,
    label: 'LocalAgent product Journey native voice fixture',
    apiKey: 'local-agent-product-dashscope-fixture-key',
    authKind: ConnectorAuthKind.API_KEY,
    providerAuthProfile: '',
    credentialJson: '',
  }, options('create-voice-connector'));
  const voiceConnectorId = String(voice.connector?.connectorId || '').trim();
  if (!voiceConnectorId) throw new Error('deterministic voice connector returned no id');
  const voiceModels = await runtime.connectors.listConnectorModels({
    connectorId: voiceConnectorId,
    forceRefresh: false,
    pageSize: 200,
    pageToken: '',
  }, options('list-voice-models'));
  const voiceModel = requireModel(voiceModels.models, voiceModelId, 'audio.synthesize');

  return {
    image: { route: 'cloud', modelId: imageModelId, connectorId: openAIConnectorId, targetRef: targetRef(openAIConnectorId, imageModel, 'openai') },
    transcription: { route: 'cloud', modelId: transcriptionModelId, connectorId: openAIConnectorId, targetRef: targetRef(openAIConnectorId, transcriptionModel, 'openai') },
    voice: { route: 'cloud', modelId: voiceModelId, connectorId: voiceConnectorId, targetRef: targetRef(voiceConnectorId, voiceModel, 'dashscope') },
  };
}

export async function applyDeterministicMediaRoutes({ agentClient, identity, routes, baseIntents = null }) {
  const current = await agentClient.agentAIConfig.get(identity);
  const intents = { ...(baseIntents || current.intents) };
  intents['image.generate'] = routes.image;
  intents['audio.transcribe'] = routes.transcription;
  intents['audio.synthesize'] = routes.voice;
  return agentClient.agentAIConfig.upsert({
    ...identity,
    expectedRevision: current.revision,
    intents,
  });
}
