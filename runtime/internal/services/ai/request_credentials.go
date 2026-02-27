package ai

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

const (
	metadataCredentialSourceKey = "x-nimi-credential-source"
	metadataProviderEndpointKey = "x-nimi-provider-endpoint"
	metadataProviderAPIKeyKey   = "x-nimi-provider-api-key"

	credentialSourceRuntimeConfig   = "runtime-config"
	credentialSourceRequestInjected = "request-injected"
)

type requestCredentials struct {
	Source           string
	ProviderEndpoint string
	ProviderAPIKey   string
}

func firstMetadataValue(md metadata.MD, key string) string {
	values := md.Get(strings.ToLower(strings.TrimSpace(key)))
	if len(values) == 0 {
		return ""
	}
	return strings.TrimSpace(values[0])
}

func parseRequestCredentials(ctx context.Context) requestCredentials {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return requestCredentials{Source: credentialSourceRuntimeConfig}
	}
	return requestCredentials{
		Source:           strings.ToLower(firstMetadataValue(md, metadataCredentialSourceKey)),
		ProviderEndpoint: firstMetadataValue(md, metadataProviderEndpointKey),
		ProviderAPIKey:   firstMetadataValue(md, metadataProviderAPIKeyKey),
	}
}

func isValidCredentialSource(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "":
		return true
	case credentialSourceRuntimeConfig, credentialSourceRequestInjected:
		return true
	default:
		return false
	}
}

func credentialValidationError(code runtimev1.ReasonCode) error {
	switch code {
	case runtimev1.ReasonCode_AI_REQUEST_CREDENTIAL_SCOPE_FORBIDDEN:
		return status.Error(codes.PermissionDenied, code.String())
	default:
		return status.Error(codes.InvalidArgument, code.String())
	}
}

func validateCredentialSourceForRoute(route runtimev1.RoutePolicy, credentials requestCredentials, requireExplicitTokenSource bool) error {
	source := strings.ToLower(strings.TrimSpace(credentials.Source))
	key := strings.TrimSpace(credentials.ProviderAPIKey)

	if !isValidCredentialSource(source) {
		return credentialValidationError(runtimev1.ReasonCode_AI_REQUEST_CREDENTIAL_INVALID)
	}

	switch route {
	case runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API:
		if source == "" && requireExplicitTokenSource {
			return credentialValidationError(runtimev1.ReasonCode_AI_REQUEST_CREDENTIAL_REQUIRED)
		}
		if source == credentialSourceRequestInjected && key == "" {
			return credentialValidationError(runtimev1.ReasonCode_AI_REQUEST_CREDENTIAL_MISSING)
		}
	case runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME:
		if source == credentialSourceRequestInjected {
			return credentialValidationError(runtimev1.ReasonCode_AI_REQUEST_CREDENTIAL_SCOPE_FORBIDDEN)
		}
	}

	return nil
}

func validateCredentialSourceAtRequestBoundary(ctx context.Context, requested runtimev1.RoutePolicy) error {
	return validateCredentialSourceForRoute(requested, parseRequestCredentials(ctx), true)
}

func validateCredentialSourceAtResolvedRoute(ctx context.Context, resolved runtimev1.RoutePolicy) error {
	return validateCredentialSourceForRoute(resolved, parseRequestCredentials(ctx), true)
}

func requestInjectedCredentials(ctx context.Context) (apiKey string, endpoint string, ok bool) {
	credentials := parseRequestCredentials(ctx)
	if credentials.Source != credentialSourceRequestInjected {
		return "", "", false
	}
	apiKey = strings.TrimSpace(credentials.ProviderAPIKey)
	endpoint = strings.TrimSpace(credentials.ProviderEndpoint)
	if apiKey == "" {
		return "", endpoint, false
	}
	return apiKey, endpoint, true
}
