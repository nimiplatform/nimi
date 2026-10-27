import type { ChatCopy } from './copy.js';

const chinese: ChatCopy = {
  bubbleUserLabel: '你', bubbleAssistantLabel: '伙伴',
  markdownCopyLabel: '复制代码', markdownCopiedLabel: '已复制',
  composerRemoveAttachmentLabel: (name) => `移除附件 ${name}`,
  composerCancelLabel: '取消', composerVoiceInputLabel: '语音输入', composerRecordVoiceLabel: '录制语音消息', composerSendRecordingLabel: '发送录音',
  composerPlayingVoiceLabel: '正在播放语音回复', composerTranscribingLabel: '正在转写录音…', composerStopVoiceLabel: '停止语音回复',
  composerCancelTranscriptionLabel: '取消转写', composerCancelRecordingLabel: '取消录音',
  messageActionsLabel: '消息操作', messageMoreLabel: '更多操作', messageCopyLabel: '复制文本', messageCopySelectionLabel: '复制所选文本', messageCopiedLabel: '已复制',
  messageCopyFailedLabel: '未能复制，请选中文字后重试。', messageQuoteLabel: '引用回复', messageQuotePendingLabel: '这条回复保存后可引用。',
  messageSelectionChangedLabel: '文字选区已变化，请重新选择片段。', messageSelectionMultipleLabel: '请选择一条消息内的片段进行引用。',
  messageNavigationLabel: '聊天消息', messageKeyboardHelpLabel: '消息快捷键',
  messageKeyboardHelp: 'Page Up / Page Down 切换消息，Enter 打开操作，Esc 返回输入框。Tab 浏览当前消息中的链接和控件。Mac 可使用 Fn 对应组合键。',
  voicePlayLabel: '播放语音', voiceReadLabel: '朗读消息', voicePauseLabel: '暂停', voiceResumeLabel: '继续播放', voiceStopLabel: '停止播放',
  voiceStopWaitingLabel: '停止等待', voiceCloseLabel: '关闭',
  voicePreparingLabel: '正在准备语音…', voiceProgressLabel: '播放进度', voicePlaybackFailedLabel: '语音播放失败，文字已保留。',
  voiceReadFailedLabel: '暂时无法读取这条音频，文字已保留。', voiceGenerationFailedLabel: '语音未能生成，文字已保留。',
  voiceResultUnknownLabel: '尚未确认这次语音请求的结果。', voiceRetryPlaybackLabel: '重试播放', voiceRegenerateLabel: '重新生成语音',
  voiceRefreshLabel: '刷新语音结果', voiceContinueRequestLabel: '继续本次语音请求', voiceContinueRequestHint: '如果此前的请求尚未受理，此操作可能开始生成语音。',
  voiceRealtimeBlockedLabel: '结束实时语音后可播放消息。', voiceLocateLabel: '定位正在播放的消息', voiceSettingsLabel: '语音设置',
  quotePreparingLabel: '正在准备引用…', quoteFailedLabel: '这段引用暂不可用，请取消后重新选择。', quoteCancelLabel: '取消引用',
  quotePartialLabel: '原回复未完成', quoteSourceLabel: '定位被引用的消息', quoteReturnLabel: '返回刚才位置',
  quoteTooLongLabel: '整条消息超出引用长度，请选取较短的片段。', quoteChangedLabel: '原文表示已变化，请重新选择片段。',
  quoteReadFailedLabel: '暂时无法读取原消息，你的输入已保留。', quoteRetryLabel: '重试引用', quoteAppSourceLabel: '应用',
  historyLoadingLabel: '正在定位原文…', historyFailedLabel: '原消息暂不可用。', historyRetryLabel: '重试定位', historyLatestLabel: '回到最新消息',
};

/** Shared action copy; hosts still own their existing whole-page localization. */
export function getMessageInteractionCopy(locale: string): ChatCopy { return /^zh(?:-|$)/i.test(locale) ? chinese : {}; }
