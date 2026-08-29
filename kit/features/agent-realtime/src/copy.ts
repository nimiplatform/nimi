export type NimiAgentRealtimeLocale = 'en' | 'zh';

export type NimiAgentRealtimeCopy = {
  readonly title: string;
  readonly description: string;
  readonly agentsLoading: string;
  readonly agentsLoadFailed: string;
  readonly agentsRetry: string;
  readonly agentsEmpty: string;
  readonly selectAgent: string;
  readonly selectedAgent: string;
  readonly initialAgentUnavailable: string;
  readonly open: string;
  readonly start: string;
  readonly stop: string;
  readonly interrupt: string;
  readonly close: string;
  readonly opening: string;
  readonly closing: string;
  readonly ready: string;
  readonly idle: string;
  readonly capturing: string;
  readonly reconnecting: string;
  readonly closed: string;
  readonly failed: string;
  readonly pressured: string;
  readonly blocked: string;
  readonly permissionDenied: string;
  readonly deviceUnavailable: string;
  readonly deviceLost: string;
  readonly playbackUnavailable: string;
  readonly textInputLabel: string;
  readonly sendText: string;
};

export const NIMI_AGENT_REALTIME_BASE_COPY: Readonly<
  Record<NimiAgentRealtimeLocale, NimiAgentRealtimeCopy>
> = Object.freeze({
  en: Object.freeze({
    title: 'Live conversation',
    description: 'Choose a current Agent, then use the same live conversation available to every covered App.',
    agentsLoading: 'Loading current Agents…',
    agentsLoadFailed: 'Current Agents could not be loaded.',
    agentsRetry: 'Retry',
    agentsEmpty: 'No current Agent is available for this App session.',
    selectAgent: 'Choose Agent',
    selectedAgent: 'Selected Agent',
    initialAgentUnavailable: 'The previously selected Agent is no longer available in this App session.',
    open: 'Open live conversation',
    start: 'Start microphone',
    stop: 'Stop microphone',
    interrupt: 'Interrupt output',
    close: 'Close live conversation',
    opening: 'Opening live conversation…',
    closing: 'Closing live conversation…',
    ready: 'Live conversation is ready.',
    idle: 'Live conversation is not open.',
    capturing: 'Microphone capture is active.',
    reconnecting: 'Reconnecting to the live conversation…',
    closed: 'Live conversation is closed.',
    failed: 'Live conversation is unavailable.',
    pressured: 'Audio input is catching up.',
    blocked: 'Audio input is paused until the session can accept more.',
    permissionDenied: 'Microphone access was not granted. Allow access, then start again.',
    deviceUnavailable: 'No microphone is currently available.',
    deviceLost: 'The microphone disconnected. Choose an available device, then start again.',
    playbackUnavailable: 'Audio playback is unavailable. You can still read text output.',
    textInputLabel: 'Message for the live conversation',
    sendText: 'Send text',
  }),
  zh: Object.freeze({
    title: '实时对话',
    description: '选择当前 Agent，然后使用所有同 coverage App 共用的实时对话能力。',
    agentsLoading: '正在加载当前 Agent…',
    agentsLoadFailed: '无法加载当前 Agent。',
    agentsRetry: '重试',
    agentsEmpty: '当前 App session 没有可用 Agent。',
    selectAgent: '选择 Agent',
    selectedAgent: '已选择 Agent',
    initialAgentUnavailable: '先前选择的 Agent 已不在当前 App session 中。',
    open: '开启实时对话',
    start: '开启麦克风',
    stop: '停止麦克风',
    interrupt: '打断输出',
    close: '关闭实时对话',
    opening: '正在开启实时对话…',
    closing: '正在关闭实时对话…',
    ready: '实时对话已就绪。',
    idle: '实时对话尚未开启。',
    capturing: '麦克风正在采集。',
    reconnecting: '正在重新连接实时对话…',
    closed: '实时对话已关闭。',
    failed: '实时对话当前不可用。',
    pressured: '音频输入正在追赶处理进度。',
    blocked: '会话暂时无法接收更多内容，音频输入已暂停。',
    permissionDenied: '尚未获得麦克风权限。允许访问后，请再次开启。',
    deviceUnavailable: '当前没有可用的麦克风。',
    deviceLost: '麦克风已断开。请选择可用设备后再次开启。',
    playbackUnavailable: '音频播放当前不可用，文字输出仍可阅读。',
    textInputLabel: '实时对话消息',
    sendText: '发送文字',
  }),
});

export function resolveNimiAgentRealtimeCopy(
  locale: string | null | undefined,
): NimiAgentRealtimeCopy {
  return String(locale ?? '').trim().toLowerCase().startsWith('zh')
    ? NIMI_AGENT_REALTIME_BASE_COPY.zh
    : NIMI_AGENT_REALTIME_BASE_COPY.en;
}
