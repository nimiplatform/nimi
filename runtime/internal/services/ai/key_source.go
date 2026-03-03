package ai

import (
	"context"
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/endpointsec"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
)

const (
	metadataKeySourceKey        = "x-nimi-key-source"        // "inline" | "managed"
	metadataProviderTypeKey     = "x-nimi-provider-type"     // provider name
	metadataProviderEndpointKey = "x-nimi-provider-endpoint" // endpoint URL
	metadataProviderAPIKeyKey   = "x-nimi-provider-api-key"  // API key
	metadataAppIDKey            = "x-nimi-app-id"            // app_id for management RPCs

	keySourceInline  = "inline"
	keySourceManaged = "managed"
)

// ParsedKeySource holds the extracted key-source fields from request body + gRPC metadata.
type ParsedKeySource struct {
	KeySource    string // "inline", "managed", or ""
	ConnectorID  string // from request body
	ProviderType string // from metadata
	Endpoint     string // from metadata
	APIKey       string // from metadata
	AppID        string // from metadata
}

// parseKeySource extracts key-source fields from gRPC metadata and request body (K-KEYSRC-004 step 1).
func parseKeySource(ctx context.Context, connectorID string) ParsedKeySource {
	parsed := ParsedKeySource{
		ConnectorID: strings.TrimSpace(connectorID),
	}
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return parsed
	}
	parsed.KeySource = strings.ToLower(firstMDValue(md, metadataKeySourceKey))
	parsed.ProviderType = firstMDValue(md, metadataProviderTypeKey)
	parsed.Endpoint = firstMDValue(md, metadataProviderEndpointKey)
	parsed.APIKey = firstMDValue(md, metadataProviderAPIKeyKey)
	parsed.AppID = firstMDValue(md, metadataAppIDKey)
	return parsed
}

// validateKeySource performs mutual exclusion and completeness checks (K-KEYSRC-004 steps 3-4).
func validateKeySource(parsed ParsedKeySource, requestAppID string) error {
	ks := parsed.KeySource
	bodyAppID := strings.TrimSpace(requestAppID)
	metadataAppID := strings.TrimSpace(parsed.AppID)

	keySourceUsed := ks != "" || parsed.ConnectorID != "" || parsed.ProviderType != "" || parsed.Endpoint != "" || parsed.APIKey != "" || metadataAppID != ""
	if keySourceUsed && bodyAppID == "" {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_APP_ID_REQUIRED)
	}
	if metadataAppID != "" && bodyAppID != "" && metadataAppID != bodyAppID {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_APP_ID_CONFLICT)
	}

	// Conflict: connector_id + inline fields simultaneously
	if parsed.ConnectorID != "" && (parsed.APIKey != "" || parsed.ProviderType != "" || parsed.Endpoint != "") {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_REQUEST_CREDENTIAL_CONFLICT)
	}

	switch ks {
	case keySourceManaged:
		if parsed.ConnectorID == "" {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_ID_REQUIRED)
		}
	case keySourceInline:
		if parsed.ProviderType == "" {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_REQUEST_CREDENTIAL_MISSING)
		}
		if parsed.APIKey == "" {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_REQUEST_CREDENTIAL_MISSING)
		}
		// Check if provider requires explicit endpoint
		if entry, ok := connector.ProviderCatalog[parsed.ProviderType]; ok && entry.RequiresExplicitEndpoint && parsed.Endpoint == "" {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_REQUEST_CREDENTIAL_MISSING)
		}
	case "":
		// No explicit key-source: infer from presence of fields
		if parsed.ConnectorID != "" {
			// Implicit managed
			break
		}
		if parsed.ProviderType != "" || parsed.Endpoint != "" || parsed.APIKey != "" {
			// Implicit inline — fail-close and validate completeness.
			if parsed.ProviderType == "" {
				return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_REQUEST_CREDENTIAL_MISSING)
			}
			if parsed.APIKey == "" {
				return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_REQUEST_CREDENTIAL_MISSING)
			}
			if entry, ok := connector.ProviderCatalog[parsed.ProviderType]; ok && entry.RequiresExplicitEndpoint && parsed.Endpoint == "" {
				return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_REQUEST_CREDENTIAL_MISSING)
			}
		}
		// No key-source, no connector_id, no inline fields = use runtime config
	default:
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_REQUEST_CREDENTIAL_INVALID)
	}

	return nil
}

// resolveKeySourceToTarget resolves parsed key-source into a RemoteTarget (K-KEYSRC-004 steps 5-8).
// Returns nil if routing should use runtime config (local/cloud defaults).
func resolveKeySourceToTarget(ctx context.Context, parsed ParsedKeySource, connStore *connector.ConnectorStore, allowLoopback bool) (*nimillm.RemoteTarget, error) {
	ks := parsed.KeySource

	// Determine effective mode
	isManaged := ks == keySourceManaged || (ks == "" && parsed.ConnectorID != "")
	isInline := ks == keySourceInline || (ks == "" && parsed.APIKey != "" && parsed.ConnectorID == "")

	if isManaged {
		return resolveManagedTarget(ctx, parsed.ConnectorID, connStore, allowLoopback)
	}
	if isInline {
		return resolveInlineTarget(parsed, allowLoopback)
	}

	// No key-source specified, no connector_id, no inline fields → runtime config
	return nil, nil
}

func resolveManagedTarget(ctx context.Context, connectorID string, connStore *connector.ConnectorStore, allowLoopback bool) (*nimillm.RemoteTarget, error) {
	if connStore == nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}

	rec, found, err := connStore.Get(connectorID)
	if err != nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
			ActionHint: "retry_or_check_runtime_logs",
		})
	}
	if !found {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
	}

	// Owner -> status -> credential order to avoid side-channel leakage for managed connectors.
	if rec.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED &&
		rec.OwnerType == runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER {
		identity := authn.IdentityFromContext(ctx)
		subjectUserID := ""
		if identity != nil {
			subjectUserID = strings.TrimSpace(identity.SubjectUserID)
		}
		if subjectUserID == "" || rec.OwnerID != subjectUserID {
			return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
		}
	}

	if rec.Status == runtimev1.ConnectorStatus_CONNECTOR_STATUS_DISABLED {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_DISABLED)
	}

	apiKey, err := connStore.LoadCredential(connectorID)
	if err != nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
			ActionHint: "retry_or_check_runtime_logs",
		})
	}
	if apiKey == "" {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING)
	}

	endpoint := rec.Endpoint
	if endpoint == "" {
		endpoint = connector.ResolveEndpoint(rec.Provider, "")
	}

	// Endpoint security validation (K-SEC-004)
	isLocal := rec.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_LOCAL_MODEL
	allowLoopbackTarget := allowLoopback || isLocal
	if err := endpointsec.ValidateEndpoint(endpoint, allowLoopbackTarget); err != nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN)
	}

	return &nimillm.RemoteTarget{
		ProviderType:  rec.Provider,
		Endpoint:      endpoint,
		APIKey:        apiKey,
		AllowLoopback: allowLoopbackTarget,
	}, nil
}

func resolveInlineTarget(parsed ParsedKeySource, allowLoopback bool) (*nimillm.RemoteTarget, error) {
	endpoint := parsed.Endpoint
	if endpoint == "" {
		endpoint = connector.ResolveEndpoint(parsed.ProviderType, "")
	}

	// Endpoint security validation (K-SEC-004)
	if err := endpointsec.ValidateEndpoint(endpoint, allowLoopback); err != nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN)
	}

	return &nimillm.RemoteTarget{
		ProviderType:  parsed.ProviderType,
		Endpoint:      endpoint,
		APIKey:        parsed.APIKey,
		AllowLoopback: allowLoopback,
	}, nil
}

func firstMDValue(md metadata.MD, key string) string {
	values := md.Get(strings.ToLower(strings.TrimSpace(key)))
	if len(values) == 0 {
		return ""
	}
	return strings.TrimSpace(values[0])
}
