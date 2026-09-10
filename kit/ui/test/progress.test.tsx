import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { ProgressIndicator } from '../src/components/progress.js';

test('the actual progressbar carries its accessible name and readable value', () => {
  const element = document.createElement('div');
  element.innerHTML = renderToStaticMarkup(<ProgressIndicator value={25} max={100} aria-label="App download" aria-valuetext="25 MB of 100 MB" data-testid="container" />);
  const progress = element.querySelector('[role="progressbar"]');
  expect(progress?.getAttribute('aria-label')).toBe('App download');
  expect(progress?.getAttribute('aria-valuetext')).toBe('25 MB of 100 MB');
  expect(progress?.getAttribute('aria-valuenow')).toBe('25');
  expect(element.querySelector('[data-testid="container"]')?.hasAttribute('aria-label')).toBe(false);
});

test('unknown progress never reports a fabricated percentage or numeric value', () => {
  const html = renderToStaticMarkup(<ProgressIndicator aria-label="App download" showValue />);
  expect(html).not.toContain('aria-valuenow');
  expect(html).not.toMatch(/>\d+%</);
  const invalidTotal = renderToStaticMarkup(<ProgressIndicator value={0} max={0} />);
  expect(invalidTotal).not.toContain('NaN');
  expect(invalidTotal).not.toContain('aria-valuenow');
});
