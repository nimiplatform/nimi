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
	return store.withRegistrationRequirements(ctx, RegistrationRequirement{subject, sourceGeneration, declarationGeneration, domain}, nil, fn)
}

// RegistrationRequirement contains facts to recheck, not a grant or a retained lease.
type RegistrationRequirement struct {
	Subject                                 string
	SourceGeneration, DeclarationGeneration uint64
	Domain                                  string
}

// @nimi-authority: rule.nimi.runtime.integration.provider-lifetime
// WithRegistrationAuthorityPair checks both actual participants under the same
// canonical mutation lock. In particular, it never nests that non-reentrant lock.
func (store *RegistrationStore) WithRegistrationAuthorityPair(ctx context.Context, consumer, provider RegistrationRequirement, fn func() error) error {
	return store.withRegistrationRequirements(ctx, consumer, &provider, fn)
}

func (store *RegistrationStore) withRegistrationRequirements(ctx context.Context, first RegistrationRequirement, second *RegistrationRequirement, fn func() error) error {
	valid := func(r RegistrationRequirement) bool {
		return r.Subject != "" && r.SourceGeneration != 0 && r.DeclarationGeneration != 0 && (r.Domain == "" || appaccess.IsSupportedDomain(r.Domain))
	}
	if store == nil || store.kernel == nil || fn == nil || !valid(first) || (second != nil && !valid(*second)) {
		return fmt.Errorf("registration authority is unavailable")
	}
	store.kernel.mu.Lock()
	defer store.kernel.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	r, err := loadCanonicalBySubject(ctx, store.kernel.db, first.Subject)
	if err != nil {
		return err
	}
	if r.State != RegistrationStateActive || r.SourceGeneration != first.SourceGeneration || r.DeclarationGeneration != first.DeclarationGeneration || (first.Domain != "" && !slices.Contains(r.ActivatedDomains, first.Domain)) {
		return ErrRegistrationTombstoned
	}
	if second != nil {
		// A single subject can serve both roles but must cover both domains.
		if second.Subject != first.Subject {
			r, err = loadCanonicalBySubject(ctx, store.kernel.db, second.Subject)
			if err != nil {
				return err
			}
		}
		if r.State != RegistrationStateActive || r.SourceGeneration != second.SourceGeneration || r.DeclarationGeneration != second.DeclarationGeneration || (second.Domain != "" && !slices.Contains(r.ActivatedDomains, second.Domain)) {
			return ErrRegistrationTombstoned
		}
	}
	return fn()
}
