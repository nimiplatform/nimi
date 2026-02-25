package main

import (
	"encoding/json"
	"flag"
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/entrypoint"
	"os"
	"sort"
	"strings"
	"time"
)

func runRuntimeModelList(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi model list", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "5s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "caller app id")
	jsonOutput := fs.Bool("json", false, "output json")
	callerKind := fs.String("caller-kind", "third-party-service", "caller kind metadata")
	callerID := fs.String("caller-id", "nimi-cli", "caller id metadata")
	surfaceID := fs.String("surface-id", "runtime-cli", "surface id metadata")
	traceID := fs.String("trace-id", "", "trace id metadata")
	if err := fs.Parse(args); err != nil {
		return err
	}

	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	resp, err := entrypoint.ListModelsGRPC(*grpcAddr, timeout, strings.TrimSpace(*appID), callerMeta)
	if err != nil {
		return err
	}

	models := append([]*runtimev1.ModelDescriptor(nil), resp.GetModels()...)
	sort.Slice(models, func(i, j int) bool {
		return strings.TrimSpace(models[i].GetModelId()) < strings.TrimSpace(models[j].GetModelId())
	})

	if *jsonOutput {
		items := make([]map[string]any, 0, len(models))
		for _, model := range models {
			lastHealthAt := ""
			if ts := model.GetLastHealthAt(); ts != nil {
				lastHealthAt = ts.AsTime().UTC().Format(time.RFC3339Nano)
			}
			items = append(items, map[string]any{
				"model_id":       model.GetModelId(),
				"version":        model.GetVersion(),
				"status":         model.GetStatus().String(),
				"capabilities":   model.GetCapabilities(),
				"last_health_at": lastHealthAt,
			})
		}
		out, err := json.MarshalIndent(map[string]any{"models": items}, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}

	if len(models) == 0 {
		fmt.Println("no models")
		return nil
	}
	fmt.Printf("%-28s %-12s %-24s %s\n", "MODEL_ID", "STATUS", "VERSION", "CAPABILITIES")
	for _, model := range models {
		fmt.Printf("%-28s %-12s %-24s %s\n",
			model.GetModelId(),
			model.GetStatus().String(),
			model.GetVersion(),
			strings.Join(model.GetCapabilities(), ","),
		)
	}
	return nil
}

func runRuntimeModelPull(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi model pull", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "10s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "caller app id")
	modelRef := fs.String("model-ref", "", "model reference, e.g. local/qwen2.5@latest")
	source := fs.String("source", "official", "model source")
	digest := fs.String("digest", "", "optional model digest")
	jsonOutput := fs.Bool("json", false, "output json")
	callerKind := fs.String("caller-kind", "third-party-service", "caller kind metadata")
	callerID := fs.String("caller-id", "nimi-cli", "caller id metadata")
	surfaceID := fs.String("surface-id", "runtime-cli", "surface id metadata")
	traceID := fs.String("trace-id", "", "trace id metadata")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if strings.TrimSpace(*modelRef) == "" {
		return fmt.Errorf("model-ref is required")
	}

	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	resp, err := entrypoint.PullModelGRPC(*grpcAddr, timeout, &runtimev1.PullModelRequest{
		AppId:    strings.TrimSpace(*appID),
		ModelRef: strings.TrimSpace(*modelRef),
		Source:   strings.TrimSpace(*source),
		Digest:   strings.TrimSpace(*digest),
	}, callerMeta)
	if err != nil {
		return err
	}

	if *jsonOutput {
		out, err := json.MarshalIndent(map[string]any{
			"task_id":     resp.GetTaskId(),
			"accepted":    resp.GetAccepted(),
			"reason_code": resp.GetReasonCode().String(),
		}, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}

	fmt.Printf("task_id=%s accepted=%v reason=%s\n", resp.GetTaskId(), resp.GetAccepted(), resp.GetReasonCode().String())
	return nil
}

func runRuntimeModelRemove(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi model remove", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "10s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "caller app id")
	modelID := fs.String("model-id", "", "model id")
	accessTokenID := fs.String("access-token-id", "", "protected access token id")
	accessTokenSecret := fs.String("access-token-secret", "", "protected access token secret")
	jsonOutput := fs.Bool("json", false, "output json")
	callerKind := fs.String("caller-kind", "third-party-service", "caller kind metadata")
	callerID := fs.String("caller-id", "nimi-cli", "caller id metadata")
	surfaceID := fs.String("surface-id", "runtime-cli", "surface id metadata")
	traceID := fs.String("trace-id", "", "trace id metadata")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if strings.TrimSpace(*modelID) == "" {
		return fmt.Errorf("model-id is required")
	}

	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	callerMeta.AccessTokenID = strings.TrimSpace(*accessTokenID)
	callerMeta.AccessTokenSecret = strings.TrimSpace(*accessTokenSecret)
	resp, err := entrypoint.RemoveModelGRPC(*grpcAddr, timeout, &runtimev1.RemoveModelRequest{
		AppId:   strings.TrimSpace(*appID),
		ModelId: strings.TrimSpace(*modelID),
	}, callerMeta)
	if err != nil {
		return err
	}

	if *jsonOutput {
		out, err := json.MarshalIndent(map[string]any{
			"ok":          resp.GetOk(),
			"reason_code": resp.GetReasonCode().String(),
			"action_hint": resp.GetActionHint(),
		}, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}

	fmt.Printf("ok=%v reason=%s action_hint=%s\n", resp.GetOk(), resp.GetReasonCode().String(), resp.GetActionHint())
	return nil
}

func runRuntimeModelHealth(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi model health", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "5s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "caller app id")
	modelID := fs.String("model-id", "", "model id")
	jsonOutput := fs.Bool("json", false, "output json")
	callerKind := fs.String("caller-kind", "third-party-service", "caller kind metadata")
	callerID := fs.String("caller-id", "nimi-cli", "caller id metadata")
	surfaceID := fs.String("surface-id", "runtime-cli", "surface id metadata")
	traceID := fs.String("trace-id", "", "trace id metadata")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if strings.TrimSpace(*modelID) == "" {
		return fmt.Errorf("model-id is required")
	}

	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	resp, err := entrypoint.CheckModelHealthGRPC(*grpcAddr, timeout, &runtimev1.CheckModelHealthRequest{
		ModelId: strings.TrimSpace(*modelID),
	}, strings.TrimSpace(*appID), callerMeta)
	if err != nil {
		return err
	}

	if *jsonOutput {
		out, err := json.MarshalIndent(map[string]any{
			"healthy":     resp.GetHealthy(),
			"reason_code": resp.GetReasonCode().String(),
			"action_hint": resp.GetActionHint(),
		}, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}

	fmt.Printf("healthy=%v reason=%s action_hint=%s\n", resp.GetHealthy(), resp.GetReasonCode().String(), resp.GetActionHint())
	return nil
}
