package runtimeagent

import (
	"context"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

type localAppAgentPublicAvatarResolverFunc func(
	context.Context,
	string,
	accountservice.RealmSourceMaterializationSourceRefV3,
) (*string, error)

func (resolve localAppAgentPublicAvatarResolverFunc) ResolveRealmCharacterPublicAvatar(
	ctx context.Context,
	accountID string,
	sourceRef accountservice.RealmSourceMaterializationSourceRefV3,
) (*string, error) {
	return resolve(ctx, accountID, sourceRef)
}

func TestLocalAppAgentOwnershipProjectsWorldPublicMediaOnlyAvatar(t *testing.T) {
	snapshot := localAppAgentOwnershipMediaOnlySnapshot(t)
	svc := &Service{
		agents: map[string]*agentEntry{
			snapshot.LocalAgentRef: {Agent: &runtimev1.LocalAgentRecord{
				LocalAgentRef:   snapshot.LocalAgentRef,
				DisplayName:     "宋濂",
				OwnerUserId:     "acct-1",
				LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
			}},
		},
		publicChatSourceSnapshotResolve: func(_ context.Context, localAgentRef string) (localAgentSourceSnapshotV2, bool, error) {
			return snapshot, localAgentRef == snapshot.LocalAgentRef, nil
		},
	}
	svc.SetRealmCharacterPublicAvatarResolver(localAppAgentPublicAvatarResolverFunc(func(
		_ context.Context,
		accountID string,
		sourceRef accountservice.RealmSourceMaterializationSourceRefV3,
	) (*string, error) {
		if accountID != "acct-1" || sourceRef.Kind != snapshot.Semantic.SourceRef.Kind ||
			sourceRef.ID != snapshot.Semantic.SourceRef.ID ||
			sourceRef.WorldID != snapshot.Semantic.SourceRef.WorldID ||
			sourceRef.SourceHash != snapshot.Semantic.SourceRef.SourceHash {
			t.Fatalf("public avatar source binding = account %q ref %+v", accountID, sourceRef)
		}
		avatarURL := "https://cdn.example.test/song-lian-avatar.png"
		return &avatarURL, nil
	}))
	inventory, err := svc.ListOwnedActiveLocalAgents(context.Background(), "acct-1")
	if err != nil || len(inventory) != 1 || inventory[0].AvatarURL == nil ||
		*inventory[0].AvatarURL != "https://cdn.example.test/song-lian-avatar.png" {
		t.Fatalf("WorldPublic media-only avatar projection = (%+v, %v)", inventory, err)
	}
}

func TestLocalAppAgentOwnershipAvatarFailureDoesNotBlockInventory(t *testing.T) {
	snapshot := localAppAgentOwnershipMediaOnlySnapshot(t)
	svc := &Service{
		agents: map[string]*agentEntry{
			snapshot.LocalAgentRef: {Agent: &runtimev1.LocalAgentRecord{
				LocalAgentRef:   snapshot.LocalAgentRef,
				DisplayName:     "宋濂",
				OwnerUserId:     "acct-1",
				LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
			}},
		},
		publicChatSourceSnapshotResolve: func(_ context.Context, localAgentRef string) (localAgentSourceSnapshotV2, bool, error) {
			return snapshot, localAgentRef == snapshot.LocalAgentRef, nil
		},
	}
	svc.SetRealmCharacterPublicAvatarResolver(localAppAgentPublicAvatarResolverFunc(func(
		context.Context,
		string,
		accountservice.RealmSourceMaterializationSourceRefV3,
	) (*string, error) {
		return nil, context.Canceled
	}))

	inventory, err := svc.ListOwnedActiveLocalAgents(context.Background(), "acct-1")
	if err != nil || len(inventory) != 1 ||
		inventory[0].LocalAgentID != snapshot.LocalAgentRef ||
		inventory[0].DisplayName != "宋濂" ||
		inventory[0].AvatarURL != nil {
		t.Fatalf("inventory after nullable avatar failure = (%+v, %v)", inventory, err)
	}
}

func TestLocalAppAgentOwnershipCoalescesConcurrentPublicAvatarLookup(t *testing.T) {
	snapshot := localAppAgentOwnershipMediaOnlySnapshot(t)
	svc := localAppAgentOwnershipAvatarService(snapshot)
	started := make(chan struct{})
	release := make(chan struct{})
	var resolverCalls atomic.Int32
	svc.SetRealmCharacterPublicAvatarResolver(localAppAgentPublicAvatarResolverFunc(func(
		context.Context,
		string,
		accountservice.RealmSourceMaterializationSourceRefV3,
	) (*string, error) {
		if resolverCalls.Add(1) == 1 {
			close(started)
		}
		<-release
		avatarURL := "https://cdn.example.test/song-lian-avatar.png"
		return &avatarURL, nil
	}))

	const callerCount = 16
	begin := make(chan struct{})
	results := make(chan []accountservice.LocalAgentOwnerProjection, callerCount)
	errs := make(chan error, callerCount)
	var ready sync.WaitGroup
	ready.Add(callerCount)
	for range callerCount {
		go func() {
			ready.Done()
			<-begin
			inventory, err := svc.ListOwnedActiveLocalAgents(context.Background(), "acct-1")
			results <- inventory
			errs <- err
		}()
	}
	ready.Wait()
	close(begin)
	<-started
	time.Sleep(25 * time.Millisecond)
	close(release)

	for range callerCount {
		if err := <-errs; err != nil {
			t.Fatalf("concurrent inventory failed: %v", err)
		}
		inventory := <-results
		if len(inventory) != 1 || inventory[0].AvatarURL == nil ||
			*inventory[0].AvatarURL != "https://cdn.example.test/song-lian-avatar.png" {
			t.Fatalf("concurrent avatar projection = %+v", inventory)
		}
	}
	if got := resolverCalls.Load(); got != 1 {
		t.Fatalf("concurrent public avatar resolver calls = %d, want 1", got)
	}
}

func TestLocalAppAgentOwnershipReusesSuccessfulPublicAvatarLookup(t *testing.T) {
	snapshot := localAppAgentOwnershipMediaOnlySnapshot(t)
	svc := localAppAgentOwnershipAvatarService(snapshot)
	var resolverCalls atomic.Int32
	svc.SetRealmCharacterPublicAvatarResolver(localAppAgentPublicAvatarResolverFunc(func(
		context.Context,
		string,
		accountservice.RealmSourceMaterializationSourceRefV3,
	) (*string, error) {
		resolverCalls.Add(1)
		avatarURL := "https://cdn.example.test/song-lian-avatar.png"
		return &avatarURL, nil
	}))

	for attempt := 0; attempt < 2; attempt++ {
		inventory, err := svc.ListOwnedActiveLocalAgents(context.Background(), "acct-1")
		if err != nil || len(inventory) != 1 || inventory[0].AvatarURL == nil ||
			*inventory[0].AvatarURL != "https://cdn.example.test/song-lian-avatar.png" {
			t.Fatalf("inventory attempt %d = (%+v, %v)", attempt+1, inventory, err)
		}
	}
	if got := resolverCalls.Load(); got != 1 {
		t.Fatalf("reused public avatar resolver calls = %d, want 1", got)
	}
}

func TestLocalAppAgentOwnershipDoesNotCachePublicAvatarFailure(t *testing.T) {
	snapshot := localAppAgentOwnershipMediaOnlySnapshot(t)
	svc := localAppAgentOwnershipAvatarService(snapshot)
	var resolverCalls atomic.Int32
	svc.SetRealmCharacterPublicAvatarResolver(localAppAgentPublicAvatarResolverFunc(func(
		context.Context,
		string,
		accountservice.RealmSourceMaterializationSourceRefV3,
	) (*string, error) {
		if resolverCalls.Add(1) == 1 {
			return nil, errors.New("Realm avatar lookup unavailable")
		}
		avatarURL := "https://cdn.example.test/song-lian-avatar.png"
		return &avatarURL, nil
	}))

	first, err := svc.ListOwnedActiveLocalAgents(context.Background(), "acct-1")
	if err != nil || len(first) != 1 || first[0].AvatarURL != nil {
		t.Fatalf("inventory after first lookup failure = (%+v, %v)", first, err)
	}
	second, err := svc.ListOwnedActiveLocalAgents(context.Background(), "acct-1")
	if err != nil || len(second) != 1 || second[0].AvatarURL == nil ||
		*second[0].AvatarURL != "https://cdn.example.test/song-lian-avatar.png" {
		t.Fatalf("inventory after retry = (%+v, %v)", second, err)
	}
	if got := resolverCalls.Load(); got != 2 {
		t.Fatalf("failed public avatar resolver calls = %d, want 2", got)
	}
}

func TestLocalAppAgentOwnershipSourceHashChangeRefetchesPublicAvatar(t *testing.T) {
	snapshot := localAppAgentOwnershipMediaOnlySnapshot(t)
	currentSnapshot := snapshot
	svc := localAppAgentOwnershipAvatarServiceWithSnapshotResolver(func(
		_ context.Context,
		localAgentRef string,
	) (localAgentSourceSnapshotV2, bool, error) {
		return currentSnapshot, localAgentRef == currentSnapshot.LocalAgentRef, nil
	}, snapshot)
	var resolverCalls atomic.Int32
	svc.SetRealmCharacterPublicAvatarResolver(localAppAgentPublicAvatarResolverFunc(func(
		_ context.Context,
		_ string,
		sourceRef accountservice.RealmSourceMaterializationSourceRefV3,
	) (*string, error) {
		resolverCalls.Add(1)
		avatarURL := "https://cdn.example.test/avatar-" + sourceRef.SourceHash[:8] + ".png"
		return &avatarURL, nil
	}))

	first, err := svc.ListOwnedActiveLocalAgents(context.Background(), "acct-1")
	if err != nil || len(first) != 1 || first[0].AvatarURL == nil {
		t.Fatalf("first source-hash avatar = (%+v, %v)", first, err)
	}
	currentSnapshot.Semantic.SourceRef.SourceHash = strings.Repeat("b", 64)
	second, err := svc.ListOwnedActiveLocalAgents(context.Background(), "acct-1")
	if err != nil || len(second) != 1 || second[0].AvatarURL == nil {
		t.Fatalf("changed source-hash avatar = (%+v, %v)", second, err)
	}
	if *first[0].AvatarURL == *second[0].AvatarURL {
		t.Fatalf("source-hash change reused stale avatar %q", *second[0].AvatarURL)
	}
	if got := resolverCalls.Load(); got != 2 {
		t.Fatalf("source-hash public avatar resolver calls = %d, want 2", got)
	}
}

func TestLocalAppAgentOwnershipFallsBackToAdmittedCanonicalExternalAvatar(t *testing.T) {
	snapshot := localAppAgentOwnershipAvatarSnapshot(t, "https://assets.example.test/avatars/mira.png")
	svc := &Service{
		agents: map[string]*agentEntry{
			snapshot.LocalAgentRef: {Agent: &runtimev1.LocalAgentRecord{
				LocalAgentRef:   snapshot.LocalAgentRef,
				DisplayName:     "Mira Vale",
				OwnerUserId:     "acct-1",
				LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
			}},
		},
		publicChatSourceSnapshotResolve: func(_ context.Context, localAgentRef string) (localAgentSourceSnapshotV2, bool, error) {
			return snapshot, localAgentRef == snapshot.LocalAgentRef, nil
		},
	}
	resolverCalls := 0
	svc.SetRealmCharacterPublicAvatarResolver(localAppAgentPublicAvatarResolverFunc(func(
		context.Context,
		string,
		accountservice.RealmSourceMaterializationSourceRefV3,
	) (*string, error) {
		resolverCalls++
		return nil, nil
	}))
	inventory, err := svc.ListOwnedActiveLocalAgents(context.Background(), "acct-1")
	if err != nil || len(inventory) != 1 || inventory[0].AvatarURL == nil ||
		*inventory[0].AvatarURL != "https://assets.example.test/avatars/mira.png" {
		t.Fatalf("canonical external avatar fallback = (%+v, %v)", inventory, err)
	}
	if resolverCalls != 0 {
		t.Fatalf("Snapshot external avatar called WorldPublic resolver %d times, want 0", resolverCalls)
	}
}

func TestLocalAppAgentOwnershipPersonaCharacterSkipsWorldPublicResolver(t *testing.T) {
	snapshot := localAppAgentOwnershipPersonaAvatarSnapshot(
		t,
		"https://assets.example.test/avatars/persona-witness.png",
	)
	svc := &Service{
		agents: map[string]*agentEntry{
			snapshot.LocalAgentRef: {Agent: &runtimev1.LocalAgentRecord{
				LocalAgentRef:   snapshot.LocalAgentRef,
				DisplayName:     "Realm Database Persona Witness",
				OwnerUserId:     "acct-1",
				LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
			}},
		},
		publicChatSourceSnapshotResolve: func(_ context.Context, localAgentRef string) (localAgentSourceSnapshotV2, bool, error) {
			return snapshot, localAgentRef == snapshot.LocalAgentRef, nil
		},
	}
	resolverCalls := 0
	svc.SetRealmCharacterPublicAvatarResolver(localAppAgentPublicAvatarResolverFunc(func(
		context.Context,
		string,
		accountservice.RealmSourceMaterializationSourceRefV3,
	) (*string, error) {
		resolverCalls++
		return nil, context.Canceled
	}))

	inventory, err := svc.ListOwnedActiveLocalAgents(context.Background(), "acct-1")
	if err != nil || len(inventory) != 1 || inventory[0].AvatarURL == nil ||
		*inventory[0].AvatarURL != "https://assets.example.test/avatars/persona-witness.png" {
		t.Fatalf("personaCharacter inventory projection = (%+v, %v)", inventory, err)
	}
	if resolverCalls != 0 {
		t.Fatalf("personaCharacter WorldPublic resolver calls = %d, want 0", resolverCalls)
	}
}

func localAppAgentOwnershipMediaOnlySnapshot(t *testing.T) localAgentSourceSnapshotV2 {
	t.Helper()
	verified := verifiedRealmSourceMaterializationVectorV3(t, "world-character")
	snapshot, err := finalizeLocalAgentSourceSnapshotV2(
		verified,
		realmSourceMaterializationProductTestLocalAgentRef("media-only-avatar-projection"),
	)
	if err != nil {
		t.Fatal(err)
	}
	profileValue := snapshot.Semantic.Source.Profile.interfaceValue().(map[string]any)
	presentation := profileValue["presentation"].(map[string]any)
	delete(presentation, "avatarResourceRef")
	profileValue["assets"].(map[string]any)["externalRefs"] = []any{}
	snapshot.Semantic.Source.Profile, err = normalizeSourceMaterializationJSONValue(profileValue)
	if err != nil {
		t.Fatal(err)
	}
	return snapshot
}

func localAppAgentOwnershipAvatarService(snapshot localAgentSourceSnapshotV2) *Service {
	return localAppAgentOwnershipAvatarServiceWithSnapshotResolver(func(
		_ context.Context,
		localAgentRef string,
	) (localAgentSourceSnapshotV2, bool, error) {
		return snapshot, localAgentRef == snapshot.LocalAgentRef, nil
	}, snapshot)
}

func localAppAgentOwnershipAvatarServiceWithSnapshotResolver(
	resolve func(context.Context, string) (localAgentSourceSnapshotV2, bool, error),
	snapshot localAgentSourceSnapshotV2,
) *Service {
	return &Service{
		agents: map[string]*agentEntry{
			snapshot.LocalAgentRef: {Agent: &runtimev1.LocalAgentRecord{
				LocalAgentRef:   snapshot.LocalAgentRef,
				DisplayName:     "宋濂",
				OwnerUserId:     "acct-1",
				LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
			}},
		},
		publicChatSourceSnapshotResolve: resolve,
	}
}

func localAppAgentOwnershipPersonaAvatarSnapshot(t *testing.T, avatarURL string) localAgentSourceSnapshotV2 {
	t.Helper()
	verified := verifiedRealmSourceMaterializationVectorV3(t, "persona-character")
	snapshot, err := finalizeLocalAgentSourceSnapshotV2(
		verified,
		realmSourceMaterializationProductTestLocalAgentRef("persona-avatar-projection"),
	)
	if err != nil {
		t.Fatal(err)
	}
	profileValue := snapshot.Semantic.Source.Profile.interfaceValue().(map[string]any)
	presentation := profileValue["presentation"].(map[string]any)
	presentation["avatarResourceRef"] = "external-avatar-persona"
	assets := profileValue["assets"].(map[string]any)
	assets["externalRefs"] = []any{map[string]any{
		"refId": "external-avatar-persona",
		"kind":  "image",
		"uri":   avatarURL,
	}}
	snapshot.Semantic.Source.Profile, err = normalizeSourceMaterializationJSONValue(profileValue)
	if err != nil {
		t.Fatal(err)
	}
	return snapshot
}

func localAppAgentOwnershipAvatarSnapshot(t *testing.T, avatarURL string) localAgentSourceSnapshotV2 {
	t.Helper()
	verified := verifiedRealmSourceMaterializationVectorV3(t, "world-character")
	snapshot, err := finalizeLocalAgentSourceSnapshotV2(
		verified,
		realmSourceMaterializationProductTestLocalAgentRef("avatar-projection"),
	)
	if err != nil {
		t.Fatal(err)
	}
	profileValue := snapshot.Semantic.Source.Profile.interfaceValue().(map[string]any)
	presentation := profileValue["presentation"].(map[string]any)
	presentation["avatarResourceRef"] = "external-avatar-mira"
	assets := profileValue["assets"].(map[string]any)
	assets["externalRefs"] = []any{map[string]any{
		"refId": "external-avatar-mira",
		"kind":  "image",
		"uri":   avatarURL,
	}}
	snapshot.Semantic.Source.Profile, err = normalizeSourceMaterializationJSONValue(profileValue)
	if err != nil {
		t.Fatal(err)
	}
	return snapshot
}

func TestLocalAppAgentOwnershipRequiresCurrentOwnerAndActiveLifecycle(t *testing.T) {
	svc := &Service{agents: map[string]*agentEntry{
		"agent-active-zeta": {Agent: &runtimev1.LocalAgentRecord{
			LocalAgentRef: "agent-active-zeta", DisplayName: "Zeta Agent", OwnerUserId: "acct-1",
			LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
		}},
		"agent-active-alpha-b": {Agent: &runtimev1.LocalAgentRecord{
			LocalAgentRef: "agent-active-alpha-b", DisplayName: "Alpha Agent", OwnerUserId: "acct-1",
			LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
		}},
		"agent-active-alpha-a": {Agent: &runtimev1.LocalAgentRecord{
			LocalAgentRef: "agent-active-alpha-a", DisplayName: "Alpha Agent", OwnerUserId: "acct-1",
			LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
		}},
		"agent-other-owner": {Agent: &runtimev1.LocalAgentRecord{
			LocalAgentRef: "agent-other-owner", DisplayName: "Other Owner", OwnerUserId: "acct-2",
			LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
		}},
		"agent-suspended": {Agent: &runtimev1.LocalAgentRecord{
			LocalAgentRef: "agent-suspended", DisplayName: "Suspended Agent", OwnerUserId: "acct-1",
			LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_SUSPENDED,
		}},
	}}
	owned, err := svc.OwnsActiveLocalAgent(context.Background(), "acct-1", "agent-active-zeta")
	if err != nil || !owned {
		t.Fatalf("active ownership = (%v, %v)", owned, err)
	}
	inventory, err := svc.ListOwnedActiveLocalAgents(context.Background(), "acct-1")
	if err != nil {
		t.Fatal(err)
	}
	want := [][2]string{
		{"agent-active-alpha-a", "Alpha Agent"},
		{"agent-active-alpha-b", "Alpha Agent"},
		{"agent-active-zeta", "Zeta Agent"},
	}
	if len(inventory) != len(want) {
		t.Fatalf("active owned inventory = %+v", inventory)
	}
	for index, expected := range want {
		if inventory[index].LocalAgentID != expected[0] || inventory[index].DisplayName != expected[1] {
			t.Fatalf("active owned inventory[%d] = %+v, want id=%q name=%q", index, inventory[index], expected[0], expected[1])
		}
	}
	for _, input := range [][2]string{{"acct-2", "agent-active-zeta"}, {"acct-1", "agent-suspended"}, {"acct-1", "agent-missing"}} {
		owned, err := svc.OwnsActiveLocalAgent(context.Background(), input[0], input[1])
		if err != nil || owned {
			t.Fatalf("ownership(%q, %q) = (%v, %v)", input[0], input[1], owned, err)
		}
	}
}

func TestLocalAppAgentAccountProjectionRejectsNonCanonicalIdentity(t *testing.T) {
	svc := &Service{agents: map[string]*agentEntry{
		"agent-invalid": {Agent: &runtimev1.LocalAgentRecord{
			LocalAgentRef: " agent-invalid", DisplayName: "Invalid Agent", OwnerUserId: "acct-1",
			LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
		}},
	}}
	if _, err := svc.ListOwnedActiveLocalAgents(context.Background(), "acct-1"); err == nil {
		t.Fatal("non-canonical Agent identity entered the account projection")
	}
}
