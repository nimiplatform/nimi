package connector

import (
	"slices"
	"strings"
	"unicode"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

type SVGAuthorConfig struct {
	ProviderModelID      string `json:"provider_model_id"`
	RemoteModelCatalogID string `json:"remote_model_catalog_id"`
}

func CloneSVGAuthor(value *SVGAuthorConfig) *SVGAuthorConfig {
	if value == nil {
		return nil
	}
	copy := *value
	return &copy
}

func ValidSVGAuthor(value *SVGAuthorConfig) bool {
	if value == nil {
		return false
	}
	for _, text := range []string{value.ProviderModelID, value.RemoteModelCatalogID} {
		if text == "" || len(text) > 256 || text != strings.TrimSpace(text) || strings.ContainsFunc(text, unicode.IsControl) {
			return false
		}
	}
	return true
}

func svgAuthorProjection(value *SVGAuthorConfig) *runtimev1.ConnectorSVGAuthor {
	if value == nil {
		return nil
	}
	return &runtimev1.ConnectorSVGAuthor{ProviderModelId: value.ProviderModelID, RemoteModelCatalogId: value.RemoteModelCatalogID}
}

// @nimi-authority: rule.nimi.runtime.ai-provider.openai-svg-author
func (s *Service) resolveSVGAuthor(owner string, record ConnectorRecord, value *runtimev1.ConnectorSVGAuthor) (*SVGAuthorConfig, error) {
	invalid := grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	author := &SVGAuthorConfig{ProviderModelID: value.GetProviderModelId(), RemoteModelCatalogID: value.GetRemoteModelCatalogId()}
	if record.Provider != "openai" || normalizeAuthKind(record.AuthKind) != runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_API_KEY || !ValidSVGAuthor(author) {
		return nil, invalid
	}
	models, err := s.listCatalogConnectorModels(owner, record.Provider, record)
	if err != nil {
		return nil, err
	}
	for _, model := range models {
		if model.GetProviderModelId() == author.ProviderModelID && model.GetRemoteModelCatalogId() == author.RemoteModelCatalogID && slices.Contains(model.GetCapabilities(), "text.generate") {
			return author, nil
		}
	}
	return nil, invalid
}
