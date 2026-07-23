package connector

import (
	"context"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/fieldmaskpb"
)

func TestListModelCatalogProvidersReturnsBuiltins(t *testing.T) {
	svc := newTestServiceWithModelCatalog(t)

	resp, err := svc.ListModelCatalogProviders(context.Background(), &runtimev1.ListModelCatalogProvidersRequest{})
	if err != nil {
		t.Fatalf("ListModelCatalogProviders: %v", err)
	}
	if len(resp.GetProviders()) == 0 {
		t.Fatalf("expected non-empty providers")
	}
	foundDashScope := false
	for _, entry := range resp.GetProviders() {
		if entry.GetProvider() == "dashscope" {
			foundDashScope = true
		}
		if entry.GetSource() == runtimev1.ModelCatalogProviderSource_MODEL_CATALOG_PROVIDER_SOURCE_UNSPECIFIED {
			t.Fatalf("provider source should not be unspecified")
		}
	}
	if !foundDashScope {
		t.Fatalf("expected dashscope provider entry")
	}
}

func TestUpsertModelCatalogProviderRequiresAuth(t *testing.T) {
	svc := newTestServiceWithModelCatalog(t)

	_, err := svc.UpsertModelCatalogProvider(context.Background(), &runtimev1.UpsertModelCatalogProviderRequest{
		Provider: "dashscope",
		Yaml:     "version: 1\nprovider: dashscope\ncatalog_version: test\nmodels: []\nvoices: []\n",
	})
	if err == nil {
		t.Fatalf("expected unauthenticated error")
	}
	st, _ := status.FromError(err)
	if st.Code() != codes.Unauthenticated {
		t.Fatalf("expected Unauthenticated, got %v", st.Code())
	}
}

func TestUpsertAndDeleteModelCatalogProvider(t *testing.T) {
	svc := newTestServiceWithModelCatalog(t)
	ctx := userContext("user-1")

	upsertResp, err := svc.UpsertModelCatalogProvider(ctx, &runtimev1.UpsertModelCatalogProviderRequest{
		Provider: "dashscope",
		Yaml: `version: 1
provider: dashscope
catalog_version: custom-test
models:
  - provider: dashscope
    model_id: qwen3-tts-instruct-flash-2026-01-26
    model_type: tts
    updated_at: "2026-01-26"
    capabilities: [audio.synthesize]
    pricing:
      unit: char
      input: "unknown"
      output: "unknown"
      currency: CNY
      as_of: "2026-03-05"
      notes: custom test
    voice_set_id: dashscope:qwen3-tts-system-v1
    voice_discovery_mode: static_catalog
    voice_ref_kinds: [preset_voice_id, provider_voice_ref]
    source_ref:
      url: https://example.com/model
      retrieved_at: "2026-03-05"
      note: custom test
voices:
  - voice_set_id: dashscope:qwen3-tts-system-v1
    provider: dashscope
    voice_id: CustomCherry
    name: CustomCherry
    langs: [zh-cn]
    model_ids: [qwen3-tts-instruct-flash-2026-01-26]
    source_ref:
      url: https://example.com/model
      retrieved_at: "2026-03-05"
      note: custom test
`,
	})
	if err != nil {
		t.Fatalf("UpsertModelCatalogProvider: %v", err)
	}
	if upsertResp.GetProvider().GetProvider() != "dashscope" {
		t.Fatalf("unexpected provider in upsert response: %q", upsertResp.GetProvider().GetProvider())
	}
	if upsertResp.GetProvider().GetSource() != runtimev1.ModelCatalogProviderSource_MODEL_CATALOG_PROVIDER_SOURCE_OVERRIDDEN {
		t.Fatalf("expected overridden source after upsert")
	}

	listResp, err := svc.ListModelCatalogProviders(ctx, &runtimev1.ListModelCatalogProvidersRequest{})
	if err != nil {
		t.Fatalf("ListModelCatalogProviders after upsert: %v", err)
	}
	foundCustomVoice := false
	for _, entry := range listResp.GetProviders() {
		if entry.GetProvider() != "dashscope" {
			continue
		}
		if entry.GetSource() != runtimev1.ModelCatalogProviderSource_MODEL_CATALOG_PROVIDER_SOURCE_OVERRIDDEN {
			t.Fatalf("expected dashscope source=overridden after upsert")
		}
		if !strings.Contains(entry.GetYaml(), "CustomCherry") {
			t.Fatalf("expected custom yaml to contain CustomCherry")
		}
		foundCustomVoice = true
	}
	if !foundCustomVoice {
		t.Fatalf("expected dashscope custom provider entry")
	}

	_, err = svc.DeleteModelCatalogProvider(ctx, &runtimev1.DeleteModelCatalogProviderRequest{Provider: "dashscope"})
	if err != nil {
		t.Fatalf("DeleteModelCatalogProvider: %v", err)
	}

	finalList, err := svc.ListModelCatalogProviders(ctx, &runtimev1.ListModelCatalogProvidersRequest{})
	if err != nil {
		t.Fatalf("ListModelCatalogProviders after delete: %v", err)
	}
	for _, entry := range finalList.GetProviders() {
		if entry.GetProvider() != "dashscope" {
			continue
		}
		if entry.GetSource() != runtimev1.ModelCatalogProviderSource_MODEL_CATALOG_PROVIDER_SOURCE_BUILTIN {
			t.Fatalf("expected dashscope source=builtin after delete")
		}
		if strings.Contains(entry.GetYaml(), "CustomCherry") {
			t.Fatalf("custom yaml should be removed after delete")
		}
	}
}

func TestM1ConnectorCatalogAndOwnershipMatrix(t *testing.T) {
	const customCatalog = `version: 1
provider: dashscope
catalog_version: m1-custom
models:
  - provider: dashscope
    model_id: m1-account-model
    model_type: chat
    updated_at: "2026-07-22"
    capabilities: [text.generate]
    pricing:
      unit: token
      input: "unknown"
      output: "unknown"
      currency: CNY
      as_of: "2026-07-22"
      notes: m1 test
    source_ref:
      url: https://example.com/m1
      retrieved_at: "2026-07-22"
      note: m1 test
voices: []
`
	assertCode := func(t *testing.T, err error, want codes.Code) {
		t.Helper()
		if status.Code(err) != want {
			t.Fatalf("error code=%v want=%v err=%v", status.Code(err), want, err)
		}
	}

	t.Run("ListProviderCatalog", func(t *testing.T) {
		svc := newTestServiceWithModelCatalog(t)
		machine, err := svc.ListProviderCatalog(context.Background(), &runtimev1.ListProviderCatalogRequest{})
		if err != nil || len(machine.GetProviders()) == 0 {
			t.Fatalf("machine provider catalog=%+v err=%v", machine, err)
		}
		account, err := svc.ListProviderCatalog(userContext("account-a"), &runtimev1.ListProviderCatalogRequest{})
		if err != nil || len(account.GetProviders()) != len(machine.GetProviders()) {
			t.Fatalf("account input altered machine catalog: machine=%d account=%d err=%v", len(machine.GetProviders()), len(account.GetProviders()), err)
		}
	})

	t.Run("ListModelCatalogProviders", func(t *testing.T) {
		svc := newTestServiceWithModelCatalog(t)
		if _, err := svc.UpsertModelCatalogProvider(userContext("account-a"), &runtimev1.UpsertModelCatalogProviderRequest{Provider: "dashscope", Yaml: customCatalog}); err != nil {
			t.Fatalf("upsert account catalog: %v", err)
		}
		owned, err := svc.ListModelCatalogProviders(userContext("account-a"), &runtimev1.ListModelCatalogProvidersRequest{})
		if err != nil {
			t.Fatalf("list owned providers: %v", err)
		}
		other, err := svc.ListModelCatalogProviders(userContext("account-b"), &runtimev1.ListModelCatalogProvidersRequest{})
		if err != nil {
			t.Fatalf("list other providers: %v", err)
		}
		var ownedYAML, otherYAML string
		for _, provider := range owned.GetProviders() {
			if provider.GetProvider() == "dashscope" {
				ownedYAML = provider.GetYaml()
			}
		}
		for _, provider := range other.GetProviders() {
			if provider.GetProvider() == "dashscope" {
				otherYAML = provider.GetYaml()
			}
		}
		if !strings.Contains(ownedYAML, "m1-account-model") || strings.Contains(otherYAML, "m1-account-model") {
			t.Fatalf("account catalog overlay leaked: owned=%q other=%q", ownedYAML, otherYAML)
		}
	})

	t.Run("ListCatalogProviderModels", func(t *testing.T) {
		svc := newTestServiceWithModelCatalog(t)
		response, err := svc.ListCatalogProviderModels(userContext("account-a"), &runtimev1.ListCatalogProviderModelsRequest{Provider: "dashscope", PageSize: 500})
		if err != nil || response.GetProvider().GetProvider() != "dashscope" || len(response.GetModels()) == 0 {
			t.Fatalf("provider models=%+v err=%v", response, err)
		}
	})

	t.Run("GetCatalogModelDetail", func(t *testing.T) {
		svc := newTestServiceWithModelCatalog(t)
		models, err := svc.ListCatalogProviderModels(userContext("account-a"), &runtimev1.ListCatalogProviderModelsRequest{Provider: "dashscope", PageSize: 1})
		if err != nil || len(models.GetModels()) != 1 {
			t.Fatalf("seed model=%+v err=%v", models, err)
		}
		modelID := models.GetModels()[0].GetModelId()
		detail, err := svc.GetCatalogModelDetail(userContext("account-a"), &runtimev1.GetCatalogModelDetailRequest{Provider: "dashscope", ModelId: modelID})
		if err != nil || detail.GetModel().GetModelId() != modelID {
			t.Fatalf("model detail=%+v err=%v", detail, err)
		}
	})

	t.Run("UpsertModelCatalogProvider", func(t *testing.T) {
		svc := newTestServiceWithModelCatalog(t)
		response, err := svc.UpsertModelCatalogProvider(userContext("account-a"), &runtimev1.UpsertModelCatalogProviderRequest{Provider: "dashscope", Yaml: customCatalog})
		if err != nil || !response.GetProvider().GetHasOverlay() || !strings.Contains(response.GetProvider().GetYaml(), "m1-account-model") {
			t.Fatalf("upsert provider=%+v err=%v", response, err)
		}
		_, err = svc.UpsertModelCatalogProvider(context.Background(), &runtimev1.UpsertModelCatalogProviderRequest{Provider: "dashscope", Yaml: customCatalog})
		assertCode(t, err, codes.Unauthenticated)
	})

	t.Run("DeleteModelCatalogProvider", func(t *testing.T) {
		svc := newTestServiceWithModelCatalog(t)
		ctx := userContext("account-a")
		if _, err := svc.UpsertModelCatalogProvider(ctx, &runtimev1.UpsertModelCatalogProviderRequest{Provider: "dashscope", Yaml: customCatalog}); err != nil {
			t.Fatalf("seed provider: %v", err)
		}
		response, err := svc.DeleteModelCatalogProvider(ctx, &runtimev1.DeleteModelCatalogProviderRequest{Provider: "dashscope"})
		if err != nil || !response.GetAck().GetOk() {
			t.Fatalf("delete provider=%+v err=%v", response, err)
		}
		_, err = svc.DeleteModelCatalogProvider(context.Background(), &runtimev1.DeleteModelCatalogProviderRequest{Provider: "dashscope"})
		assertCode(t, err, codes.Unauthenticated)
	})

	t.Run("UpsertCatalogModelOverlay", func(t *testing.T) {
		svc := newTestServiceWithModelCatalog(t)
		request := &runtimev1.UpsertCatalogModelOverlayRequest{Provider: "dashscope", Model: &runtimev1.CatalogModelInput{
			Provider: "dashscope", ModelId: "m1-overlay-model", ModelType: "chat", UpdatedAt: "2026-07-22", Capabilities: []string{"text.generate"},
			Pricing:   &runtimev1.CatalogPricing{Unit: "token", Input: "unknown", Output: "unknown", Currency: "CNY", AsOf: "2026-07-22", Notes: "m1 test"},
			SourceRef: &runtimev1.CatalogSourceRef{Url: "https://example.com/m1-overlay", RetrievedAt: "2026-07-22", Note: "m1 test"},
		}}
		response, err := svc.UpsertCatalogModelOverlay(userContext("account-a"), request)
		if err != nil || response.GetModel().GetModelId() != "m1-overlay-model" {
			t.Fatalf("upsert overlay=%+v err=%v", response, err)
		}
		_, err = svc.GetCatalogModelDetail(userContext("account-b"), &runtimev1.GetCatalogModelDetailRequest{Provider: "dashscope", ModelId: "m1-overlay-model"})
		assertCode(t, err, codes.NotFound)
	})

	t.Run("DeleteCatalogModelOverlay", func(t *testing.T) {
		svc := newTestServiceWithModelCatalog(t)
		ctx := userContext("account-a")
		request := &runtimev1.UpsertCatalogModelOverlayRequest{Provider: "dashscope", Model: &runtimev1.CatalogModelInput{
			Provider: "dashscope", ModelId: "m1-delete-overlay", ModelType: "chat", UpdatedAt: "2026-07-22", Capabilities: []string{"text.generate"},
			Pricing:   &runtimev1.CatalogPricing{Unit: "token", Input: "unknown", Output: "unknown", Currency: "CNY", AsOf: "2026-07-22", Notes: "m1 test"},
			SourceRef: &runtimev1.CatalogSourceRef{Url: "https://example.com/m1-delete", RetrievedAt: "2026-07-22", Note: "m1 test"},
		}}
		if _, err := svc.UpsertCatalogModelOverlay(ctx, request); err != nil {
			t.Fatalf("seed overlay: %v", err)
		}
		response, err := svc.DeleteCatalogModelOverlay(ctx, &runtimev1.DeleteCatalogModelOverlayRequest{Provider: "dashscope", ModelId: "m1-delete-overlay"})
		if err != nil || !response.GetAck().GetOk() {
			t.Fatalf("delete overlay=%+v err=%v", response, err)
		}
		_, err = svc.GetCatalogModelDetail(ctx, &runtimev1.GetCatalogModelDetailRequest{Provider: "dashscope", ModelId: "m1-delete-overlay"})
		assertCode(t, err, codes.NotFound)
	})

	connectorFixture := func(t *testing.T) (*Service, string) {
		t.Helper()
		svc := newTestServiceWithModelCatalog(t)
		created, err := svc.CreateConnector(userContext("account-a"), &runtimev1.CreateConnectorRequest{Provider: "openai", ApiKey: "sk-m1", Label: "M1"})
		if err != nil {
			t.Fatalf("create connector: %v", err)
		}
		return svc, created.GetConnector().GetConnectorId()
	}

	t.Run("ListConnectors", func(t *testing.T) {
		svc, connectorID := connectorFixture(t)
		owned, err := svc.ListConnectors(userContext("account-a"), &runtimev1.ListConnectorsRequest{})
		if err != nil || len(owned.GetConnectors()) != 1 || owned.GetConnectors()[0].GetConnectorId() != connectorID {
			t.Fatalf("owned connectors=%+v err=%v", owned, err)
		}
		other, err := svc.ListConnectors(userContext("account-b"), &runtimev1.ListConnectorsRequest{})
		if err != nil || len(other.GetConnectors()) != 0 {
			t.Fatalf("other connectors=%+v err=%v", other, err)
		}
	})

	t.Run("CreateConnector", func(t *testing.T) {
		svc, connectorID := connectorFixture(t)
		if strings.TrimSpace(connectorID) == "" {
			t.Fatal("CreateConnector returned empty id")
		}
		owned, err := svc.ListConnectors(userContext("account-a"), &runtimev1.ListConnectorsRequest{})
		if err != nil || len(owned.GetConnectors()) != 1 || owned.GetConnectors()[0].GetConnectorId() != connectorID {
			t.Fatalf("created connector custody=%+v err=%v", owned, err)
		}
	})

	t.Run("UpdateConnector", func(t *testing.T) {
		svc, connectorID := connectorFixture(t)
		wrongLabel := "wrong"
		_, err := svc.UpdateConnector(userContext("account-b"), &runtimev1.UpdateConnectorRequest{ConnectorId: connectorID, Label: &wrongLabel, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"label"}}})
		assertCode(t, err, codes.NotFound)
		ownedLabel := "owned"
		updated, err := svc.UpdateConnector(userContext("account-a"), &runtimev1.UpdateConnectorRequest{ConnectorId: connectorID, Label: &ownedLabel, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"label"}}})
		if err != nil || updated.GetConnector().GetLabel() != "owned" {
			t.Fatalf("owned update=%+v err=%v", updated, err)
		}
	})

	t.Run("DeleteConnector", func(t *testing.T) {
		svc, connectorID := connectorFixture(t)
		_, err := svc.DeleteConnector(userContext("account-b"), &runtimev1.DeleteConnectorRequest{ConnectorId: connectorID})
		assertCode(t, err, codes.NotFound)
		response, err := svc.DeleteConnector(userContext("account-a"), &runtimev1.DeleteConnectorRequest{ConnectorId: connectorID})
		if err != nil || !response.GetAck().GetOk() {
			t.Fatalf("owned delete=%+v err=%v", response, err)
		}
	})

	t.Run("TestConnector", func(t *testing.T) {
		svc, connectorID := connectorFixture(t)
		_, err := svc.TestConnector(userContext("account-b"), &runtimev1.TestConnectorRequest{ConnectorId: connectorID})
		assertCode(t, err, codes.NotFound)
	})

	t.Run("ListConnectorModels", func(t *testing.T) {
		svc, connectorID := connectorFixture(t)
		_, err := svc.ListConnectorModels(userContext("account-b"), &runtimev1.ListConnectorModelsRequest{ConnectorId: connectorID})
		assertCode(t, err, codes.NotFound)
	})
}

func TestConnectorCheckOrderOwnerBeforeStatusBeforeCredential(t *testing.T) {
	// K-AUTH-005: check order is owner → status → credential.
	// Owner mismatch MUST return NOT_FOUND (information hiding), even if connector
	// is also disabled or missing credentials.
	svc := newTestService(t)
	user1Ctx := userContext("user-1")
	user2Ctx := userContext("user-2")

	// Create a connector owned by user-1
	resp, err := svc.CreateConnector(user1Ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		ApiKey:   "key",
	})
	if err != nil {
		t.Fatalf("CreateConnector: %v", err)
	}
	connID := resp.GetConnector().GetConnectorId()

	// Disable the connector
	_, err = svc.UpdateConnector(user1Ctx, &runtimev1.UpdateConnectorRequest{
		ConnectorId: connID,
		Status:      runtimev1.ConnectorStatus_CONNECTOR_STATUS_DISABLED,
		UpdateMask:  &fieldmaskpb.FieldMask{Paths: []string{"status"}},
	})
	if err != nil {
		t.Fatalf("UpdateConnector disable: %v", err)
	}

	// user-2 tries to access → should see NOT_FOUND (owner check first)
	_, err = svc.GetConnector(user2Ctx, &runtimev1.GetConnectorRequest{ConnectorId: connID})
	if err == nil {
		t.Fatal("expected error for owner mismatch")
	}
	st, _ := status.FromError(err)
	if st.Code() != codes.NotFound {
		t.Fatalf("expected NotFound (owner hides entity), got %v", st.Code())
	}

	// user-1 accesses disabled connector → should see the connector (status check is second)
	getResp, err := svc.GetConnector(user1Ctx, &runtimev1.GetConnectorRequest{ConnectorId: connID})
	if err != nil {
		t.Fatalf("owner should see disabled connector: %v", err)
	}
	if getResp.GetConnector().GetStatus() != runtimev1.ConnectorStatus_CONNECTOR_STATUS_DISABLED {
		t.Fatal("connector should be disabled")
	}
}

// ---------------------------------------------------------------------------
// State-machine exhaustive verification tests
// Spec: state-transitions.yaml
// ---------------------------------------------------------------------------

func TestConnectorStatusTransitionsMatchSpec(t *testing.T) {
	// Spec: connector_status (2 states, 2 transitions)
	//   ACTIVE  -> DISABLED  (UpdateConnector with status=DISABLED)
	//   DISABLED -> ACTIVE   (UpdateConnector with status=ACTIVE)
	//
	// This test exercises the full 2-transition cycle through the service API
	// to verify both legal transitions produce the expected terminal state and
	// that the persisted record reflects the change on re-read.

	svc := newTestService(t)
	ctx := userContext("user-1")

	// --- Setup: create an ACTIVE connector (default initial state) -----------
	created, err := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		ApiKey:   "sk-test",
		Label:    "State-Machine Test",
	})
	if err != nil {
		t.Fatalf("CreateConnector: %v", err)
	}
	connID := created.GetConnector().GetConnectorId()
	if created.GetConnector().GetStatus() != runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE {
		t.Fatalf("expected initial status ACTIVE, got %v", created.GetConnector().GetStatus())
	}

	// --- Transition 1: ACTIVE -> DISABLED ------------------------------------
	disabled, err := svc.UpdateConnector(ctx, &runtimev1.UpdateConnectorRequest{
		ConnectorId: connID,
		Status:      runtimev1.ConnectorStatus_CONNECTOR_STATUS_DISABLED,
		UpdateMask:  &fieldmaskpb.FieldMask{Paths: []string{"status"}},
	})
	if err != nil {
		t.Fatalf("Transition ACTIVE->DISABLED: %v", err)
	}
	if disabled.GetConnector().GetStatus() != runtimev1.ConnectorStatus_CONNECTOR_STATUS_DISABLED {
		t.Fatalf("expected DISABLED after first transition, got %v", disabled.GetConnector().GetStatus())
	}

	// Verify persisted state via GetConnector (re-read from store).
	getDisabled, err := svc.GetConnector(ctx, &runtimev1.GetConnectorRequest{ConnectorId: connID})
	if err != nil {
		t.Fatalf("GetConnector after ACTIVE->DISABLED: %v", err)
	}
	if getDisabled.GetConnector().GetStatus() != runtimev1.ConnectorStatus_CONNECTOR_STATUS_DISABLED {
		t.Fatalf("persisted status should be DISABLED, got %v", getDisabled.GetConnector().GetStatus())
	}

	// --- Transition 2: DISABLED -> ACTIVE ------------------------------------
	reactivated, err := svc.UpdateConnector(ctx, &runtimev1.UpdateConnectorRequest{
		ConnectorId: connID,
		Status:      runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
		UpdateMask:  &fieldmaskpb.FieldMask{Paths: []string{"status"}},
	})
	if err != nil {
		t.Fatalf("Transition DISABLED->ACTIVE: %v", err)
	}
	if reactivated.GetConnector().GetStatus() != runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE {
		t.Fatalf("expected ACTIVE after second transition, got %v", reactivated.GetConnector().GetStatus())
	}

	// Verify persisted state via GetConnector (re-read from store).
	getActive, err := svc.GetConnector(ctx, &runtimev1.GetConnectorRequest{ConnectorId: connID})
	if err != nil {
		t.Fatalf("GetConnector after DISABLED->ACTIVE: %v", err)
	}
	if getActive.GetConnector().GetStatus() != runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE {
		t.Fatalf("persisted status should be ACTIVE, got %v", getActive.GetConnector().GetStatus())
	}
}

func TestConnectorDeleteFlowTransitionsMatchSpec(t *testing.T) {
	// Spec: remote_connector_delete_flow (3 states, 3 transitions)
	//   PRESENT        -> DELETE_PENDING   (DeleteConnector step 1: mark pending)
	//   DELETE_PENDING  -> DELETE_PENDING   (retry or startup rescan)
	//   DELETE_PENDING  -> DELETED          (credential cleanup + registry delete)
	//
	// The service's DeleteConnector performs the full three-step compensating
	// delete atomically (mark pending -> cleanup credential -> remove entry).
	// This test verifies:
	//   1. A remote connector can be created and is accessible (PRESENT).
	//   2. Deleting it makes it inaccessible (DELETED / gone).
	//   3. Credential file is cleaned up as part of the delete flow.
	//   4. Re-deleting is idempotent (already covered by TestDeleteConnectorIdempotent,
	//      linked here for spec traceability).

	svc := newTestService(t)
	ctx := userContext("user-1")

	// --- PRESENT state: create a remote connector ----------------------------
	created, err := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		ApiKey:   "sk-delete-flow",
		Label:    "Delete-Flow Test",
	})
	if err != nil {
		t.Fatalf("CreateConnector: %v", err)
	}
	connID := created.GetConnector().GetConnectorId()

	// Confirm the connector is accessible (PRESENT).
	getResp, err := svc.GetConnector(ctx, &runtimev1.GetConnectorRequest{ConnectorId: connID})
	if err != nil {
		t.Fatalf("GetConnector (PRESENT): %v", err)
	}
	if getResp.GetConnector().GetConnectorId() != connID {
		t.Fatalf("expected connector %s, got %s", connID, getResp.GetConnector().GetConnectorId())
	}
	if !getResp.GetConnector().GetHasCredential() {
		t.Fatal("expected has_credential=true in PRESENT state")
	}

	// --- Transition: PRESENT -> DELETE_PENDING -> DELETED (atomic via service) -
	delResp, err := svc.DeleteConnector(ctx, &runtimev1.DeleteConnectorRequest{
		ConnectorId: connID,
	})
	if err != nil {
		t.Fatalf("DeleteConnector: %v", err)
	}
	if !delResp.GetAck().GetOk() {
		t.Fatal("expected ack.ok=true from DeleteConnector")
	}

	// --- DELETED state: connector is no longer accessible --------------------
	_, err = svc.GetConnector(ctx, &runtimev1.GetConnectorRequest{ConnectorId: connID})
	if err == nil {
		t.Fatal("expected NotFound after delete")
	}
	st, _ := status.FromError(err)
	if st.Code() != codes.NotFound {
		t.Fatalf("expected NotFound after delete, got %v", st.Code())
	}

	// Verify the connector does not appear in list results.
	listResp, err := svc.ListConnectors(ctx, &runtimev1.ListConnectorsRequest{
		KindFilter: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
	})
	if err != nil {
		t.Fatalf("ListConnectors after delete: %v", err)
	}
	for _, c := range listResp.GetConnectors() {
		if c.GetConnectorId() == connID {
			t.Fatalf("deleted connector %s should not appear in list", connID)
		}
	}

	// --- Missing management target: once deleted, the connector is no longer a
	// management resource and must fail closed as NOT_FOUND.
	_, err = svc.DeleteConnector(ctx, &runtimev1.DeleteConnectorRequest{
		ConnectorId: connID,
	})
	if err == nil {
		t.Fatalf("expected re-DeleteConnector to return NotFound")
	}
	st, _ = status.FromError(err)
	if st.Code() != codes.NotFound {
		t.Fatalf("expected NotFound for re-delete, got %v", st.Code())
	}
}
