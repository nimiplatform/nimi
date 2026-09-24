import type { StudioCapabilityRuntimeHandlers } from '../../ai-studio-core/runtime-dispatcher.js';
import { runLabImageFaceSwap, runLabVideoFaceSwap } from './face-swap.js';
import { runLabTextAnnotate } from './text-annotate.js';
import { runLabTextDecide } from './text-decide.js';
import { runLabTextExchange } from './text-exchange.js';

// Lab-only handlers. Direct AI Realtime and the video Session run from their
// own pages, because a Session is not a single request/result exchange.
export const labCapabilityTestRuntimeHandlers: StudioCapabilityRuntimeHandlers = Object.freeze({
  'text.annotate': runLabTextAnnotate,
  'text.tools': runLabTextExchange,
  'text.decide': runLabTextDecide,
  'image.face_swap': runLabImageFaceSwap,
  'video.face_swap': runLabVideoFaceSwap,
});
