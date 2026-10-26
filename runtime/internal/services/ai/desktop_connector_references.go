package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aiconfig"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedprincipal"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type connectorReferenceCursor struct {
	Revision string `json:"revision"`
	Offset   int    `json:"offset"`
}

// @nimi-authority: rule.nimi.runtime.security-core.home-connector-reference-index
func (s *Service) ListDesktopConnectorReferences(ctx context.Context, req *runtimev1.ListDesktopConnectorReferencesRequest) (*runtimev1.ListDesktopConnectorReferencesResponse, error) {
	principal, ok := protectedprincipal.FromContext(ctx)
	if !ok || !principal.IsDesktopAccountProduct() || principal.AccountID == "" {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	if req.GetConnectorRef() == "" || len(req.GetConnectorRef()) > 512 || strings.TrimSpace(req.GetConnectorRef()) != req.GetConnectorRef() || req.GetPageSize() < 0 {
		return nil, status.Error(codes.InvalidArgument, "invalid connection reference query")
	}
	reader, ok := s.aiConfigStore.(aiconfig.ConnectorReferenceReader)
	if !ok {
		return nil, status.Error(codes.Unavailable, "configuration reference owner unavailable")
	}
	snapshot, err := reader.ConnectorReferences(ctx, principal.AccountID, req.GetConnectorRef())
	if err != nil {
		return nil, status.Error(codes.Unavailable, "configuration references could not be read")
	}
	if err := ctx.Err(); err != nil {
		return nil, status.FromContextError(err).Err()
	}
	var cursor connectorReferenceCursor
	if req.GetPageToken() != "" {
		if len(req.GetPageToken()) > 1024 {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PAGE_TOKEN_INVALID)
		}
		raw, err := base64.RawURLEncoding.DecodeString(req.GetPageToken())
		if err != nil || json.Unmarshal(raw, &cursor) != nil || cursor.Revision != snapshot.Revision || cursor.Offset <= 0 || cursor.Offset >= len(snapshot.References) {
			return nil, grpcerr.WithReasonCode(codes.Aborted, runtimev1.ReasonCode_PAGE_TOKEN_INVALID)
		}
	}
	size := int(req.GetPageSize())
	if size == 0 {
		size = 50
	}
	if size > 200 {
		size = 200
	}
	end := min(cursor.Offset+size, len(snapshot.References))
	response := &runtimev1.ListDesktopConnectorReferencesResponse{References: snapshot.References[cursor.Offset:end], SnapshotRevision: snapshot.Revision, ObservedAt: timestamppb.New(time.Now().UTC())}
	if end < len(snapshot.References) {
		raw, _ := json.Marshal(connectorReferenceCursor{Revision: snapshot.Revision, Offset: end})
		response.NextPageToken = base64.RawURLEncoding.EncodeToString(raw)
	}
	// Account invalidation can precede the transport goroutine cancelling ctx.
	// Do not publish a completed read after its admitted account generation ends.
	if !principal.Valid() {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	return response, nil
}
