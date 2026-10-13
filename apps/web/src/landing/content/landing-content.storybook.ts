import type { PreviewTranslate } from '../i18n/preview-messages.js';
import type {
  HeroDemoStorybookNode,
  HeroDemoStorybookPreview,
  HeroDemoStorybookStory,
} from './landing-content.js';

/**
 * Storybook (nimi.storybook) preview seeds from the app's authored library
 * (nimiapp-storybook src/storybook/content/library.ts CURATED_STORIES). Web
 * localizes this bookshelf and its stories for the outer Landing locale.
 * Cover art is the app's own original illustrations copied under
 * /demo/storybook/.
 */

const scene = (
  id: string,
  title: string,
  text: string,
  choices: HeroDemoStorybookNode['choices'],
  speaker?: string,
): HeroDemoStorybookNode => ({ id, title, text, choices, speaker });
const ending = (id: string, title: string, text: string): HeroDemoStorybookNode => ({
  id,
  title,
  text,
  choices: [],
  ending: true,
});
const pick = (id: string, label: string, targetNodeId: string, trust?: number) => ({
  id,
  label,
  targetNodeId,
  trust,
});

const harborLetters = (t: PreviewTranslate): HeroDemoStorybookStory => ({
  id: 'harbor-letters',
  title: t('storybook.harborLetters.title'),
  subtitle: t('storybook.harborLetters.subtitle'),
  themes: [t('storybook.harborLetters.themes.item1'), t('storybook.harborLetters.themes.item2')],
  role: t('storybook.harborLetters.role'),
  cover: '/demo/storybook/harbor.jpg',
  cast: [
    {
      name: t('storybook.harborLetters.cast.item1.name'),
      voice: t('storybook.harborLetters.cast.item1.voice'),
      publicFacts: [
        t('storybook.harborLetters.cast.item1.publicFacts.item1'),
        t('storybook.harborLetters.cast.item1.publicFacts.item2'),
      ],
    },
    {
      name: t('storybook.harborLetters.cast.item2.name'),
      voice: t('storybook.harborLetters.cast.item2.voice'),
      publicFacts: [
        t('storybook.harborLetters.cast.item2.publicFacts.item1'),
        t('storybook.harborLetters.cast.item2.publicFacts.item2'),
      ],
    },
  ],
  nodes: [
    scene(
      'n1',
      t('storybook.harborLetters.nodes.item1.scene.n1.title'),
      t('storybook.harborLetters.nodes.item1.scene.n1.text'),
      [
        pick(
          'a',
          t('storybook.harborLetters.nodes.item1.scene.n1.choices.item1.pick.a.title'),
          'tower',
        ),
        pick(
          'b',
          t('storybook.harborLetters.nodes.item1.scene.n1.choices.item2.pick.b.title'),
          'inn',
        ),
      ],
    ),
    scene(
      'tower',
      t('storybook.harborLetters.nodes.item2.scene.tower.title'),
      t('storybook.harborLetters.nodes.item2.scene.tower.text'),
      [
        pick(
          'c',
          t('storybook.harborLetters.nodes.item2.scene.tower.choices.item1.pick.c.title'),
          'keeper',
        ),
        pick(
          'd',
          t('storybook.harborLetters.nodes.item2.scene.tower.choices.item2.pick.d.title'),
          'inspector',
        ),
      ],
    ),
    scene(
      'inn',
      t('storybook.harborLetters.nodes.item3.scene.inn.title'),
      t('storybook.harborLetters.nodes.item3.scene.inn.text'),
      [
        pick(
          'e',
          t('storybook.harborLetters.nodes.item3.scene.inn.choices.item1.pick.e.title'),
          'keeper',
          1,
        ),
        pick(
          'f',
          t('storybook.harborLetters.nodes.item3.scene.inn.choices.item2.pick.f.title'),
          'inspector',
          -1,
        ),
      ],
      t('storybook.harborLetters.nodes.item3.scene.inn.label'),
    ),
    scene(
      'keeper',
      t('storybook.harborLetters.nodes.item4.scene.keeper.title'),
      t('storybook.harborLetters.nodes.item4.scene.keeper.text'),
      [
        pick(
          'g',
          t('storybook.harborLetters.nodes.item4.scene.keeper.choices.item1.pick.g.title'),
          'departure',
          1,
        ),
        pick(
          'h',
          t('storybook.harborLetters.nodes.item4.scene.keeper.choices.item2.pick.h.title'),
          'confront',
        ),
      ],
      t('storybook.harborLetters.nodes.item4.scene.keeper.label'),
    ),
    scene(
      'inspector',
      t('storybook.harborLetters.nodes.item5.scene.inspector.title'),
      t('storybook.harborLetters.nodes.item5.scene.inspector.text'),
      [
        pick(
          'i',
          t('storybook.harborLetters.nodes.item5.scene.inspector.choices.item1.pick.i.title'),
          'keeper',
          1,
        ),
        pick(
          'j',
          t('storybook.harborLetters.nodes.item5.scene.inspector.choices.item2.pick.j.title'),
          'confront',
        ),
      ],
      t('storybook.harborLetters.nodes.item5.scene.inspector.label'),
    ),
    scene(
      'departure',
      t('storybook.harborLetters.nodes.item6.scene.departure.title'),
      t('storybook.harborLetters.nodes.item6.scene.departure.text'),
      [
        pick(
          'k',
          t('storybook.harborLetters.nodes.item6.scene.departure.choices.item1.pick.k.title'),
          'truth',
          1,
        ),
        pick(
          'l',
          t('storybook.harborLetters.nodes.item6.scene.departure.choices.item2.pick.l.title'),
          'mercy',
        ),
      ],
    ),
    scene(
      'confront',
      t('storybook.harborLetters.nodes.item7.scene.confront.title'),
      t('storybook.harborLetters.nodes.item7.scene.confront.text'),
      [
        pick(
          'm',
          t('storybook.harborLetters.nodes.item7.scene.confront.choices.item1.pick.m.title'),
          'truth',
        ),
        pick(
          'n',
          t('storybook.harborLetters.nodes.item7.scene.confront.choices.item2.pick.n.title'),
          'silence',
          -1,
        ),
      ],
      t('storybook.harborLetters.nodes.item7.scene.confront.label'),
    ),
    ending(
      'truth',
      t('storybook.harborLetters.nodes.item8.ending.truth.title'),
      t('storybook.harborLetters.nodes.item8.ending.truth.text'),
    ),
    ending(
      'mercy',
      t('storybook.harborLetters.nodes.item9.ending.mercy.title'),
      t('storybook.harborLetters.nodes.item9.ending.mercy.text'),
    ),
    ending(
      'silence',
      t('storybook.harborLetters.nodes.item10.ending.silence.title'),
      t('storybook.harborLetters.nodes.item10.ending.silence.text'),
    ),
  ],
  endings: [
    { id: 'truth', label: t('storybook.harborLetters.endings.truth.label') },
    { id: 'mercy', label: t('storybook.harborLetters.endings.mercy.label') },
    { id: 'silence', label: t('storybook.harborLetters.endings.silence.label') },
  ],
});

const lastTrain = (t: PreviewTranslate): HeroDemoStorybookStory => ({
  id: 'last-train',
  title: t('storybook.lastTrain.title'),
  subtitle: t('storybook.lastTrain.subtitle'),
  themes: [t('storybook.lastTrain.themes.item1'), t('storybook.lastTrain.themes.item2')],
  role: t('storybook.lastTrain.role'),
  cover: '/demo/storybook/train.jpg',
  cast: [
    {
      name: t('storybook.lastTrain.cast.item1.name'),
      voice: t('storybook.lastTrain.cast.item1.voice'),
      publicFacts: [
        t('storybook.lastTrain.cast.item1.publicFacts.item1'),
        t('storybook.lastTrain.cast.item1.publicFacts.item2'),
      ],
    },
    {
      name: t('storybook.lastTrain.cast.item2.name'),
      voice: t('storybook.lastTrain.cast.item2.voice'),
      publicFacts: [
        t('storybook.lastTrain.cast.item2.publicFacts.item1'),
        t('storybook.lastTrain.cast.item2.publicFacts.item2'),
      ],
    },
  ],
  nodes: [
    scene(
      'n1',
      t('storybook.lastTrain.nodes.item1.scene.n1.title'),
      t('storybook.lastTrain.nodes.item1.scene.n1.text'),
      [
        pick(
          'a',
          t('storybook.lastTrain.nodes.item1.scene.n1.choices.item1.pick.a.title'),
          'companion',
          1,
        ),
        pick(
          'b',
          t('storybook.lastTrain.nodes.item1.scene.n1.choices.item2.pick.b.title'),
          'conductor',
        ),
      ],
    ),
    scene(
      'companion',
      t('storybook.lastTrain.nodes.item2.scene.companion.title'),
      t('storybook.lastTrain.nodes.item2.scene.companion.text'),
      [
        pick(
          'c',
          t('storybook.lastTrain.nodes.item2.scene.companion.choices.item1.pick.c.title'),
          'firststop',
          1,
        ),
        pick(
          'd',
          t('storybook.lastTrain.nodes.item2.scene.companion.choices.item2.pick.d.title'),
          'letter',
        ),
      ],
      t('storybook.lastTrain.nodes.item2.scene.companion.label'),
    ),
    scene(
      'conductor',
      t('storybook.lastTrain.nodes.item3.scene.conductor.title'),
      t('storybook.lastTrain.nodes.item3.scene.conductor.text'),
      [
        pick(
          'e',
          t('storybook.lastTrain.nodes.item3.scene.conductor.choices.item1.pick.e.title'),
          'firststop',
          1,
        ),
        pick(
          'f',
          t('storybook.lastTrain.nodes.item3.scene.conductor.choices.item2.pick.f.title'),
          'letter',
        ),
      ],
      t('storybook.lastTrain.nodes.item3.scene.conductor.label'),
    ),
    scene(
      'firststop',
      t('storybook.lastTrain.nodes.item4.scene.firststop.title'),
      t('storybook.lastTrain.nodes.item4.scene.firststop.text'),
      [
        pick(
          'g',
          t('storybook.lastTrain.nodes.item4.scene.firststop.choices.item1.pick.g.title'),
          'goodbye',
          1,
        ),
        pick(
          'h',
          t('storybook.lastTrain.nodes.item4.scene.firststop.choices.item2.pick.h.title'),
          'company',
        ),
      ],
    ),
    scene(
      'letter',
      t('storybook.lastTrain.nodes.item5.scene.letter.title'),
      t('storybook.lastTrain.nodes.item5.scene.letter.text'),
      [
        pick(
          'i',
          t('storybook.lastTrain.nodes.item5.scene.letter.choices.item1.pick.i.title'),
          'company',
          1,
        ),
        pick(
          'j',
          t('storybook.lastTrain.nodes.item5.scene.letter.choices.item2.pick.j.title'),
          'goodbye',
          1,
        ),
      ],
      t('storybook.lastTrain.nodes.item5.scene.letter.label'),
    ),
    scene(
      'goodbye',
      t('storybook.lastTrain.nodes.item6.scene.goodbye.title'),
      t('storybook.lastTrain.nodes.item6.scene.goodbye.text'),
      [
        pick(
          'k',
          t('storybook.lastTrain.nodes.item6.scene.goodbye.choices.item1.pick.k.title'),
          'home',
        ),
        pick(
          'l',
          t('storybook.lastTrain.nodes.item6.scene.goodbye.choices.item2.pick.l.title'),
          'light',
        ),
      ],
    ),
    scene(
      'company',
      t('storybook.lastTrain.nodes.item7.scene.company.title'),
      t('storybook.lastTrain.nodes.item7.scene.company.text'),
      [
        pick(
          'm',
          t('storybook.lastTrain.nodes.item7.scene.company.choices.item1.pick.m.title'),
          'home',
        ),
        pick(
          'n',
          t('storybook.lastTrain.nodes.item7.scene.company.choices.item2.pick.n.title'),
          'light',
          1,
        ),
      ],
    ),
    ending(
      'home',
      t('storybook.lastTrain.nodes.item8.ending.home.title'),
      t('storybook.lastTrain.nodes.item8.ending.home.text'),
    ),
    ending(
      'light',
      t('storybook.lastTrain.nodes.item9.ending.light.title'),
      t('storybook.lastTrain.nodes.item9.ending.light.text'),
    ),
  ],
  endings: [
    { id: 'home', label: t('storybook.lastTrain.endings.home.label') },
    { id: 'light', label: t('storybook.lastTrain.endings.light.label') },
  ],
});

const rainPost = (t: PreviewTranslate): HeroDemoStorybookStory => ({
  id: 'rain-post',
  title: t('storybook.rainPost.title'),
  subtitle: t('storybook.rainPost.subtitle'),
  themes: [t('storybook.rainPost.themes.item1'), t('storybook.rainPost.themes.item2')],
  role: t('storybook.rainPost.role'),
  cover: '/demo/storybook/garden.jpg',
  cast: [
    {
      name: t('storybook.rainPost.cast.item1.name'),
      voice: t('storybook.rainPost.cast.item1.voice'),
      publicFacts: [
        t('storybook.rainPost.cast.item1.publicFacts.item1'),
        t('storybook.rainPost.cast.item1.publicFacts.item2'),
      ],
    },
  ],
  nodes: [
    scene(
      'n1',
      t('storybook.rainPost.nodes.item1.scene.n1.title'),
      t('storybook.rainPost.nodes.item1.scene.n1.text'),
      [
        pick('a', t('storybook.rainPost.nodes.item1.scene.n1.choices.item1.pick.a.title'), 'price'),
        pick('b', t('storybook.rainPost.nodes.item1.scene.n1.choices.item2.pick.b.title'), 'open'),
      ],
      t('storybook.rainPost.nodes.item1.scene.n1.label'),
    ),
    scene(
      'price',
      t('storybook.rainPost.nodes.item2.scene.price.title'),
      t('storybook.rainPost.nodes.item2.scene.price.text'),
      [
        pick(
          'c',
          t('storybook.rainPost.nodes.item2.scene.price.choices.item1.pick.c.title'),
          'open',
        ),
        pick(
          'd',
          t('storybook.rainPost.nodes.item2.scene.price.choices.item2.pick.d.title'),
          'bottle',
          1,
        ),
      ],
      t('storybook.rainPost.nodes.item2.scene.price.label'),
    ),
    scene(
      'open',
      t('storybook.rainPost.nodes.item3.scene.open.title'),
      t('storybook.rainPost.nodes.item3.scene.open.text'),
      [
        pick(
          'e',
          t('storybook.rainPost.nodes.item3.scene.open.choices.item1.pick.e.title'),
          'reply',
        ),
        pick(
          'f',
          t('storybook.rainPost.nodes.item3.scene.open.choices.item2.pick.f.title'),
          'bottle',
          1,
        ),
      ],
    ),
    scene(
      'bottle',
      t('storybook.rainPost.nodes.item4.scene.bottle.title'),
      t('storybook.rainPost.nodes.item4.scene.bottle.text'),
      [
        pick(
          'g',
          t('storybook.rainPost.nodes.item4.scene.bottle.choices.item1.pick.g.title'),
          'reply',
          1,
        ),
        pick(
          'h',
          t('storybook.rainPost.nodes.item4.scene.bottle.choices.item2.pick.h.title'),
          'leave',
          1,
        ),
      ],
      t('storybook.rainPost.nodes.item4.scene.bottle.label'),
    ),
    scene(
      'reply',
      t('storybook.rainPost.nodes.item5.scene.reply.title'),
      t('storybook.rainPost.nodes.item5.scene.reply.text'),
      [
        pick(
          'i',
          t('storybook.rainPost.nodes.item5.scene.reply.choices.item1.pick.i.title'),
          'tomorrow',
        ),
        pick(
          'j',
          t('storybook.rainPost.nodes.item5.scene.reply.choices.item2.pick.j.title'),
          'ordinary',
        ),
      ],
    ),
    scene(
      'leave',
      t('storybook.rainPost.nodes.item6.scene.leave.title'),
      t('storybook.rainPost.nodes.item6.scene.leave.text'),
      [
        pick(
          'k',
          t('storybook.rainPost.nodes.item6.scene.leave.choices.item1.pick.k.title'),
          'ordinary',
        ),
        pick(
          'l',
          t('storybook.rainPost.nodes.item6.scene.leave.choices.item2.pick.l.title'),
          'tomorrow',
        ),
      ],
    ),
    ending(
      'tomorrow',
      t('storybook.rainPost.nodes.item7.ending.tomorrow.title'),
      t('storybook.rainPost.nodes.item7.ending.tomorrow.text'),
    ),
    ending(
      'ordinary',
      t('storybook.rainPost.nodes.item8.ending.ordinary.title'),
      t('storybook.rainPost.nodes.item8.ending.ordinary.text'),
    ),
  ],
  endings: [
    { id: 'tomorrow', label: t('storybook.rainPost.endings.tomorrow.label') },
    { id: 'ordinary', label: t('storybook.rainPost.endings.ordinary.label') },
  ],
});

export const createStorybookPreviewContent = (t: PreviewTranslate): HeroDemoStorybookPreview => ({
  appName: 'Storybook',
  stories: [harborLetters(t), lastTrain(t), rainPost(t)],
  runs: [
    // A run left mid-story yesterday evening, and one finished last week.
    { id: 'run-train', storyId: 'last-train', path: ['a', 'c'], minutesAgo: 14 * 60 + 20 },
    { id: 'run-rain', storyId: 'rain-post', path: ['b', 'e', 'i'], minutesAgo: 6 * 24 * 60 },
  ],
  intakeSeeds: [
    {
      label: t('storybook.intakeSeeds.item1.label'),
      text: t('storybook.intakeSeeds.item1.text'),
    },
    {
      label: t('storybook.intakeSeeds.item2.label'),
      text: t('storybook.intakeSeeds.item2.text'),
    },
    {
      label: t('storybook.intakeSeeds.item3.label'),
      text: t('storybook.intakeSeeds.item3.text'),
    },
  ],
  intakeDirections: [
    t('storybook.intakeDirections.item1'),
    t('storybook.intakeDirections.item2'),
    t('storybook.intakeDirections.item3'),
    t('storybook.intakeDirections.item4'),
  ],
  // Scripted stand-ins for the app's Runtime-generated in-character replies
  // (play.free-text). The preview cycles through them per improv turn.
  improvReplies: [
    t('storybook.improvReplies.item1'),
    t('storybook.improvReplies.item2'),
    t('storybook.improvReplies.item3'),
  ],
  studioProject: {
    name: t('storybook.studioProject.name'),
    premise: t('storybook.studioProject.premise'),
    status: t('storybook.studioProject.status'),
    minutesAgo: 3 * 24 * 60,
  },
  settings: {
    accountName: t('storybook.settings.accountName'),
    accountNote: t('storybook.settings.accountNote'),
    modelLabel: t('storybook.settings.modelLabel'),
    modelNote: t('storybook.settings.modelNote'),
  },
  demo: {
    hostOnly: t('storybook.demo.hostOnly'),
    dismiss: t('storybook.demo.dismiss'),
  },
});
