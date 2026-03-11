package main

import (
	"fmt"
	"os"
)

func printUsage() {
	fmt.Fprintln(os.Stderr, "Nimi - AI Runtime\n\nUsage: nimi <command> [options]\n\nQuick Start:\n  serve       Start the runtime daemon in the foreground\n  start       Start the runtime daemon in the background\n  doctor      Check environment health\n  version     Show version info\n  run         Generate text from a model\n\nModel Management:\n  model       List, pull, remove, and check models\n\nCloud Setup:\n  provider    Configure and test cloud providers\n\nRuntime Ops:\n  status      Show runtime process status\n  stop        Stop the runtime daemon\n  logs        Read background runtime logs\n  health      Runtime health details\n  providers   Provider health snapshots\n\nAdvanced/Admin:\n  ai          Advanced AI operations\n  app-auth    App authorization lifecycle\n  mod         Installed mod management\n  workflow    Workflow engine\n  knowledge   Knowledge indexing\n  app         Inter-app messaging\n  audit       Audit events and usage\n  config      Runtime configuration\n\nAuthor tooling:\n  pnpm dlx @nimiplatform/dev-tools nimi-mod  Mod author workflows\n  pnpm dlx @nimiplatform/dev-tools nimi-app  App author scaffolding\n\nRun 'nimi <command> --help' for details.")
}

func printRuntimeAIUsage() {
	fmt.Fprintln(os.Stderr, "Usage:\n  nimi ai replay [--grpc-addr --timeout --fixture --caller-kind --caller-id --surface-id --trace-id]\n  nimi ai provider-raw [--timeout --fixture]\n  nimi ai text-generate [--grpc-addr --timeout --app-id --subject-user-id --model-id --route local|cloud --fallback deny|allow --system --prompt --timeout-ms --json --caller-kind --caller-id --surface-id --trace-id]\n  nimi ai stream [--grpc-addr --timeout --app-id --subject-user-id --model-id --route local|cloud --fallback deny|allow --system --prompt --timeout-ms --json --caller-kind --caller-id --surface-id --trace-id]\n  nimi ai text-embed [--grpc-addr --timeout --app-id --subject-user-id --model-id --route local|cloud --fallback deny|allow --input ... --timeout-ms --json --caller-kind --caller-id --surface-id --trace-id]\n  nimi ai image [--grpc-addr --timeout --app-id --subject-user-id --model-id --route local|cloud --fallback deny|allow --prompt --timeout-ms --output --json --caller-kind --caller-id --surface-id --trace-id]\n  nimi ai video [--grpc-addr --timeout --app-id --subject-user-id --model-id --route local|cloud --fallback deny|allow --prompt --timeout-ms --output --json --caller-kind --caller-id --surface-id --trace-id]\n  nimi ai tts [--grpc-addr --timeout --app-id --subject-user-id --model-id --route local|cloud --fallback deny|allow --text --timeout-ms --output --json --caller-kind --caller-id --surface-id --trace-id]\n  nimi ai stt [--grpc-addr --timeout --app-id --subject-user-id --model-id --route local|cloud --fallback deny|allow --audio-file --mime-type --timeout-ms --json --caller-kind --caller-id --surface-id --trace-id]")
}

func printRuntimeModelUsage() {
	fmt.Fprintln(os.Stderr, "Usage:\n  nimi model list [--grpc-addr --timeout --app-id --json --caller-kind --caller-id --surface-id --trace-id]\n  nimi model pull [--grpc-addr --timeout --app-id --model-ref --source --digest --json --caller-kind --caller-id --surface-id --trace-id]\n  nimi model remove [--grpc-addr --timeout --app-id --model-id --json --caller-kind --caller-id --surface-id --trace-id]\n  nimi model health [--grpc-addr --timeout --app-id --model-id --json --caller-kind --caller-id --surface-id --trace-id]")
}

func printRuntimeModUsage() {
	fmt.Fprintln(os.Stderr, "Usage:\n  nimi mod list [--mods-dir --json]\n  nimi mod install [source] [--source --mods-dir --mod-circle-repo --mod-circle-ref --strict-id --api-base --token --json]\n\nAuthor workflows moved to:\n  pnpm dlx @nimiplatform/dev-tools nimi-mod create|dev|build|doctor|pack\n  pnpm dlx @nimiplatform/dev-tools nimi-app create")
}

func printRuntimeProviderUsage() {
	fmt.Fprintln(os.Stderr, "Usage:\n  nimi provider list [--json]\n  nimi provider set <provider> [--api-key --api-key-env --base-url --default-model --default --json]\n  nimi provider unset <provider> [--json]\n  nimi provider test <provider> [--grpc-addr --timeout --json]")
}

func printRuntimeAppAuthUsage() {
	fmt.Fprintln(os.Stderr, "Usage:\n  nimi app-auth authorize [--grpc-addr --timeout --domain --app-id --external-principal-id --external-type agent|app|service --subject-user-id --consent-id --consent-version --policy-version --policy-mode preset|custom --preset read-only|full|delegate --scope ... --resource-selectors-file --can-delegate --max-delegation-depth --ttl-seconds --scope-catalog-version --json --caller-kind --caller-id --surface-id --trace-id]\n  nimi app-auth validate [--grpc-addr --timeout --app-id --token-id --subject-user-id --operation --requested-scope ... --resource-selectors-file --json --caller-kind --caller-id --surface-id --trace-id]\n  nimi app-auth revoke [--grpc-addr --timeout --app-id --token-id --json --caller-kind --caller-id --surface-id --trace-id]\n  nimi app-auth delegate [--grpc-addr --timeout --app-id --parent-token-id --scope ... --resource-selectors-file --ttl-seconds --json --caller-kind --caller-id --surface-id --trace-id]\n  nimi app-auth chain [--grpc-addr --timeout --app-id --root-token-id --json --caller-kind --caller-id --surface-id --trace-id]")
}

func printRuntimeKnowledgeUsage() {
	fmt.Fprintln(os.Stderr, "Usage:\n  nimi knowledge build [--grpc-addr --timeout --app-id --subject-user-id --index-id --source-kind --source-uri ... --embedding-model-id --overwrite --options-file --json --caller-kind --caller-id --surface-id --trace-id]\n  nimi knowledge search [--grpc-addr --timeout --app-id --subject-user-id --index-id --query --top-k --filters-file --json --caller-kind --caller-id --surface-id --trace-id]\n  nimi knowledge delete [--grpc-addr --timeout --app-id --subject-user-id --index-id --json --caller-kind --caller-id --surface-id --trace-id]")
}

func printRuntimeAppUsage() {
	fmt.Fprintln(os.Stderr, "Usage:\n  nimi app send [--grpc-addr --timeout --from-app-id --to-app-id --subject-user-id --message-type --payload-file --require-ack --json --caller-kind --caller-id --surface-id --trace-id]\n  nimi app watch [--grpc-addr --timeout --app-id --subject-user-id --cursor --from-app-id ... --json --caller-kind --caller-id --surface-id --trace-id]")
}

func printRuntimeAuditUsage() {
	fmt.Fprintln(os.Stderr, "Usage:\n  nimi audit events [--grpc-addr --timeout --app-id --subject-user-id --domain --reason-code --from-time --to-time --page-size --page-token --filter-caller-kind --filter-caller-id --json --caller-kind --caller-id --surface-id --trace-id]\n  nimi audit usage [--grpc-addr --timeout --app-id --subject-user-id --filter-caller-kind --filter-caller-id --capability --model-id --window minute|hour|day --from-time --to-time --page-size --page-token --json --caller-kind --caller-id --surface-id --trace-id]\n  nimi audit export [--grpc-addr --timeout --app-id --subject-user-id --format --from-time --to-time --compress --output --json --caller-kind --caller-id --surface-id --trace-id]")
}

func printRuntimeWorkflowUsage() {
	fmt.Fprintln(os.Stderr, "Usage:\n  nimi workflow submit [--grpc-addr --timeout --app-id --subject-user-id --definition-file --timeout-ms --json --caller-kind --caller-id --surface-id --trace-id]\n  nimi workflow get [--grpc-addr --timeout --app-id --task-id --json --caller-kind --caller-id --surface-id --trace-id]\n  nimi workflow cancel [--grpc-addr --timeout --app-id --task-id --json --caller-kind --caller-id --surface-id --trace-id]\n  nimi workflow watch [--grpc-addr --timeout --app-id --task-id --json --caller-kind --caller-id --surface-id --trace-id]")
}

func printRuntimeConfigUsage() {
	fmt.Fprintln(os.Stderr, "Usage:\n  nimi config init [--force --json]\n  nimi config get [--json]\n  nimi config set [--stdin|--file PATH] [--set key=value ...] [--unset key ...] [--json]\n  nimi config validate [--json]")
}
