package localappkernel

import (
	"context"
	"fmt"
	"slices"
)

type jobRegistrationAuthority struct {
	subject                                 string
	sourceGeneration, declarationGeneration uint64
	invalidated                             chan struct{}
}

// BindJobRegistrationAuthority observes canonical registration changes only;
// connection/session teardown does not mutate this binding.
func (store *RegistrationStore) BindJobRegistrationAuthority(ctx context.Context, subject string, sourceGeneration, declarationGeneration uint64) (<-chan struct{}, func(), error) {
	var lease *jobRegistrationAuthority
	err := store.WithJobRegistrationAuthority(ctx, subject, sourceGeneration, declarationGeneration, func() error {
		lease = &jobRegistrationAuthority{subject: subject, sourceGeneration: sourceGeneration, declarationGeneration: declarationGeneration, invalidated: make(chan struct{})}
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
		if err != nil || r.State != RegistrationStateActive || r.SourceGeneration != lease.sourceGeneration || r.DeclarationGeneration != lease.declarationGeneration || !slices.Contains(r.ActivatedDomains, "runtime.consume") {
			delete(kernel.jobAuthorities, lease)
			close(lease.invalidated)
		}
	}
}

// @nimi-authority: rule.nimi.runtime.service-operations.scenario-job-execution-scope
// WithJobRegistrationAuthority uses the canonical registration mutation lock,
// independently of a technical connection/session. Source or declaration
// withdrawal fences publication; ordinary Host disconnect does not.
func (store *RegistrationStore) WithJobRegistrationAuthority(ctx context.Context, subject string, sourceGeneration, declarationGeneration uint64, fn func() error) error {
	if store == nil || store.kernel == nil || fn == nil || subject == "" || sourceGeneration == 0 || declarationGeneration == 0 {
		return fmt.Errorf("Job registration authority is unavailable")
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
	if r.State != RegistrationStateActive || r.SourceGeneration != sourceGeneration || r.DeclarationGeneration != declarationGeneration || !slices.Contains(r.ActivatedDomains, "runtime.consume") {
		return ErrRegistrationTombstoned
	}
	return fn()
}
