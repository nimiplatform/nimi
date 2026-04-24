import { localize } from "../lib/ui.mjs";
import { validateTopicSlug, validateWaveId } from "../lib/topic.mjs";
import { requireOptionValue, validateEnumOption } from "./topic-options-shared.mjs";

const TOPIC_RESULT_KIND_INPUT_ENUM = ["worker", "implementation", "audit", "preflight", "judgement"];

function normalizeResultKindInput(value) {
  if (value === "worker") {
    return "implementation";
  }
  return value;
}
export function parseWaveAddOptions(args) {
  const [topicInput, waveId, slug, ...rest] = args;
  if (!topicInput || !waveId || !slug) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic wave add refused: expected <topic-id> <wave-id> <slug>.",
        "nimicoding topic wave add 已拒绝：需要 <topic-id> <wave-id> <slug>。",
      )}\n`,
    };
  }
  if (!validateWaveId(waveId)) {
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic wave add refused: invalid wave id ${waveId}. Use wave-<...>.`,
        `nimicoding topic wave add 已拒绝：无效 wave id ${waveId}。请使用 wave-<...>。`,
      )}\n`,
    };
  }
  if (!validateTopicSlug(slug)) {
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic wave add refused: invalid slug ${slug}.`,
        `nimicoding topic wave add 已拒绝：无效 slug ${slug}。`,
      )}\n`,
    };
  }
  const options = {
    topicInput,
    waveId,
    slug,
    goal: null,
    ownerDomain: null,
    parallelizableAfter: "stable_contract",
    deps: [],
    json: false,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = rest[index + 1];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--goal") {
      const valueCheck = requireOptionValue("--goal", next, "nimicoding topic wave add refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.goal = next;
      index += 1;
      continue;
    }
    if (arg === "--owner-domain") {
      const valueCheck = requireOptionValue("--owner-domain", next, "nimicoding topic wave add refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.ownerDomain = next;
      index += 1;
      continue;
    }
    if (arg === "--parallelizable-after") {
      const valueCheck = requireOptionValue("--parallelizable-after", next, "nimicoding topic wave add refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.parallelizableAfter = next;
      index += 1;
      continue;
    }
    if (arg === "--dep") {
      const valueCheck = requireOptionValue("--dep", next, "nimicoding topic wave add refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.deps.push(next);
      index += 1;
      continue;
    }
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic wave add refused: unknown option ${arg}.`,
        `nimicoding topic wave add 已拒绝：未知选项 ${arg}。`,
      )}\n`,
    };
  }
  if (!options.goal || !options.ownerDomain) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic wave add refused: --goal and --owner-domain are required.",
        "nimicoding topic wave add 已拒绝：必须提供 --goal 和 --owner-domain。",
      )}\n`,
    };
  }
  return { ok: true, options };
}
export function parseWaveActionOptions(args, action) {
  const [topicInput, waveId, ...rest] = args;
  if (!topicInput || !waveId) {
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic wave ${action} refused: expected <topic-id> <wave-id>.`,
        `nimicoding topic wave ${action} 已拒绝：需要 <topic-id> <wave-id>。`,
      )}\n`,
    };
  }
  const options = { topicInput, waveId, json: false };
  for (const arg of rest) {
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic wave ${action} refused: unknown option ${arg}.`,
        `nimicoding topic wave ${action} 已拒绝：未知选项 ${arg}。`,
      )}\n`,
    };
  }
  return { ok: true, options };
}
export function parsePacketFreezeOptions(args) {
  const [topicInput, ...rest] = args;
  if (!topicInput) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic packet freeze refused: expected <topic-id> and --from <draft-path>.",
        "nimicoding topic packet freeze 已拒绝：需要 <topic-id> 和 --from <draft-path>。",
      )}\n`,
    };
  }
  const options = { topicInput, from: null, json: false };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = rest[index + 1];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--from") {
      const valueCheck = requireOptionValue("--from", next, "nimicoding topic packet freeze refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.from = next;
      index += 1;
      continue;
    }
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic packet freeze refused: unknown option ${arg}.`,
        `nimicoding topic packet freeze 已拒绝：未知选项 ${arg}。`,
      )}\n`,
    };
  }
  if (!options.from) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic packet freeze refused: --from is required.",
        "nimicoding topic packet freeze 已拒绝：必须提供 --from。",
      )}\n`,
    };
  }
  return { ok: true, options };
}
export function parseDispatchOptions(args, role) {
  const [topicInput, ...rest] = args;
  if (!topicInput) {
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic ${role} dispatch refused: expected <topic-id> and --packet <packet-id>.`,
        `nimicoding topic ${role} dispatch 已拒绝：需要 <topic-id> 和 --packet <packet-id>。`,
      )}\n`,
    };
  }
  const options = { topicInput, packetId: null, json: false };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = rest[index + 1];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--packet") {
      const valueCheck = requireOptionValue("--packet", next, `nimicoding topic ${role} dispatch refused`);
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.packetId = next;
      index += 1;
      continue;
    }
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic ${role} dispatch refused: unknown option ${arg}.`,
        `nimicoding topic ${role} dispatch 已拒绝：未知选项 ${arg}。`,
      )}\n`,
    };
  }
  if (!options.packetId) {
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic ${role} dispatch refused: --packet is required.`,
        `nimicoding topic ${role} dispatch 已拒绝：必须提供 --packet。`,
      )}\n`,
    };
  }
  return { ok: true, options };
}
export function parseResultRecordOptions(args) {
  const [topicInput, ...rest] = args;
  if (!topicInput) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic result record refused: expected <topic-id> and required options.",
        "nimicoding topic result record 已拒绝：需要 <topic-id> 和必填选项。",
      )}\n`,
    };
  }
  const options = {
    topicInput,
    kind: null,
    verdict: null,
    from: null,
    verifiedAt: null,
    json: false,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = rest[index + 1];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--kind") {
      const valueCheck = requireOptionValue("--kind", next, "nimicoding topic result record refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      const normalized = normalizeResultKindInput(next);
      const enumCheck = validateEnumOption("--kind", next, TOPIC_RESULT_KIND_INPUT_ENUM, "nimicoding topic result record refused");
      if (!enumCheck.ok) {
        return {
          ok: false,
          error: `${localize(
            `nimicoding topic result record refused: unsupported --kind value ${next}.`,
            `nimicoding topic result record 已拒绝：不支持的 --kind 值 ${next}。`,
          )}\n`,
        };
      }
      options.kind = normalized;
      index += 1;
      continue;
    }
    if (arg === "--verdict") {
      const valueCheck = requireOptionValue("--verdict", next, "nimicoding topic result record refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.verdict = next;
      index += 1;
      continue;
    }
    if (arg === "--from") {
      const valueCheck = requireOptionValue("--from", next, "nimicoding topic result record refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.from = next;
      index += 1;
      continue;
    }
    if (arg === "--verified-at") {
      const valueCheck = requireOptionValue("--verified-at", next, "nimicoding topic result record refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.verifiedAt = next;
      index += 1;
      continue;
    }
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic result record refused: unknown option ${arg}.`,
        `nimicoding topic result record 已拒绝：未知选项 ${arg}。`,
      )}\n`,
    };
  }
  if (!options.kind || !options.verdict || !options.from || !options.verifiedAt) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic result record refused: --kind, --verdict, --from, and --verified-at are required.",
        "nimicoding topic result record 已拒绝：必须提供 --kind、--verdict、--from 和 --verified-at。",
      )}\n`,
    };
  }
  return { ok: true, options };
}
export function parseDecisionReviewOptions(args) {
  const [topicInput, slug, ...rest] = args;
  if (!topicInput || !slug) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic decision-review refused: expected <topic-id> <slug> and required options.",
        "nimicoding topic decision-review 已拒绝：需要 <topic-id> <slug> 和必填选项。",
      )}\n`,
    };
  }
  const options = {
    topicInput,
    slug,
    decision: null,
    replacedScope: null,
    activeReplacementScope: null,
    disposition: "unchanged",
    targetWaveId: null,
    date: new Date().toISOString().slice(0, 10),
    json: false,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = rest[index + 1];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--decision") {
      const valueCheck = requireOptionValue("--decision", next, "nimicoding topic decision-review refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.decision = next;
      index += 1;
      continue;
    }
    if (arg === "--replaced-scope") {
      const valueCheck = requireOptionValue("--replaced-scope", next, "nimicoding topic decision-review refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.replacedScope = next;
      index += 1;
      continue;
    }
    if (arg === "--active-replacement-scope") {
      const valueCheck = requireOptionValue("--active-replacement-scope", next, "nimicoding topic decision-review refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.activeReplacementScope = next;
      index += 1;
      continue;
    }
    if (arg === "--disposition") {
      const valueCheck = requireOptionValue("--disposition", next, "nimicoding topic decision-review refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.disposition = next;
      index += 1;
      continue;
    }
    if (arg === "--target-wave") {
      const valueCheck = requireOptionValue("--target-wave", next, "nimicoding topic decision-review refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      if (!validateWaveId(next)) {
        return {
          ok: false,
          error: `${localize(
            `nimicoding topic decision-review refused: invalid --target-wave value ${next}.`,
            `nimicoding topic decision-review 已拒绝：无效 --target-wave 值 ${next}。`,
          )}\n`,
        };
      }
      options.targetWaveId = next;
      index += 1;
      continue;
    }
    if (arg === "--date") {
      const valueCheck = requireOptionValue("--date", next, "nimicoding topic decision-review refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.date = next;
      index += 1;
      continue;
    }
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic decision-review refused: unknown option ${arg}.`,
        `nimicoding topic decision-review 已拒绝：未知选项 ${arg}。`,
      )}\n`,
    };
  }
  if (!options.decision || !options.replacedScope || !options.activeReplacementScope) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic decision-review refused: --decision, --replaced-scope, and --active-replacement-scope are required.",
        "nimicoding topic decision-review 已拒绝：必须提供 --decision、--replaced-scope 和 --active-replacement-scope。",
      )}\n`,
    };
  }
  return { ok: true, options };
}
export function parseRemediationOpenOptions(args) {
  const [topicInput, ...rest] = args;
  if (!topicInput) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic remediation open refused: expected <topic-id> and required options.",
        "nimicoding topic remediation open 已拒绝：需要 <topic-id> 和必填选项。",
      )}\n`,
    };
  }
  const options = {
    topicInput,
    kind: null,
    reason: null,
    overflowedPacketId: null,
    json: false,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = rest[index + 1];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--kind") {
      const valueCheck = requireOptionValue("--kind", next, "nimicoding topic remediation open refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      const normalized = next.replaceAll("-", "_");
      options.kind = normalized;
      index += 1;
      continue;
    }
    if (arg === "--reason") {
      const valueCheck = requireOptionValue("--reason", next, "nimicoding topic remediation open refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      if (!validateTopicSlug(next)) {
        return {
          ok: false,
          error: `${localize(
            `nimicoding topic remediation open refused: --reason must be lowercase kebab-case, found ${next}.`,
            `nimicoding topic remediation open 已拒绝：--reason 必须是小写 kebab-case，当前为 ${next}。`,
          )}\n`,
        };
      }
      options.reason = next;
      index += 1;
      continue;
    }
    if (arg === "--overflowed-packet") {
      const valueCheck = requireOptionValue("--overflowed-packet", next, "nimicoding topic remediation open refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.overflowedPacketId = next;
      index += 1;
      continue;
    }
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic remediation open refused: unknown option ${arg}.`,
        `nimicoding topic remediation open 已拒绝：未知选项 ${arg}。`,
      )}\n`,
    };
  }
  if (!options.kind || !options.reason) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic remediation open refused: --kind and --reason are required.",
        "nimicoding topic remediation open 已拒绝：必须提供 --kind 和 --reason。",
      )}\n`,
    };
  }
  return { ok: true, options };
}
export function parseOverflowContinueOptions(args) {
  const [topicInput, ...rest] = args;
  if (!topicInput) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic overflow continue refused: expected <topic-id> and required options.",
        "nimicoding topic overflow continue 已拒绝：需要 <topic-id> 和必填选项。",
      )}\n`,
    };
  }
  const options = {
    topicInput,
    continuationPacketId: null,
    overflowedPacketId: null,
    managerJudgement: null,
    sameOwnerDomain: false,
    json: false,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = rest[index + 1];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--packet") {
      const valueCheck = requireOptionValue("--packet", next, "nimicoding topic overflow continue refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.continuationPacketId = next;
      index += 1;
      continue;
    }
    if (arg === "--overflowed-packet") {
      const valueCheck = requireOptionValue("--overflowed-packet", next, "nimicoding topic overflow continue refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.overflowedPacketId = next;
      index += 1;
      continue;
    }
    if (arg === "--manager-judgement") {
      const valueCheck = requireOptionValue("--manager-judgement", next, "nimicoding topic overflow continue refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.managerJudgement = next;
      index += 1;
      continue;
    }
    if (arg === "--same-owner-domain") {
      options.sameOwnerDomain = true;
      continue;
    }
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic overflow continue refused: unknown option ${arg}.`,
        `nimicoding topic overflow continue 已拒绝：未知选项 ${arg}。`,
      )}\n`,
    };
  }
  if (!options.continuationPacketId || !options.overflowedPacketId || !options.managerJudgement || options.sameOwnerDomain !== true) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic overflow continue refused: --packet, --overflowed-packet, --manager-judgement, and --same-owner-domain are required.",
        "nimicoding topic overflow continue 已拒绝：必须提供 --packet、--overflowed-packet、--manager-judgement 和 --same-owner-domain。",
      )}\n`,
    };
  }
  return { ok: true, options };
}
export function parseCloseoutOptions(args, scope) {
  const [topicInput, maybeWaveId, ...rest] = args;
  if (!topicInput || (scope === "wave" && !maybeWaveId)) {
    return {
      ok: false,
      error: `${localize(
        scope === "wave"
          ? "nimicoding topic closeout wave refused: expected <topic-id> <wave-id> and required closure options."
          : "nimicoding topic closeout topic refused: expected <topic-id> and required closure options.",
        scope === "wave"
          ? "nimicoding topic closeout wave 已拒绝：需要 <topic-id> <wave-id> 和必填 closure 选项。"
          : "nimicoding topic closeout topic 已拒绝：需要 <topic-id> 和必填 closure 选项。",
      )}\n`,
    };
  }
  const options = {
    topicInput,
    waveId: scope === "wave" ? maybeWaveId : null,
    authorityClosure: null,
    semanticClosure: null,
    consumerClosure: null,
    driftResistanceClosure: null,
    disposition: null,
    json: false,
  };
  const remaining = scope === "wave" ? rest : [maybeWaveId, ...rest].filter((entry) => entry !== undefined);
  for (let index = 0; index < remaining.length; index += 1) {
    const arg = remaining[index];
    const next = remaining[index + 1];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--authority") {
      const valueCheck = requireOptionValue("--authority", next, `nimicoding topic closeout ${scope} refused`);
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.authorityClosure = next;
      index += 1;
      continue;
    }
    if (arg === "--semantic") {
      const valueCheck = requireOptionValue("--semantic", next, `nimicoding topic closeout ${scope} refused`);
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.semanticClosure = next;
      index += 1;
      continue;
    }
    if (arg === "--consumer") {
      const valueCheck = requireOptionValue("--consumer", next, `nimicoding topic closeout ${scope} refused`);
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.consumerClosure = next;
      index += 1;
      continue;
    }
    if (arg === "--drift-resistance") {
      const valueCheck = requireOptionValue("--drift-resistance", next, `nimicoding topic closeout ${scope} refused`);
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.driftResistanceClosure = next;
      index += 1;
      continue;
    }
    if (arg === "--disposition") {
      const valueCheck = requireOptionValue("--disposition", next, `nimicoding topic closeout ${scope} refused`);
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.disposition = next;
      index += 1;
      continue;
    }
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic closeout ${scope} refused: unknown option ${arg}.`,
        `nimicoding topic closeout ${scope} 已拒绝：未知选项 ${arg}。`,
      )}\n`,
    };
  }
  if (!options.authorityClosure || !options.semanticClosure || !options.consumerClosure || !options.driftResistanceClosure || !options.disposition) {
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic closeout ${scope} refused: all four closures and --disposition are required.`,
        `nimicoding topic closeout ${scope} 已拒绝：必须提供四个 closure 和 --disposition。`,
      )}\n`,
    };
  }
  return { ok: true, options };
}
export function parseTrueCloseAuditOptions(args) {
  const [topicInput, ...rest] = args;
  if (!topicInput) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic true-close-audit refused: expected <topic-id> and --judgement <text>.",
        "nimicoding topic true-close-audit 已拒绝：需要 <topic-id> 和 --judgement <text>。",
      )}\n`,
    };
  }
  const options = {
    topicInput,
    judgement: null,
    json: false,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = rest[index + 1];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--judgement") {
      const valueCheck = requireOptionValue("--judgement", next, "nimicoding topic true-close-audit refused");
      if (!valueCheck.ok) {
        return valueCheck;
      }
      options.judgement = next;
      index += 1;
      continue;
    }
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic true-close-audit refused: unknown option ${arg}.`,
        `nimicoding topic true-close-audit 已拒绝：未知选项 ${arg}。`,
      )}\n`,
    };
  }
  if (!options.judgement) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding topic true-close-audit refused: --judgement is required.",
        "nimicoding topic true-close-audit 已拒绝：必须提供 --judgement。",
      )}\n`,
    };
  }
  return { ok: true, options };
}
export function parseGraphValidateOptions(args, commandLabel) {
  const options = { topicInput: null, waveId: null, json: false };
  for (const arg of args) {
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (options.topicInput === null) {
      options.topicInput = arg;
      continue;
    }
    if (options.waveId === null) {
      options.waveId = arg;
      continue;
    }
    return {
      ok: false,
      error: `${localize(
        `nimicoding topic ${commandLabel} refused: unknown option ${arg}.`,
        `nimicoding topic ${commandLabel} 已拒绝：未知选项 ${arg}。`,
      )}\n`,
    };
  }
  return { ok: true, options };
}
