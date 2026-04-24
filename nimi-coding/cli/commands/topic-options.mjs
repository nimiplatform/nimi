import { localize } from "../lib/ui.mjs";
import { validateTopicId, validateTopicSlug } from "../lib/topic.mjs";
import { requireOptionValue } from "./topic-options-shared.mjs";

export function parseTopicCreateOptions(args) {
  const [slug, ...rest] = args;
  if (!slug) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic create refused: expected a slug argument.",
        "nimicoding topic create 已拒绝：需要提供 slug 参数。",
      )}\n`,
    };
  }
  if (!validateTopicSlug(slug) && !validateTopicId(slug)) {
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic create refused: slug must be lowercase kebab-case or a full topic id: ${slug}.`,
        `nimicoding topic create 已拒绝：slug 必须是小写 kebab-case 或完整 topic id：${slug}。`,
      )}\n`,
    };
  }
  const options = {
    slug,
    title: null,
    justification: null,
    mode: null,
    posture: null,
    designPolicy: null,
    parallelTruth: null,
    layering: null,
    risk: null,
    applicability: null,
    executionMode: null,
    json: false,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = rest[index + 1];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--title") {
      const valueCheck = requireOptionValue("--title", next, "nimicoding topic create refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.title = next;
      index += 1;
      continue;
    }
    if (arg === "--justification") {
      const valueCheck = requireOptionValue("--justification", next, "nimicoding topic create refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.justification = next;
      index += 1;
      continue;
    }
    if (arg === "--mode") {
      const valueCheck = requireOptionValue("--mode", next, "nimicoding topic create refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.mode = next;
      index += 1;
      continue;
    }
    if (arg === "--posture") {
      const valueCheck = requireOptionValue("--posture", next, "nimicoding topic create refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      const normalized = next.replaceAll("-", "_");
      options.posture = normalized;
      index += 1;
      continue;
    }
    if (arg === "--design-policy") {
      const valueCheck = requireOptionValue("--design-policy", next, "nimicoding topic create refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      const normalized = next.replaceAll("-", "_");
      options.designPolicy = normalized;
      index += 1;
      continue;
    }
    if (arg === "--parallel-truth") {
      const valueCheck = requireOptionValue("--parallel-truth", next, "nimicoding topic create refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      const normalized = next.replaceAll("-", "_");
      options.parallelTruth = normalized;
      index += 1;
      continue;
    }
    if (arg === "--layering") {
      const valueCheck = requireOptionValue("--layering", next, "nimicoding topic create refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      const normalized = next.replaceAll("-", "_");
      options.layering = normalized;
      index += 1;
      continue;
    }
    if (arg === "--risk") {
      const valueCheck = requireOptionValue("--risk", next, "nimicoding topic create refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.risk = next;
      index += 1;
      continue;
    }
    if (arg === "--applicability") {
      const valueCheck = requireOptionValue("--applicability", next, "nimicoding topic create refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      const normalized = next.replaceAll("-", "_");
      options.applicability = normalized;
      index += 1;
      continue;
    }
    if (arg === "--execution-mode") {
      const valueCheck = requireOptionValue("--execution-mode", next, "nimicoding topic create refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      const normalized = next.replaceAll("-", "_");
      options.executionMode = normalized;
      index += 1;
      continue;
    }
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic create refused: unknown option ${arg}.`,
        `nimicoding topic create 已拒绝：未知选项 ${arg}。`,
      )}\n`,
    };
  }
  if (!options.justification) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic create refused: --justification is required so topic entry remains explicit.",
        "nimicoding topic create 已拒绝：必须提供 --justification，确保 topic entry 保持显式。",
      )}\n`,
    };
  }
  return {
    ok: true,
    options,
  };
}
export function parseTopicReadOptions(args, command) {
  const options = {
    input: null,
    json: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (options.input === null) {
      options.input = arg;
      continue;
    }
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic ${command} refused: unexpected argument ${arg}.`,
        `nimicoding topic ${command} 已拒绝：存在未预期参数 ${arg}。`,
      )}\n`,
    };
  }
  return {
    ok: true,
    options,
  };
}
export function parseRunNextStepOptions(args) {
  const [topicInput, ...rest] = args;
  if (!topicInput) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic run-next-step refused: expected <topic-id>.",
        "nimicoding topic run-next-step 已拒绝：需要 <topic-id>。",
      )}\n`,
    };
  }
  const options = { topicInput, json: false };
  for (const arg of rest) {
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic run-next-step refused: unknown option ${arg}.`,
        `nimicoding topic run-next-step 已拒绝：未知选项 ${arg}。`,
      )}\n`,
    };
  }
  return { ok: true, options };
}
function parseArtifactRef(value) {
  const separator = value.indexOf("=");
  if (separator <= 0 || separator === value.length - 1) {
    return null;
  }
  return [value.slice(0, separator), value.slice(separator + 1)];
}
export function parseRunLedgerOptions(args) {
  const [action, topicInput, ...rest] = args;
  if (!action || !topicInput) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic run-ledger refused: expected <init|record|build|status> <topic-id>.",
        "nimicoding topic run-ledger 已拒绝：需要 <init|record|build|status> <topic-id>。",
      )}\n`,
    };
  }
  if (!["init", "record", "build", "status"].includes(action)) {
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic run-ledger refused: unknown action ${action}.`,
        `nimicoding topic run-ledger 已拒绝：未知动作 ${action}。`,
      )}\n`,
    };
  }
  const options = {
    action,
    topicInput,
    runId: null,
    eventKind: null,
    stopClass: null,
    recommendedAction: null,
    sourceRef: null,
    summary: null,
    verifiedAt: null,
    waveId: null,
    artifactRefs: {},
    json: false,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = rest[index + 1];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--run-id") {
      const valueCheck = requireOptionValue("--run-id", next, "nimicoding topic run-ledger refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.runId = next;
      index += 1;
      continue;
    }
    if (arg === "--event") {
      const valueCheck = requireOptionValue("--event", next, "nimicoding topic run-ledger record refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.eventKind = next;
      index += 1;
      continue;
    }
    if (arg === "--stop-class") {
      const valueCheck = requireOptionValue("--stop-class", next, "nimicoding topic run-ledger record refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.stopClass = next;
      index += 1;
      continue;
    }
    if (arg === "--action") {
      const valueCheck = requireOptionValue("--action", next, "nimicoding topic run-ledger record refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.recommendedAction = next;
      index += 1;
      continue;
    }
    if (arg === "--source") {
      const valueCheck = requireOptionValue("--source", next, "nimicoding topic run-ledger record refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.sourceRef = next;
      index += 1;
      continue;
    }
    if (arg === "--summary") {
      const valueCheck = requireOptionValue("--summary", next, "nimicoding topic run-ledger record refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.summary = next;
      index += 1;
      continue;
    }
    if (arg === "--verified-at") {
      const valueCheck = requireOptionValue("--verified-at", next, "nimicoding topic run-ledger record refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.verifiedAt = next;
      index += 1;
      continue;
    }
    if (arg === "--wave") {
      const valueCheck = requireOptionValue("--wave", next, "nimicoding topic run-ledger record refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.waveId = next;
      index += 1;
      continue;
    }
    if (arg === "--artifact") {
      const valueCheck = requireOptionValue("--artifact", next, "nimicoding topic run-ledger record refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      const parsed = parseArtifactRef(next);
      if (!parsed) {
        return {
          ok: false,
          error: `${localize(
            `nimicoding topic run-ledger record refused: --artifact must use key=ref, found ${next}.`,
            `nimicoding topic run-ledger record 已拒绝：--artifact 必须使用 key=ref，当前为 ${next}。`,
          )}\n`,
        };
      }
      options.artifactRefs[parsed[0]] = parsed[1];
      index += 1;
      continue;
    }
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic run-ledger refused: unknown option ${arg}.`,
        `nimicoding topic run-ledger 已拒绝：未知选项 ${arg}。`,
      )}\n`,
    };
  }
  if (!options.runId) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic run-ledger refused: --run-id is required.",
        "nimicoding topic run-ledger 已拒绝：必须提供 --run-id。",
      )}\n`,
    };
  }
  if (action === "record" && (
    !options.eventKind
    || !options.stopClass
    || !options.recommendedAction
    || !options.sourceRef
    || !options.summary
    || !options.verifiedAt
  )) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic run-ledger record refused: --event, --stop-class, --action, --source, --summary, and --verified-at are required.",
        "nimicoding topic run-ledger record 已拒绝：必须提供 --event、--stop-class、--action、--source、--summary 和 --verified-at。",
      )}\n`,
    };
  }
  return { ok: true, options };
}
export function parseTopicHoldOptions(args) {
  const [topicInput, ...rest] = args;
  if (!topicInput) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic hold refused: expected <topic-id> and required options.",
        "nimicoding topic hold 已拒绝：需要 <topic-id> 和必填选项。",
      )}\n`,
    };
  }
  const options = {
    topicInput,
    reason: null,
    summary: null,
    reopenCriteria: null,
    closeTrigger: null,
    json: false,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = rest[index + 1];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--reason") {
      const valueCheck = requireOptionValue("--reason", next, "nimicoding topic hold refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      if (!validateTopicSlug(next)) {
        return {
          ok: false,
          error: `${localize(
            `nimicoding topic hold refused: --reason must be lowercase kebab-case, found ${next}.`,
            `nimicoding topic hold 已拒绝：--reason 必须是小写 kebab-case，当前为 ${next}。`,
          )}\n`,
        };
      }
      options.reason = next;
      index += 1;
      continue;
    }
    if (arg === "--summary") {
      const valueCheck = requireOptionValue("--summary", next, "nimicoding topic hold refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.summary = next;
      index += 1;
      continue;
    }
    if (arg === "--reopen-criteria") {
      const valueCheck = requireOptionValue("--reopen-criteria", next, "nimicoding topic hold refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.reopenCriteria = next;
      index += 1;
      continue;
    }
    if (arg === "--close-trigger") {
      const valueCheck = requireOptionValue("--close-trigger", next, "nimicoding topic hold refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.closeTrigger = next;
      index += 1;
      continue;
    }
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic hold refused: unknown option ${arg}.`,
        `nimicoding topic hold 已拒绝：未知选项 ${arg}。`,
      )}\n`,
    };
  }
  if (!options.reason || !options.summary) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic hold refused: --reason and --summary are required.",
        "nimicoding topic hold 已拒绝：必须提供 --reason 和 --summary。",
      )}\n`,
    };
  }
  if (!options.reopenCriteria && !options.closeTrigger) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic hold refused: --reopen-criteria or --close-trigger is required.",
        "nimicoding topic hold 已拒绝：必须提供 --reopen-criteria 或 --close-trigger。",
      )}\n`,
    };
  }
  return { ok: true, options };
}
export function parseTopicResumeOptions(args) {
  const [topicInput, ...rest] = args;
  if (!topicInput) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic resume refused: expected <topic-id> and --criteria-met <text>.",
        "nimicoding topic resume 已拒绝：需要 <topic-id> 和 --criteria-met <text>。",
      )}\n`,
    };
  }
  const options = {
    topicInput,
    criteriaMet: null,
    json: false,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = rest[index + 1];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--criteria-met") {
      const valueCheck = requireOptionValue("--criteria-met", next, "nimicoding topic resume refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.criteriaMet = next;
      index += 1;
      continue;
    }
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic resume refused: unknown option ${arg}.`,
        `nimicoding topic resume 已拒绝：未知选项 ${arg}。`,
      )}\n`,
    };
  }
  if (!options.criteriaMet) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic resume refused: --criteria-met is required.",
        "nimicoding topic resume 已拒绝：必须提供 --criteria-met。",
      )}\n`,
    };
  }
  return { ok: true, options };
}

export {
  parseWaveAddOptions,
  parseWaveActionOptions,
  parsePacketFreezeOptions,
  parseDispatchOptions,
  parseResultRecordOptions,
  parseDecisionReviewOptions,
  parseRemediationOpenOptions,
  parseOverflowContinueOptions,
  parseCloseoutOptions,
  parseTrueCloseAuditOptions,
  parseGraphValidateOptions,
} from "./topic-options-workflow.mjs";
