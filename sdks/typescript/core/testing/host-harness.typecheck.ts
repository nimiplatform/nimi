import type {
  NimiAiModel,
  NimiGenerateTextRequest,
  NimiGenerateTextResult,
} from '@nimiplatform/sdk/ai';
import type { NimiRunEvent } from '@nimiplatform/sdk/contracts';
import {
  NIMI_TESTING_AI_METHODS,
  createNimiTestingAiModel,
  createNimiTestingHarness,
  type NimiTestingAiMethodMap,
  type NimiTestingHarness,
  type NimiTestingHostPort,
  type NimiTestingHostResult,
  type NimiTestingHostStream,
  type NimiTestingMethodItem,
  type NimiTestingMethodRequest,
  type NimiTestingMethodResult,
} from '@nimiplatform/sdk/testing';

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends
  (<T>() => T extends TRight ? 1 : 2)
    ? true
    : false;
type Assert<TValue extends true> = TValue;

type GenerateMethod = NimiTestingAiMethodMap['nimi.ai.generateText'];
type StreamMethod = NimiTestingAiMethodMap['nimi.ai.streamText'];
type _GenerateRequestUsesPublicSdkType = Assert<Equal<
  NimiTestingMethodRequest<GenerateMethod>,
  NimiGenerateTextRequest
>>;
type _GenerateResultUsesPublicSdkType = Assert<Equal<
  NimiTestingMethodResult<GenerateMethod>,
  NimiGenerateTextResult
>>;
type _StreamRequestUsesPublicSdkType = Assert<Equal<
  NimiTestingMethodRequest<StreamMethod>,
  NimiGenerateTextRequest
>>;
type _StreamItemUsesPublicSdkType = Assert<Equal<
  NimiTestingMethodItem<StreamMethod>,
  NimiRunEvent
>>;
type _TextFacadeIsCapabilityOnly = Assert<Equal<
  NimiAiModel['model'],
  { readonly modelId: 'text.generate' }
>>;

declare const request: NimiGenerateTextRequest;
declare const harness: NimiTestingHarness<NimiTestingAiMethodMap>;
declare const port: NimiTestingHostPort<NimiTestingAiMethodMap>;

const unaryResult: Promise<NimiTestingHostResult<NimiGenerateTextResult>> =
  harness.invoke('nimi.ai.generateText', request);
const streamResult: Promise<NimiTestingHostResult<NimiTestingHostStream<NimiRunEvent>>> =
  harness.openStream('nimi.ai.streamText', request);
void unaryResult;
void streamResult;

// @ts-expect-error A stream method cannot be invoked through the unary surface.
harness.invoke('nimi.ai.streamText', request);
// @ts-expect-error A unary method cannot be opened through the stream surface.
harness.openStream('nimi.ai.generateText', request);
// @ts-expect-error Undeclared SDK methods are not part of the owner-derived method map.
harness.invoke('nimi.ai.notDeclared', request);
// @ts-expect-error Request shapes remain the SDK-owned public request type.
harness.invoke('nimi.ai.generateText', { messages: 'invalid' });

const exactHarness = createNimiTestingHarness<NimiTestingAiMethodMap>({
  opaqueTraceSeed: '0'.repeat(64),
  methods: NIMI_TESTING_AI_METHODS,
  port,
});
const publicFacade: NimiAiModel = createNimiTestingAiModel({
  harness: exactHarness,
});
void publicFacade;

createNimiTestingAiModel({
  harness: exactHarness,
  // @ts-expect-error Testing facades expose the fixed text capability and accept no model target.
  model: { modelId: 'implementation-model' },
});

createNimiTestingHarness<NimiTestingAiMethodMap>({
  opaqueTraceSeed: '0'.repeat(64),
  methods: NIMI_TESTING_AI_METHODS,
  port,
  // @ts-expect-error The in-process harness exposes no endpoint or transport selector.
  endpoint: 'https://not-admitted.example',
});
