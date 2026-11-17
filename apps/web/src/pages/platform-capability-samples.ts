import type { AdmittedCapability } from '../landing/generated/index.js';
import type { LandingLocale } from '../landing/i18n/locale.js';

export const PLATFORM_CAPABILITIES = {
  text: ['text.generate', 'text.embed'],
  visual: ['image.generate', 'video.generate', 'vision.locate', 'realtime.interact'],
  audio: ['audio.synthesize', 'audio.transcribe', 'music.generate', 'voice.create', 'audio.separate'],
} as const satisfies Record<string, readonly AdmittedCapability[]>;

export type CapabilityGroup = keyof typeof PLATFORM_CAPABILITIES;
export type CapabilityId = typeof PLATFORM_CAPABILITIES[CapabilityGroup][number];

type Localized = Readonly<Record<LandingLocale, string>>;

type CapabilitySample = Readonly<{
  input: Localized;
  result: Localized;
  excerpt?: { text: string; lang: LandingLocale };
  facts?: readonly { label: Localized; value: string }[];
  unavailableMedia?: 'image' | 'video' | 'audio';
}>;

// Curated scenario outputs from runtime/acceptance/model-matrix.yaml. Keep the
// exact output language and omit the media player when the original is absent.
export const CAPABILITY_SAMPLES: Readonly<Record<CapabilityId, CapabilitySample>> = {
  // macos-20261110-chatgpt-plan-sol-jpeg
  'text.generate': {
    input: { zh: '上传一张 JPEG，让模型用文字描述画面中的主要物体。', en: 'Upload a JPEG and ask the model to describe the main object.' },
    result: { zh: '模型识别出了物体的颜色、材质和形状。', en: 'The model described the object’s color, material, and shape.' },
    excerpt: { lang: 'en', text: 'The main object is a bright orange ceramic mug with a curved handle.' },
  },
  // macos-20261111-installed-nomic-gguf
  'text.embed': {
    input: { zh: '将 4 篇文档转成向量，再用一个独立查询按语义相似度排序。', en: 'Embed four documents and use a separate query to rank them by semantic similarity.' },
    result: { zh: '关于本地 AI 隐私的文档排在首位。', en: 'The document about local AI privacy ranked first.' },
    facts: [
      { label: { zh: '向量维度', en: 'Vector dimensions' }, value: '768' },
      { label: { zh: '首位余弦相似度', en: 'Top cosine similarity' }, value: '0.7590' },
    ],
  },
  // windows-20261111-minimax-h3-image
  'image.generate': {
    input: { zh: '用文字生成窗边的蓝色陶瓷杯，再以生成的图为参考，把杯子改成橙色。', en: 'Generate a blue ceramic mug beside a window, then use that image as a reference to turn the mug orange.' },
    result: { zh: 'Lab 保存了原图和编辑结果。改色后保留了杯把、构图和背景。', en: 'Lab saved the original and edited images. The edit retained the handle, framing, and background.' },
    facts: [
      { label: { zh: '输出格式', en: 'Output format' }, value: 'PNG' },
      { label: { zh: '图像尺寸', en: 'Image size' }, value: '1024 × 1024' },
    ],
    unavailableMedia: 'image',
  },
  // windows-20261111-hyperflow-and-sol
  'video.generate': {
    input: { zh: '以蓝色水面上的红色纸船为主题，分别从文字和参考图生成短片。', en: 'Generate a short clip of a red paper boat on blue water, using a text prompt and then a reference image.' },
    result: { zh: '两段短片都呈现了蓝色水面上的红色纸船。', en: 'Both clips showed the red paper boat on blue water.' },
    facts: [
      { label: { zh: '输出格式', en: 'Output format' }, value: 'MP4' },
      { label: { zh: '视频尺寸', en: 'Video size' }, value: '512 × 288' },
      { label: { zh: '时长', en: 'Duration' }, value: '0.95 s' },
    ],
    unavailableMedia: 'video',
  },
  // macos-20261111-installed-locateanything-metal
  'vision.locate': {
    input: { zh: '在一张 512 × 512 的图片中定位蓝色陶瓷杯。', en: 'Locate a blue ceramic mug in a 512 × 512 image.' },
    result: { zh: 'Lab 在原图上标出了一个点，落在杯身内。', en: 'Lab marked a point on the original image, inside the body of the mug.' },
    facts: [
      { label: { zh: '横向坐标（归一化）', en: 'Horizontal coordinate (normalized)' }, value: '0.501' },
      { label: { zh: '纵向坐标（归一化）', en: 'Vertical coordinate (normalized)' }, value: '0.655' },
    ],
    unavailableMedia: 'image',
  },
  // macos-20261110-openai-gpt-live-continuous
  'realtime.interact': {
    input: { zh: '在实时会话中连续送入一段英语录音，测试模型能否回答桌上有什么、火车何时出发。', en: 'Stream an English recording into a realtime session and ask what is on the table and when the train leaves.' },
    result: { zh: '会话收到了转写和语音输出。以下是模型回答的原文。', en: 'The session returned transcripts and speech. This is the model’s recorded response.' },
    excerpt: { lang: 'en', text: 'A green notebook is on the table, and the next train leaves at ten.' },
  },
  // macos-20261110-gemini-lite-sulafat
  'audio.synthesize': {
    input: { zh: '使用 Sulafat 音色和舒缓语气朗读中文短句。', en: 'Read a short Chinese passage in a calm tone using the Sulafat voice.' },
    result: { zh: 'Lab 播放了合成音频。转写后的原文如下。', en: 'Lab played the synthesized audio. This is the resulting transcript.' },
    excerpt: { lang: 'zh', text: '橙色的杯子放在窗边，下一班火车十点出发。' },
    facts: [
      { label: { zh: '时长', en: 'Duration' }, value: '5.68 s' },
      { label: { zh: '音频格式', en: 'Audio format' }, value: 'WAV · 24 kHz' },
    ],
    unavailableMedia: 'audio',
  },
  // macos-20261111-installed-qwen3-asr
  'audio.transcribe': {
    input: { zh: '上传一段 3.44 秒的英语 WAV 录音。', en: 'Upload a 3.44-second English WAV recording.' },
    result: { zh: '模型识别出英语，并返回了完整转写。', en: 'The model identified the language as English and returned the full transcript.' },
    excerpt: { lang: 'en', text: 'A green notebook is on the table. The next train leaves at ten.' },
  },
  // macos-20261111-installed-lyria-clip
  'music.generate': {
    input: { zh: '用文字描述想生成的一段器乐。', en: 'Describe an instrumental piece in a text prompt.' },
    result: { zh: 'Lab 生成并完整播放了一段立体声音乐。', en: 'Lab generated a stereo music clip and played it through to the end.' },
    facts: [
      { label: { zh: '时长', en: 'Duration' }, value: '30.77 s' },
      { label: { zh: '音频格式', en: 'Audio format' }, value: 'WAV · 44.1 kHz' },
    ],
    unavailableMedia: 'audio',
  },
  // macos-20261110-qwen3-voice-design
  'voice.create': {
    input: { zh: '用文字描述一种声音，再用创建出的声音朗读另一段文本。', en: 'Describe a voice in words, then use the created voice to read a new passage.' },
    result: { zh: 'Lab 创建并复用了同一声音。以下是新音频的转写。', en: 'Lab created and reused the same voice. This is the transcript of the new audio.' },
    excerpt: { lang: 'en', text: 'A green notebook is on the table. The next train leaves at 10.' },
    facts: [{ label: { zh: '朗读时长', en: 'Speech duration' }, value: '3.44 s' }],
    unavailableMedia: 'audio',
  },
  // spleeter, scoped to the historical Windows Lab run
  'audio.separate': {
    input: { zh: '在 Lab 选择一段混合音频和处理范围，分别运行双轨和四轨分离。', en: 'Choose a time range in a mixed recording and run both two-track and four-track separation.' },
    result: { zh: '两种模式都输出了等长的 WAV 音轨，保存后可在 Lab 重新打开。', en: 'Both modes produced equal-length WAV tracks that could be reopened in Lab.' },
    facts: [
      { label: { zh: '输出轨数', en: 'Output tracks' }, value: '2 / 4' },
      { label: { zh: '输出格式', en: 'Output format' }, value: 'WAV' },
    ],
    unavailableMedia: 'audio',
  },
};
