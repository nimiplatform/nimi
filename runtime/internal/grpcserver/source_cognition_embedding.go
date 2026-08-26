package grpcserver

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	aiservice "github.com/nimiplatform/nimi/runtime/internal/services/ai"
	cognitionservice "github.com/nimiplatform/nimi/runtime/internal/services/cognition"
	connectorservice "github.com/nimiplatform/nimi/runtime/internal/services/connector"
	runtimeagentservice "github.com/nimiplatform/nimi/runtime/internal/services/runtimeagent"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

// DashScope's formally admitted embedding target accepts at most ten inputs
// per compatible-mode request. Keep source generation batches within that
// provider-safe ceiling; every batch still uses the exact captured profile.
const sourceCognitionEmbeddingBatchSize = 10
const sourceCognitionEmbeddingBatchTimeout = 20 * time.Second
const sourceCognitionEmbeddingIdentityDomain = "nimi.cognition.local-agent-source-embedding/v1\x00"

func newAgentSourceEmbeddingExecutor(
	agentSvc *runtimeagentservice.Service,
	aiSvc *aiservice.Service,
	connStore *connectorservice.ConnectorStore,
	modelCatalog *catalog.Resolver,
	localResolver localexecution.Resolver,
) cognitionservice.AgentSourceEmbeddingExecutor {
	return func(ctx context.Context, accountID, localAgentRef string, texts []string) (cognitionservice.AgentSourceEmbeddingExecution, error) {
		ctx = withRuntimeMemoryEmbeddingSubject(ctx, accountID)
		ctx = executionintent.WithRuntimeAccountSubject(ctx, accountID)
		requestContext := &runtimev1.MemoryRequestContext{AppId: "runtime.agent", SubjectUserId: strings.TrimSpace(accountID)}
		locator := &runtimev1.MemoryBankLocator{
			Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
			Owner: &runtimev1.MemoryBankLocator_AgentCore{AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: strings.TrimSpace(localAgentRef)}},
		}
		intent, err := agentSvc.ResolveMemoryEmbeddingIntent(ctx, requestContext, locator)
		if err != nil {
			return cognitionservice.AgentSourceEmbeddingExecution{Status: sourceCognitionEmbeddingFailureStatus(err)}, err
		}
		resolved := resolveRuntimeMemoryEmbeddingProfile(ctx, intent, connStore, modelCatalog, localResolver)
		if resolved.ResolutionState != "resolved" || resolved.Profile == nil {
			status := "unavailable"
			if resolved.ResolutionState == "missing" {
				status = "unconfigured"
			}
			reason := resolved.BlockedReasonCode
			if reason == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
				reason = runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
			}
			return cognitionservice.AgentSourceEmbeddingExecution{Status: status}, grpcerr.WithReasonCode(codes.FailedPrecondition, reason)
		}
		identity, err := sourceCognitionEmbeddingIdentity(resolved.Profile)
		if err != nil {
			return cognitionservice.AgentSourceEmbeddingExecution{Status: "failure"}, err
		}
		execution := cognitionservice.AgentSourceEmbeddingExecution{
			Status: "ready", Identity: identity, Dimension: int(resolved.Profile.GetDimension()),
			Vectors: make([][]float64, 0, len(texts)),
		}
		for offset := 0; offset < len(texts); offset += sourceCognitionEmbeddingBatchSize {
			end := min(offset+sourceCognitionEmbeddingBatchSize, len(texts))
			batchCtx, cancel := context.WithTimeout(ctx, sourceCognitionEmbeddingBatchTimeout)
			vectors, embedErr := aiSvc.EmbedTextsForMemory(batchCtx, resolved.Profile, append([]string(nil), texts[offset:end]...))
			batchErr := batchCtx.Err()
			cancel()
			if embedErr != nil {
				return cognitionservice.AgentSourceEmbeddingExecution{Status: sourceCognitionEmbeddingFailureStatus(embedErr)}, embedErr
			}
			if batchErr != nil {
				return cognitionservice.AgentSourceEmbeddingExecution{Status: "unavailable"}, batchErr
			}
			execution.Vectors = append(execution.Vectors, vectors...)
		}
		return execution, nil
	}
}

func sourceCognitionEmbeddingIdentity(profile *runtimev1.MemoryEmbeddingProfile) (string, error) {
	raw, err := proto.MarshalOptions{Deterministic: true}.Marshal(profile)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(append([]byte(sourceCognitionEmbeddingIdentityDomain), raw...))
	return hex.EncodeToString(digest[:]), nil
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
