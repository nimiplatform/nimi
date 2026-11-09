import { FileUp } from 'lucide-react';
import type { StudioCapabilityRegistration } from '../../ai-studio-core/module-registration.js';
import { EMPTY_STUDIO_PARAMETERS } from '../../ai-studio-core/parameters.js';
import { labAppFilesDescriptor, type LabCapabilityTestId } from './capability-test-descriptors.js';
const key = (name: string) => `CapabilityTests.appFiles.${name}`;
export const labAppFilesCapability = Object.freeze({
  descriptor: labAppFilesDescriptor,
  icon: FileUp,
  profile: { studioTag: 'Files', inputTitleKey: key('title'), inputPlaceholderKey: key('title'), inputKind: 'none', supportsAttachments: false,
    controls: [], primaryLabelKey: key('upload'), primaryRunningLabelKey: key('uploading'), resultTitle: 'File transfer',
    emptyTitleKey: key('title'), emptyHintKey: key('intro'), resultKind: 'session', footnoteKey: key('footnote') },
  preset: { id: 'selected-file', label: 'Selected file', prompt: '' }, runtimeMethod: 'sdk.app.storage.assets.write/read', parameters: EMPTY_STUDIO_PARAMETERS,
} as const satisfies StudioCapabilityRegistration<LabCapabilityTestId>);
