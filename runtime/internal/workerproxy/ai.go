package workerproxy

import (
	"context"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/usagemetrics"
)

const aiWorkerRole = "ai"

// AIProxy forwards RuntimeAiService requests to the AI worker process.
type AIProxy struct {
	runtimev1.UnimplementedRuntimeAiServiceServer
	pool *ConnPool
}

func NewAIProxy(pool *ConnPool) *AIProxy {
	return &AIProxy{pool: pool}
}

func (s *AIProxy) Generate(ctx context.Context, req *runtimev1.GenerateRequest) (*runtimev1.GenerateResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableAI(err)
	}
	ctx = forwardIncomingMetadata(ctx)
	var trailer metadata.MD
	resp, err := client.Generate(ctx, req, grpc.Trailer(&trailer))
	s.applyQueueWaitFromTrailer(ctx, trailer)
	if err != nil {
		return nil, mapAIError(err)
	}
	return resp, nil
}

func (s *AIProxy) StreamGenerate(req *runtimev1.StreamGenerateRequest, stream grpc.ServerStreamingServer[runtimev1.StreamGenerateEvent]) error {
	client, err := s.client()
	if err != nil {
		return unavailableAI(err)
	}
	remote, err := client.StreamGenerate(forwardIncomingMetadata(stream.Context()), req)
	if err != nil {
		return mapAIError(err)
	}
	forwardErr := forwardServerStream(remote.Recv, stream.Send)
	s.applyQueueWaitFromTrailer(stream.Context(), remote.Trailer())
	if forwardErr != nil {
		return mapAIError(forwardErr)
	}
	return nil
}

func (s *AIProxy) Embed(ctx context.Context, req *runtimev1.EmbedRequest) (*runtimev1.EmbedResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableAI(err)
	}
	ctx = forwardIncomingMetadata(ctx)
	var trailer metadata.MD
	resp, err := client.Embed(ctx, req, grpc.Trailer(&trailer))
	s.applyQueueWaitFromTrailer(ctx, trailer)
	if err != nil {
		return nil, mapAIError(err)
	}
	return resp, nil
}

func (s *AIProxy) SubmitMediaJob(ctx context.Context, req *runtimev1.SubmitMediaJobRequest) (*runtimev1.SubmitMediaJobResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableAI(err)
	}
	ctx = forwardIncomingMetadata(ctx)
	var trailer metadata.MD
	resp, err := client.SubmitMediaJob(ctx, req, grpc.Trailer(&trailer))
	s.applyQueueWaitFromTrailer(ctx, trailer)
	if err != nil {
		return nil, mapAIError(err)
	}
	return resp, nil
}

func (s *AIProxy) GetMediaJob(ctx context.Context, req *runtimev1.GetMediaJobRequest) (*runtimev1.GetMediaJobResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableAI(err)
	}
	ctx = forwardIncomingMetadata(ctx)
	resp, err := client.GetMediaJob(ctx, req)
	if err != nil {
		return nil, mapAIError(err)
	}
	return resp, nil
}

func (s *AIProxy) CancelMediaJob(ctx context.Context, req *runtimev1.CancelMediaJobRequest) (*runtimev1.CancelMediaJobResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableAI(err)
	}
	ctx = forwardIncomingMetadata(ctx)
	resp, err := client.CancelMediaJob(ctx, req)
	if err != nil {
		return nil, mapAIError(err)
	}
	return resp, nil
}

func (s *AIProxy) SubscribeMediaJobEvents(req *runtimev1.SubscribeMediaJobEventsRequest, stream grpc.ServerStreamingServer[runtimev1.MediaJobEvent]) error {
	client, err := s.client()
	if err != nil {
		return unavailableAI(err)
	}
	remote, err := client.SubscribeMediaJobEvents(forwardIncomingMetadata(stream.Context()), req)
	if err != nil {
		return mapAIError(err)
	}
	forwardErr := forwardServerStream(remote.Recv, stream.Send)
	if forwardErr != nil {
		return mapAIError(forwardErr)
	}
	return nil
}

func (s *AIProxy) GetMediaArtifacts(ctx context.Context, req *runtimev1.GetMediaArtifactsRequest) (*runtimev1.GetMediaArtifactsResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableAI(err)
	}
	ctx = forwardIncomingMetadata(ctx)
	resp, err := client.GetMediaArtifacts(ctx, req)
	if err != nil {
		return nil, mapAIError(err)
	}
	return resp, nil
}

func (s *AIProxy) client() (runtimev1.RuntimeAiServiceClient, error) {
	if s.pool == nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	conn, err := s.pool.Conn(aiWorkerRole)
	if err != nil {
		return nil, err
	}
	return runtimev1.NewRuntimeAiServiceClient(conn), nil
}

func unavailableAI(_ error) error {
	return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
}

func mapAIError(err error) error {
	st, ok := status.FromError(err)
	if !ok {
		return unavailableAI(err)
	}
	if st.Code() == codes.Unavailable || st.Code() == codes.DeadlineExceeded {
		return unavailableAI(err)
	}
	return err
}

func (s *AIProxy) applyQueueWaitFromTrailer(ctx context.Context, trailer metadata.MD) {
	waitMs, ok := usagemetrics.ParseQueueWaitMD(trailer)
	if !ok {
		return
	}
	usagemetrics.SetQueueWaitMS(ctx, waitMs)
}

func forwardIncomingMetadata(ctx context.Context) context.Context {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok || len(md) == 0 {
		return ctx
	}
	return metadata.NewOutgoingContext(ctx, md.Copy())
}
