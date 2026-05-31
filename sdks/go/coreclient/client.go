package coreclient

import (
	"context"

	sdkstypes "github.com/nimiplatform/nimi/sdks/go/types"
)

type StreamReader interface {
	Recv(context.Context) ([]byte, error)
	Close() error
}

type Transport interface {
	Unary(context.Context, sdkstypes.CoreUnaryRequest) ([]byte, error)
	ServerStream(context.Context, sdkstypes.CoreStreamRequest) (StreamReader, error)
}

type AuthMetadataProvider func(context.Context) (sdkstypes.CoreMetadata, error)

type Client struct {
	transport Transport
	auth      AuthMetadataProvider
}

func New(transport Transport, auth AuthMetadataProvider) Client {
	return Client{transport: transport, auth: auth}
}

func (c Client) Unary(ctx context.Context, req sdkstypes.CoreUnaryRequest) ([]byte, error) {
	metadata, err := c.metadata(ctx, req.Metadata)
	if err != nil {
		return nil, err
	}
	req.Metadata = metadata
	return c.transport.Unary(ctx, req)
}

func (c Client) ServerStream(ctx context.Context, req sdkstypes.CoreStreamRequest) (StreamReader, error) {
	metadata, err := c.metadata(ctx, req.Metadata)
	if err != nil {
		return nil, err
	}
	req.Metadata = metadata
	return c.transport.ServerStream(ctx, req)
}

func (c Client) UnsafeRaw() Transport {
	return c.transport
}

func (c Client) metadata(ctx context.Context, metadata sdkstypes.CoreMetadata) (sdkstypes.CoreMetadata, error) {
	merged := sdkstypes.CoreMetadata{}
	if c.auth != nil {
		authMetadata, err := c.auth(ctx)
		if err != nil {
			return nil, err
		}
		for key, value := range authMetadata {
			merged[key] = value
		}
	}
	for key, value := range metadata {
		merged[key] = value
	}
	return merged, nil
}
