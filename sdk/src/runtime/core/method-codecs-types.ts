import type {
  RuntimeStreamMethodContractMap,
  RuntimeStreamMethodId,
  RuntimeUnaryMethodContractMap,
  RuntimeUnaryMethodId,
} from '../runtime-method-contracts.js';

export type BinaryMessageType<T> = {
  create(value?: Partial<T>): T;
};

export type RuntimeUnaryMethodCodec<Request, Response> = {
  requestType: BinaryMessageType<Request>;
  responseType: BinaryMessageType<Response>;
};

export type RuntimeStreamMethodCodec<Request, Event> = {
  requestType: BinaryMessageType<Request>;
  eventType: BinaryMessageType<Event>;
};

export type RuntimeUnaryMethodCodecMap = {
  [MethodId in RuntimeUnaryMethodId]: RuntimeUnaryMethodCodec<
    RuntimeUnaryMethodContractMap[MethodId]['request'],
    RuntimeUnaryMethodContractMap[MethodId]['response']
  >;
};

export type RuntimeStreamMethodCodecMap = {
  [MethodId in RuntimeStreamMethodId]: RuntimeStreamMethodCodec<
    RuntimeStreamMethodContractMap[MethodId]['request'],
    RuntimeStreamMethodContractMap[MethodId]['response'] extends AsyncIterable<infer Event> ? Event : never
  >;
};
