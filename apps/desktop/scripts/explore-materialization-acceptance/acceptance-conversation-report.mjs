import assert from 'node:assert/strict';
import path from 'node:path';

import { buildConversationReportMemoryQuery } from '../../../../tests/local-agent-product/conversation-report/memory-capture.mjs';
import { resolveConversationTurnOutcome } from '../../../../tests/local-agent-product/conversation-report/turn-result.mjs';
import { delay } from './acceptance-files.mjs';
import { captureScreenshot } from './acceptance-page.mjs';

export async function runDesktopConversationReportTurns({
  page, composerTextarea, sendButton, observations, agentClient, agentIdentity,
  conversationScenario, artifactsDir, consoleErrors = [], pageErrors = [],
}) {
  const stream = conversationScenario?.streams?.find((candidate) => candidate.source_provenance?.source_kind === 'worldCharacter');
  const declaredTurns = (stream?.turns || []).filter((turn) => turn.surface === 'desktop');
  assert.equal(declaredTurns.length, 4, 'conversation report Desktop must resolve four declared LocalAgent A turns');
  let conversationAnchorId = '';
  observations.desktopConversationReportTurns = [];
  let lastSnapshot = null;
  const inputModes = ['click', 'enter', 'shift-enter', 'click'];
  for (const [index, declaredTurn] of declaredTurns.entries()) {
    const consoleErrorStart = consoleErrors.length;
    const pageErrorStart = pageErrors.length;
    const before = conversationAnchorId
      ? await agentClient.getSessionSnapshot({ ...agentIdentity, conversationAnchorId })
      : null;
    const beforeCount = Number(before?.transcriptMessageCount || before?.transcript?.length || 0);
    const previousRuntimeTurnId = String(before?.lastTurn?.turnId || '').trim();
    await composerTextarea.fill('');
    await composerTextarea.focus();
    const submittedAt = new Date().toISOString();
    const startedAt = Date.now();
    await page.keyboard.insertText(declaredTurn.user_message);
    assert.equal(await composerTextarea.inputValue(), declaredTurn.user_message, `${declaredTurn.turn_id} real keyboard input mismatch`);
    await page.waitForFunction(() => globalThis.document.querySelector('[data-chat-composer-send="true"]')?.disabled === false, null, { timeout: 30_000 });
    const inputMode = inputModes[index];
    if (inputMode === 'click') await sendButton.click();
    else if (inputMode === 'enter') await composerTextarea.press('Enter');
    else {
      await composerTextarea.press('Shift+Enter');
      assert.match(await composerTextarea.inputValue(), /\n/u, 'conversation report Shift+Enter must insert a newline');
      await composerTextarea.press('Enter');
    }
    const deadline = Date.now() + 120_000;
    let snapshot = null;
    let terminal = false;
    while (Date.now() < deadline) {
      if (!conversationAnchorId) {
        const summaries = await agentClient.listConversationSummaries({ ...agentIdentity, pageSize: 50 });
        assert.ok(summaries.summaries.length <= 1, 'first conversation report Desktop turn created conflicting UI conversation anchors in a clean Journey');
        if (summaries.summaries.length === 0) {
          await delay(250);
          continue;
        }
        conversationAnchorId = String(summaries.summaries[0].anchor?.conversationAnchorId || '').trim();
        assert.ok(conversationAnchorId, 'conversation report Desktop UI conversation anchor is missing after first turn');
      }
      snapshot = await agentClient.getSessionSnapshot({ ...agentIdentity, conversationAnchorId });
      lastSnapshot = snapshot;
      const count = Number(snapshot.transcriptMessageCount || snapshot.transcript?.length || 0);
      const lastTurnFailed = Boolean(snapshot.lastTurn?.reasonCode)
        || String(snapshot.lastTurn?.status || '').toLowerCase() === 'failed';
      if (!snapshot.activeTurn && lastTurnFailed) {
        terminal = true;
        break;
      }
      const lastTurnCompleted = String(snapshot.lastTurn?.status || '').toLowerCase() === 'completed'
        || Boolean(String(snapshot.lastTurn?.finishReason || '').trim());
      if (!snapshot.activeTurn && lastTurnCompleted && count >= beforeCount + 2 && snapshot.transcript?.at(-1)?.role === 'assistant') {
        terminal = true;
        break;
      }
      await delay(250);
    }
    assert.equal(terminal, true, `${declaredTurn.turn_id} did not reach a completed response or explicit Runtime transport failure`);
    const transcript = snapshot?.transcript || [];
    const assistant = transcript.length > beforeCount && transcript.at(-1)?.role === 'assistant'
      ? transcript.at(-1)
      : null;
    const turnConsoleErrors = consoleErrors.slice(consoleErrorStart);
    const turnPageErrors = pageErrors.slice(pageErrorStart);
    const snapshotRuntimeTurnId = String(snapshot?.lastTurn?.turnId || snapshot?.activeTurn?.turnId || '').trim();
    const runtimeTurnId = snapshotRuntimeTurnId && snapshotRuntimeTurnId !== previousRuntimeTurnId
      ? snapshotRuntimeTurnId
      : null;
    const outcome = resolveConversationTurnOutcome({
      snapshot,
      outputText: assistant?.content || '',
      runtimeTurnId,
      pageErrors: turnPageErrors,
      consoleErrors: turnConsoleErrors,
    });
    if (outcome.status === 'completed') assert.ok(runtimeTurnId, `${declaredTurn.turn_id} completed without a current Runtime turn id`);
    const capturedAt = new Date().toISOString();
    const memory = await agentClient.queryMemory(buildConversationReportMemoryQuery(agentIdentity));
    const inspect = await agentClient.inspect.getPublicInspect(agentIdentity);
    const screenshotPath = declaredTurn.screenshot_checkpoint
      ? path.join(artifactsDir, `${declaredTurn.screenshot_checkpoint}.png`)
      : null;
    if (screenshotPath) await captureScreenshot(page, screenshotPath);
    observations.desktopConversationReportTurns.push({
      turnId: declaredTurn.turn_id,
      streamId: stream.stream_id,
      order: declaredTurn.order,
      sourceKind: stream.source_provenance.source_kind,
      prompt: declaredTurn.user_message,
      submittedAt,
      receivedAt: capturedAt,
      latencyMs: Date.now() - startedAt,
      inputMode,
      conversationAnchorId,
      threadId: snapshot.threadId || null,
      requestId: snapshot.requestId || null,
      runtimeTurnId,
      transcriptMessageCount: transcript.length,
      transcript: transcript.slice(beforeCount).map((message) => ({ id: message.id, role: message.role, content: message.content })),
      outputText: outcome.outputText,
      transportFailure: outcome.transportFailure,
      turnConsoleErrors,
      turnPageErrors,
      contextSummary: snapshot.lastTurn?.contextSummary || null,
      structuredOutput: snapshot.lastTurn?.structured || null,
      memory,
      inspect,
      presentationEvidence: await page.evaluate(() => globalThis.window?.__nimiDesktopEvidence || null).catch(() => null),
      screenshotPath,
      observationPointIds: declaredTurn.observation_point_ids,
      humanReviewDimensions: declaredTurn.human_review_dimensions,
    });
  }
  observations.desktopConversationReportLastTurnContextSummary = lastSnapshot?.lastTurn?.contextSummary || null;
}
