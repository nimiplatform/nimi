package entrypoint

import (
	"context"
	"errors"
	"net"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestListAuditEventsAndUsageStatsGRPC(t *testing.T) {
	service := &testRuntimeAuditService{
		listAuditResponse: &runtimev1.ListAuditEventsResponse{
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
			NextPageToken: "",
		},
		listUsageResponse: &runtimev1.ListUsageStatsResponse{
			Records: []*runtimev1.UsageStatRecord{
				{
					AppId:        "nimi.desktop",
					Capability:   "runtime.ai.generate",
					RequestCount: 1,
					SuccessCount: 1,
				},
			},
		},
	}
	addr, shutdown := startTestRuntimeAuditServer(t, service)
	defer shutdown()

	eventsResp, err := ListAuditEventsGRPC(addr, 3*time.Second, &runtimev1.ListAuditEventsRequest{
		AppId:    "nimi.desktop",
		PageSize: 20,
	}, &ClientMetadata{
		CallerID: "svc:audit-events",
		TraceID:  "trace-audit-events",
	})
	if err != nil {
		t.Fatalf("ListAuditEventsGRPC: %v", err)
	}
	if len(eventsResp.GetEvents()) != 1 {
		t.Fatalf("events count mismatch: %d", len(eventsResp.GetEvents()))
	}

	usageResp, err := ListUsageStatsGRPC(addr, 3*time.Second, &runtimev1.ListUsageStatsRequest{
		AppId:  "nimi.desktop",
		Window: runtimev1.UsageWindow_USAGE_WINDOW_HOUR,
	}, &ClientMetadata{
		CallerID: "svc:audit-usage",
	})
	if err != nil {
		t.Fatalf("ListUsageStatsGRPC: %v", err)
	}
	if len(usageResp.GetRecords()) != 1 {
		t.Fatalf("usage records count mismatch: %d", len(usageResp.GetRecords()))
	}

	md := service.lastListAuditMetadata()
	if got := firstMetadataValue(md, "x-nimi-caller-id"); got != "svc:audit-events" {
		t.Fatalf("caller-id mismatch: %q", got)
	}
	if got := firstMetadataValue(md, "x-nimi-app-id"); got != "nimi.desktop" {
		t.Fatalf("app-id mismatch: %q", got)
	}
}

func TestExportAuditEventsGRPCCollectsChunks(t *testing.T) {
	service := &testRuntimeAuditService{
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
	addr, shutdown := startTestRuntimeAuditServer(t, service)
	defer shutdown()

	resp, err := ExportAuditEventsGRPC(addr, 3*time.Second, &runtimev1.ExportAuditEventsRequest{
		AppId:  "nimi.desktop",
		Format: "ndjson",
	}, &ClientMetadata{
		CallerID: "svc:audit-export",
	})
	if err != nil {
		t.Fatalf("ExportAuditEventsGRPC: %v", err)
	}
	if resp.ExportID != "export-1" {
		t.Fatalf("export id mismatch: %s", resp.ExportID)
	}
	if string(resp.Payload) != "{\"line\":1}\n{\"line\":2}\n" {
		t.Fatalf("payload mismatch: %q", string(resp.Payload))
	}
}

func startTestRuntimeAuditServer(t *testing.T, service runtimev1.RuntimeAuditServiceServer) (string, func()) {
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

type testRuntimeAuditService struct {
	runtimev1.UnimplementedRuntimeAuditServiceServer

	mu sync.Mutex

	listAuditMD metadata.MD

	listAuditResponse *runtimev1.ListAuditEventsResponse
	listUsageResponse *runtimev1.ListUsageStatsResponse
	exportChunks      []*runtimev1.AuditExportChunk
}

func (s *testRuntimeAuditService) ListAuditEvents(ctx context.Context, _ *runtimev1.ListAuditEventsRequest) (*runtimev1.ListAuditEventsResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.listAuditMD = cloneMetadata(ctx)
	if s.listAuditResponse != nil {
		return s.listAuditResponse, nil
	}
	return nil, errors.New("list audit response not configured")
}

func (s *testRuntimeAuditService) ListUsageStats(context.Context, *runtimev1.ListUsageStatsRequest) (*runtimev1.ListUsageStatsResponse, error) {
	if s.listUsageResponse != nil {
		return s.listUsageResponse, nil
	}
	return nil, errors.New("list usage response not configured")
}

func (s *testRuntimeAuditService) ExportAuditEvents(_ *runtimev1.ExportAuditEventsRequest, stream grpc.ServerStreamingServer[runtimev1.AuditExportChunk]) error {
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

func (s *testRuntimeAuditService) lastListAuditMetadata() metadata.MD {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.listAuditMD.Copy()
}
