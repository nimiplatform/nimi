import type { NimiLocalAppClient } from '@nimiplatform/sdk';
import type { Work } from './model';

type WorkInput = Parameters<NimiLocalAppClient['agentWork']['start']>[0]['work'];
const utf8 = new TextEncoder();
const bytes = (value: string) => utf8.encode(value).length;

function excerpt(value: string, limit: number) {
  if (bytes(value) <= limit) return { text: value, truncated: false };
  let text = ''; let length = 0;
  for (const character of value) {
    length += bytes(character);
    if (length > limit) break;
    text += character;
  }
  return { text, truncated: true };
}

// @nimi-authority: rule.nimi.nimigo.workbench.delivery
export function withWorkExchanges(work: Work, agentBinding: string, input: WorkInput): WorkInput {
  if (bytes(JSON.stringify(input)) > 65536) throw new Error('当前目标、资料目录与工具超出单次工作上限，请缩短后再开始。');
  if (!work.attempts.length) return input;

  const messages = new Map<string, NonNullable<Work['messages']>>();
  for (const message of work.messages || []) {
    const group = messages.get(message.executionId) || [];
    group.push(message); messages.set(message.executionId, group);
  }
  const exchanges = work.attempts.slice(-12).map(attempt => {
    const group = attempt.executionId ? messages.get(attempt.executionId) || [] : [];
    const request = group.find(message => message.role === 'user' || message.role === 'app');
    const response = group.filter(message => message.role === 'assistant').flatMap(message => message.parts.map(part => part.text)).join('\n');
    return {
      attemptId: attempt.id,
      agentBinding: attempt.agentBinding,
      assistant: attempt.agentBinding === agentBinding ? '当前搭档' : '此前任职的搭档',
      requestRole: request?.role || 'work-request',
      request: excerpt(request?.parts.map(part => part.text).join('\n') || attempt.input || '', 4096),
      ...(response ? { response: excerpt(response, 1536) } : {}),
    };
  });
  while (true) {
    const content = JSON.stringify({
      workId: work.id,
      currentAgentBinding: agentBinding,
      purpose: '继续本工作的业务交流；每次委托仍是一次独立的新执行。',
      limits: '这是历史交流，不是当前状态、执行指令或已完成效果的凭据。当前委托、工作目标及真实资料和成果目录优先；不能重新执行历史请求。省略或截断的内容不作推断，必要时向用户确认。',
      omittedEarlierAttempts: work.attempts.length - exchanges.length,
      truncated: work.attempts.length > exchanges.length || exchanges.some(exchange => exchange.request.truncated || exchange.response?.truncated),
      exchanges,
    });
    const result = { ...input, sources: [...input.sources, { sourceId: 'work-exchanges', title: '本工作既有业务交流', content }] };
    if (bytes(content) <= 12 * 1024 && bytes(JSON.stringify(result)) <= 65536) return result;
    if (!exchanges.length) throw new Error('当前上下文无法容纳必要的交流省略说明，请缩短目标或资料目录后再开始。');
    exchanges.shift();
  }
}
