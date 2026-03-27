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
	"net"
	"net/url"
	"strings"
)

func StreamScenarioGRPC(ctx context.Context, grpcAddr string, req *runtimev1.StreamScenarioRequest, metadataOverride ...*ClientMetadata) (<-chan *runtimev1.StreamScenarioEvent, <-chan error, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, nil, errors.New("stream scenario request is required")
	}
	if req.GetHead() == nil {
		return nil, nil, errors.New("stream scenario request head is required")
	}
	if strings.TrimSpace(req.GetHead().GetAppId()) == "" {
		return nil, nil, errors.New("app_id is required")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	preparedCtx, err := prepareInsecureOutgoingContext(ctx, addr, req.GetHead().GetAppId(), firstMetadataOverride(metadataOverride...))
	if err != nil {
		return nil, nil, err
	}
	ctx = preparedCtx

	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, nil, fmt.Errorf("dial grpc %s: %w", addr, err)
	}

	client := runtimev1.NewRuntimeAiServiceClient(conn)
	stream, err := client.StreamScenario(ctx, req)
	if err != nil {
		conn.Close()
		return nil, nil, fmt.Errorf("runtime ai stream scenario: %w", err)
	}

	events := make(chan *runtimev1.StreamScenarioEvent, 64)
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
	applyClientMetadataOverrides(&metadataValue, metadataOverride)
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
	if source := strings.ToLower(strings.TrimSpace(metadataValue.CredentialSource)); source != "" {
		pairs = append(pairs, "x-nimi-key-source", source)
	}
	if providerType := strings.TrimSpace(metadataValue.ProviderType); providerType != "" {
		pairs = append(pairs, "x-nimi-provider-type", providerType)
	}
	if endpoint := strings.TrimSpace(metadataValue.ProviderEndpoint); endpoint != "" {
		pairs = append(pairs, "x-nimi-provider-endpoint", endpoint)
	}
	if apiKey := strings.TrimSpace(metadataValue.ProviderAPIKey); apiKey != "" {
		pairs = append(pairs, "x-nimi-provider-api-key", apiKey)
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
	if sessionID := strings.TrimSpace(metadataValue.SessionID); sessionID != "" {
		pairs = append(pairs, "x-nimi-session-id", sessionID)
	}
	if sessionToken := strings.TrimSpace(metadataValue.SessionToken); sessionToken != "" {
		pairs = append(pairs, "x-nimi-session-token", sessionToken)
	}
	return metadata.AppendToOutgoingContext(ctx, pairs...)
}

type clientMetadataOverrideField struct {
	value string
	set   func(string)
}

func applyClientMetadataOverrides(dst *ClientMetadata, override *ClientMetadata) {
	if dst == nil || override == nil {
		return
	}
	fields := []clientMetadataOverrideField{
		{value: strings.TrimSpace(override.ProtocolVersion), set: func(value string) { dst.ProtocolVersion = value }},
		{value: strings.TrimSpace(override.ParticipantProtocolVersion), set: func(value string) { dst.ParticipantProtocolVersion = value }},
		{value: strings.TrimSpace(override.ParticipantID), set: func(value string) { dst.ParticipantID = value }},
		{value: strings.TrimSpace(override.Domain), set: func(value string) { dst.Domain = value }},
		{value: strings.TrimSpace(override.IdempotencyKey), set: func(value string) { dst.IdempotencyKey = value }},
		{value: strings.TrimSpace(override.CallerKind), set: func(value string) { dst.CallerKind = value }},
		{value: strings.TrimSpace(override.CallerID), set: func(value string) { dst.CallerID = value }},
		{value: strings.TrimSpace(override.SurfaceID), set: func(value string) { dst.SurfaceID = value }},
		{value: strings.TrimSpace(override.TraceID), set: func(value string) { dst.TraceID = value }},
		{value: strings.ToLower(strings.TrimSpace(override.CredentialSource)), set: func(value string) { dst.CredentialSource = value }},
		{value: strings.TrimSpace(override.ProviderType), set: func(value string) { dst.ProviderType = value }},
		{value: strings.TrimSpace(override.ProviderEndpoint), set: func(value string) { dst.ProviderEndpoint = value }},
		{value: strings.TrimSpace(override.ProviderAPIKey), set: func(value string) { dst.ProviderAPIKey = value }},
		{value: strings.TrimSpace(override.AccessTokenID), set: func(value string) { dst.AccessTokenID = value }},
		{value: strings.TrimSpace(override.AccessTokenSecret), set: func(value string) { dst.AccessTokenSecret = value }},
		{value: strings.TrimSpace(override.SessionID), set: func(value string) { dst.SessionID = value }},
		{value: strings.TrimSpace(override.SessionToken), set: func(value string) { dst.SessionToken = value }},
	}
	for _, field := range fields {
		if field.value != "" {
			field.set(field.value)
		}
	}
}

func prepareInsecureOutgoingContext(
	ctx context.Context,
	grpcAddr string,
	appID string,
	metadataOverride *ClientMetadata,
) (context.Context, error) {
	if err := validateInsecureTransportMetadata(grpcAddr, metadataOverride); err != nil {
		return nil, err
	}
	if ctx == nil {
		ctx = context.Background()
	}
	return withNimiOutgoingMetadata(ctx, appID, metadataOverride), nil
}

func validateInsecureTransportMetadata(grpcAddr string, metadataOverride *ClientMetadata) error {
	if metadataOverride == nil || strings.TrimSpace(metadataOverride.ProviderAPIKey) == "" {
		return nil
	}
	if insecureGRPCTargetIsLocal(grpcAddr) {
		return nil
	}
	return errors.New("provider_api_key requires loopback or unix gRPC target when using insecure transport")
}

func insecureGRPCTargetIsLocal(grpcAddr string) bool {
	target := strings.TrimSpace(grpcAddr)
	if target == "" {
		return false
	}
	if strings.HasPrefix(target, "unix:") {
		return true
	}
	if strings.Contains(target, "://") {
		parsed, err := url.Parse(target)
		if err == nil && parsed.Scheme != "" {
			switch parsed.Scheme {
			case "unix", "unix-abstract":
				return true
			}
			switch {
			case strings.TrimSpace(parsed.Host) != "":
				target = parsed.Host
			case strings.TrimSpace(parsed.Opaque) != "":
				target = parsed.Opaque
			case strings.TrimSpace(parsed.Path) != "":
				target = strings.TrimPrefix(parsed.Path, "/")
			}
		}
	}
	target = strings.TrimPrefix(target, "/")
	if slash := strings.Index(target, "/"); slash >= 0 {
		target = target[:slash]
	}
	host := target
	if parsedHost, _, err := net.SplitHostPort(target); err == nil {
		host = parsedHost
	}
	host = strings.Trim(strings.TrimSpace(host), "[]")
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// WithNimiOutgoingMetadata applies the standard runtime protocol envelope onto
// an outgoing gRPC context for CLI and replay callers outside this package.
func WithNimiOutgoingMetadata(ctx context.Context, appID string, metadataOverride *ClientMetadata) context.Context {
	return withNimiOutgoingMetadata(ctx, appID, metadataOverride)
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
		CredentialSource:           "",
		ProviderType:               "",
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
