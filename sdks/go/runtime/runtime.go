package runtime

import (
	"context"

	"github.com/nimiplatform/nimi/sdks/go/coreclient"
	sdkstypes "github.com/nimiplatform/nimi/sdks/go/types"
)

type Core struct {
	client coreclient.Client
}

func New(client coreclient.Client) Core {
	return Core{client: client}
}

func (c Core) Unary(ctx context.Context, req sdkstypes.CoreUnaryRequest) ([]byte, error) {
	return c.client.Unary(ctx, req)
}

func (c Core) ServerStream(ctx context.Context, req sdkstypes.CoreStreamRequest) (coreclient.StreamReader, error) {
	return c.client.ServerStream(ctx, req)
}
