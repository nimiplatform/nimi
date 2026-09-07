package localservice

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// @nimi-authority: rule.nimi.runtime.local-compute.r026
func (s *Service) GetCatalogModelCard(ctx context.Context, req *runtimev1.GetCatalogModelCardRequest) (*runtimev1.GetCatalogModelCardResponse, error) {
	modelLocator, offerRef := strings.TrimSpace(req.GetModelLocator()), strings.TrimSpace(req.GetOfferRef())
	if (modelLocator == "") == (offerRef == "") {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, grpcerr.ReasonOptions{Message: "provide exactly one model_locator or offer_ref"})
	}
	var source, repo, revision string
	var err error
	if offerRef != "" {
		var identity modelAssetOfferIdentity
		identity, err = parseModelAssetOfferRef(offerRef)
		source, repo, revision = identity.sourceKind, identity.locator, identity.revision
	} else {
		source, repo, revision, err = parseModelAssetModelLocator(modelLocator)
	}
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, err, grpcerr.ReasonOptions{Message: "model card identity is invalid"})
	}
	if source != "huggingface" && source != "model-index" && source != "verified" {
		return nil, grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_TEMPLATE_NOT_FOUND, grpcerr.ReasonOptions{Message: "this catalog source has no Hugging Face model card"})
	}
	repo, err = normalizeHFRepo(repo)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_HF_REPO_INVALID, err, grpcerr.ReasonOptions{Message: "model card repository is invalid"})
	}
	requestURL, err := buildHFResolveURL(defaultString(s.hfDownloadBaseURL, defaultHFDownloadBaseURL), repo, url.PathEscape(revision), "README.md")
	if err != nil {
		return nil, err
	}
	requestCtx, cancel := context.WithTimeout(ctx, hfCatalogTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(requestCtx, http.MethodGet, requestURL, nil)
	if err != nil {
		return nil, err
	}
	response, err := (&http.Client{Timeout: hfCatalogTimeout}).Do(request)
	if err != nil {
		return nil, modelCardReadError(err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode == http.StatusNotFound {
		return nil, grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_TEMPLATE_NOT_FOUND, grpcerr.ReasonOptions{Message: "this model repository has no README.md at the selected revision"})
	}
	if response.StatusCode != http.StatusOK {
		return nil, modelCardReadError(fmt.Errorf("Hugging Face model card status=%d", response.StatusCode))
	}
	resolvedRevision := strings.TrimSpace(response.Header.Get("X-Repo-Commit"))
	if hfCommitRevisionPattern.MatchString(revision) {
		if resolvedRevision != "" && resolvedRevision != revision {
			return nil, modelCardReadError(fmt.Errorf("model card source revision changed"))
		}
	} else {
		if !hfCommitRevisionPattern.MatchString(resolvedRevision) {
			return nil, modelCardReadError(fmt.Errorf("model card is missing its resolved source revision"))
		}
		revision = resolvedRevision
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, hfCatalogMaxBodyBytes+1))
	if err != nil {
		return nil, modelCardReadError(err)
	}
	if len(body) > hfCatalogMaxBodyBytes || !utf8.Valid(body) {
		return nil, modelCardReadError(fmt.Errorf("model card is too large or is not UTF-8"))
	}
	base := defaultHFDownloadBaseURL + "/" + repo
	return &runtimev1.GetCatalogModelCardResponse{
		Markdown:  string(body),
		SourceUrl: base + "/blob/" + revision + "/README.md",
		BaseUrl:   base + "/resolve/" + revision + "/",
	}, nil
}

func modelCardReadError(err error) error {
	return grpcerr.WrapWithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_LOCAL_HF_SEARCH_FAILED, err, grpcerr.ReasonOptions{Message: "Hugging Face model card could not be loaded"})
}
