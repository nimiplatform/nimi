package localservice

import (
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const githubCommitInstallKind = "verified-github-commit-files"

var githubCommitIdentity = regexp.MustCompile(`^[0-9a-f]{40}$`)
var githubRepositoryIdentity = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9_.-]+$`)

func validGitHubCommitSource(repo, commit string) bool {
	return githubRepositoryIdentity.MatchString(repo) && !strings.Contains(repo, "..") && githubCommitIdentity.MatchString(commit)
}

// @nimi-authority: rule.nimi.runtime.model-catalog.github-commit-model-files
func buildGitHubCommitFileURL(repo, commit, file string) (string, error) {
	if !validGitHubCommitSource(repo, commit) {
		return "", fmt.Errorf("GitHub file source must name a repository and immutable commit")
	}
	canonical, err := normalizeArtifactRelativeFile(file)
	if err != nil || canonical != file {
		return "", fmt.Errorf("GitHub file path is not canonical")
	}
	segments := strings.Split(file, "/")
	for i := range segments {
		segments[i] = url.PathEscape(segments[i])
	}
	return "https://raw.githubusercontent.com/" + repo + "/" + commit + "/" + strings.Join(segments, "/"), nil
}

func gitHubCommitFileRedirect(request *http.Request, via []*http.Request) error {
	if len(via) >= 10 || request.URL.Scheme != "https" || request.URL.Host != "raw.githubusercontent.com" || request.URL.User != nil {
		return fmt.Errorf("GitHub commit source redirect is not admitted")
	}
	return nil
}

// Source selection is resolved once from exact current catalog facts and then
// retained in the durable transfer. Resume never reinterprets mutable catalog.
func (s *Service) catalogGitHubCommitForPlan(plan *runtimev1.LocalInstallPlanDescriptor) (bool, error) {
	if s.localProviderCatalog == nil {
		return false, nil
	}
	for _, row := range s.localProviderCatalog.LocalPlaneModels() {
		if row.Install == nil || row.Install.InstallKind != githubCommitInstallKind {
			continue
		}
		for _, variant := range row.Variants {
			if variant.VariantID != plan.GetTemplateId() {
				continue
			}
			repo, commit := catalogVariantSource(row, variant)
			if !validGitHubCommitSource(repo, commit) || plan.GetRepo() != repo || plan.GetRevision() != commit || plan.GetEntry() != variant.Entry || plan.GetTotalSizeBytes() != variant.TotalSizeBytes || len(plan.GetFiles()) != len(variant.Files) {
				return false, fmt.Errorf("GitHub file plan no longer matches its offer")
			}
			for i, file := range variant.Files {
				if plan.GetFiles()[i] != file || normalizeExactSHA256Hex(plan.GetHashes()[file]) != normalizeExactSHA256Hex(variant.Hashes[file]) {
					return false, fmt.Errorf("GitHub file plan integrity changed")
				}
			}
			return true, nil
		}
	}
	return false, nil
}
