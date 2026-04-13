import type {
  RuntimeStreamMethodCodec,
  RuntimeStreamMethodCodecMap,
  RuntimeUnaryMethodCodec,
  RuntimeUnaryMethodCodecMap,
} from './method-codecs-types';
import { runtimeUnaryMethodCodecsAuthAi } from './method-codecs-unary-auth-ai';
import { runtimeUnaryMethodCodecsLocal } from './method-codecs-unary-local';
import { runtimeUnaryMethodCodecsDomain } from './method-codecs-unary-domain';
import { runtimeStreamMethodCodecs } from './method-codecs-stream';

export type { RuntimeUnaryMethodCodec, RuntimeStreamMethodCodec };

export const RuntimeUnaryMethodCodecs: RuntimeUnaryMethodCodecMap = {
  ...runtimeUnaryMethodCodecsAuthAi,
  ...runtimeUnaryMethodCodecsLocal,
  ...runtimeUnaryMethodCodecsDomain,
};

export const RuntimeStreamMethodCodecs: RuntimeStreamMethodCodecMap = runtimeStreamMethodCodecs;
