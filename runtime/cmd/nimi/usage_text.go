package main

import (
	"fmt"
	"os"
)

func printUsage() {
	fmt.Fprintln(os.Stderr, "Nimi - AI Runtime\n\nUsage: nimi <command> [options]\n\nQuick Start:\n  serve       Production daemon entry for the service launcher\n  start       Start the installed Windows Runtime service\n  doctor      Check environment health\n  version     Show version info\n\nRuntime Operations:\n  status      Show installed service status\n  stop        Stop the installed Windows Runtime service\n  logs        Unavailable: protected service logs are not exposed\n  health      Show sanitized service-controller state\n\nService control is unavailable on other OS builds.\n\nAdvanced/Admin:\n  app         Inter-app messaging\n  audit       Audit events and usage\n  config      Runtime configuration\n\nAuthor tooling:\n  pnpm dlx @nimiplatform/app-tools nimi-app  App author scaffolding\n\nRun 'nimi <command> --help' for details.")
}

func printRuntimeAppUsage() {
	fmt.Fprintln(os.Stderr, "Usage:\n  nimi app send [--grpc-addr --timeout --from-app-id --to-app-id --subject-user-id --message-type --payload-file --require-ack --json --caller-kind --caller-id --surface-id --trace-id]\n  nimi app watch [--grpc-addr --timeout --app-id --subject-user-id --cursor --from-app-id ... --json --caller-kind --caller-id --surface-id --trace-id]")
}

func printRuntimeAuditUsage() {
	fmt.Fprintln(os.Stderr, "Usage:\n  nimi audit events [--grpc-addr --timeout --app-id --subject-user-id --domain --reason-code --from-time --to-time --page-size --page-token --filter-caller-kind --filter-caller-id --json --caller-kind --caller-id --surface-id --trace-id]\n  nimi audit usage [--grpc-addr --timeout --app-id --subject-user-id --filter-caller-kind --filter-caller-id --capability --model-id --window minute|hour|day --from-time --to-time --page-size --page-token --json --caller-kind --caller-id --surface-id --trace-id]\n  nimi audit export [--grpc-addr --timeout --app-id --subject-user-id --format --from-time --to-time --compress --output --json --caller-kind --caller-id --surface-id --trace-id]")
}

func printRuntimeConfigUsage() {
	fmt.Fprintln(os.Stderr, "Usage:\n  nimi config init [--force --json]\n  nimi config get [--json]\n  nimi config set [--stdin|--file PATH] [--set key=value ...] [--unset key ...] [--json]\n  nimi config validate [--json]")
}
