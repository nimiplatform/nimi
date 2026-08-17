package main

import (
	"errors"
	"flag"
	"fmt"
	"github.com/nimiplatform/nimi/runtime/internal/entrypoint"
	"os"
	"strings"
)

// Version is the runtime version string, injected via ldflags at build time.
// Default: "0.0.0-dev" for development builds.
var Version = "0.0.0-dev"

// @nimi-authority: definition.nimi.runtime.service-operations.cli-plane
func main() {
	args := normalizeRootArgs(os.Args)

	if len(args) < 2 {
		printUsage()
		os.Exit(2)
	}

	switch args[1] {
	case "serve":
		exitIfCommandError("serve", runServe(args[2:]))
	case "start":
		exitIfCommandError("start", runRuntimeStart(args[2:]))
	case "doctor":
		exitIfCommandError("doctor", runRuntimeDoctor(args[2:]))
	case "init":
		exitIfCommandError("init", runRuntimeInit(args[2:]))
	case "version":
		exitIfCommandError("version", runRuntimeVersion(args[2:]))
	case "status":
		exitIfCommandError("status", runRuntimeStatus(args[2:]))
	case "stop":
		exitIfCommandError("stop", runRuntimeStop(args[2:]))
	case "logs":
		exitIfCommandError("logs", runRuntimeLogs(args[2:]))
	case "knowledge":
		exitIfCommandError("knowledge", runRuntimeKnowledge(args[2:]))
	case "app":
		exitIfCommandError("app", runRuntimeApp(args[2:]))
	case "audit":
		exitIfCommandError("audit", runRuntimeAudit(args[2:]))
	case "health":
		exitIfCommandError("health", runRuntimeHealth(args[2:]))
	case "config":
		exitIfCommandError("config", runRuntimeConfig(args[2:]))
	case "managed-image-backend":
		exitIfCommandError("managed-image-backend", runManagedImageBackend(args[2:]))
	case "macos-protected-state-provision":
		exitIfCommandError("macos-protected-state-provision", runMacOSProtectedStateProvision(args[2:]))
	case "macos-protected-state-status":
		exitIfCommandError("macos-protected-state-status", runMacOSProtectedStateStatus(args[2:]))
	case "macos-protected-state-reset":
		exitIfCommandError("macos-protected-state-reset", runMacOSProtectedStateReset(args[2:]))
	default:
		printUsage()
		os.Exit(2)
	}
}

func runServe(args []string) error {
	return entrypoint.RunProductionDaemonFromArgs("nimi serve", args, Version)
}

func exitIfCommandError(command string, err error) {
	if err == nil {
		return
	}
	exitCode := 1
	message := err.Error()
	var coded cliExitError
	if errors.As(err, &coded) {
		exitCode = coded.ExitCode()
		message = strings.TrimSpace(coded.Error())
	}
	if message != "" {
		fmt.Fprintf(os.Stderr, "%s failed: %s\n", command, message)
	}
	os.Exit(exitCode)
}

func normalizeRootArgs(args []string) []string {
	firstArg := 1
	for firstArg < len(args) && args[firstArg] == "--" {
		firstArg++
	}
	if firstArg > 1 {
		normalized := make([]string, 0, len(args)-(firstArg-1))
		normalized = append(normalized, args[0])
		normalized = append(normalized, args[firstArg:]...)
		return normalized
	}
	return args
}

func runRuntimeKnowledge(args []string) error {
	if len(args) == 0 {
		printRuntimeKnowledgeUsage()
		return flag.ErrHelp
	}

	switch args[0] {
	case "create-bank":
		return runRuntimeKnowledgeCreateBank(args[1:])
	case "get-bank":
		return runRuntimeKnowledgeGetBank(args[1:])
	case "list-banks":
		return runRuntimeKnowledgeListBanks(args[1:])
	case "put-page":
		return runRuntimeKnowledgePutPage(args[1:])
	case "get-page":
		return runRuntimeKnowledgeGetPage(args[1:])
	case "list-pages":
		return runRuntimeKnowledgeListPages(args[1:])
	case "delete-page":
		return runRuntimeKnowledgeDeletePage(args[1:])
	case "search":
		return runRuntimeKnowledgeSearch(args[1:])
	case "search-hybrid":
		return runRuntimeKnowledgeSearchHybrid(args[1:])
	case "add-link":
		return runRuntimeKnowledgeAddLink(args[1:])
	case "remove-link":
		return runRuntimeKnowledgeRemoveLink(args[1:])
	case "list-links":
		return runRuntimeKnowledgeListLinks(args[1:])
	case "list-backlinks":
		return runRuntimeKnowledgeListBacklinks(args[1:])
	case "traverse-graph":
		return runRuntimeKnowledgeTraverseGraph(args[1:])
	case "ingest-document":
		return runRuntimeKnowledgeIngestDocument(args[1:])
	case "get-ingest-task":
		return runRuntimeKnowledgeGetIngestTask(args[1:])
	case "delete-bank":
		return runRuntimeKnowledgeDeleteBank(args[1:])
	default:
		printRuntimeKnowledgeUsage()
		return flag.ErrHelp
	}
}

func runRuntimeApp(args []string) error {
	if len(args) == 0 {
		printRuntimeAppUsage()
		return flag.ErrHelp
	}

	switch args[0] {
	case "send":
		return runRuntimeAppSend(args[1:])
	case "watch":
		return runRuntimeAppWatch(args[1:])
	default:
		printRuntimeAppUsage()
		return flag.ErrHelp
	}
}

func runRuntimeAudit(args []string) error {
	if len(args) == 0 {
		printRuntimeAuditUsage()
		return flag.ErrHelp
	}

	switch args[0] {
	case "events":
		return runRuntimeAuditEvents(args[1:])
	case "usage":
		return runRuntimeAuditUsage(args[1:])
	case "export":
		return runRuntimeAuditExport(args[1:])
	default:
		printRuntimeAuditUsage()
		return flag.ErrHelp
	}
}
