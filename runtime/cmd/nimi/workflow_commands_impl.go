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

func runRuntimeWorkflowSubmit(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi workflow submit", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "10s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "caller app id")
	subjectUserID := fs.String("subject-user-id", "local-user", "subject user id")
	definitionFile := fs.String("definition-file", "", "workflow definition json file")
	timeoutMS := fs.Int("timeout-ms", 120000, "workflow timeout in milliseconds")
	jsonOutput := fs.Bool("json", false, "output json")
	callerKind := fs.String("caller-kind", "third-party-service", "caller kind metadata")
	callerID := fs.String("caller-id", "nimi-cli", "caller id metadata")
	surfaceID := fs.String("surface-id", "runtime-cli", "surface id metadata")
	traceID := fs.String("trace-id", "", "trace id metadata")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if strings.TrimSpace(*definitionFile) == "" {
		return fmt.Errorf("definition-file is required")
	}
	if *timeoutMS <= 0 {
		return fmt.Errorf("timeout-ms must be > 0")
	}

	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	definition, err := loadWorkflowDefinitionFile(*definitionFile)
	if err != nil {
		return err
	}
	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)

	resp, err := entrypoint.SubmitWorkflowGRPC(*grpcAddr, timeout, &runtimev1.SubmitWorkflowRequest{
		AppId:         strings.TrimSpace(*appID),
		SubjectUserId: strings.TrimSpace(*subjectUserID),
		Definition:    definition,
		TimeoutMs:     int32(*timeoutMS),
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

func runRuntimeWorkflowGet(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi workflow get", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "5s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "caller app id")
	taskID := fs.String("task-id", "", "workflow task id")
	jsonOutput := fs.Bool("json", false, "output json")
	callerKind := fs.String("caller-kind", "third-party-service", "caller kind metadata")
	callerID := fs.String("caller-id", "nimi-cli", "caller id metadata")
	surfaceID := fs.String("surface-id", "runtime-cli", "surface id metadata")
	traceID := fs.String("trace-id", "", "trace id metadata")
	if err := fs.Parse(args); err != nil {
		return err
	}
	taskIDValue := strings.TrimSpace(*taskID)
	if taskIDValue == "" {
		return fmt.Errorf("task-id is required")
	}

	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	resp, err := entrypoint.GetWorkflowGRPC(*grpcAddr, timeout, &runtimev1.GetWorkflowRequest{
		TaskId: taskIDValue,
	}, strings.TrimSpace(*appID), callerMeta)
	if err != nil {
		return err
	}

	nodes := make([]map[string]any, 0, len(resp.GetNodes()))
	for _, node := range resp.GetNodes() {
		nodes = append(nodes, map[string]any{
			"node_id": node.GetNodeId(),
			"status":  node.GetStatus().String(),
			"attempt": node.GetAttempt(),
			"reason":  node.GetReason(),
		})
	}
	output := map[string]any{}
	if value := resp.GetOutput(); value != nil {
		output = value.AsMap()
	}

	if *jsonOutput {
		out, err := json.MarshalIndent(map[string]any{
			"task_id":     resp.GetTaskId(),
			"status":      resp.GetStatus().String(),
			"reason_code": resp.GetReasonCode().String(),
			"nodes":       nodes,
			"output":      output,
		}, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}

	fmt.Printf("task_id=%s status=%s reason=%s\n", resp.GetTaskId(), resp.GetStatus().String(), resp.GetReasonCode().String())
	for _, node := range nodes {
		fmt.Printf("  node=%s status=%s attempt=%v reason=%s\n",
			node["node_id"],
			node["status"],
			node["attempt"],
			node["reason"],
		)
	}
	if len(output) > 0 {
		out, err := json.Marshal(output)
		if err == nil {
			fmt.Printf("  output=%s\n", string(out))
		}
	}
	return nil
}

func runRuntimeWorkflowCancel(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi workflow cancel", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "5s", "grpc request timeout")
	appID := fs.String("app-id", "nimi.desktop", "caller app id")
	taskID := fs.String("task-id", "", "workflow task id")
	jsonOutput := fs.Bool("json", false, "output json")
	callerKind := fs.String("caller-kind", "third-party-service", "caller kind metadata")
	callerID := fs.String("caller-id", "nimi-cli", "caller id metadata")
	surfaceID := fs.String("surface-id", "runtime-cli", "surface id metadata")
	traceID := fs.String("trace-id", "", "trace id metadata")
	if err := fs.Parse(args); err != nil {
		return err
	}
	taskIDValue := strings.TrimSpace(*taskID)
	if taskIDValue == "" {
		return fmt.Errorf("task-id is required")
	}

	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	resp, err := entrypoint.CancelWorkflowGRPC(*grpcAddr, timeout, &runtimev1.CancelWorkflowRequest{
		TaskId: taskIDValue,
	}, strings.TrimSpace(*appID), callerMeta)
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

func runRuntimeWorkflowWatch(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi workflow watch", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "10m", "stream timeout")
	appID := fs.String("app-id", "nimi.desktop", "caller app id")
	taskID := fs.String("task-id", "", "workflow task id")
	jsonOutput := fs.Bool("json", false, "output ndjson events")
	callerKind := fs.String("caller-kind", "third-party-service", "caller kind metadata")
	callerID := fs.String("caller-id", "nimi-cli", "caller id metadata")
	surfaceID := fs.String("surface-id", "runtime-cli", "surface id metadata")
	traceID := fs.String("trace-id", "", "trace id metadata")
	if err := fs.Parse(args); err != nil {
		return err
	}
	taskIDValue := strings.TrimSpace(*taskID)
	if taskIDValue == "" {
		return fmt.Errorf("task-id is required")
	}

	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	events, errCh, err := entrypoint.SubscribeWorkflowEventsGRPC(ctx, *grpcAddr, &runtimev1.SubscribeWorkflowEventsRequest{
		TaskId: taskIDValue,
	}, strings.TrimSpace(*appID), callerMeta)
	if err != nil {
		return err
	}

	sawEvent := false
	var terminalErr error
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
			sawEvent = true
			switch event.GetEventType() {
			case runtimev1.WorkflowEventType_WORKFLOW_EVENT_FAILED:
				terminalErr = fmt.Errorf("workflow failed: %s", event.GetReasonCode().String())
			case runtimev1.WorkflowEventType_WORKFLOW_EVENT_CANCELED:
				terminalErr = fmt.Errorf("workflow canceled")
			}

			if *jsonOutput {
				out, marshalErr := json.Marshal(workflowEventJSON(event))
				if marshalErr != nil {
					return marshalErr
				}
				fmt.Println(string(out))
				continue
			}
			fmt.Println(workflowEventLine(event))
		}
	}

	if !sawEvent {
		return fmt.Errorf("workflow watch ended without events")
	}
	return terminalErr
}
