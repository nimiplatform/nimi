package main

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
)

func parseModCircleInstallSelector(source string) (string, bool) {
	trimmed := strings.TrimSpace(source)
	if trimmed == "" {
		return "", false
	}
	lowered := strings.ToLower(trimmed)
	for _, prefix := range []string{"mod-circle:", "circle:", "mod:"} {
		if strings.HasPrefix(lowered, prefix) {
			selector := strings.TrimSpace(trimmed[len(prefix):])
			if selector == "" {
				return "", false
			}
			return selector, true
		}
	}
	if strings.HasPrefix(trimmed, "world.") {
		return trimmed, true
	}
	return "", false
}

func resolveModCircleEntry(
	apiBase string,
	token string,
	modCircleRepo string,
	modCircleRef string,
	selector string,
	strictID bool,
) (modCircleEntry, error) {
	owner, repo, _, err := parseGitHubRepoReference(modCircleRepo)
	if err != nil {
		return modCircleEntry{}, fmt.Errorf("invalid mod-circle-repo: %w", err)
	}
	ref := strings.TrimSpace(modCircleRef)
	if ref == "" {
		ref = "main"
	}

	client := newGitHubRESTClient(apiBase, token)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	items, err := client.listDirectory(ctx, owner, repo, "mods", ref)
	if err != nil {
		return modCircleEntry{}, fmt.Errorf(
			"MOD_INSTALL_MOD_CIRCLE_INDEX_UNAVAILABLE: actionHint=check_mod_circle_repo_and_network: %w",
			err,
		)
	}
	if len(items) == 0 {
		return modCircleEntry{}, fmt.Errorf("MOD_INSTALL_MOD_CIRCLE_INDEX_EMPTY: actionHint=check_mod_circle_repo_contents")
	}

	normalizedSelector := strings.Trim(strings.TrimSpace(selector), "/")
	normalizedSelectorNoExt := strings.TrimSuffix(normalizedSelector, ".json")
	byName := map[string]githubContentItem{}
	jsonItems := make([]githubContentItem, 0, len(items))
	for _, item := range items {
		if item.Type != "file" {
			continue
		}
		if !strings.HasSuffix(strings.ToLower(item.Name), ".json") {
			continue
		}
		jsonItems = append(jsonItems, item)
		byName[item.Name] = item
	}
	if len(jsonItems) == 0 {
		return modCircleEntry{}, fmt.Errorf("MOD_INSTALL_MOD_CIRCLE_INDEX_EMPTY: actionHint=check_mod_circle_repo_contents")
	}

	candidateNames := []string{
		normalizedSelector,
		normalizedSelector + ".json",
		normalizedSelectorNoExt + ".json",
	}
	for _, candidate := range candidateNames {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		item, ok := byName[candidate]
		if !ok {
			continue
		}
		entry, loadErr := loadModCircleEntryFile(ctx, client, owner, repo, item.Path, ref)
		if loadErr != nil {
			return modCircleEntry{}, loadErr
		}
		if strings.TrimSpace(entry.ID) == "" {
			entry.ID = normalizedSelectorNoExt
		}
		if strings.TrimSpace(entry.Repo) == "" {
			return modCircleEntry{}, fmt.Errorf(
				"MOD_INSTALL_MOD_CIRCLE_ENTRY_INVALID: actionHint=check_mod_circle_index_entry_missing_repo",
			)
		}
		return entry, nil
	}

	exactIDMatches := make([]modCircleEntry, 0, 2)
	fallbackMatches := make([]modCircleEntry, 0, 2)
	for _, item := range jsonItems {
		entry, loadErr := loadModCircleEntryFile(ctx, client, owner, repo, item.Path, ref)
		if loadErr != nil {
			continue
		}
		entryID := strings.TrimSpace(entry.ID)
		entryName := strings.TrimSpace(entry.Name)
		if entryID == "" {
			entryID = strings.TrimSuffix(item.Name, ".json")
			entry.ID = entryID
		}
		if entryID == normalizedSelector {
			exactIDMatches = append(exactIDMatches, entry)
			continue
		}
		if strictID {
			continue
		}
		if strings.EqualFold(entryName, normalizedSelector) {
			fallbackMatches = append(fallbackMatches, entry)
			continue
		}
		if strings.HasPrefix(normalizedSelector, "world.") && slugify(entryID) == slugify(normalizedSelector) {
			fallbackMatches = append(fallbackMatches, entry)
		}
	}

	if len(exactIDMatches) == 1 {
		entry := exactIDMatches[0]
		if strings.TrimSpace(entry.Repo) == "" {
			return modCircleEntry{}, fmt.Errorf(
				"MOD_INSTALL_MOD_CIRCLE_ENTRY_INVALID: actionHint=check_mod_circle_index_entry_missing_repo",
			)
		}
		return entry, nil
	}
	if len(exactIDMatches) > 1 {
		ids := make([]string, 0, len(exactIDMatches))
		for _, item := range exactIDMatches {
			ids = append(ids, item.ID)
		}
		sort.Strings(ids)
		return modCircleEntry{}, fmt.Errorf(
			"MOD_INSTALL_MOD_CIRCLE_AMBIGUOUS: actionHint=use_mod-circle:exact_mod_id matches=%s",
			strings.Join(ids, ","),
		)
	}
	if strictID {
		return modCircleEntry{}, fmt.Errorf(
			"MOD_INSTALL_MOD_CIRCLE_NOT_FOUND: actionHint=use_mod-circle:exact_mod_id selector=%s",
			normalizedSelector,
		)
	}
	if len(fallbackMatches) == 1 {
		entry := fallbackMatches[0]
		if strings.TrimSpace(entry.Repo) == "" {
			return modCircleEntry{}, fmt.Errorf(
				"MOD_INSTALL_MOD_CIRCLE_ENTRY_INVALID: actionHint=check_mod_circle_index_entry_missing_repo",
			)
		}
		return entry, nil
	}
	if len(fallbackMatches) > 1 {
		ids := make([]string, 0, len(fallbackMatches))
		for _, item := range fallbackMatches {
			ids = append(ids, item.ID)
		}
		sort.Strings(ids)
		return modCircleEntry{}, fmt.Errorf(
			"MOD_INSTALL_MOD_CIRCLE_AMBIGUOUS: actionHint=use_mod-circle:exact_mod_id matches=%s",
			strings.Join(ids, ","),
		)
	}
	return modCircleEntry{}, fmt.Errorf(
		"MOD_INSTALL_MOD_CIRCLE_NOT_FOUND: actionHint=use_mod-circle:exact_mod_id selector=%s",
		normalizedSelector,
	)
}

func loadModCircleEntryFile(
	ctx context.Context,
	client *githubRESTClient,
	owner string,
	repo string,
	path string,
	ref string,
) (modCircleEntry, error) {
	content, err := client.getFileContent(ctx, owner, repo, path, ref)
	if err != nil {
		return modCircleEntry{}, err
	}
	var entry modCircleEntry
	if err := json.Unmarshal(content, &entry); err != nil {
		return modCircleEntry{}, fmt.Errorf(
			"MOD_INSTALL_MOD_CIRCLE_ENTRY_INVALID: actionHint=check_mod_circle_index_entry_json path=%s: %w",
			path,
			err,
		)
	}
	return entry, nil
}
