import type {
  SpeechProviderDescriptor,
  SpeechVoiceDescriptor,
} from '../../llm-adapter/speech/types.js';
import { createHookRecord } from './utils.js';
import {
  closeSpeechStream,
  controlSpeechStream,
  openSpeechStream,
} from './speech/stream.js';
import { synthesizeModSpeech } from './speech/synthesize.js';
import {
  normalizeSpeechProviderId,
} from './speech/types.js';
import type {
  SpeechProvidersInput,
  SpeechProvidersResult,
  SpeechServiceInput,
  SpeechSynthesizeInput,
  SpeechSynthesizeResultPayload,
  SpeechStreamCloseInput,
  SpeechStreamControlInput,
  SpeechStreamOpenInput,
  SpeechVoicesInput,
  SpeechVoicesResult,
} from './speech/types.js';

export type {
  SpeechProvidersResult,
  SpeechVoicesResult,
  SpeechSynthesizeResultPayload,
  SpeechServiceInput,
} from './speech/types.js';

type SpeechStreamOpenResultPayload = {
  streamId: string;
  eventTopic: string;
  format: 'mp3' | 'wav' | 'opus' | 'pcm';
  sampleRateHz: number;
  channels: number;
  providerTraceId?: string;
};

export class HookRuntimeSpeechService {
  constructor(private readonly context: SpeechServiceInput) {}

  private mapVoice(voice: SpeechVoiceDescriptor): SpeechVoicesResult {
    return {
      id: voice.id,
      providerId: normalizeSpeechProviderId(voice.providerId),
      name: voice.name,
      lang: voice.lang,
      langs: voice.langs,
      sampleAudioUri: voice.sampleAudioUri,
    };
  }

  async listSpeechProviders(input: SpeechProvidersInput): Promise<SpeechProvidersResult[]> {
    const startedAt = Date.now();
    const permission = this.context.evaluatePermission({
      modId: input.modId,
      sourceType: input.sourceType,
      hookType: 'llm',
      target: 'llm.speech.providers.list',
      capabilityKey: 'llm.speech.providers.list',
      startedAt,
    });

    this.context.audit.append(createHookRecord({
      modId: input.modId,
      hookType: 'llm',
      target: 'llm.speech.providers.list',
      decision: 'ALLOW',
      reasonCodes: permission.reasonCodes,
      startedAt,
    }));

    return this.context.speechEngine.listProviders().map((provider: SpeechProviderDescriptor) => ({
      id: provider.id,
      name: provider.name,
      status: provider.status,
      capabilities: provider.capabilities,
      voiceCount: provider.voiceCount,
      ownerModId: provider.ownerModId,
    }));
  }

  async listSpeechVoices(input: SpeechVoicesInput): Promise<SpeechVoicesResult[]> {
    const startedAt = Date.now();
    const permission = this.context.evaluatePermission({
      modId: input.modId,
      sourceType: input.sourceType,
      hookType: 'llm',
      target: 'llm.speech.voices.list',
      capabilityKey: 'llm.speech.voices.list',
      startedAt,
    });

    this.context.audit.append(createHookRecord({
      modId: input.modId,
      hookType: 'llm',
      target: 'llm.speech.voices.list',
      decision: 'ALLOW',
      reasonCodes: permission.reasonCodes,
      startedAt,
    }));

    try {
      const resolved = await this.context.resolveRoute({
        modId: input.modId,
        providerId: input.providerId,
        routeSource: input.routeSource,
        connectorId: input.connectorId,
        model: input.model,
      });
      const endpoint = String(resolved?.localProviderEndpoint || resolved?.localOpenAiEndpoint || '').trim();
      const voices = await this.context.speechEngine.listVoices({
        providerId: normalizeSpeechProviderId(input.providerId || resolved?.provider || 'openai-compatible'),
        model: resolved?.model,
        routeSource: resolved?.source,
        connectorId: resolved?.connectorId,
        providerEndpoint: endpoint,
      });
      return voices.map((voice) => this.mapVoice(voice));
    } catch {
      const fallback = await this.context.speechEngine.listVoices({
        providerId: normalizeSpeechProviderId(input.providerId || 'openai-compatible'),
      });
      return fallback.map((voice) => this.mapVoice(voice));
    }
  }

  synthesizeModSpeech(input: SpeechSynthesizeInput): Promise<SpeechSynthesizeResultPayload> {
    return synthesizeModSpeech(this.context, input);
  }

  openSpeechStream(input: SpeechStreamOpenInput): Promise<SpeechStreamOpenResultPayload> {
    return openSpeechStream(this.context, input);
  }

  controlSpeechStream(input: SpeechStreamControlInput): Promise<{ ok: boolean }> {
    return controlSpeechStream(this.context, input);
  }

  closeSpeechStream(input: SpeechStreamCloseInput): Promise<{ ok: boolean }> {
    return closeSpeechStream(this.context, input);
  }
}
