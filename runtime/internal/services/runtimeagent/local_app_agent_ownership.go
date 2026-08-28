package runtimeagent

import (
	"context"
	"fmt"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

type realmCharacterPublicAvatarResolver interface {
	ResolveRealmCharacterPublicAvatar(
		context.Context,
		string,
		accountservice.RealmSourceMaterializationSourceRefV3,
	) (*string, error)
}

type localAppAgentAvatarCacheKey struct {
	localAgentRef string
	sourceHash    string
}

type localAppAgentAvatarLookup struct {
	done      chan struct{}
	avatarURL string
	hasURL    bool
	err       error
}

type localAppAgentDisplayAvatarCacheKey struct {
	localAgentRef string
	sourceHash    string
}

type localAppAgentDisplayAvatarCacheEntry struct {
	avatarURL       string
	hasURL          bool
	resolvePublic   bool
	publicSourceRef accountservice.RealmSourceMaterializationSourceRefV3
}

type localAppAgentDisplayAvatarLookup struct {
	done  chan struct{}
	entry localAppAgentDisplayAvatarCacheEntry
	err   error
}

func (s *Service) SetRealmCharacterPublicAvatarResolver(resolver realmCharacterPublicAvatarResolver) {
	if s != nil {
		s.realmCharacterPublicAvatar = resolver
	}
}

// OwnsActiveLocalAgent supplies the live ownership check required whenever an
// app presents an opaque Agent handle.
func (s *Service) OwnsActiveLocalAgent(_ context.Context, accountID string, localAgentID string) (bool, error) {
	if s == nil || accountID == "" || accountID != strings.TrimSpace(accountID) || localAgentID == "" || localAgentID != strings.TrimSpace(localAgentID) {
		return false, nil
	}
	s.mu.RLock()
	fenced := s.accountTerminationFencedLocked(accountID)
	s.mu.RUnlock()
	if fenced {
		return false, nil
	}
	entry, err := s.agentByID(localAgentID)
	if err != nil {
		return false, nil
	}
	return entry.Agent != nil && strings.TrimSpace(entry.Agent.GetOwnerUserId()) == accountID &&
		entry.Agent.GetLifecycleStatus() == runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE, nil
}

// ListOwnedActiveLocalAgents supplies the canonical current membership of the
// granted account scope. Account service turns these owner projections into
// app-bound opaque handles only after the durable grant is revalidated.
func (s *Service) ListOwnedActiveLocalAgents(ctx context.Context, accountID string) ([]accountservice.LocalAgentOwnerProjection, error) {
	if s == nil || accountID == "" || accountID != strings.TrimSpace(accountID) {
		return nil, fmt.Errorf("invalid Agent account scope")
	}
	s.mu.RLock()
	if s.accountTerminationFencedLocked(accountID) {
		s.mu.RUnlock()
		return []accountservice.LocalAgentOwnerProjection{}, nil
	}
	agents := make([]accountservice.LocalAgentOwnerProjection, 0, len(s.agents))
	sourceHashes := make(map[string]string, len(s.agents))
	for _, entry := range s.agents {
		if entry == nil || entry.Agent == nil {
			continue
		}
		localAgentID := entry.Agent.GetLocalAgentRef()
		if strings.TrimSpace(entry.Agent.GetOwnerUserId()) != accountID ||
			entry.Agent.GetLifecycleStatus() != runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE {
			continue
		}
		displayName := entry.Agent.GetDisplayName()
		if localAgentID == "" || localAgentID != strings.TrimSpace(localAgentID) ||
			displayName == "" || displayName != strings.TrimSpace(displayName) {
			s.mu.RUnlock()
			return nil, fmt.Errorf("active Agent account projection is incomplete")
		}
		agents = append(agents, accountservice.LocalAgentOwnerProjection{
			LocalAgentID: localAgentID,
			DisplayName:  displayName,
		})
		sourceHashes[localAgentID] = localAppAgentCurrentSourceHash(entry.Agent)
	}
	s.mu.RUnlock()
	s.pruneLocalAppAgentDisplayAvatarCache()
	for index := range agents {
		avatarURL, err := s.localAppAgentDisplayAvatarURL(
			ctx,
			accountID,
			agents[index].LocalAgentID,
			sourceHashes[agents[index].LocalAgentID],
		)
		if err != nil {
			agents[index].AvatarURL = nil
			continue
		}
		agents[index].AvatarURL = avatarURL
	}
	sort.Slice(agents, func(i, j int) bool {
		if agents[i].DisplayName == agents[j].DisplayName {
			return agents[i].LocalAgentID < agents[j].LocalAgentID
		}
		return agents[i].DisplayName < agents[j].DisplayName
	})
	return agents, nil
}

func localAppAgentCurrentSourceHash(agent *runtimev1.LocalAgentRecord) string {
	if agent == nil {
		return ""
	}
	status := agent.GetSourceContextStatus()
	if status == nil || !status.GetReady() {
		return ""
	}
	sourceRef := status.GetSourceRef()
	if sourceRef == nil {
		return ""
	}
	var sourceHash string
	switch {
	case sourceRef.GetWorldCharacter() != nil:
		sourceHash = strings.TrimSpace(sourceRef.GetWorldCharacter().GetSourceHash())
	case sourceRef.GetPersonaCharacter() != nil:
		sourceHash = strings.TrimSpace(sourceRef.GetPersonaCharacter().GetSourceHash())
	}
	if !isLowerSHA256V3(sourceHash) {
		return ""
	}
	return sourceHash
}

func (s *Service) pruneLocalAppAgentDisplayAvatarCache() {
	s.mu.RLock()
	defer s.mu.RUnlock()
	s.localAppAgentDisplayAvatarCacheMu.Lock()
	defer s.localAppAgentDisplayAvatarCacheMu.Unlock()
	for key := range s.localAppAgentDisplayAvatarCache {
		entry := s.agents[key.localAgentRef]
		if entry == nil || localAppAgentCurrentSourceHash(entry.Agent) != key.sourceHash {
			delete(s.localAppAgentDisplayAvatarCache, key)
		}
	}
}

func (s *Service) localAppAgentDisplayAvatarURL(ctx context.Context, accountID, localAgentRef, sourceHash string) (*string, error) {
	key := localAppAgentDisplayAvatarCacheKey{
		localAgentRef: strings.TrimSpace(localAgentRef),
		sourceHash:    strings.TrimSpace(sourceHash),
	}
	if key.localAgentRef == "" || !isLowerSHA256V3(key.sourceHash) {
		entry, err := s.prepareLocalAppAgentDisplayAvatar(ctx, localAgentRef, "")
		if err != nil {
			return nil, err
		}
		return s.resolvePreparedLocalAppAgentDisplayAvatar(ctx, accountID, localAgentRef, entry)
	}

	s.localAppAgentDisplayAvatarCacheMu.Lock()
	if cached, ok := s.localAppAgentDisplayAvatarCache[key]; ok {
		s.localAppAgentDisplayAvatarCacheMu.Unlock()
		return s.resolvePreparedLocalAppAgentDisplayAvatar(ctx, accountID, localAgentRef, cached)
	}
	if lookup, ok := s.localAppAgentDisplayAvatarLookups[key]; ok {
		s.localAppAgentDisplayAvatarCacheMu.Unlock()
		select {
		case <-lookup.done:
			if lookup.err != nil {
				return nil, lookup.err
			}
			return s.resolvePreparedLocalAppAgentDisplayAvatar(ctx, accountID, localAgentRef, lookup.entry)
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	if s.localAppAgentDisplayAvatarCache == nil {
		s.localAppAgentDisplayAvatarCache = make(map[localAppAgentDisplayAvatarCacheKey]localAppAgentDisplayAvatarCacheEntry)
	}
	if s.localAppAgentDisplayAvatarLookups == nil {
		s.localAppAgentDisplayAvatarLookups = make(map[localAppAgentDisplayAvatarCacheKey]*localAppAgentDisplayAvatarLookup)
	}
	lookup := &localAppAgentDisplayAvatarLookup{done: make(chan struct{})}
	s.localAppAgentDisplayAvatarLookups[key] = lookup
	s.localAppAgentDisplayAvatarCacheMu.Unlock()

	entry, err := s.prepareLocalAppAgentDisplayAvatar(ctx, localAgentRef, key.sourceHash)
	lookup.entry = entry
	lookup.err = err

	s.mu.RLock()
	currentSourceHashMatches := false
	if currentAgentEntry := s.agents[key.localAgentRef]; currentAgentEntry != nil {
		currentSourceHashMatches = localAppAgentCurrentSourceHash(currentAgentEntry.Agent) == key.sourceHash
	}
	s.localAppAgentDisplayAvatarCacheMu.Lock()
	delete(s.localAppAgentDisplayAvatarLookups, key)
	if err == nil && currentSourceHashMatches {
		for cachedKey := range s.localAppAgentDisplayAvatarCache {
			if cachedKey.localAgentRef == key.localAgentRef && cachedKey != key {
				delete(s.localAppAgentDisplayAvatarCache, cachedKey)
			}
		}
		s.localAppAgentDisplayAvatarCache[key] = lookup.entry
	}
	close(lookup.done)
	s.localAppAgentDisplayAvatarCacheMu.Unlock()
	s.mu.RUnlock()

	if err != nil {
		return nil, err
	}
	return s.resolvePreparedLocalAppAgentDisplayAvatar(ctx, accountID, localAgentRef, lookup.entry)
}

func (s *Service) resolvePreparedLocalAppAgentDisplayAvatar(
	ctx context.Context,
	accountID string,
	localAgentRef string,
	entry localAppAgentDisplayAvatarCacheEntry,
) (*string, error) {
	if entry.hasURL {
		avatarURL := entry.avatarURL
		return &avatarURL, nil
	}
	if !entry.resolvePublic || s.realmCharacterPublicAvatar == nil {
		return nil, nil
	}
	return s.resolveLocalAppRealmCharacterPublicAvatar(
		ctx,
		accountID,
		localAgentRef,
		entry.publicSourceRef,
	)
}

func (s *Service) prepareLocalAppAgentDisplayAvatar(
	ctx context.Context,
	localAgentRef string,
	expectedSourceHash string,
) (localAppAgentDisplayAvatarCacheEntry, error) {
	if s.publicChatSourceSnapshotResolve == nil {
		return localAppAgentDisplayAvatarCacheEntry{}, nil
	}
	snapshot, found, err := s.publicChatSourceSnapshotResolve(ctx, localAgentRef)
	if err != nil {
		return localAppAgentDisplayAvatarCacheEntry{}, err
	}
	if !found {
		return localAppAgentDisplayAvatarCacheEntry{}, fmt.Errorf("current Agent source snapshot is unavailable")
	}
	if expectedSourceHash != "" && snapshot.Semantic.SourceRef.SourceHash != expectedSourceHash {
		return localAppAgentDisplayAvatarCacheEntry{}, fmt.Errorf("current Agent source changed during avatar projection")
	}
	profile, err := decodeRealmSourceCompilerProfileV3(snapshot.Semantic.Source.Profile)
	if err != nil {
		return localAppAgentDisplayAvatarCacheEntry{}, err
	}
	if profile.Presentation.AvatarResourceRef != nil {
		avatarResourceRef := strings.TrimSpace(*profile.Presentation.AvatarResourceRef)
		if avatarResourceRef != "" && profile.Assets.ExternalRefs != nil {
			for _, externalRef := range *profile.Assets.ExternalRefs {
				if externalRef.RefID != avatarResourceRef {
					continue
				}
				if externalRef.URI == nil {
					return localAppAgentDisplayAvatarCacheEntry{}, fmt.Errorf("avatar external resource %q has no stable URI", avatarResourceRef)
				}
				if err := validateSourceMaterializationStableExternalURI(
					*externalRef.URI,
					"$.snapshot.semantic.source.profile.assets.externalRefs.avatar.uri",
				); err != nil {
					return localAppAgentDisplayAvatarCacheEntry{}, err
				}
				return localAppAgentDisplayAvatarCacheEntry{
					avatarURL: *externalRef.URI,
					hasURL:    true,
				}, nil
			}
		}
	}
	if snapshot.Semantic.SourceRef.Kind == "worldCharacter" &&
		snapshot.Semantic.SourceRef.validate() == nil {
		return localAppAgentDisplayAvatarCacheEntry{
			resolvePublic:   true,
			publicSourceRef: accountRealmCharacterPublicAvatarSourceRef(snapshot.Semantic.SourceRef),
		}, nil
	}
	return localAppAgentDisplayAvatarCacheEntry{}, nil
}

// This cache is process-local display memoization for one exact LocalAgent
// source version. It never establishes authorization or Realm source freshness;
// callers revalidate the live account scope, Agent ownership, lifecycle, and
// current SnapshotV2 source hash before consulting it.
func (s *Service) resolveLocalAppRealmCharacterPublicAvatar(
	ctx context.Context,
	accountID string,
	localAgentRef string,
	sourceRef accountservice.RealmSourceMaterializationSourceRefV3,
) (*string, error) {
	key := localAppAgentAvatarCacheKey{
		localAgentRef: localAgentRef,
		sourceHash:    sourceRef.SourceHash,
	}
	s.localAppAgentAvatarCacheMu.Lock()
	if cached, ok := s.localAppAgentAvatarCache[key]; ok {
		s.localAppAgentAvatarCacheMu.Unlock()
		avatarURL := cached
		return &avatarURL, nil
	}
	if lookup, ok := s.localAppAgentAvatarLookups[key]; ok {
		s.localAppAgentAvatarCacheMu.Unlock()
		select {
		case <-lookup.done:
			if lookup.err != nil {
				return nil, lookup.err
			}
			if !lookup.hasURL {
				return nil, nil
			}
			avatarURL := lookup.avatarURL
			return &avatarURL, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	if s.localAppAgentAvatarCache == nil {
		s.localAppAgentAvatarCache = make(map[localAppAgentAvatarCacheKey]string)
	}
	if s.localAppAgentAvatarLookups == nil {
		s.localAppAgentAvatarLookups = make(map[localAppAgentAvatarCacheKey]*localAppAgentAvatarLookup)
	}
	lookup := &localAppAgentAvatarLookup{done: make(chan struct{})}
	s.localAppAgentAvatarLookups[key] = lookup
	s.localAppAgentAvatarCacheMu.Unlock()

	publicAvatarURL, err := s.realmCharacterPublicAvatar.ResolveRealmCharacterPublicAvatar(
		ctx,
		accountID,
		sourceRef,
	)
	if err == nil && publicAvatarURL != nil {
		err = validateSourceMaterializationStableExternalURI(
			*publicAvatarURL,
			"$.worldPublic.characterSource.media.avatar",
		)
		if err == nil {
			lookup.avatarURL = *publicAvatarURL
			lookup.hasURL = true
		}
	}
	lookup.err = err

	s.localAppAgentAvatarCacheMu.Lock()
	delete(s.localAppAgentAvatarLookups, key)
	if lookup.hasURL {
		for cachedKey := range s.localAppAgentAvatarCache {
			if cachedKey.localAgentRef == localAgentRef && cachedKey != key {
				delete(s.localAppAgentAvatarCache, cachedKey)
			}
		}
		s.localAppAgentAvatarCache[key] = lookup.avatarURL
	}
	close(lookup.done)
	s.localAppAgentAvatarCacheMu.Unlock()

	if lookup.err != nil {
		return nil, lookup.err
	}
	if !lookup.hasURL {
		return nil, nil
	}
	avatarURL := lookup.avatarURL
	return &avatarURL, nil
}

func accountRealmCharacterPublicAvatarSourceRef(
	sourceRef sourceMaterializationCharacterSourceRefV3,
) accountservice.RealmSourceMaterializationSourceRefV3 {
	projected := accountservice.RealmSourceMaterializationSourceRefV3{
		Kind:           sourceRef.Kind,
		ID:             sourceRef.ID,
		WorldID:        sourceRef.WorldID,
		OwnerAccountID: sourceRef.OwnerAccountID,
		SourceHash:     sourceRef.SourceHash,
	}
	if sourceRef.WorldEntityRef != nil {
		projected.WorldEntityRef = &accountservice.RealmSourceMaterializationWorldEntityRefV3{
			WorldID:  sourceRef.WorldEntityRef.WorldID,
			EntityID: sourceRef.WorldEntityRef.EntityID,
		}
	}
	return projected
}
