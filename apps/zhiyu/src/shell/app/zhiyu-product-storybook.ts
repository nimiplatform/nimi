export const ZHIYU_PRODUCT_STORYBOOK_VERSION = 'zhiyu-product-storybook-v1';

export type ZhiyuProductStoryId =
  | 'runtime-offline'
  | 'no-local-partner'
  | 'partner-ready'
  | 'model-config'
  | 'conversation-turn'
  | 'agent-center-advanced'
  | 'avatar-launch-gated'
  | 'speech-consume-gated';

export type ZhiyuProductStory = {
  readonly id: ZhiyuProductStoryId;
  readonly userGoal: string;
  readonly productPromise: string;
  readonly primarySurface: 'agent-chat' | 'model-config' | 'agent-center-advanced';
  readonly acceptanceSignal: string;
};

export const ZHIYU_PRODUCT_STORIES: readonly ZhiyuProductStory[] = [
  {
    id: 'runtime-offline',
    userGoal: '打开织羽时知道本地服务是否可恢复。',
    productPromise: '离线态只给恢复入口，不展示底层检查表。',
    primarySurface: 'agent-chat',
    acceptanceSignal: 'agent chat has one clear recovery path and no engineering queue as the first surface.',
  },
  {
    id: 'no-local-partner',
    userGoal: '从 Realm 角色资料创建或选择一个本地伙伴。',
    productPromise: '织羽是 agent chat；当前伙伴来自真实 materialization。',
    primarySurface: 'agent-chat',
    acceptanceSignal: 'agent chat asks for a local partner and does not claim the app brand is the partner.',
  },
  {
    id: 'partner-ready',
    userGoal: '看到当前伙伴已选定，可以继续配置模型或开始对话。',
    productPromise: '首屏以伙伴对话为中心，状态摘要折叠为辅助信息。',
    primarySurface: 'agent-chat',
    acceptanceSignal: 'conversation area and relationship rail are the dominant visible product surfaces.',
  },
  {
    id: 'model-config',
    userGoal: '为当前伙伴选择可用模型。',
    productPromise: '模型配置使用 Kit 公共体验，不在主页堆禁用能力卡。',
    primarySurface: 'model-config',
    acceptanceSignal: 'model drawer is reachable from agent chat and route state updates through SDK/Kit.',
  },
  {
    id: 'conversation-turn',
    userGoal: '向当前本地伙伴发送消息并获得连续回复。',
    productPromise: '对话使用 Runtime LocalAgent turn，不直接把底层能力工作台当产品。',
    primarySurface: 'agent-chat',
    acceptanceSignal: 'chat turn streams through Runtime/SDK and renders as a product conversation.',
  },
  {
    id: 'agent-center-advanced',
    userGoal: '验收者查看链路、状态、能力消费和失败原因。',
    productPromise: '开发者后台承载诊断和能力探针，不能污染主产品层。',
    primarySurface: 'agent-center-advanced',
    acceptanceSignal: 'Agent Center advanced exposes capability, image, speech, projection, and fail-closed data.',
  },
  {
    id: 'avatar-launch-gated',
    userGoal: '在授权后从当前伙伴一键打开形象。',
    productPromise: '形象启动必须走公共 handoff；未准入时 fail closed。',
    primarySurface: 'agent-chat',
    acceptanceSignal: 'avatar action is hidden or blocked until public launch projection and handoff are admitted.',
  },
  {
    id: 'speech-consume-gated',
    userGoal: '验收语音合成消费链路。',
    productPromise: 'TTS 使用 Kit generation 公共 helper，产品层只消费结果摘要。',
    primarySurface: 'agent-center-advanced',
    acceptanceSignal: 'Agent Center advanced can dispatch audio.synthesize through shared Kit/SDK surfaces.',
  },
];
