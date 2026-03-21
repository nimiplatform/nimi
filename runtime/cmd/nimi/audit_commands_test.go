package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"sync"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestRunRuntimeAuditEventsJSON(t *testing.T) {
	service := &cmdTestRuntimeAuditService{
		listEventsResponse: &runtimev1.ListAuditEventsResponse{
			Events: []*runtimev1.AuditEventRecord{
				{
					AuditId:    "audit-1",
					AppId:      "nimi.desktop",
					Domain:     "runtime.ai",
					Operation:  "generate",
					ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
					TraceId:    "trace-1",
					Timestamp:  timestamppb.Now(),
				},
			},
		},
	}
	addr, shutdown := startCmdTestRuntimeAuditServer(t, service)
	defer shutdown()

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeAudit([]string{
			"events",
			"--grpc-addr", addr,
			"--app-id", "nimi.desktop",
			"--page-size", "20",
			"--json",
			"--caller-id", "cli:audit-events",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeAudit events: %v", err)
	}

	var payload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(output), &payload); unmarshalErr != nil {
		t.Fatalf("unmarshal events output: %v output=%q", unmarshalErr, output)
	}
	events, ok := payload["events"].([]any)
	if !ok || len(events) != 1 {
		t.Fatalf("events mismatch: %#v", payload["events"])
	}
	md := service.lastEventsMetadata()
	if got := firstMD(md, "x-nimi-caller-id"); got != "cli:audit-events" {
		t.Fatalf("caller-id mismatch: %q", got)
	}
}

func TestRunRuntimeAuditUsageJSON(t *testing.T) {
	service := &cmdTestRuntimeAuditService{
		listUsageResponse: &runtimev1.ListUsageStatsResponse{
			Records: []*runtimev1.UsageStatRecord{
				{
					AppId:        "nimi.desktop",
					Capability:   "runtime.ai.generate",
					RequestCount: 1,
					SuccessCount: 1,
					ErrorCount:   0,
					Window:       runtimev1.UsageWindow_USAGE_WINDOW_HOUR,
					BucketStart:  timestamppb.Now(),
				},
			},
		},
	}
	addr, shutdown := startCmdTestRuntimeAuditServer(t, service)
	defer shutdown()

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeAudit([]string{
			"usage",
			"--grpc-addr", addr,
			"--app-id", "nimi.desktop",
			"--window", "hour",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeAudit usage: %v", err)
	}

	var payload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(output), &payload); unmarshalErr != nil {
		t.Fatalf("unmarshal usage output: %v output=%q", unmarshalErr, output)
	}
	records, ok := payload["records"].([]any)
	if !ok || len(records) != 1 {
		t.Fatalf("records mismatch: %#v", payload["records"])
	}
}

func TestRunRuntimeAuditExportJSON(t *testing.T) {
	service := &cmdTestRuntimeAuditService{
		exportChunks: []*runtimev1.AuditExportChunk{
			{
				ExportId: "export-1",
				Sequence: 1,
				Chunk:    []byte("{\"line\":1}\n"),
				MimeType: "application/x-ndjson",
			},
			{
				ExportId: "export-1",
				Sequence: 2,
				Chunk:    []byte("{\"line\":2}\n"),
				Eof:      true,
				MimeType: "application/x-ndjson",
			},
		},
	}
	addr, shutdown := startCmdTestRuntimeAuditServer(t, service)
	defer shutdown()

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeAudit([]string{
			"export",
			"--grpc-addr", addr,
			"--format", "ndjson",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeAudit export: %v", err)
	}

	var payload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(output), &payload); unmarshalErr != nil {
		t.Fatalf("unmarshal export output: %v output=%q", unmarshalErr, output)
	}
	if asString(payload["export_id"]) != "export-1" {
		t.Fatalf("export id mismatch: %v", payload["export_id"])
	}
	encoded := asString(payload["payload_base64"])
	decoded, decodeErr := base64.StdEncoding.DecodeString(encoded)
	if decodeErr != nil {
		t.Fatalf("decode payload_base64: %v", decodeErr)
	}
	if string(decoded) != "{\"line\":1}\n{\"line\":2}\n" {
		t.Fatalf("export payload mismatch: %q", string(decoded))
	}
}

func TestRunRuntimeAuditExportWritesSecureOutputFile(t *testing.T) {
	service := &cmdTestRuntimeAuditService{
		exportChunks: []*runtimev1.AuditExportChunk{
			{
				ExportId: "export-1",
				Sequence: 1,
				Chunk:    []byte("{\"line\":1}\n"),
				Eof:      true,
				MimeType: "application/x-ndjson",
			},
		},
	}
	addr, shutdown := startCmdTestRuntimeAuditServer(t, service)
	defer shutdown()

	outputPath := filepath.Join(t.TempDir(), "audit.ndjson")
	if err := runRuntimeAudit([]string{
		"export",
		"--grpc-addr", addr,
		"--format", "ndjson",
		"--output", outputPath,
	}); err != nil {
		t.Fatalf("runRuntimeAudit export: %v", err)
	}

	info, err := os.Stat(outputPath)
	if err != nil {
		t.Fatalf("stat export output: %v", err)
	}
	if perms := info.Mode().Perm(); perms != 0o600 {
		t.Fatalf("output permissions mismatch: got=%o want=600", perms)
	}
}

func startCmdTestRuntimeAuditServer(t *testing.T, service runtimev1.RuntimeAuditServiceServer) (string, func()) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	server := grpc.NewServer()
	runtimev1.RegisterRuntimeAuditServiceServer(server, service)
	go func() {
		_ = server.Serve(listener)
	}()
	return listener.Addr().String(), func() {
		server.Stop()
		_ = listener.Close()
	}
}

type cmdTestRuntimeAuditService struct {
	runtimev1.UnimplementedRuntimeAuditServiceServer

	mu sync.Mutex

	eventsMD metadata.MD

	listEventsResponse *runtimev1.ListAuditEventsResponse
	listUsageResponse  *runtimev1.ListUsageStatsResponse
	exportChunks       []*runtimev1.AuditExportChunk
}

func (s *cmdTestRuntimeAuditService) ListAuditEvents(ctx context.Context, _ *runtimev1.ListAuditEventsRequest) (*runtimev1.ListAuditEventsResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.eventsMD = cloneIncomingMetadata(ctx)
	if s.listEventsResponse != nil {
		return s.listEventsResponse, nil
	}
	return nil, errors.New("list events response not configured")
}

func (s *cmdTestRuntimeAuditService) ListUsageStats(context.Context, *runtimev1.ListUsageStatsRequest) (*runtimev1.ListUsageStatsResponse, error) {
	if s.listUsageResponse != nil {
		return s.listUsageResponse, nil
	}
	return nil, errors.New("list usage response not configured")
}

func (s *cmdTestRuntimeAuditService) ExportAuditEvents(_ *runtimev1.ExportAuditEventsRequest, stream grpc.ServerStreamingServer[runtimev1.AuditExportChunk]) error {
	for _, chunk := range s.exportChunks {
		if chunk == nil {
			continue
		}
		if err := stream.Send(chunk); err != nil {
			return err
		}
	}
	return nil
}

func (s *cmdTestRuntimeAuditService) lastEventsMetadata() metadata.MD {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.eventsMD.Copy()
}
