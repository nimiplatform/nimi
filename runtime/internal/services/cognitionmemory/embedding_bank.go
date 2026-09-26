package cognitionmemory

import "context"

type embeddingBankGate struct {
	turn  chan struct{}
	users int
}

func (f *Facade) acquireEmbeddingBank(ctx context.Context, bank string) (func(), error) {
	f.embeddingMu.Lock()
	if f.embeddingBanks == nil {
		f.embeddingBanks = make(map[string]*embeddingBankGate)
	}
	gate := f.embeddingBanks[bank]
	if gate == nil {
		gate = &embeddingBankGate{turn: make(chan struct{}, 1)}
		f.embeddingBanks[bank] = gate
	}
	gate.users++
	f.embeddingMu.Unlock()
	drop := func() {
		f.embeddingMu.Lock()
		gate.users--
		if gate.users == 0 {
			delete(f.embeddingBanks, bank)
		}
		f.embeddingMu.Unlock()
	}
	select {
	case gate.turn <- struct{}{}:
		release := func() { <-gate.turn; drop() }
		if err := ctx.Err(); err != nil {
			release()
			return nil, err
		}
		return release, nil
	case <-ctx.Done():
		drop()
		return nil, ctx.Err()
	}
}
