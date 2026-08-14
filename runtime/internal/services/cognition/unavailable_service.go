package cognition

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
)

type unavailableService struct{}

// NewUnavailableService returns the fail-closed Runtime Cognition boundary
// used when the Cognition-specific implementation cannot be initialized.
func NewUnavailableService() runtimev1.RuntimeCognitionServiceServer {
	return unavailableService{}
}

func cognitionUnavailableError() error {
	return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE)
}

func (unavailableService) CreateBank(context.Context, *runtimev1.CreateBankRequest) (*runtimev1.CreateBankResponse, error) {
	return nil, cognitionUnavailableError()
}

func (unavailableService) GetBank(context.Context, *runtimev1.GetBankRequest) (*runtimev1.GetBankResponse, error) {
	return nil, cognitionUnavailableError()
}

func (unavailableService) ListBanks(context.Context, *runtimev1.ListBanksRequest) (*runtimev1.ListBanksResponse, error) {
	return nil, cognitionUnavailableError()
}

func (unavailableService) DeleteBank(context.Context, *runtimev1.DeleteBankRequest) (*runtimev1.DeleteBankResponse, error) {
	return nil, cognitionUnavailableError()
}

func (unavailableService) Retain(context.Context, *runtimev1.RetainRequest) (*runtimev1.RetainResponse, error) {
	return nil, cognitionUnavailableError()
}

func (unavailableService) Recall(context.Context, *runtimev1.RecallRequest) (*runtimev1.RecallResponse, error) {
	return nil, cognitionUnavailableError()
}

func (unavailableService) History(context.Context, *runtimev1.HistoryRequest) (*runtimev1.HistoryResponse, error) {
	return nil, cognitionUnavailableError()
}

func (unavailableService) DeleteMemory(context.Context, *runtimev1.DeleteMemoryRequest) (*runtimev1.DeleteMemoryResponse, error) {
	return nil, cognitionUnavailableError()
}

func (unavailableService) SubscribeMemoryEvents(*runtimev1.SubscribeMemoryEventsRequest, grpc.ServerStreamingServer[runtimev1.MemoryEvent]) error {
	return cognitionUnavailableError()
}

func (unavailableService) InspectMemoryEmbeddingRuntime(context.Context, *runtimev1.InspectMemoryEmbeddingRuntimeRequest) (*runtimev1.InspectMemoryEmbeddingRuntimeResponse, error) {
	return nil, cognitionUnavailableError()
}

func (unavailableService) RequestMemoryEmbeddingRuntimeBind(context.Context, *runtimev1.RequestMemoryEmbeddingRuntimeBindRequest) (*runtimev1.RequestMemoryEmbeddingRuntimeBindResponse, error) {
	return nil, cognitionUnavailableError()
}

func (unavailableService) RequestMemoryEmbeddingRuntimeCutover(context.Context, *runtimev1.RequestMemoryEmbeddingRuntimeCutoverRequest) (*runtimev1.RequestMemoryEmbeddingRuntimeCutoverResponse, error) {
	return nil, cognitionUnavailableError()
}

func (unavailableService) CreateKnowledgeBank(context.Context, *runtimev1.CreateKnowledgeBankRequest) (*runtimev1.CreateKnowledgeBankResponse, error) {
	return nil, cognitionUnavailableError()
}

func (unavailableService) GetKnowledgeBank(context.Context, *runtimev1.GetKnowledgeBankRequest) (*runtimev1.GetKnowledgeBankResponse, error) {
	return nil, cognitionUnavailableError()
}

func (unavailableService) ListKnowledgeBanks(context.Context, *runtimev1.ListKnowledgeBanksRequest) (*runtimev1.ListKnowledgeBanksResponse, error) {
	return nil, cognitionUnavailableError()
}

func (unavailableService) DeleteKnowledgeBank(context.Context, *runtimev1.DeleteKnowledgeBankRequest) (*runtimev1.DeleteKnowledgeBankResponse, error) {
	return nil, cognitionUnavailableError()
}

func (unavailableService) PutPage(context.Context, *runtimev1.PutPageRequest) (*runtimev1.PutPageResponse, error) {
	return nil, cognitionUnavailableError()
}

func (unavailableService) GetPage(context.Context, *runtimev1.GetPageRequest) (*runtimev1.GetPageResponse, error) {
	return nil, cognitionUnavailableError()
}

func (unavailableService) ListPages(context.Context, *runtimev1.ListPagesRequest) (*runtimev1.ListPagesResponse, error) {
	return nil, cognitionUnavailableError()
}

func (unavailableService) DeletePage(context.Context, *runtimev1.DeletePageRequest) (*runtimev1.DeletePageResponse, error) {
	return nil, cognitionUnavailableError()
}

func (unavailableService) SearchKeyword(context.Context, *runtimev1.SearchKeywordRequest) (*runtimev1.SearchKeywordResponse, error) {
	return nil, cognitionUnavailableError()
}

func (unavailableService) SearchHybrid(context.Context, *runtimev1.SearchHybridRequest) (*runtimev1.SearchHybridResponse, error) {
	return nil, cognitionUnavailableError()
}

func (unavailableService) AddLink(context.Context, *runtimev1.AddLinkRequest) (*runtimev1.AddLinkResponse, error) {
	return nil, cognitionUnavailableError()
}

func (unavailableService) RemoveLink(context.Context, *runtimev1.RemoveLinkRequest) (*runtimev1.RemoveLinkResponse, error) {
	return nil, cognitionUnavailableError()
}

func (unavailableService) ListLinks(context.Context, *runtimev1.ListLinksRequest) (*runtimev1.ListLinksResponse, error) {
	return nil, cognitionUnavailableError()
}

func (unavailableService) ListBacklinks(context.Context, *runtimev1.ListBacklinksRequest) (*runtimev1.ListBacklinksResponse, error) {
	return nil, cognitionUnavailableError()
}

func (unavailableService) TraverseGraph(context.Context, *runtimev1.TraverseGraphRequest) (*runtimev1.TraverseGraphResponse, error) {
	return nil, cognitionUnavailableError()
}

func (unavailableService) IngestDocument(context.Context, *runtimev1.IngestDocumentRequest) (*runtimev1.IngestDocumentResponse, error) {
	return nil, cognitionUnavailableError()
}

func (unavailableService) GetIngestTask(context.Context, *runtimev1.GetIngestTaskRequest) (*runtimev1.GetIngestTaskResponse, error) {
	return nil, cognitionUnavailableError()
}
