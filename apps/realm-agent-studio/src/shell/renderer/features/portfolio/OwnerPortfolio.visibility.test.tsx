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
    createReviewedPostTextResource: vi.fn(async () => ({
      ok: true,
      source: 'Realm ResourcesService.createTextResource',
      attachmentTruth: true,
      resource: {
        id: 'resource-text-ui',
        resourceType: 'TEXT',
        status: 'READY',
        deliveryAccess: 'SIGNED',
      },
      canonical: {
        id: 'resource-text-ui',
        resourceType: 'TEXT',
        status: 'READY',
        deliveryAccess: 'SIGNED',
      },
    })),
    listReadyPostAttachmentResources: vi.fn(async () => [{
      id: 'resource-ready-ui',
      resourceType: 'IMAGE',
      status: 'READY',
      label: 'Ready image',
      deliveryAccess: 'SIGNED',
      source: 'Realm ResourcesService.listResources',
    }, {
      id: 'resource-ready-audio-ui',
      resourceType: 'AUDIO',
      status: 'READY',
      label: 'Ready audio',
      deliveryAccess: 'SIGNED',
      source: 'Realm ResourcesService.listResources',
    }]),
    bindReviewedAgentResource: vi.fn(async () => ({
      ok: true,
      source: 'Realm WorldControlService.worldControlControllerBatchUpsertWorldBindings',
      bindingTruth: true,
      publicProfileTruth: false,
      customVoiceTruth: false,
      publishTruth: false,
      binding: {
        worldId: 'OASIS',
        items: [],
      },
      canonical: {
        id: 'binding-ui',
        scopeWorldId: 'OASIS',
        hostId: 'agent-1',
        hostType: 'AGENT',
        objectId: 'resource-ready-ui',
        objectType: 'RESOURCE',
        bindingKind: 'PRESENTATION',
        bindingPoint: 'AGENT_PORTRAIT',
      },
      submitted: {
        worldId: 'OASIS',
        body: {
          bindingUpserts: [],
        },
      },
    })),
    uploadReviewedPostMediaResource: vi.fn(async () => ({
      ok: true,
      source: 'Realm ResourcesService direct upload + finalizeResource',
      attachmentTruth: true,
      publicTruth: false,
      session: {
        resourceId: 'resource-upload-ui',
        resourceType: 'IMAGE',
        status: 'PENDING',
      },
      resource: {
        id: 'resource-upload-ui',
        resourceType: 'IMAGE',
        status: 'READY',
        deliveryAccess: 'SIGNED',
      },
      canonical: {
        id: 'resource-upload-ui',
        resourceType: 'IMAGE',
        status: 'READY',
        deliveryAccess: 'SIGNED',
      },
    })),
    projectAgentRuntimeContextSummary: vi.fn(async () => ({
      ok: true,
      source: 'Realm RuntimeProjectionsService.projectRuntimePayload',
      truthWrite: false,
      summary: {
        source: 'Realm RuntimeProjectionsService.projectRuntimePayload',
        consumerSurface: 'RUNTIME_PAYLOAD',
        worldId: 'OASIS',
        checksum: 'checksum-ui',
        selectedInputCount: 2,
        suppressedInputCount: 1,
        worldRuleCount: 2,
        agentRuleCount: 0,
        rawRuleContentExposed: false,
      },
      submitted: {
        worldId: 'OASIS',
        contextEnvelope: {
          includeInheritedAgentRules: false,
        },
      },
    })),
    updateReviewedAgentVisibility: vi.fn(),
  };
});

vi.mock('@nimiplatform/nimi-kit/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nimiplatform/nimi-kit/ui')>();
  return {
    ...actual,
    SelectField: ({
      options,
      value,
      disabled,
      onValueChange,
      onChange,
      placeholder,
      ...props
    }: {
      options: Array<{ value: string; label: React.ReactNode; disabled?: boolean }>;
      value?: string;
      disabled?: boolean;
      onValueChange?: (value: string) => void;
      onChange?: (event: { target: { value: string }; currentTarget: { value: string } }) => void;
      placeholder?: string;
      [key: string]: unknown;
    }) => (
      <select
        aria-label={typeof placeholder === 'string' ? placeholder : undefined}
        disabled={disabled}
        value={value || ''}
        onChange={(event) => {
          onValueChange?.(event.currentTarget.value);
          onChange?.({ target: { value: event.currentTarget.value }, currentTarget: { value: event.currentTarget.value } });
        }}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    ),
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
    world: detailField('world', 'World id evidence', 'world-oasis'),
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

function findFieldByPlaceholder<TElement extends HTMLInputElement | HTMLTextAreaElement>(placeholder: string): TElement {
  const field = Array.from(document.querySelectorAll('input, textarea'))
    .find((candidate) => candidate.getAttribute('placeholder') === placeholder);
  if (!(field instanceof HTMLInputElement) && !(field instanceof HTMLTextAreaElement)) {
    throw new Error(`Field not found: ${placeholder}`);
  }
  return field as TElement;
}

function findSelectByLabel(label: string): HTMLSelectElement {
  const labels = Array.from(document.querySelectorAll('label'));
  const labelElement = labels.find((candidate) => candidate.textContent?.includes(label));
  if (!labelElement) {
    throw new Error(`Label not found: ${label}`);
  }
  const wrapper = labelElement.closest('div');
  const field = wrapper?.querySelector('select');
  if (!(field instanceof HTMLSelectElement)) {
    throw new Error(`Select not found for label: ${label}`);
  }
  return field;
}

function findFileInput(): HTMLInputElement {
  const input = Array.from(document.querySelectorAll('input[type="file"]'))
    .find((candidate): candidate is HTMLInputElement => candidate instanceof HTMLInputElement);
  if (!input) {
    throw new Error('File input not found');
  }
  return input;
}

async function changeField(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    valueSetter?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function checkAllHumanReviewBoxes() {
  const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'))
    .filter((candidate): candidate is HTMLInputElement => candidate instanceof HTMLInputElement);
  await act(async () => {
    for (const checkbox of checkboxes) {
      if (!checkbox.checked) {
        checkbox.click();
      }
    }
  });
}

async function waitForButtonEnabled(text: string): Promise<HTMLButtonElement> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 2000) {
    const button = findButtonByText(text);
    if (!button.disabled) {
      return button;
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
  throw new Error(`Timed out waiting for enabled button: ${text}`);
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
    await waitForText('PATCH sends only changed UpdateAgentVisibilityDto fields');

    expect(portfolioClient.getAgentVisibilitySettings).toHaveBeenCalledWith('agent-1');
    expect(document.body.textContent).toContain('Human review complete');
    expect(document.body.textContent).toContain('does not create publish, schedule, moderation, or lifecycle state');
    expect(findButtonByText('Save visibility').disabled).toBe(true);
    expect(portfolioClient.updateReviewedAgentVisibility).not.toHaveBeenCalled();
  });

  it('projects Runtime world context as a summary without raw rule review', async () => {
    await renderOwnerPortfolio();
    await waitForText('Runtime world context projection');

    await act(async () => {
      findButtonByText('Project Runtime context').click();
    });

    await waitForText('checksum-ui');
    expect(portfolioClient.projectAgentRuntimeContextSummary).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain('summary only');
    expect(document.body.textContent).toContain('not rule review');
    expect(document.body.textContent).toContain('rawRuleContentExposed');
    expect(document.body.textContent).not.toContain('Hidden raw rule statement');
  });

  it('binds a reviewed READY Resource to the agent without claiming profile truth', async () => {
    await renderOwnerPortfolio();
    await waitForText('Resource-backed Agent Binding');

    await act(async () => {
      findButtonByText('Load binding Resources').click();
    });
    await waitForText('Loaded 2 READY IMAGE/AUDIO Resource options for Agent Binding.');

    const picker = findSelectByLabel('READY IMAGE/AUDIO Resource');
    await act(async () => {
      picker.value = 'resource-ready-ui';
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await checkAllHumanReviewBoxes();
    await act(async () => {
      findButtonByText('Bind Resource to agent').click();
    });

    await waitForText('Realm confirmed AGENT_PORTRAIT Binding binding-ui');
    expect(portfolioClient.bindReviewedAgentResource).toHaveBeenCalledWith({
      agent: expect.objectContaining({ id: 'agent-1' }),
      resourceId: 'resource-ready-ui',
      resourceType: 'IMAGE',
      bindingPoint: 'AGENT_PORTRAIT',
      humanReviewed: true,
      intentPrompt: '',
    });
    expect(document.body.textContent).toContain('Public profile projection is not claimed');
    expect(document.body.textContent).toContain('No profile cover, avatar URL, custom voice, post, schedule, moderation, or lifecycle success is claimed');
  });

  it('creates a reviewed text Resource and fills the post attachment envelope', async () => {
    await renderOwnerPortfolio();
    await waitForText('Creative post candidate');

    await changeField(findFieldByPlaceholder<HTMLTextAreaElement>('Draft caption for human review'), 'Reviewed caption for Resource');
    await checkAllHumanReviewBoxes();

    const createButton = await waitForButtonEnabled('Create text Resource attachment');

    await act(async () => {
      createButton.click();
    });

    await waitForText('Realm confirmed READY TEXT resource resource-text-ui');
    expect(portfolioClient.createReviewedPostTextResource).toHaveBeenCalledTimes(1);
    expect(findFieldByPlaceholder<HTMLInputElement>('resource, asset, or bundle target').value).toBe('resource-text-ui');
    expect(document.body.textContent).toContain('RESOURCE + resourceId');
  });

  it('loads owner READY Resource attachment options from Realm', async () => {
    await renderOwnerPortfolio();
    await waitForText('Creative post candidate');

    await act(async () => {
      findButtonByText('Load ready Resources').click();
    });

    await waitForText('Loaded 2 READY Resource attachment options.');
    expect(portfolioClient.listReadyPostAttachmentResources).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain('Uses ResourcesService.listResources');
    expect(document.body.textContent).toContain('does not create Binding or profile asset truth');
  });

  it('selects a READY Resource option into the post attachment envelope', async () => {
    await renderOwnerPortfolio();
    await waitForText('Creative post candidate');

    await act(async () => {
      findButtonByText('Load ready Resources').click();
    });
    await waitForText('Loaded 2 READY Resource attachment options.');

    const picker = findSelectByLabel('READY Resource picker');
    await act(async () => {
      picker.value = 'resource-ready-ui';
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(findFieldByPlaceholder<HTMLInputElement>('resource, asset, or bundle target').value).toBe('resource-ready-ui');
    expect(document.body.textContent).toContain('Selected READY Resource(IMAGE) resource-ready-ui');
  });

  it('uploads reviewed media Resource and fills the post attachment envelope', async () => {
    await renderOwnerPortfolio();
    await waitForText('Creative post candidate');
    await checkAllHumanReviewBoxes();

    const file = new File(['image-bytes'], 'portrait.png', { type: 'image/png' });
    const fileInput = findFileInput();
    await act(async () => {
      Object.defineProperty(fileInput, 'files', {
        configurable: true,
        value: [file],
      });
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const uploadButton = await waitForButtonEnabled('Upload media Resource attachment');
    await act(async () => {
      uploadButton.click();
    });

    await waitForText('Realm finalized READY IMAGE resource resource-upload-ui');
    expect(portfolioClient.uploadReviewedPostMediaResource).toHaveBeenCalledTimes(1);
    expect(findFieldByPlaceholder<HTMLInputElement>('resource, asset, or bundle target').value).toBe('resource-upload-ui');
    expect(document.body.textContent).toContain('No Binding, profile asset, schedule, moderation, or post success is claimed here');
  });
});
