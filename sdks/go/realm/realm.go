package realm

import (
	"context"

	"github.com/nimiplatform/nimi/sdks/go/coreclient"
	sdkstypes "github.com/nimiplatform/nimi/sdks/go/types"
)

type OperationRequest struct {
	OperationID string
	Metadata    sdkstypes.CoreMetadata
	Body        []byte
	TimeoutMS   int64
}

type Core struct {
	client coreclient.Client
}

func New(client coreclient.Client) Core {
	return Core{client: client}
}

func (c Core) Operation(ctx context.Context, req OperationRequest) ([]byte, error) {
	return c.client.Unary(ctx, sdkstypes.CoreUnaryRequest{
		Context:   ctx,
		MethodID:  req.OperationID,
		Metadata:  req.Metadata,
		Body:      req.Body,
		TimeoutMS: req.TimeoutMS,
	})
}
