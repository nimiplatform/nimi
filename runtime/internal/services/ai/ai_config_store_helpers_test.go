package ai

import (
	"context"
	"fmt"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aiconfig"
)

func overwriteAIConfigStoreForTest(
	ctx context.Context,
	store aiconfig.Store,
	accountNamespace string,
	config *runtimev1.AIConfig,
) error {
	_, revision, _, err := store.Get(ctx, accountNamespace, config.GetOwner())
	if err != nil {
		return err
	}
	_, _, committed, err := store.Overwrite(ctx, accountNamespace, revision, config)
	if err != nil {
		return err
	}
	if !committed {
		return fmt.Errorf("AIConfig test overwrite conflicted")
	}
	return nil
}
