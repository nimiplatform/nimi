import {
  buildHandoffPayload,
  formatHandoffPayload,
  writeHandoffPromptArtifacts,
} from "../lib/shared.mjs";
import {
  localize,
  styleCommand,
  styleHeading,
  styleLabel,
} from "../lib/ui.mjs";

function parseHandoffOptions(args) {
  const options = {
    json: false,
    prompt: false,
    skill: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--prompt") {
      options.prompt = true;
      continue;
    }

    if (arg === "--skill") {
      const next = args[index + 1];
      if (!next || next.startsWith("--")) {
        return {
          ok: false,
          error: localize(
            "nimicoding handoff refused: --skill requires a skill id.\n",
            "nimicoding handoff 拒绝执行：--skill 需要一个 skill id。\n",
          ),
        };
      }
      options.skill = next;
      index += 1;
      continue;
    }

    return {
      ok: false,
      error: localize(
        `nimicoding handoff refused: unknown option ${arg}.\n`,
        `nimicoding handoff 拒绝执行：未知选项 ${arg}。\n`,
      ),
    };
  }

  if (!options.skill) {
    return {
      ok: false,
      error: localize(
        "nimicoding handoff refused: explicit --skill is required.\n",
        "nimicoding handoff 拒绝执行：必须显式提供 --skill。\n",
      ),
    };
  }

  if (options.json && options.prompt) {
    return {
      ok: false,
      error: localize(
        "nimicoding handoff refused: --json and --prompt are mutually exclusive.\n",
        "nimicoding handoff 拒绝执行：--json 与 --prompt 不能同时使用。\n",
      ),
    };
  }

  return {
    ok: true,
    options,
  };
}

export async function runHandoff(args) {
  const parsed = parseHandoffOptions(args);
  if (!parsed.ok) {
    process.stderr.write(parsed.error);
    return 2;
  }

  const payload = await buildHandoffPayload(process.cwd(), parsed.options.skill);
  if (parsed.options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else if (parsed.options.prompt) {
    if (!payload.ok) {
      process.stderr.write(`${localize(payload.nextAction, payload.nextAction
        .replace("Bootstrap or handoff validation is failing; repair doctor errors before exporting handoff payloads", "bootstrap 或 handoff 校验失败；请先修复 doctor 报错，再导出 handoff payload")
        .replace("Projects may delegate spec reconstruction to an external AI host when lifecycle repair or reconstruction work is needed", "当需要 lifecycle repair 或 reconstruction 工作时，项目可以将 spec reconstruction 委托给外部 AI host")
        .replace("This skill requires reconstructed `.nimi/spec/*.yaml` target truth before handoff", "该 skill 在 handoff 前需要已重建的 `.nimi/spec/*.yaml` target truth")
        .replace("Skill prerequisites are satisfied by the current project-local truth", "当前项目本地 truth 已满足该 skill 的前置条件"))}\n`);
      return payload.exitCode;
    }

    const refs = await writeHandoffPromptArtifacts(process.cwd(), payload);
    process.stdout.write(`${styleHeading(localize(`Prepared local handoff refs for ${payload.skill.id}`, `已为 ${payload.skill.id} 准备本地 handoff ref`))}

${styleLabel(localize("Created:", "已创建："))}
  - ${refs.jsonRef}
  - ${refs.promptRef}

${styleLabel(localize("Use:", "使用方式："))}
  - ${localize(`Treat ${refs.jsonRef} as the authoritative machine contract`, `将 ${refs.jsonRef} 作为权威机器契约`)}
  - ${localize(`Paste the contents of ${refs.promptRef} into the external AI host when needed`, `需要时将 ${refs.promptRef} 的内容粘贴给外部 AI host`)}
  - ${localize("Optional command preview:", "可选命令预览：")} ${styleCommand(`nimicoding handoff --skill ${payload.skill.id} --json`)}
`);
  } else {
    process.stdout.write(formatHandoffPayload(payload));
  }

  return payload.exitCode;
}

export { parseHandoffOptions };
