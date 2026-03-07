package main

import (
	"fmt"
	"os"
)

func printUsage() {
	fmt.Fprintln(os.Stderr, "Usage: nimi <serve|status|run|chat|ai|model|mod|auth|app-auth|knowledge|app|audit|workflow|health|providers|config>")
}

func printRuntimeAIUsage() {
	fmt.Fprintln(os.Stderr, "Usage:\n  nimi ai replay [--grpc-addr --timeout --fixture --caller-kind --caller-id --surface-id --trace-id]\n  nimi ai provider-raw [--timeout --fixture]\n  nimi ai text-generate [--grpc-addr --timeout --app-id --subject-user-id --model-id --route local|cloud --fallback deny|allow --system --prompt --timeout-ms --json --caller-kind --caller-id --surface-id --trace-id]\n  nimi ai stream [--grpc-addr --timeout --app-id --subject-user-id --model-id --route local|cloud --fallback deny|allow --system --prompt --timeout-ms --json --caller-kind --caller-id --surface-id --trace-id]\n  nimi ai text-embed [--grpc-addr --timeout --app-id --subject-user-id --model-id --route local|cloud --fallback deny|allow --input ... --timeout-ms --json --caller-kind --caller-id --surface-id --trace-id]\n  nimi ai image [--grpc-addr --timeout --app-id --subject-user-id --model-id --route local|cloud --fallback deny|allow --prompt --timeout-ms --output --json --caller-kind --caller-id --surface-id --trace-id]\n  nimi ai video [--grpc-addr --timeout --app-id --subject-user-id --model-id --route local|cloud --fallback deny|allow --prompt --timeout-ms --output --json --caller-kind --caller-id --surface-id --trace-id]\n  nimi ai tts [--grpc-addr --timeout --app-id --subject-user-id --model-id --route local|cloud --fallback deny|allow --text --timeout-ms --output --json --caller-kind --caller-id --surface-id --trace-id]\n  nimi ai stt [--grpc-addr --timeout --app-id --subject-user-id --model-id --route local|cloud --fallback deny|allow --audio-file --mime-type --timeout-ms --json --caller-kind --caller-id --surface-id --trace-id]")
}

func printRuntimeModelUsage() {
	fmt.Fprintln(os.Stderr, "Usage:\n  nimi model list [--grpc-addr --timeout --app-id --json --caller-kind --caller-id --surface-id --trace-id]\n  nimi model pull [--grpc-addr --timeout --app-id --model-ref --source --digest --json --caller-kind --caller-id --surface-id --trace-id]\n  nimi model remove [--grpc-addr --timeout --app-id --model-id --json --caller-kind --caller-id --surface-id --trace-id]\n  nimi model health [--grpc-addr --timeout --app-id --model-id --json --caller-kind --caller-id --surface-id --trace-id]")
}

func printRuntimeModUsage() {
	fmt.Fprintln(os.Stderr, "Usage:\n  nimi mod list [--mods-dir --json]\n  nimi mod install [source] [--source --mods-dir --mod-circle-repo --mod-circle-ref --strict-id --api-base --token --json]\n  nimi mod create [--dir --name --mod-id --json]\n  nimi mod dev [--dir --watch --interval --json]\n  nimi mod build [--dir --json]\n  nimi mod publish [--dir --source-repo --author --mod-circle-repo --base --branch-prefix --title --body --api-base --token --json]")
}

func printRuntimeAuthUsage() {
	fmt.Fprintln(os.Stderr, "Usage:\n  nimi auth register-app [--grpc-addr --timeout --app-id --app-instance-id --device-id --app-version --capability ... --json --caller-kind --caller-id --surface-id --trace-id]\n  nimi auth open-session [--grpc-addr --timeout --app-id --app-instance-id --device-id --subject-user-id --ttl-seconds --json --caller-kind --caller-id --surface-id --trace-id]\n  nimi auth refresh-session [--grpc-addr --timeout --app-id --session-id --ttl-seconds --json --caller-kind --caller-id --surface-id --trace-id]\n  nimi auth revoke-session [--grpc-addr --timeout --app-id --session-id --json --caller-kind --caller-id --surface-id --trace-id]\n  nimi auth register-external [--grpc-addr --timeout --app-id --external-principal-id --external-type agent|app|service --issuer --client-id --signature-key-id --proof-type ed25519|hmac-sha256 --json --caller-kind --caller-id --surface-id --trace-id]\n  nimi auth open-external-session [--grpc-addr --timeout --app-id --external-principal-id --proof --ttl-seconds --json --caller-kind --caller-id --surface-id --trace-id]\n  nimi auth revoke-external-session [--grpc-addr --timeout --app-id --external-session-id --json --caller-kind --caller-id --surface-id --trace-id]")
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
