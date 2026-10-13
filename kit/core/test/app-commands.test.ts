import { expect, it } from 'vitest';
import { createNimiAppCommandSet, type NimiAppCommand } from '../src/app-commands.js';

const command = (id: string, shortcut?: string): NimiAppCommand => ({ id, label: id, menu: 'view', shortcut, state: () => ({ enabled: true, visible: true }), execute: () => undefined });
it('rejects duplicate IDs, reserved App IDs, unknown references and equivalent conflicting shortcuts', () => {
  expect(() => createNimiAppCommandSet([], [command('app.open'), command('app.open')])).toThrow('duplicate');
  expect(() => createNimiAppCommandSet([], [command('nimi.navigation.back')])).toThrow('Reserved');
  expect(() => createNimiAppCommandSet([], [command('app.a', 'Ctrl+Shift+B'), command('app.b', 'shift+ctrl+b')])).toThrow('Conflicting');
  expect(() => createNimiAppCommandSet([]).state('app.missing')).toThrow('Unknown');
});
it('rechecks current visibility and enablement at execution time', async () => {
  let visible = true; let calls = 0;
  const set = createNimiAppCommandSet([], [{ ...command('app.open'), state: () => ({ enabled: true, visible }), execute: () => { calls++; } }]);
  visible = false;
  expect(await set.execute('app.open')).toBe('unavailable');
  visible = true;
  expect(await set.execute('app.open')).toBe('executed');
  expect(calls).toBe(1);
});
it('prevents duplicate pending command execution and disables disposed commands', async () => {
  let finish!: () => void;
  const set = createNimiAppCommandSet([], [{ ...command('app.open'), execute: () => new Promise<void>(r => { finish = r; }) }]);
  const pending = set.execute('app.open');
  expect(await set.execute('app.open')).toBe('busy');
  finish(); await pending; set.dispose();
  expect(await set.execute('app.open')).toBe('disposed');
});
