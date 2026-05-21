import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NimiThemeProvider } from '@nimiplatform/nimi-kit/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OwnerPortfolioAgent, OwnerPortfolioAgentDetail, SettingField } from './portfolio-data.js';

vi.mock('./portfolio-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./portfolio-client.js')>();
  return {
    ...actual,
    getAgentVisibilitySettings: vi.fn(async () => ({
      accountVisibility: 'PUBLIC',
      defaultPostVisibility: 'PUBLIC',
      dmVisibility: 'FRIENDS',
      profileVisibility: 'PUBLIC',
    })),
    getOwnerPortfolioAgentDetail: vi.fn(async () => ownerAgentDetail()),
    listOwnerPortfolioAgents: vi.fn(async () => [ownerAgent()]),
    updateReviewedAgentVisibility: vi.fn(),
  };
});

const { OwnerPortfolio } = await import('./OwnerPortfolio.js');
const portfolioClient = await import('./portfolio-client.js');

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function detailField(key: SettingField['key'], label: string, value: string): SettingField {
  return {
    key,
    label,
    value,
    status: value ? 'available' : 'source-unavailable',
    source: 'Realm MeService.getMyRealmAgent',
    readOnly: true,
    ...(value ? {} : { unavailableLabel: 'setting read unavailable' }),
  };
}

function ownerAgent(): OwnerPortfolioAgent {
  return {
    id: 'agent-1',
    displayName: 'Mira',
    handle: 'mira',
    coverUrl: null,
    avatarUrl: null,
    ownerScope: 'owner-created',
    source: 'Realm MeService.listMyRealmAgents',
    realmState: 'ACTIVE',
    worldName: 'OASIS',
    updatedAt: '2026-05-21T00:00:00.000Z',
    friendCount: { status: 'available', value: 3 },
  };
}

function ownerAgentDetail(): OwnerPortfolioAgentDetail {
  return {
    id: 'agent-1',
    displayName: detailField('displayName', 'Display name', 'Mira'),
    handle: detailField('handle', 'Handle', 'mira'),
    bio: detailField('bio', 'Bio', 'Visible public bio'),
    greeting: detailField('greeting', 'Greeting', 'Welcome in.'),
    profileCoverUrl: detailField('profileCoverUrl', 'Profile cover URL', ''),
    ownership: detailField('ownership', 'Ownership evidence', 'MASTER_OWNED'),
    world: detailField('world', 'World evidence', 'OASIS'),
    state: detailField('state', 'State evidence', 'ACTIVE'),
    avatarUrl: null,
    friendCount: { status: 'available', value: 3 },
    source: 'Realm MeService.getMyRealmAgent',
  };
}

async function renderOwnerPortfolio() {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });

  await act(async () => {
    root?.render(
      <NimiThemeProvider accentPack="nimi-accent" defaultScheme="light">
        <QueryClientProvider client={queryClient}>
          <OwnerPortfolio />
        </QueryClientProvider>
      </NimiThemeProvider>,
    );
  });

  return container;
}

async function waitForText(text: string): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 2000) {
    if (document.body.textContent?.includes(text)) {
      return;
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
  throw new Error(`Timed out waiting for text: ${text}`);
}

function findButtonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button'))
    .find((candidate) => candidate.textContent?.includes(text));
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${text}`);
  }
  return button;
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

describe('OwnerPortfolio visibility settings UI', () => {
  it('shows the human-review gate and lifecycle boundary for real visibility settings', async () => {
    await renderOwnerPortfolio();
    await waitForText('Visibility settings');

    expect(portfolioClient.getAgentVisibilitySettings).toHaveBeenCalledWith('agent-1');
    expect(document.body.textContent).toContain('Human review complete');
    expect(document.body.textContent).toContain('does not create publish, schedule, moderation, or lifecycle state');
    expect(document.body.textContent).toContain('PATCH sends only changed UpdateAgentVisibilityDto fields');
    expect(findButtonByText('Save visibility').disabled).toBe(true);
    expect(portfolioClient.updateReviewedAgentVisibility).not.toHaveBeenCalled();
  });
});
