package localservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/managedimagebackend"
)

func cloneManagedImageLoadRequest(input managedimagebackend.LoadModelRequest) managedimagebackend.LoadModelRequest {
	input.Options = append([]string(nil), input.Options...)
	input.Components = append([]managedimagebackend.ComponentBinding(nil), input.Components...)
	return input
}

func managedImageCleanupContext(ctx context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	if ctx == nil || ctx.Err() != nil {
		return context.WithTimeout(context.Background(), timeout)
	}
	return context.WithTimeout(context.WithoutCancel(ctx), timeout)
}

func managedImageLoadContext(ctx context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	if timeout <= 0 {
		timeout = managedImageLoadTimeout
	}
	if ctx == nil {
		return context.WithTimeout(context.Background(), timeout)
	}
	return context.WithTimeout(ctx, timeout)
}

func managedImageLoadHash(value any) string {
	raw, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}
