package ai

import "context"

type scenarioActionKey struct{ account, subject, id, idempotency string }
type scenarioActionClaim struct {
	digest string
	done   chan struct{}
}

// @nimi-authority: rule.nimi.runtime.ai-provider.music-submission-identity
// Serialize the pre-publication capture by its canonical action owner. The
// durable identity still lives exclusively in the existing Job record.
func (s *scenarioJobStore) claimScenarioAction(ctx context.Context, owner *localAppJobOwner, submission *localAppMusicSubmission) (func(), error) {
	if !owner.valid() {
		return nil, errLocalAppSubmissionConflict
	}
	key := scenarioActionKey{account: owner.AccountID, subject: owner.RegisteredAppSubject, id: submission.ID}
	return s.claimScenarioCaptureIdentity(ctx, key, submission.RequestSHA256)
}

func (s *scenarioJobStore) claimScenarioIdempotency(ctx context.Context, scope string) (func(), error) {
	if scope == "" {
		return func() {}, nil
	}
	return s.claimScenarioCaptureIdentity(ctx, scenarioActionKey{idempotency: scope}, "")
}

func (s *scenarioJobStore) claimScenarioCaptureIdentity(ctx context.Context, key scenarioActionKey, digest string) (func(), error) {
	for {
		s.mu.Lock()
		if s.actionClaims == nil {
			s.actionClaims = make(map[scenarioActionKey]*scenarioActionClaim)
		}
		current := s.actionClaims[key]
		if current == nil {
			claim := &scenarioActionClaim{digest: digest, done: make(chan struct{})}
			s.actionClaims[key] = claim
			s.mu.Unlock()
			return func() {
				s.mu.Lock()
				delete(s.actionClaims, key)
				close(claim.done)
				s.mu.Unlock()
			}, nil
		}
		s.mu.Unlock()
		if current.digest != digest {
			return nil, errLocalAppSubmissionConflict
		}
		select {
		case <-current.done:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
}

type scenarioCaptureKey struct{}

// Capture concurrency is independent of execution and native reconcile slots.
// The protected entry may capture voice routing before calling the common
// entry; that nested call borrows the same slot instead of reacquiring it.
func (s *scenarioJobStore) admitScenarioCapture(ctx context.Context) (context.Context, func(), error) {
	if owner, _ := ctx.Value(scenarioCaptureKey{}).(*scenarioJobStore); owner == s {
		return ctx, func() {}, nil
	}
	s.mu.Lock()
	if s.captureSlots == nil {
		s.captureSlots = make(chan struct{}, 2)
	}
	slots := s.captureSlots
	s.mu.Unlock()
	select {
	case slots <- struct{}{}:
		return context.WithValue(ctx, scenarioCaptureKey{}, s), func() { <-slots }, nil
	case <-ctx.Done():
		return nil, nil, ctx.Err()
	}
}
