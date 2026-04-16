package knowledge

import (
	"context"
	"crypto/sha256"
	"math"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func (s *Service) SearchKeyword(_ context.Context, req *runtimev1.SearchKeywordRequest) (*runtimev1.SearchKeywordResponse, error) {
	if err := validateRequestContext(req.GetContext()); err != nil {
		return nil, err
	}
	query := strings.TrimSpace(req.GetQuery())
	if query == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	topK := int(req.GetTopK())
	if topK <= 0 {
		topK = defaultKeywordTopK
	} else if topK > maxKeywordTopK {
		topK = maxKeywordTopK
	}

	bankIDs := normalizeBankIDs(req.GetBankIds())
	s.mu.RLock()
	defer s.mu.RUnlock()

	targetBanks := make([]*bankState, 0, len(s.banksByID))
	if len(bankIDs) == 0 {
		for _, state := range s.banksByID {
			if state == nil || state.Bank == nil {
				continue
			}
			if authorizeBank(req.GetContext(), state.Bank) != nil {
				continue
			}
			targetBanks = append(targetBanks, state)
		}
	} else {
		for _, bankID := range bankIDs {
			state := s.banksByID[bankID]
			if state == nil || state.Bank == nil {
				return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_BANK_NOT_FOUND)
			}
			if err := authorizeBank(req.GetContext(), state.Bank); err != nil {
				return nil, err
			}
			targetBanks = append(targetBanks, state)
		}
	}

	queryLower := strings.ToLower(query)
	hits := make([]*runtimev1.KnowledgeKeywordHit, 0)
	for _, state := range targetBanks {
		for _, page := range state.PagesByID {
			if !matchesPageFilters(page, req.GetEntityTypeFilters(), req.GetSlugPrefix()) {
				continue
			}
			text := page.GetTitle() + "\n" + page.GetContent()
			textLower := strings.ToLower(text)
			if !strings.Contains(textLower, queryLower) {
				continue
			}
			hits = append(hits, &runtimev1.KnowledgeKeywordHit{
				BankId:   page.GetBankId(),
				PageId:   page.GetPageId(),
				Slug:     page.GetSlug(),
				Title:    page.GetTitle(),
				Snippet:  snippet(text, query),
				Score:    1.0,
				Metadata: cloneStruct(page.GetMetadata()),
			})
		}
	}

	sort.Slice(hits, func(i, j int) bool {
		if hits[i].GetScore() == hits[j].GetScore() {
			if hits[i].GetBankId() == hits[j].GetBankId() {
				return hits[i].GetPageId() < hits[j].GetPageId()
			}
			return hits[i].GetBankId() < hits[j].GetBankId()
		}
		return hits[i].GetScore() > hits[j].GetScore()
	})
	if len(hits) > topK {
		hits = hits[:topK]
	}
	return &runtimev1.SearchKeywordResponse{Hits: hits, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) SearchHybrid(_ context.Context, req *runtimev1.SearchHybridRequest) (*runtimev1.SearchHybridResponse, error) {
	if err := validateRequestContext(req.GetContext()); err != nil {
		return nil, err
	}
	bankID := strings.TrimSpace(req.GetBankId())
	query := strings.TrimSpace(req.GetQuery())
	if bankID == "" || query == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	offset, err := decodePageToken(req.GetPageToken())
	if err != nil {
		return nil, err
	}
	pageSize := clampPageSize(req.GetPageSize(), defaultHybridPageSize, maxHybridPageSize)
	queryVector := computeKnowledgeEmbedding(query, knowledgeEmbeddingDimension)
	queryLower := strings.ToLower(query)

	s.mu.RLock()
	state := s.banksByID[bankID]
	if state == nil || state.Bank == nil {
		s.mu.RUnlock()
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_BANK_NOT_FOUND)
	}
	if err := authorizeBank(req.GetContext(), state.Bank); err != nil {
		s.mu.RUnlock()
		return nil, err
	}
	type hybridHit struct {
		hit   *runtimev1.KnowledgeKeywordHit
		score float64
	}
	items := make([]hybridHit, 0, len(state.PagesByID))
	for _, page := range state.PagesByID {
		if !matchesPageFilters(page, req.GetEntityTypeFilters(), "") {
			continue
		}
		text := page.GetTitle() + "\n" + page.GetContent()
		lexicalScore := lexicalMatchScore(text, queryLower)
		vectorScore := cosineSimilarity(queryVector, computeKnowledgeEmbedding(text, knowledgeEmbeddingDimension))
		if lexicalScore <= 0 && vectorScore <= 0 {
			continue
		}
		score := lexicalScore*0.6 + maxFloat(vectorScore, 0)*0.4
		items = append(items, hybridHit{
			score: score,
			hit: &runtimev1.KnowledgeKeywordHit{
				BankId:   page.GetBankId(),
				PageId:   page.GetPageId(),
				Slug:     page.GetSlug(),
				Title:    page.GetTitle(),
				Snippet:  snippet(text, query),
				Score:    float32(score),
				Metadata: cloneStruct(page.GetMetadata()),
			},
		})
	}
	s.mu.RUnlock()

	sort.Slice(items, func(i, j int) bool {
		if items[i].score == items[j].score {
			return items[i].hit.GetPageId() < items[j].hit.GetPageId()
		}
		return items[i].score > items[j].score
	})

	start, end, next := sliceBounds(len(items), offset, pageSize)
	hits := make([]*runtimev1.KnowledgeKeywordHit, 0, end-start)
	for _, item := range items[start:end] {
		hits = append(hits, item.hit)
	}
	return &runtimev1.SearchHybridResponse{
		Hits:          hits,
		NextPageToken: next,
		ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func snippet(text string, query string) string {
	runes := []rune(text)
	if len(runes) <= 120 {
		return text
	}
	queryLower := strings.ToLower(query)
	textLower := strings.ToLower(text)
	idx := strings.Index(textLower, queryLower)
	if idx < 0 {
		return string(runes[:120])
	}
	start := utf8.RuneCountInString(text[:idx]) - 40
	if start < 0 {
		start = 0
	}
	end := start + 120
	if end > len(runes) {
		end = len(runes)
	}
	return string(runes[start:end])
}

func lexicalMatchScore(text string, queryLower string) float64 {
	textLower := strings.ToLower(strings.TrimSpace(text))
	if textLower == "" || queryLower == "" {
		return 0
	}
	count := strings.Count(textLower, queryLower)
	if count == 0 {
		return 0
	}
	return 1 + math.Min(float64(count-1)*0.25, 1.0)
}

func computeKnowledgeEmbedding(raw string, dimension int) []float64 {
	if dimension <= 0 {
		return nil
	}
	vector := make([]float64, dimension)
	tokens := strings.Fields(buildKnowledgeSearchTokens(raw))
	if len(tokens) == 0 {
		return vector
	}
	for _, token := range tokens {
		sum := sha256.Sum256([]byte(token))
		for idx := range vector {
			vector[idx] += float64(sum[idx%len(sum)])
		}
	}
	var norm float64
	for _, value := range vector {
		norm += value * value
	}
	if norm == 0 {
		return vector
	}
	norm = math.Sqrt(norm)
	for idx := range vector {
		vector[idx] = vector[idx] / norm
	}
	return vector
}

func cosineSimilarity(left []float64, right []float64) float64 {
	if len(left) == 0 || len(left) != len(right) {
		return 0
	}
	var dot float64
	for idx := range left {
		dot += left[idx] * right[idx]
	}
	return dot
}

func buildKnowledgeSearchTokens(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	parts := make([]string, 0)
	var latinBuilder strings.Builder
	flushLatin := func() {
		if latinBuilder.Len() == 0 {
			return
		}
		token := strings.TrimSpace(strings.ToLower(latinBuilder.String()))
		if token != "" {
			parts = append(parts, token)
		}
		latinBuilder.Reset()
	}
	for _, r := range trimmed {
		switch {
		case unicode.IsLetter(r) || unicode.IsNumber(r):
			latinBuilder.WriteRune(unicode.ToLower(r))
		default:
			flushLatin()
		}
	}
	flushLatin()
	return strings.Join(parts, " ")
}

func maxFloat(left, right float64) float64 {
	if left > right {
		return left
	}
	return right
}
