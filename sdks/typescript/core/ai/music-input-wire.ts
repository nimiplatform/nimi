import { MusicInputCapabilities } from '../../core-generated/runtime-protobuf/runtime/v1/capability_configuration';
import { projectMusicInputCapabilities, type NimiMusicInputCapabilities } from './music-input.js';

// Decoded Runtime messages carry the protobuf runtime's own prototype, which
// the shared validator rejects as a non-plain object. It validates their
// canonical JSON form instead, the same shape the local App carrier delivers.
export function projectRuntimeMusicInput(value: MusicInputCapabilities): NimiMusicInputCapabilities {
  return projectMusicInputCapabilities(MusicInputCapabilities.toJson(value, { emitDefaultValues: true }));
}
