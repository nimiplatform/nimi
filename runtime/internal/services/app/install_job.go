package app

import (
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
	"github.com/nimiplatform/nimi/runtime/internal/streamutil"
	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// installJobManager owns the typed Nimi App install job projection. It mirrors
// the LocalEnvironmentDependencyJob model: a stable job id, a typed state and
// phase, and a server-stream watch surface. A failed install is recorded as a
// recoverable, retryable job and is never collapsed into success.
type installJobManager struct {
	mu          sync.RWMutex
	now         func() time.Time
	nextSeq     uint64
	nextSubID   uint64
	jobs        map[string]*runtimev1.AppInstallJob
	jobOrder    []string
	subscribers map[uint64]installJobSubscriber
}

type installJobSubscriber struct {
	id    uint64
	jobID string
	relay *streamutil.Relay[*runtimev1.AppInstallJobEvent]
}

func newInstallJobManager(now func() time.Time) *installJobManager {
	if now == nil {
		now = time.Now
	}
	return &installJobManager{
		now:         now,
		jobs:        make(map[string]*runtimev1.AppInstallJob),
		subscribers: make(map[uint64]installJobSubscriber),
	}
}

// activeJobForApp returns a non-terminal install job for the app, if any. It
// lets the handler coalesce duplicate install requests onto one job.
func (m *installJobManager) activeJobForApp(appID string) *runtimev1.AppInstallJob {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, id := range m.jobOrder {
		job := m.jobs[id]
		if job == nil || job.GetAppId() != appID {
			continue
		}
		if !installJobTerminal(job.GetState()) {
			return cloneInstallJob(job)
		}
	}
	return nil
}

// createJob registers a new queued install job and returns its snapshot.
func (m *installJobManager) createJob(appID string, descriptorRef string, version string, sourceKind runtimev1.AppInstallSourceKind, storage *runtimev1.AppInstallStorageProjection) *runtimev1.AppInstallJob {
	now := installJobTimestamp(m.now)
	job := &runtimev1.AppInstallJob{
		JobId:                "app_install_job_" + ulidLower(),
		AppId:                appID,
		ReleaseDescriptorRef: descriptorRef,
		InstalledVersion:     version,
		State:                runtimev1.AppInstallJobState_APP_INSTALL_JOB_STATE_QUEUED,
		Phase:                runtimev1.AppInstallJobPhase_APP_INSTALL_JOB_PHASE_QUEUED,
		SourceKind:           sourceKind,
		Storage:              storage,
		Retryable:            true,
		CreatedAt:            now,
		UpdatedAt:            now,
	}
	m.mu.Lock()
	m.jobs[job.JobId] = job
	m.jobOrder = append(m.jobOrder, job.JobId)
	m.mu.Unlock()
	m.publish(job)
	return cloneInstallJob(job)
}

// advance moves a job to a new in-progress phase and publishes a progress
// frame. State is set to IN_PROGRESS.
func (m *installJobManager) advance(jobID string, phase runtimev1.AppInstallJobPhase) {
	m.mutate(jobID, func(job *runtimev1.AppInstallJob) {
		job.State = runtimev1.AppInstallJobState_APP_INSTALL_JOB_STATE_IN_PROGRESS
		job.Phase = phase
	})
}

// recordVerified records the verified artifact digest and byte count on the
// job after the verify phase succeeds.
func (m *installJobManager) recordVerified(jobID string, sha256 string, artifactBytes int64) {
	m.mutate(jobID, func(job *runtimev1.AppInstallJob) {
		job.Sha256 = sha256
		job.ArtifactBytes = artifactBytes
	})
}

// markInstalled records terminal success with the resolved storage projection.
func (m *installJobManager) markInstalled(jobID string, version string, sha256 string, artifactBytes int64, storage *runtimev1.AppInstallStorageProjection) *runtimev1.AppInstallJob {
	return m.mutate(jobID, func(job *runtimev1.AppInstallJob) {
		job.State = runtimev1.AppInstallJobState_APP_INSTALL_JOB_STATE_INSTALLED
		job.Phase = runtimev1.AppInstallJobPhase_APP_INSTALL_JOB_PHASE_INSTALLED
		if version != "" {
			job.InstalledVersion = version
		}
		if sha256 != "" {
			job.Sha256 = sha256
		}
		if artifactBytes > 0 {
			job.ArtifactBytes = artifactBytes
		}
		if storage != nil {
			job.Storage = storage
		}
		job.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED
		job.Retryable = false
		job.FailureDetail = ""
	})
}

// markFailed records a fail-closed terminal state. The job stays retryable so
// the install can be retried or its partial files removed; it is never
// projected as success.
func (m *installJobManager) markFailed(jobID string, reason runtimev1.ReasonCode, detail string) *runtimev1.AppInstallJob {
	return m.mutate(jobID, func(job *runtimev1.AppInstallJob) {
		job.State = runtimev1.AppInstallJobState_APP_INSTALL_JOB_STATE_FAILED
		job.Phase = runtimev1.AppInstallJobPhase_APP_INSTALL_JOB_PHASE_FAILED
		job.ReasonCode = reason
		job.FailureDetail = detail
		job.Retryable = true
	})
}

func (m *installJobManager) mutate(jobID string, apply func(*runtimev1.AppInstallJob)) *runtimev1.AppInstallJob {
	m.mu.Lock()
	job, ok := m.jobs[jobID]
	if !ok {
		m.mu.Unlock()
		return nil
	}
	apply(job)
	job.UpdatedAt = installJobTimestamp(m.now)
	snapshot := cloneInstallJob(job)
	m.mu.Unlock()
	m.publish(snapshot)
	return snapshot
}

func (m *installJobManager) getJob(jobID string) (*runtimev1.AppInstallJob, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	job, ok := m.jobs[jobID]
	if !ok {
		return nil, false
	}
	return cloneInstallJob(job), true
}

func (m *installJobManager) listJobs(appID string) []*runtimev1.AppInstallJob {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]*runtimev1.AppInstallJob, 0, len(m.jobOrder))
	for _, id := range m.jobOrder {
		job := m.jobs[id]
		if job == nil {
			continue
		}
		if appID != "" && job.GetAppId() != appID {
			continue
		}
		out = append(out, cloneInstallJob(job))
	}
	return out
}

// subscribe registers a watch subscriber. An empty jobID streams every job.
func (m *installJobManager) subscribe(jobID string) installJobSubscriber {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.nextSubID++
	sub := installJobSubscriber{
		id:    m.nextSubID,
		jobID: jobID,
		relay: streamutil.NewRelay(streamutil.RelayOptions[*runtimev1.AppInstallJobEvent]{
			Budget:              32,
			MaxConsecutiveDrops: 3,
		}),
	}
	m.subscribers[sub.id] = sub
	return sub
}

func (m *installJobManager) unsubscribe(id uint64) {
	m.mu.Lock()
	sub, ok := m.subscribers[id]
	if ok {
		delete(m.subscribers, id)
	}
	m.mu.Unlock()
	if ok {
		sub.relay.Close()
	}
}

func (m *installJobManager) publish(job *runtimev1.AppInstallJob) {
	m.mu.Lock()
	m.nextSeq++
	event := &runtimev1.AppInstallJobEvent{
		Sequence:  m.nextSeq,
		Job:       cloneInstallJob(job),
		Timestamp: timestamppb.New(m.now().UTC()),
	}
	targets := make([]installJobSubscriber, 0, len(m.subscribers))
	for _, sub := range m.subscribers {
		if sub.jobID != "" && sub.jobID != job.GetJobId() {
			continue
		}
		targets = append(targets, sub)
	}
	m.mu.Unlock()
	for _, sub := range targets {
		_ = sub.relay.Enqueue(cloneInstallJobEvent(event))
	}
}

func installJobTerminal(state runtimev1.AppInstallJobState) bool {
	switch state {
	case runtimev1.AppInstallJobState_APP_INSTALL_JOB_STATE_INSTALLED,
		runtimev1.AppInstallJobState_APP_INSTALL_JOB_STATE_FAILED:
		return true
	default:
		return false
	}
}

func installJobTimestamp(now func() time.Time) string {
	return now().UTC().Format(time.RFC3339Nano)
}

func ulidLower() string {
	return strings.ToLower(ulid.Make().String())
}

func cloneInstallJob(job *runtimev1.AppInstallJob) *runtimev1.AppInstallJob {
	if job == nil {
		return nil
	}
	cloned, ok := proto.Clone(job).(*runtimev1.AppInstallJob)
	if !ok {
		return &runtimev1.AppInstallJob{}
	}
	return cloned
}

func cloneInstallJobEvent(event *runtimev1.AppInstallJobEvent) *runtimev1.AppInstallJobEvent {
	if event == nil {
		return nil
	}
	cloned, ok := proto.Clone(event).(*runtimev1.AppInstallJobEvent)
	if !ok {
		return &runtimev1.AppInstallJobEvent{}
	}
	return cloned
}

func storageProjectionFromPlan(plan appstorage.Plan) *runtimev1.AppInstallStorageProjection {
	return &runtimev1.AppInstallStorageProjection{
		AppRoot:         plan.AppRoot,
		ReleaseRoot:     plan.ReleaseRoot,
		DurableDataRoot: plan.DurableDataRoot,
		CacheRoot:       plan.CacheRoot,
		TempRoot:        plan.TempRoot,
	}
}
