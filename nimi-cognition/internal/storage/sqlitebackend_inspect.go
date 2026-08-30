package storage

import (
	"context"
	"errors"
	"fmt"
)

// RuntimeSourceStoreInspection is aggregate structural evidence. Scope and
// source identities remain private to the Agent Source owner.
type RuntimeSourceStoreInspection struct {
	Empty bool
}

func (b *SQLiteBackend) InspectRuntimeSourceStore(ctx context.Context) (RuntimeSourceStoreInspection, error) {
	if b == nil || b.db == nil {
		return RuntimeSourceStoreInspection{}, errors.New("storage: runtime source backend unavailable")
	}
	var hasScopes, invalid bool
	if err := b.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM runtime_source_scope LIMIT 1), EXISTS(SELECT 1 FROM runtime_source_scope
		WHERE generation <= 0
		   OR (status = 'ready' AND (embedding_identity = '' OR embedding_dimension <= 0))
		   OR (status <> 'ready' AND (embedding_identity <> '' OR embedding_dimension <> 0)) LIMIT 1)`).Scan(&hasScopes, &invalid); err != nil {
		return RuntimeSourceStoreInspection{}, fmt.Errorf("storage: inspect runtime source scope structure: %w", err)
	}
	if invalid {
		return RuntimeSourceStoreInspection{}, errors.New("storage: runtime source scope structure is invalid")
	}
	return RuntimeSourceStoreInspection{Empty: !hasScopes}, nil
}
