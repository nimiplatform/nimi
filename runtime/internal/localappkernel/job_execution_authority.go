package localappkernel

import (
	"context"
	"fmt"
	"slices"

	"github.com/nimiplatform/nimi/runtime/internal/appaccess"
)

type jobRegistrationAuthority struct {
	subject                                 string
	domain                                  string
	sourceGeneration, declarationGeneration uint64
	invalidated                             chan struct{}
}

// BindJobRegistrationAuthority observes canonical registration changes only;
// connection/session teardown does not mutate this binding.
func (store *RegistrationStore) BindJobRegistrationAuthority(ctx context.Context, subject string, sourceGeneration, declarationGeneration uint64, domain string) (<-chan struct{}, func(), error) {
	if domain != "runtime.consume" && domain != "agent.local" {
		return nil, nil, fmt.Errorf("Job registration authority is unavailable")
	}
	var lease *jobRegistrationAuthority
	err := store.WithRegistrationAuthority(ctx, subject, sourceGeneration, declarationGeneration, domain, func() error {
		lease = &jobRegistrationAuthority{subject: subject, domain: domain, sourceGeneration: sourceGeneration, declarationGeneration: declarationGeneration, invalidated: make(chan struct{})}
		if store.kernel.jobAuthorities == nil {
			store.kernel.jobAuthorities = make(map[*jobRegistrationAuthority]struct{})
		}
		store.kernel.jobAuthorities[lease] = struct{}{}
		return nil
	})
	if err != nil {
		return nil, nil, err
	}
	release := func() {
		store.kernel.mu.Lock()
		defer store.kernel.mu.Unlock()
		if _, exists := store.kernel.jobAuthorities[lease]; exists {
			delete(store.kernel.jobAuthorities, lease)
			close(lease.invalidated)
		}
	}
	return lease.invalidated, release, nil
}

// Called under the registration mutation lock only after its real SQL commit.
// A failed lookup fails closed; an unrelated registration/package change does
// not cancel another subject's work. No session or provider state is consulted.
func (kernel *Kernel) invalidateJobAuthoritiesLocked() {
	for lease := range kernel.jobAuthorities {
		r, err := loadCanonicalBySubject(context.Background(), kernel.db, lease.subject)
		if err != nil || r.State != RegistrationStateActive || r.SourceGeneration != lease.sourceGeneration || r.DeclarationGeneration != lease.declarationGeneration || !slices.Contains(r.ActivatedDomains, lease.domain) {
			delete(kernel.jobAuthorities, lease)
			close(lease.invalidated)
		}
	}
}

// @nimi-authority: rule.nimi.runtime.service-operations.scenario-job-execution-scope
// @nimi-authority: rule.nimi.runtime.app-surface.r055
// WithRegistrationAuthority uses the canonical registration mutation lock,
// independently of a technical connection/session. Source or declaration
// withdrawal fences publication; ordinary Host disconnect does not. An empty
// domain is only the canonical base-operation class, never an App-access grant.
func (store *RegistrationStore) WithRegistrationAuthority(ctx context.Context, subject string, sourceGeneration, declarationGeneration uint64, domain string, fn func() error) error {
	if store == nil || store.kernel == nil || fn == nil || subject == "" || sourceGeneration == 0 || declarationGeneration == 0 ||
		(domain != "" && !appaccess.IsSupportedDomain(domain)) {
		return fmt.Errorf("registration authority is unavailable")
	}
	store.kernel.mu.Lock()
	defer store.kernel.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	r, err := loadCanonicalBySubject(ctx, store.kernel.db, subject)
	if err != nil {
		return err
	}
	if r.State != RegistrationStateActive || r.SourceGeneration != sourceGeneration || r.DeclarationGeneration != declarationGeneration || (domain != "" && !slices.Contains(r.ActivatedDomains, domain)) {
		return ErrRegistrationTombstoned
	}
	return fn()
}
