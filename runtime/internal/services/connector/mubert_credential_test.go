package connector

import (
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

func TestMubertCredentialEncodingFailsBeforeCreationOrReplacement(t *testing.T) {
	svc := newTestService(t)
	ctx := userContext("user-1")
	for _, key := range []string{"company-token", "customer::", "::token", "customer::token\nvalue"} {
		_, err := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{Provider: "mubert", ApiKey: key})
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason != runtimev1.ReasonCode_AI_CONNECTOR_INVALID || status.Code(err) != codes.InvalidArgument || !strings.Contains(err.Error(), "customer-id::access-token") {
			t.Fatal("missing actionable pre-write error", err)
		}
	}
	list, err := svc.ListConnectors(ctx, &runtimev1.ListConnectorsRequest{ProviderFilter: "mubert"})
	if err != nil || len(list.Connectors) != 0 {
		t.Fatal("invalid credentials persisted", err)
	}
	created, err := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{Provider: "mubert", ApiKey: "customer::token", Label: "original"})
	if err != nil {
		t.Fatal(err)
	}
	before, found, err := svc.store.Get(created.Connector.ConnectorId)
	if err != nil || !found {
		t.Fatal(err)
	}
	if _, err = svc.UpdateConnector(ctx, &runtimev1.UpdateConnectorRequest{ConnectorId: created.Connector.ConnectorId, ApiKey: proto.String("invalid"), Label: proto.String("must not commit")}); err == nil {
		t.Fatal("invalid replacement accepted")
	}
	after, found, err := svc.store.Get(created.Connector.ConnectorId)
	if err != nil || !found || after.Label != before.Label || after.CredentialRevision != before.CredentialRevision || after.CredentialCustodyRef != before.CredentialCustodyRef {
		t.Fatal("failed update changed owned connection", err)
	}
}
