package entrypoint

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

func CreateKnowledgeBankGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.CreateKnowledgeBankRequest, metadataOverride ...*ClientMetadata) (*runtimev1.CreateKnowledgeBankResponse, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("create knowledge bank request is required")
	}
	return withCognitionClient(addr, timeout, req.GetContext().GetAppId(), metadataOverride, func(ctx context.Context, client runtimev1.RuntimeCognitionServiceClient) (*runtimev1.CreateKnowledgeBankResponse, error) {
		resp, err := client.CreateKnowledgeBank(ctx, req)
		if err != nil {
			return nil, fmt.Errorf("runtime knowledge create bank: %w", err)
		}
		return resp, nil
	})
}

func GetKnowledgeBankGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.GetKnowledgeBankRequest, metadataOverride ...*ClientMetadata) (*runtimev1.GetKnowledgeBankResponse, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("get knowledge bank request is required")
	}
	return withCognitionClient(addr, timeout, req.GetContext().GetAppId(), metadataOverride, func(ctx context.Context, client runtimev1.RuntimeCognitionServiceClient) (*runtimev1.GetKnowledgeBankResponse, error) {
		resp, err := client.GetKnowledgeBank(ctx, req)
		if err != nil {
			return nil, fmt.Errorf("runtime knowledge get bank: %w", err)
		}
		return resp, nil
	})
}

func ListKnowledgeBanksGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.ListKnowledgeBanksRequest, metadataOverride ...*ClientMetadata) (*runtimev1.ListKnowledgeBanksResponse, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("list knowledge banks request is required")
	}
	return withCognitionClient(addr, timeout, req.GetContext().GetAppId(), metadataOverride, func(ctx context.Context, client runtimev1.RuntimeCognitionServiceClient) (*runtimev1.ListKnowledgeBanksResponse, error) {
		resp, err := client.ListKnowledgeBanks(ctx, req)
		if err != nil {
			return nil, fmt.Errorf("runtime knowledge list banks: %w", err)
		}
		return resp, nil
	})
}

func DeleteKnowledgeBankGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.DeleteKnowledgeBankRequest, metadataOverride ...*ClientMetadata) (*runtimev1.DeleteKnowledgeBankResponse, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("delete knowledge bank request is required")
	}
	return withCognitionClient(addr, timeout, req.GetContext().GetAppId(), metadataOverride, func(ctx context.Context, client runtimev1.RuntimeCognitionServiceClient) (*runtimev1.DeleteKnowledgeBankResponse, error) {
		resp, err := client.DeleteKnowledgeBank(ctx, req)
		if err != nil {
			return nil, fmt.Errorf("runtime knowledge delete bank: %w", err)
		}
		return resp, nil
	})
}

func PutKnowledgePageGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.PutPageRequest, metadataOverride ...*ClientMetadata) (*runtimev1.PutPageResponse, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("put knowledge page request is required")
	}
	return withCognitionClient(addr, timeout, req.GetContext().GetAppId(), metadataOverride, func(ctx context.Context, client runtimev1.RuntimeCognitionServiceClient) (*runtimev1.PutPageResponse, error) {
		resp, err := client.PutPage(ctx, req)
		if err != nil {
			return nil, fmt.Errorf("runtime knowledge put page: %w", err)
		}
		return resp, nil
	})
}

func GetKnowledgePageGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.GetPageRequest, metadataOverride ...*ClientMetadata) (*runtimev1.GetPageResponse, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("get knowledge page request is required")
	}
	return withCognitionClient(addr, timeout, req.GetContext().GetAppId(), metadataOverride, func(ctx context.Context, client runtimev1.RuntimeCognitionServiceClient) (*runtimev1.GetPageResponse, error) {
		resp, err := client.GetPage(ctx, req)
		if err != nil {
			return nil, fmt.Errorf("runtime knowledge get page: %w", err)
		}
		return resp, nil
	})
}

func ListKnowledgePagesGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.ListPagesRequest, metadataOverride ...*ClientMetadata) (*runtimev1.ListPagesResponse, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("list knowledge pages request is required")
	}
	return withCognitionClient(addr, timeout, req.GetContext().GetAppId(), metadataOverride, func(ctx context.Context, client runtimev1.RuntimeCognitionServiceClient) (*runtimev1.ListPagesResponse, error) {
		resp, err := client.ListPages(ctx, req)
		if err != nil {
			return nil, fmt.Errorf("runtime knowledge list pages: %w", err)
		}
		return resp, nil
	})
}

func DeleteKnowledgePageGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.DeletePageRequest, metadataOverride ...*ClientMetadata) (*runtimev1.DeletePageResponse, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("delete knowledge page request is required")
	}
	return withCognitionClient(addr, timeout, req.GetContext().GetAppId(), metadataOverride, func(ctx context.Context, client runtimev1.RuntimeCognitionServiceClient) (*runtimev1.DeletePageResponse, error) {
		resp, err := client.DeletePage(ctx, req)
		if err != nil {
			return nil, fmt.Errorf("runtime knowledge delete page: %w", err)
		}
		return resp, nil
	})
}

func SearchKnowledgeKeywordGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.SearchKeywordRequest, metadataOverride ...*ClientMetadata) (*runtimev1.SearchKeywordResponse, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("search knowledge keyword request is required")
	}
	return withCognitionClient(addr, timeout, req.GetContext().GetAppId(), metadataOverride, func(ctx context.Context, client runtimev1.RuntimeCognitionServiceClient) (*runtimev1.SearchKeywordResponse, error) {
		resp, err := client.SearchKeyword(ctx, req)
		if err != nil {
			return nil, fmt.Errorf("runtime knowledge search keyword: %w", err)
		}
		return resp, nil
	})
}

func SearchKnowledgeHybridGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.SearchHybridRequest, metadataOverride ...*ClientMetadata) (*runtimev1.SearchHybridResponse, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("search knowledge hybrid request is required")
	}
	return withCognitionClient(addr, timeout, req.GetContext().GetAppId(), metadataOverride, func(ctx context.Context, client runtimev1.RuntimeCognitionServiceClient) (*runtimev1.SearchHybridResponse, error) {
		resp, err := client.SearchHybrid(ctx, req)
		if err != nil {
			return nil, fmt.Errorf("runtime knowledge search hybrid: %w", err)
		}
		return resp, nil
	})
}

func AddKnowledgeLinkGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.AddLinkRequest, metadataOverride ...*ClientMetadata) (*runtimev1.AddLinkResponse, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("add knowledge link request is required")
	}
	return withCognitionClient(addr, timeout, req.GetContext().GetAppId(), metadataOverride, func(ctx context.Context, client runtimev1.RuntimeCognitionServiceClient) (*runtimev1.AddLinkResponse, error) {
		resp, err := client.AddLink(ctx, req)
		if err != nil {
			return nil, fmt.Errorf("runtime knowledge add link: %w", err)
		}
		return resp, nil
	})
}

func RemoveKnowledgeLinkGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.RemoveLinkRequest, metadataOverride ...*ClientMetadata) (*runtimev1.RemoveLinkResponse, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("remove knowledge link request is required")
	}
	return withCognitionClient(addr, timeout, req.GetContext().GetAppId(), metadataOverride, func(ctx context.Context, client runtimev1.RuntimeCognitionServiceClient) (*runtimev1.RemoveLinkResponse, error) {
		resp, err := client.RemoveLink(ctx, req)
		if err != nil {
			return nil, fmt.Errorf("runtime knowledge remove link: %w", err)
		}
		return resp, nil
	})
}

func ListKnowledgeLinksGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.ListLinksRequest, metadataOverride ...*ClientMetadata) (*runtimev1.ListLinksResponse, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("list knowledge links request is required")
	}
	return withCognitionClient(addr, timeout, req.GetContext().GetAppId(), metadataOverride, func(ctx context.Context, client runtimev1.RuntimeCognitionServiceClient) (*runtimev1.ListLinksResponse, error) {
		resp, err := client.ListLinks(ctx, req)
		if err != nil {
			return nil, fmt.Errorf("runtime knowledge list links: %w", err)
		}
		return resp, nil
	})
}

func ListKnowledgeBacklinksGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.ListBacklinksRequest, metadataOverride ...*ClientMetadata) (*runtimev1.ListBacklinksResponse, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("list knowledge backlinks request is required")
	}
	return withCognitionClient(addr, timeout, req.GetContext().GetAppId(), metadataOverride, func(ctx context.Context, client runtimev1.RuntimeCognitionServiceClient) (*runtimev1.ListBacklinksResponse, error) {
		resp, err := client.ListBacklinks(ctx, req)
		if err != nil {
			return nil, fmt.Errorf("runtime knowledge list backlinks: %w", err)
		}
		return resp, nil
	})
}

func TraverseKnowledgeGraphGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.TraverseGraphRequest, metadataOverride ...*ClientMetadata) (*runtimev1.TraverseGraphResponse, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("traverse knowledge graph request is required")
	}
	return withCognitionClient(addr, timeout, req.GetContext().GetAppId(), metadataOverride, func(ctx context.Context, client runtimev1.RuntimeCognitionServiceClient) (*runtimev1.TraverseGraphResponse, error) {
		resp, err := client.TraverseGraph(ctx, req)
		if err != nil {
			return nil, fmt.Errorf("runtime knowledge traverse graph: %w", err)
		}
		return resp, nil
	})
}

func IngestKnowledgeDocumentGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.IngestDocumentRequest, metadataOverride ...*ClientMetadata) (*runtimev1.IngestDocumentResponse, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("ingest knowledge document request is required")
	}
	return withCognitionClient(addr, timeout, req.GetContext().GetAppId(), metadataOverride, func(ctx context.Context, client runtimev1.RuntimeCognitionServiceClient) (*runtimev1.IngestDocumentResponse, error) {
		resp, err := client.IngestDocument(ctx, req)
		if err != nil {
			return nil, fmt.Errorf("runtime knowledge ingest document: %w", err)
		}
		return resp, nil
	})
}

func GetKnowledgeIngestTaskGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.GetIngestTaskRequest, metadataOverride ...*ClientMetadata) (*runtimev1.GetIngestTaskResponse, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("get knowledge ingest task request is required")
	}
	return withCognitionClient(addr, timeout, req.GetContext().GetAppId(), metadataOverride, func(ctx context.Context, client runtimev1.RuntimeCognitionServiceClient) (*runtimev1.GetIngestTaskResponse, error) {
		resp, err := client.GetIngestTask(ctx, req)
		if err != nil {
			return nil, fmt.Errorf("runtime knowledge get ingest task: %w", err)
		}
		return resp, nil
	})
}

func withCognitionClient[T any](addr string, timeout time.Duration, appID string, metadataOverride []*ClientMetadata, call func(context.Context, runtimev1.RuntimeCognitionServiceClient) (*T, error)) (*T, error) {
	if timeout <= 0 {
		timeout = 5 * time.Second
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	preparedCtx, err := prepareInsecureOutgoingContext(ctx, addr, appID, firstMetadataOverride(metadataOverride...))
	if err != nil {
		return nil, err
	}

	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial grpc %s: %w", addr, err)
	}
	defer conn.Close()

	return call(preparedCtx, runtimev1.NewRuntimeCognitionServiceClient(conn))
}
