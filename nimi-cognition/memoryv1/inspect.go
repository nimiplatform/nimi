package memoryv1

import (
	"context"
	"errors"
	"fmt"
)

// StoreInspection is bounded structural owner evidence. It deliberately
// contains no bank, binding, Memory, subject, or source identity.
type StoreInspection struct {
	Empty bool
}

// InspectStore verifies the currently opened canonical Memory store without
// projecting its private identities or rebuilding derived state.
func (c *Core) InspectStore(ctx context.Context) (StoreInspection, error) {
	if c == nil || c.db == nil {
		return StoreInspection{}, errors.New("memory core: store unavailable")
	}
	var hasBanks, hasBindings bool
	if err := c.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM memory_banks LIMIT 1), EXISTS(SELECT 1 FROM memory_bank_bindings LIMIT 1)`).Scan(&hasBanks, &hasBindings); err != nil {
		return StoreInspection{}, fmt.Errorf("memory core: inspect owner metadata: %w", err)
	}
	if hasBanks != hasBindings {
		return StoreInspection{}, errors.New("memory core: store binding structure is incomplete")
	}
	return StoreInspection{Empty: !hasBanks}, nil
}
