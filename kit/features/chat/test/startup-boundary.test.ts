import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

describe('chat startup boundaries', () => {
  it('keeps canonical secondary panels behind lazy imports', () => {
    const source = read('src/components/canonical-conversation-shell.tsx');

    expect(source).toMatch(/const CanonicalStagePanel = lazy\(async \(\) => \{/);
    expect(source).toMatch(/const CanonicalCharacterRail = lazy\(async \(\) => \{/);
    expect(source).not.toMatch(/import \{ CanonicalStagePanel[^}]*\} from '\.\/canonical-stage-panel\.js'/);
  });

  it('keeps markdown and RP renderers behind lazy imports', () => {
    const source = read('src/components/canonical-message-bubble.tsx');

    expect(source).toMatch(/const ChatMarkdownRenderer = lazy\(async \(\) => \{/);
    expect(source).toMatch(/const RpContentRenderer = lazy\(async \(\) => \{/);
    expect(source).not.toMatch(/import \{ ChatMarkdownRenderer \} from '\.\/chat-markdown-renderer\.js'/);
  });

  it('loads the SDK contract through the Kit boundary instead of the SDK barrel', () => {
    const source = read('src/runtime/orchestration.ts');

    expect(source).not.toMatch(/import \{ getPlatformClient \} from '@nimiplatform\/sdk'/);
    expect(source).toMatch(/import\('@nimiplatform\/kit\/core\/sdk-contract'\)/);
  });
});
