import type { HeroDemo } from './landing-content.js';

export const STORY_APPS = ['nimi.parentos', 'ai.nimi.videolingo', 'io.github.nimiplatform.next-ai-draw-io'] as const;
export const DEFAULT_STORY_AGENT = 'demo:emberware-court:character-0';
export const wrapGalleryIndex = (index: number, size: number) => ((index % size) + size) % size;
export function galleryDragSelection(index: number, deltaX: number, width: number, size: number) {
  return wrapGalleryIndex(index - Math.round(deltaX / Math.max(90, width * 0.25)), size);
}
export function storyAgent(demo: HeroDemo, id: string) {
  return demo.chat.agents.find(agent => agent.id === id) ?? demo.chat.agents[0]!;
}
// Copied from the public App Tools quickstart and generic starter; identifiers stay immutable.
export const CREATE_APP_COMMAND = 'pnpm dlx --package @nimiplatform/app-tools nimi-app create --dir my-editor-app --profile standalone --features studio-create --app-id com.example.editor --version 0.1.0 --title "Example Editor" --package-name example-editor --author "Your Team"';
export const SDK_EXAMPLE = `import { createNimiClient } from '@nimiplatform/sdk';
import { createNimiLocalAppStandardShellSurface }
  from '@nimiplatform/kit/shell/renderer/bridge';

const client = createNimiClient({
  localApp: {
    standardShell: createNimiLocalAppStandardShellSurface(),
  },
});

const { text } = await client.ai.text.generateCandidate({
  messages: [{ role: 'user', text: 'Summarize today’s notes.' }],
});`;

export const VERCEL_AI_EXAMPLE = `import { convertToModelMessages, isStepCount, streamText } from 'ai';
import { createNimiClient } from '@nimiplatform/sdk';
import { createNimiLocalAppStandardShellSurface } from '@nimiplatform/kit/shell/renderer/bridge';
import { createNimiLocalAppVercelLanguageModel } from '@nimiplatform/sdk-adapter-vercel-ai';

const client = createNimiClient({
  localApp: { standardShell: createNimiLocalAppStandardShellSurface() },
});
const model = createNimiLocalAppVercelLanguageModel({
  ai: client.ai,
  executionMode: 'sync',
});
const result = streamText({
  model,
  messages: await convertToModelMessages(uiMessages),
  stopWhen: isStepCount(5),
});`;
export function kitExample(action: string, result: string) {
  return `import { useState } from 'react';
import { Button } from '@nimiplatform/kit/ui';

export function MyApp() {
  const [active, setActive] = useState(false);
  return <div>
    <Button tone="primary" onClick={() => setActive(!active)}>
      {${JSON.stringify(action)}}
    </Button>
    {active && <p>{${JSON.stringify(result)}}</p>}
  </div>;
}`;
}
