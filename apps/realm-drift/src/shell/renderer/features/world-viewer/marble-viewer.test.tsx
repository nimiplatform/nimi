import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'viewer.idle': 'Click Generate to create a 3D world',
        'viewer.generate': 'Generate 3D World',
        'viewer.generating': 'Generating...',
        'viewer.elapsed': `${opts?.seconds ?? 0}s elapsed`,
        'viewer.estimatedTimeMini': '~30s',
        'viewer.estimatedTimeStandard': '~5min',
        'viewer.cancel': 'Cancel',
        'viewer.error': 'Generation failed',
        'viewer.retry': 'Retry',
        'viewer.editPrompt': 'Edit Prompt',
        'viewer.missingApiKey': 'Marble API key is not configured.',
        'viewer.promptPreview': 'Prompt Preview',
        'viewer.pollTimeout': 'Generation timed out.',
        'viewer.generationFailed': 'Generation failed',
        'viewer.iframeTitle': 'Marble 3D Viewer',
        'error.rateLimited': 'Too many requests.',
        'error.unauthorized': 'Authentication expired.',
        'error.forbidden': 'No permission.',
        'error.serverError': 'Server error.',
      };
      return map[key] ?? key;
    },
  }),
}));

import type { MarbleJobState } from '@renderer/app-shell/app-store.js';

const mockStore: {
  marbleJobs: Record<string, MarbleJobState>;
  setMarbleJob: ReturnType<typeof vi.fn>;
  clearMarbleJob: ReturnType<typeof vi.fn>;
} = {
  marbleJobs: {},
  setMarbleJob: vi.fn(),
  clearMarbleJob: vi.fn(),
};

vi.mock('@renderer/app-shell/app-store.js', () => ({
  useAppStore: (selector: (s: typeof mockStore) => unknown) => selector(mockStore),
}));

const mockComposeMarblePrompt = vi.fn();
const mockFindWorldImageUrl = vi.fn();
const mockAssembleRawContext = vi.fn();

vi.mock('./marble-prompt.js', () => ({
  composeMarblePrompt: (...args: unknown[]) => mockComposeMarblePrompt(...args),
  findWorldImageUrl: (...args: unknown[]) => mockFindWorldImageUrl(...args),
  assembleRawContext: (...args: unknown[]) => mockAssembleRawContext(...args),
}));

const mockGenerate = vi.fn();
const mockPoll = vi.fn();

vi.mock('./marble-world-generator.js', () => ({
  MarbleWorldGenerator: class {
    generate(...args: unknown[]) { return mockGenerate(...args); }
    poll(...args: unknown[]) { return mockPoll(...args); }
  },
}));

vi.mock('./marble-api.js', () => ({
  marbleConfig: {
    getApiKey: () => 'test-api-key',
    getApiUrl: () => 'https://api.worldlabs.ai/marble/v1',
  },
}));

import { MarbleViewer } from './marble-viewer.js';
import type { RawWorldContext } from './marble-prompt.js';

function makeWorldContext(): RawWorldContext {
  return {
    world: {
      id: 'w1',
      name: 'Test World',
      description: 'A test world',
      agents: [],
    },
    worldview: { description: 'A vast land' },
    scenes: [],
    lorebooks: [],
  };
}

describe('MarbleViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.marbleJobs = {};
    mockAssembleRawContext.mockReturnValue('World: Test World\nDescription: A test world');
  });

  // --- Idle state ---
  it('renders idle state with generate button', () => {
    render(
      <MarbleViewer
        worldId="w1"
        worldName="Test World"
        worldContext={makeWorldContext()}
        quality="mini"
      />,
    );

    expect(screen.getByText('Click Generate to create a 3D world')).toBeDefined();
    expect(screen.getByText('Generate 3D World')).toBeDefined();
    expect(screen.getByText('Prompt Preview')).toBeDefined();
  });

  it('shows prompt preview in idle state', () => {
    render(
      <MarbleViewer
        worldId="w1"
        worldName="Test World"
        worldContext={makeWorldContext()}
        quality="mini"
      />,
    );

    expect(mockAssembleRawContext).toHaveBeenCalled();
    expect(screen.getByText('World: Test World', { exact: false })).toBeDefined();
  });

  it('disables generate button when no world context', () => {
    render(
      <MarbleViewer
        worldId="w1"
        worldName="Test World"
        worldContext={null}
        quality="mini"
      />,
    );

    const button = screen.getByText('Generate 3D World') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  // --- Generating state ---
  it('renders generating state with spinner and cancel', () => {
    mockStore.marbleJobs = {
      w1: {
        operationId: 'op-1',
        status: 'generating',
        startedAt: Date.now(),
      },
    };

    render(
      <MarbleViewer
        worldId="w1"
        worldName="Test World"
        worldContext={makeWorldContext()}
        quality="mini"
      />,
    );

    expect(screen.getByText('Generating...')).toBeDefined();
    expect(screen.getByText('Cancel')).toBeDefined();
    expect(screen.getByText('~30s')).toBeDefined();
  });

  it('shows standard estimated time for standard quality', () => {
    mockStore.marbleJobs = {
      w1: {
        operationId: 'op-1',
        status: 'generating',
        startedAt: Date.now(),
      },
    };

    render(
      <MarbleViewer
        worldId="w1"
        worldName="Test World"
        worldContext={makeWorldContext()}
        quality="standard"
      />,
    );

    expect(screen.getByText('~5min')).toBeDefined();
  });

  it('cancel button clears marble job', () => {
    mockStore.marbleJobs = {
      w1: {
        operationId: 'op-1',
        status: 'generating',
        startedAt: Date.now(),
      },
    };

    render(
      <MarbleViewer
        worldId="w1"
        worldName="Test World"
        worldContext={makeWorldContext()}
        quality="mini"
      />,
    );

    fireEvent.click(screen.getByText('Cancel'));
    expect(mockStore.clearMarbleJob).toHaveBeenCalledWith('w1');
  });

  // --- Failed state ---
  it('renders failed state with error and retry', () => {
    mockStore.marbleJobs = {
      w1: {
        operationId: 'op-1',
        status: 'failed',
        error: 'Something went wrong',
        startedAt: Date.now(),
      },
    };

    render(
      <MarbleViewer
        worldId="w1"
        worldName="Test World"
        worldContext={makeWorldContext()}
        quality="mini"
      />,
    );

    expect(screen.getByText('Something went wrong')).toBeDefined();
    expect(screen.getByText('Retry')).toBeDefined();
    expect(screen.getByText('Edit Prompt')).toBeDefined();
  });

  it('edit prompt button clears marble job', () => {
    mockStore.marbleJobs = {
      w1: {
        operationId: 'op-1',
        status: 'failed',
        error: 'Error',
        startedAt: Date.now(),
      },
    };

    render(
      <MarbleViewer
        worldId="w1"
        worldName="Test World"
        worldContext={makeWorldContext()}
        quality="mini"
      />,
    );

    fireEvent.click(screen.getByText('Edit Prompt'));
    expect(mockStore.clearMarbleJob).toHaveBeenCalledWith('w1');
  });

  // --- Completed state ---
  it('renders completed state with iframe', () => {
    mockStore.marbleJobs = {
      w1: {
        operationId: 'op-1',
        status: 'completed',
        viewerUrl: 'https://marble.worldlabs.ai/world/marble-w1',
        startedAt: Date.now(),
      },
    };

    render(
      <MarbleViewer
        worldId="w1"
        worldName="Test World"
        worldContext={makeWorldContext()}
        quality="mini"
      />,
    );

    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe).not.toBeNull();
    expect(iframe.src).toBe('https://marble.worldlabs.ai/world/marble-w1');
    expect(iframe.title).toBe('Marble 3D Viewer');
    expect(iframe.getAttribute('sandbox')).toContain('allow-scripts');
  });

  it('shows loading spinner before iframe loads', () => {
    mockStore.marbleJobs = {
      w1: {
        operationId: 'op-1',
        status: 'completed',
        viewerUrl: 'https://marble.worldlabs.ai/world/marble-w1',
        startedAt: Date.now(),
      },
    };

    const { container } = render(
      <MarbleViewer
        worldId="w1"
        worldName="Test World"
        worldContext={makeWorldContext()}
        quality="mini"
      />,
    );

    // Spinner visible before iframe load
    const spinner = container.querySelector('.animate-spin');
    expect(spinner).not.toBeNull();
  });

  it('hides loading spinner after iframe loads', async () => {
    mockStore.marbleJobs = {
      w1: {
        operationId: 'op-1',
        status: 'completed',
        viewerUrl: 'https://marble.worldlabs.ai/world/marble-w1',
        startedAt: Date.now(),
      },
    };

    const { container } = render(
      <MarbleViewer
        worldId="w1"
        worldName="Test World"
        worldContext={makeWorldContext()}
        quality="mini"
      />,
    );

    const iframe = document.querySelector('iframe')!;
    fireEvent.load(iframe);

    await waitFor(() => {
      const spinner = container.querySelector('.animate-spin');
      expect(spinner).toBeNull();
    });
  });

  // --- Generate flow ---
  it('triggers generation flow on generate click', async () => {
    mockComposeMarblePrompt.mockResolvedValue('A castle on a cliff');
    mockFindWorldImageUrl.mockReturnValue(undefined);
    mockGenerate.mockResolvedValue({ operationId: 'op-new' });
    mockPoll.mockReturnValue(
      (async function* () {
        yield {
          status: 'completed',
          viewerUrl: 'https://marble.worldlabs.ai/world/new-w1',
          worldId: 'new-w1',
          thumbnailUrl: null,
          error: null,
        };
      })(),
    );

    const ctx = makeWorldContext();

    render(
      <MarbleViewer
        worldId="w1"
        worldName="Test World"
        worldContext={ctx}
        quality="mini"
      />,
    );

    fireEvent.click(screen.getByText('Generate 3D World'));

    await waitFor(() => {
      expect(mockStore.setMarbleJob).toHaveBeenCalled();
    });

    // Should have called compose prompt
    expect(mockComposeMarblePrompt).toHaveBeenCalledWith(ctx, expect.any(AbortSignal));
  });

  // --- API key missing ---
  it('shows missing API key error', async () => {
    // Override marbleConfig for this test
    const marbleApiMod = await import('./marble-api.js');
    const origGetApiKey = marbleApiMod.marbleConfig.getApiKey;
    marbleApiMod.marbleConfig.getApiKey = () => '';

    render(
      <MarbleViewer
        worldId="w1"
        worldName="Test World"
        worldContext={makeWorldContext()}
        quality="mini"
      />,
    );

    fireEvent.click(screen.getByText('Generate 3D World'));

    await waitFor(() => {
      expect(mockStore.setMarbleJob).toHaveBeenCalledWith('w1', expect.objectContaining({
        status: 'failed',
        error: 'Marble API key is not configured.',
      }));
    });

    // Restore
    marbleApiMod.marbleConfig.getApiKey = origGetApiKey;
  });
});
