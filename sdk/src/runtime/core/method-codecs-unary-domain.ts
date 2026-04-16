import { RuntimeMethodIds } from '../method-ids';
import {
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
  SearchKeywordRequest,
  SearchKeywordResponse,
  SearchHybridRequest,
  SearchHybridResponse,
  TraverseGraphRequest,
  TraverseGraphResponse,
} from '../generated/runtime/v1/knowledge';
import {
  CreateBankRequest,
  CreateBankResponse,
  DeleteBankRequest,
  DeleteBankResponse,
  DeleteMemoryRequest,
  DeleteMemoryResponse,
  GetBankRequest,
  GetBankResponse,
  HistoryRequest,
  HistoryResponse,
  ListBanksRequest,
  ListBanksResponse,
  RecallRequest,
  RecallResponse,
  RetainRequest,
  RetainResponse,
} from '../generated/runtime/v1/memory';
import {
  CancelHookRequest,
  CancelHookResponse,
  DisableAutonomyRequest,
  DisableAutonomyResponse,
  EnableAutonomyRequest,
  EnableAutonomyResponse,
  GetAgentRequest,
  GetAgentResponse,
  GetAgentStateRequest,
  GetAgentStateResponse,
  InitializeAgentRequest,
  InitializeAgentResponse,
  ListAgentsRequest,
  ListAgentsResponse,
  ListPendingHooksRequest,
  ListPendingHooksResponse,
  QueryAgentMemoryRequest,
  QueryAgentMemoryResponse,
  SetAutonomyConfigRequest,
  SetAutonomyConfigResponse,
  TerminateAgentRequest,
  TerminateAgentResponse,
  UpdateAgentStateRequest,
  UpdateAgentStateResponse,
  WriteAgentMemoryRequest,
  WriteAgentMemoryResponse,
} from '../generated/runtime/v1/agent_core';
import {
  CreateConnectorRequest,
  CreateConnectorResponse,
  DeleteCatalogModelOverlayRequest,
  DeleteCatalogModelOverlayResponse,
  DeleteConnectorRequest,
  DeleteConnectorResponse,
  DeleteModelCatalogProviderRequest,
  DeleteModelCatalogProviderResponse,
  GetCatalogModelDetailRequest,
  GetCatalogModelDetailResponse,
  GetConnectorRequest,
  GetConnectorResponse,
  ListCatalogProviderModelsRequest,
  ListCatalogProviderModelsResponse,
  ListConnectorModelsRequest,
  ListConnectorModelsResponse,
  ListConnectorsRequest,
  ListConnectorsResponse,
  ListModelCatalogProvidersRequest,
  ListModelCatalogProvidersResponse,
  ListProviderCatalogRequest,
  ListProviderCatalogResponse,
  TestConnectorRequest,
  TestConnectorResponse,
  UpdateConnectorRequest,
  UpdateConnectorResponse,
  UpsertCatalogModelOverlayRequest,
  UpsertCatalogModelOverlayResponse,
  UpsertModelCatalogProviderRequest,
  UpsertModelCatalogProviderResponse,
} from '../generated/runtime/v1/connector';
import {
  AppMessageEvent,
  SendAppMessageRequest,
  SendAppMessageResponse,
} from '../generated/runtime/v1/app';
import {
  GetRuntimeHealthRequest,
  GetRuntimeHealthResponse,
  ListAIProviderHealthRequest,
  ListAIProviderHealthResponse,
  ListAuditEventsRequest,
  ListAuditEventsResponse,
  ListUsageStatsRequest,
  ListUsageStatsResponse,
} from '../generated/runtime/v1/audit';
import type { RuntimeUnaryMethodCodecMap } from './method-codecs-types';

export const runtimeUnaryMethodCodecsDomain: Partial<RuntimeUnaryMethodCodecMap> = {
  [RuntimeMethodIds.connector.createConnector]: {
    requestType: CreateConnectorRequest,
    responseType: CreateConnectorResponse,
  },
  [RuntimeMethodIds.connector.getConnector]: {
    requestType: GetConnectorRequest,
    responseType: GetConnectorResponse,
  },
  [RuntimeMethodIds.connector.listConnectors]: {
    requestType: ListConnectorsRequest,
    responseType: ListConnectorsResponse,
  },
  [RuntimeMethodIds.connector.updateConnector]: {
    requestType: UpdateConnectorRequest,
    responseType: UpdateConnectorResponse,
  },
  [RuntimeMethodIds.connector.deleteConnector]: {
    requestType: DeleteConnectorRequest,
    responseType: DeleteConnectorResponse,
  },
  [RuntimeMethodIds.connector.testConnector]: {
    requestType: TestConnectorRequest,
    responseType: TestConnectorResponse,
  },
  [RuntimeMethodIds.connector.listConnectorModels]: {
    requestType: ListConnectorModelsRequest,
    responseType: ListConnectorModelsResponse,
  },
  [RuntimeMethodIds.connector.listProviderCatalog]: {
    requestType: ListProviderCatalogRequest,
    responseType: ListProviderCatalogResponse,
  },
  [RuntimeMethodIds.connector.listModelCatalogProviders]: {
    requestType: ListModelCatalogProvidersRequest,
    responseType: ListModelCatalogProvidersResponse,
  },
  [RuntimeMethodIds.connector.listCatalogProviderModels]: {
    requestType: ListCatalogProviderModelsRequest,
    responseType: ListCatalogProviderModelsResponse,
  },
  [RuntimeMethodIds.connector.getCatalogModelDetail]: {
    requestType: GetCatalogModelDetailRequest,
    responseType: GetCatalogModelDetailResponse,
  },
  [RuntimeMethodIds.connector.upsertModelCatalogProvider]: {
    requestType: UpsertModelCatalogProviderRequest,
    responseType: UpsertModelCatalogProviderResponse,
  },
  [RuntimeMethodIds.connector.deleteModelCatalogProvider]: {
    requestType: DeleteModelCatalogProviderRequest,
    responseType: DeleteModelCatalogProviderResponse,
  },
  [RuntimeMethodIds.connector.upsertCatalogModelOverlay]: {
    requestType: UpsertCatalogModelOverlayRequest,
    responseType: UpsertCatalogModelOverlayResponse,
  },
  [RuntimeMethodIds.connector.deleteCatalogModelOverlay]: {
    requestType: DeleteCatalogModelOverlayRequest,
    responseType: DeleteCatalogModelOverlayResponse,
  },
  [RuntimeMethodIds.knowledge.createKnowledgeBank]: {
    requestType: CreateKnowledgeBankRequest,
    responseType: CreateKnowledgeBankResponse,
  },
  [RuntimeMethodIds.knowledge.getKnowledgeBank]: {
    requestType: GetKnowledgeBankRequest,
    responseType: GetKnowledgeBankResponse,
  },
  [RuntimeMethodIds.knowledge.listKnowledgeBanks]: {
    requestType: ListKnowledgeBanksRequest,
    responseType: ListKnowledgeBanksResponse,
  },
  [RuntimeMethodIds.knowledge.deleteKnowledgeBank]: {
    requestType: DeleteKnowledgeBankRequest,
    responseType: DeleteKnowledgeBankResponse,
  },
  [RuntimeMethodIds.knowledge.putPage]: {
    requestType: PutPageRequest,
    responseType: PutPageResponse,
  },
  [RuntimeMethodIds.knowledge.getPage]: {
    requestType: GetPageRequest,
    responseType: GetPageResponse,
  },
  [RuntimeMethodIds.knowledge.listPages]: {
    requestType: ListPagesRequest,
    responseType: ListPagesResponse,
  },
  [RuntimeMethodIds.knowledge.deletePage]: {
    requestType: DeletePageRequest,
    responseType: DeletePageResponse,
  },
  [RuntimeMethodIds.knowledge.ingestDocument]: {
    requestType: IngestDocumentRequest,
    responseType: IngestDocumentResponse,
  },
  [RuntimeMethodIds.knowledge.getIngestTask]: {
    requestType: GetIngestTaskRequest,
    responseType: GetIngestTaskResponse,
  },
  [RuntimeMethodIds.knowledge.searchKeyword]: {
    requestType: SearchKeywordRequest,
    responseType: SearchKeywordResponse,
  },
  [RuntimeMethodIds.knowledge.searchHybrid]: {
    requestType: SearchHybridRequest,
    responseType: SearchHybridResponse,
  },
  [RuntimeMethodIds.knowledge.addLink]: {
    requestType: AddLinkRequest,
    responseType: AddLinkResponse,
  },
  [RuntimeMethodIds.knowledge.removeLink]: {
    requestType: RemoveLinkRequest,
    responseType: RemoveLinkResponse,
  },
  [RuntimeMethodIds.knowledge.listLinks]: {
    requestType: ListLinksRequest,
    responseType: ListLinksResponse,
  },
  [RuntimeMethodIds.knowledge.listBacklinks]: {
    requestType: ListBacklinksRequest,
    responseType: ListBacklinksResponse,
  },
  [RuntimeMethodIds.knowledge.traverseGraph]: {
    requestType: TraverseGraphRequest,
    responseType: TraverseGraphResponse,
  },
  [RuntimeMethodIds.memory.createBank]: {
    requestType: CreateBankRequest,
    responseType: CreateBankResponse,
  },
  [RuntimeMethodIds.memory.getBank]: {
    requestType: GetBankRequest,
    responseType: GetBankResponse,
  },
  [RuntimeMethodIds.memory.listBanks]: {
    requestType: ListBanksRequest,
    responseType: ListBanksResponse,
  },
  [RuntimeMethodIds.memory.deleteBank]: {
    requestType: DeleteBankRequest,
    responseType: DeleteBankResponse,
  },
  [RuntimeMethodIds.memory.retain]: {
    requestType: RetainRequest,
    responseType: RetainResponse,
  },
  [RuntimeMethodIds.memory.recall]: {
    requestType: RecallRequest,
    responseType: RecallResponse,
  },
  [RuntimeMethodIds.memory.history]: {
    requestType: HistoryRequest,
    responseType: HistoryResponse,
  },
  [RuntimeMethodIds.memory.deleteMemory]: {
    requestType: DeleteMemoryRequest,
    responseType: DeleteMemoryResponse,
  },
  [RuntimeMethodIds.agentCore.initializeAgent]: {
    requestType: InitializeAgentRequest,
    responseType: InitializeAgentResponse,
  },
  [RuntimeMethodIds.agentCore.terminateAgent]: {
    requestType: TerminateAgentRequest,
    responseType: TerminateAgentResponse,
  },
  [RuntimeMethodIds.agentCore.getAgent]: {
    requestType: GetAgentRequest,
    responseType: GetAgentResponse,
  },
  [RuntimeMethodIds.agentCore.listAgents]: {
    requestType: ListAgentsRequest,
    responseType: ListAgentsResponse,
  },
  [RuntimeMethodIds.agentCore.getAgentState]: {
    requestType: GetAgentStateRequest,
    responseType: GetAgentStateResponse,
  },
  [RuntimeMethodIds.agentCore.updateAgentState]: {
    requestType: UpdateAgentStateRequest,
    responseType: UpdateAgentStateResponse,
  },
  [RuntimeMethodIds.agentCore.enableAutonomy]: {
    requestType: EnableAutonomyRequest,
    responseType: EnableAutonomyResponse,
  },
  [RuntimeMethodIds.agentCore.disableAutonomy]: {
    requestType: DisableAutonomyRequest,
    responseType: DisableAutonomyResponse,
  },
  [RuntimeMethodIds.agentCore.setAutonomyConfig]: {
    requestType: SetAutonomyConfigRequest,
    responseType: SetAutonomyConfigResponse,
  },
  [RuntimeMethodIds.agentCore.listPendingHooks]: {
    requestType: ListPendingHooksRequest,
    responseType: ListPendingHooksResponse,
  },
  [RuntimeMethodIds.agentCore.cancelHook]: {
    requestType: CancelHookRequest,
    responseType: CancelHookResponse,
  },
  [RuntimeMethodIds.agentCore.queryMemory]: {
    requestType: QueryAgentMemoryRequest,
    responseType: QueryAgentMemoryResponse,
  },
  [RuntimeMethodIds.agentCore.writeMemory]: {
    requestType: WriteAgentMemoryRequest,
    responseType: WriteAgentMemoryResponse,
  },
  [RuntimeMethodIds.app.sendAppMessage]: {
    requestType: SendAppMessageRequest,
    responseType: SendAppMessageResponse,
  },
  [RuntimeMethodIds.audit.listAuditEvents]: {
    requestType: ListAuditEventsRequest,
    responseType: ListAuditEventsResponse,
  },
  [RuntimeMethodIds.audit.listUsageStats]: {
    requestType: ListUsageStatsRequest,
    responseType: ListUsageStatsResponse,
  },
  [RuntimeMethodIds.audit.getRuntimeHealth]: {
    requestType: GetRuntimeHealthRequest,
    responseType: GetRuntimeHealthResponse,
  },
  [RuntimeMethodIds.audit.listAIProviderHealth]: {
    requestType: ListAIProviderHealthRequest,
    responseType: ListAIProviderHealthResponse,
  },
} satisfies Partial<RuntimeUnaryMethodCodecMap>;
