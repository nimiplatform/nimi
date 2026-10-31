import type { RealmModel } from '@nimiplatform/sdk/realm';

export type AccountTextExport = RealmModel<'AccountExportDto'>;

const printable = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/[\\\x60*_{}[\]()#+.!|~-]/g, '\\$&');
const cell = (value: unknown) => printable(value).replace(/\r?\n/g, '<br>');

export function accountExportSectionLabel(data: AccountTextExport, name: string, locale: 'en' | 'zh'): string {
  const names: Record<string, readonly [string, string]> = {
    profile: ['Profile', '个人资料'], settings: ['Settings', '设置'], friends: ['Friends', '好友'],
    'received-requests': ['Received requests', '收到的申请'], 'sent-requests': ['Sent requests', '发出的申请'],
    blocked: ['Blocked accounts', '屏蔽名单'], conversations: ['Conversation list', '会话列表'],
  };
  if (names[name]) return names[name][locale === 'zh' ? 1 : 0];
  const chat = name.startsWith('messages:') ? data.conversations.find(item => item.chatId === name.slice(9)) : undefined;
  return chat ? `${locale === 'zh' ? '与以下用户的消息' : 'Messages with'} ${chat.peerDisplayName || chat.peerHandle || chat.peerAccountId}`
    : locale === 'zh' ? '其他内容' : 'Other content';
}

/** Human-readable rendering of the exact same authorized JSON, never a second fetch. */
export function accountExportMarkdown(data: AccountTextExport, locale: 'en' | 'zh'): string {
  const zh = locale === 'zh';
  const lines = [
    `# ${zh ? 'Nimi 账号资料与聊天文本' : 'Nimi account profile and chat text'}`,
    '', `${zh ? '生成时段' : 'Generation interval'}: ${data.startedAt} — ${data.completedAt}`,
    `${zh ? '结果' : 'Result'}: ${data.status}`, '',
    zh ? '这是生成期间逐项读取的内容，不是同一时刻的全量快照，也不支持恢复。附件只包含可见元数据；文件不包含账号凭据、撤回正文、原始引用正文、附件文件或本机 AI/App 数据。'
      : 'This contains reads made during the generation interval, not an atomic snapshot or a restorable backup. Attachments contain visible metadata only. Credentials, withdrawn text, original quoted bodies, media files and local AI/App data are excluded.',
    '', `## ${zh ? '导出范围与未完成项' : 'Coverage and incomplete sections'}`, '',
    zh ? '| 内容 | 结果 | 项数 |' : '| Section | Result | Items |', '| --- | --- | --- |',
    ...data.sections.map(section => `| ${cell(accountExportSectionLabel(data, section.name, locale))} | ${cell(zh ? ({ complete: '已读取', partial: '部分读取', unavailable: '读取失败' }[section.status]) : section.status)} | ${section.itemCount} |`),
    '', `## ${zh ? '本人资料' : 'My profile'}`, '',
    ...Object.entries(data.profile).map(([key, value]) => `- ${key}: ${printable(Array.isArray(value) ? value.join(', ') : value)}`),
    '', `## ${zh ? '设置' : 'Settings'}`, '',
    ...(data.settings ? data.settings.values.map(setting => `- ${printable(setting.name)}: ${printable(setting.value)}`) : [zh ? '未能读取设置。' : 'Settings unavailable.']),
    ...(data.settings ? ['', '```json', JSON.stringify(data.settings.notifications, null, 2), '```'] : []),
    '', `## ${zh ? '关系' : 'Relationships'}`, '',
    '| Type | Account | Name | Since | Note |', '| --- | --- | --- | --- | --- |',
    ...data.relationships.map(item => `| ${cell(item.kind)} | ${cell(item.handle || item.accountId)} | ${cell(item.displayName)} | ${cell(item.since)} | ${cell(item.note)} |`),
    '', `## ${zh ? '用户聊天' : 'Human conversations'}`, '',
  ];
  for (const chat of data.conversations) {
    lines.push(`### ${printable(chat.peerDisplayName || chat.peerHandle || chat.peerAccountId)}`, '',
      `${zh ? '会话' : 'Conversation'}: ${chat.chatId}`, '');
    for (const message of chat.messages) {
      const sender = message.senderAccountId === data.profile.accountId
        ? zh ? '我' : 'Me'
        : chat.peerDisplayName || chat.peerHandle || message.senderAccountId;
      lines.push(`**${printable(sender)} · ${message.createdAt} · ${message.type}**`, '');
      if (message.type === 'RECALL') lines.push(zh ? '（消息已撤回）' : '(Message recalled)');
      else if (message.text) lines.push(...printable(message.text).split(/\r?\n/).map(line => `> ${line}`));
      if (message.attachment) lines.push('', `${zh ? '附件元数据' : 'Attachment metadata'}: ${printable(JSON.stringify(message.attachment))}`);
      if (message.replyToMessageId) lines.push('', `${zh ? '回复消息' : 'Reply to message'}: ${message.replyToMessageId}`);
      lines.push('');
    }
  }
  return lines.join('\n') + '\n';
}
