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
	"github.com/nimiplatform/nimi/runtime/internal/workerentry"
	"os"
	"strings"
	"time"
)

func main() {
	if len(os.Args) >= 3 && os.Args[1] == "worker" {
		if err := workerentry.Run(os.Args[2]); err != nil {
			fmt.Fprintf(os.Stderr, "worker failed: %v\n", err)
			os.Exit(1)
		}
		return
	}

	if len(os.Args) < 2 {
		printUsage()
		os.Exit(2)
	}

	switch os.Args[1] {
	case "serve":
		if err := entrypoint.RunDaemonFromArgs("nimi serve", os.Args[2:]); err != nil {
			fmt.Fprintf(os.Stderr, "serve failed: %v\n", err)
			os.Exit(1)
		}
	case "status":
		if err := runRuntimeHealth(os.Args[2:]); err != nil {
			fmt.Fprintf(os.Stderr, "status failed: %v\n", err)
			os.Exit(1)
		}
	case "run", "chat":
		if err := runTopLevelRun(os.Args[2:]); err != nil {
			fmt.Fprintf(os.Stderr, "%s failed: %v\n", os.Args[1], err)
			os.Exit(1)
		}
	case "ai":
		if err := runRuntimeAI(os.Args[2:]); err != nil {
			fmt.Fprintf(os.Stderr, "ai failed: %v\n", err)
			os.Exit(1)
		}
	case "model":
		if err := runRuntimeModel(os.Args[2:]); err != nil {
			fmt.Fprintf(os.Stderr, "model failed: %v\n", err)
			os.Exit(1)
		}
	case "mod":
		if err := runRuntimeMod(os.Args[2:]); err != nil {
			fmt.Fprintf(os.Stderr, "mod failed: %v\n", err)
			os.Exit(1)
		}
	case "auth":
		if err := runRuntimeAuth(os.Args[2:]); err != nil {
			fmt.Fprintf(os.Stderr, "auth failed: %v\n", err)
			os.Exit(1)
		}
	case "app-auth":
		if err := runRuntimeAppAuth(os.Args[2:]); err != nil {
			fmt.Fprintf(os.Stderr, "app-auth failed: %v\n", err)
			os.Exit(1)
		}
	case "knowledge":
		if err := runRuntimeKnowledge(os.Args[2:]); err != nil {
			fmt.Fprintf(os.Stderr, "knowledge failed: %v\n", err)
			os.Exit(1)
		}
	case "app":
		if err := runRuntimeApp(os.Args[2:]); err != nil {
			fmt.Fprintf(os.Stderr, "app failed: %v\n", err)
			os.Exit(1)
		}
	case "audit":
		if err := runRuntimeAudit(os.Args[2:]); err != nil {
			fmt.Fprintf(os.Stderr, "audit failed: %v\n", err)
			os.Exit(1)
		}
	case "workflow":
		if err := runRuntimeWorkflow(os.Args[2:]); err != nil {
			fmt.Fprintf(os.Stderr, "workflow failed: %v\n", err)
			os.Exit(1)
		}
	case "health":
		if err := runRuntimeHealth(os.Args[2:]); err != nil {
			fmt.Fprintf(os.Stderr, "health failed: %v\n", err)
			os.Exit(1)
		}
	case "providers":
		if err := runRuntimeProviders(os.Args[2:]); err != nil {
			fmt.Fprintf(os.Stderr, "providers failed: %v\n", err)
			os.Exit(1)
		}
	case "config":
		if err := runRuntimeConfig(os.Args[2:]); err != nil {
			fmt.Fprintf(os.Stderr, "config failed: %v\n", err)
			os.Exit(1)
		}
	default:
		printUsage()
		os.Exit(2)
	}
}

func runTopLevelRun(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi run", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "90s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "caller app id")
	subjectUserID := fs.String("subject-user-id", "local-user", "subject user id")
	prompt := fs.String("prompt", "", "prompt")
	route := fs.String("route", "local", "route: local|cloud")
	fallback := fs.String("fallback", "allow", "fallback: deny|allow")
	systemPrompt := fs.String("system", "", "system prompt")
	timeoutMs := fs.Int("timeout-ms", 0, "provider timeout override")
	jsonOutput := fs.Bool("json", false, "output json")
	callerKind := fs.String("caller-kind", "third-party-service", "caller kind metadata")
	callerID := fs.String("caller-id", "nimi-cli", "caller id metadata")
	surfaceID := fs.String("surface-id", "runtime-cli", "surface id metadata")
	traceID := fs.String("trace-id", "", "trace id metadata")
	if err := fs.Parse(args); err != nil {
		return err
	}

	modelID := "local/default"
	if fs.NArg() > 0 {
		modelID = strings.TrimSpace(fs.Arg(0))
	}

	promptValue := strings.TrimSpace(*prompt)
	if promptValue == "" && fs.NArg() > 1 {
		promptValue = strings.TrimSpace(strings.Join(fs.Args()[1:], " "))
	}
	if promptValue == "" {
		return fmt.Errorf("prompt is required")
	}

	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}

	routePolicy, err := parseRoutePolicy(*route)
	if err != nil {
		return err
	}
	fallbackPolicy, err := parseFallbackPolicy(*fallback)
	if err != nil {
		return err
	}

	req := &runtimev1.StreamGenerateRequest{
		AppId:         strings.TrimSpace(*appID),
		SubjectUserId: strings.TrimSpace(*subjectUserID),
		ModelId:       modelID,
		Modal:         runtimev1.Modal_MODAL_TEXT,
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: promptValue},
		},
		SystemPrompt: *systemPrompt,
		RoutePolicy:  routePolicy,
		Fallback:     fallbackPolicy,
		TimeoutMs:    int32(*timeoutMs),
	}
	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	events, errCh, err := entrypoint.StreamGenerateTextGRPC(context.Background(), *grpcAddr, req, callerMeta)
	if err != nil {
		return err
	}

	buffer := strings.Builder{}
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
			if event.GetEventType() == runtimev1.StreamEventType_STREAM_EVENT_DELTA {
				buffer.WriteString(event.GetDelta().GetText())
				if !*jsonOutput {
					fmt.Print(event.GetDelta().GetText())
				}
			}
			if event.GetEventType() == runtimev1.StreamEventType_STREAM_EVENT_FAILED {
				return errors.New(event.GetFailed().GetReasonCode().String())
			}
		case <-time.After(timeout):
			return fmt.Errorf("stream timeout")
		}
	}
	if !*jsonOutput {
		fmt.Println()
		return nil
	}
	out, err := json.MarshalIndent(map[string]any{
		"model_id": modelID,
		"text":     buffer.String(),
	}, "", "  ")
	if err != nil {
		return err
	}
	fmt.Println(string(out))
	return nil
}

func runRuntimeAI(args []string) error {
	if len(args) == 0 {
		printRuntimeAIUsage()
		return flag.ErrHelp
	}

	switch args[0] {
	case "generate":
		return runRuntimeAIGenerate(args[1:])
	case "stream":
		return runRuntimeAIStream(args[1:])
	case "embed":
		return runRuntimeAIEmbed(args[1:])
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

func runRuntimeAuth(args []string) error {
	if len(args) == 0 {
		printRuntimeAuthUsage()
		return flag.ErrHelp
	}

	switch args[0] {
	case "register-app":
		return runRuntimeAuthRegisterApp(args[1:])
	case "open-session":
		return runRuntimeAuthOpenSession(args[1:])
	case "refresh-session":
		return runRuntimeAuthRefreshSession(args[1:])
	case "revoke-session":
		return runRuntimeAuthRevokeSession(args[1:])
	case "register-external":
		return runRuntimeAuthRegisterExternal(args[1:])
	case "open-external-session":
		return runRuntimeAuthOpenExternalSession(args[1:])
	case "revoke-external-session":
		return runRuntimeAuthRevokeExternalSession(args[1:])
	default:
		printRuntimeAuthUsage()
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
