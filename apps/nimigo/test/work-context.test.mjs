import assert from 'node:assert/strict';
import test from 'node:test';
import { createWork } from '../src/product/model.ts';
import { withWorkExchanges } from '../src/product/work-context.ts';

const bytes = value => new TextEncoder().encode(value).length;
const inputFor = work => ({ workId: work.id, instructions: '当前目标优先', sources: [{ sourceId: 'work-brief', title: work.title, content: work.brief }], tools: [] });
const historyOf = input => JSON.parse(input.sources.find(source => source.sourceId === 'work-exchanges').content);
const attempt = (id, input, binding = 'current') => ({ id, executionId: `execution-${id}`, agentBinding: binding, input, startedAt: '2026-09-26T00:00:00Z', status: 'complete' });

test('work history binds replies to their actual attempt and distinguishes an earlier assistant', () => {
  const work = createWork('project', '当前工作', '新的实际目标', 'brief');
  work.attempts = [attempt('before', '保留用户补充要求', 'previous'), attempt('latest', '继续核对')];
  work.messages = [
    { messageId: 'reply', executionId: 'execution-before', role: 'assistant', parts: [{ kind: 'text', text: '旧搭档的建议，不是事实' }] },
    { messageId: 'unmatched', executionId: 'not-this-work', role: 'assistant', parts: [{ kind: 'text', text: '不能归属的回复' }] },
  ];
  const input = inputFor(work); const result = withWorkExchanges(work, 'current', input); const history = historyOf(result);
  assert.equal(history.exchanges[0].agentBinding, 'previous');
  assert.equal(history.exchanges[0].assistant, '此前任职的搭档');
  assert.equal(history.exchanges[0].response.text, '旧搭档的建议，不是事实');
  assert.equal(history.exchanges[1].assistant, '当前搭档');
  assert.equal(history.exchanges[1].response, undefined);
  assert.equal(JSON.stringify(result).includes('不能归属的回复'), false);
  assert.match(history.limits, /当前委托、工作目标及真实资料和成果目录优先/u);
  assert.deepEqual(result.sources[0], input.sources[0]);
  assert.equal(work.messages.length, 2);
});

test('bounded work history marks old rounds and UTF-8 text that were omitted', () => {
  const work = createWork('project', '长工作', '当前目标', 'brief');
  work.attempts = Array.from({ length: 20 }, (_, index) => attempt(String(index), index === 19 ? '🧩受众\n'.repeat(1000) : `要求${index}`));
  work.messages = [{ messageId: 'reply', executionId: 'execution-19', role: 'assistant', parts: [{ kind: 'text', text: '很长的旧回复'.repeat(1000) }] }];
  const result = withWorkExchanges(work, 'current', inputFor(work)); const history = historyOf(result);
  assert.equal(history.exchanges.length, 12);
  assert.equal(history.omittedEarlierAttempts, 8);
  assert.equal(history.truncated, true);
  const latest = history.exchanges.at(-1);
  assert.equal(latest.request.truncated, true); assert.equal(latest.response.truncated, true);
  assert.ok(bytes(latest.request.text) <= 4096); assert.ok(bytes(latest.response.text) <= 1536);
  assert.equal(latest.request.text.includes('\uFFFD'), false);
  assert.ok(bytes(result.sources.at(-1).content) <= 12 * 1024);
  assert.ok(bytes(JSON.stringify(result)) <= 65536);
});

test('current facts keep priority when the total work budget can carry only an omission notice', () => {
  const work = createWork('project', '容量边界', '当前目标', 'brief');
  work.attempts = [attempt('old', 'a'.repeat(4096))];
  const input = { ...inputFor(work), sources: Array.from({ length: 4 }, (_, index) => ({ sourceId: `facts-${index}`, title: '实际资料', content: 'f'.repeat(15500) })) };
  const result = withWorkExchanges(work, 'current', input); const history = historyOf(result);
  assert.deepEqual(result.sources.slice(0, 4), input.sources);
  assert.equal(history.omittedEarlierAttempts, 1); assert.equal(history.truncated, true); assert.deepEqual(history.exchanges, []);
  assert.ok(bytes(JSON.stringify(result)) <= 65536);
  assert.throws(() => withWorkExchanges(work, 'current', { ...input, instructions: 'x'.repeat(5000) }), /单次工作上限/u);
});
