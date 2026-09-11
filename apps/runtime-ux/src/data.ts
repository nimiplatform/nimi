export type PresetId = 'quality' | 'balanced' | 'private';

export type Preset = {
  id: PresetId;
  name: string;
  tagline: string;
  recommended?: boolean;
  confirmLines: string[];
  appliedSummary: string;
};

export const presets: Preset[] = [
  {
    id: 'quality',
    name: 'Best quality',
    tagline: 'Uses cloud services. Strongest answers, costs per use, data leaves this device.',
    confirmLines: [
      'Chat answers via GPT-5 (cloud)',
      'Images created by a cloud image model',
      'Memory search runs in the cloud',
    ],
    appliedSummary:
      'Best quality is active. Chat answers via GPT-5 in the cloud, images and memory search use cloud services too. Usage is billed per request.',
  },
  {
    id: 'balanced',
    name: 'Balanced',
    tagline: 'Cloud for hard questions, local for the rest.',
    recommended: true,
    confirmLines: [
      'Everyday chat answers on this device; hard questions go to Claude (cloud)',
      'Images created on this device',
      'Memory search stays on this device',
    ],
    appliedSummary:
      'Balanced is active. Everyday chat runs on this device; hard questions go to Claude (cloud). Images and memory search stay local.',
  },
  {
    id: 'private',
    name: 'Private & free',
    tagline: 'Everything runs on this device. No cost, fully private, needs downloads.',
    confirmLines: [
      'Chat answers via Qwen3 8B (this device)',
      'Images created by SDXL Turbo (this device)',
      'Memory search via BGE-M3 (this device)',
    ],
    appliedSummary:
      'Private & free is active. Everything — chat, images, memory search — runs on this device. Nothing leaves it and nothing is billed.',
  },
];

export type Service = {
  id: string;
  name: string;
  kind: 'API key' | 'OAuth';
  status: 'connected' | 'action-needed' | 'not-configured';
  detail: string;
  models: string[];
};

export const services: Service[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'API key',
    status: 'connected',
    detail: 'Key ending in ••••4f2a, verified 2 hours ago.',
    models: ['gpt-5', 'gpt-5-mini', 'text-embedding-3-large'],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    kind: 'OAuth',
    status: 'connected',
    detail: 'Signed in as nimi@example.com.',
    models: ['claude-sonnet-4', 'claude-haiku-4'],
  },
  {
    id: 'google',
    name: 'Google Gemini',
    kind: 'API key',
    status: 'action-needed',
    detail: 'Last test failed: 401 unauthorized. The key may have been rotated.',
    models: [],
  },
];

export type InstalledModel = {
  id: string;
  name: string;
  capability: 'Chat' | 'Image' | 'Embedding';
  size: string;
  status: 'ready' | 'downloading' | 'error';
  progress?: number;
  source: string;
};

export const installedModels: InstalledModel[] = [
  { id: 'qwen3-8b', name: 'Qwen3 8B Instruct', capability: 'Chat', size: '5.2 GB', status: 'ready', source: 'Model catalog' },
  { id: 'sdxl-turbo', name: 'SDXL Turbo', capability: 'Image', size: '6.9 GB', status: 'ready', source: 'Imported file' },
  { id: 'bge-m3', name: 'BGE-M3', capability: 'Embedding', size: '1.2 GB', status: 'ready', source: 'Model catalog' },
  { id: 'llama31-70b', name: 'Llama 3.1 70B', capability: 'Chat', size: '42 GB', status: 'downloading', progress: 63, source: 'Model catalog' },
];

export type CatalogModel = {
  id: string;
  name: string;
  capability: 'Chat' | 'Image' | 'Embedding';
  size: string;
  downloads: string;
  description: string;
  installed?: boolean;
};

export const catalogModels: CatalogModel[] = [
  { id: 'qwen3-8b', name: 'Qwen3 8B Instruct', capability: 'Chat', size: '5.2 GB', downloads: '2.1M', description: 'Strong general chat model, runs well on 8 GB VRAM.', installed: true },
  { id: 'qwen3-14b', name: 'Qwen3 14B', capability: 'Chat', size: '9.1 GB', downloads: '1.1M', description: 'A noticeable step up in reasoning over the 8B.' },
  { id: 'llama31-70b', name: 'Llama 3.1 70B', capability: 'Chat', size: '42 GB', downloads: '3.4M', description: 'Frontier-class open weights. Needs serious hardware.' },
  { id: 'sdxl-turbo', name: 'SDXL Turbo', capability: 'Image', size: '6.9 GB', downloads: '1.7M', description: 'One-step image generation, near real-time.', installed: true },
  { id: 'flux-schnell', name: 'FLUX.1 schnell', capability: 'Image', size: '23 GB', downloads: '1.2M', description: 'High-quality open image generation.' },
  { id: 'bge-m3', name: 'BGE-M3', capability: 'Embedding', size: '1.2 GB', downloads: '640K', description: 'Multilingual embedding for memory and search.', installed: true },
  { id: 'nomic-embed', name: 'Nomic Embed v1.5', capability: 'Embedding', size: '0.8 GB', downloads: '410K', description: 'Lightweight embedding model for local retrieval.' },
];

export type Capability = 'Chat' | 'Image' | 'Embedding';

export type RoutePlan = {
  id: string;
  name: string;
  recommended?: boolean;
  current?: boolean;
  routes: { capability: Capability; target: string; via: 'This device' | 'Cloud' }[];
  note: string;
};

export const routePlans: Record<Capability, { current: RoutePlan; recommended: RoutePlan[] }> = {
  Chat: {
    current: {
      id: 'chat-current',
      name: 'Current routing',
      current: true,
      routes: [{ capability: 'Chat', target: 'GPT-5', via: 'Cloud' }],
      note: 'Every chat question goes to OpenAI. Nothing answers if the connection fails.',
    },
    recommended: [
      {
        id: 'chat-local-first',
        name: 'Local first',
        recommended: true,
        routes: [{ capability: 'Chat', target: 'Qwen3 8B Instruct', via: 'This device' }],
        note: 'Private and offline. Uses the model you already installed.',
      },
      {
        id: 'chat-quality',
        name: 'Best quality',
        routes: [{ capability: 'Chat', target: 'claude-sonnet-4', via: 'Cloud' }],
        note: 'Highest answer quality through your Anthropic connection.',
      },
    ],
  },
  Image: {
    current: {
      id: 'image-current',
      name: 'Current routing',
      current: true,
      routes: [{ capability: 'Image', target: 'SDXL Turbo', via: 'This device' }],
      note: 'Images are created locally with SDXL Turbo.',
    },
    recommended: [
      {
        id: 'image-quality',
        name: 'Higher quality',
        recommended: true,
        routes: [{ capability: 'Image', target: 'FLUX.1 schnell', via: 'This device' }],
        note: 'Installs FLUX.1 schnell (23 GB) and routes image requests to it.',
      },
    ],
  },
  Embedding: {
    current: {
      id: 'embed-current',
      name: 'Current routing',
      current: true,
      routes: [{ capability: 'Embedding', target: 'BGE-M3', via: 'This device' }],
      note: 'Memory search runs fully on this device.',
    },
    recommended: [
      {
        id: 'embed-cloud',
        name: 'Cloud embeddings',
        routes: [{ capability: 'Embedding', target: 'text-embedding-3-large', via: 'Cloud' }],
        note: 'Offloads memory search to OpenAI. Memory content leaves this device.',
      },
    ],
  },
};

export type Personality = {
  id: string;
  name: string;
  description: string;
  origin: 'Recommended' | 'Mine';
  active?: boolean;
  color: string;
};

export const personalities: Personality[] = [
  { id: 'companion', name: 'Companion', description: 'Warm conversational tone, patient explanations.', origin: 'Recommended', active: true, color: '#2f6fed' },
  { id: 'coder', name: 'Coding Assistant', description: 'Precise, terse, assumes technical context.', origin: 'Recommended', color: '#7c5cd6' },
  { id: 'artist', name: 'Image Studio', description: 'Visual-first, helps craft image prompts.', origin: 'Recommended', color: '#d6695c' },
  { id: 'my-daily', name: 'My daily driver', description: 'Forked from Companion, tweaked memory retention.', origin: 'Mine', color: '#1f9d63' },
];

export type ActivityEntry = {
  time: string;
  tone: 'success' | 'warning' | 'danger';
  message: string;
};

export const activityLog: ActivityEntry[] = [
  { time: '14:02:11', tone: 'danger', message: 'A chat answer failed: Google Gemini returned 401 (unauthorized).' },
  { time: '14:02:10', tone: 'success', message: 'Retry answered via Anthropic claude-sonnet-4 instead.' },
  { time: '13:58:44', tone: 'success', message: 'Download completed: BGE-M3 (1.2 GB).' },
  { time: '13:41:02', tone: 'warning', message: 'Disk space below 20 GB on model storage volume.' },
  { time: '13:12:37', tone: 'success', message: 'Connection test passed: OpenAI (3 models reachable).' },
  { time: '12:55:19', tone: 'success', message: 'Personality switched to "Companion".' },
];

export type AccessToken = {
  id: string;
  agent: string;
  scopes: string;
  created: string;
  lastUsed: string;
};

export const accessTokens: AccessToken[] = [
  { id: 'tok_7f3a', agent: 'coding-agent', scopes: 'chat, memory.read', created: '2026-03-02', lastUsed: '2 min ago' },
  { id: 'tok_91bc', agent: 'home-assistant', scopes: 'chat, image', created: '2026-01-18', lastUsed: '3 days ago' },
];

export const usageSummary = {
  tokens: '1.2M',
  cost: '$4.32',
  images: '340',
};

export const usageByService = [
  { service: 'OpenAI — GPT-5', amount: '812K tokens', cost: '$3.87' },
  { service: 'Anthropic — claude-sonnet-4', amount: '96K tokens', cost: '$0.45' },
  { service: 'This device (local models)', amount: '390K tokens · 340 images', cost: '$0.00' },
];
