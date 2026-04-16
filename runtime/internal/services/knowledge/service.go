package knowledge

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	defaultKeywordTopK          = 5
	maxKeywordTopK              = 50
	defaultBankPageSize         = 50
	maxBankPageSize             = 100
	defaultPagePageSize         = 50
	maxPagePageSize             = 100
	defaultHybridPageSize       = 10
	maxHybridPageSize           = 100
	defaultGraphPageSize        = 25
	maxGraphPageSize            = 100
	defaultGraphTraversalDepth  = 2
	maxGraphTraversalDepth      = 5
	knowledgeEmbeddingDimension = 32
)

type bankState struct {
	Bank       *runtimev1.KnowledgeBank
	PagesByID  map[string]*runtimev1.KnowledgePage
	SlugToPage map[string]string
	LinksByID  map[string]*runtimev1.KnowledgeLink
}

type ingestTaskState struct {
	Task  *runtimev1.KnowledgeIngestTask
	AppID string
}

// Service provides runtime-local knowledge backing state for cognition surfaces.
type Service struct {
	logger  *slog.Logger
	backend *runtimepersistence.Backend

	ownsBackend bool

	mu              sync.RWMutex
	banksByID       map[string]*bankState
	bankIDByOwner   map[string]string
	ingestTasksByID map[string]*ingestTaskState
}

func New(logger *slog.Logger) *Service {
	svc, _ := newService(logger, nil, false)
	return svc
}

func NewWithBackend(logger *slog.Logger, backend *runtimepersistence.Backend) (*Service, error) {
	return newService(logger, backend, false)
}

func NewPersistent(logger *slog.Logger, localStatePath string) (*Service, error) {
	backend, err := runtimepersistence.Open(logger, localStatePath)
	if err != nil {
		return nil, err
	}
	svc, err := newService(logger, backend, true)
	if err != nil {
		_ = backend.Close()
		return nil, err
	}
	return svc, nil
}

func newService(logger *slog.Logger, backend *runtimepersistence.Backend, ownsBackend bool) (*Service, error) {
	if logger == nil {
		logger = slog.Default()
	}
	svc := &Service{
		logger:          logger,
		backend:         backend,
		ownsBackend:     ownsBackend,
		banksByID:       make(map[string]*bankState),
		bankIDByOwner:   make(map[string]string),
		ingestTasksByID: make(map[string]*ingestTaskState),
	}
	if err := svc.loadState(); err != nil {
		return nil, err
	}
	return svc, nil
}

func (s *Service) Close() error {
	if s == nil || s.backend == nil || !s.ownsBackend {
		return nil
	}
	return s.backend.Close()
}

func (s *Service) lookupPage(ctx *runtimev1.KnowledgeRequestContext, bankID, pageID, slug string) (*bankState, *runtimev1.KnowledgePage, error) {
	bankID = strings.TrimSpace(bankID)
	pageID = strings.TrimSpace(pageID)
	slug = strings.TrimSpace(slug)
	if bankID == "" || (pageID == "" && slug == "") {
		return nil, nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	s.mu.RLock()
	defer s.mu.RUnlock()
	state := s.banksByID[bankID]
	if state == nil || state.Bank == nil {
		return nil, nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_BANK_NOT_FOUND)
	}
	if err := authorizeBank(ctx, state.Bank); err != nil {
		return nil, nil, err
	}
	page := resolveExistingPage(state, pageID, slug)
	if page == nil {
		return nil, nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_PAGE_NOT_FOUND)
	}
	return state, page, nil
}

func validateRequestContext(ctx *runtimev1.KnowledgeRequestContext) error {
	if strings.TrimSpace(ctx.GetAppId()) == "" {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	return nil
}

func validateCreateBankAccess(ctx *runtimev1.KnowledgeRequestContext, locator *runtimev1.KnowledgeBankLocator) error {
	if locator == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if app := locator.GetAppPrivate(); app != nil {
		if strings.TrimSpace(app.GetAppId()) == "" {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		if strings.TrimSpace(ctx.GetAppId()) != strings.TrimSpace(app.GetAppId()) {
			return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_KNOWLEDGE_BANK_ACCESS_DENIED)
		}
		return nil
	}
	if workspace := locator.GetWorkspacePrivate(); workspace != nil {
		if strings.TrimSpace(workspace.GetWorkspaceId()) == "" {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		return nil
	}
	return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_KNOWLEDGE_BANK_SCOPE_INVALID)
}

func authorizeBank(ctx *runtimev1.KnowledgeRequestContext, bank *runtimev1.KnowledgeBank) error {
	if bank == nil || bank.GetLocator() == nil {
		return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_BANK_NOT_FOUND)
	}
	if bank.GetLocator().GetAppPrivate() != nil {
		if strings.TrimSpace(ctx.GetAppId()) != strings.TrimSpace(bank.GetLocator().GetAppPrivate().GetAppId()) {
			return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_KNOWLEDGE_BANK_ACCESS_DENIED)
		}
	}
	return nil
}

func fullLocatorFromPublic(locator *runtimev1.PublicKnowledgeBankLocator) (*runtimev1.KnowledgeBankLocator, error) {
	if locator == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if app := locator.GetAppPrivate(); app != nil {
		if strings.TrimSpace(app.GetAppId()) == "" {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		return &runtimev1.KnowledgeBankLocator{
			Scope: runtimev1.KnowledgeBankScope_KNOWLEDGE_BANK_SCOPE_APP_PRIVATE,
			Owner: &runtimev1.KnowledgeBankLocator_AppPrivate{AppPrivate: cloneKnowledgeAppOwner(app)},
		}, nil
	}
	if workspace := locator.GetWorkspacePrivate(); workspace != nil {
		if strings.TrimSpace(workspace.GetWorkspaceId()) == "" {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		return &runtimev1.KnowledgeBankLocator{
			Scope: runtimev1.KnowledgeBankScope_KNOWLEDGE_BANK_SCOPE_WORKSPACE_PRIVATE,
			Owner: &runtimev1.KnowledgeBankLocator_WorkspacePrivate{WorkspacePrivate: cloneKnowledgeWorkspaceOwner(workspace)},
		}, nil
	}
	return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_KNOWLEDGE_BANK_SCOPE_INVALID)
}

func locatorKey(locator *runtimev1.KnowledgeBankLocator) string {
	switch owner := locator.GetOwner().(type) {
	case *runtimev1.KnowledgeBankLocator_AppPrivate:
		return fmt.Sprintf("app_private:%s", strings.TrimSpace(owner.AppPrivate.GetAppId()))
	case *runtimev1.KnowledgeBankLocator_WorkspacePrivate:
		return fmt.Sprintf("workspace_private:%s", strings.TrimSpace(owner.WorkspacePrivate.GetWorkspaceId()))
	default:
		return ""
	}
}

func ownerFilterKey(filter *runtimev1.KnowledgeBankOwnerFilter) string {
	switch owner := filter.GetOwner().(type) {
	case *runtimev1.KnowledgeBankOwnerFilter_AppPrivate:
		return fmt.Sprintf("app_private:%s", strings.TrimSpace(owner.AppPrivate.GetAppId()))
	case *runtimev1.KnowledgeBankOwnerFilter_WorkspacePrivate:
		return fmt.Sprintf("workspace_private:%s", strings.TrimSpace(owner.WorkspacePrivate.GetWorkspaceId()))
	default:
		return ""
	}
}

func matchesBankFilters(bank *runtimev1.KnowledgeBank, scopes []runtimev1.KnowledgeBankScope, owners []*runtimev1.KnowledgeBankOwnerFilter) bool {
	if bank == nil || bank.GetLocator() == nil {
		return false
	}
	if len(scopes) > 0 {
		matched := false
		for _, scope := range scopes {
			if bank.GetLocator().GetScope() == scope {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}
	if len(owners) > 0 {
		key := locatorKey(bank.GetLocator())
		for _, owner := range owners {
			if key == ownerFilterKey(owner) {
				return true
			}
		}
		return false
	}
	return true
}

func matchesPageFilters(page *runtimev1.KnowledgePage, entityTypes []string, slugPrefix string) bool {
	if page == nil {
		return false
	}
	if len(entityTypes) > 0 {
		matched := false
		for _, entityType := range entityTypes {
			if strings.EqualFold(strings.TrimSpace(entityType), strings.TrimSpace(page.GetEntityType())) {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}
	if prefix := strings.TrimSpace(slugPrefix); prefix != "" && !strings.HasPrefix(page.GetSlug(), prefix) {
		return false
	}
	return true
}

func matchesLinkTypeFilters(link *runtimev1.KnowledgeLink, linkTypes []string) bool {
	if link == nil {
		return false
	}
	if len(linkTypes) == 0 {
		return true
	}
	for _, linkType := range linkTypes {
		if strings.EqualFold(strings.TrimSpace(linkType), strings.TrimSpace(link.GetLinkType())) {
			return true
		}
	}
	return false
}

func resolveExistingPage(state *bankState, pageID, slug string) *runtimev1.KnowledgePage {
	pageID = strings.TrimSpace(pageID)
	slug = strings.TrimSpace(slug)
	if pageID != "" {
		if page := state.PagesByID[pageID]; page != nil {
			return page
		}
	}
	if slug != "" {
		if existingID := state.SlugToPage[slug]; existingID != "" {
			return state.PagesByID[existingID]
		}
	}
	return nil
}

func findDuplicateLink(state *bankState, fromPageID, toPageID, linkType string) *runtimev1.KnowledgeLink {
	if state == nil {
		return nil
	}
	for _, link := range state.LinksByID {
		if link == nil {
			continue
		}
		if link.GetFromPageId() == fromPageID && link.GetToPageId() == toPageID && strings.EqualFold(link.GetLinkType(), linkType) {
			return link
		}
	}
	return nil
}

func outgoingLinksForPage(state *bankState, pageID string, linkTypes []string) []*runtimev1.KnowledgeLink {
	items := make([]*runtimev1.KnowledgeLink, 0)
	if state == nil {
		return items
	}
	for _, link := range state.LinksByID {
		if link == nil || link.GetFromPageId() != pageID {
			continue
		}
		if !matchesLinkTypeFilters(link, linkTypes) {
			continue
		}
		items = append(items, link)
	}
	return items
}

func buildGraphEdge(state *bankState, link *runtimev1.KnowledgeLink) *runtimev1.KnowledgeGraphEdge {
	if state == nil || link == nil {
		return nil
	}
	fromPage := state.PagesByID[link.GetFromPageId()]
	toPage := state.PagesByID[link.GetToPageId()]
	return &runtimev1.KnowledgeGraphEdge{
		Link:           cloneKnowledgeLink(link),
		FromSlug:       pageStringValue(fromPage, func(page *runtimev1.KnowledgePage) string { return page.GetSlug() }),
		FromTitle:      pageStringValue(fromPage, func(page *runtimev1.KnowledgePage) string { return page.GetTitle() }),
		FromEntityType: pageStringValue(fromPage, func(page *runtimev1.KnowledgePage) string { return page.GetEntityType() }),
		ToSlug:         pageStringValue(toPage, func(page *runtimev1.KnowledgePage) string { return page.GetSlug() }),
		ToTitle:        pageStringValue(toPage, func(page *runtimev1.KnowledgePage) string { return page.GetTitle() }),
		ToEntityType:   pageStringValue(toPage, func(page *runtimev1.KnowledgePage) string { return page.GetEntityType() }),
	}
}

func pageStringValue(page *runtimev1.KnowledgePage, selector func(*runtimev1.KnowledgePage) string) string {
	if page == nil || selector == nil {
		return ""
	}
	return selector(page)
}

func defaultBankDisplayName(locator *runtimev1.KnowledgeBankLocator, displayName string) string {
	if trimmed := strings.TrimSpace(displayName); trimmed != "" {
		return trimmed
	}
	switch locator.GetScope() {
	case runtimev1.KnowledgeBankScope_KNOWLEDGE_BANK_SCOPE_APP_PRIVATE:
		return "App Private Knowledge"
	case runtimev1.KnowledgeBankScope_KNOWLEDGE_BANK_SCOPE_WORKSPACE_PRIVATE:
		return "Workspace Private Knowledge"
	default:
		return "Knowledge Bank"
	}
}

func defaultPageTitle(slug, title string) string {
	if trimmed := strings.TrimSpace(title); trimmed != "" {
		return trimmed
	}
	return slug
}

func deriveBankID(locator *runtimev1.KnowledgeBankLocator) string {
	sum := sha256.Sum256([]byte(locatorKey(locator)))
	prefix := strings.TrimPrefix(strings.ToLower(locator.GetScope().String()), "knowledge_bank_scope_")
	return "nimi-knowledge-" + prefix + "-" + hex.EncodeToString(sum[:8])
}

func normalizeBankIDs(values []string) []string {
	items := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, raw := range values {
		value := strings.TrimSpace(raw)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		items = append(items, value)
	}
	return items
}

func sliceBounds(total, offset, pageSize int) (start, end int, next string) {
	start = offset
	if start > total {
		start = total
	}
	end = start + pageSize
	if end > total {
		end = total
	}
	if end < total {
		next = encodePageToken(end)
	}
	return start, end, next
}

func clampPageSize(value int32, defaultValue, maxValue int) int {
	pageSize := int(value)
	if pageSize <= 0 {
		return defaultValue
	}
	if pageSize > maxValue {
		return maxValue
	}
	return pageSize
}

func encodePageToken(offset int) string {
	return base64.RawURLEncoding.EncodeToString([]byte(strconv.Itoa(offset)))
}

func decodePageToken(token string) (int, error) {
	if strings.TrimSpace(token) == "" {
		return 0, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return 0, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PAGE_TOKEN_INVALID)
	}
	offset, err := strconv.Atoi(string(raw))
	if err != nil || offset < 0 {
		return 0, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PAGE_TOKEN_INVALID)
	}
	return offset, nil
}

func timestampValue(ts *timestamppb.Timestamp) time.Time {
	if ts == nil {
		return time.Time{}
	}
	return ts.AsTime().UTC()
}

func cloneStruct(value *structpb.Struct) *structpb.Struct {
	if value == nil {
		return nil
	}
	cloned, _ := proto.Clone(value).(*structpb.Struct)
	return cloned
}

func cloneKnowledgeBank(value *runtimev1.KnowledgeBank) *runtimev1.KnowledgeBank {
	if value == nil {
		return nil
	}
	cloned, _ := proto.Clone(value).(*runtimev1.KnowledgeBank)
	return cloned
}

func cloneKnowledgePage(value *runtimev1.KnowledgePage) *runtimev1.KnowledgePage {
	if value == nil {
		return nil
	}
	cloned, _ := proto.Clone(value).(*runtimev1.KnowledgePage)
	return cloned
}

func cloneKnowledgeLink(value *runtimev1.KnowledgeLink) *runtimev1.KnowledgeLink {
	if value == nil {
		return nil
	}
	cloned, _ := proto.Clone(value).(*runtimev1.KnowledgeLink)
	return cloned
}

func cloneKnowledgeIngestTask(value *runtimev1.KnowledgeIngestTask) *runtimev1.KnowledgeIngestTask {
	if value == nil {
		return nil
	}
	cloned, _ := proto.Clone(value).(*runtimev1.KnowledgeIngestTask)
	return cloned
}

func cloneKnowledgeLocator(value *runtimev1.KnowledgeBankLocator) *runtimev1.KnowledgeBankLocator {
	if value == nil {
		return nil
	}
	cloned, _ := proto.Clone(value).(*runtimev1.KnowledgeBankLocator)
	return cloned
}

func cloneKnowledgeAppOwner(value *runtimev1.KnowledgeAppPrivateOwner) *runtimev1.KnowledgeAppPrivateOwner {
	if value == nil {
		return nil
	}
	cloned, _ := proto.Clone(value).(*runtimev1.KnowledgeAppPrivateOwner)
	return cloned
}

func cloneKnowledgeWorkspaceOwner(value *runtimev1.KnowledgeWorkspacePrivateOwner) *runtimev1.KnowledgeWorkspacePrivateOwner {
	if value == nil {
		return nil
	}
	cloned, _ := proto.Clone(value).(*runtimev1.KnowledgeWorkspacePrivateOwner)
	return cloned
}

func cloneBankState(value *bankState) *bankState {
	if value == nil {
		return nil
	}
	cloned := &bankState{
		Bank:       cloneKnowledgeBank(value.Bank),
		PagesByID:  make(map[string]*runtimev1.KnowledgePage, len(value.PagesByID)),
		SlugToPage: make(map[string]string, len(value.SlugToPage)),
		LinksByID:  make(map[string]*runtimev1.KnowledgeLink, len(value.LinksByID)),
	}
	for pageID, page := range value.PagesByID {
		cloned.PagesByID[pageID] = cloneKnowledgePage(page)
	}
	for slug, pageID := range value.SlugToPage {
		cloned.SlugToPage[slug] = pageID
	}
	for linkID, link := range value.LinksByID {
		cloned.LinksByID[linkID] = cloneKnowledgeLink(link)
	}
	return cloned
}

func cloneIngestTaskState(value *ingestTaskState) *ingestTaskState {
	if value == nil {
		return nil
	}
	return &ingestTaskState{
		Task:  cloneKnowledgeIngestTask(value.Task),
		AppID: value.AppID,
	}
}

func cloneIngestDocumentRequest(value *runtimev1.IngestDocumentRequest) *runtimev1.IngestDocumentRequest {
	if value == nil {
		return nil
	}
	cloned, _ := proto.Clone(value).(*runtimev1.IngestDocumentRequest)
	return cloned
}

func authorizeIngestTask(ctx *runtimev1.KnowledgeRequestContext, task *ingestTaskState) error {
	if task == nil || task.Task == nil {
		return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_INGEST_TASK_NOT_FOUND)
	}
	if strings.TrimSpace(task.AppID) != "" && strings.TrimSpace(ctx.GetAppId()) != strings.TrimSpace(task.AppID) {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_KNOWLEDGE_BANK_ACCESS_DENIED)
	}
	return nil
}
