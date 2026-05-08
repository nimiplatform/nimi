/**
 * parent-pin.ts — Tauri-owned parent PIN capability gate (SJ-SHELL-005:5)
 */
import { invokeChecked } from './index.js';

function expectBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${label}: expected boolean`);
  }
  return value;
}

export async function hasParentPin(): Promise<boolean> {
  return invokeChecked('parent_pin_exists', {}, (value) => expectBoolean(value, 'parent_pin_exists'));
}

export async function setParentPin(pin: string): Promise<void> {
  await invokeChecked('parent_pin_set', { pin }, () => undefined);
}

export async function verifyParentPin(pin: string): Promise<boolean> {
  return invokeChecked('parent_pin_verify', { pin }, (value) => expectBoolean(value, 'parent_pin_verify'));
}
