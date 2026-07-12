import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { renderConversationReportHtml } from './report-generator.mjs';

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function allFiles(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    return entry.isDirectory() ? allFiles(absolute) : [absolute];
  });
}

export function writeConversationReportBundle({ bundleRoot, report }) {
  fs.mkdirSync(bundleRoot, { recursive: true });
  fs.mkdirSync(path.join(bundleRoot, 'transcripts'), { recursive: true });
  for (const stream of report.conversationStreams) {
    const turns = report.turns
      .filter((turn) => turn.streamId === stream.streamId)
      .sort((left, right) => left.order - right.order)
      .map((turn) => ({
        turnId: turn.turnId,
        order: turn.order,
        surface: turn.surface,
        user: turn.user,
        assistant: turn.assistant,
        correlation: turn.correlation,
      }));
    writeJson(path.join(bundleRoot, 'transcripts', `${stream.streamId}.json`), {
      schemaVersion: 'nimi.local-agent-conversation-transcript/v1',
      streamId: stream.streamId,
      localAgentRef: stream.localAgentIdentity.localAgentRef,
      conversationAnchorId: stream.conversationIdentity.conversationAnchorId,
      turns,
    });
  }
  writeJson(path.join(bundleRoot, 'report.json'), report);
  fs.writeFileSync(path.join(bundleRoot, 'report.html'), renderConversationReportHtml(report));

  const manifestFiles = allFiles(bundleRoot)
    .filter((file) => path.basename(file) !== 'run-manifest.json')
    .map((file) => ({
      path: path.relative(bundleRoot, file),
      sha256: sha256(file),
      bytes: fs.statSync(file).size,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const manifest = {
    schemaVersion: 'nimi.local-agent-conversation-run-manifest/v1',
    runId: report.runId,
    scenarioId: report.scenarioRegistry.scenarioId,
    processStarts: report.environmentIdentity.processStarts,
    materializations: report.environmentIdentity.materializations,
    noRetry: true,
    modelCount: 1,
    repeatCount: 1,
    files: manifestFiles,
  };
  writeJson(path.join(bundleRoot, 'run-manifest.json'), manifest);
  return { report, manifest };
}
