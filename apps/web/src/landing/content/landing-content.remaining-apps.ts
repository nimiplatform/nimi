/** Static introductions to the remaining checked-out Apps; no live account or model data. */
export type RemainingPreviewMeta = {
  id: string;
  name: string;
  icon: string;
  notice: string;
};

export const remainingAppPreviewContent = {
  inscape: {
    id: 'nimi.inscape',
    name: 'Inscape 心相',
    icon: '/demo/inscape-icon.png',
    notice:
      '静态产品预览 · 面向成年人（18+）。探索内容与档案均为示例，不提供心理诊断，不保存个人资料。',
  },
  overtone: {
    id: 'nimi.overtone',
    name: 'Nimi Overtone',
    icon: '/demo/overtone-icon.png',
    notice: '静态产品预览 · 音乐方向、歌词与候选音轨均为示例；不会调用模型或生成音乐。',
  },
  polyagent: {
    id: 'nimi.polyagent',
    name: 'PolyAgent',
    icon: '/demo/polyagent-icon.png',
    notice:
      '静态产品预览 · 市场、资金与订单均为虚构的模拟示例；不连接钱包、不提供投资建议、不执行交易。',
  },
  persona: {
    id: 'nimi.realm-persona-studio',
    name: 'Realm Persona Studio',
    icon: '/demo/persona-studio-icon.png',
    notice: '静态产品预览 · 使用虚构角色与草稿，编辑仅在本次预览中保留，不创建或发布 Realm 角色。',
  },
  world: {
    id: 'nimi.realm-world-studio',
    name: 'Realm World Studio',
    icon: '/demo/world-studio-icon.png',
    notice: '静态产品预览 · 世界与角色设定均为示例，编辑仅在本次预览中保留，不写入 Realm。',
  },
  deeptutor: {
    id: 'org.nimiplatform.deeptutor',
    name: 'DeepTutor',
    icon: '/demo/deeptutor-icon.png',
    notice:
      'Static product preview · sample lessons, documents and responses. Nothing is uploaded and no model is called.',
  },
  openmontage: {
    id: 'openmontage.studio',
    name: 'OpenMontage',
    icon: '/demo/openmontage-icon.png',
    notice: '静态产品预览 · 制作方案、剧本与分镜均为示例；不会生成媒体、运行渲染或发布视频。',
  },
  sillytavern: {
    id: 'org.nimiplatform.sillytavern',
    name: 'SillyTavern',
    icon: '/demo/sillytavern-icon.png',
    notice:
      'Static product preview · fictional characters and scripted example replies. No character service or AI model is connected.',
  },
  vane: {
    id: 'nimiplatform.vane',
    name: 'Vane',
    icon: '/demo/vane-icon.png',
    notice:
      'Static product preview · a saved research example with illustrative sources. No web search or AI request is sent.',
  },
  drawio: {
    id: 'io.github.nimiplatform.next-ai-draw-io',
    name: 'Next AI Draw.io',
    icon: '/demo/drawio-icon.png',
    notice:
      'Static product preview · editable sample diagram and saved suggestions. No external editor or AI service is loaded.',
  },
  notebook: {
    id: 'io.github.nimiplatform.open-notebook',
    name: 'Open Notebook',
    icon: '/demo/open-notebook-icon.png',
    notice:
      'Static product preview · sample sources, notes and scripted answers. Edits stay in this preview; no documents are uploaded.',
  },
  presenton: {
    id: 'io.github.nimiplatform.presenton',
    name: 'Presenton',
    icon: '/demo/presenton-icon.png',
    notice:
      'Static product preview · edit a sample deck and explore presentation mode. No slides are generated, uploaded or exported.',
  },
} satisfies Record<string, RemainingPreviewMeta>;

export type RemainingAppPreviewContent = typeof remainingAppPreviewContent;
