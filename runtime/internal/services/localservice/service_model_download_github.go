package localservice

import (
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
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
