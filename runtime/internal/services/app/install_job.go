package app

import (
	"context"
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
	// cancels holds the cancel func of every in-flight job so a
	// HealthRepairApp(cancel) request can interrupt it.
	cancels map[string]context.CancelFunc
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
		cancels:     make(map[string]context.CancelFunc),
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

// jobSpec describes a new lifecycle job (install / update / repair).
type jobSpec struct {
	appID           string
	descriptorRef   string
	version         string
	previousVersion string
	kind            runtimev1.AppLifecycleJobKind
	sourceKind      runtimev1.AppInstallSourceKind
	storage         *runtimev1.AppInstallStorageProjection
}

// createJob registers a new queued lifecycle job and returns its snapshot. The
// job kind distinguishes install / update / repair; install / update / repair
// jobs share the AppInstallJob shape.
func (m *installJobManager) createJob(spec jobSpec) *runtimev1.AppInstallJob {
	now := installJobTimestamp(m.now)
	job := &runtimev1.AppInstallJob{
		JobId:                "app_install_job_" + ulidLower(),
		AppId:                spec.appID,
		ReleaseDescriptorRef: spec.descriptorRef,
		InstalledVersion:     spec.version,
		PreviousVersion:      spec.previousVersion,
		Kind:                 spec.kind,
		State:                runtimev1.AppInstallJobState_APP_INSTALL_JOB_STATE_QUEUED,
		Phase:                runtimev1.AppInstallJobPhase_APP_INSTALL_JOB_PHASE_QUEUED,
		SourceKind:           spec.sourceKind,
		Storage:              spec.storage,
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

// markUninstalled records terminal success of an uninstall lifecycle job
// (K-APP-017). The job reaches the dedicated UNINSTALLED state/phase; a
// successful uninstall is never projected as INSTALLED.
func (m *installJobManager) markUninstalled(jobID string, storage *runtimev1.AppInstallStorageProjection) *runtimev1.AppInstallJob {
	return m.mutate(jobID, func(job *runtimev1.AppInstallJob) {
		job.State = runtimev1.AppInstallJobState_APP_INSTALL_JOB_STATE_UNINSTALLED
		job.Phase = runtimev1.AppInstallJobPhase_APP_INSTALL_JOB_PHASE_UNINSTALLED
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

// markCancelled records a fail-closed terminal cancelled state. A cancelled
// job stays retryable so the operation can be retried; it is never projected
// as success.
func (m *installJobManager) markCancelled(jobID string) *runtimev1.AppInstallJob {
	return m.mutate(jobID, func(job *runtimev1.AppInstallJob) {
		job.State = runtimev1.AppInstallJobState_APP_INSTALL_JOB_STATE_CANCELLED
		job.Phase = runtimev1.AppInstallJobPhase_APP_INSTALL_JOB_PHASE_CANCELLED
		job.ReasonCode = runtimev1.ReasonCode_APP_LIFECYCLE_JOB_CANCELLED
		job.FailureDetail = "lifecycle job cancelled by healthRepair(cancel)"
		job.Retryable = true
	})
}

// registerCancel records the cancel func of an in-flight job.
func (m *installJobManager) registerCancel(jobID string, cancel context.CancelFunc) {
	if cancel == nil {
		return
	}
	m.mu.Lock()
	m.cancels[jobID] = cancel
	m.mu.Unlock()
}

// clearCancel removes a job's cancel func once the job goroutine has exited.
func (m *installJobManager) clearCancel(jobID string) {
	m.mu.Lock()
	delete(m.cancels, jobID)
	m.mu.Unlock()
}

// cancelJob interrupts an in-flight job. It returns false when the job is not
// in flight (already terminal or unknown).
func (m *installJobManager) cancelJob(jobID string) bool {
	m.mu.Lock()
	cancel, ok := m.cancels[jobID]
	if ok {
		delete(m.cancels, jobID)
	}
	m.mu.Unlock()
	if !ok {
		return false
	}
	cancel()
	return true
}

// jobInFlight reports whether a job is currently being executed.
func (m *installJobManager) jobInFlight(jobID string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	_, ok := m.cancels[jobID]
	return ok
}

// recentRecoverableJobForApp returns the most recently created job for the app
// that is in a recoverable terminal state (FAILED or CANCELLED), or any
// in-flight job. It lets HealthRepairApp resolve a target job when the caller
// did not pass an explicit job_id.
func (m *installJobManager) recentRecoverableJobForApp(appID string) *runtimev1.AppInstallJob {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for i := len(m.jobOrder) - 1; i >= 0; i-- {
		job := m.jobs[m.jobOrder[i]]
		if job == nil || job.GetAppId() != appID {
			continue
		}
		switch job.GetState() {
		case runtimev1.AppInstallJobState_APP_INSTALL_JOB_STATE_FAILED,
			runtimev1.AppInstallJobState_APP_INSTALL_JOB_STATE_CANCELLED,
			runtimev1.AppInstallJobState_APP_INSTALL_JOB_STATE_QUEUED,
			runtimev1.AppInstallJobState_APP_INSTALL_JOB_STATE_IN_PROGRESS:
			return cloneInstallJob(job)
		}
	}
	return nil
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

// subscribe registers a watch subscriber for one job and enqueues the current
// snapshot so callers that subscribe after job creation still observe typed
// state before later progress frames.
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
	if job := m.jobs[jobID]; job != nil {
		m.nextSeq++
		_ = sub.relay.Enqueue(&runtimev1.AppInstallJobEvent{
			Sequence:  m.nextSeq,
			Job:       cloneInstallJob(job),
			Timestamp: timestamppb.New(m.now().UTC()),
		})
	}
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
		runtimev1.AppInstallJobState_APP_INSTALL_JOB_STATE_UNINSTALLED,
		runtimev1.AppInstallJobState_APP_INSTALL_JOB_STATE_FAILED,
		runtimev1.AppInstallJobState_APP_INSTALL_JOB_STATE_CANCELLED:
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
