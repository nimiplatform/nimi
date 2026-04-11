import { VERSION } from "./constants.mjs";
import {
  localize,
  styleCommand,
  styleHeading,
  styleMuted,
} from "./lib/ui.mjs";

export function helpText() {
  const lines = [
    styleHeading(`nimicoding ${VERSION}`),
    "",
    localize("Usage:", "用法："),
    `  ${styleCommand("nimicoding --help")}`,
    `  ${styleCommand("nimicoding --version")}`,
    `  ${styleCommand("nimicoding start")}`,
    `  ${styleCommand("nimicoding start --yes")}`,
    `  ${styleCommand("nimicoding start --host <generic|codex|claude|oh-my-codex>")}`,
    `  ${styleCommand("nimicoding clear")}`,
    `  ${styleCommand("nimicoding clear --yes")}`,
    `  ${styleCommand("nimicoding doctor")}`,
    `  ${styleCommand("nimicoding doctor --verbose")}`,
    `  ${styleCommand("nimicoding doctor --json")}`,
    `  ${styleCommand("nimicoding handoff --skill <skill-id>")}`,
    `  ${styleCommand("nimicoding handoff --skill <skill-id> --json")}`,
    `  ${styleCommand("nimicoding handoff --skill <skill-id> --prompt")}`,
    `  ${styleCommand("nimicoding admit-high-risk-decision --from <json> --admitted-at <iso8601> [--json] [--write-spec]")}`,
    `  ${styleCommand("nimicoding closeout --skill <skill-id> --outcome <completed|blocked|failed> --verified-at <iso8601>")}`,
    `  ${styleCommand("nimicoding closeout --skill <skill-id> --outcome <completed|blocked|failed> --verified-at <iso8601> --json")}`,
    `  ${styleCommand("nimicoding closeout --skill <skill-id> --outcome <completed|blocked|failed> --verified-at <iso8601> --write-local")}`,
    `  ${styleCommand("nimicoding closeout --from <json> [--json] [--write-local]")}`,
    `  ${styleCommand("nimicoding decide-high-risk-execution --from <json> --acceptance <path> --verified-at <iso8601> [--json] [--write-local]")}`,
    `  ${styleCommand("nimicoding ingest-high-risk-execution --from <json> [--json] [--write-local]")}`,
    `  ${styleCommand("nimicoding review-high-risk-execution --from <json> [--json] [--write-local]")}`,
    `  ${styleCommand("nimicoding validate-execution-packet <path>")}`,
    `  ${styleCommand("nimicoding validate-orchestration-state <path>")}`,
    `  ${styleCommand("nimicoding validate-prompt <path>")}`,
    `  ${styleCommand("nimicoding validate-worker-output <path>")}`,
    `  ${styleCommand("nimicoding validate-acceptance <path>")}`,
    "",
    localize("Notes:", "说明："),
    styleMuted(localize(
      "  - `nimicoding start` is the primary entrypoint; it sets up the project and prepares the next AI task",
      "  - `nimicoding start` 是主入口；它会准备项目并为下一项 AI 任务做好准备",
    )),
    styleMuted(localize(
      "  - interactive `nimicoding start` describes one option, asks once, and applies one option at a time",
      "  - 交互式 `nimicoding start` 会逐项说明、逐项确认、逐项执行",
    )),
    styleMuted(localize(
      "  - `nimicoding start` can also choose a target host and print a short paste-ready prompt directly in the terminal",
      "  - `nimicoding start` 还可以选择目标 Host，并直接在终端输出一段可粘贴的短 prompt",
    )),
    styleMuted(localize(
      "  - `nimicoding clear` removes only managed AI blocks plus package-owned .nimi/config, .nimi/contracts, and .nimi/methodology files that still match the packaged seed",
      "  - `nimicoding clear` 只会移除托管 AI 区块，以及仍与包内 seed 完全一致的 .nimi/config、.nimi/contracts、.nimi/methodology 文件",
    )),
    styleMuted(localize(
      "  - `nimicoding clear` does not remove .nimi/spec, .nimi/local, or .nimi/cache for you",
      "  - `nimicoding clear` 不会替你移除 .nimi/spec、.nimi/local 或 .nimi/cache",
    )),
    styleMuted(localize(
      "  - `nimicoding doctor` shows the user-facing summary; add `--verbose` for internal contract detail",
      "  - `nimicoding doctor` 默认显示用户视图；加 `--verbose` 可查看内部契约细节",
    )),
    styleMuted(localize(
      "  - `nimicoding handoff --prompt` writes local prompt/json refs under .nimi/local/handoff/",
      "  - `nimicoding handoff --prompt` 会把本地 prompt/json ref 写入 .nimi/local/handoff/",
    )),
    styleMuted(localize(
      "  - use `--lang zh` or `--lang en` to switch human-readable output",
      "  - 使用 `--lang zh` 或 `--lang en` 切换人类可读输出语言",
    )),
  ];

  return `${lines.join("\n")}\n`;
}
