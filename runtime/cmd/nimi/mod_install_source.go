package main

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"
)

func resolveInstallSource(
	source string,
	apiBase string,
	token string,
	modCircleRepo string,
	modCircleRef string,
	modCircleStrictID bool,
) (resolvedInstallSource, error) {
	if localSourceDir, ok := resolveExistingDir(source); ok {
		return resolvedInstallSource{
			sourceDir:        localSourceDir,
			normalizedSource: source,
			verified:         false,
			cleanup:          func() {},
		}, nil
	}

	if owner, repo, subpath, err := parseGitHubRepoReference(source); err == nil {
		tempDir, tempErr := os.MkdirTemp("", "nimi-mod-install-*")
		if tempErr != nil {
			return resolvedInstallSource{}, fmt.Errorf("prepare install temp dir: %w", tempErr)
		}
		cleanup := func() {
			_ = os.RemoveAll(tempDir)
		}

		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		sourceDir, downloadErr := downloadGitHubModSource(ctx, strings.TrimSpace(apiBase), token, owner, repo, subpath, tempDir)
		if downloadErr != nil {
			cleanup()
			return resolvedInstallSource{}, downloadErr
		}

		normalized := "github:" + owner + "/" + repo
		if strings.TrimSpace(subpath) != "" {
			normalized += "/" + strings.Trim(strings.TrimSpace(subpath), "/")
		}
		return resolvedInstallSource{
			sourceDir:        sourceDir,
			normalizedSource: normalized,
			verified:         false,
			cleanup:          cleanup,
		}, nil
	}

	modCircleSelector, isModCircleSource := parseModCircleInstallSelector(source)
	if !isModCircleSource {
		return resolvedInstallSource{}, fmt.Errorf(
			"MOD_INSTALL_SOURCE_UNSUPPORTED: actionHint=use_local_dir_or_github_owner_repo_or_mod-circle_id",
		)
	}

	entry, err := resolveModCircleEntry(
		strings.TrimSpace(apiBase),
		token,
		modCircleRepo,
		modCircleRef,
		modCircleSelector,
		modCircleStrictID,
	)
	if err != nil {
		return resolvedInstallSource{}, err
	}

	repoOwner, repoName, repoSubpath, err := parseGitHubRepoReference(entry.Repo)
	if err != nil {
		return resolvedInstallSource{}, fmt.Errorf(
			"MOD_INSTALL_MOD_CIRCLE_ENTRY_INVALID: actionHint=check_mod_circle_index_entry repo=%s: %w",
			entry.Repo,
			err,
		)
	}

	tempDir, err := os.MkdirTemp("", "nimi-mod-install-*")
	if err != nil {
		return resolvedInstallSource{}, fmt.Errorf("prepare install temp dir: %w", err)
	}
	cleanup := func() {
		_ = os.RemoveAll(tempDir)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	sourceDir, err := downloadGitHubModSource(
		ctx,
		strings.TrimSpace(apiBase),
		token,
		repoOwner,
		repoName,
		repoSubpath,
		tempDir,
	)
	if err != nil {
		cleanup()
		return resolvedInstallSource{}, err
	}

	normalized := "mod-circle:" + entry.ID
	return resolvedInstallSource{
		sourceDir:        sourceDir,
		normalizedSource: normalized,
		verified:         entry.Verified,
		cleanup:          cleanup,
	}, nil
}
