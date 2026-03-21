package main

import (
	"encoding/base64"
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

func runRuntimeAuditEvents(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi audit events", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "5s", "grpc request timeout")
	appID := fs.String("app-id", "", "app id filter")
	subjectUserID := fs.String("subject-user-id", "", "subject user id filter")
	domain := fs.String("domain", "", "domain filter")
	reasonCodeRaw := fs.String("reason-code", "", "reason code filter (e.g. action_executed)")
	fromTimeRaw := fs.String("from-time", "", "from time (RFC3339)")
	toTimeRaw := fs.String("to-time", "", "to time (RFC3339)")
	pageSize := fs.Int("page-size", 50, "page size")
	pageToken := fs.String("page-token", "", "page token")
	filterCallerKindRaw := fs.String("filter-caller-kind", "", "caller kind filter: desktop-core|desktop-mod|third-party-app|third-party-service")
	filterCallerID := fs.String("filter-caller-id", "", "caller id filter")
	jsonOutput := fs.Bool("json", false, "output json")
	callerKind := fs.String("caller-kind", "third-party-service", "caller kind metadata")
	callerID := fs.String("caller-id", "nimi-cli", "caller id metadata")
	surfaceID := fs.String("surface-id", "runtime-cli", "surface id metadata")
	traceID := fs.String("trace-id", "", "trace id metadata")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *pageSize <= 0 {
		return fmt.Errorf("page-size must be > 0")
	}

	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	reasonCode, err := parseReasonCode(*reasonCodeRaw)
	if err != nil {
		return err
	}
	filterCallerKind, err := parseCallerKindFilter(*filterCallerKindRaw)
	if err != nil {
		return err
	}
	fromTime, err := parseOptionalTimestamp(*fromTimeRaw)
	if err != nil {
		return err
	}
	toTime, err := parseOptionalTimestamp(*toTimeRaw)
	if err != nil {
		return err
	}

	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	resp, err := entrypoint.ListAuditEventsGRPC(*grpcAddr, timeout, &runtimev1.ListAuditEventsRequest{
		AppId:         strings.TrimSpace(*appID),
		SubjectUserId: strings.TrimSpace(*subjectUserID),
		Domain:        strings.TrimSpace(*domain),
		ReasonCode:    reasonCode,
		FromTime:      fromTime,
		ToTime:        toTime,
		PageSize:      int32(*pageSize),
		PageToken:     strings.TrimSpace(*pageToken),
		CallerKind:    filterCallerKind,
		CallerId:      strings.TrimSpace(*filterCallerID),
	}, callerMeta)
	if err != nil {
		return err
	}

	events := make([]map[string]any, 0, len(resp.GetEvents()))
	for _, event := range resp.GetEvents() {
		timestamp := ""
		if ts := event.GetTimestamp(); ts != nil {
			timestamp = ts.AsTime().UTC().Format(time.RFC3339Nano)
		}
		events = append(events, map[string]any{
			"audit_id":        event.GetAuditId(),
			"app_id":          event.GetAppId(),
			"subject_user_id": event.GetSubjectUserId(),
			"domain":          event.GetDomain(),
			"operation":       event.GetOperation(),
			"reason_code":     event.GetReasonCode().String(),
			"trace_id":        event.GetTraceId(),
			"timestamp":       timestamp,
			"payload":         structAsMap(event.GetPayload()),
			"caller_kind":     event.GetCallerKind().String(),
			"caller_id":       event.GetCallerId(),
			"surface_id":      event.GetSurfaceId(),
		})
	}

	if *jsonOutput {
		out, err := json.MarshalIndent(map[string]any{
			"events":          events,
			"next_page_token": resp.GetNextPageToken(),
		}, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}

	fmt.Printf("events=%d next_page_token=%s\n", len(events), resp.GetNextPageToken())
	for _, event := range events {
		fmt.Printf("  ts=%s domain=%s operation=%s reason=%s trace=%s\n",
			event["timestamp"],
			event["domain"],
			event["operation"],
			event["reason_code"],
			event["trace_id"],
		)
	}
	return nil
}

func runRuntimeAuditUsage(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi audit usage", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "5s", "grpc request timeout")
	appID := fs.String("app-id", "", "app id filter")
	subjectUserID := fs.String("subject-user-id", "", "subject user id filter")
	filterCallerKindRaw := fs.String("filter-caller-kind", "", "caller kind filter: desktop-core|desktop-mod|third-party-app|third-party-service")
	filterCallerID := fs.String("filter-caller-id", "", "caller id filter")
	capability := fs.String("capability", "", "capability filter")
	modelID := fs.String("model-id", "", "model id filter")
	windowRaw := fs.String("window", "hour", "usage window: minute|hour|day")
	fromTimeRaw := fs.String("from-time", "", "from time (RFC3339)")
	toTimeRaw := fs.String("to-time", "", "to time (RFC3339)")
	pageSize := fs.Int("page-size", 50, "page size")
	pageToken := fs.String("page-token", "", "page token")
	jsonOutput := fs.Bool("json", false, "output json")
	callerKind := fs.String("caller-kind", "third-party-service", "caller kind metadata")
	callerID := fs.String("caller-id", "nimi-cli", "caller id metadata")
	surfaceID := fs.String("surface-id", "runtime-cli", "surface id metadata")
	traceID := fs.String("trace-id", "", "trace id metadata")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *pageSize <= 0 {
		return fmt.Errorf("page-size must be > 0")
	}

	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	filterCallerKind, err := parseCallerKindFilter(*filterCallerKindRaw)
	if err != nil {
		return err
	}
	window, err := parseUsageWindow(*windowRaw)
	if err != nil {
		return err
	}
	fromTime, err := parseOptionalTimestamp(*fromTimeRaw)
	if err != nil {
		return err
	}
	toTime, err := parseOptionalTimestamp(*toTimeRaw)
	if err != nil {
		return err
	}

	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	resp, err := entrypoint.ListUsageStatsGRPC(*grpcAddr, timeout, &runtimev1.ListUsageStatsRequest{
		AppId:         strings.TrimSpace(*appID),
		SubjectUserId: strings.TrimSpace(*subjectUserID),
		CallerKind:    filterCallerKind,
		CallerId:      strings.TrimSpace(*filterCallerID),
		Capability:    strings.TrimSpace(*capability),
		ModelId:       strings.TrimSpace(*modelID),
		Window:        window,
		FromTime:      fromTime,
		ToTime:        toTime,
		PageSize:      int32(*pageSize),
		PageToken:     strings.TrimSpace(*pageToken),
	}, callerMeta)
	if err != nil {
		return err
	}

	records := make([]map[string]any, 0, len(resp.GetRecords()))
	for _, record := range resp.GetRecords() {
		bucketStart := ""
		if ts := record.GetBucketStart(); ts != nil {
			bucketStart = ts.AsTime().UTC().Format(time.RFC3339Nano)
		}
		records = append(records, map[string]any{
			"app_id":          record.GetAppId(),
			"subject_user_id": record.GetSubjectUserId(),
			"caller_kind":     record.GetCallerKind().String(),
			"caller_id":       record.GetCallerId(),
			"capability":      record.GetCapability(),
			"model_id":        record.GetModelId(),
			"window":          record.GetWindow().String(),
			"bucket_start":    bucketStart,
			"request_count":   record.GetRequestCount(),
			"success_count":   record.GetSuccessCount(),
			"error_count":     record.GetErrorCount(),
			"input_tokens":    record.GetInputTokens(),
			"output_tokens":   record.GetOutputTokens(),
			"compute_ms":      record.GetComputeMs(),
			"queue_wait_ms":   record.GetQueueWaitMs(),
		})
	}

	if *jsonOutput {
		out, err := json.MarshalIndent(map[string]any{
			"records":         records,
			"next_page_token": resp.GetNextPageToken(),
		}, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}

	fmt.Printf("records=%d next_page_token=%s\n", len(records), resp.GetNextPageToken())
	for _, record := range records {
		fmt.Printf("  bucket=%s capability=%s model=%s request=%v success=%v error=%v\n",
			record["bucket_start"],
			record["capability"],
			record["model_id"],
			record["request_count"],
			record["success_count"],
			record["error_count"],
		)
	}
	return nil
}

func runRuntimeAuditExport(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi audit export", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "10s", "grpc request timeout")
	appID := fs.String("app-id", "", "app id filter")
	subjectUserID := fs.String("subject-user-id", "", "subject user id filter")
	format := fs.String("format", "ndjson", "export format")
	fromTimeRaw := fs.String("from-time", "", "from time (RFC3339)")
	toTimeRaw := fs.String("to-time", "", "to time (RFC3339)")
	compress := fs.Bool("compress", false, "compress export payload")
	output := fs.String("output", "", "output file path (optional)")
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

	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	fromTime, err := parseOptionalTimestamp(*fromTimeRaw)
	if err != nil {
		return err
	}
	toTime, err := parseOptionalTimestamp(*toTimeRaw)
	if err != nil {
		return err
	}

	callerMeta := runtimeAICallerMetadataFromFlags(*callerKind, *callerID, *surfaceID, *traceID)
	callerMeta.AccessTokenID = strings.TrimSpace(*accessTokenID)
	callerMeta.AccessTokenSecret = strings.TrimSpace(*accessTokenSecret)
	resp, err := entrypoint.ExportAuditEventsGRPC(*grpcAddr, timeout, &runtimev1.ExportAuditEventsRequest{
		AppId:         strings.TrimSpace(*appID),
		SubjectUserId: strings.TrimSpace(*subjectUserID),
		Format:        strings.TrimSpace(*format),
		FromTime:      fromTime,
		ToTime:        toTime,
		Compress:      *compress,
	}, callerMeta)
	if err != nil {
		return err
	}

	outputPath := strings.TrimSpace(*output)
	if outputPath != "" {
		if err := os.WriteFile(outputPath, resp.Payload, 0o600); err != nil {
			return fmt.Errorf("write output file %s: %w", outputPath, err)
		}
	}

	if *jsonOutput {
		payload := map[string]any{
			"export_id":    resp.ExportID,
			"mime_type":    resp.MimeType,
			"bytes_length": len(resp.Payload),
		}
		if outputPath != "" {
			payload["output"] = outputPath
		} else {
			payload["payload_base64"] = base64.StdEncoding.EncodeToString(resp.Payload)
		}
		out, err := json.MarshalIndent(payload, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}

	if outputPath != "" {
		fmt.Printf("export_id=%s mime_type=%s bytes=%d output=%s\n", resp.ExportID, resp.MimeType, len(resp.Payload), outputPath)
		return nil
	}
	fmt.Print(string(resp.Payload))
	return nil
}
