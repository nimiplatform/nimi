import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DemoOddBureauPreview } from '../src/landing/components/demo-odd-bureau-preview.js';
import {
  commitPromises,
  editMachinePath,
  findStrikeSolution,
  hitProp,
  initialMachine,
  interpretProposalLocally,
  machineChallenge,
  runMachine,
  simulateMachine,
  strikeReady,
  TASKS,
  type Prop,
} from '../src/landing/components/demo-odd-bureau-rules.js';
import { oddBureauPreviewContent as content } from '../src/landing/content/landing-content.odd-bureau.js';
import { DEMO_PREVIEW_APP_IDS } from '../src/landing/components/demo-app-preview.js';
import { loadLandingContent } from '../src/landing/content/landing-content.js';

const props = content.props as unknown as Prop[];
const machine = { ...content.machine, nodes: content.machine.nodes.map((n) => ({ ...n, melody: [...n.melody] })) };
const strike = { ...content.strike, people: content.strike.people.map((p) => ({ ...p, offers: p.offers.map((o) => ({ ...o })) })) };

test('both locales share the Odd Bureau preview content and list 奇物局 as a previewable app', async () => {
  assert.ok(DEMO_PREVIEW_APP_IDS.includes('nimi.odd-bureau'));
  for (const locale of ['en', 'zh'] as const) {
    const landing = await loadLandingContent(locale);
    assert.equal(landing.hero.demo.appPreview.oddBureau, content);
    assert.ok(landing.hero.demo.apps.items.some((item) => item.id === 'nimi.odd-bureau'));
  }
});

test('the located objects follow the app constraints: 3–6 sequential ids, normalized boxes, no heavy overlap', () => {
  assert.ok(props.length >= 3 && props.length <= 6);
  props.forEach((prop, index) => {
    assert.equal(prop.id, `object-${index + 1}`);
    const { x1, y1, x2, y2 } = prop.box;
    assert.ok([x1, y1, x2, y2].every((n) => n >= 0 && n <= 1) && x1 < x2 && y1 < y2, prop.label);
  });
  // Every object hit-tests to itself at its own center.
  for (const prop of props) {
    const hit = hitProp(props, (prop.box.x1 + prop.box.x2) / 2, (prop.box.y1 + prop.box.y2) / 2);
    assert.ok(hit, prop.label);
  }
});

test('the authored machine plan passes the app rules and the challenge is solvable by connecting objects', () => {
  const goal = machineChallenge(machine, props);
  assert.equal(goal.path.length, 4, 'the challenge prefers the longest valid line');
  // Build the goal path the way the UI does: click the source, then each device.
  let path: string[] = [];
  for (const id of goal.path) path = editMachinePath(machine, path, id);
  assert.deepEqual(path, goal.path);
  let state = initialMachine();
  state = { ...state, path };
  const run = runMachine(machine, props, state);
  assert.equal(run.solved, true);
  assert.equal(run.runs, 1);
  assert.deepEqual(run.stored[goal.receiver], goal.notes);
  // A wrong line is rejected with the app's own message.
  assert.throws(() => simulateMachine(machine, props, ['object-1', 'object-5']), /「发声」出发/);
});

test('the authored strike plan is solvable, honors conditions, and can deadlock like the app', () => {
  const solution = findStrikeSolution(strike);
  assert.ok(solution);
  const committed = commitPromises(strike, [], solution);
  assert.equal(strikeReady(committed), true);
  assert.ok(TASKS.every((task) => committed.tasks[task]));
  // A conditional offer (灯 布置现场 needs 盆栽 to rest first) is refused until its condition holds.
  assert.throws(() => commitPromises(strike, [], [{ kind: 'assign', objectId: 'object-3', task: 'stage' }]), /先批准它指定的伙伴休息/);
  const withRest = commitPromises(strike, [], [{ kind: 'rest', objectId: 'object-4' }, { kind: 'assign', objectId: 'object-3', task: 'stage' }]);
  assert.equal(withRest.tasks.stage, 'object-3');
  // Granting the only rest to the only unconditional story writer besides 杯子 still leaves a solution; resting 书本 and 水果 both is impossible.
  assert.ok(findStrikeSolution(strike, [{ kind: 'rest', objectId: 'object-2' }]));
  assert.throws(() => commitPromises(strike, [{ kind: 'rest', objectId: 'object-2' }], [{ kind: 'rest', objectId: 'object-6' }]), /唯一的休假名额/);
  // The performance never leaks backstage words, as parsePerformance enforces in the app.
  assert.equal(content.performance.length, 3);
  for (const part of content.performance) assert.ok(!/署名|休假|罢工|名额|加班/.test(part), part);
});

test('the local proposal interpreter maps object names and action words to promise actions', () => {
  const parsed = interpretProposalLocally(strike, props, '先让盆栽休息，再请书本写故事，把署名给灯');
  assert.deepEqual(parsed.actions, [
    { kind: 'rest', objectId: 'object-4' },
    { kind: 'assign', objectId: 'object-2', task: 'story' },
    { kind: 'credit', objectId: 'object-3' },
  ]);
  const empty = interpretProposalLocally(strike, props, '大家今天心情怎么样？');
  assert.equal(empty.actions.length, 0);
  assert.ok(empty.reply.includes('休息'));
});

test('every mystery aligns with the props, keeps its culprit out of the testimony, and has two decisive clues', () => {
  const ids = props.map((p) => p.id);
  const moods = new Set<string>();
  for (const mystery of content.mysteries) {
    moods.add(mystery.mood);
    assert.ok(ids.includes(mystery.culpritId), mystery.title);
    assert.deepEqual(mystery.characters.map((c) => c.objectId).sort(), [...ids].sort(), mystery.title);
    assert.ok(mystery.decisiveEvidenceIds.length >= 2 && mystery.decisiveEvidenceIds.every((id) => ids.includes(id)));
    assert.ok(mystery.decisiveEvidenceIds.includes(mystery.culpritId) === false || mystery.decisiveEvidenceIds.length > 2);
    const culpritName = props.find((p) => p.id === mystery.culpritId)!.label;
    for (const character of mystery.characters) {
      assert.ok(!character.testimony.includes(culpritName), `${mystery.title}/${character.objectId} testimony names the culprit`);
      assert.ok(character.replies.length >= 2);
      assert.ok(character.clueTitle.length <= 10 && character.suggestedQuestion.length <= 25 && character.testimony.length <= 80);
    }
    assert.ok(!mystery.opening.includes(culpritName), `${mystery.title} opening names the culprit`);
  }
  assert.deepEqual([...moods].sort(), ['missing', 'party', 'strike']);
});

test('Odd Bureau preview mounts the playground lobby on the app class names', () => {
  const html = renderToStaticMarkup(createElement(DemoOddBureauPreview, { content }));
  assert.ok(html.includes('data-demo-odd-bureau-root="true"'));
  assert.ok(html.includes('data-odd-bureau-route="home"'));
  assert.ok(html.includes('class="odd-bureau playground"'));
  assert.ok(html.includes('aria-label="回到玩法选择"'));
  assert.ok(html.includes('ODD BUREAU'));
  assert.ok(html.includes('让日常，出一点意外。'));
  assert.ok(html.includes('照片探案'));
  assert.ok(html.includes('aria-label="能力设置"'));
  // Lobby: intro, photo stage on the sample scene, two activity choices, primary CTA following the selected activity.
  assert.ok(html.includes('class="trouble-word"'));
  assert.ok(html.includes(`src="${content.photo.src}"`));
  assert.ok(html.includes(content.photo.name));
  assert.ok(html.includes('AI 创作的试玩照片 · 开玩后，物品就会登场'));
  assert.ok(html.includes('class="selected" aria-pressed="true"'));
  assert.ok(html.includes('怪机器'));
  assert.ok(html.includes('罢工谈判'));
  assert.ok(html.includes('用这张照片，造台怪机器'));
  assert.ok(html.includes('换成我的照片'));
  assert.ok(html.includes('POWERED BY NIMI'));
  // Objects only appear once a round is prepared; the mystery and setup stay unmounted.
  assert.ok(!html.includes('class="play-object'));
  assert.ok(!html.includes('今天，查点什么？'));
  assert.ok(!html.includes('给游乐场接通 AI'));
});
