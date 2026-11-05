package connector

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"testing"
)

func TestSVGAuthorSelectionUsesCurrentCatalogAndFrozenTaskSnapshot(t *testing.T) {
	s := newTestService(t)
	ctx := userContext("user-1")
	created, err := s.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{Provider: "openai", ApiKey: "provider-key"})
	if err != nil {
		t.Fatal(err)
	}
	id := created.Connector.ConnectorId
	models, err := s.ListConnectorModels(ctx, &runtimev1.ListConnectorModelsRequest{ConnectorId: id})
	if err != nil {
		t.Fatal(err)
	}
	var chosen *runtimev1.ConnectorModelDescriptor
	for _, model := range models.Models {
		if model.ProviderModelId == "gpt-6.1-sol" {
			chosen = model
		}
	}
	if chosen == nil {
		t.Fatal("reviewed model absent")
	}
	selection := &runtimev1.ConnectorSVGAuthor{ProviderModelId: chosen.ProviderModelId, RemoteModelCatalogId: chosen.RemoteModelCatalogId}
	for _, invalid := range []*runtimev1.ConnectorSVGAuthor{{ProviderModelId: "gpt-6.1-sol", RemoteModelCatalogId: "stale"}, {ProviderModelId: "unknown", RemoteModelCatalogId: chosen.RemoteModelCatalogId}} {
		if _, err = s.UpdateConnector(ctx, &runtimev1.UpdateConnectorRequest{ConnectorId: id, SvgAuthor: &runtimev1.ConnectorSVGAuthorUpdate{Change: &runtimev1.ConnectorSVGAuthorUpdate_Author{Author: invalid}}}); err == nil {
			t.Fatal("unbound selection accepted")
		}
	}
	updated, err := s.UpdateConnector(ctx, &runtimev1.UpdateConnectorRequest{ConnectorId: id, SvgAuthor: &runtimev1.ConnectorSVGAuthorUpdate{Change: &runtimev1.ConnectorSVGAuthorUpdate_Author{Author: selection}}})
	if err != nil {
		t.Fatal(err)
	}
	if !proto.Equal(updated.Connector.SvgAuthor, selection) {
		t.Fatal("selection not projected")
	}
	captured, ref, err := s.store.CaptureCredentialCustody(id, "svg-original-job")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.UpdateConnector(ctx, &runtimev1.UpdateConnectorRequest{ConnectorId: id, ApiKey: proto.String("replacement-key")}); err != nil {
		t.Fatal(err)
	}
	removed, err := s.UpdateConnector(ctx, &runtimev1.UpdateConnectorRequest{ConnectorId: id, SvgAuthor: &runtimev1.ConnectorSVGAuthorUpdate{Change: &runtimev1.ConnectorSVGAuthorUpdate_Remove{Remove: true}}})
	if err != nil {
		t.Fatal(err)
	}
	if removed.Connector.SvgAuthor != nil || captured.SVGAuthor.ProviderModelID != "gpt-6.1-sol" {
		t.Fatal("captured author changed")
	}
	secret, err := s.store.LoadCredentialCustody(ref)
	if err != nil || ResolveCredential(captured, secret).APIKey != "provider-key" {
		t.Fatal("captured credential changed")
	}
	if _, err = s.UpdateConnector(userContext("other-user"), &runtimev1.UpdateConnectorRequest{ConnectorId: id, SvgAuthor: &runtimev1.ConnectorSVGAuthorUpdate{Change: &runtimev1.ConnectorSVGAuthorUpdate_Remove{Remove: true}}}); err == nil {
		t.Fatal("foreign author update accepted")
	}
}
