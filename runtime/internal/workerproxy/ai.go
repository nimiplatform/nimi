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

func (s *AIProxy) ExecuteScenario(ctx context.Context, req *runtimev1.ExecuteScenarioRequest) (*runtimev1.ExecuteScenarioResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableAI(err)
	}
	ctx = forwardIncomingMetadata(ctx)
	var trailer metadata.MD
	resp, err := client.ExecuteScenario(ctx, req, grpc.Trailer(&trailer))
	s.applyQueueWaitFromTrailer(ctx, trailer)
	if err != nil {
		return nil, mapAIError(err)
	}
	return resp, nil
}

func (s *AIProxy) StreamScenario(req *runtimev1.StreamScenarioRequest, stream grpc.ServerStreamingServer[runtimev1.StreamScenarioEvent]) error {
	client, err := s.client()
	if err != nil {
		return unavailableAI(err)
	}
	remote, err := client.StreamScenario(forwardIncomingMetadata(stream.Context()), req)
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

func (s *AIProxy) SubmitScenarioJob(ctx context.Context, req *runtimev1.SubmitScenarioJobRequest) (*runtimev1.SubmitScenarioJobResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableAI(err)
	}
	ctx = forwardIncomingMetadata(ctx)
	var trailer metadata.MD
	resp, err := client.SubmitScenarioJob(ctx, req, grpc.Trailer(&trailer))
	s.applyQueueWaitFromTrailer(ctx, trailer)
	if err != nil {
		return nil, mapAIError(err)
	}
	return resp, nil
}

func (s *AIProxy) GetScenarioJob(ctx context.Context, req *runtimev1.GetScenarioJobRequest) (*runtimev1.GetScenarioJobResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableAI(err)
	}
	ctx = forwardIncomingMetadata(ctx)
	resp, err := client.GetScenarioJob(ctx, req)
	if err != nil {
		return nil, mapAIError(err)
	}
	return resp, nil
}

func (s *AIProxy) CancelScenarioJob(ctx context.Context, req *runtimev1.CancelScenarioJobRequest) (*runtimev1.CancelScenarioJobResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableAI(err)
	}
	ctx = forwardIncomingMetadata(ctx)
	resp, err := client.CancelScenarioJob(ctx, req)
	if err != nil {
		return nil, mapAIError(err)
	}
	return resp, nil
}

func (s *AIProxy) SubscribeScenarioJobEvents(req *runtimev1.SubscribeScenarioJobEventsRequest, stream grpc.ServerStreamingServer[runtimev1.ScenarioJobEvent]) error {
	client, err := s.client()
	if err != nil {
		return unavailableAI(err)
	}
	remote, err := client.SubscribeScenarioJobEvents(forwardIncomingMetadata(stream.Context()), req)
	if err != nil {
		return mapAIError(err)
	}
	forwardErr := forwardServerStream(remote.Recv, stream.Send)
	if forwardErr != nil {
		return mapAIError(forwardErr)
	}
	return nil
}

func (s *AIProxy) GetScenarioArtifacts(ctx context.Context, req *runtimev1.GetScenarioArtifactsRequest) (*runtimev1.GetScenarioArtifactsResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableAI(err)
	}
	ctx = forwardIncomingMetadata(ctx)
	resp, err := client.GetScenarioArtifacts(ctx, req)
	if err != nil {
		return nil, mapAIError(err)
	}
	return resp, nil
}

func (s *AIProxy) ListScenarioProfiles(ctx context.Context, req *runtimev1.ListScenarioProfilesRequest) (*runtimev1.ListScenarioProfilesResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableAI(err)
	}
	ctx = forwardIncomingMetadata(ctx)
	resp, err := client.ListScenarioProfiles(ctx, req)
	if err != nil {
		return nil, mapAIError(err)
	}
	return resp, nil
}

func (s *AIProxy) GetVoiceAsset(ctx context.Context, req *runtimev1.GetVoiceAssetRequest) (*runtimev1.GetVoiceAssetResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableAI(err)
	}
	ctx = forwardIncomingMetadata(ctx)
	resp, err := client.GetVoiceAsset(ctx, req)
	if err != nil {
		return nil, mapAIError(err)
	}
	return resp, nil
}

func (s *AIProxy) ListVoiceAssets(ctx context.Context, req *runtimev1.ListVoiceAssetsRequest) (*runtimev1.ListVoiceAssetsResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableAI(err)
	}
	ctx = forwardIncomingMetadata(ctx)
	resp, err := client.ListVoiceAssets(ctx, req)
	if err != nil {
		return nil, mapAIError(err)
	}
	return resp, nil
}

func (s *AIProxy) DeleteVoiceAsset(ctx context.Context, req *runtimev1.DeleteVoiceAssetRequest) (*runtimev1.DeleteVoiceAssetResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableAI(err)
	}
	ctx = forwardIncomingMetadata(ctx)
	resp, err := client.DeleteVoiceAsset(ctx, req)
	if err != nil {
		return nil, mapAIError(err)
	}
	return resp, nil
}

func (s *AIProxy) ListPresetVoices(ctx context.Context, req *runtimev1.ListPresetVoicesRequest) (*runtimev1.ListPresetVoicesResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableAI(err)
	}
	ctx = forwardIncomingMetadata(ctx)
	resp, err := client.ListPresetVoices(ctx, req)
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
