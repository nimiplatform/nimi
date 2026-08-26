package grpcserver

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	connectorservice "github.com/nimiplatform/nimi/runtime/internal/services/connector"
)

func TestRuntimeMemoryEmbeddingSubjectAuthorizesOnlyMatchingUserConnector(t *testing.T) {
	ctx := withRuntimeMemoryEmbeddingSubject(context.Background(), "account-1")
	record := connectorservice.ConnectorRecord{
		Kind:      runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER,
		OwnerID:   "account-1",
	}
	if memoryEmbeddingSubjectUserID(ctx) != "account-1" || !memoryEmbeddingConnectorVisibleToCaller(ctx, record) {
		t.Fatal("Runtime-private embedding subject did not authorize its matching user connector")
	}
	record.OwnerID = "account-2"
	if memoryEmbeddingConnectorVisibleToCaller(ctx, record) {
		t.Fatal("Runtime-private embedding subject authorized another account connector")
	}
}
