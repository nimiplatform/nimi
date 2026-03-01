package ai

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
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
func validateKeySource(parsed ParsedKeySource) error {
	ks := parsed.KeySource

	// Conflict: connector_id + inline fields simultaneously
	if parsed.ConnectorID != "" && (parsed.APIKey != "" || parsed.ProviderType != "" || parsed.Endpoint != "") {
		return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_REQUEST_CREDENTIAL_CONFLICT.String())
	}

	switch ks {
	case keySourceManaged:
		if parsed.ConnectorID == "" {
			return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_ID_REQUIRED.String())
		}
	case keySourceInline:
		if parsed.ProviderType == "" {
			return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_REQUEST_CREDENTIAL_MISSING.String())
		}
		if parsed.APIKey == "" {
			return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_REQUEST_CREDENTIAL_MISSING.String())
		}
		// Check if provider requires explicit endpoint
		if entry, ok := connector.ProviderCatalog[parsed.ProviderType]; ok && entry.RequiresExplicitEndpoint && parsed.Endpoint == "" {
			return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_REQUEST_CREDENTIAL_MISSING.String())
		}
	case "":
		// No explicit key-source: infer from presence of fields
		if parsed.ConnectorID != "" {
			// Implicit managed
			break
		}
		if parsed.APIKey != "" {
			// Implicit inline — validate completeness
			if parsed.ProviderType == "" {
				return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_REQUEST_CREDENTIAL_MISSING.String())
			}
			if entry, ok := connector.ProviderCatalog[parsed.ProviderType]; ok && entry.RequiresExplicitEndpoint && parsed.Endpoint == "" {
				return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_REQUEST_CREDENTIAL_MISSING.String())
			}
		}
		// No key-source, no connector_id, no inline fields = use runtime config
	default:
		return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_REQUEST_CREDENTIAL_INVALID.String())
	}

	return nil
}

// resolveKeySourceToTarget resolves parsed key-source into a RemoteTarget (K-KEYSRC-004 steps 5-8).
// Returns nil if routing should use runtime config (local/cloud defaults).
func resolveKeySourceToTarget(parsed ParsedKeySource, connStore *connector.ConnectorStore) (*nimillm.RemoteTarget, error) {
	ks := parsed.KeySource

	// Determine effective mode
	isManaged := ks == keySourceManaged || (ks == "" && parsed.ConnectorID != "")
	isInline := ks == keySourceInline || (ks == "" && parsed.APIKey != "" && parsed.ConnectorID == "")

	if isManaged {
		return resolveManagedTarget(parsed.ConnectorID, connStore)
	}
	if isInline {
		return resolveInlineTarget(parsed)
	}

	// No key-source specified, no connector_id, no inline fields → runtime config
	return nil, nil
}

func resolveManagedTarget(connectorID string, connStore *connector.ConnectorStore) (*nimillm.RemoteTarget, error) {
	if connStore == nil {
		return nil, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}

	rec, found, err := connStore.Get(connectorID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "load connector: %v", err)
	}
	if !found {
		return nil, status.Error(codes.NotFound, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND.String())
	}
	if rec.Status == runtimev1.ConnectorStatus_CONNECTOR_STATUS_DISABLED {
		return nil, status.Error(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_DISABLED.String())
	}

	apiKey, err := connStore.LoadCredential(connectorID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "load credential: %v", err)
	}
	if apiKey == "" {
		return nil, status.Error(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING.String())
	}

	endpoint := rec.Endpoint
	if endpoint == "" {
		endpoint = connector.ResolveEndpoint(rec.Provider, "")
	}

	return &nimillm.RemoteTarget{
		ProviderType: rec.Provider,
		Endpoint:     endpoint,
		APIKey:       apiKey,
	}, nil
}

func resolveInlineTarget(parsed ParsedKeySource) (*nimillm.RemoteTarget, error) {
	endpoint := parsed.Endpoint
	if endpoint == "" {
		endpoint = connector.ResolveEndpoint(parsed.ProviderType, "")
	}

	return &nimillm.RemoteTarget{
		ProviderType: parsed.ProviderType,
		Endpoint:     endpoint,
		APIKey:       parsed.APIKey,
	}, nil
}

func firstMDValue(md metadata.MD, key string) string {
	values := md.Get(strings.ToLower(strings.TrimSpace(key)))
	if len(values) == 0 {
		return ""
	}
	return strings.TrimSpace(values[0])
}
