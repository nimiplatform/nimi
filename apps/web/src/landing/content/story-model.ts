import type { HeroDemo } from './landing-content.js';

export const STORY_SECTIONS = ['apps', 'worlds', 'models', 'integrations', 'risk-control', 'developers'] as const;
export const STORY_APPS = ['nimi.parentos', 'ai.nimi.videolingo', 'io.github.nimiplatform.next-ai-draw-io'] as const;
export const DEFAULT_STORY_AGENT = 'demo:emberware-court:character-0';
export const wrapGalleryIndex = (index: number, size: number) => ((index % size) + size) % size;
export function galleryDragSelection(index: number, deltaX: number, width: number, size: number) {
  return wrapGalleryIndex(index - Math.round(deltaX / Math.max(90, width * 0.25)), size);
}
export function storyAgent(demo: HeroDemo, id: string) {
  return demo.chat.agents.find(agent => agent.id === id) ?? demo.chat.agents[0]!;
}
export const integrationScenarios = {
  mcp: { service: 'MCP', icon: '/demo/integration-logos/mcp.svg', consumer: 'NimiGo' },
  telegram: { service: 'Telegram', icon: '/demo/integration-logos/telegram.svg', consumer: 'NimiDay' },
  app: { service: 'NimiGo · v1', icon: '/story/nimigo-icon.png', consumer: 'NimiDay' },
} as const;

// Copied from the public App Tools quickstart and generic starter; identifiers stay immutable.
export const CREATE_APP_COMMAND = 'pnpm dlx --package @nimiplatform/app-tools nimi-app create --dir my-editor-app --profile standalone --features studio-create --app-id com.example.editor --version 0.1.0 --title "Example Editor" --package-name example-editor --author "Your Team"';
export const SDK_EXAMPLE = `import { createNimiClient } from '@nimiplatform/sdk';
import { createNimiLocalAppStandardShellSurface }
  from '@nimiplatform/kit/shell/renderer/bridge';

const client = createNimiClient({
  localApp: {
    standardShell:
      createNimiLocalAppStandardShellSurface(),
  },
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
