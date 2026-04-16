// Package cognition assembles the standalone local cognition service.
//
// It owns per-agent local kernels, memory substrate, knowledge projections,
// skill artifacts, transient working state, and prompt serving. It does not
// own runtime canonical truth, replication, review, or control-plane state.
package cognition

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/internal/clock"
	"github.com/nimiplatform/nimi/nimi-cognition/internal/refgraph"
	scopepkg "github.com/nimiplatform/nimi/nimi-cognition/internal/scope"
	"github.com/nimiplatform/nimi/nimi-cognition/internal/storage"
	"github.com/nimiplatform/nimi/nimi-cognition/kernel"
	"github.com/nimiplatform/nimi/nimi-cognition/kernelops"
	"github.com/nimiplatform/nimi/nimi-cognition/routine"
	"github.com/nimiplatform/nimi/nimi-cognition/working"
)

// Cognition is the assembled standalone local cognition service.
type Cognition struct {
	store    *storage.SQLiteBackend
	clock    clock.Clock
	engine   *kernelops.Engine
	refgraph *refgraph.Service
	working  *workingStore

	kernelSvc    *KernelService
	memorySvc    *MemoryService
	knowledgeSvc *KnowledgeService
	skillSvc     *SkillService
	workingSvc   *WorkingService
	promptSvc    *PromptService
}

// KernelService handles kernel access and mutation.
type KernelService struct {
	store  *storage.SQLiteBackend
	engine *kernelops.Engine
}

// MemoryService owns memory substrate persistence and retrieval.
type MemoryService struct {
	store    *storage.SQLiteBackend
	refgraph *refgraph.Service
}

// KnowledgeService owns knowledge projections.
type KnowledgeService struct {
	store    *storage.SQLiteBackend
	refgraph *refgraph.Service
	clock    clock.Clock
}

// SkillService owns advisory skill bundles.
type SkillService struct {
	store    *storage.SQLiteBackend
	refgraph *refgraph.Service
}

// WorkingService owns transient working state.
type WorkingService struct {
	store *workingStore
}

// PromptService formats core and advisory prompt context without collapsing
// knowledge or skills into kernel rules.
type PromptService struct {
	store    *storage.SQLiteBackend
	refgraph *refgraph.Service
}

type workingStore struct {
	mu     sync.RWMutex
	states map[string]working.State
}

type routineArtifactAccess struct {
	store     *storage.SQLiteBackend
	memorySvc *MemoryService
	knowledge *KnowledgeService
	skill     *SkillService
}

type routineGraphAccess struct {
	refgraph *refgraph.Service
}

// New creates a Cognition instance rooted at the given directory.
func New(rootDir string, opts ...Option) (*Cognition, error) {
	cfg := defaultConfig()
	for _, opt := range opts {
		opt(&cfg)
	}
	store, err := storage.NewSQLiteBackend(rootDir)
	if err != nil {
		return nil, fmt.Errorf("cognition: %w", err)
	}
	clk := cfg.clock
	if clk == nil {
		clk = clock.RealClock{}
	}
	engine := kernelops.NewEngine(store, clk)
	graph := refgraph.New(store)
	workingStore := &workingStore{states: map[string]working.State{}}

	c := &Cognition{
		store:    store,
		clock:    clk,
		engine:   engine,
		refgraph: graph,
		working:  workingStore,
	}
	c.kernelSvc = &KernelService{store: store, engine: engine}
	c.memorySvc = &MemoryService{store: store, refgraph: graph}
	c.knowledgeSvc = &KnowledgeService{store: store, refgraph: graph, clock: clk}
	c.skillSvc = &SkillService{store: store, refgraph: graph}
	c.workingSvc = &WorkingService{store: workingStore}
	c.promptSvc = &PromptService{store: store, refgraph: graph}
	if err := c.knowledgeSvc.markInterruptedIngestTasks(); err != nil {
		_ = store.Close()
		return nil, fmt.Errorf("cognition: %w", err)
	}
	return c, nil
}

// Close closes the underlying storage backend and clears transient state.
func (c *Cognition) Close() error {
	if c == nil {
		return nil
	}
	if c.working != nil {
		c.working.clearAll()
	}
	return c.store.Close()
}

// KernelService returns the kernel subservice.
func (c *Cognition) KernelService() *KernelService { return c.kernelSvc }

// MemoryService returns the memory subservice.
func (c *Cognition) MemoryService() *MemoryService { return c.memorySvc }

// KnowledgeService returns the knowledge subservice.
func (c *Cognition) KnowledgeService() *KnowledgeService { return c.knowledgeSvc }

// SkillService returns the skill subservice.
func (c *Cognition) SkillService() *SkillService { return c.skillSvc }

// WorkingService returns the transient working-state subservice.
func (c *Cognition) WorkingService() *WorkingService { return c.workingSvc }

// PromptService returns the prompt subservice.
func (c *Cognition) PromptService() *PromptService { return c.promptSvc }

// KernelEngine exposes the kernel mutation surface for direct use.
func (c *Cognition) KernelEngine() *kernelops.Engine { return c.engine }

// NewRoutineContext builds a scoped external routine context backed by the
// standalone cognition services. It does not expose kernel mutation access.
func (c *Cognition) NewRoutineContext(scopeID string) (routine.Context, error) {
	if err := validateScopeID(scopeID); err != nil {
		return routine.Context{}, err
	}
	return routine.Context{
		ScopeID: scopeID,
		Storage: &routineArtifactAccess{
			store:     c.store,
			memorySvc: c.memorySvc,
			knowledge: c.knowledgeSvc,
			skill:     c.skillSvc,
		},
		Graph: &routineGraphAccess{refgraph: c.refgraph},
		Clock: c.clock.Now,
	}, nil
}

// InitScope initializes empty kernels for a new scope.
func (c *Cognition) InitScope(scopeID string) error {
	if err := validateScopeID(scopeID); err != nil {
		return fmt.Errorf("init scope: %w", err)
	}
	for _, kind := range []kernel.KernelType{kernel.KernelTypeAgentModel, kernel.KernelTypeWorldModel} {
		if err := c.kernelSvc.Init(scopeID, kind, c.clock.Now()); err != nil {
			return fmt.Errorf("init scope: %w", err)
		}
	}
	return nil
}

// DeleteScope removes all standalone cognition data for a scope.
func (c *Cognition) DeleteScope(scopeID string) error {
	if err := validateScopeID(scopeID); err != nil {
		return fmt.Errorf("delete scope: %w", err)
	}
	c.working.clear(scopeID)
	return c.store.DeleteScope(scopeID)
}

// ListScopes lists scopes known to the standalone cognition store.
func (c *Cognition) ListScopes() ([]string, error) {
	return c.store.ListScopes()
}

type config struct {
	clock clock.Clock
}

func defaultConfig() config { return config{} }

// Option configures a Cognition instance.
type Option func(*config)

// WithClock injects a custom clock.
func WithClock(clk clock.Clock) Option {
	return func(c *config) { c.clock = clk }
}

func validateScopeID(scopeID string) error {
	return scopepkg.Validate(scopeID)
}

func blockingDeleteBlockers(blockers []refgraph.Blocker) []refgraph.Blocker {
	filtered := make([]refgraph.Blocker, 0, len(blockers))
	for _, blocker := range blockers {
		switch blocker.Kind {
		case routine.BlockerKindStrongRef:
			filtered = append(filtered, blocker)
		case routine.BlockerKindWeakRef, routine.BlockerKindDownstreamLiveDependency:
			if blocker.SourceActive {
				filtered = append(filtered, blocker)
			}
		}
	}
	return filtered
}

func formatDeleteBlockers(blockers []refgraph.Blocker) string {
	parts := make([]string, 0, len(blockers))
	for _, blocker := range blockers {
		part := string(blocker.Kind)
		if blocker.SourceKind != "" && blocker.SourceID != "" {
			part = fmt.Sprintf("%s:%s/%s", blocker.Kind, blocker.SourceKind, blocker.SourceID)
			if blocker.SourceLifecycle != "" {
				part = fmt.Sprintf("%s(%s)", part, blocker.SourceLifecycle)
			}
		}
		parts = append(parts, part)
	}
	return strings.Join(parts, ", ")
}

// Init creates an empty kernel if it does not already exist.
func (s *KernelService) Init(scopeID string, kt kernel.KernelType, now time.Time) error {
	if err := validateScopeID(scopeID); err != nil {
		return err
	}
	if existing, _, err := s.store.LoadKernelState(scopeID, kt); err != nil {
		return err
	} else if existing != nil {
		return nil
	}
	k := kernel.Kernel{
		KernelID:   scopeID + "_" + string(kt),
		ScopeID:    scopeID,
		KernelType: kt,
		Version:    1,
		Status:     kernel.KernelStatusActive,
		RuleRefs:   []kernel.RuleID{},
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	raw, err := json.Marshal(struct {
		Kernel kernel.Kernel `json:"kernel"`
		Rules  []kernel.Rule `json:"rules"`
	}{Kernel: k, Rules: []kernel.Rule{}})
	if err != nil {
		return fmt.Errorf("kernel init: marshal: %w", err)
	}
	return s.store.Save(scopeID, storage.KindKernel, string(kt), raw)
}

// Load returns the current kernel aggregate.
func (s *KernelService) Load(scopeID string, kt kernel.KernelType) (*kernel.Kernel, []kernel.Rule, error) {
	return s.store.LoadKernelState(scopeID, kt)
}

// Engine exposes the kernelops engine.
func (s *KernelService) Engine() *kernelops.Engine { return s.engine }
