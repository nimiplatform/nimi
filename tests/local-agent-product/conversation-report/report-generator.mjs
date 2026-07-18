function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function pretty(value) {
  return escapeHtml(JSON.stringify(value, null, 2));
}

function artifactLink(ref, label = ref) {
  return `<a href="${escapeHtml(ref)}">${escapeHtml(label)}</a>`;
}

function renderRunOverview(report) {
  const findings = report.executionFindings || {};
  const privacy = report.privacy || {};
  const processStarts = report.environmentIdentity?.processStarts || {};
  const materializations = report.environmentIdentity?.materializations || {};
  const canaryLeaks = (privacy.canaryChecks || []).filter((check) => check?.leaked === true).length;
  const findingSummary = [
    `process ${findings.processErrors?.length || 0}`,
    `page ${findings.pageErrors?.length || 0}`,
    `console ${findings.consoleErrors?.length || 0}`,
    `transport ${findings.transportFailures?.length || 0}`,
    `privacy ${privacy.findings?.length || 0}`,
    `exact canary leaks ${canaryLeaks}`,
    findings.timeBudgetExceeded ? 'time budget exceeded' : 'time budget within limit',
  ].join(' · ');
  return `<section class="panel"><h1>LocalAgent conversation report</h1><dl class="summary">
<dt>Run ID</dt><dd>${escapeHtml(report.runId)}</dd>
<dt>Nimi HEAD / digest</dt><dd>${escapeHtml(report.sourceState?.nimiHead)} · ${escapeHtml(report.sourceState?.nimiSourceDigest)}</dd>
<dt>Realm HEAD / digest</dt><dd>${escapeHtml(report.sourceState?.realmHead)} · ${escapeHtml(report.sourceState?.realmSourceDigest)}</dd>
<dt>Scenario registry</dt><dd>${escapeHtml(report.scenarioRegistry?.scenarioId)} v${escapeHtml(report.scenarioRegistry?.version)} · ${escapeHtml(report.scenarioRegistry?.digest)}</dd>
<dt>Provider / model / revision</dt><dd>${escapeHtml(report.modelIdentity?.providerId)} · ${escapeHtml(report.modelIdentity?.modelId)} · ${escapeHtml(report.modelIdentity?.modelRevisionOrFingerprint)}</dd>
<dt>Public inference parameters</dt><dd><code>${escapeHtml(JSON.stringify(report.modelIdentity?.parameters || {}))}</code></dd>
<dt>Runtime / Desktop / Zhiyu</dt><dd>${escapeHtml(report.environmentIdentity?.runtimeVersion)} · ${escapeHtml(report.environmentIdentity?.desktopVersion)} · ${escapeHtml(report.environmentIdentity?.zhiyuVersion)}</dd>
<dt>Environment starts</dt><dd>provider ${escapeHtml(processStarts.provider)} · Realm ${escapeHtml(processStarts.realm)} · Runtime ${escapeHtml(processStarts.runtime)} · Desktop ${escapeHtml(processStarts.desktop)} · Zhiyu ${escapeHtml(processStarts.zhiyu)}</dd>
<dt>Materializations</dt><dd>WorldCharacter source ${escapeHtml(materializations.worldCharacter)} · PersonaCharacter source ${escapeHtml(materializations.personaCharacter)}</dd>
<dt>Duration / execution</dt><dd>${escapeHtml(report.execution?.durationMs)} ms · ${escapeHtml(report.execution?.status)} · review ${escapeHtml(report.reviewStatus)}</dd>
<dt>Mechanical findings</dt><dd>${escapeHtml(findingSummary)}<details><summary>Mechanical finding details</summary><pre>${pretty({ execution: findings, privacy })}</pre></details></dd>
</dl></section>`;
}

function renderTurn(turn) {
  const transportFailure = turn.assistant?.transportFailure || null;
  const screenshots = (turn.screenshotRefs || []).map((ref) => (
    `<a class="shot" href="${escapeHtml(ref)}"><img src="${escapeHtml(ref)}" alt="${escapeHtml(turn.turnId)} screenshot"></a>`
  )).join('');
  return `<article class="turn" id="turn-${escapeHtml(turn.turnId)}">
    <header><span class="turn-id">${escapeHtml(turn.turnId)}</span><span class="surface">${escapeHtml(turn.surface)}</span><span>${escapeHtml(turn.latencyMs)} ms</span></header>
    <div class="bubble user"><strong>User</strong><p>${escapeHtml(turn.user?.content)}</p><small>${escapeHtml(turn.user?.submittedAt)}</small></div>
    <div class="bubble assistant${transportFailure ? ' failure' : ''}"><strong>${transportFailure ? `Transport failure · ${escapeHtml(transportFailure.reasonCode)}` : 'LocalAgent'}</strong><p>${escapeHtml(turn.assistant?.content || transportFailure?.message || '')}</p><small>${escapeHtml(turn.assistant?.receivedAt)} · ${escapeHtml(turn.correlation?.providerId)}/${escapeHtml(turn.correlation?.modelId)}</small></div>
    <div class="refs">${artifactLink(turn.providerCaptureRef, 'provider capture')} · ${artifactLink(turn.runtimeStateRef, 'Runtime state')}</div>
    <details><summary>Context, memory, relationship, Voice / Emotion / Activity / APML / hooks</summary>
      <div class="detail-grid"><section><h4>Context lanes</h4><pre>${pretty(turn.contextSummary)}</pre></section><section><h4>Memory</h4><pre>${pretty(turn.memorySnapshot)}</pre></section><section><h4>Relationship</h4><pre>${pretty(turn.relationshipSnapshot)}</pre></section><section><h4>Presentation</h4><pre>${pretty(turn.presentationOutput)}</pre></section></div>
    </details>${screenshots ? `<div class="screenshots">${screenshots}</div>` : ''}
  </article>`;
}

function renderStream(stream, turns) {
  const source = stream.sourceProvenance || {};
  return `<section class="panel transcript" id="stream-${escapeHtml(stream.streamId)}">
    <h2>${escapeHtml(stream.title)}</h2>
    <dl class="identity">
      <dt>source kind/ref</dt><dd>${escapeHtml(source.sourceKind)} · ${escapeHtml(source.sourceRef?.kind)}:${escapeHtml(source.sourceRef?.worldId)}:${escapeHtml(source.sourceRef?.id)}</dd>
      <dt>snapshot ref/hash</dt><dd>${escapeHtml(source.snapshotRef)} · ${escapeHtml(source.snapshotHash)}</dd>
      <dt>localAgentRef</dt><dd>${escapeHtml(stream.localAgentIdentity?.localAgentRef)}</dd>
      <dt>conversationAnchorId</dt><dd>${escapeHtml(stream.conversationIdentity?.conversationAnchorId)}</dd>
      <dt>Runtime threadId</dt><dd>${escapeHtml(stream.conversationIdentity?.threadId)}</dd>
    </dl>
    ${turns.map(renderTurn).join('')}
  </section>`;
}

function renderTimeline(timeline) {
  return `<section class="panel" id="lifecycle-timeline"><h2>Cross-surface / cross-agent / restart / offline timeline</h2>
    <ol class="timeline">${(timeline?.events || []).map((event) => `<li id="event-${escapeHtml(event.eventId)}"><time>${escapeHtml(event.occurredAt)}</time><strong>${escapeHtml(event.kind)}</strong><span>${escapeHtml(event.streamId || 'shared environment')}</span><code>${escapeHtml(JSON.stringify(event.correlation || {}))}</code></li>`).join('')}</ol>
  </section>`;
}

function renderReview(report) {
  const turnById = new Map((report.turns || []).map((turn) => [turn.turnId, turn]));
  return `<section class="panel" id="human-review"><h2>Human review</h2><p>Generated status: <strong>${escapeHtml(report.reviewStatus)}</strong>. Semantic, tone, role effect, and naturalness are decided by the reviewer.</p>
    ${(report.reviewDimensions || []).map((dimension) => {
      const relevant = (dimension.turnRefs || []).map((turnId) => turnById.get(turnId)).filter(Boolean);
      return `<article class="review" id="review-${escapeHtml(dimension.id)}"><h3>${escapeHtml(dimension.title)}</h3><p>Related turns: ${(dimension.turnRefs || []).map((ref) => `<a href="#turn-${escapeHtml(ref)}">${escapeHtml(ref)}</a>`).join(', ')}</p>${relevant.map((turn) => `<blockquote><a href="#turn-${escapeHtml(turn.turnId)}">${escapeHtml(turn.turnId)}</a><p>${escapeHtml(turn.assistant?.content || turn.assistant?.transportFailure?.message || '')}</p>${dimension.id === 'voice-emotion-apml' ? `<details><summary>Presentation capture</summary><pre>${pretty(turn.presentationOutput)}</pre></details>` : ''}</blockquote>`).join('')}<label>Status <select disabled><option selected>unreviewed</option><option>accepted</option><option>needs_adjustment</option></select></label><label>Notes <textarea disabled>${escapeHtml(dimension.notes)}</textarea></label></article>`;
    }).join('')}
  </section>`;
}

export function renderConversationReportHtml(report) {
  const streams = report.conversationStreams || [];
  const turnsByStream = new Map(streams.map((stream) => [
    stream.streamId,
    (report.turns || []).filter((turn) => turn.streamId === stream.streamId).sort((left, right) => left.order - right.order),
  ]));
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LocalAgent conversation report · ${escapeHtml(report.runId)}</title>
<style>
:root{color-scheme:light dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;line-height:1.55;--bg:#0b1020;--panel:#141b2d;--line:#2c3855;--muted:#9faccc;--accent:#87a9ff;--user:#24385f;--assistant:#203d35;--failure:#562c32}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:#edf2ff}main{max-width:1180px;margin:auto;padding:32px 20px 80px}.panel{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:24px;margin:18px 0}h1,h2,h3{line-height:1.2}a{color:var(--accent)}.summary,.identity{display:grid;grid-template-columns:minmax(160px,220px) 1fr;gap:8px 18px}.summary dt,.identity dt{color:var(--muted)}.summary dd,.identity dd{margin:0;min-width:0;overflow-wrap:anywhere}.turn{border-top:1px solid var(--line);padding:24px 0}.turn header{display:flex;gap:12px;color:var(--muted);font-size:.88rem}.surface{border:1px solid var(--line);border-radius:999px;padding:0 8px}.bubble{max-width:85%;padding:12px 16px;border-radius:14px;margin:12px 0}.bubble p{white-space:pre-wrap}.bubble.user{background:var(--user);margin-left:auto}.bubble.assistant{background:var(--assistant)}.bubble.failure{background:var(--failure);border:1px solid #d46b78}small{color:var(--muted)}details{margin-top:12px}.detail-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#080d19;padding:12px;border-radius:10px;font-size:.78rem}.screenshots{display:flex;gap:10px;overflow:auto;margin-top:12px}.shot img{max-width:320px;max-height:220px;object-fit:contain;border:1px solid var(--line);border-radius:10px}.timeline{list-style:none;padding:0}.timeline li{display:grid;grid-template-columns:minmax(150px,180px) minmax(180px,240px) minmax(0,1fr);gap:10px;padding:10px 0;border-bottom:1px solid var(--line)}.timeline li>*{min-width:0;overflow-wrap:anywhere}.timeline code{grid-column:1/-1;color:var(--muted);white-space:normal}.review{border-top:1px solid var(--line);padding:16px 0}.review blockquote{border-left:3px solid var(--line);margin:10px 0;padding:4px 14px}.review blockquote p{white-space:pre-wrap}.review label{display:block;margin:8px 0}.review textarea{display:block;width:100%;min-height:72px}@media(max-width:700px){.summary,.identity{grid-template-columns:1fr}.timeline li{grid-template-columns:1fr}.timeline code{grid-column:auto}.bubble{max-width:100%}}
</style></head><body><main>
${renderRunOverview(report)}
${streams.map((stream) => renderStream(stream, turnsByStream.get(stream.streamId) || [])).join('')}
${renderTimeline(report.lifecycleTimeline)}
${renderReview(report)}
</main></body></html>\n`;
}
