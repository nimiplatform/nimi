import { createActionClient } from './action-client';
import { createAuditClient, createMetaClient } from './meta-client';
import { createEventClient } from './event-client';
import { createDataClient } from './data-client';
import { createTurnClient } from './turn-client';
import { createUiClient } from './ui-client';
import { createInterModClient } from './inter-mod-client';
import { createLlmClient } from './llm-client';
import { getHookRuntimes, normalizeHookModId } from './shared';
export function createHookClient(modId) {
    const normalizedModId = normalizeHookModId(modId);
    const { runtimeHost, runtime } = getHookRuntimes();
    return {
        action: createActionClient({
            modId: normalizedModId,
            runtime,
        }),
        event: createEventClient({
            modId: normalizedModId,
            runtime,
        }),
        data: createDataClient({
            modId: normalizedModId,
            runtime,
        }),
        turn: createTurnClient({
            modId: normalizedModId,
            runtime,
        }),
        ui: createUiClient({
            modId: normalizedModId,
            runtime,
        }),
        interMod: createInterModClient({
            modId: normalizedModId,
            runtime,
        }),
        llm: createLlmClient({
            modId: normalizedModId,
            runtimeHost,
            runtime,
        }),
        audit: createAuditClient({
            runtime,
        }),
        meta: createMetaClient({
            runtime,
        }),
    };
}
