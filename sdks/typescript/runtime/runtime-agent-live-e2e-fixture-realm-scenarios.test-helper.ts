export type RuntimeAgentLiveE2EChatScenario = {
  readonly apml: string;
  readonly key?: string;
  readonly repairApml?: string;
  readonly reasoningChunks?: readonly string[];
  readonly chunks?: readonly string[] | `char-split-${number}`;
  readonly usage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
  readonly failMode?: 'chat-completion-500';
};

export const RUNTIME_AGENT_LIVE_E2E_CHAT_SCENARIOS: Readonly<Record<string, RuntimeAgentLiveE2EChatScenario>> = {
  default: {
    apml: '<message id="message-0">Hello from the Runtime Agent live fixture.</message>',
  },
  'b-single-turn': {
    apml: '<message id="message-b-single-turn">Hello from the Runtime Agent live fixture B-01 single turn.</message>',
  },
  'b-multi-turn-first': {
    apml: '<message id="message-b-multi-turn-first">First turn retained by the Runtime Agent live fixture.</message>',
  },
  'b-multi-turn-second': {
    apml: '<message id="message-b-multi-turn-second">Second turn can see the first Runtime fixture answer.</message>',
  },
  'b-stream-delta': {
    apml: '<message id="message-b-stream-delta">Streaming delta text arrives in several chunks for Zhiyu.</message>',
    chunks: 'char-split-18',
  },
  'b-reasoning-delta': {
    apml: '<message id="message-b-reasoning-delta">Reasoning delta text stays separate from the final answer.</message>',
    reasoningChunks: ['checking Runtime route ', 'before final answer'],
    chunks: 'char-split-24',
  },
  'b-long-chinese': {
    apml: [
      '<message id="message-b-long-chinese">',
      '这是一段用于验证窄屏中文排版的长文本。织羽需要保持对话区域、输入框和按钮稳定，不允许文字溢出、重叠或遮挡。',
      '第二句继续提供足够长度，让 390px 宽度下的自动换行和截图证据都能被机器断言覆盖。',
      '</message>',
    ].join(''),
  },
  'b-image-action': {
    apml: [
      '<message id="message-image-action">I will create an image artifact.</message>',
      '<action id="action-image-1" kind="image">',
      '<prompt-payload kind="image"><prompt-text>studio portrait of the current local agent</prompt-text></prompt-payload>',
      '</action>',
    ].join(''),
  },
  'b-mid-stream-failure': {
    apml: [
      '<message id="message-mid-stream-failure">Committed before induced action failure.</message>',
      '<action id="action-mid-stream-failure" kind="image">',
      '<prompt-payload kind="image"><prompt-text>zhiyu induced action failure</prompt-text></prompt-payload>',
      '</action>',
    ].join(''),
  },
  'a-core-emotion-happy': { apml: '<message id="message-a-core-happy"><activity>happy</activity>A-01 core emotion happy.</message>' },
  'a-core-emotion-sad': { apml: '<message id="message-a-core-sad"><activity>sad</activity>A-01 core emotion sad.</message>' },
  'a-core-emotion-shy': { apml: '<message id="message-a-core-shy"><activity>shy</activity>A-01 core emotion shy.</message>' },
  'a-core-emotion-angry': { apml: '<message id="message-a-core-angry"><activity>angry</activity>A-01 core emotion angry.</message>' },
  'a-core-emotion-surprised': { apml: '<message id="message-a-core-surprised"><activity>surprised</activity>A-01 core emotion surprised.</message>' },
  'a-core-emotion-confused': { apml: '<message id="message-a-core-confused"><activity>confused</activity>A-01 core emotion confused.</message>' },
  'a-core-emotion-excited': { apml: '<message id="message-a-core-excited"><activity>excited</activity>A-01 core emotion excited.</message>' },
  'a-core-emotion-worried': { apml: '<message id="message-a-core-worried"><activity>worried</activity>A-01 core emotion worried.</message>' },
  'a-core-emotion-embarrassed': { apml: '<message id="message-a-core-embarrassed"><activity>embarrassed</activity>A-01 core emotion embarrassed.</message>' },
  'a-core-emotion-neutral': { apml: '<message id="message-a-core-neutral"><activity>neutral</activity>A-01 core emotion neutral.</message>' },
  'a-extended-emotion-apologetic': { apml: '<message id="message-a-ext-apologetic"><activity>ext:apologetic</activity>A-02 extended emotion apologetic.</message>' },
  'a-extended-emotion-proud': { apml: '<message id="message-a-ext-proud"><activity>ext:proud</activity>A-02 extended emotion proud.</message>' },
  'a-extended-emotion-lonely': { apml: '<message id="message-a-ext-lonely"><activity>ext:lonely</activity>A-02 extended emotion lonely.</message>' },
  'a-extended-emotion-grateful': { apml: '<message id="message-a-ext-grateful"><activity>ext:grateful</activity>A-02 extended emotion grateful.</message>' },
  'a-interaction-greet': { apml: '<message id="message-a-interaction-greet"><activity>greet</activity>A-03 interaction greet.</message>' },
  'a-interaction-farewell': { apml: '<message id="message-a-interaction-farewell"><activity>farewell</activity>A-03 interaction farewell.</message>' },
  'a-interaction-agree': { apml: '<message id="message-a-interaction-agree"><activity>agree</activity>A-03 interaction agree.</message>' },
  'a-interaction-disagree': { apml: '<message id="message-a-interaction-disagree"><activity>disagree</activity>A-03 interaction disagree.</message>' },
  'a-interaction-listening': { apml: '<message id="message-a-interaction-listening"><activity>listening</activity>A-03 interaction listening.</message>' },
  'a-interaction-thinking': { apml: '<message id="message-a-interaction-thinking"><activity>thinking</activity>A-03 interaction thinking.</message>' },
  'a-state-idle': { apml: '<message id="message-a-state-idle"><activity>idle</activity>A-04 state idle.</message>' },
  'a-state-celebrating': { apml: '<message id="message-a-state-celebrating"><activity>celebrating</activity>A-04 state celebrating.</message>' },
  'a-state-sleeping': { apml: '<message id="message-a-state-sleeping"><activity>sleeping</activity>A-04 state sleeping.</message>' },
  'a-state-focused': { apml: '<message id="message-a-state-focused"><activity>focused</activity>A-04 state focused.</message>' },
  'a-image-action': {
    apml: [
      '<message id="message-a-image-action">A-05 image action should create an artifact.</message>',
      '<action id="action-a-image-1" kind="image">',
      '<prompt-payload kind="image"><prompt-text>studio portrait of the current local agent</prompt-text></prompt-payload>',
      '</action>',
    ].join(''),
  },
  'a-voice-action': {
    apml: [
      '<message id="message-a-voice-action"><activity>happy</activity>A-06 voice action should reach Runtime voice truth.</message>',
      '<action id="action-a-voice-1" kind="voice">',
      '<prompt-payload kind="voice"><prompt-text>say this with runtime voice</prompt-text></prompt-payload>',
      '</action>',
    ].join(''),
  },
  'a-time-hook': {
    apml: '<message id="message-a-time-hook">A-07 time hook should propose a follow-up.</message><time-hook id="hook-a-time-1"><delay-ms>250</delay-ms><effect kind="follow-up-turn"><prompt-text>continue A-07 time hook</prompt-text></effect></time-hook>',
  },
  'a-event-hook': {
    apml: '<message id="message-a-event-hook">A-07 event hook should be projected and rejected without detector.</message><event-hook id="hook-a-event-1"><event-user-idle idle-for="120s"/><effect kind="follow-up-turn"><prompt-text>continue A-07 event hook</prompt-text></effect></event-hook>',
  },
  'a-chunk-split-emotion': {
    apml: '<message id="message-a-chunk-split-emotion"><activity>happy</activity>A-08 chunk split emotion.</message>',
    chunks: 'char-split-7',
  },
  'a-malformed-apml': {
    key: 'a-malformed-apml',
    apml: '<message id="message-a-malformed-apml"><activity>thinking</activity>A-09 malformed APML.',
    repairApml: '<message id="message-a-malformed-apml-repair"><activity>thinking</message>',
  },
  'a-negative-unknown-activity': {
    apml: '<message id="message-a-negative-unknown-activity"><activity>wave</activity>A-10 invalid activity.</message>',
  },
  'a-negative-apml-intensity': {
    apml: '<message id="message-a-negative-intensity"><activity intensity="weak">happy</activity>A-10 invalid intensity attribute.</message>',
  },
  'a-negative-neutral-intensity': {
    apml: '<message id="message-a-negative-neutral-intensity"><activity intensity="weak">neutral</activity>A-10 invalid neutral intensity.</message>',
  },
  'd-no-emotion-followup': {
    apml: '<message id="message-d-no-emotion-followup">D-03 no emotion follow-up keeps the previous Runtime emotion.</message>',
  },
  'd-lipsync': {
    apml: '<message id="message-d-lipsync">D-06 lipsync projection should be carried by companion evidence.</message>',
  },
  'e-native-stream': {
    apml: '<message id="message-e-native-stream">E-01 native stream playback should complete.</message>',
  },
  'e-batch-final': {
    apml: '<message id="message-e-batch-final">E-02 batch final voice artifact should be renderable.</message>',
  },
  'e-text-only': {
    apml: '<message id="message-e-text-only">E-03 text only turn should not project playback.</message>',
  },
  'e-native-interrupt': {
    apml: '<message id="message-e-native-interrupt">E-04 native stream should be interruptible.</message>',
  },
  'e-native-failed': {
    apml: '<message id="message-e-native-failed">zhiyu induced native voice failure after first chunk.</message>',
  },
};

export function runtimeAgentLiveE2EChatScenarioPrompt(key: string): string {
  return `[[scenario:${key}]]`;
}
