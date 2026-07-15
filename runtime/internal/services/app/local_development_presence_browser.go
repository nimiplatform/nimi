package app

import (
	"context"

	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

func withLocalDevelopmentPresenceBrowser(ctx context.Context) (context.Context, error) {
	return accountservice.WithPresenceBrowserLauncherMetadata(ctx)
}
