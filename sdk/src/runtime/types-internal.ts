import type {
  RuntimeCallOptions,
  RuntimeClientConfig,
  RuntimeNodeGrpcTransportConfig,
  RuntimeResponseMetadataObserver,
  RuntimeStreamCallOptions,
  RuntimeTauriIpcTransportConfig,
} from './types.js';

export type RuntimeCallOptionsInternal = RuntimeCallOptions & {
  _responseMetadataObserver?: RuntimeResponseMetadataObserver;
};

export type RuntimeStreamCallOptionsInternal = RuntimeStreamCallOptions & {
  _responseMetadataObserver?: RuntimeResponseMetadataObserver;
};

export type RuntimeNodeGrpcTransportConfigInternal = RuntimeNodeGrpcTransportConfig & {
  _responseMetadataObserver?: RuntimeResponseMetadataObserver;
};

export type RuntimeTauriIpcTransportConfigInternal = RuntimeTauriIpcTransportConfig & {
  _responseMetadataObserver?: RuntimeResponseMetadataObserver;
};

export type RuntimeTransportConfigInternal =
  | RuntimeNodeGrpcTransportConfigInternal
  | RuntimeTauriIpcTransportConfigInternal;

export type RuntimeClientConfigInternal = Omit<RuntimeClientConfig, 'transport'> & {
  transport: RuntimeTransportConfigInternal;
};
