import { mkdir } from "node:fs/promises";
import path from "node:path";

import { pathExists } from "./fs-helpers.mjs";
import { formatDate, loadTopicRuntimeAuthority, toPortableRelativePath } from "./topic-common.mjs";
import {
  buildCreatePayload,
  deriveTopicId,
  getTopicStateRoot,
  titleFromSlug,
  writeTopicScaffold,
} from "./topic-scaffold.mjs";

export * from "./topic-common.mjs";
export * from "./topic-scaffold.mjs";
export * from "./topic-waves.mjs";
export * from "./topic-artifacts.mjs";
export * from "./topic-decisions.mjs";
export * from "./topic-ledger.mjs";
export * from "./topic-execution.mjs";
export * from "./topic-closeout.mjs";
export * from "./topic-root-validation.mjs";

export async function createTopic(projectRoot, options) {
  const now = options.now ?? new Date();
  const topicId = deriveTopicId(options.slug, now);
  const today = formatDate(now);
  const topicDir = path.join(getTopicStateRoot(projectRoot, "proposal"), topicId);

  if (await pathExists(topicDir)) {
    return {
      ok: false,
      error: `Topic already exists: ${toPortableRelativePath(path.relative(projectRoot, topicDir))}`,
    };
  }

  await mkdir(getTopicStateRoot(projectRoot, "proposal"), { recursive: true });
  const authority = await loadTopicRuntimeAuthority(projectRoot);
  const topic = buildCreatePayload(
    {
      topicId,
      today,
      title: options.title,
      mode: options.mode,
      posture: options.posture,
      designPolicy: options.designPolicy,
      parallelTruth: options.parallelTruth,
      layering: options.layering,
      risk: options.risk,
      applicability: options.applicability,
      justification: options.justification,
      executionMode: options.executionMode,
    },
    authority,
  );

  await writeTopicScaffold(topicDir, topic);
  return {
    ok: true,
    topicId,
    topicDir,
    topicRef: toPortableRelativePath(path.relative(projectRoot, topicDir)),
    state: "proposal",
    title: topic.title,
  };
}

export function deriveCreateDefaults(options) {
  const mode = options.mode ?? "greenfield";
  const posture = options.posture ?? (mode === "landed" ? "backward_compat" : "no_legacy_hard_cut");
  return {
    mode,
    posture,
    designPolicy: options.designPolicy ?? "complete_contract_first",
    parallelTruth: options.parallelTruth ?? "forbidden",
    layering: options.layering ?? "ontology",
    risk: options.risk ?? "high",
    applicability: options.applicability ?? "authority_bearing",
    executionMode: options.executionMode ?? "manager_worker_auditor",
  };
}
