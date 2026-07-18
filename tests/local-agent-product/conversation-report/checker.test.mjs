import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  validateConversationReportArchitecture,
  validateConversationReportBundle,
} from './checker.mjs';
import { renderConversationReportHtml } from './report-generator.mjs';
import {
  createValidConversationReport,
  writeValidConversationReportBundle,
} from './test-support.mjs';

function clone(value) {
  return structuredClone(value);
}

function withBundle(run, mutate = null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-conversation-report-'));
  try {
    const report = createValidConversationReport();
    if (mutate) mutate(report, root);
    writeValidConversationReportBundle(root, report, renderConversationReportHtml);
    return run({ root, report });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('checker accepts a mechanically complete report without assigning semantic quality', () => {
  withBundle(({ root }) => {
    const result = validateConversationReportBundle({ bundleRoot: root });
    assert.deepEqual(result.failures, []);
    assert.equal(result.report.execution.status, 'completed');
    assert.equal(result.report.reviewStatus, 'unreviewed');
  });
});

test('checker fails closed on legacy source identity and CharacterSourceRefV3 branch drift', () => {
  const mutations = [
    ['legacy sourceId', (report) => { report.conversationStreams[0].sourceProvenance.sourceRef.sourceId = 'legacy-source'; }, /forbidden.*sourceId|additional fields/iu],
    ['legacy sourceContentHash', (report) => { report.conversationStreams[0].sourceProvenance.sourceContentHash = 'a'.repeat(64); }, /forbidden.*sourceContentHash/iu],
    ['legacy RealmPersona', (report) => { report.conversationStreams[1].sourceProvenance.realmPersona = {}; }, /forbidden.*realmPersona/iu],
    ['source kind mismatch', (report) => { report.conversationStreams[0].sourceProvenance.sourceRef.kind = 'personaCharacter'; }, /kind must equal sourceKind/iu],
    ['World world binding mismatch', (report) => { report.conversationStreams[0].sourceProvenance.sourceRef.worldEntityRef.worldId = 'other-world'; }, /worldEntityRef\/worldId binding/iu],
    ['Persona owner missing', (report) => { delete report.conversationStreams[1].sourceProvenance.sourceRef.ownerAccountId; }, /PersonaCharacterSourceRefV3.*ownerAccountId|missing or additional fields/iu],
    ['provenance hash mismatch', (report) => { report.conversationStreams[1].sourceProvenance.sourceHash = 'e'.repeat(64); }, /provenance sourceHash drifted/iu],
    ['unexpected transport field', (report) => { report.conversationStreams[1].sourceProvenance.sourceRef.accessGrantId = 'forbidden-transport'; }, /missing or additional fields/iu],
  ];
  for (const [name, mutate, pattern] of mutations) {
    withBundle(({ root }) => {
      assert.match(validateConversationReportBundle({ bundleRoot: root }).failures.join('\n'), pattern, name);
    }, mutate);
  }
});

test('checker accepts an explicit transport failure and rejects finding correlation drift', () => {
  const applyTransportFailure = (report) => {
    const turn = report.turns[2];
    turn.assistant = {
      status: 'transport_failure',
      content: '',
      receivedAt: '2026-07-12T00:03:45.000Z',
      transportFailure: {
        stage: 'runtime_turn',
        reasonCode: 'AI_OUTPUT_INVALID',
        message: 'unsupported APML message tag <text>',
      },
    };
    report.execution.status = 'completed_with_transport_failure';
    report.executionFindings.pageErrors = ['unsupported APML message tag <text>'];
    report.executionFindings.consoleErrors = ['action:host-error AI_OUTPUT_INVALID'];
    report.executionFindings.transportFailures = [{
      turnId: turn.turnId,
      surface: turn.surface,
      stage: turn.assistant.transportFailure.stage,
      reasonCode: turn.assistant.transportFailure.reasonCode,
      message: turn.assistant.transportFailure.message,
    }];
  };
  withBundle(({ root }) => {
    assert.deepEqual(validateConversationReportBundle({ bundleRoot: root }).failures, []);
  }, applyTransportFailure);
  withBundle(({ root }) => {
    const reportPath = path.join(root, 'report.json');
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    report.executionFindings.transportFailures[0].turnId = 'different-turn';
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    assert.match(validateConversationReportBundle({ bundleRoot: root }).failures.join('\n'), /transport.*correlation|finding.*turn/iu);
  }, applyTransportFailure);
});

test('checker rejects reused Runtime turn correlation and fabricated pre-reservation turn ids', () => {
  withBundle(({ root }) => {
    const reportPath = path.join(root, 'report.json');
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    report.turns[1].correlation.turnId = report.turns[0].correlation.turnId;
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    assert.match(validateConversationReportBundle({ bundleRoot: root }).failures.join('\n'), /Runtime turn.*duplicate|turn correlation.*reused/iu);
  });
  withBundle(({ root }) => {
    const reportPath = path.join(root, 'report.json');
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const turn = report.turns[0];
    turn.assistant = {
      status: 'transport_failure',
      content: '',
      receivedAt: '2026-07-12T00:01:45.000Z',
      transportFailure: {
        stage: 'before_runtime_turn',
        reasonCode: 'RUNTIME_UNAVAILABLE',
        message: 'Runtime request was rejected before turn reservation.',
      },
    };
    report.execution.status = 'completed_with_transport_failure';
    report.executionFindings.transportFailures = [{
      turnId: turn.turnId,
      surface: turn.surface,
      stage: turn.assistant.transportFailure.stage,
      reasonCode: turn.assistant.transportFailure.reasonCode,
      message: turn.assistant.transportFailure.message,
    }];
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    assert.match(validateConversationReportBundle({ bundleRoot: root }).failures.join('\n'), /before Runtime turn.*must not.*turnId|pre-reservation.*turn/iu);
  });
});

test('checker fails closed on missing turn, response, model identity, order, and transcript drift', () => {
  const mutations = [
    ['missing declared turn', (report) => report.turns.pop(), /missing declared turn|turn count/iu],
    ['missing assistant response', (report) => { report.turns[0].assistant = { status: 'completed', content: '', receivedAt: '', transportFailure: null }; }, /assistant response|transport failure/iu],
    ['missing model identity', (report) => { report.turns[0].correlation.modelRevisionOrFingerprint = ''; }, /model.*revision|fingerprint/iu],
    ['turn order drift', (report) => { [report.turns[0].order, report.turns[1].order] = [report.turns[1].order, report.turns[0].order]; }, /order|chronological/iu],
  ];
  for (const [name, mutate, pattern] of mutations) {
    withBundle(({ root }) => {
      assert.match(validateConversationReportBundle({ bundleRoot: root }).failures.join('\n'), pattern, name);
    }, mutate);
  }

  withBundle(({ root }) => {
    const transcriptPath = path.join(root, 'transcripts', 'stream-a.json');
    const transcript = JSON.parse(fs.readFileSync(transcriptPath, 'utf8'));
    transcript.turns[0].assistant.content = 'drifted transcript';
    fs.writeFileSync(transcriptPath, `${JSON.stringify(transcript, null, 2)}\n`);
    assert.match(validateConversationReportBundle({ bundleRoot: root }).failures.join('\n'), /transcript.*drift|hash.*drift/iu);
  });
});

test('checker fails closed on identity collision, cross-surface drift, restart/offline drift, and per-scene starts', () => {
  const mutations = [
    ['LocalAgent collision', (report) => { report.conversationStreams[1].localAgentIdentity.localAgentRef = report.conversationStreams[0].localAgentIdentity.localAgentRef; }, /distinct.*localAgentRef|identity collision/iu],
    ['anchor collision', (report) => { report.conversationStreams[1].conversationIdentity.conversationAnchorId = report.conversationStreams[0].conversationIdentity.conversationAnchorId; }, /distinct.*conversationAnchorId|anchor.*collision/iu],
    ['Desktop to Zhiyu drift', (report) => { report.turns.find((row) => row.turnId === 'stream-a-turn-05').correlation.conversationAnchorId = 'replacement-app-anchor'; }, /Desktop.*Zhiyu|stream.*anchor|correlation/iu],
    ['restart not executed once', (report) => { report.lifecycleTimeline.events = report.lifecycleTimeline.events.filter((row) => row.kind !== 'runtime_restart'); }, /runtime restart/iu],
    ['offline not executed once', (report) => { report.lifecycleTimeline.events = report.lifecycleTimeline.events.filter((row) => row.kind !== 'realm_offline'); }, /Realm offline/iu],
    ['environment per scene', (report) => { report.environmentIdentity.processStarts.desktop = report.turns.length; }, /process start|one baseline environment/iu],
  ];
  for (const [name, mutate, pattern] of mutations) {
    withBundle(({ root }) => {
      assert.match(validateConversationReportBundle({ bundleRoot: root }).failures.join('\n'), pattern, name);
    }, mutate);
  }
});

test('checker fails closed on artifact drift, missing observation mapping, automatic acceptance, and canary leakage', () => {
  withBundle(({ root, report }) => {
    fs.rmSync(path.join(root, report.turns[0].providerCaptureRef));
    assert.match(validateConversationReportBundle({ bundleRoot: root }).failures.join('\n'), /artifact|provider capture|missing/iu);
  });
  withBundle(({ root }) => {
    const reportPath = path.join(root, 'report.json');
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    report.observationMappings.pop();
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    assert.match(validateConversationReportBundle({ bundleRoot: root }).failures.join('\n'), /24.*observation|observation.*mapping|hash.*drift/iu);
  });
  withBundle(({ root }) => {
    const reportPath = path.join(root, 'report.json');
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    report.reviewDimensions[0].reviewStatus = 'accepted';
    report.semanticVerdict = 'passed';
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    assert.match(validateConversationReportBundle({ bundleRoot: root }).failures.join('\n'), /unreviewed|semantic.*verdict|automatic/iu);
  });
  withBundle(({ root }) => {
    assert.match(validateConversationReportBundle({ bundleRoot: root }).failures.join('\n'), /review dimension.*related turn|raw response/iu);
  }, (report) => {
    report.reviewDimensions.find((dimension) => dimension.id === 'voice-emotion-apml').turnRefs = [];
  });
  withBundle(({ root }) => {
    const reportPath = path.join(root, 'report.json');
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const probe = report.privacy.canaryChecks[0];
    report.turns.find((row) => row.turnId === probe.turnId).assistant.content += ` ${probe.forbiddenCanary}`;
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    assert.match(validateConversationReportBundle({ bundleRoot: root }).failures.join('\n'), /canary|cross-agent.*leak/iu);
  });
});

test('architecture checker rejects old 2x10 required paths and source-owned conversation truth', () => {
  assert.deepEqual(validateConversationReportArchitecture(), []);
  const bad = {
    packageScripts: {
      'test:e2e:local-agent-product:live-behavior': 'node tests/local-agent-product/behavior/run-live-behavior.mjs',
    },
    executionPolicy: { required_local_pr_composition: ['live_behavior'], repeat_policies: { live: { batches: 2, product_journey_repeats_per_batch: 10 } } },
    scenarioRegistry: { characterConversationId: 'forbidden', streams: [] },
  };
  const failures = validateConversationReportArchitecture(bad);
  assert.match(failures.join('\n'), /2x10|old live behavior|required path|source-owned|characterConversationId/iu);
});

test('architecture checker rejects restoring the retired conversation-report execution path', () => {
  const bad = {
    packageScripts: {
      'test:e2e:local-agent-conversation-report': 'node tests/local-agent-product/conversation-report/run-conversation-report.mjs',
      'check:local-agent-conversation-report': 'node scripts/check-local-agent-conversation-report.mjs',
    },
    executionPolicy: {
      gates: { conversation_report: { command: 'pnpm test:e2e:local-agent-conversation-report' } },
      repeat_policies: { conversation_report: { runs: 1 } },
      suites: [{ suite_id: 'conversation-report-i8' }],
      required_local_pr_composition: [],
    },
    scenarioRegistry: { schema_version: 'invalid', scenarios: [] },
  };
  const failures = validateConversationReportArchitecture(bad);
  assert.match(failures.join('\n'), /direct-daemon|executable gate|repeat policy|executable suite/iu);
});
