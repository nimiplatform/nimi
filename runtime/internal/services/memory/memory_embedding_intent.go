package memory

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
)

type GetMemoryEmbeddingBindingIntentRequest struct {
	Context *runtimev1.MemoryRequestContext
	Locator *runtimev1.MemoryBankLocator
}

type GetMemoryEmbeddingBindingIntentResult struct {
	BindingIntentPresent bool
	BindingIntent        *MemoryEmbeddingBindingIntentSnapshot
}

type SetMemoryEmbeddingBindingIntentRequest struct {
	Context       *runtimev1.MemoryRequestContext
	Locator       *runtimev1.MemoryBankLocator
	BindingIntent *MemoryEmbeddingBindingIntentSnapshot
}

type SetMemoryEmbeddingBindingIntentResult struct {
	Accepted      bool
	BindingIntent *MemoryEmbeddingBindingIntentSnapshot
}

func (s *Service) authorizeMemoryEmbeddingTarget(ctx context.Context, reqContext *runtimev1.MemoryRequestContext, locator *runtimev1.MemoryBankLocator) error {
	if err := validateMemoryEmbeddingLocator(locator); err != nil {
		return err
	}
	if authorizer := s.memoryEmbeddingTargetAuthorizer(); authorizer != nil {
		return authorizer(ctx, reqContext, cloneLocator(locator))
	}
	switch locator.GetScope() {
	case runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_APP_PRIVATE,
		runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_WORKSPACE_PRIVATE:
		return nil
	default:
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
}

func normalizeMemoryEmbeddingBindingIntentForPersist(input *MemoryEmbeddingBindingIntentSnapshot) (*MemoryEmbeddingBindingIntentSnapshot, error) {
	normalized := normalizeMemoryEmbeddingIntentSnapshot(input)
	if !bindingIntentPresent(normalized) {
		return nil, nil
	}
	switch normalized.SourceKind {
	case MemoryEmbeddingBindingSourceKindCloud:
		if normalized.CloudBinding == nil || normalized.LocalBinding != nil {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	case MemoryEmbeddingBindingSourceKindLocal:
		if normalized.LocalBinding == nil || normalized.CloudBinding != nil {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	default:
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	return normalized, nil
}

func memoryEmbeddingIntentToProto(input *MemoryEmbeddingBindingIntentSnapshot) *runtimev1.MemoryEmbeddingBindingIntentSnapshot {
	if input == nil {
		return nil
	}
	out := &runtimev1.MemoryEmbeddingBindingIntentSnapshot{
		SourceKind:    strings.TrimSpace(string(input.SourceKind)),
		RevisionToken: strings.TrimSpace(input.RevisionToken),
	}
	if input.CloudBinding != nil {
		out.CloudBinding = &runtimev1.MemoryEmbeddingCloudBindingRef{
			ConnectorId: strings.TrimSpace(input.CloudBinding.ConnectorID),
			ModelId:     strings.TrimSpace(input.CloudBinding.ModelID),
		}
	}
	if input.LocalBinding != nil {
		out.LocalBinding = &runtimev1.MemoryEmbeddingLocalBindingRef{
			TargetId: strings.TrimSpace(input.LocalBinding.LocalModelID),
		}
	}
	return out
}

func memoryEmbeddingIntentFromProto(input *runtimev1.MemoryEmbeddingBindingIntentSnapshot) *MemoryEmbeddingBindingIntentSnapshot {
	if input == nil {
		return nil
	}
	return &MemoryEmbeddingBindingIntentSnapshot{
		SourceKind: MemoryEmbeddingBindingSourceKind(strings.TrimSpace(input.GetSourceKind())),
		CloudBinding: func() *MemoryEmbeddingCloudBindingRef {
			if input.GetCloudBinding() == nil {
				return nil
			}
			return &MemoryEmbeddingCloudBindingRef{
				ConnectorID: strings.TrimSpace(input.GetCloudBinding().GetConnectorId()),
				ModelID:     strings.TrimSpace(input.GetCloudBinding().GetModelId()),
			}
		}(),
		LocalBinding: func() *MemoryEmbeddingLocalBindingRef {
			if input.GetLocalBinding() == nil {
				return nil
			}
			return &MemoryEmbeddingLocalBindingRef{
				LocalModelID: strings.TrimSpace(input.GetLocalBinding().GetTargetId()),
			}
		}(),
		RevisionToken: strings.TrimSpace(input.GetRevisionToken()),
	}
}

func (s *Service) GetMemoryEmbeddingBindingIntent(ctx context.Context, req GetMemoryEmbeddingBindingIntentRequest) (*GetMemoryEmbeddingBindingIntentResult, error) {
	if err := s.authorizeMemoryEmbeddingTarget(ctx, req.Context, req.Locator); err != nil {
		return nil, err
	}
	if s.backend == nil {
		return &GetMemoryEmbeddingBindingIntentResult{}, nil
	}
	var raw string
	err := s.backend.DB().QueryRowContext(ctx, `
		SELECT intent_json
		FROM memory_embedding_intent
		WHERE locator_key = ?
	`, locatorKey(req.Locator)).Scan(&raw)
	if err == sql.ErrNoRows {
		return &GetMemoryEmbeddingBindingIntentResult{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load memory embedding intent: %w", err)
	}
	var protoIntent runtimev1.MemoryEmbeddingBindingIntentSnapshot
	if err := protojson.Unmarshal([]byte(raw), &protoIntent); err != nil {
		return nil, fmt.Errorf("unmarshal memory embedding intent: %w", err)
	}
	intent, err := normalizeMemoryEmbeddingBindingIntentForPersist(memoryEmbeddingIntentFromProto(&protoIntent))
	if err != nil {
		return nil, err
	}
	return &GetMemoryEmbeddingBindingIntentResult{
		BindingIntentPresent: bindingIntentPresent(intent),
		BindingIntent:        cloneMemoryEmbeddingIntentSnapshot(intent),
	}, nil
}

func (s *Service) SetMemoryEmbeddingBindingIntent(ctx context.Context, req SetMemoryEmbeddingBindingIntentRequest) (*SetMemoryEmbeddingBindingIntentResult, error) {
	if err := s.authorizeMemoryEmbeddingTarget(ctx, req.Context, req.Locator); err != nil {
		return nil, err
	}
	intent, err := normalizeMemoryEmbeddingBindingIntentForPersist(req.BindingIntent)
	if err != nil {
		return nil, err
	}
	key := locatorKey(req.Locator)
	if strings.TrimSpace(key) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if s.backend == nil {
		return &SetMemoryEmbeddingBindingIntentResult{Accepted: true, BindingIntent: cloneMemoryEmbeddingIntentSnapshot(intent)}, nil
	}
	err = s.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		if intent == nil {
			if _, err := tx.ExecContext(ctx, `DELETE FROM memory_embedding_intent WHERE locator_key = ?`, key); err != nil {
				return fmt.Errorf("clear memory embedding intent: %w", err)
			}
			return nil
		}
		locatorRaw, err := protojson.Marshal(cloneLocator(req.Locator))
		if err != nil {
			return fmt.Errorf("marshal memory embedding locator: %w", err)
		}
		intentRaw, err := protojson.Marshal(memoryEmbeddingIntentToProto(intent))
		if err != nil {
			return fmt.Errorf("marshal memory embedding intent: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO memory_embedding_intent(locator_key, locator_json, intent_json, updated_at)
			VALUES (?, ?, ?, ?)
			ON CONFLICT(locator_key) DO UPDATE SET
				locator_json = excluded.locator_json,
				intent_json = excluded.intent_json,
				updated_at = excluded.updated_at
		`, key, string(locatorRaw), string(intentRaw), time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			return fmt.Errorf("persist memory embedding intent: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &SetMemoryEmbeddingBindingIntentResult{
		Accepted:      true,
		BindingIntent: cloneMemoryEmbeddingIntentSnapshot(intent),
	}, nil
}
