package nimillm

import (
	"context"
	"net"
	"net/url"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.azure-deployment-bindings
func (p *CloudProvider) probeAzureConnector(ctx context.Context, endpoint, key string, headers map[string]string) error {
	base, err := AzureOpenAIEndpoint(endpoint)
	if err != nil {
		return err
	}
	key, err = requireProviderAPIKey(key)
	if err != nil {
		return err
	}
	backend := NewSecuredBackendWithHeaders("cloud-azure", base, key, headers, p.probeTimeout(), p.allowLoopbackEndpoint)
	if backend == nil {
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	backend.azureOpenAI = true
	return backend.ProbeConnector(ctx)
}

// AzureOpenAIEndpoint accepts the resource root copied from Azure or an exact
// native v1 base (including an explicit gateway prefix). It does not retain a
// legacy api-version query or infer a deployment from a URL path.
func AzureOpenAIEndpoint(raw string) (string, error) {
	invalid := func() (string, error) {
		return "", grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID, grpcerr.ReasonOptions{Message: "Azure requires its resource root or an /openai/v1 endpoint", ActionHint: "configure_azure_openai_v1_endpoint"})
	}
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return invalid()
	}
	if u.Scheme != "https" {
		ip := net.ParseIP(u.Hostname())
		if u.Scheme != "http" || (u.Hostname() != "localhost" && (ip == nil || !ip.IsLoopback())) {
			return invalid()
		}
	}
	path := strings.TrimRight(u.Path, "/")
	switch {
	case path == "":
		u.Path = "/openai/v1"
		u.RawPath = ""
	case strings.HasSuffix(path, "/openai") && strings.HasSuffix(strings.TrimRight(u.EscapedPath(), "/"), "/openai"):
		u.Path = path + "/v1"
		if u.RawPath != "" {
			u.RawPath = strings.TrimRight(u.RawPath, "/") + "/v1"
		}
	case strings.HasSuffix(path, "/openai/v1") && strings.HasSuffix(strings.TrimRight(u.EscapedPath(), "/"), "/openai/v1"):
		u.Path = path
		u.RawPath = strings.TrimRight(u.RawPath, "/")
	default:
		return invalid()
	}
	return u.String(), nil
}

func (b *Backend) requestModelID(model string) string {
	if b != nil && b.modelDeployment != "" {
		return b.modelDeployment
	}
	return model
}

func (b *Backend) compatiblePath(resource string) string {
	if b.azureOpenAI || b.groqOpenAI {
		return "/v1/" + strings.TrimLeft(resource, "/")
	}
	return resolveOpenAICompatiblePath(b.baseURL, resource)
}
