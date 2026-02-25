package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/entrypoint"
	"os"
	"strings"
	"time"
)

func runRuntimeAIGenerate(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi ai generate", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "10s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "caller app id")
	subjectUserID := fs.String("subject-user-id", "local-user", "subject user id")
	modelID := fs.String("model-id", "local/qwen2.5", "target model id")
	routeRaw := fs.String("route", "local", "route policy: local|cloud")
	fallbackRaw := fs.String("fallback", "deny", "fallback policy: deny|allow")
	systemPrompt := fs.String("system", "", "system prompt")
	prompt := fs.String("prompt", "", "user prompt text")
	timeoutMS := fs.Int("timeout-ms", 30000, "ai request timeout in milliseconds")
	jsonOutput := fs.Bool("json", false, "output json")
	callerKind := fs.String("caller-kind", "third-party-service", "caller kind metadata")
	callerID := fs.String("caller-id", "nimi-cli", "caller id metadata")
	surfaceID := fs.String("surface-id", "runtime-cli", "surface id metadata")
	traceID := fs.String("trace-id", "", "trace id metadata")
	if err := fs.Parse(args); err != nil {
		return err
	}

	if strings.TrimSpace(*prompt) == "" {
		return fmt.Errorf("prompt is required")
	}
	if *timeoutMS <= 0 {
		return fmt.Errorf("timeout-ms must be > 0")
	}
	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	routePolicy, err := parseRoutePolicy(*routeRaw)
	if err != nil {
		return err
	}
	fallbackPolicy, err := parseFallbackPolicy(*fallbackRaw)
	if err != nil {
		return err
	}
	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)

	resp, err := entrypoint.GenerateTextGRPC(*grpcAddr, timeout, &runtimev1.GenerateRequest{
		AppId:         strings.TrimSpace(*appID),
		SubjectUserId: strings.TrimSpace(*subjectUserID),
		ModelId:       strings.TrimSpace(*modelID),
		Modal:         runtimev1.Modal_MODAL_TEXT,
		Input: []*runtimev1.ChatMessage{
			{
				Role:    "user",
				Content: strings.TrimSpace(*prompt),
			},
		},
		SystemPrompt: strings.TrimSpace(*systemPrompt),
		RoutePolicy:  routePolicy,
		Fallback:     fallbackPolicy,
		TimeoutMs:    int32(*timeoutMS),
	}, callerMeta)
	if err != nil {
		return err
	}

	text := ""
	if output := resp.GetOutput(); output != nil {
		if field, ok := output.GetFields()["text"]; ok {
			text = strings.TrimSpace(field.GetStringValue())
		}
	}

	if *jsonOutput {
		payload := map[string]any{
			"text":           text,
			"finish_reason":  resp.GetFinishReason().String(),
			"route_decision": resp.GetRouteDecision().String(),
			"model_resolved": resp.GetModelResolved(),
			"trace_id":       resp.GetTraceId(),
			"usage": map[string]any{
				"input_tokens":  resp.GetUsage().GetInputTokens(),
				"output_tokens": resp.GetUsage().GetOutputTokens(),
				"compute_ms":    resp.GetUsage().GetComputeMs(),
			},
		}
		out, err := json.MarshalIndent(payload, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}

	fmt.Println(text)
	fmt.Printf("trace=%s model=%s route=%s finish=%s usage(in=%d,out=%d,ms=%d)\n",
		resp.GetTraceId(),
		resp.GetModelResolved(),
		resp.GetRouteDecision().String(),
		resp.GetFinishReason().String(),
		resp.GetUsage().GetInputTokens(),
		resp.GetUsage().GetOutputTokens(),
		resp.GetUsage().GetComputeMs(),
	)
	return nil
}

func runRuntimeAIStream(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi ai stream", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "130s", "stream timeout")
	appID := fs.String("app-id", "nimi.desktop", "caller app id")
	subjectUserID := fs.String("subject-user-id", "local-user", "subject user id")
	modelID := fs.String("model-id", "local/qwen2.5", "target model id")
	routeRaw := fs.String("route", "local", "route policy: local|cloud")
	fallbackRaw := fs.String("fallback", "deny", "fallback policy: deny|allow")
	systemPrompt := fs.String("system", "", "system prompt")
	prompt := fs.String("prompt", "", "user prompt text")
	timeoutMS := fs.Int("timeout-ms", 120000, "ai request timeout in milliseconds")
	jsonOutput := fs.Bool("json", false, "output ndjson stream events")
	callerKind := fs.String("caller-kind", "third-party-service", "caller kind metadata")
	callerID := fs.String("caller-id", "nimi-cli", "caller id metadata")
	surfaceID := fs.String("surface-id", "runtime-cli", "surface id metadata")
	traceID := fs.String("trace-id", "", "trace id metadata")
	if err := fs.Parse(args); err != nil {
		return err
	}

	if strings.TrimSpace(*prompt) == "" {
		return fmt.Errorf("prompt is required")
	}
	if *timeoutMS <= 0 {
		return fmt.Errorf("timeout-ms must be > 0")
	}
	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	routePolicy, err := parseRoutePolicy(*routeRaw)
	if err != nil {
		return err
	}
	fallbackPolicy, err := parseFallbackPolicy(*fallbackRaw)
	if err != nil {
		return err
	}
	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	events, errCh, err := entrypoint.StreamGenerateTextGRPC(ctx, *grpcAddr, &runtimev1.StreamGenerateRequest{
		AppId:         strings.TrimSpace(*appID),
		SubjectUserId: strings.TrimSpace(*subjectUserID),
		ModelId:       strings.TrimSpace(*modelID),
		Modal:         runtimev1.Modal_MODAL_TEXT,
		Input: []*runtimev1.ChatMessage{
			{
				Role:    "user",
				Content: strings.TrimSpace(*prompt),
			},
		},
		SystemPrompt: strings.TrimSpace(*systemPrompt),
		RoutePolicy:  routePolicy,
		Fallback:     fallbackPolicy,
		TimeoutMs:    int32(*timeoutMS),
	}, callerMeta)
	if err != nil {
		return err
	}

	var output strings.Builder
	var failedReason runtimev1.ReasonCode
	streamTraceID := ""
	modelResolved := ""
	routeDecision := runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED
	usage := &runtimev1.UsageStats{}
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
			if event == nil {
				continue
			}
			if streamTraceID == "" {
				streamTraceID = strings.TrimSpace(event.GetTraceId())
			}
			if started := event.GetStarted(); started != nil {
				modelResolved = strings.TrimSpace(started.GetModelResolved())
				routeDecision = started.GetRouteDecision()
			}
			if delta := event.GetDelta(); delta != nil {
				output.WriteString(delta.GetText())
			}
			if currentUsage := event.GetUsage(); currentUsage != nil {
				usage = currentUsage
			}
			if failed := event.GetFailed(); failed != nil {
				failedReason = failed.GetReasonCode()
			}

			if *jsonOutput {
				out, marshalErr := json.Marshal(streamEventJSON(event))
				if marshalErr != nil {
					return marshalErr
				}
				fmt.Println(string(out))
				continue
			}
			if event.GetDelta() != nil {
				fmt.Print(event.GetDelta().GetText())
			}
		}
	}

	if !*jsonOutput {
		fmt.Println()
		fmt.Printf("trace=%s model=%s route=%s usage(in=%d,out=%d,ms=%d)\n",
			streamTraceID,
			modelResolved,
			routeDecision.String(),
			usage.GetInputTokens(),
			usage.GetOutputTokens(),
			usage.GetComputeMs(),
		)
	}
	if failedReason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		return fmt.Errorf("stream failed: %s", failedReason.String())
	}
	if output.Len() == 0 {
		return fmt.Errorf("stream completed without output")
	}
	return nil
}

func runRuntimeAIEmbed(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	var inputs multiStringFlag
	fs := flag.NewFlagSet("nimi ai embed", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "10s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "caller app id")
	subjectUserID := fs.String("subject-user-id", "local-user", "subject user id")
	modelID := fs.String("model-id", "local/text-embedding-3-small", "target model id")
	routeRaw := fs.String("route", "local", "route policy: local|cloud")
	fallbackRaw := fs.String("fallback", "deny", "fallback policy: deny|allow")
	timeoutMS := fs.Int("timeout-ms", 20000, "ai request timeout in milliseconds")
	jsonOutput := fs.Bool("json", false, "output json")
	callerKind := fs.String("caller-kind", "third-party-service", "caller kind metadata")
	callerID := fs.String("caller-id", "nimi-cli", "caller id metadata")
	surfaceID := fs.String("surface-id", "runtime-cli", "surface id metadata")
	traceID := fs.String("trace-id", "", "trace id metadata")
	fs.Var(&inputs, "input", "embedding input text (repeatable)")
	if err := fs.Parse(args); err != nil {
		return err
	}

	normalizedInputs := inputs.Values()
	if len(normalizedInputs) == 0 {
		return fmt.Errorf("at least one --input is required")
	}
	if *timeoutMS <= 0 {
		return fmt.Errorf("timeout-ms must be > 0")
	}
	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	routePolicy, err := parseRoutePolicy(*routeRaw)
	if err != nil {
		return err
	}
	fallbackPolicy, err := parseFallbackPolicy(*fallbackRaw)
	if err != nil {
		return err
	}
	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)

	resp, err := entrypoint.EmbedGRPC(*grpcAddr, timeout, &runtimev1.EmbedRequest{
		AppId:         strings.TrimSpace(*appID),
		SubjectUserId: strings.TrimSpace(*subjectUserID),
		ModelId:       strings.TrimSpace(*modelID),
		Inputs:        normalizedInputs,
		RoutePolicy:   routePolicy,
		Fallback:      fallbackPolicy,
		TimeoutMs:     int32(*timeoutMS),
	}, callerMeta)
	if err != nil {
		return err
	}

	if *jsonOutput {
		out, err := json.MarshalIndent(map[string]any{
			"vector_count":   len(resp.GetVectors()),
			"route_decision": resp.GetRouteDecision().String(),
			"model_resolved": resp.GetModelResolved(),
			"trace_id":       resp.GetTraceId(),
			"usage": map[string]any{
				"input_tokens":  resp.GetUsage().GetInputTokens(),
				"output_tokens": resp.GetUsage().GetOutputTokens(),
				"compute_ms":    resp.GetUsage().GetComputeMs(),
			},
			"vectors": resp.GetVectors(),
		}, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}

	fmt.Printf("vectors=%d trace=%s model=%s route=%s usage(in=%d,out=%d,ms=%d)\n",
		len(resp.GetVectors()),
		resp.GetTraceId(),
		resp.GetModelResolved(),
		resp.GetRouteDecision().String(),
		resp.GetUsage().GetInputTokens(),
		resp.GetUsage().GetOutputTokens(),
		resp.GetUsage().GetComputeMs(),
	)
	return nil
}
