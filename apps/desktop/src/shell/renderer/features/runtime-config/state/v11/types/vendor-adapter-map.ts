import type { AdapterFamily } from '@runtime/llm-adapter/contracts/adapter-family';
import type { ProviderType } from '@runtime/llm-adapter/types';
import type { ApiVendor } from './modality';

export function vendorToAdapterFamily(vendor: ApiVendor): AdapterFamily {
  if (vendor === 'dashscope') return 'dashscope-compatible';
  if (vendor === 'volcengine') return 'volcengine-compatible';
  return 'openai-compatible';
}

export function vendorToProviderType(vendor: ApiVendor): ProviderType {
  if (vendor === 'dashscope') return 'DASHSCOPE_COMPATIBLE';
  if (vendor === 'volcengine') return 'VOLCENGINE_COMPATIBLE';
  return 'OPENAI_COMPATIBLE';
}

export function vendorToProviderPrefix(vendor: ApiVendor): string {
  if (vendor === 'dashscope') return 'dashscope-compatible';
  if (vendor === 'volcengine') return 'volcengine-compatible';
  return 'openai-compatible';
}
