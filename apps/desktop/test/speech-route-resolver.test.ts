import assert from 'node:assert/strict';
import test from 'node:test';
import { createResolveRuntimeBinding } from '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-route-resolvers';
import { type RuntimeRouteBinding } from "@nimiplatform/sdk/mod";
function createMockFields(overrides: Partial<{
    provider: string;
    runtimeModelType: string;
    localProviderEndpoint: string;
    localProviderModel: string;
    localOpenAiEndpoint: string;
    connectorId: string;
}> = {}) {
    return {
        provider: 'openai',
        runtimeModelType: 'chat',
        localProviderEndpoint: 'http://127.0.0.1:8080/v1',
        localProviderModel: 'tts-1',
        localOpenAiEndpoint: 'http://127.0.0.1:1234/v1',
        connectorId: 'conn-abc',
        ...overrides,
    };
}
test('createResolveRuntimeBinding reads source/model/connectorId from RuntimeFields', async () => {
    const fields = createMockFields({
        provider: 'openai',
        localProviderModel: 'tts-1',
        connectorId: 'conn-123',
    });
    const resolve = createResolveRuntimeBinding(() => fields);
    const result = await resolve({ modId: 'test-mod' });
    assert.equal(result.source, 'cloud');
    assert.equal(result.model, 'tts-1');
    assert.equal(result.connectorId, 'conn-123');
    assert.equal(result.adapter, undefined);
});
test('createResolveRuntimeBinding binding source takes priority over inferred source', async () => {
    const fields = createMockFields({ provider: 'localai' });
    const resolve = createResolveRuntimeBinding(() => fields);
    const result = await resolve({
        modId: 'test-mod',
        binding: {
            source: 'cloud',
            connectorId: '',
            model: '',
        },
    });
    assert.equal(result.source, 'cloud');
});
test('createResolveRuntimeBinding connector binding takes priority over fields.connectorId', async () => {
    const fields = createMockFields({ connectorId: 'field-conn' });
    const resolve = createResolveRuntimeBinding(() => fields);
    const binding: RuntimeRouteBinding = {
        source: 'cloud',
        connectorId: 'override-conn',
        model: '',
    };
    const result = await resolve({ modId: 'test-mod', binding });
    assert.equal(result.connectorId, 'override-conn');
});
test('createResolveRuntimeBinding model binding takes priority over fields.localProviderModel', async () => {
    const fields = createMockFields({ localProviderModel: 'default-model' });
    const resolve = createResolveRuntimeBinding(() => fields);
    const binding: RuntimeRouteBinding = {
        source: 'cloud',
        connectorId: 'override-conn',
        model: 'custom-model',
        provider: 'dashscope',
    };
    const result = await resolve({ modId: 'test-mod', binding });
    assert.equal(result.model, 'custom-model');
    assert.equal(result.provider, 'dashscope');
});
test('createResolveRuntimeBinding infers local source for llama provider', async () => {
    const fields = createMockFields({ provider: 'llama' });
    const resolve = createResolveRuntimeBinding(() => fields);
    const result = await resolve({ modId: 'test-mod' });
    assert.equal(result.source, 'local');
    assert.equal(result.engine, 'llama');
    assert.equal(result.model, 'llama/tts-1');
    assert.equal(result.modelId, 'tts-1');
    assert.equal(result.localProviderModel, 'tts-1');
});
test('createResolveRuntimeBinding infers cloud source for cloud provider', async () => {
    const fields = createMockFields({ provider: 'openai' });
    const resolve = createResolveRuntimeBinding(() => fields);
    const result = await resolve({ modId: 'test-mod' });
    assert.equal(result.source, 'cloud');
    assert.equal('engine' in result ? (result as { engine?: string }).engine : undefined, undefined);
});
test('createResolveRuntimeBinding preserves localModelId and adapter for local binding', async () => {
    const fields = createMockFields({
        provider: 'llama',
        runtimeModelType: 'image',
        localProviderModel: 'z-image-turbo',
        localProviderEndpoint: 'http://127.0.0.1:1234/v1',
    });
    const resolve = createResolveRuntimeBinding(() => fields);
    const result = await resolve({
        modId: 'test-mod',
        binding: {
            source: 'local',
            connectorId: '',
            model: 'z-image-turbo',
            modelId: 'z-image-turbo',
            localModelId: 'file:z-image-turbo',
            engine: 'llama',
            provider: 'llama',
            adapter: 'llama_native_adapter',
            endpoint: 'http://127.0.0.1:1234/v1',
        },
    });
    assert.equal(result.model, 'llama/z-image-turbo');
    assert.equal(result.modelId, 'z-image-turbo');
    assert.equal('localModelId' in result ? result.localModelId : undefined, 'file:z-image-turbo');
    assert.equal(result.adapter, 'llama_native_adapter');
    assert.equal('localProviderModel' in result ? result.localProviderModel : undefined, 'z-image-turbo');
});
