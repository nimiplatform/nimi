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

func runRuntimeAITextGenerate(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi ai text-generate", flag.ContinueOnError)
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
	timeoutMsValue, err := millisecondsInt32(*timeoutMS)
	if err != nil {
		return err
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

	resp, err := entrypoint.ExecuteScenarioGRPC(*grpcAddr, timeout, &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         strings.TrimSpace(*appID),
			SubjectUserId: strings.TrimSpace(*subjectUserID),
			ModelId:       strings.TrimSpace(*modelID),
			RoutePolicy:   routePolicy,
			Fallback:      fallbackPolicy,
			TimeoutMs:     timeoutMsValue,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_TextGenerate{
				TextGenerate: &runtimev1.TextGenerateScenarioSpec{
					Input: []*runtimev1.ChatMessage{
						{
							Role:    "user",
							Content: strings.TrimSpace(*prompt),
						},
					},
					SystemPrompt: strings.TrimSpace(*systemPrompt),
				},
			},
		},
	}, callerMeta)
	if err != nil {
		return err
	}

	text := extractScenarioOutputText(resp.GetOutput())

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
	timeoutMsValue, err := millisecondsInt32(*timeoutMS)
	if err != nil {
		return err
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

	events, errCh, err := entrypoint.StreamScenarioGRPC(ctx, *grpcAddr, &runtimev1.StreamScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         strings.TrimSpace(*appID),
			SubjectUserId: strings.TrimSpace(*subjectUserID),
			ModelId:       strings.TrimSpace(*modelID),
			RoutePolicy:   routePolicy,
			Fallback:      fallbackPolicy,
			TimeoutMs:     timeoutMsValue,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_TextGenerate{
				TextGenerate: &runtimev1.TextGenerateScenarioSpec{
					Input: []*runtimev1.ChatMessage{
						{
							Role:    "user",
							Content: strings.TrimSpace(*prompt),
						},
					},
					SystemPrompt: strings.TrimSpace(*systemPrompt),
				},
			},
		},
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
				output.WriteString(extractScenarioStreamTextDelta(delta))
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
				fmt.Print(extractScenarioStreamTextDelta(event.GetDelta()))
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

func runRuntimeAITextEmbed(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	var inputs multiStringFlag
	fs := flag.NewFlagSet("nimi ai text-embed", flag.ContinueOnError)
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
	timeoutMsValue, err := millisecondsInt32(*timeoutMS)
	if err != nil {
		return err
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

	resp, err := entrypoint.ExecuteScenarioGRPC(*grpcAddr, timeout, &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         strings.TrimSpace(*appID),
			SubjectUserId: strings.TrimSpace(*subjectUserID),
			ModelId:       strings.TrimSpace(*modelID),
			RoutePolicy:   routePolicy,
			Fallback:      fallbackPolicy,
			TimeoutMs:     timeoutMsValue,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_TextEmbed{
				TextEmbed: &runtimev1.TextEmbedScenarioSpec{
					Inputs: normalizedInputs,
				},
			},
		},
	}, callerMeta)
	if err != nil {
		return err
	}
	vectorPayloads := make([]any, 0, extractScenarioOutputVectorCount(resp.GetOutput()))
	if output := resp.GetOutput(); output != nil {
		if value, ok := output.GetOutput().(*runtimev1.ScenarioOutput_TextEmbed); ok {
			for _, vector := range value.TextEmbed.GetVectors() {
				row := make([]any, 0, len(vector.GetValues()))
				for _, item := range vector.GetValues() {
					row = append(row, item)
				}
				vectorPayloads = append(vectorPayloads, row)
			}
		}
	}
	vectorCount := len(vectorPayloads)

	if *jsonOutput {
		out, err := json.MarshalIndent(map[string]any{
			"vector_count":   vectorCount,
			"route_decision": resp.GetRouteDecision().String(),
			"model_resolved": resp.GetModelResolved(),
			"trace_id":       resp.GetTraceId(),
			"usage": map[string]any{
				"input_tokens":  resp.GetUsage().GetInputTokens(),
				"output_tokens": resp.GetUsage().GetOutputTokens(),
				"compute_ms":    resp.GetUsage().GetComputeMs(),
			},
			"vectors": vectorPayloads,
		}, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}

	fmt.Printf("vectors=%d trace=%s model=%s route=%s usage(in=%d,out=%d,ms=%d)\n",
		vectorCount,
		resp.GetTraceId(),
		resp.GetModelResolved(),
		resp.GetRouteDecision().String(),
		resp.GetUsage().GetInputTokens(),
		resp.GetUsage().GetOutputTokens(),
		resp.GetUsage().GetComputeMs(),
	)
	return nil
}
