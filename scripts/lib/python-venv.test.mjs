import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolvePythonVenvExecutable,
  resolveSystemPythonCommand,
} from './python-venv.mjs';

test('python virtual environment executable follows the target platform layout', () => {
  assert.equal(
    resolvePythonVenvExecutable('/srv/nimi/python', 'darwin'),
    '/srv/nimi/python/bin/python3',
  );
  assert.equal(
    resolvePythonVenvExecutable('C:\\Nimi\\python', 'win32'),
    'C:\\Nimi\\python\\Scripts\\python.exe',
  );
});

test('python virtual environment executable rejects an absent root', () => {
  assert.throws(() => resolvePythonVenvExecutable('', 'win32'));
});

test('system Python command avoids the non-functional Windows python3 app alias', () => {
  assert.equal(resolveSystemPythonCommand('win32'), 'python');
  assert.equal(resolveSystemPythonCommand('darwin'), 'python3');
  assert.equal(resolveSystemPythonCommand('linux'), 'python3');
});
