package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/entrypoint"
	"math"
	"os"
	"strings"
	"time"
)

// Version is the runtime version string, injected via ldflags at build time.
// Default: "0.0.0-dev" for development builds.
var Version = "0.0.0-dev"

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
	case "run", "chat":
		exitIfCommandError(args[1], runTopLevelRun(args[2:]))
	case "ai":
		exitIfCommandError("ai", runRuntimeAI(args[2:]))
	case "model":
		exitIfCommandError("model", runRuntimeModel(args[2:]))
	case "knowledge":
		exitIfCommandError("knowledge", runRuntimeKnowledge(args[2:]))
	case "app":
		exitIfCommandError("app", runRuntimeApp(args[2:]))
	case "audit":
		exitIfCommandError("audit", runRuntimeAudit(args[2:]))
	case "health":
		exitIfCommandError("health", runRuntimeHealth(args[2:]))
	case "providers":
		exitIfCommandError("providers", runRuntimeProviders(args[2:]))
	case "provider":
		exitIfCommandError("provider", runRuntimeProvider(args[2:]))
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

func durationMillisecondsInt32(value time.Duration) (int32, error) {
	millis := value.Milliseconds()
	if millis < 0 || millis > math.MaxInt32 {
		return 0, fmt.Errorf("timeout exceeds maximum supported duration of %s", (time.Duration(math.MaxInt32) * time.Millisecond).String())
	}
	return int32(millis), nil
}

func millisecondsInt32(value int) (int32, error) {
	if value < 0 || value > math.MaxInt32 {
		return 0, fmt.Errorf("timeout-ms exceeds maximum supported value of %d", math.MaxInt32)
	}
	return int32(value), nil
}

func runTopLevelRun(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if len(args) == 0 {
		return fmt.Errorf("prompt is required. Usage: %s", onboardingRunUsage())
	}
	promptValue := strings.TrimSpace(args[0])
	if promptValue == "" || strings.HasPrefix(promptValue, "-") {
		return fmt.Errorf("prompt must be the first argument. Usage: %s", onboardingRunUsage())
	}

	fs := flag.NewFlagSet("nimi run", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	timeoutRaw := fs.String("timeout", "90s", "grpc request timeout")
	systemPrompt := fs.String("system", "", "system prompt")
	jsonOutput := fs.Bool("json", false, "output json")
	if err := fs.Parse(args[1:]); err != nil {
		return err
	}
	if fs.NArg() > 0 {
		return fmt.Errorf("unexpected extra arguments after the prompt. Quote the prompt and pass flags after it. Usage: %s", onboardingRunUsage())
	}

	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	timeoutMs, err := durationMillisecondsInt32(timeout)
	if err != nil {
		return err
	}
	req := &runtimev1.StreamScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         onboardingAppID,
			SubjectUserId: onboardingSubjectUserID,
			TimeoutMs:     timeoutMs,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_TextGenerate{
				TextGenerate: &runtimev1.TextGenerateScenarioSpec{
					Input: []*runtimev1.ChatMessage{
						{Role: "user", Content: promptValue},
					},
					SystemPrompt: *systemPrompt,
				},
			},
		},
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	callerMeta := runtimeAICallerMetadataFromFlags("third-party-service", "nimi-cli", "runtime-cli", "")
	events, errCh, err := entrypoint.StreamScenarioGRPC(ctx, cfg.GRPCAddr, req, callerMeta)
	if err != nil {
		return fmt.Errorf("runtime stream failed: %w", err)
	}

	buffer := strings.Builder{}
	streamTraceID := ""
	modelResolved := ""
	routeDecision := runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED
	finishReason := runtimev1.FinishReason_FINISH_REASON_UNSPECIFIED
	usage := &runtimev1.UsageStats{}
	failedReason := runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
	for events != nil || errCh != nil {
		select {
		case streamErr, ok := <-errCh:
			if !ok {
				errCh = nil
				continue
			}
			if streamErr != nil {
				return streamErr
			}
		case event, ok := <-events:
			if !ok {
				events = nil
				continue
			}
			if streamTraceID == "" {
				streamTraceID = strings.TrimSpace(event.GetTraceId())
			}
			if started := event.GetStarted(); started != nil {
				if resolved := strings.TrimSpace(started.GetModelResolved()); resolved != "" {
					modelResolved = resolved
				}
				if started.GetRouteDecision() != runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
					routeDecision = started.GetRouteDecision()
				}
			}
			if delta := event.GetDelta(); delta != nil {
				text := extractScenarioStreamTextDelta(delta)
				buffer.WriteString(text)
				if !*jsonOutput {
					fmt.Print(text)
				}
			}
			if currentUsage := event.GetUsage(); currentUsage != nil {
				usage = currentUsage
			}
			if completed := event.GetCompleted(); completed != nil {
				finishReason = completed.GetFinishReason()
			}
			if failed := event.GetFailed(); failed != nil {
				failedReason = failed.GetReasonCode()
			}
		case <-time.After(timeout):
			return fmt.Errorf("stream timeout")
		}
	}
	if failedReason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		return fmt.Errorf("run failed for the caller-owned AIConfig binding: %s", failedReason.String())
	}
	if !*jsonOutput {
		fmt.Println()
		return nil
	}
	out, err := json.MarshalIndent(map[string]any{
		"text":          buffer.String(),
		"traceId":       streamTraceID,
		"modelResolved": modelResolved,
		"routeDecision": routePolicyLabel(routeDecision),
		"finishReason":  finishReason.String(),
		"usage": map[string]any{
			"inputTokens":  usage.GetInputTokens(),
			"outputTokens": usage.GetOutputTokens(),
			"computeMs":    usage.GetComputeMs(),
		},
	}, "", "  ")
	if err != nil {
		return err
	}
	fmt.Println(string(out))
	return nil
}

func minDuration(left time.Duration, right time.Duration) time.Duration {
	if left <= 0 {
		return right
	}
	if left < right {
		return left
	}
	return right
}

func runRuntimeAI(args []string) error {
	if len(args) == 0 {
		printRuntimeAIUsage()
		return flag.ErrHelp
	}

	switch args[0] {
	case "provider-raw":
		return runRuntimeAIProviderRaw(args[1:])
	case "text-generate":
		return runRuntimeAITextGenerate(args[1:])
	case "stream":
		return runRuntimeAIStream(args[1:])
	case "text-embed":
		return runRuntimeAITextEmbed(args[1:])
	case "image":
		return runRuntimeAIImage(args[1:])
	case "video":
		return runRuntimeAIVideo(args[1:])
	case "tts":
		return runRuntimeAITTS(args[1:])
	case "stt":
		return runRuntimeAISTT(args[1:])
	default:
		printRuntimeAIUsage()
		return flag.ErrHelp
	}
}

func runRuntimeModel(args []string) error {
	if len(args) == 0 {
		printRuntimeModelUsage()
		return flag.ErrHelp
	}

	switch args[0] {
	case "list":
		return runRuntimeModelList(args[1:])
	case "pull":
		return runRuntimeModelPull(args[1:])
	case "remove":
		return runRuntimeModelRemove(args[1:])
	case "health":
		return runRuntimeModelHealth(args[1:])
	default:
		printRuntimeModelUsage()
		return flag.ErrHelp
	}
}

func runRuntimeProvider(args []string) error {
	if len(args) == 0 {
		printRuntimeProviderUsage()
		return flag.ErrHelp
	}

	switch args[0] {
	case "list":
		return runRuntimeProviderList(args[1:])
	case "set":
		return runRuntimeProviderSet(args[1:])
	case "unset":
		return runRuntimeProviderUnset(args[1:])
	case "test":
		return runRuntimeProviderTest(args[1:])
	default:
		printRuntimeProviderUsage()
		return flag.ErrHelp
	}
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
