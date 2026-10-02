package nimillm

import (
	"context"
	"strings"
)

type providerParameterObserverKey struct{}

func withProviderParameterObserver(ctx context.Context, observer func(int, []string)) context.Context {
	return context.WithValue(ctx, providerParameterObserverKey{}, observer)
}

func observeProviderParameterFailure(ctx context.Context, statusCode int, payload map[string]any) {
	observer, _ := ctx.Value(providerParameterObserverKey{}).(func(int, []string))
	if observer == nil {
		return
	}
	message := strings.ToLower(ProviderErrorMessage(payload))
	fields := []string{}
	for _, field := range []string{"mime_type", "sample_rate", "delivery", "language", "speech_config", "response_format", "model", "store"} {
		if strings.Contains(message, field) {
			fields = append(fields, field)
		}
	}
	observer(statusCode, fields)
}
