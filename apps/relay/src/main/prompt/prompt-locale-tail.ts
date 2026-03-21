import type { PromptLocale } from './prompt-locale.js';

export const PROMPT_LOCALE_TAIL: Record<string, Record<PromptLocale, string>> = {
  'enricher.videoFallbackPose': {
    zh: '当前状态像正在对着镜头自然回应用户的一小段画面',
    en: 'Current state: a short clip of her naturally responding to the camera',
  },
  'enricher.imageEnvironmentSubjectFallback': {
    zh: '环境主体：山景、天空、云层或其他被请求的风景元素，不出现人物',
    en: 'Environment subject: mountains, sky, clouds, or other requested scenery elements, with no people',
  },
  'enricher.videoEnvironmentSubjectFallback': {
    zh: '环境主体：空间、天气与景观本身，不出现人物',
    en: 'Environment subject: space, weather, and scenery itself, with no people',
  },
  'enricher.expandAround': {
    zh: '围绕"{detail}"展开',
    en: 'Expand around "{detail}"',
  },
  'enricher.continuityLine': {
    zh: '延续最近聊天: {summary}',
    en: 'Continue from recent chat: {summary}',
  },
  'enricher.imageSceneFallback': {
    zh: '像她顺手发来的一张自然照片',
    en: 'Like a natural photo she casually sent',
  },
  'enricher.videoSceneFallback': {
    zh: '像她顺手录来的一小段自然短视频',
    en: 'Like a short natural video she casually recorded',
  },
  'enricher.imageEnvironmentSceneFallback': {
    zh: '以环境本身为主，突出风景、天气、云层和空间纵深，不要人物入镜',
    en: 'Focus on the environment itself, emphasizing scenery, weather, clouds, and depth, with no people in frame',
  },
  'enricher.videoEnvironmentSceneFallback': {
    zh: '以环境变化和空间氛围为主，像一段纯景别短视频，不要人物入镜',
    en: 'Focus on environmental motion and atmosphere like a pure scenic clip, with no people in frame',
  },
  'enricher.imageStyleFallback': {
    zh: '自然写实、生活流、高质量私聊照片质感',
    en: 'Natural, realistic, lifestyle, high-quality private chat photo feel',
  },
  'enricher.videoStyleFallback': {
    zh: '自然写实、生活流、短视频质感，动作和表情要连贯',
    en: 'Natural, realistic, lifestyle, short video feel with smooth actions and expressions',
  },
  'enricher.imageEnvironmentStyleFallback': {
    zh: '自然写实、风景摄影质感、强调空气感和空间层次',
    en: 'Natural, realistic, scenic photography feel with atmosphere and spatial depth',
  },
  'enricher.videoEnvironmentStyleFallback': {
    zh: '自然写实、环境叙事、镜头克制，突出天气与空间流动',
    en: 'Natural, realistic, environment-driven storytelling with restrained camera movement',
  },
  'enricher.imageCompositionFallback': {
    zh: '主体清楚，镜头自然，像高质量但不摆拍的聊天照片',
    en: 'Clear subject, natural camera angle, like a high-quality candid chat photo',
  },
  'enricher.videoCompositionFallback': {
    zh: '人物为主，动作自然，镜头稳定，像聊天里顺手录的一小段',
    en: 'Person-focused, natural movement, stable camera, like a casually recorded chat clip',
  },
  'enricher.imageEnvironmentCompositionFallback': {
    zh: '横构图或宽幅远景，优先表现山体、天空、云层和空间纵深',
    en: 'Wide landscape framing that prioritizes mountains, sky, clouds, and spatial depth',
  },
  'enricher.videoEnvironmentCompositionFallback': {
    zh: '环境全景或远景，镜头平稳缓慢，不要人物入镜',
    en: 'Wide scenic framing with steady, slow camera movement and no people in frame',
  },
  'enricher.imageNegCues': {
    zh: '多余人物|手部崩坏|过度磨皮|服装漂移|脸部失真',
    en: 'extra people|hand artifacts|over-smoothing|clothing drift|face distortion',
  },
  'enricher.videoNegCues': {
    zh: '多余人物|动作突变|镜头乱晃|人物漂移|表情抽动',
    en: 'extra people|motion jumps|shaky camera|person drift|expression glitch',
  },
  'enricher.environmentNegCues': {
    zh: '不要出现人物|不要人像|不要自拍|不要面部特写',
    en: 'no people|no portrait|no selfie|no face close-up',
  },
  'enricher.continuityMediaPrefix': {
    zh: '延续最近媒体: {summary}',
    en: 'Continue from recent media: {summary}',
  },
  'enricher.comp.selfie': {
    zh: '竖构图，半身近景，像私聊里随手发来的自拍',
    en: 'Vertical framing, half-body close-up, like a casual selfie from private chat',
  },
  'enricher.comp.portrait': {
    zh: '主体靠近镜头，表情和眼神清楚',
    en: 'Subject close to camera, clear expression and gaze',
  },
  'enricher.comp.fullBody': {
    zh: '保留完整姿态和服装细节',
    en: 'Preserve full pose and clothing details',
  },
  'enricher.comp.wideShot': {
    zh: '带出环境和空间氛围，不只拍脸',
    en: 'Show environment and spatial atmosphere, not just the face',
  },
  'enricher.comp.indoor': {
    zh: '生活感室内场景，像真实聊天中的随手拍',
    en: 'Lifestyle indoor scene, like a casual shot from real chat',
  },
  'enricher.comp.videoSelfie': {
    zh: '竖构图，人物面对镜头，像刚录给用户的一小段自拍视频',
    en: 'Vertical framing, person facing camera, like a selfie video just recorded for the user',
  },
  'enricher.comp.tracking': {
    zh: '镜头轻微跟随人物，不要突兀跳切',
    en: 'Camera gently follows the person, no abrupt jump cuts',
  },
  'enricher.comp.pushIn': {
    zh: '镜头缓慢推进，动作自然，不要突然冲脸',
    en: 'Camera slowly pushes in, natural movement, no sudden close-up',
  },
  'enricher.comp.pan': {
    zh: '镜头运动轻微克制，保证主体稳定',
    en: 'Camera movement subtle and restrained, keep subject stable',
  },
  'enricher.comp.microAction': {
    zh: '动作幅度小而连贯，适合短视频节奏',
    en: 'Small, smooth actions, suitable for short video rhythm',
  },
  'enricher.style.cinematic': {
    zh: '电影感、轻胶片质感、光影明确',
    en: 'Cinematic, light film grain, clear lighting',
  },
  'enricher.style.photoreal': {
    zh: '自然写实，皮肤和材质保持真实',
    en: 'Natural realism, authentic skin and material textures',
  },
  'enricher.style.anime': {
    zh: '保留角色设定感，但面部和服装不要失真',
    en: 'Keep character design feel, but face and clothing should not distort',
  },
  'enricher.style.nightRain': {
    zh: '夜色和反光要自然，保留环境氛围',
    en: 'Night tones and reflections should be natural, preserve environmental atmosphere',
  },
  'fast.emotion.tired': {
    zh: '用户当前消息带有明显疲惫感',
    en: 'User message shows clear signs of exhaustion',
  },
  'fast.emotion.hurt': {
    zh: '用户当前消息带有明显委屈或难受感',
    en: 'User message shows clear signs of being hurt or upset',
  },
  'fast.emotion.sad': {
    zh: '用户当前消息带有明显低落情绪',
    en: 'User message shows clear signs of sadness',
  },
  'fast.emotion.anxious': {
    zh: '用户当前消息带有明显压力或焦虑感',
    en: 'User message shows clear signs of stress or anxiety',
  },
  'fast.emotion.excited': {
    zh: '用户当前消息带有轻快或兴奋情绪',
    en: 'User message shows lighthearted or excited mood',
  },
  'fast.directive.emotional': {
    zh: '先接住用户情绪，不要急着讲道理。',
    en: 'Receive the user\'s emotions first, do not rush to reason.',
  },
  'fast.directive.playful': {
    zh: '先顺着用户语气接住，不要突然变得太正经。',
    en: 'Match the user\'s playful tone, do not suddenly become too serious.',
  },
  'fast.directive.intimate': {
    zh: '先自然回应亲近感，但不要越过当前边界。',
    en: 'Respond to closeness naturally, but do not cross current boundaries.',
  },
  'fast.directive.explicitMedia': {
    zh: '先用一句话接住，再把媒体相关内容留到后续补充。',
    en: 'Acknowledge with one sentence, then save media content for follow-up.',
  },
  'fast.directive.explicitVoice': {
    zh: '先用一句话接住，后续再转到语音表现。',
    en: 'Acknowledge with one sentence, then transition to voice later.',
  },
  'fast.directive.checkinContinuation': {
    zh: '先顺着上一次那条线自然接上。',
    en: 'Pick up naturally from where the last conversation left off.',
  },
  'fast.directive.checkinNew': {
    zh: '先自然回应问候，不要显得像重新开场。',
    en: 'Respond to the greeting naturally, do not seem like you are starting over.',
  },
  'fast.directive.infoEmotional': {
    zh: '先接住用户，再自然过渡到回答。',
    en: 'Receive the user first, then naturally transition to answering.',
  },
  'fast.directive.infoContinuation': {
    zh: '先顺着已有对话线索接住，不要像陌生人重新开始。',
    en: 'Pick up from existing conversation threads, do not restart like a stranger.',
  },
  'voice.role': {
    zh: '角色：{name}。',
    en: 'Character: {name}.',
  },
  'voice.identity': {
    zh: '身份：{value}。',
    en: 'Identity: {value}.',
  },
  'voice.persona': {
    zh: '人设：{value}。',
    en: 'Persona: {value}.',
  },
  'voice.bio': {
    zh: '背景线索：{value}。',
    en: 'Background: {value}.',
  },
  'voice.tone': {
    zh: '语气：{value}。',
    en: 'Tone: {value}.',
  },
  'voice.toneDefault': {
    zh: '语气：自然，与角色情感一致。',
    en: 'Tone: natural, consistent with the character\'s emotions.',
  },
  'voice.world': {
    zh: '世界观：{value}。',
    en: 'Worldview: {value}.',
  },
  'voice.inCharacter': {
    zh: '以第一人称角色身份自然演绎，不要以旁白或评论口吻朗读。',
    en: 'Perform naturally in first person as the character. Do not narrate or comment.',
  },
  'voice.keepConcise': {
    zh: '保持简洁、有表现力、与角色人设一致的演绎。',
    en: 'Keep performances concise, expressive, and consistent with character design.',
  },
};
