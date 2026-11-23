import type { LandingLocale } from '../landing/i18n/locale.js';

export const PLATFORM_CAPABILITIES = {
  text: ['text.generate', 'text.embed', 'text.decide', 'text.annotate'],
  visual: [
    'image.generate',
    'image.upscale',
    'image.face_swap',
    'vision.locate',
    'video.generate',
    'video.upscale',
    'video.face_swap',
  ],
  audio: [
    'audio.synthesize',
    'audio.transcribe',
    'voice.create',
    'audio.speaker.embed',
    'audio.separate',
    'audio.voice.convert',
    'music.generate',
    'music.transcribe',
  ],
  realtime: ['realtime.interact'],
} as const;

export type CapabilityGroup = keyof typeof PLATFORM_CAPABILITIES;
export type CapabilityId = typeof PLATFORM_CAPABILITIES[CapabilityGroup][number];

type Localized = Readonly<Record<LandingLocale, string>>;

export type CapabilityAppRef = Readonly<{
  name: Localized;
  icon: string;
}>;

export type CapabilitySample = Readonly<{
  tagline: Localized;
  diagramIn: Localized;
  diagramOut: Localized;
  sampleKind: 'lab' | 'runtime';
  useCase?: Localized;
  input: Localized;
  result: Localized;
  facts?: readonly { label: Localized; value: string | Localized }[];
  usedApps: readonly CapabilityAppRef[];
}>;

const APP_ZHIYU: CapabilityAppRef = { name: { zh: '织羽', en: 'Zhiyu' }, icon: '/demo/zhiyu-icon.png' };
const APP_VANE: CapabilityAppRef = { name: { zh: 'Vane', en: 'Vane' }, icon: '/demo/vane-icon.png' };
const APP_VIDEOLINGO: CapabilityAppRef = { name: { zh: 'VideoLingo', en: 'VideoLingo' }, icon: '/demo/videolingo-icon.png' };
const APP_VOICESTUDIO: CapabilityAppRef = { name: { zh: 'VoiceStudio', en: 'VoiceStudio' }, icon: '/demo/voicestudio-icon.png' };
const APP_OVERTONE: CapabilityAppRef = { name: { zh: 'Overtone', en: 'Overtone' }, icon: '/demo/overtone-icon.png' };
const APP_OPENMONTAGE: CapabilityAppRef = { name: { zh: 'OpenMontage', en: 'OpenMontage' }, icon: '/demo/openmontage-icon.png' };
const APP_MONEYPRINTER: CapabilityAppRef = { name: { zh: 'MoneyPrinter', en: 'MoneyPrinter' }, icon: '/demo/moneyprinter-icon.png' };
const APP_OPENWHISPR: CapabilityAppRef = { name: { zh: 'OpenWhispr', en: 'OpenWhispr' }, icon: '/demo/openwhispr-icon.png' };
const APP_ODDBUREAU: CapabilityAppRef = { name: { zh: '奇物局', en: 'Odd Bureau' }, icon: '/demo/odd-bureau-icon.png' };
const APP_PERSONA: CapabilityAppRef = { name: { zh: 'Persona Studio', en: 'Persona Studio' }, icon: '/demo/persona-studio-icon.png' };
const APP_POLYAGENT: CapabilityAppRef = { name: { zh: 'PolyAgent', en: 'PolyAgent' }, icon: '/demo/polyagent-icon.png' };
const APP_NOTEBOOK: CapabilityAppRef = { name: { zh: 'Open Notebook', en: 'Open Notebook' }, icon: '/demo/open-notebook-icon.png' };
const APP_PARENTOS: CapabilityAppRef = { name: { zh: 'ParentOS', en: 'ParentOS' }, icon: '/demo/parentos-icon.png' };

export const CAPABILITY_SAMPLES: Readonly<Record<CapabilityId, CapabilitySample>> = {
  'text.generate': {
    tagline: {
      zh: '同时看懂图片、音视频与长文，自带深度推理、严格 JSON 输出与 64 路工具调用',
      en: 'Reads images, audio, video, and text—with reasoning chains, strict JSON, and up to 64 tools',
    },
    diagramIn: { zh: '图片 / 音视频 / 提问', en: 'Photo / Media / Prompt' },
    diagramOut: { zh: '流式回答与工具调用', en: 'Streamed Reply & JSON' },
    sampleKind: 'lab',
    input: {
      zh: '拍一张桌面照片发给应用，让它直接看图描述杯子的材质与细节。',
      en: 'Send a desk photo and ask for a natural description of the main object.',
    },
    result: {
      zh: '准确认出橙色陶瓷马克杯的色彩、釉面质感与弧形杯把。',
      en: 'Accurately identified the ceramic mug’s bright orange glaze and curved handle.',
    },
    usedApps: [APP_ZHIYU, APP_VANE, APP_NOTEBOOK],
  },
  'text.embed': {
    tagline: {
      zh: '不靠死板关键词——把长年累月的笔记与对话变成秒级召回的「语义记忆」',
      en: 'Turns years of notes and chats into instant semantic recall beyond keyword matching',
    },
    diagramIn: { zh: '4 篇日常笔记与提问', en: '4 Notes & Plain Query' },
    diagramOut: { zh: '按意思精准排序结果', en: 'Ranked Semantic Match' },
    sampleKind: 'lab',
    input: {
      zh: '导入 4 篇不同主题的资料，用一句大白话提问，找出意思最贴近的一篇。',
      en: 'Index four documents and search in plain language to find the closest match.',
    },
    result: {
      zh: '即使没有完全相同的字眼，探讨本地隐私的笔记依然以最高分排在第一。',
      en: 'The note on local AI privacy ranked first even without exact keyword overlap.',
    },
    facts: [
      { label: { zh: '向量维度', en: 'Dimensions' }, value: '768' },
      { label: { zh: '首位匹配分', en: 'Top match' }, value: '0.7590' },
    ],
    usedApps: [APP_VANE, APP_NOTEBOOK, APP_ZHIYU],
  },
  'text.decide': {
    tagline: {
      zh: '面临多个选项时，不再靠长篇大论含糊建议——直接给出每个方案的推荐把握度，帮你一眼定夺',
      en: 'When weighing multiple options, skip vague chat advice—get clear confidence scores across choices at a glance',
    },
    diagramIn: { zh: '当前场景 + 3 个备选', en: 'Scenario + 3 Options' },
    diagramOut: { zh: '各选项把握度与首选', en: 'Confidence Scores & Top Pick' },
    sampleKind: 'runtime',
    useCase: {
      zh: '适合需要“多选一”的判断场景：比如在隐私与速度之间挑执行方式、在多个工作流步骤里选最优排期，或帮游戏与效率应用做出稳定一致的选择。',
      en: 'Ideal whenever an app needs a clear pick among defined choices—such as balancing privacy against speed, ordering multi-step tasks, or keeping game and workflow decisions consistent.',
    },
    input: {
      zh: '给出当前场景与备选方案，让基座直接评估每个方案的推荐把握度。',
      en: 'Provide the current scenario and candidate choices to score clear confidence weights.',
    },
    result: {
      zh: '为三个选项给出合计 100% 的把握度评分，并自动锁定最优方案。',
      en: 'Returns calibrated confidence scores summing to 100% and locks onto the top pick.',
    },
    usedApps: [APP_POLYAGENT],
  },
  'text.annotate': {
    tagline: {
      zh: '在本地离线拆解 8 种语言的词性、主谓结构与自然断句，专为双语字幕而生',
      en: 'Offline 8-language phrasing, part-of-speech, and natural subtitle splitting',
    },
    diagramIn: { zh: '外语长句原稿', en: 'Long Spoken Passage' },
    diagramOut: { zh: '词性结构与自然断句', en: 'Clean Subtitle Clauses' },
    sampleKind: 'runtime',
    input: {
      zh: '把一整段外语演讲长句交给本机引擎，在不联网的情况下拆出自然的字幕停顿点。',
      en: 'Feed a long spoken passage to split natural subtitle clauses completely offline.',
    },
    result: {
      zh: '一字不改原文，精准标出每个词的角色与断句位置，配音字幕不再断在半句话里。',
      en: 'Marked exact word roles and clause breaks so translated subtitles flow naturally.',
    },
    facts: [
      { label: { zh: '支持语种', en: 'Languages' }, value: '8 (zh/en/ja/de…)' },
      { label: { zh: '单批处理', en: 'Batch capacity' }, value: '64 docs' },
    ],
    usedApps: [APP_VIDEOLINGO],
  },

  'image.generate': {
    tagline: {
      zh: '一句话画出高清配图，还能按原图构图精准改色、换局部细节',
      en: 'Create crisp illustrations from text or restyle details while keeping your framing',
    },
    diagramIn: { zh: '文字描述 + 参考底图', en: 'Prompt + Reference' },
    diagramOut: { zh: '1024px 高清成图', en: '1024px Crisp PNG' },
    sampleKind: 'lab',
    input: {
      zh: '先画一只窗边的蓝色陶瓷杯，再以它为底图，只把杯身改成温暖的橙色。',
      en: 'Generate a blue mug by a window, then turn only the mug orange using the first image.',
    },
    result: {
      zh: '光影、窗景与杯把弧度完好保留，只有杯子自然换成了橙色。',
      en: 'Window light, framing, and handle stayed intact while the mug cleanly turned orange.',
    },
    facts: [
      { label: { zh: '分辨率', en: 'Resolution' }, value: '1024 × 1024' },
      { label: { zh: '格式', en: 'Format' }, value: 'PNG' },
    ],
    usedApps: [APP_PERSONA, APP_OPENMONTAGE],
  },
  'image.upscale': {
    tagline: {
      zh: '用本机显卡把模糊老照片或生成草图一键放大 4 倍，重现发丝与材质纹理',
      en: 'Restore blurry photos or drafts up to crisp 4K detail right on your own GPU',
    },
    diagramIn: { zh: '1024px 低清原图', en: '1024px Source Image' },
    diagramOut: { zh: '4096px 4K 超清大图', en: '4096px 4K Output' },
    sampleKind: 'runtime',
    input: {
      zh: '选一张 1024 像素的图片，在本机直接开启 4 倍超清放大，全程不传云端。',
      en: 'Pick a 1024 px image and run 4× super-resolution locally with zero cloud upload.',
    },
    result: {
      zh: '构图与神态分毫不走样，边缘锯齿消失，直接输出 4096 × 4096 的 4K 大图。',
      en: 'Rebuilt crisp surface textures at 4096 × 4096 while keeping original composition intact.',
    },
    facts: [
      { label: { zh: '放大倍率', en: 'Scale' }, value: '2× / 4×' },
      { label: { zh: '最高画质', en: 'Max output' }, value: '4096 × 4096' },
    ],
    usedApps: [APP_PERSONA, APP_OPENMONTAGE],
  },
  'image.face_swap': {
    tagline: {
      zh: '照片全程锁在自己电脑里完成自然人像融合，绝不上传第三方换脸服务器',
      en: 'Blend portrait likeness naturally on your own device—photos never touch external servers',
    },
    diagramIn: { zh: '参考人像 + 目标画面', en: 'Portrait + Scene' },
    diagramOut: { zh: '本机自然融合新图', en: 'Local Blended PNG' },
    sampleKind: 'runtime',
    input: {
      zh: '提供一张人物参考照与一张海报分镜，在本机独立完成面部特征融合。',
      en: 'Select a reference portrait and a storyboard frame for private, on-device face blending.',
    },
    result: {
      zh: '贴合目标画面的光影角度生成新成片，同时原图完好无损、隐私零外泄。',
      en: 'Matched scene lighting in a fresh PNG output without touching original files or the cloud.',
    },
    facts: [
      { label: { zh: '运行位置', en: 'Runs on' }, value: '100% Local' },
      { label: { zh: '输出格式', en: 'Format' }, value: 'PNG' },
    ],
    usedApps: [APP_PERSONA],
  },
  'vision.locate': {
    tagline: {
      zh: '用日常语言说一句「找蓝杯子」，立刻在画面里精准圈出它的坐标位置',
      en: 'Say what you are looking for in plain words and pinpoint its exact spot on screen',
    },
    diagramIn: { zh: '画面 + 「蓝色陶瓷杯」', en: 'Image + Target Phrase' },
    diagramOut: { zh: '精准坐标点 (0.50, 0.65)', en: 'Exact Target Coords' },
    sampleKind: 'lab',
    input: {
      zh: '面对一张摆满杂物的桌面照片，直接让基座指出「蓝色陶瓷杯」在哪里。',
      en: 'Ask Nimi to point out the blue ceramic mug inside a 512 × 512 photo.',
    },
    result: {
      zh: '准星稳稳落在杯身正中央，让桌面交互与奇趣小游戏真正「长出眼睛」。',
      en: 'Locked directly onto the mug body so apps and games can see what you point at.',
    },
    facts: [
      { label: { zh: '横向坐标', en: 'X position' }, value: '0.501' },
      { label: { zh: '纵向坐标', en: 'Y position' }, value: '0.655' },
    ],
    usedApps: [APP_ODDBUREAU],
  },
  'video.generate': {
    tagline: {
      zh: '从一句话灵感或一张静态画稿出发，直接生成连贯生动的分镜视频',
      en: 'Turn a single sentence or static illustration into fluid motion video clips',
    },
    diagramIn: { zh: '分镜提示词 / 参考画稿', en: 'Prompt / Keyframe' },
    diagramOut: { zh: '连贯动态 MP4 镜头', en: 'Motion MP4 Clip' },
    sampleKind: 'lab',
    input: {
      zh: '输入「蓝色水面上轻轻漂浮的红纸船」，或垫入一张参考图生成动态镜头。',
      en: 'Prompt “a red paper boat drifting on blue water” from text or a reference frame.',
    },
    result: {
      zh: '水波荡漾与纸船摇曳自然连贯，几秒钟就为剪辑台补齐空镜素材。',
      en: 'Generated smooth water ripples and boat motion ready for storyboard timelines.',
    },
    facts: [
      { label: { zh: '画面规格', en: 'Frame size' }, value: '512 × 288' },
      { label: { zh: '封装格式', en: 'Format' }, value: 'MP4' },
    ],
    usedApps: [APP_OPENMONTAGE, APP_MONEYPRINTER],
  },
  'video.upscale': {
    tagline: {
      zh: '逐帧修复低清视频至 4K 水准，画面不闪烁，原片配音与口型分秒不差',
      en: 'Upscale low-res clips to crisp 4K without flicker while keeping audio perfectly synced',
    },
    diagramIn: { zh: '低清有声短片 MP4', en: 'Low-Res Clip + Audio' },
    diagramOut: { zh: '无闪烁 4K 音画同步片', en: '4K Clip (Audio Sync)' },
    sampleKind: 'runtime',
    input: {
      zh: '拖入一段带原声的低分辨率短片，用本机显卡做跨帧一致的超清增强。',
      en: 'Drop in a low-resolution video clip with audio for local temporal 4× enhancement.',
    },
    result: {
      zh: '每一帧纹理清晰稳定、前后不跳闪，原有帧率与伴奏人声完整保留。',
      en: 'Delivered flicker-free high-res frames with all 300 frames and original audio intact.',
    },
    facts: [
      { label: { zh: '时序帧数', en: 'Verified clip' }, value: '300 frames' },
      { label: { zh: '最高输出', en: 'Max scale' }, value: '4K · AAC Sync' },
    ],
    usedApps: [APP_OPENMONTAGE, APP_MONEYPRINTER],
  },
  'video.face_swap': {
    tagline: {
      zh: '既能离线渲染整支短片，也能驱动 720p 实时镜头——关掉窗口即刻清空不留痕',
      en: 'Render full video clips or drive live 720p camera sessions—zero frames retained on close',
    },
    diagramIn: { zh: '角色人像 + 实时视频流', en: 'Portrait + Live Video' },
    diagramOut: { zh: '720p 实时表情重演', en: '720p Live Reenactment' },
    sampleKind: 'runtime',
    input: {
      zh: '选定角色面孔，在整段视频成片或低延迟实时画面流中同步驱动表情重演。',
      en: 'Bind a character portrait to reenact expressions across an MP4 clip or live 720p stream.',
    },
    result: {
      zh: '转身、眨眼与说话口型自然贴合原声；实时会话一关立即释放内存，不留任何缓存帧。',
      en: 'Kept natural expressions and audio sync, wiping live memory the instant a session ends.',
    },
    facts: [
      { label: { zh: '实时规格', en: 'Live stream' }, value: '1280 × 720 RGB8' },
      { label: { zh: '隐私清理', en: 'On close' }, value: '0 Cached Frames' },
    ],
    usedApps: [APP_OPENMONTAGE],
  },

  'audio.synthesize': {
    tagline: {
      zh: '带呼吸感与情绪起伏的自然朗读，让伙伴回话、有声书与视频旁白不再像机器人',
      en: 'Warm, expressive speech with natural breathing for companions, audiobooks, and dubbing',
    },
    diagramIn: { zh: '台词文本 + 语气设定', en: 'Script + Tone Prompt' },
    diagramOut: { zh: '自然呼吸感人声 WAV', en: 'Expressive 24kHz WAV' },
    sampleKind: 'lab',
    input: {
      zh: '挑一款温润声线，用舒缓有呼吸感的语气读出诗词或日常台词。',
      en: 'Pick a voice style and read a passage with calm, expressive breathing and cadence.',
    },
    result: {
      zh: '吐字轻重与停顿自然流畅，听感就像真人在耳边轻声交谈。',
      en: 'Produced lifelike pacing and warmth ready for live playback or video voiceover.',
    },
    facts: [
      { label: { zh: '试听声线', en: 'Sample voices' }, value: { zh: '3 款实录风格', en: '3 Styles' } },
      { label: { zh: '采样率', en: 'Sample rate' }, value: '24 kHz WAV' },
    ],
    usedApps: [APP_ZHIYU, APP_VOICESTUDIO, APP_VIDEOLINGO],
  },
  'audio.transcribe': {
    tagline: {
      zh: '口语灵感、会议录音或外语视频，秒级转成带时间轴的干净文字稿',
      en: 'Turn spoken ideas, meetings, and foreign videos into clean time-aligned transcripts',
    },
    diagramIn: { zh: '多语种口语录音 WAV', en: 'Spoken Audio Recording' },
    diagramOut: { zh: '带时间轴精准文字稿', en: 'Time-Aligned Transcript' },
    sampleKind: 'lab',
    input: {
      zh: '导入一段 10 秒口语语音，无需手动指定语种直接转写。',
      en: 'Drop in a 10-second spoken voice note without manually picking the language.',
    },
    result: {
      zh: '自动识别语种、切分时间轴并加上准确标点，连地名、数字与停顿都干净还原。',
      en: 'Automatically detected the language, aligned timestamps, and restored punctuation, names, and numbers.',
    },
    facts: [
      { label: { zh: '输出精度', en: 'Alignment' }, value: { zh: '逐句时间轴', en: 'Timestamps' } },
      { label: { zh: '支持格式', en: 'Format' }, value: 'WAV / MP3' },
    ],
    usedApps: [APP_OPENWHISPR, APP_VIDEOLINGO, APP_PARENTOS],
  },
  'voice.create': {
    tagline: {
      zh: '用几句话形容你理想中的嗓音，或录几秒钟样本，捏出跨应用通用的专属声线',
      en: 'Describe your dream voice in words or clone a short clip to reuse across apps',
    },
    diagramIn: { zh: '嗓音描述 / 短录音样本', en: 'Voice Prompt / Sample' },
    diagramOut: { zh: '跨应用可复用专属音色', en: 'Reusable Custom Voice' },
    sampleKind: 'lab',
    input: {
      zh: '录几秒钟原声片段（或用文字描绘理想嗓音），提取专属声线并朗读全新台词。',
      en: 'Provide a short reference clip (or describe a voice style in words) to read new lines in that voice.',
    },
    result: {
      zh: '一次捏好即可保存复用——无论是角色伴侣还是视频配音都能保持同一把好声音。',
      en: 'Saved a consistent custom voice ready for companions, stories, and dubbing.',
    },
    facts: [
      { label: { zh: '创建方式', en: 'Input modes' }, value: { zh: '录音克隆 / 文本捏声', en: 'Audio / Text' } },
      { label: { zh: '采样规格', en: 'Sample rate' }, value: '24 kHz' },
    ],
    usedApps: [APP_VOICESTUDIO, APP_ZHIYU, APP_VIDEOLINGO],
  },
  'audio.speaker.embed': {
    tagline: {
      zh: '在本机从一段语音提取声纹特征，录音无需上传。',
      en: 'Extract speaker features from a short voice clip locally, without uploading the recording.',
    },
    diagramIn: { zh: '单段语音', en: 'Short voice clip' },
    diagramOut: { zh: '声纹向量', en: 'Speaker embedding' },
    sampleKind: 'runtime',
    input: {
      zh: '选择一段清晰的说话录音。',
      en: 'Select a short clip of clear speech.',
    },
    result: {
      zh: 'Runtime 返回声纹向量和所属的声纹空间。应用可以在同一空间内比较向量，并自行管理说话人分组和归档。',
      en: 'Runtime returns an embedding and its vector space. Apps can compare embeddings in the same space and manage speaker grouping and filing.',
    },
    facts: [
      { label: { zh: '运行方式', en: 'Execution' }, value: { zh: '纯本机 ONNX', en: 'Local ONNX' } },
      { label: { zh: '单段输入', en: 'Max clip' }, value: '≤ 30 s' },
    ],
    usedApps: [APP_PARENTOS, APP_OPENWHISPR],
  },
  'audio.separate': {
    tagline: {
      zh: '把一首成品歌或嘈杂视频一键拆成干净的「纯人声、鼓点、贝斯与伴奏」四条独立音轨',
      en: 'Split any mixed song or noisy video into isolated Vocals, Drums, Bass, and Backing stems',
    },
    diagramIn: { zh: '带配乐的混音歌曲/视频', en: 'Mixed Song / Video' },
    diagramOut: { zh: '人声 · 鼓 · 贝斯 · 伴奏', en: '4 Isolated WAV Stems' },
    sampleKind: 'lab',
    input: {
      zh: '导入一段带背景音乐的混音片段，一键提取纯干声与纯伴奏。',
      en: 'Select a mixed recording to split clean vocal and accompaniment stems.',
    },
    result: {
      zh: '译制配音时保留原片背景配乐只换人声，做音乐采样时直接拿到分轨素材。',
      en: 'Kept rich background music intact for video dubbing or isolated stems for remixing.',
    },
    facts: [
      { label: { zh: '分离轨数', en: 'Stems' }, value: '2 / 4' },
      { label: { zh: '无损格式', en: 'Format' }, value: 'WAV' },
    ],
    usedApps: [APP_VIDEOLINGO, APP_OVERTONE],
  },
  'audio.voice.convert': {
    tagline: {
      zh: '保留原唱所有的咬字情感、颤音与节奏呼吸，只把嗓音无缝换成目标歌喉并自由升降调',
      en: 'Keep every breath, melody, and emotion of a vocal performance while swapping singer timbre',
    },
    diagramIn: { zh: '清唱小样 + 目标歌喉', en: 'Dry Vocal + Target Voice' },
    diagramOut: { zh: '保留唱腔的转换干声', en: 'Converted Singing Track' },
    sampleKind: 'runtime',
    input: {
      zh: '录一段自己的清唱小样，选定目标歌声音色并微调升降半音。',
      en: 'Feed a dry singing vocal take, pick a target voice, and set optional semitone shift.',
    },
    result: {
      zh: '唱腔律动完全是你自己的，出来的却是极具质感的理想歌喉。',
      en: 'Delivered studio-ready converted vocals locked tightly to your original phrasing.',
    },
    facts: [
      { label: { zh: '单曲时长', en: 'Max track' }, value: '600 s' },
      { label: { zh: '音高微调', en: 'Key shift' }, value: '± Semitones' },
    ],
    usedApps: [APP_OVERTONE, APP_VOICESTUDIO],
  },
  'music.generate': {
    tagline: {
      zh: '描述情绪和乐器，生成适合视频或其他创作的原创配乐。',
      en: 'Describe the mood and instruments to generate an original soundtrack for video or other projects.',
    },
    diagramIn: { zh: '配乐描述', en: 'Music prompt' },
    diagramOut: { zh: '立体声完整原创配乐', en: '44.1kHz Stereo Track' },
    sampleKind: 'lab',
    input: {
      zh: '用一句话描述想要的电影感器乐氛围，直接生成立体声配乐。',
      en: 'Describe the mood and instrumentation for an original stereo music cue.',
    },
    result: {
      zh: '生成了层次饱满的 44.1kHz 立体声完整乐段，可直接铺进视频或继续编曲。',
      en: 'Generated a full 44.1 kHz stereo track ready for timelines or further arrangement.',
    },
    facts: [
      { label: { zh: '示例输入', en: 'Sample input' }, value: { zh: '文本提示', en: 'Text prompt' } },
      { label: { zh: '音质规格', en: 'Quality' }, value: '44.1 kHz Stereo' },
    ],
    usedApps: [APP_OVERTONE, APP_OPENMONTAGE],
  },
  'music.transcribe': {
    tagline: {
      zh: '听见好旋律不用手抄扒谱——随手哼唱或弹奏录音，自动变成可编辑的 MIDI 音符与和弦谱',
      en: 'Hum a melody or play an instrument and instantly get editable MIDI notes, chords, and beats',
    },
    diagramIn: { zh: '哼唱 / 乐器弹奏录音', en: 'Hummed / Acoustic Clip' },
    diagramOut: { zh: 'MIDI 音符 + ABC 和弦谱', en: 'Editable MIDI & Chords' },
    sampleKind: 'runtime',
    input: {
      zh: '选一段吉他弹唱或钢琴录音，让本机引擎直接把旋律、节拍与和弦扒出来。',
      en: 'Select an acoustic or vocal recording to extract notes, chords, and beat bars locally.',
    },
    result: {
      zh: '瞬间生成可直接拖进编曲软件的 MIDI 乐谱、ABC 简谱与精准小节和弦轴。',
      en: 'Exported ready-to-edit MIDI notes, ABC notation, and beat-aligned chord progressions.',
    },
    facts: [
      { label: { zh: '导出乐谱', en: 'Exports' }, value: 'MIDI · ABC' },
      { label: { zh: '支持曲长', en: 'Max length' }, value: '10 min' },
    ],
    usedApps: [APP_OVERTONE],
  },

  'realtime.interact': {
    tagline: {
      zh: '不用等「录完再发」——像打电话一样边听边聊、随时插话打断的毫秒级语音在场体验',
      en: 'Talk naturally like a live phone call—interrupt anytime with millisecond voice-and-text response',
    },
    diagramIn: { zh: '连续开口 / 随时插话', en: 'Live Speech & Barge-In' },
    diagramOut: { zh: '即时语音回应 + 实时字幕', en: 'Instant Voice + Captions' },
    sampleKind: 'lab',
    input: {
      zh: '开启实时语音通话与伙伴自然对话，并在对方话音未落时随时点击插话打断。',
      en: 'Start a live voice call with a companion and interrupt mid-sentence anytime without waiting.',
    },
    result: {
      zh: '伙伴即时流式开口并同步浮现对应字幕；触发插话时立刻截断旧语音并切入新回应。',
      en: 'The companion streams natural voice with time-aligned captions and cuts off immediately to pivot on barge-in.',
    },
    usedApps: [APP_ZHIYU],
  },
};
