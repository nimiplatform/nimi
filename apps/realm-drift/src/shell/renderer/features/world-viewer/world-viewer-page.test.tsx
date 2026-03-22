import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'viewer.back': 'Back',
        'viewer.regenerate': 'Regenerate',
        'viewer.tabAgents': 'Agents',
        'viewer.tabPeople': 'People',
        'viewer.qualityMini': 'Mini (~30s)',
        'viewer.qualityStandard': 'Standard (~5min)',
        'humanChat.friendListFailed': 'Failed to load friend list',
      };
      return map[key] ?? key;
    },
  }),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useParams: () => ({ worldId: 'w1' }),
  useNavigate: () => mockNavigate,
}));

const mockStore = {
  activeRightPanelTab: 'agents' as 'agents' | 'people',
  setActiveRightPanelTab: vi.fn(),
  setFriendList: vi.fn(),
  appendHumanChatMessage: vi.fn(),
  updateHumanMessage: vi.fn(),
  removeHumanMessage: vi.fn(),
  clearMarbleJob: vi.fn(),
  runtimeDefaults: null as null | { realm: { realtimeUrl: string; realmBaseUrl: string } },
  auth: { token: '', user: null },
};

vi.mock('@renderer/app-shell/app-store.js', () => ({
  useAppStore: Object.assign(
    (selector: (s: typeof mockStore) => unknown) => selector(mockStore),
    { getState: () => mockStore },
  ),
}));

const mockWorldQuery = {
  data: { id: 'w1', name: 'Eldoria', agents: [{ id: 'a1', name: 'Sage' }] },
  isLoading: false,
};
const mockWorldviewQuery = {
  data: { description: 'A vast continent' },
  isLoading: false,
};
const mockLorebooksQuery = { data: [] };

vi.mock('../world-browser/world-browser-queries.js', () => ({
  useWorldDetailWithAgentsQuery: () => mockWorldQuery,
  useWorldviewQuery: () => mockWorldviewQuery,
  useWorldLorebooksQuery: () => mockLorebooksQuery,
}));

vi.mock('./marble-viewer.js', () => ({
  MarbleViewer: ({ worldId, worldName }: { worldId: string; worldName: string }) => (
    <div data-testid="marble-viewer">Marble: {worldName} ({worldId})</div>
  ),
}));

vi.mock('../agent-chat/agent-chat-panel.js', () => ({
  AgentChatPanel: ({ agents }: { agents: Array<{ id: string; name: string }> }) => (
    <div data-testid="agent-chat-panel">Agents: {agents.length}</div>
  ),
}));

vi.mock('../human-chat/human-chat-panel.js', () => ({
  HumanChatPanel: () => <div data-testid="human-chat-panel">Human Chat</div>,
}));

vi.mock('../human-chat/realtime-connection.js', () => ({
  realtimeConnection: {
    connect: vi.fn(),
    disconnect: vi.fn(),
  },
}));

vi.mock('@nimiplatform/sdk', () => ({
  getPlatformClient: () => ({
    realm: {
      raw: {
        request: vi.fn().mockResolvedValue({ friends: [] }),
      },
    },
  }),
}));

import { WorldViewerPage } from './world-viewer-page.js';

describe('WorldViewerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.activeRightPanelTab = 'agents';
    mockStore.runtimeDefaults = null;
    mockStore.auth = { token: '', user: null };
  });

  it('renders page with world name, viewer and chat panels', () => {
    render(<WorldViewerPage />);

    expect(screen.getByText('Eldoria')).toBeDefined();
    expect(screen.getByTestId('marble-viewer')).toBeDefined();
    expect(screen.getByTestId('agent-chat-panel')).toBeDefined();
  });

  it('shows Back button that navigates home', () => {
    render(<WorldViewerPage />);

    fireEvent.click(screen.getByText('← Back'));
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  it('shows Regenerate button that clears marble job', () => {
    render(<WorldViewerPage />);

    fireEvent.click(screen.getByText('Regenerate'));
    expect(mockStore.clearMarbleJob).toHaveBeenCalledWith('w1');
  });

  it('switches between Agents and People tabs', () => {
    render(<WorldViewerPage />);

    expect(screen.getByTestId('agent-chat-panel')).toBeDefined();

    // Switch to people tab
    fireEvent.click(screen.getByText('People'));
    expect(mockStore.setActiveRightPanelTab).toHaveBeenCalledWith('people');
  });

  it('renders People tab when activeRightPanelTab is people', () => {
    mockStore.activeRightPanelTab = 'people';
    render(<WorldViewerPage />);

    expect(screen.getByTestId('human-chat-panel')).toBeDefined();
  });

  it('renders quality toggle with Mini and Standard buttons', () => {
    render(<WorldViewerPage />);

    expect(screen.getByText('Mini (~30s)')).toBeDefined();
    expect(screen.getByText('Standard (~5min)')).toBeDefined();
  });

  it('shows loading spinner when data is fetching', () => {
    mockWorldQuery.isLoading = true;
    const { container } = render(<WorldViewerPage />);

    const spinner = container.querySelector('.animate-spin');
    expect(spinner).not.toBeNull();

    mockWorldQuery.isLoading = false;
  });

  it('passes world context to MarbleViewer', () => {
    render(<WorldViewerPage />);

    const viewer = screen.getByTestId('marble-viewer');
    expect(viewer.textContent).toContain('Eldoria');
    expect(viewer.textContent).toContain('w1');
  });
});
