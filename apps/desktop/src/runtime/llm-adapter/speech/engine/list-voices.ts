import type { ProviderType } from '../../types';
import type { SpeechVoiceDescriptor } from '../types';
import { inferVoiceLang, isOpenAiCompatibleProvider, withV1Endpoint } from './shared';

export type ListVoicesInput = {
  providerType?: ProviderType;
  endpoint?: string;
  apiKey?: string;
  providerId?: string;
};

export async function listSpeechVoices(input?: ListVoicesInput): Promise<SpeechVoiceDescriptor[]> {
  const providerId = String(input?.providerId || 'openai-compatible').trim() || 'openai-compatible';

  if (input?.providerType === 'DASHSCOPE_COMPATIBLE') {
    const pid = 'dashscope-compatible';
    return [
      { id: 'Cherry', providerId: pid, name: '芊悦 · 阳光亲切女声', langs: ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'ru', 'it', 'es', 'pt'] },
      { id: 'Serena', providerId: pid, name: '苏瑶 · 温柔女声', langs: ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'ru', 'it', 'es', 'pt'] },
      { id: 'Ethan', providerId: pid, name: '晨煦 · 阳光温暖男声', langs: ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'ru', 'it', 'es', 'pt'] },
      { id: 'Chelsie', providerId: pid, name: '千雪 · 二次元女声', langs: ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'ru', 'it', 'es', 'pt'] },
      { id: 'Momo', providerId: pid, name: '茉兔 · 撒娇搞怪女声', langs: ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'ru', 'it', 'es', 'pt'] },
      { id: 'Vivian', providerId: pid, name: '十三 · 可爱小暴躁女声', langs: ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'ru', 'it', 'es', 'pt'] },
      { id: 'Moon', providerId: pid, name: '月白 · 率性帅气男声', langs: ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'ru', 'it', 'es', 'pt'] },
      { id: 'Maia', providerId: pid, name: '四月 · 知性温柔女声', langs: ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'ru', 'it', 'es', 'pt'] },
      { id: 'Kai', providerId: pid, name: '凯 · 耳朵SPA男声', langs: ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'ru', 'it', 'es', 'pt'] },
      { id: 'Nofish', providerId: pid, name: '不吃鱼 · 设计师男声', langs: ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'ru', 'it', 'es', 'pt'] },
    ];
  }

  if (input?.providerType === 'VOLCENGINE_COMPATIBLE') {
    return [
      { id: 'BV001_streaming', providerId: 'volcengine-compatible', name: '通用女声', lang: 'zh' },
      { id: 'BV002_streaming', providerId: 'volcengine-compatible', name: '通用男声', lang: 'zh' },
    ];
  }

  const fallbackItems: SpeechVoiceDescriptor[] = [
    { id: 'alloy', providerId, name: 'Alloy', lang: 'en' },
    { id: 'nova', providerId, name: 'Nova', lang: 'en' },
    { id: 'shimmer', providerId, name: 'Shimmer', lang: 'en' },
  ];

  if (!input?.endpoint) return fallbackItems;
  if (input.providerType && !isOpenAiCompatibleProvider(input.providerType)) {
    return fallbackItems;
  }

  const headers: Record<string, string> = {};
  if (input.apiKey) headers.Authorization = `Bearer ${input.apiKey}`;

  try {
    const response = await fetch(`${withV1Endpoint(input.endpoint)}/audio/voices`, {
      method: 'GET',
      headers,
    });
    if (!response.ok) return fallbackItems;
    const payload = await response.json().catch(() => ({}));
    const voices = Array.isArray((payload as { voices?: unknown[] }).voices)
      ? ((payload as { voices?: unknown[] }).voices as unknown[])
          .map((item) => String(item || '').trim())
          .filter(Boolean)
      : [];
    if (voices.length === 0) return fallbackItems;
    return voices.map((id) => ({
      id,
      providerId,
      name: id,
      lang: inferVoiceLang(id),
    }));
  } catch {
    return fallbackItems;
  }
}
