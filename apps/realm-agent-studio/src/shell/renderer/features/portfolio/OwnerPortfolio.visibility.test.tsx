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
    checkCreateRealmAgentHandleAvailability: vi.fn(async (handle: string) => ({
      ok: true,
      truthWrite: false,
      response: {
        available: handle !== 'taken.agent',
        normalized: handle,
        ...(handle === 'taken.agent' ? { message: 'Handle already taken.' } : {}),
      },
      availability: {
        checked: true,
        source: 'Realm AgentsService.agentControllerCheckHandle',
        handle,
        normalized: handle,
        available: handle !== 'taken.agent',
        ...(handle === 'taken.agent' ? { message: 'Handle already taken.' } : {}),
      },
    })),
    getOwnerAgentSettings: vi.fn(async () => ({
      agentId: 'agent-1',
      worldId: 'world-oasis',
      agentRuleVersion: 3,
      displayName: 'Mira',
      description: 'Quiet strategist',
      greeting: 'Welcome in.',
      naturalLanguageIntent: '',
      identity: {
        publicRole: 'Guide',
        worldview: 'Layered world.',
      },
      personality: {
        summary: 'Patient strategist.',
        relationshipMode: 'mentor',
        interests: ['strategy'],
        goals: ['keep lore coherent'],
      },
      communication: {
        contentStyle: 'Concise.',
        formality: 'casual',
        responseLength: 'medium',
        sentiment: 'neutral',
      },
      boundaries: {
        allowedThemes: ['adventure'],
        disallowedThemes: ['gore'],
      },
      positioning: {
        targetAudience: 'builders',
        positioning: 'guide',
      },
      updatedAt: '2026-05-21T00:00:00.000Z',
    })),
    getOwnerPortfolioAgentDetail: vi.fn(async (agentId: string) => ownerAgentDetail(agentId)),
    listOwnerPortfolioAgents: vi.fn(async () => [ownerAgent()]),
    listCreateRealmAgentSelectableWorlds: vi.fn(async () => [{
      id: 'world-oasis',
      name: 'OASIS',
      type: 'OASIS',
      status: 'ACTIVE',
      description: 'Main Realm world',
      tagline: 'Main world',
      source: 'Realm WorldsService.worldControllerListWorlds',
    }]),
    getCreateRealmAgentWorldPreview: vi.fn(async () => ({
      id: 'world-oasis',
      name: 'OASIS',
      type: 'OASIS',
      status: 'ACTIVE',
      contentRating: 'PG13',
      tagline: 'Main world',
      description: 'Main Realm world',
      overview: 'Shared source world.',
      themes: ['agent-ip'],
      agentCount: 3,
      nativeCreationState: 'OPEN',
      source: 'Realm WorldsService.worldControllerGetWorldDetailWithAgents',
    })),
    createReviewedRealmAgent: vi.fn(async () => ({
      ok: true,
      source: 'Realm AgentsService.agentControllerCreate',
      agent: {
        id: 'agent-created-ui',
        state: 'INCUBATING',
      },
      canonical: {
        id: 'agent-created-ui',
        state: 'INCUBATING',
      },
    })),
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
    uploadReviewedIdentityMediaResource: vi.fn(async () => ({
      ok: true,
      source: 'Realm ResourcesService direct upload + finalizeResource',
      attachmentTruth: true,
      publicTruth: false,
      session: {
        resourceId: 'resource-identity-ui',
        resourceType: 'IMAGE',
        status: 'PENDING',
      },
      resource: {
        id: 'resource-identity-ui',
        resourceType: 'IMAGE',
        status: 'READY',
        deliveryAccess: 'SIGNED',
      },
      canonical: {
        id: 'resource-identity-ui',
        resourceType: 'IMAGE',
        status: 'READY',
        deliveryAccess: 'SIGNED',
      },
    })),
    generateReviewedVisualImageCandidate: vi.fn(async () => ({
      ok: true,
      source: 'Runtime media.image.generate',
      candidate: true,
      publicTruth: false,
      draft: {
        candidate: true,
        publicTruth: false,
        source: 'realm-agent-studio.reviewed-visual-image-candidate',
        agentContext: {
          source: 'Realm MeService.getMyRealmAgent',
          agentKey: 'agent-1',
          handle: 'mira',
          displayName: 'Mira',
        },
        runtime: {
          capabilityToken: 'image.generate',
          currentSdkPath: 'media.image.generate',
          source: 'Runtime media.image.generate',
          request: {
            model: 'configured-image-model',
            prompt: 'portrait',
            metadata: {
              source: 'realm-agent-studio.reviewed-visual-image-candidate',
              agentKey: 'agent-1',
            },
          },
          status: 'candidate-ready',
        },
        futureEvidencePath: {
          resource: {
            carrier: 'Resource',
            type: 'IMAGE',
            status: 'candidate-only',
          },
          binding: {
            family: 'Binding',
            hostType: 'AGENT',
            objectType: 'RESOURCE',
            bindingPoint: 'AGENT_CANDIDATE',
            status: 'candidate-only',
          },
        },
      },
      runtime: {
        jobId: 'job-image-ui',
        artifactIds: ['artifact-image-ui'],
        artifactUris: ['runtime://artifact-image-ui'],
        traceId: 'trace-image-ui',
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
        rawRuleContentExposed: false,
      },
      submitted: {
        worldId: 'OASIS',
        contextEnvelope: {
          includeInheritedAgentRules: false,
        },
      },
    })),
    proposeReviewedOwnerAgentSettings: vi.fn(async () => ({
      ok: true,
      source: 'Runtime runtime.ai.text.generate',
      candidate: true,
      truthWrite: false,
      submitted: {
        model: 'configured-text-model',
        input: 'owner intent',
      },
      runtime: {
        traceId: 'trace-settings-ui',
      },
      proposal: {
        source: 'Runtime runtime.ai.text.generate',
        candidate: true,
        truthWrite: false,
        draftPatch: {
          worldview: 'Layered world, Runtime proposed.',
          contentStyle: 'Warm and concise.',
        },
        changedSettingKeys: ['worldview', 'contentStyle'],
        rationale: 'Runtime mapped the owner intent into visible fields.',
        rawText: '{"worldview":"Layered world, Runtime proposed.","contentStyle":"Warm and concise."}',
      },
    })),
    updateReviewedOwnerAgentSettings: vi.fn(async () => ({
      ok: true,
      source: 'Realm MeService.updateMyRealmAgentSettings',
      truthWrite: true,
      submitted: {
        displayName: 'Mira Prime',
        identity: {
          worldview: 'Layered world, owner revised.',
        },
      },
      settings: {
        agentId: 'agent-1',
        worldId: 'world-oasis',
        agentRuleVersion: 4,
        displayName: 'Mira Prime',
        description: 'Quiet strategist',
        greeting: 'Welcome in.',
        naturalLanguageIntent: null,
        identity: {
          publicRole: 'Guide',
          worldview: 'Layered world, owner revised.',
        },
        personality: {
          summary: 'Patient strategist.',
          relationshipMode: 'mentor',
          interests: ['strategy'],
          goals: ['keep lore coherent'],
        },
        communication: {
          contentStyle: 'Concise.',
          formality: 'casual',
          responseLength: 'medium',
          sentiment: 'neutral',
        },
        boundaries: {
          allowedThemes: ['adventure'],
          disallowedThemes: ['gore'],
        },
        positioning: {
          targetAudience: 'builders',
          positioning: 'guide',
        },
        updatedAt: '2026-05-22T00:00:00.000Z',
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
const { studioWorkspaceItems } = await import('../../app-shell/shell-layout.js');

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

function ownerAgentDetail(id = 'agent-1'): OwnerPortfolioAgentDetail {
  return {
    id,
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
          <OwnerPortfolioHarness />
        </QueryClientProvider>
      </NimiThemeProvider>,
    );
  });

  return container;
}

function OwnerPortfolioHarness() {
  const [activeWorkspace, setActiveWorkspace] = React.useState<(typeof studioWorkspaceItems)[number]['id']>('portfolio');

  return (
    <OwnerPortfolio activeWorkspace={activeWorkspace} onWorkspaceChange={setActiveWorkspace} />
  );
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

async function openWorkspace(label: string, expectedText: string) {
  await waitForText('PortfolioCreateDetailSettingsAssetsPostsSchedule');
  await act(async () => {
    findButtonByText(label).click();
  });
  await waitForText(expectedText);
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe('OwnerPortfolio visibility settings UI', () => {
  it('keeps Studio workspaces navigable without rendering every workflow at once', async () => {
    await renderOwnerPortfolio();
    await waitForText('Portfolio workspace');

    expect(document.body.textContent).toContain('PortfolioCreateDetailSettingsAssetsPostsSchedule');
    expect(document.body.textContent).not.toContain('Creative post candidate');
    expect(document.body.textContent).not.toContain('Owner settings');

    await openWorkspace('Posts', 'Creative post candidate');
    expect(document.body.textContent).not.toContain('Owner settings');

    await openWorkspace('Schedule', 'Local schedule candidate');
    expect(document.body.textContent).not.toContain('Creative post candidate');
  });

  it('checks create handle availability through Realm before create submit', async () => {
    await renderOwnerPortfolio();
    await openWorkspace('Create', 'Create Realm Agent');

    await changeField(findFieldByPlaceholder<HTMLInputElement>('@creator-agent'), '@Mira.Agent');

    await waitForText('Handle @mira.agent is available.');
    expect(portfolioClient.checkCreateRealmAgentHandleAvailability).toHaveBeenCalledWith('mira.agent');
    expect(document.body.textContent).toContain('Checked before submit');
  });

  it('opens the created agent detail and preserves public bio for post-create settings', async () => {
    await renderOwnerPortfolio();
    await openWorkspace('Create', 'Create Realm Agent');

    await changeField(findFieldByPlaceholder<HTMLInputElement>('@creator-agent'), '@New.Agent');
    await changeField(findFieldByPlaceholder<HTMLInputElement>('Creator Agent'), 'New Agent');
    await changeField(findFieldByPlaceholder<HTMLTextAreaElement>('Short public bio'), 'Public bio continues after create.');
    await changeField(findFieldByPlaceholder<HTMLTextAreaElement>('Creative concept'), 'Owner-created public agent concept.');
    await changeField(findFieldByPlaceholder<HTMLTextAreaElement>('Public-facing description'), 'Created from Studio.');

    await waitForText('Handle @new.agent is available.');
    const createButton = await waitForButtonEnabled('Create Realm Agent');
    await act(async () => {
      createButton.click();
    });

    await waitForText('Post-create draft preserved');
    await waitForText('Public bio continues after create.');
    expect(portfolioClient.createReviewedRealmAgent).toHaveBeenCalledWith(expect.objectContaining({
      publicFields: expect.objectContaining({
        publicBio: 'Public bio continues after create.',
      }),
      body: expect.not.objectContaining({
        publicBio: expect.anything(),
      }),
    }));
    expect(portfolioClient.getOwnerPortfolioAgentDetail).toHaveBeenCalledWith('agent-created-ui');
    expect(document.body.textContent).toContain('Public bio was intentionally not included in the Realm create request');
  });

  it('shows the human-review gate and lifecycle boundary for real visibility settings', async () => {
    await renderOwnerPortfolio();
    await openWorkspace('Settings', 'Visibility settings');
    await waitForText('Visibility technical review');

    expect(portfolioClient.getAgentVisibilitySettings).toHaveBeenCalledWith('agent-1');
    expect(document.body.textContent).toContain('Human review complete');
    expect(document.body.textContent).toContain('do not create lifecycle, moderation, or scheduling state');
    expect(findButtonByText('Save visibility').disabled).toBe(true);
    expect(portfolioClient.updateReviewedAgentVisibility).not.toHaveBeenCalled();
  });

  it('saves owner settings through MeService settings ingress and leaves raw rule review deferred', async () => {
    await renderOwnerPortfolio();
    await openWorkspace('Settings', 'Owner settings');
    await waitForText('Settings technical review');

    await changeField(findFieldByPlaceholder<HTMLInputElement>('Public display name'), 'Mira Prime');
    await changeField(findFieldByPlaceholder<HTMLTextAreaElement>('Public worldview and background'), 'Layered world, owner revised.');
    await changeField(findFieldByPlaceholder<HTMLTextAreaElement>('Advanced note for future rule-content review'), 'Raw rule candidate only.');

    await waitForText('ready for owner-reviewed settings save.');
    expect(findButtonByText('Save owner settings').disabled).toBe(true);

    await checkAllHumanReviewBoxes();
    const saveButton = await waitForButtonEnabled('Save owner settings');
    await act(async () => {
      saveButton.click();
    });

    await waitForText('Settings saved. The agent profile has been refreshed.');
    expect(portfolioClient.getOwnerAgentSettings).toHaveBeenCalledWith('agent-1');
    expect(portfolioClient.updateReviewedOwnerAgentSettings).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({
        displayName: 'Mira Prime',
        worldview: 'Layered world, owner revised.',
        rawRuleTextCandidate: 'Raw rule candidate only.',
      }),
      expect.objectContaining({
        agentId: 'agent-1',
        agentRuleVersion: 3,
      }),
    );
    expect(document.body.textContent).toContain('raw AgentRule review deferred');
  });

  it('applies a Runtime settings proposal as editable candidate fields before save', async () => {
    await renderOwnerPortfolio();
    await openWorkspace('Settings', 'Owner settings');

    await changeField(
      findFieldByPlaceholder<HTMLTextAreaElement>('Describe the owner-reviewed setting intent'),
      'Make Mira warmer and clearer.',
    );
    const proposeButton = await waitForButtonEnabled('Ask Runtime for proposal');
    await act(async () => {
      proposeButton.click();
    });

    await waitForText('Runtime mapped the owner intent into visible fields.');
    expect(portfolioClient.proposeReviewedOwnerAgentSettings).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({
        naturalLanguageIntent: 'Make Mira warmer and clearer.',
      }),
      expect.objectContaining({
        agentId: 'agent-1',
      }),
    );

    await act(async () => {
      findButtonByText('Apply proposal to fields').click();
    });

    expect(findFieldByPlaceholder<HTMLTextAreaElement>('Public worldview and background').value).toBe('Layered world, Runtime proposed.');
    expect(findFieldByPlaceholder<HTMLTextAreaElement>('Concise, pragmatic, warm...').value).toBe('Warm and concise.');
    expect(document.body.textContent).toContain('Runtime output is candidate material only.');
  });

  it('projects Runtime world context as a summary without raw rule review', async () => {
    await renderOwnerPortfolio();
    await openWorkspace('Settings', 'World context summary');

    await act(async () => {
      findButtonByText('Generate world context summary').click();
    });

    await waitForText('checksum-ui');
    expect(portfolioClient.projectAgentRuntimeContextSummary).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain('summary only');
    expect(document.body.textContent).toContain('read only');
    expect(document.body.textContent).toContain('rawRuleContentExposed');
    expect(document.body.textContent).not.toContain('Hidden raw rule statement');
  });

  it('keeps Resource-backed Agent Binding fail-closed behind backend admission', async () => {
    await renderOwnerPortfolio();
    await openWorkspace('Assets', 'Public asset publishing is not enabled yet');

    expect(document.body.textContent).toContain('will not publish them as profile assets yet');
    expect(document.body.textContent).not.toContain('Load binding Resources');
    expect(document.body.textContent).not.toContain('Check Binding candidate');
  });

  it('generates a Runtime image candidate into local creative history without public truth', async () => {
    await renderOwnerPortfolio();
    await openWorkspace('Assets', 'Runtime image candidate');

    await changeField(
      findFieldByPlaceholder<HTMLTextAreaElement>('Describe the avatar, portrait, or candidate visual'),
      'Warm portrait with blue accent.',
    );
    await changeField(
      findFieldByPlaceholder<HTMLInputElement>('Configured Runtime image model'),
      'configured-image-model',
    );

    const generateButton = await waitForButtonEnabled('Generate image candidate');
    await act(async () => {
      generateButton.click();
    });

    await waitForText('Image candidate generated for local review.');
    expect(portfolioClient.generateReviewedVisualImageCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Warm portrait with blue accent.',
        model: 'configured-image-model',
      }),
      expect.objectContaining({
        id: 'agent-1',
      }),
    );
    expect(document.body.textContent).toContain('Runtime image candidate');
    expect(document.body.textContent).toContain('runtime://artifact-image-ui');
    expect(document.body.textContent).toContain('Candidate history is stored on this desktop device');
    expect(document.body.textContent).toContain('Public profile binding remains separate');
  });

  it('uploads an identity Resource for local review without publishing a profile binding', async () => {
    await renderOwnerPortfolio();
    await openWorkspace('Assets', 'Upload identity Resource');

    const file = new File(['image-bytes'], 'identity.png', { type: 'image/png' });
    const fileInput = findFileInput();
    await act(async () => {
      Object.defineProperty(fileInput, 'files', {
        configurable: true,
        value: [file],
      });
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await checkAllHumanReviewBoxes();

    const uploadButton = await waitForButtonEnabled('Upload identity Resource');
    await act(async () => {
      uploadButton.click();
    });

    await waitForText('Identity Resource uploaded for local review as resource-identity-ui.');
    expect(portfolioClient.uploadReviewedIdentityMediaResource).toHaveBeenCalledWith(expect.objectContaining({
      resourceType: 'IMAGE',
      file,
      tags: ['realm-agent-studio', 'identity-candidate'],
    }));
    expect(document.body.textContent).toContain('Public profile binding remains deferred');
    expect(document.body.textContent).toContain('Identity Resource upload');
  });

  it('creates a reviewed text Resource and fills the post attachment envelope', async () => {
    await renderOwnerPortfolio();
    await openWorkspace('Posts', 'Creative post candidate');

    await changeField(findFieldByPlaceholder<HTMLTextAreaElement>('Draft caption for human review'), 'Reviewed caption for Resource');
    await checkAllHumanReviewBoxes();

    const createButton = await waitForButtonEnabled('Create text attachment');

    await act(async () => {
      createButton.click();
    });

    await waitForText('Text attachment created and selected: resource-text-ui.');
    expect(portfolioClient.createReviewedPostTextResource).toHaveBeenCalledTimes(1);
    expect(findFieldByPlaceholder<HTMLInputElement>('Attachment id').value).toBe('resource-text-ui');
    expect(document.body.textContent).toContain('Text attachment response');
  });

  it('loads owner READY Resource attachment options from Realm', async () => {
    await renderOwnerPortfolio();
    await openWorkspace('Posts', 'Creative post candidate');

    await act(async () => {
      findButtonByText('Load ready media').click();
    });

    await waitForText('Loaded 2 ready media attachment options.');
    expect(portfolioClient.listReadyPostAttachmentResources).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain('Choose an existing ready media item for this post.');
  });

  it('selects a READY Resource option into the post attachment envelope', async () => {
    await renderOwnerPortfolio();
    await openWorkspace('Posts', 'Creative post candidate');

    await act(async () => {
      findButtonByText('Load ready media').click();
    });
    await waitForText('Loaded 2 ready media attachment options.');

    const picker = findSelectByLabel('Ready media picker');
    await act(async () => {
      picker.value = 'resource-ready-ui';
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(findFieldByPlaceholder<HTMLInputElement>('Attachment id').value).toBe('resource-ready-ui');
    expect(document.body.textContent).toContain('Selected image media resource-ready-ui.');
  });

  it('uploads reviewed media Resource and fills the post attachment envelope', async () => {
    await renderOwnerPortfolio();
    await openWorkspace('Posts', 'Creative post candidate');
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

    const uploadButton = await waitForButtonEnabled('Upload media attachment');
    await act(async () => {
      uploadButton.click();
    });

    await waitForText('Media uploaded and attached as resource-upload-ui.');
    expect(portfolioClient.uploadReviewedPostMediaResource).toHaveBeenCalledTimes(1);
    expect(findFieldByPlaceholder<HTMLInputElement>('Attachment id').value).toBe('resource-upload-ui');
    expect(document.body.textContent).toContain('Publishing still requires review.');
  });
});
