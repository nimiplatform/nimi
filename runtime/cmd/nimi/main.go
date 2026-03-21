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
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"github.com/nimiplatform/nimi/runtime/internal/texttarget"
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
		exitIfCommandError("serve", entrypoint.RunDaemonFromArgs("nimi serve", args[2:], Version))
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
	case "mod":
		exitIfCommandError("mod", runRuntimeMod(args[2:]))
	case "app-auth":
		exitIfCommandError("app-auth", runRuntimeAppAuth(args[2:]))
	case "knowledge":
		exitIfCommandError("knowledge", runRuntimeKnowledge(args[2:]))
	case "app":
		exitIfCommandError("app", runRuntimeApp(args[2:]))
	case "audit":
		exitIfCommandError("audit", runRuntimeAudit(args[2:]))
	case "workflow":
		exitIfCommandError("workflow", runRuntimeWorkflow(args[2:]))
	case "health":
		exitIfCommandError("health", runRuntimeHealth(args[2:]))
	case "providers":
		exitIfCommandError("providers", runRuntimeProviders(args[2:]))
	case "provider":
		exitIfCommandError("provider", runRuntimeProvider(args[2:]))
	case "config":
		exitIfCommandError("config", runRuntimeConfig(args[2:]))
	default:
		printUsage()
		os.Exit(2)
	}
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
	if len(args) > 1 && args[1] == "--" {
		normalized := make([]string, 0, len(args)-1)
		normalized = append(normalized, args[0])
		normalized = append(normalized, args[2:]...)
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
	yes := fs.Bool("yes", false, "auto-confirm local model installation")
	noInstall := fs.Bool("no-install", false, "fail instead of installing missing local models")
	modelFlag := fs.String("model", "", "model id")
	providerFlag := fs.String("provider", "", "cloud provider")
	cloudTarget := fs.Bool("cloud", false, "use the configured default cloud provider")
	localTarget := fs.Bool("local", false, "use the default local model")
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
	target, err := resolveOnboardingRunTarget(cfg, promptValue, *modelFlag, *providerFlag, *localTarget, *cloudTarget)
	if err != nil {
		return err
	}
	if _, err := entrypoint.ListModelsGRPC(cfg.GRPCAddr, minDuration(timeout, 3*time.Second), onboardingAppID); err != nil {
		return fmt.Errorf("runtime is not running. %s", onboardingRuntimeUnavailableHint())
	}

	modelID := target.ModelID
	routePolicy := target.RoutePolicy
	fallbackPolicy := runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY
	if isLocalOnboardingModel(modelID) {
		healthResp, healthErr := entrypoint.CheckModelHealthGRPC(
			cfg.GRPCAddr,
			minDuration(timeout, 3*time.Second),
			&runtimev1.CheckModelHealthRequest{ModelId: modelID},
			onboardingAppID,
		)
		if healthErr != nil {
			return fmt.Errorf("failed to inspect model %s: %w", modelID, healthErr)
		}
		if !healthResp.GetHealthy() {
			modelRef := texttarget.EnsureLocalLatestModelRef(modelID)
			if *noInstall {
				return fmt.Errorf("model %s is not installed. Run 'nimi model pull --model-ref %s'", modelID, modelRef)
			}
			shouldInstall := *yes
			if !shouldInstall {
				answer, promptErr := promptYesNo(os.Stdin, os.Stdout, fmt.Sprintf("Model %s is not installed. Pull now?", modelID), true)
				if promptErr != nil {
					return promptErr
				}
				shouldInstall = answer
			}
			if !shouldInstall {
				return fmt.Errorf("model %s is required. Run 'nimi model pull --model-ref %s'", modelID, modelRef)
			}
			if _, pullErr := entrypoint.PullModelGRPC(cfg.GRPCAddr, timeout, &runtimev1.PullModelRequest{
				AppId:    onboardingAppID,
				ModelRef: modelRef,
				Source:   "official",
			}); pullErr != nil {
				return fmt.Errorf("failed to install %s: %w", modelID, pullErr)
			}
			if !*jsonOutput {
				fmt.Printf("Installed %s.\n", modelID)
			}
		}
	}

	req := &runtimev1.StreamScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         onboardingAppID,
			SubjectUserId: onboardingSubjectUserID,
			ModelId:       modelID,
			RoutePolicy:   routePolicy,
			Fallback:      fallbackPolicy,
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
	if routePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD {
		providerTarget := cfg.Providers[target.ProviderName]
		apiKey := strings.TrimSpace(config.ResolveProviderAPIKey(providerTarget))
		if apiKey == "" {
			if !onboardingInteractiveTerminal() {
				return fmt.Errorf("cloud credentials for %s are missing. Run '%s'", target.ProviderName, cloudCredentialSetupCommand(target.ProviderName, *cloudTarget))
			}
			apiKey, err = promptOnboardingAPIKey(target.ProviderName)
			if err != nil {
				return err
			}
			configPath, savedTarget, saveErr := saveInlineProviderAPIKey(target.ProviderName, apiKey)
			if saveErr != nil {
				return saveErr
			}
			providerTarget = savedTarget
			target.ProviderEndpoint = resolveProviderEndpoint(target.ProviderName, savedTarget)
			if !*jsonOutput {
				fmt.Printf("Saved %s API key to %s.\n", target.ProviderName, configPath)
			}
		}
		endpoint := target.ProviderEndpoint
		if strings.TrimSpace(endpoint) == "" {
			endpoint = resolveProviderEndpoint(target.ProviderName, providerTarget)
		}
		if entry, ok := connector.ProviderCatalog[target.ProviderName]; ok && entry.RequiresExplicitEndpoint && strings.TrimSpace(endpoint) == "" {
			return fmt.Errorf("provider %s requires an explicit endpoint. Run '%s --base-url ...'", target.ProviderName, cloudCredentialSetupCommand(target.ProviderName, *cloudTarget))
		}
		callerMeta.CredentialSource = "inline"
		callerMeta.ProviderType = target.ProviderName
		callerMeta.ProviderEndpoint = endpoint
		callerMeta.ProviderAPIKey = apiKey
	}
	events, errCh, err := entrypoint.StreamScenarioGRPC(ctx, cfg.GRPCAddr, req, callerMeta)
	if err != nil {
		return fmt.Errorf("runtime stream failed: %w", err)
	}

	buffer := strings.Builder{}
	streamTraceID := ""
	modelResolved := ""
	routeDecision := routePolicy
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
		switch failedReason {
		case runtimev1.ReasonCode_AI_REQUEST_CREDENTIAL_INVALID, runtimev1.ReasonCode_AUTH_TOKEN_INVALID:
			return fmt.Errorf("cloud credentials for %s are missing or invalid. Run '%s'", target.ProviderName, cloudCredentialSetupCommand(target.ProviderName, *cloudTarget))
		case runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND, runtimev1.ReasonCode_AI_MODEL_NOT_READY:
			return fmt.Errorf("local model %s is unavailable. Run 'nimi model pull --model-ref %s'", modelID, texttarget.EnsureLocalLatestModelRef(modelID))
		default:
			return fmt.Errorf("run failed: %s", failedReason.String())
		}
	}
	if !*jsonOutput {
		fmt.Println()
		return nil
	}
	out, err := json.MarshalIndent(map[string]any{
		"modelId":       modelID,
		"text":          buffer.String(),
		"traceId":       streamTraceID,
		"modelResolved": firstNonEmptyString(modelResolved, modelID),
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
	case "replay":
		return runRuntimeAIReplay(args[1:])
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

func runRuntimeAppAuth(args []string) error {
	if len(args) == 0 {
		printRuntimeAppAuthUsage()
		return flag.ErrHelp
	}

	switch args[0] {
	case "authorize":
		return runRuntimeAppAuthAuthorize(args[1:])
	case "validate":
		return runRuntimeAppAuthValidate(args[1:])
	case "revoke":
		return runRuntimeAppAuthRevoke(args[1:])
	case "delegate":
		return runRuntimeAppAuthDelegate(args[1:])
	case "chain":
		return runRuntimeAppAuthChain(args[1:])
	default:
		printRuntimeAppAuthUsage()
		return flag.ErrHelp
	}
}

func runRuntimeKnowledge(args []string) error {
	if len(args) == 0 {
		printRuntimeKnowledgeUsage()
		return flag.ErrHelp
	}

	switch args[0] {
	case "build":
		return runRuntimeKnowledgeBuild(args[1:])
	case "search":
		return runRuntimeKnowledgeSearch(args[1:])
	case "delete":
		return runRuntimeKnowledgeDelete(args[1:])
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

func runRuntimeWorkflow(args []string) error {
	if len(args) == 0 {
		printRuntimeWorkflowUsage()
		return flag.ErrHelp
	}

	switch args[0] {
	case "submit":
		return runRuntimeWorkflowSubmit(args[1:])
	case "get":
		return runRuntimeWorkflowGet(args[1:])
	case "cancel":
		return runRuntimeWorkflowCancel(args[1:])
	case "watch":
		return runRuntimeWorkflowWatch(args[1:])
	default:
		printRuntimeWorkflowUsage()
		return flag.ErrHelp
	}
}
