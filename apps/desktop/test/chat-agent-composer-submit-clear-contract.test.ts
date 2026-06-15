import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const chatAgentCanonicalComposerSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-canonical-composer.tsx');
const chatAgentSubmitSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-shell-host-actions-submit.ts');

test('agent composer clears accepted text immediately and only restores it after submit failure', () => {
  assert.match(chatAgentCanonicalComposerSource, /const \[composerText, setComposerText\] = useState\(props\.initialText\)/);
  assert.match(chatAgentCanonicalComposerSource, /setComposerText\(''\);\s*props\.onInputCaptureText\(''\);/);
  assert.match(chatAgentCanonicalComposerSource, /await props\.onSubmit\(\{[\s\S]*text: submittedText,[\s\S]*attachments: submittedAttachments,[\s\S]*\}\);/);
  assert.match(chatAgentCanonicalComposerSource, /catch \(error\) \{[\s\S]*setComposerText\(submittedText\);[\s\S]*props\.onInputCaptureText\(submittedText\);/);
  assert.match(chatAgentCanonicalComposerSource, /text=\{composerText\}/);
  assert.match(chatAgentCanonicalComposerSource, /onTextChange=\{handleComposerTextChange\}/);

  const successProjectionStart = chatAgentSubmitSource.indexOf('const assistantPlaceholder');
  const successProjectionEnd = chatAgentSubmitSource.indexOf('const userThreadRecord');
  assert.notEqual(successProjectionStart, -1);
  assert.notEqual(successProjectionEnd, -1);
  assert.ok(successProjectionEnd > successProjectionStart);
  const successProjectionSource = chatAgentSubmitSource.slice(successProjectionStart, successProjectionEnd);
  assert.doesNotMatch(successProjectionSource, /currentComposerTextRef\.current = submittedText;/);
  assert.match(chatAgentSubmitSource, /catch \(error\) \{[\s\S]*currentComposerTextRef\.current = submittedText;/);
});
