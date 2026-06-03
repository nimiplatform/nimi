import type {
  AddLinkRequest,
  AddLinkResponse,
  CreateKnowledgeBankRequest,
  CreateKnowledgeBankResponse,
  DeleteKnowledgeBankRequest,
  DeleteKnowledgeBankResponse,
  DeletePageRequest,
  DeletePageResponse,
  GetIngestTaskRequest,
  GetIngestTaskResponse,
  GetKnowledgeBankRequest,
  GetKnowledgeBankResponse,
  GetPageRequest,
  GetPageResponse,
  IngestDocumentRequest,
  IngestDocumentResponse,
  ListBacklinksRequest,
  ListBacklinksResponse,
  ListKnowledgeBanksRequest,
  ListKnowledgeBanksResponse,
  ListLinksRequest,
  ListLinksResponse,
  ListPagesRequest,
  ListPagesResponse,
  PutPageRequest,
  PutPageResponse,
  RemoveLinkRequest,
  RemoveLinkResponse,
  SearchHybridRequest,
  SearchHybridResponse,
  SearchKeywordRequest,
  SearchKeywordResponse,
  TraverseGraphRequest,
  TraverseGraphResponse,
} from './generated/runtime/v1/knowledge';
import type {
  CreateBankRequest,
  CreateBankResponse,
  DeleteBankRequest,
  DeleteBankResponse,
  DeleteMemoryRequest,
  DeleteMemoryResponse,
  GetBankRequest,
  GetBankResponse,
  GetMemoryEmbeddingRuntimeIntentRequest,
  GetMemoryEmbeddingRuntimeIntentResponse,
  HistoryRequest,
  HistoryResponse,
  InspectMemoryEmbeddingRuntimeRequest,
  InspectMemoryEmbeddingRuntimeResponse,
  ListBanksRequest,
  ListBanksResponse,
  MemoryEvent,
  RecallRequest,
  RecallResponse,
  RequestMemoryEmbeddingRuntimeBindRequest,
  RequestMemoryEmbeddingRuntimeBindResponse,
  RequestMemoryEmbeddingRuntimeCutoverRequest,
  RequestMemoryEmbeddingRuntimeCutoverResponse,
  RetainRequest,
  RetainResponse,
  SetMemoryEmbeddingRuntimeIntentRequest,
  SetMemoryEmbeddingRuntimeIntentResponse,
  SubscribeMemoryEventsRequest,
} from './generated/runtime/v1/memory';
import type {
  RuntimeCallOptions,
  RuntimeStreamCallOptions,
} from './types.js';

export type RuntimeKnowledgeClient = {
  createKnowledgeBank(request: CreateKnowledgeBankRequest, options?: RuntimeCallOptions): Promise<CreateKnowledgeBankResponse>;
  getKnowledgeBank(request: GetKnowledgeBankRequest, options?: RuntimeCallOptions): Promise<GetKnowledgeBankResponse>;
  listKnowledgeBanks(request: ListKnowledgeBanksRequest, options?: RuntimeCallOptions): Promise<ListKnowledgeBanksResponse>;
  deleteKnowledgeBank(request: DeleteKnowledgeBankRequest, options?: RuntimeCallOptions): Promise<DeleteKnowledgeBankResponse>;
  putPage(request: PutPageRequest, options?: RuntimeCallOptions): Promise<PutPageResponse>;
  getPage(request: GetPageRequest, options?: RuntimeCallOptions): Promise<GetPageResponse>;
  listPages(request: ListPagesRequest, options?: RuntimeCallOptions): Promise<ListPagesResponse>;
  deletePage(request: DeletePageRequest, options?: RuntimeCallOptions): Promise<DeletePageResponse>;
  searchKeyword(request: SearchKeywordRequest, options?: RuntimeCallOptions): Promise<SearchKeywordResponse>;
  searchHybrid(request: SearchHybridRequest, options?: RuntimeCallOptions): Promise<SearchHybridResponse>;
  addLink(request: AddLinkRequest, options?: RuntimeCallOptions): Promise<AddLinkResponse>;
  removeLink(request: RemoveLinkRequest, options?: RuntimeCallOptions): Promise<RemoveLinkResponse>;
  listLinks(request: ListLinksRequest, options?: RuntimeCallOptions): Promise<ListLinksResponse>;
  listBacklinks(request: ListBacklinksRequest, options?: RuntimeCallOptions): Promise<ListBacklinksResponse>;
  traverseGraph(request: TraverseGraphRequest, options?: RuntimeCallOptions): Promise<TraverseGraphResponse>;
  ingestDocument(request: IngestDocumentRequest, options?: RuntimeCallOptions): Promise<IngestDocumentResponse>;
  getIngestTask(request: GetIngestTaskRequest, options?: RuntimeCallOptions): Promise<GetIngestTaskResponse>;
};

export type RuntimeMemoryClient = {
  createBank(request: CreateBankRequest, options?: RuntimeCallOptions): Promise<CreateBankResponse>;
  getBank(request: GetBankRequest, options?: RuntimeCallOptions): Promise<GetBankResponse>;
  listBanks(request: ListBanksRequest, options?: RuntimeCallOptions): Promise<ListBanksResponse>;
  deleteBank(request: DeleteBankRequest, options?: RuntimeCallOptions): Promise<DeleteBankResponse>;
  retain(request: RetainRequest, options?: RuntimeCallOptions): Promise<RetainResponse>;
  recall(request: RecallRequest, options?: RuntimeCallOptions): Promise<RecallResponse>;
  history(request: HistoryRequest, options?: RuntimeCallOptions): Promise<HistoryResponse>;
  deleteMemory(request: DeleteMemoryRequest, options?: RuntimeCallOptions): Promise<DeleteMemoryResponse>;
  getMemoryEmbeddingRuntimeIntent(request: GetMemoryEmbeddingRuntimeIntentRequest, options?: RuntimeCallOptions): Promise<GetMemoryEmbeddingRuntimeIntentResponse>;
  setMemoryEmbeddingRuntimeIntent(request: SetMemoryEmbeddingRuntimeIntentRequest, options?: RuntimeCallOptions): Promise<SetMemoryEmbeddingRuntimeIntentResponse>;
  inspectMemoryEmbeddingRuntime(request: InspectMemoryEmbeddingRuntimeRequest, options?: RuntimeCallOptions): Promise<InspectMemoryEmbeddingRuntimeResponse>;
  requestMemoryEmbeddingRuntimeBind(request: RequestMemoryEmbeddingRuntimeBindRequest, options?: RuntimeCallOptions): Promise<RequestMemoryEmbeddingRuntimeBindResponse>;
  requestMemoryEmbeddingRuntimeCutover(request: RequestMemoryEmbeddingRuntimeCutoverRequest, options?: RuntimeCallOptions): Promise<RequestMemoryEmbeddingRuntimeCutoverResponse>;
  subscribeEvents(
    request: SubscribeMemoryEventsRequest,
    options?: RuntimeStreamCallOptions,
  ): Promise<AsyncIterable<MemoryEvent>>;
};
