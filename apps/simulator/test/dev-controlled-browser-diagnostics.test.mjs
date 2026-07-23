import assert from 'node:assert/strict';
import test from 'node:test';

import { isChromiumAppSpecificDevToolsCspDiagnostic } from '../build/dev-controlled-browser.mjs';

const origin = 'http://127.0.0.1:5173';
const chromiumProbeDiagnostic = [
  "Connecting to 'http://127.0.0.1:5173/.well-known/appspecific/com.chrome.devtools.json'",
  ' violates the following Content Security Policy directive: "connect-src \'none\'".',
  ' The request has been blocked.',
].join('');

test('controlled dev ignores only the same-origin Chromium DevTools well-known CSP probe', () => {
  assert.equal(
    isChromiumAppSpecificDevToolsCspDiagnostic(`${chromiumProbeDiagnostic}\n`, origin),
    true,
  );
  assert.equal(
    isChromiumAppSpecificDevToolsCspDiagnostic(
      chromiumProbeDiagnostic.replace('127.0.0.1:5173', '127.0.0.1:5174'),
      origin,
    ),
    false,
  );
  assert.equal(
    isChromiumAppSpecificDevToolsCspDiagnostic(
      chromiumProbeDiagnostic.replace(
        '/.well-known/appspecific/com.chrome.devtools.json',
        '/api/runtime',
      ),
      origin,
    ),
    false,
  );
  assert.equal(
    isChromiumAppSpecificDevToolsCspDiagnostic(
      chromiumProbeDiagnostic.replace("connect-src 'none'", "script-src 'none'"),
      origin,
    ),
    false,
  );
  assert.equal(
    isChromiumAppSpecificDevToolsCspDiagnostic('Failed to load app resource', origin),
    false,
  );
});
