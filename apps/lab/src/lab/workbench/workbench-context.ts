import { labCapabilities, type LabCapability, type LabCapabilityId } from '../lab-capabilities.js';

export type WorkbenchView =
  | { kind: 'capability'; capabilityId: LabCapabilityId }
  | { kind: 'ui-recipes' }
  | { kind: 'app-access' }
  | { kind: 'activity' }
  | { kind: 'agent-center' }
  | { kind: 'agent-conversation' }
  | { kind: 'agent-realtime' }
  | { kind: 'settings' };

export type WorkbenchNavGroup = {
  id: 'text' | 'image-video' | 'voice-music' | 'world';
  labelKey: string;
  capabilityIds: LabCapabilityId[];
};

function navigationGroupId(section: LabCapability['section']): WorkbenchNavGroup['id'] {
  switch (section) {
    case 'chat':
    case 'embed':
      return 'text';
    case 'image':
    case 'video':
      return 'image-video';
    case 'music':
    case 'tts':
    case 'stt':
    case 'voice':
      return 'voice-music';
    case 'world':
      return 'world';
    default: {
      const unknownSection: never = section;
      throw new Error(`Unclassified Lab capability section: ${unknownSection}`);
    }
  }
}

const groupDefinitions = Object.freeze([
  { id: 'text', labelKey: 'Workbench.groups.textConversation' },
  { id: 'image-video', labelKey: 'Workbench.groups.imageVideo' },
  { id: 'voice-music', labelKey: 'Workbench.groups.voiceMusic' },
  { id: 'world', labelKey: 'Workbench.groups.worlds' },
] as const);

const sectionOrder: Readonly<Record<LabCapability['section'], number>> = Object.freeze({
  chat: 0, embed: 1, image: 0, video: 1,
  tts: 0, stt: 1, voice: 2, music: 3, world: 0,
});

export const workbenchNavGroups: readonly WorkbenchNavGroup[] = Object.freeze(
  groupDefinitions.map((group) => ({
    id: group.id,
    labelKey: group.labelKey,
    capabilityIds: labCapabilities
      .filter((capability) => navigationGroupId(capability.section) === group.id)
      .sort((left, right) => sectionOrder[left.section] - sectionOrder[right.section])
      .map((capability) => capability.id),
  })),
);
