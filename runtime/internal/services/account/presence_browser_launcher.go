package account

import "context"

type presenceBrowserLauncher func(context.Context, string) error

type presenceBrowserLauncherContextKey struct{}

// WithPresenceBrowserLauncher binds a request-scoped browser process launcher
// to a protected Runtime-owned presence flow. The launcher receives only the
// Runtime-generated authorization URL and cannot assert the verification
// result.
func WithPresenceBrowserLauncher(
	ctx context.Context,
	launcher func(context.Context, string) error,
) context.Context {
	if ctx == nil || launcher == nil {
		return ctx
	}
	return context.WithValue(ctx, presenceBrowserLauncherContextKey{}, presenceBrowserLauncher(launcher))
}

func presenceBrowserLauncherFromContext(ctx context.Context) presenceBrowserLauncher {
	if ctx == nil {
		return nil
	}
	launcher, _ := ctx.Value(presenceBrowserLauncherContextKey{}).(presenceBrowserLauncher)
	return launcher
}
