package grpcserver

import (
	"context"
	"errors"
	"fmt"

	"github.com/oklog/ulid/v2"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	aiservice "github.com/nimiplatform/nimi/runtime/internal/services/ai"
	cognitionservice "github.com/nimiplatform/nimi/runtime/internal/services/cognition"
	runtimeagentservice "github.com/nimiplatform/nimi/runtime/internal/services/runtimeagent"
)

// Source Cognition shares the canonical AI execution contract, while retaining
// its own corpus and generation lifecycle. Capture all batches before dispatch.
func newAgentSourceEmbeddingExecutor(agentSvc *runtimeagentservice.Service, aiSvc *aiservice.Service) cognitionservice.AgentSourceEmbeddingExecutor {
	return func(ctx context.Context, accountID, localAgentRef string, texts []string) (cognitionservice.AgentSourceEmbeddingExecution, error) {
		if err := agentSvc.AuthorizeSourceEmbeddingTarget(accountID, localAgentRef); err != nil {
			return cognitionservice.AgentSourceEmbeddingExecution{Status: "failure"}, err
		}
		ctx = cognitionMemoryEmbeddingExecutionContext(ctx, accountID)
		description, err := aiSvc.DescribeMemoryEmbedding(ctx)
		if err != nil {
			return cognitionservice.AgentSourceEmbeddingExecution{Status: sourceCognitionEmbeddingFailureStatus(err)}, err
		}
		_, raw, err := aiSvc.CaptureMemoryEmbedding(ctx, texts, description.SpaceID, aiservice.EmbeddingOwner{Kind: "source", AgentRef: localAgentRef, OperationID: "source_embed_" + ulid.Make().String()})
		if err != nil {
			return cognitionservice.AgentSourceEmbeddingExecution{Status: sourceCognitionEmbeddingFailureStatus(err)}, err
		}
		result, err := aiSvc.ExecuteMemoryEmbedding(ctx, raw)
		if err != nil {
			// Source owns the capture even if execution fails before claiming a Job.
			if cleanupErr := aiSvc.DiscardMemoryEmbedding(context.WithoutCancel(ctx), raw); cleanupErr != nil {
				err = errors.Join(err, fmt.Errorf("discard source embedding capture: %w", cleanupErr))
			}
			return cognitionservice.AgentSourceEmbeddingExecution{Status: sourceCognitionEmbeddingFailureStatus(err)}, err
		}
		return cognitionservice.AgentSourceEmbeddingExecution{Status: "ready", Identity: result.SpaceID, Dimension: result.Dimension, Vectors: result.Vectors}, nil
	}
}

func sourceCognitionEmbeddingFailureStatus(err error) string {
	if err == nil {
		return "failure"
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); ok {
		switch reason {
		case runtimev1.ReasonCode_AI_CONFIG_NOT_FOUND, runtimev1.ReasonCode_AI_CONFIG_INVALID:
			return "unconfigured"
		case runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND,
			runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE,
			runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE,
			runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
			runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED,
			runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_STALE:
			return "unavailable"
		}
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return "unavailable"
	}
	return "failure"
}
