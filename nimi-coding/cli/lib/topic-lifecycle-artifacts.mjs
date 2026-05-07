import { readdir } from "node:fs/promises";

function getTopicWaves(topic) {
  return Array.isArray(topic.waves) ? topic.waves.map((entry) => ({ ...entry })) : [];
}

function fileReferencesWave(fileName, waveId) {
  return fileName.includes(waveId);
}

function buildObservedLineage(entry) {
  if (entry.closeouts > 0) return "closed_lineage";
  if (entry.results > 0) return "result_lineage";
  if (entry.packets > 0) return "packet_lineage";
  if (entry.remediations > 0 || entry.exec_packs > 0 || entry.decision_reviews > 0) {
    return "auxiliary_lineage";
  }
  return "declared_only";
}

function isRecognizedLifecycleArtifactName(fileName) {
  if (!fileName.endsWith(".md")) return true;
  if (fileName.startsWith("packet-")) {
    return /^packet-wave-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(fileName)
      || /^packet-true-close(?:-[a-z0-9]+)*\.md$/.test(fileName);
  }
  if (fileName.startsWith("result-")) {
    return /^result-wave-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(fileName)
      || /^result-topic-true-close(?:-[a-z0-9]+)*\.md$/.test(fileName)
      || /^result-true-close(?:-[a-z0-9]+)*\.md$/.test(fileName);
  }
  if (fileName.startsWith("closeout-")) {
    return /^closeout-wave-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(fileName)
      || /^closeout-topic(?:-[a-z0-9]+)*\.md$/.test(fileName)
      || /^closeout-true-close(?:-[a-z0-9]+)*\.md$/.test(fileName);
  }
  if (fileName.startsWith("decision-review-")) {
    return /^decision-review-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(fileName);
  }
  if (fileName.startsWith("prompt-")) {
    return /^prompt-[a-z0-9-]+-(worker|audit)\.md$/.test(fileName);
  }
  if (fileName.startsWith("overflow-continuation-")) {
    return /^overflow-continuation-wave-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(fileName);
  }
  return true;
}

function resolveDeclaredWaveArtifactLineage(fileNames, topicWaveIds) {
  const declared = Array.from(topicWaveIds);
  const resolved = [];
  const unresolved = [];
  const ambiguous = [];

  for (const fileName of fileNames) {
    const matches = declared.filter((waveId) => fileReferencesWave(fileName, waveId));
    if (matches.length === 1) {
      resolved.push({ fileName, waveId: matches[0] });
    } else if (matches.length === 0) {
      unresolved.push(fileName);
    } else {
      ambiguous.push({ fileName, waveIds: matches });
    }
  }

  return { resolved, unresolved, ambiguous };
}

function formatLifecycleLineageFailures(lineage) {
  return [
    ...lineage.unresolved.map((fileName) => `${fileName}:unresolved`),
    ...lineage.ambiguous.map((entry) => `${entry.fileName}:ambiguous:${entry.waveIds.join(",")}`),
  ];
}

async function analyzeTopicArtifacts(topicDir, topic) {
  const files = (await readdir(topicDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  const packetFiles = files.filter((name) => name.startsWith("packet-") && name.endsWith(".md"));
  const resultFiles = files.filter((name) => name.startsWith("result-") && name.endsWith(".md"));
  const closeoutFiles = files.filter((name) => name.startsWith("closeout-") && name.endsWith(".md"));
  const decisionReviewFiles = files.filter((name) => name.startsWith("decision-review-") && name.endsWith(".md"));
  const remediationFiles = files.filter((name) => name.includes("remediation") && name.endsWith(".md"));
  const overflowFiles = files.filter((name) => name.includes("overflow-continuation") || name.includes("remediation-continuation"));
  const execPackFiles = files.filter((name) => name.includes("exec-pack-") && name.endsWith(".md"));
  const trueCloseFiles = files.filter((name) => name === "topic-true-close-audit.md"
    || name.startsWith("result-topic-true-close")
    || name === "closeout-topic-true-close.md");
  const ambiguousLifecycleFiles = files.filter((name) => /^(packet|result|closeout|decision-review|prompt|overflow-continuation)-/.test(name)
    && !isRecognizedLifecycleArtifactName(name));
  const topicWaveIds = new Set(getTopicWaves(topic).map((entry) => entry.wave_id));
  const packetWaveFiles = packetFiles.filter((name) => !name.startsWith("packet-true-close"));
  const resultWaveFiles = resultFiles.filter((name) => !name.startsWith("result-topic-true-close") && !name.startsWith("result-true-close"));
  const closeoutWaveFiles = closeoutFiles.filter((name) => !name.startsWith("closeout-topic") && !name.startsWith("closeout-true-close"));
  const packetLineage = resolveDeclaredWaveArtifactLineage(packetWaveFiles, topicWaveIds);
  const resultLineage = resolveDeclaredWaveArtifactLineage(resultWaveFiles, topicWaveIds);
  const closeoutLineage = resolveDeclaredWaveArtifactLineage(closeoutWaveFiles, topicWaveIds);
  const packetWaveIds = new Set(packetLineage.resolved.map((entry) => entry.waveId));
  const resultWaveIds = resultLineage.resolved.map((entry) => entry.waveId);
  const closeoutWaveIds = new Set(closeoutLineage.resolved.map((entry) => entry.waveId));
  const closeoutWaveIdsArray = Array.from(closeoutWaveIds);
  const unresolvedPacketWaveRefs = formatLifecycleLineageFailures(packetLineage);
  const unresolvedResultWaveIds = formatLifecycleLineageFailures(resultLineage);
  const unresolvedCloseoutWaveRefs = formatLifecycleLineageFailures(closeoutLineage);
  const activeWaveCloseoutConflicts = getTopicWaves(topic)
    .filter((entry) => !["closed", "retired", "superseded"].includes(entry.state)
      && closeoutFiles.some((name) => fileReferencesWave(name, entry.wave_id) || closeoutWaveIds.has(entry.wave_id)))
    .map((entry) => `${entry.wave_id}:${entry.state}`);
  const topicHasOpenBlockers = getTopicWaves(topic).some((entry) => !["closed", "retired", "superseded"].includes(entry.state))
    || (typeof topic.selected_next_target === "string"
      && topic.selected_next_target.length > 0
      && topic.selected_next_target !== "topic_design_baseline");
  const prematureTrueClose = trueCloseFiles.length > 0 && topicHasOpenBlockers;
  const observedWaveIds = Array.from(new Set([
    ...Array.from(topicWaveIds),
    ...Array.from(packetWaveIds),
    ...closeoutWaveIdsArray,
    ...resultWaveIds,
  ])).sort();
  const observedWaves = observedWaveIds.map((waveId) => {
    const observed = {
      wave_id: waveId,
      packets: packetFiles.filter((name) => fileReferencesWave(name, waveId)).length,
      results: resultFiles.filter((name) => fileReferencesWave(name, waveId)).length,
      closeouts: closeoutFiles.filter((name) => fileReferencesWave(name, waveId)).length,
      decision_reviews: decisionReviewFiles.filter((name) => fileReferencesWave(name, waveId)).length,
      remediations: remediationFiles.filter((name) => fileReferencesWave(name, waveId)).length,
      overflow_continuations: overflowFiles.filter((name) => fileReferencesWave(name, waveId)).length,
      exec_packs: execPackFiles.filter((name) => fileReferencesWave(name, waveId)).length,
      declared_in_topic_yaml: topicWaveIds.has(waveId),
    };
    return { ...observed, observed_lineage: buildObservedLineage(observed) };
  });

  return {
    files,
    counts: {
      files: files.length,
      packets: packetFiles.length,
      results: resultFiles.length,
      closeouts: closeoutFiles.length,
      decision_reviews: decisionReviewFiles.length,
      remediations: remediationFiles.length,
      overflow_continuations: overflowFiles.length,
      exec_packs: execPackFiles.length,
      true_close_artifacts: trueCloseFiles.length,
    },
    waveIds: observedWaveIds,
    observedWaves,
    featureFlags: {
      decision_review_lineage: decisionReviewFiles.length > 0,
      remediation_lineage: remediationFiles.length > 0,
      overflow_lineage: overflowFiles.length > 0,
      true_close_lineage: trueCloseFiles.length >= 2,
      exec_pack_lineage: execPackFiles.length > 0,
    },
    unresolvedPacketWaveRefs,
    unresolvedResultWaveIds,
    unresolvedCloseoutWaveRefs,
    closeoutWaveIds: closeoutWaveIdsArray,
    ambiguousLifecycleFiles,
    activeWaveCloseoutConflicts,
    prematureTrueClose,
  };
}

export {
  analyzeTopicArtifacts,
  fileReferencesWave,
  isRecognizedLifecycleArtifactName,
  resolveDeclaredWaveArtifactLineage,
};
