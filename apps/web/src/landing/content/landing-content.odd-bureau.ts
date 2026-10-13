import type { PreviewTranslate } from '../i18n/preview-messages.js';
import type { HeroDemoOddBureauMystery, HeroDemoOddBureauPreview } from './landing-content.js';

/**
 * Odd Bureau (nimi.odd-bureau, 奇物局) preview seeds, localized by Web for the
 * outer Landing locale. The photo is the app's own sample
 * scene (public/breakfast-scene.png, an AI-created sample per PRODUCT.md),
 * re-encoded as JPEG under /demo/odd-bureau/. The six objects follow the
 * app's vision.locate query order (杯子, 书本, 灯, 盆栽, 时钟, 水果) with boxes
 * measured on that image; everything Runtime text.generate would write in the
 * app (plans, mysteries, replies, the performance) is authored here and passes
 * the app's fixed rules (see demo-odd-bureau-rules.ts and the tests).
 */

const CUP = 'object-1';
const BOOK = 'object-2';
const LAMP = 'object-3';
const PLANT = 'object-4';
const CLOCK = 'object-5';
const ORANGE = 'object-6';

const missing = (t: PreviewTranslate): HeroDemoOddBureauMystery => ({
  mood: 'missing',
  title: t('oddBureau.missing.title'),
  incident: t('oddBureau.missing.incident'),
  opening: t('oddBureau.missing.opening'),
  culpritId: BOOK,
  resolution: t('oddBureau.missing.resolution'),
  decisiveEvidenceIds: [CLOCK, LAMP],
  characters: [
    {
      objectId: CUP,
      persona: t('oddBureau.missing.characters.cup.persona'),
      greeting: t('oddBureau.missing.characters.cup.greeting'),
      testimony: t('oddBureau.missing.characters.cup.testimony'),
      clueTitle: t('oddBureau.missing.characters.cup.clueTitle'),
      suggestedQuestion: t('oddBureau.missing.characters.cup.suggestedQuestion'),
      replies: [
        t('oddBureau.missing.characters.cup.replies.item1'),
        t('oddBureau.missing.characters.cup.replies.item2'),
      ],
    },
    {
      objectId: BOOK,
      persona: t('oddBureau.missing.characters.book.persona'),
      greeting: t('oddBureau.missing.characters.book.greeting'),
      testimony: t('oddBureau.missing.characters.book.testimony'),
      clueTitle: t('oddBureau.missing.characters.book.clueTitle'),
      suggestedQuestion: t('oddBureau.missing.characters.book.suggestedQuestion'),
      replies: [
        t('oddBureau.missing.characters.book.replies.item1'),
        t('oddBureau.missing.characters.book.replies.item2'),
      ],
    },
    {
      objectId: LAMP,
      persona: t('oddBureau.missing.characters.lamp.persona'),
      greeting: t('oddBureau.missing.characters.lamp.greeting'),
      testimony: t('oddBureau.missing.characters.lamp.testimony'),
      clueTitle: t('oddBureau.missing.characters.lamp.clueTitle'),
      suggestedQuestion: t('oddBureau.missing.characters.lamp.suggestedQuestion'),
      replies: [
        t('oddBureau.missing.characters.lamp.replies.item1'),
        t('oddBureau.missing.characters.lamp.replies.item2'),
      ],
    },
    {
      objectId: PLANT,
      persona: t('oddBureau.missing.characters.plant.persona'),
      greeting: t('oddBureau.missing.characters.plant.greeting'),
      testimony: t('oddBureau.missing.characters.plant.testimony'),
      clueTitle: t('oddBureau.missing.characters.plant.clueTitle'),
      suggestedQuestion: t('oddBureau.missing.characters.plant.suggestedQuestion'),
      replies: [
        t('oddBureau.missing.characters.plant.replies.item1'),
        t('oddBureau.missing.characters.plant.replies.item2'),
      ],
    },
    {
      objectId: CLOCK,
      persona: t('oddBureau.missing.characters.clock.persona'),
      greeting: t('oddBureau.missing.characters.clock.greeting'),
      testimony: t('oddBureau.missing.characters.clock.testimony'),
      clueTitle: t('oddBureau.missing.characters.clock.clueTitle'),
      suggestedQuestion: t('oddBureau.missing.characters.clock.suggestedQuestion'),
      replies: [
        t('oddBureau.missing.characters.clock.replies.item1'),
        t('oddBureau.missing.characters.clock.replies.item2'),
      ],
    },
    {
      objectId: ORANGE,
      persona: t('oddBureau.missing.characters.orange.persona'),
      greeting: t('oddBureau.missing.characters.orange.greeting'),
      testimony: t('oddBureau.missing.characters.orange.testimony'),
      clueTitle: t('oddBureau.missing.characters.orange.clueTitle'),
      suggestedQuestion: t('oddBureau.missing.characters.orange.suggestedQuestion'),
      replies: [
        t('oddBureau.missing.characters.orange.replies.item1'),
        t('oddBureau.missing.characters.orange.replies.item2'),
      ],
    },
  ],
});

const strike = (t: PreviewTranslate): HeroDemoOddBureauMystery => ({
  mood: 'strike',
  title: t('oddBureau.strike.title'),
  incident: t('oddBureau.strike.incident'),
  opening: t('oddBureau.strike.opening'),
  culpritId: PLANT,
  resolution: t('oddBureau.strike.resolution'),
  decisiveEvidenceIds: [CLOCK, CUP],
  characters: [
    {
      objectId: CUP,
      persona: t('oddBureau.strike.characters.cup.persona'),
      greeting: t('oddBureau.strike.characters.cup.greeting'),
      testimony: t('oddBureau.strike.characters.cup.testimony'),
      clueTitle: t('oddBureau.strike.characters.cup.clueTitle'),
      suggestedQuestion: t('oddBureau.strike.characters.cup.suggestedQuestion'),
      replies: [
        t('oddBureau.strike.characters.cup.replies.item1'),
        t('oddBureau.strike.characters.cup.replies.item2'),
      ],
    },
    {
      objectId: BOOK,
      persona: t('oddBureau.strike.characters.book.persona'),
      greeting: t('oddBureau.strike.characters.book.greeting'),
      testimony: t('oddBureau.strike.characters.book.testimony'),
      clueTitle: t('oddBureau.strike.characters.book.clueTitle'),
      suggestedQuestion: t('oddBureau.strike.characters.book.suggestedQuestion'),
      replies: [
        t('oddBureau.strike.characters.book.replies.item1'),
        t('oddBureau.strike.characters.book.replies.item2'),
      ],
    },
    {
      objectId: LAMP,
      persona: t('oddBureau.strike.characters.lamp.persona'),
      greeting: t('oddBureau.strike.characters.lamp.greeting'),
      testimony: t('oddBureau.strike.characters.lamp.testimony'),
      clueTitle: t('oddBureau.strike.characters.lamp.clueTitle'),
      suggestedQuestion: t('oddBureau.strike.characters.lamp.suggestedQuestion'),
      replies: [
        t('oddBureau.strike.characters.lamp.replies.item1'),
        t('oddBureau.strike.characters.lamp.replies.item2'),
      ],
    },
    {
      objectId: PLANT,
      persona: t('oddBureau.strike.characters.plant.persona'),
      greeting: t('oddBureau.strike.characters.plant.greeting'),
      testimony: t('oddBureau.strike.characters.plant.testimony'),
      clueTitle: t('oddBureau.strike.characters.plant.clueTitle'),
      suggestedQuestion: t('oddBureau.strike.characters.plant.suggestedQuestion'),
      replies: [
        t('oddBureau.strike.characters.plant.replies.item1'),
        t('oddBureau.strike.characters.plant.replies.item2'),
      ],
    },
    {
      objectId: CLOCK,
      persona: t('oddBureau.strike.characters.clock.persona'),
      greeting: t('oddBureau.strike.characters.clock.greeting'),
      testimony: t('oddBureau.strike.characters.clock.testimony'),
      clueTitle: t('oddBureau.strike.characters.clock.clueTitle'),
      suggestedQuestion: t('oddBureau.strike.characters.clock.suggestedQuestion'),
      replies: [
        t('oddBureau.strike.characters.clock.replies.item1'),
        t('oddBureau.strike.characters.clock.replies.item2'),
      ],
    },
    {
      objectId: ORANGE,
      persona: t('oddBureau.strike.characters.orange.persona'),
      greeting: t('oddBureau.strike.characters.orange.greeting'),
      testimony: t('oddBureau.strike.characters.orange.testimony'),
      clueTitle: t('oddBureau.strike.characters.orange.clueTitle'),
      suggestedQuestion: t('oddBureau.strike.characters.orange.suggestedQuestion'),
      replies: [
        t('oddBureau.strike.characters.orange.replies.item1'),
        t('oddBureau.strike.characters.orange.replies.item2'),
      ],
    },
  ],
});

const party = (t: PreviewTranslate): HeroDemoOddBureauMystery => ({
  mood: 'party',
  title: t('oddBureau.party.title'),
  incident: t('oddBureau.party.incident'),
  opening: t('oddBureau.party.opening'),
  culpritId: ORANGE,
  resolution: t('oddBureau.party.resolution'),
  decisiveEvidenceIds: [CUP, BOOK],
  characters: [
    {
      objectId: CUP,
      persona: t('oddBureau.party.characters.cup.persona'),
      greeting: t('oddBureau.party.characters.cup.greeting'),
      testimony: t('oddBureau.party.characters.cup.testimony'),
      clueTitle: t('oddBureau.party.characters.cup.clueTitle'),
      suggestedQuestion: t('oddBureau.party.characters.cup.suggestedQuestion'),
      replies: [
        t('oddBureau.party.characters.cup.replies.item1'),
        t('oddBureau.party.characters.cup.replies.item2'),
      ],
    },
    {
      objectId: BOOK,
      persona: t('oddBureau.party.characters.book.persona'),
      greeting: t('oddBureau.party.characters.book.greeting'),
      testimony: t('oddBureau.party.characters.book.testimony'),
      clueTitle: t('oddBureau.party.characters.book.clueTitle'),
      suggestedQuestion: t('oddBureau.party.characters.book.suggestedQuestion'),
      replies: [
        t('oddBureau.party.characters.book.replies.item1'),
        t('oddBureau.party.characters.book.replies.item2'),
      ],
    },
    {
      objectId: LAMP,
      persona: t('oddBureau.party.characters.lamp.persona'),
      greeting: t('oddBureau.party.characters.lamp.greeting'),
      testimony: t('oddBureau.party.characters.lamp.testimony'),
      clueTitle: t('oddBureau.party.characters.lamp.clueTitle'),
      suggestedQuestion: t('oddBureau.party.characters.lamp.suggestedQuestion'),
      replies: [
        t('oddBureau.party.characters.lamp.replies.item1'),
        t('oddBureau.party.characters.lamp.replies.item2'),
      ],
    },
    {
      objectId: PLANT,
      persona: t('oddBureau.party.characters.plant.persona'),
      greeting: t('oddBureau.party.characters.plant.greeting'),
      testimony: t('oddBureau.party.characters.plant.testimony'),
      clueTitle: t('oddBureau.party.characters.plant.clueTitle'),
      suggestedQuestion: t('oddBureau.party.characters.plant.suggestedQuestion'),
      replies: [
        t('oddBureau.party.characters.plant.replies.item1'),
        t('oddBureau.party.characters.plant.replies.item2'),
      ],
    },
    {
      objectId: CLOCK,
      persona: t('oddBureau.party.characters.clock.persona'),
      greeting: t('oddBureau.party.characters.clock.greeting'),
      testimony: t('oddBureau.party.characters.clock.testimony'),
      clueTitle: t('oddBureau.party.characters.clock.clueTitle'),
      suggestedQuestion: t('oddBureau.party.characters.clock.suggestedQuestion'),
      replies: [
        t('oddBureau.party.characters.clock.replies.item1'),
        t('oddBureau.party.characters.clock.replies.item2'),
      ],
    },
    {
      objectId: ORANGE,
      persona: t('oddBureau.party.characters.orange.persona'),
      greeting: t('oddBureau.party.characters.orange.greeting'),
      testimony: t('oddBureau.party.characters.orange.testimony'),
      clueTitle: t('oddBureau.party.characters.orange.clueTitle'),
      suggestedQuestion: t('oddBureau.party.characters.orange.suggestedQuestion'),
      replies: [
        t('oddBureau.party.characters.orange.replies.item1'),
        t('oddBureau.party.characters.orange.replies.item2'),
      ],
    },
  ],
});

export const createOddBureauPreviewContent = (t: PreviewTranslate): HeroDemoOddBureauPreview => ({
  appName: t('oddBureau.appName'),
  photo: {
    src: '/demo/odd-bureau/breakfast-scene.jpg',
    name: t('oddBureau.photo.name'),
    width: 1536,
    height: 1024,
  },
  props: [
    {
      id: CUP,
      label: t('oddBureau.props.cup.label'),
      box: { x1: 0.19, y1: 0.42, x2: 0.355, y2: 0.655 },
    },
    {
      id: BOOK,
      label: t('oddBureau.props.book.label'),
      box: { x1: 0.485, y1: 0.27, x2: 0.715, y2: 0.44 },
    },
    {
      id: LAMP,
      label: t('oddBureau.props.lamp.label'),
      box: { x1: 0.665, y1: 0.01, x2: 0.895, y2: 0.42 },
    },
    {
      id: PLANT,
      label: t('oddBureau.props.plant.label'),
      box: { x1: 0.125, y1: 0.06, x2: 0.345, y2: 0.42 },
    },
    {
      id: CLOCK,
      label: t('oddBureau.props.clock.label'),
      box: { x1: 0.35, y1: 0.165, x2: 0.46, y2: 0.37 },
    },
    {
      id: ORANGE,
      label: t('oddBureau.props.orange.label'),
      box: { x1: 0.375, y1: 0.41, x2: 0.535, y2: 0.595 },
    },
  ],
  machine: {
    title: t('oddBureau.machine.title'),
    invitation: t('oddBureau.machine.invitation'),
    nodes: [
      {
        objectId: CLOCK,
        op: 'source',
        melody: [0, 2, 1],
        line: t('oddBureau.machine.nodes.clock.line'),
      },
      { objectId: BOOK, op: 'reverse', melody: [], line: t('oddBureau.machine.nodes.book.line') },
      { objectId: LAMP, op: 'raise', melody: [], line: t('oddBureau.machine.nodes.lamp.line') },
      { objectId: PLANT, op: 'slow', melody: [], line: t('oddBureau.machine.nodes.plant.line') },
      { objectId: ORANGE, op: 'echo', melody: [], line: t('oddBureau.machine.nodes.orange.line') },
      { objectId: CUP, op: 'store', melody: [], line: t('oddBureau.machine.nodes.cup.line') },
    ],
  },
  strike: {
    title: t('oddBureau.strike.title2'),
    situation: t('oddBureau.strike.situation'),
    people: [
      {
        objectId: CUP,
        persona: t('oddBureau.strike.people.cup.persona'),
        offers: [
          { task: 'story', needsCredit: true, needsRest: null },
          { task: 'stage', needsCredit: false, needsRest: null },
        ],
      },
      {
        objectId: BOOK,
        persona: t('oddBureau.strike.people.book.persona'),
        offers: [
          { task: 'story', needsCredit: false, needsRest: null },
          { task: 'reading', needsCredit: false, needsRest: null },
        ],
      },
      {
        objectId: LAMP,
        persona: t('oddBureau.strike.people.lamp.persona'),
        offers: [
          { task: 'stage', needsCredit: false, needsRest: PLANT },
          { task: 'reading', needsCredit: false, needsRest: null },
        ],
      },
      {
        objectId: PLANT,
        persona: t('oddBureau.strike.people.plant.persona'),
        offers: [{ task: 'stage', needsCredit: false, needsRest: null }],
      },
      {
        objectId: CLOCK,
        persona: t('oddBureau.strike.people.clock.persona'),
        offers: [{ task: 'reading', needsCredit: true, needsRest: null }],
      },
      {
        objectId: ORANGE,
        persona: t('oddBureau.strike.people.orange.persona'),
        offers: [{ task: 'story', needsCredit: false, needsRest: null }],
      },
    ],
  },
  performance: [
    t('oddBureau.performance.item1'),
    t('oddBureau.performance.item2'),
    t('oddBureau.performance.item3'),
  ],
  mysteries: [missing(t), strike(t), party(t)],
  demo: {
    hostOnly: t('oddBureau.demo.hostOnly'),
    voice: t('oddBureau.demo.voice'),
    dismiss: t('oddBureau.demo.dismiss'),
  },
});
