import type { CSSProperties } from 'react';
import { PROVIDER_LOGO_SVG, type ProviderLogoKey } from '../assets/provider-logos.js';
import { IdentityTile, type IdentityTileSize } from './identity-tile.js';

/**
 * Brand logo for a cloud provider id from the runtime provider registry.
 * Monochrome marks use `currentColor`, so they follow the theme's text color
 * on light and dark surfaces; full-color marks carry their own palette. A
 * provider without a mark (first-party `nimillm`, `openai_compatible`, niche
 * media vendors) falls back to the deterministic IdentityTile.
 */
const PROVIDER_LOGO_KEY: Readonly<Record<string, ProviderLogoKey>> = Object.freeze({
  anthropic: 'anthropic',
  aws_polly: 'aws-color',
  azure: 'azure-color',
  azure_speech: 'azure-color',
  bedrock: 'bedrock-color',
  cohere: 'cohere-color',
  dashscope: 'alibabacloud-color',
  deepseek: 'deepseek-color',
  elevenlabs: 'elevenlabs',
  fireworks: 'fireworks-color',
  fish_audio: 'fishaudio',
  flux: 'flux',
  gemini: 'gemini-color',
  glm: 'zhipu-color',
  google_cloud_tts: 'googlecloud-color',
  google_veo: 'google-color',
  groq: 'groq',
  hunyuan: 'hunyuan-color',
  ideogram: 'ideogram',
  kimi: 'kimi',
  kling: 'kling-color',
  luma: 'luma-color',
  mimo: 'xiaomimimo',
  minimax: 'minimax-color',
  mistral: 'mistral-color',
  openai: 'openai',
  openai_codex: 'codex-color',
  openrouter: 'openrouter-color',
  perplexity: 'perplexity-color',
  pika: 'pika',
  qianfan: 'baiducloud-color',
  runway: 'runway',
  siliconflow: 'siliconcloud-color',
  spark: 'spark-color',
  spark_reasoning: 'spark-color',
  stability: 'stability-color',
  stepfun: 'stepfun-color',
  together: 'together-color',
  volcengine: 'volcengine-color',
  volcengine_openspeech: 'volcengine-color',
  xai: 'xai',
});

/**
 * Brand logo for a model maker, keyed by its lowercase Hugging Face
 * organization. Makers that also run a cloud service reuse that service's mark
 * so one company looks the same across Desktop.
 */
const MODEL_MAKER_LOGO_KEY: Readonly<Record<string, ProviderLogoKey>> = Object.freeze({
  allenai: 'ai2-color',
  baidu: 'baidu-color',
  'black-forest-labs': 'bfl',
  bytedance: 'bytedance-color',
  'bytedance-seed': 'bytedance-color',
  cohereforai: 'cohere-color',
  coherelabs: 'cohere-color',
  'deepseek-ai': 'deepseek-color',
  facebook: 'meta-color',
  funaudiollm: 'alibabacloud-color',
  google: 'google-color',
  huggingfacetb: 'huggingface-color',
  'ibm-granite': 'ibm',
  inclusionai: 'antgroup-color',
  indexteam: 'bilibiliindex',
  internlm: 'internlm-color',
  lightricks: 'lightricks',
  liquidai: 'liquid',
  'meta-llama': 'meta-color',
  microsoft: 'microsoft-color',
  minimaxai: 'minimax-color',
  mistralai: 'mistral-color',
  moonshotai: 'kimi',
  nvidia: 'nvidia-color',
  openai: 'openai',
  qwen: 'qwen-color',
  runwayml: 'runway',
  stabilityai: 'stability-color',
  'stepfun-ai': 'stepfun-color',
  tencent: 'hunyuan-color',
  thudm: 'zhipu-color',
  'tongyi-mai': 'alibabacloud-color',
  'wan-ai': 'alibabacloud-color',
  'xai-org': 'xai',
  xiaomimimo: 'xiaomimimo',
  'zai-org': 'zhipu-color',
});

/**
 * Brand logo for a model family in the verified local catalog ("Nimi 收录"),
 * keyed by the leading words of its display name. The catalog's repos point
 * at repackaged weights (unsloth, leejet, audio-cpp), so the maker is read
 * from the model name itself; a family without a bundled mark keeps its
 * deterministic IdentityTile.
 */
const LOCAL_MODEL_FAMILY_LOGO_KEY: Readonly<Record<string, ProviderLogoKey>> = Object.freeze({
  citrinet: 'nvidia-color',
  demucs: 'meta-color',
  'fish audio': 'fishaudio',
  'fun asr': 'alibabacloud-color',
  gemma: 'google-color',
  glm: 'zhipu-color',
  htdemucs: 'meta-color',
  ideogram: 'ideogram',
  indextts: 'bilibiliindex',
  locateanything: 'nvidia-color',
  minimax: 'minimax-color',
  nemotron: 'nvidia-color',
  parakeet: 'nvidia-color',
  qwen: 'qwen-color',
  sensevoice: 'alibabacloud-color',
  vibevoice: 'microsoft-color',
  voxtral: 'mistral-color',
  whisper: 'openai',
  'z image': 'alibabacloud-color',
});

/**
 * Brand key for a local catalog model display name ("Qwen3 TTS Base" → Qwen),
 * matched on the leading words so sizes and engine tags never matter; digits
 * still count as a boundary, so "IndexTTS2" matches "indextts" while
 * "Llama-OuteTTS" never matches a "llama" brand.
 */
export function modelFamilyLogoKey(name: string): ProviderLogoKey | null {
  const normalized = name.trim().toLowerCase().replace(/[-_/]+/gu, ' ').replace(/\s+/gu, ' ');
  for (const [family, key] of Object.entries(LOCAL_MODEL_FAMILY_LOGO_KEY)) {
    if (normalized === family || (normalized.startsWith(family) && !/[a-z]/u.test(normalized.charAt(family.length)))) {
      return key;
    }
  }
  return null;
}

const TILE_CLASS = Object.freeze({
  xs: 'size-6 rounded-md',
  sm: 'size-8 rounded-lg',
  md: 'size-10 rounded-xl',
  lg: 'size-12 rounded-2xl',
} as const);

const MARK_CLASS = Object.freeze({
  xs: 'size-3.5',
  sm: 'size-[18px]',
  md: 'size-[22px]',
  lg: 'size-7',
} as const);

const TILE_STYLE: CSSProperties = {
  background: '#ffffff',
  color: '#1f1f1f',
  boxShadow: 'inset 0 0 0 1px var(--nimi-border-subtle)',
};

function providerLogoMarkup(provider: string): string | null {
  const key = PROVIDER_LOGO_KEY[provider.trim().toLowerCase()];
  return key ? PROVIDER_LOGO_SVG[key] : null;
}

export function hasProviderLogo(provider: string): boolean {
  return providerLogoMarkup(provider) !== null;
}

function LogoMarkTile({
  markup,
  size,
  className,
  attributes,
}: {
  readonly markup: string;
  readonly size: IdentityTileSize;
  readonly className: string;
  readonly attributes: Readonly<Record<`data-${string}`, string>>;
}) {
  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex shrink-0 select-none items-center justify-center ${TILE_CLASS[size]} ${className}`}
      style={TILE_STYLE}
      {...attributes}
    >
      <span className={`inline-flex [&>svg]:size-full ${MARK_CLASS[size]}`} dangerouslySetInnerHTML={{ __html: markup }} />
    </span>
  );
}

export function ProviderLogoTile({
  provider,
  label,
  size = 'md',
  className = '',
}: {
  /** Runtime provider id (`anthropic`, `fish_audio`, …) or connector vendor. */
  readonly provider: string;
  /** Human label; used for the fallback monogram. */
  readonly label: string;
  readonly size?: IdentityTileSize;
  readonly className?: string;
}) {
  const markup = providerLogoMarkup(provider);
  if (!markup) {
    return <IdentityTile seed={provider} label={label} size={size} className={className} />;
  }
  return (
    <LogoMarkTile
      markup={markup}
      size={size}
      className={className}
      attributes={{ 'data-provider-logo': provider.trim().toLowerCase() }}
    />
  );
}

/**
 * Brand logo for a verified local catalog model ("Nimi 收录"), resolved from
 * its display name; a name without a bundled mark keeps its deterministic
 * IdentityTile monogram.
 */
export function ModelFamilyLogoTile({
  name,
  seed,
  label,
  size = 'md',
  className = '',
}: {
  /** Display name of the model (for a part, of the model it serves). */
  readonly name: string;
  /** IdentityTile hue seed when no brand mark exists. */
  readonly seed: string;
  /** IdentityTile monogram label when no brand mark exists. */
  readonly label: string;
  readonly size?: IdentityTileSize;
  readonly className?: string;
}) {
  const logo = modelFamilyLogoKey(name);
  if (!logo) {
    return <IdentityTile seed={seed} label={label} size={size} className={className} />;
  }
  return (
    <LogoMarkTile
      markup={PROVIDER_LOGO_SVG[logo]}
      size={size}
      className={className}
      attributes={{ 'data-model-family-logo': logo }}
    />
  );
}

/**
 * Brand logo for the organization that made a model; an organization without
 * a mark falls back to its deterministic IdentityTile monogram.
 */
export function ModelMakerLogoTile({
  maker,
  size = 'md',
  className = '',
}: {
  /** Hugging Face organization, e.g. `Qwen` or `meta-llama`. */
  readonly maker: string;
  readonly size?: IdentityTileSize;
  readonly className?: string;
}) {
  const org = maker.trim();
  const logo = MODEL_MAKER_LOGO_KEY[org.toLowerCase()];
  if (!logo) {
    return <IdentityTile seed={org} label={org} size={size} className={className} />;
  }
  return (
    <LogoMarkTile
      markup={PROVIDER_LOGO_SVG[logo]}
      size={size}
      className={className}
      attributes={{ 'data-model-maker-logo': logo }}
    />
  );
}
