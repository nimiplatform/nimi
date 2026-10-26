package remoteexecution

import (
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r025
func observeConnectionFailure(store *connector.ConnectorStore, audit auditSink, captured connector.ConnectorRecord) func(*error) {
	started := time.Now()
	return func(cause *error) {
		if err := store.ObserveCredentialFailure(captured, started, *cause); err != nil && audit != nil {
			// Diagnostics must not replace the provider's real execution outcome.
			_ = audit.AppendEventChecked(&runtimev1.AuditEventRecord{Operation: "connector.check.persist_failed", ReasonCode: runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, Timestamp: timestamppb.Now()})
		}
	}
}
