package entrypoint

import (
	"context"
	"errors"
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"io"
	"strings"
)

func StreamGenerateTextGRPC(ctx context.Context, grpcAddr string, req *runtimev1.StreamGenerateRequest, metadataOverride ...*ClientMetadata) (<-chan *runtimev1.StreamGenerateEvent, <-chan error, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, nil, errors.New("stream generate request is required")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	ctx = withNimiOutgoingMetadata(ctx, req.GetAppId(), firstMetadataOverride(metadataOverride...))

	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, nil, fmt.Errorf("dial grpc %s: %w", addr, err)
	}

	client := runtimev1.NewRuntimeAiServiceClient(conn)
	stream, err := client.StreamGenerate(ctx, req)
	if err != nil {
		conn.Close()
		return nil, nil, fmt.Errorf("runtime ai stream generate: %w", err)
	}

	events := make(chan *runtimev1.StreamGenerateEvent, 64)
	errCh := make(chan error, 1)
	go func() {
		defer close(events)
		defer close(errCh)
		defer conn.Close()

		for {
			event, recvErr := stream.Recv()
			if recvErr != nil {
				if errors.Is(recvErr, io.EOF) || status.Code(recvErr) == codes.Canceled || ctx.Err() != nil {
					return
				}
				errCh <- fmt.Errorf("recv ai stream event: %w", recvErr)
				return
			}
			select {
			case <-ctx.Done():
				return
			case events <- event:
			}
		}
	}()

	return events, errCh, nil
}

func withNimiOutgoingMetadata(ctx context.Context, appID string, metadataOverride *ClientMetadata) context.Context {
	appID = strings.TrimSpace(appID)
	metadataValue := defaultClientMetadata()
	if metadataOverride != nil {
		if value := strings.TrimSpace(metadataOverride.CallerKind); value != "" {
			metadataValue.CallerKind = value
		}
		if value := strings.TrimSpace(metadataOverride.CallerID); value != "" {
			metadataValue.CallerID = value
		}
		if value := strings.TrimSpace(metadataOverride.SurfaceID); value != "" {
			metadataValue.SurfaceID = value
		}
		if value := strings.TrimSpace(metadataOverride.TraceID); value != "" {
			metadataValue.TraceID = value
		}
		if value := strings.TrimSpace(metadataOverride.ProtocolVersion); value != "" {
			metadataValue.ProtocolVersion = value
		}
		if value := strings.TrimSpace(metadataOverride.ParticipantProtocolVersion); value != "" {
			metadataValue.ParticipantProtocolVersion = value
		}
		if value := strings.TrimSpace(metadataOverride.ParticipantID); value != "" {
			metadataValue.ParticipantID = value
		}
		if value := strings.TrimSpace(metadataOverride.Domain); value != "" {
			metadataValue.Domain = value
		}
		if value := strings.TrimSpace(metadataOverride.IdempotencyKey); value != "" {
			metadataValue.IdempotencyKey = value
		}
		if value := strings.TrimSpace(metadataOverride.AccessTokenID); value != "" {
			metadataValue.AccessTokenID = value
		}
		if value := strings.TrimSpace(metadataOverride.AccessTokenSecret); value != "" {
			metadataValue.AccessTokenSecret = value
		}
	}
	if metadataValue.IdempotencyKey == "" {
		metadataValue.IdempotencyKey = ulid.Make().String()
	}
	pairs := []string{
		"x-nimi-protocol-version", metadataValue.ProtocolVersion,
		"x-nimi-participant-protocol-version", metadataValue.ParticipantProtocolVersion,
		"x-nimi-participant-id", metadataValue.ParticipantID,
		"x-nimi-domain", metadataValue.Domain,
		"x-nimi-idempotency-key", metadataValue.IdempotencyKey,
		"x-nimi-caller-kind", metadataValue.CallerKind,
		"x-nimi-caller-id", metadataValue.CallerID,
		"x-nimi-surface-id", metadataValue.SurfaceID,
	}
	if metadataValue.TraceID != "" {
		pairs = append(pairs, "x-nimi-trace-id", metadataValue.TraceID)
	}
	if appID != "" {
		pairs = append(pairs, "x-nimi-app-id", appID)
	}
	if tokenID := strings.TrimSpace(metadataValue.AccessTokenID); tokenID != "" {
		pairs = append(pairs, "x-nimi-access-token-id", tokenID)
	}
	if secret := strings.TrimSpace(metadataValue.AccessTokenSecret); secret != "" {
		pairs = append(pairs, "x-nimi-access-token-secret", secret)
	}
	return metadata.AppendToOutgoingContext(ctx, pairs...)
}

func firstMetadataOverride(values ...*ClientMetadata) *ClientMetadata {
	if len(values) == 0 {
		return nil
	}
	return values[0]
}

func defaultClientMetadata() ClientMetadata {
	return ClientMetadata{
		ProtocolVersion:            envelope.PlatformProtocolVersion,
		ParticipantProtocolVersion: envelope.PlatformProtocolVersion,
		ParticipantID:              "nimi-cli",
		Domain:                     "runtime.rpc",
		IdempotencyKey:             "",
		CallerKind:                 cliCallerKind,
		CallerID:                   cliCallerID,
		SurfaceID:                  cliSurfaceID,
		TraceID:                    "",
	}
}

type artifactChunkReceiver interface {
	Recv() (*runtimev1.ArtifactChunk, error)
}

type auditExportChunkReceiver interface {
	Recv() (*runtimev1.AuditExportChunk, error)
}

func collectArtifactStream(stream artifactChunkReceiver) (*ArtifactResult, error) {
	result := &ArtifactResult{
		Usage:   &runtimev1.UsageStats{},
		Payload: make([]byte, 0, 1024),
	}
	seen := false
	for {
		chunk, err := stream.Recv()
		if err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			return nil, fmt.Errorf("recv artifact chunk: %w", err)
		}
		if chunk == nil {
			continue
		}
		seen = true
		if result.ArtifactID == "" {
			result.ArtifactID = strings.TrimSpace(chunk.GetArtifactId())
		}
		if result.MimeType == "" {
			result.MimeType = strings.TrimSpace(chunk.GetMimeType())
		}
		if result.RouteDecision == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
			result.RouteDecision = chunk.GetRouteDecision()
		}
		if result.ModelResolved == "" {
			result.ModelResolved = strings.TrimSpace(chunk.GetModelResolved())
		}
		if result.TraceID == "" {
			result.TraceID = strings.TrimSpace(chunk.GetTraceId())
		}
		if usage := chunk.GetUsage(); usage != nil {
			result.Usage = &runtimev1.UsageStats{
				InputTokens:  usage.GetInputTokens(),
				OutputTokens: usage.GetOutputTokens(),
				ComputeMs:    usage.GetComputeMs(),
			}
		}
		if data := chunk.GetChunk(); len(data) > 0 {
			result.Payload = append(result.Payload, data...)
		}
	}
	if !seen {
		return nil, errors.New("artifact stream returned no chunks")
	}
	return result, nil
}

func collectAuditExportStream(stream auditExportChunkReceiver) (*AuditExportResult, error) {
	result := &AuditExportResult{
		Payload: make([]byte, 0, 2048),
	}
	seen := false
	for {
		chunk, err := stream.Recv()
		if err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			return nil, fmt.Errorf("recv audit export chunk: %w", err)
		}
		if chunk == nil {
			continue
		}
		seen = true
		if result.ExportID == "" {
			result.ExportID = strings.TrimSpace(chunk.GetExportId())
		}
		if result.MimeType == "" {
			result.MimeType = strings.TrimSpace(chunk.GetMimeType())
		}
		if data := chunk.GetChunk(); len(data) > 0 {
			result.Payload = append(result.Payload, data...)
		}
	}
	if !seen {
		return nil, errors.New("audit export stream returned no chunks")
	}
	return result, nil
}
