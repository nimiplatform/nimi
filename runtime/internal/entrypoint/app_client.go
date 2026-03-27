package entrypoint

import (
	"context"
	"errors"
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
	"io"
	"strings"
	"time"
)

func SendAppMessageGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.SendAppMessageRequest, metadataOverride ...*ClientMetadata) (*runtimev1.SendAppMessageResponse, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("send app message request is required")
	}
	if timeout <= 0 {
		timeout = 5 * time.Second
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	preparedCtx, err := prepareInsecureOutgoingContext(ctx, addr, req.GetFromAppId(), firstMetadataOverride(metadataOverride...))
	if err != nil {
		return nil, err
	}
	ctx = preparedCtx

	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial grpc %s: %w", addr, err)
	}
	defer conn.Close()

	client := runtimev1.NewRuntimeAppServiceClient(conn)
	resp, err := client.SendAppMessage(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("runtime app send message: %w", err)
	}
	return resp, nil
}

// SubscribeAppMessagesGRPC subscribes app message events over gRPC.
func SubscribeAppMessagesGRPC(ctx context.Context, grpcAddr string, req *runtimev1.SubscribeAppMessagesRequest, metadataOverride ...*ClientMetadata) (<-chan *runtimev1.AppMessageEvent, <-chan error, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, nil, errors.New("subscribe app messages request is required")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	preparedCtx, err := prepareInsecureOutgoingContext(ctx, addr, req.GetAppId(), firstMetadataOverride(metadataOverride...))
	if err != nil {
		return nil, nil, err
	}
	ctx = preparedCtx

	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, nil, fmt.Errorf("dial grpc %s: %w", addr, err)
	}

	client := runtimev1.NewRuntimeAppServiceClient(conn)
	stream, err := client.SubscribeAppMessages(ctx, req)
	if err != nil {
		conn.Close()
		return nil, nil, fmt.Errorf("runtime app subscribe messages: %w", err)
	}

	events := make(chan *runtimev1.AppMessageEvent, 64)
	errCh := make(chan error, 1)
	go func() {
		defer close(events)
		defer close(errCh)
		defer conn.Close()

		for {
			event, recvErr := stream.Recv()
			if recvErr != nil {
				if errors.Is(recvErr, io.EOF) || status.Code(recvErr) == codes.Canceled || ctx.Err() != nil {
					return
				}
				errCh <- fmt.Errorf("recv app message event: %w", recvErr)
				return
			}
			select {
			case <-ctx.Done():
				return
			case events <- event:
			}
		}
	}()

	return events, errCh, nil
}
