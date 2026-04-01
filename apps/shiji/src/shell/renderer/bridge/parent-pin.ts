/**
 * parent-pin.ts — localStorage-backed PIN for parent mode gate (SJ-SHELL-005:5)
 */
const PIN_KEY = 'shiji:parentPin';

export function getParentPin(): string | null {
  return localStorage.getItem(PIN_KEY);
}

export function setParentPin(pin: string): void {
  localStorage.setItem(PIN_KEY, pin);
}
