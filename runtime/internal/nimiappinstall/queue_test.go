package nimiappinstall

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/filedownload"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/publicappregistry"
)

// These owner tests use bounded HTTP bodies and an injected Registry resolver.
// They exercise scheduling/control and real socket cancellation, not package
// admission or a successful native App installation.
type queueRegistry struct {
	mu       sync.Mutex
	targets  map[string]publicappregistry.ResolvedApprovedTarget
	failures map[string]error
}

func (registry *queueRegistry) Revalidate(ctx context.Context, selector publicappregistry.ApprovedTargetSelector) (publicappregistry.ResolvedApprovedTarget, error) {
	if err := ctx.Err(); err != nil {
		return publicappregistry.ResolvedApprovedTarget{}, err
	}
	registry.mu.Lock()
	defer registry.mu.Unlock()
	if err := registry.failures[selector.DescriptorID()]; err != nil {
		return publicappregistry.ResolvedApprovedTarget{}, err
	}
	return registry.targets[selector.DescriptorID()], nil
}
func (registry *queueRegistry) RevalidateInstalled(ctx context.Context, selector publicappregistry.ApprovedTargetSelector) (publicappregistry.ResolvedApprovedTarget, error) {
	return registry.Revalidate(ctx, selector)
}

func newQueueOwner(t *testing.T, server *httptest.Server, payload []byte, decorate func(targetDownloader) targetDownloader) (*Coordinator, *queueRegistry, *localappkernel.Kernel) {
	t.Helper()
	targetID, targetOS, targetArch, err := publicappregistry.CurrentPlatformTarget()
	if err != nil {
		t.Skip("App package target is unavailable on this test host")
	}
	registry := &queueRegistry{targets: make(map[string]publicappregistry.ResolvedApprovedTarget), failures: make(map[string]error)}
	for _, name := range []string{"one", "two", "three", "four"} {
		appID, revision := "publisher."+name, strings.Repeat("a", 40)
		descriptor := appID + "@1.2.3"
		encode := base64.RawURLEncoding.EncodeToString
		selector, err := publicappregistry.ParseApprovedTargetSelector("nats_v1_" + encode([]byte(descriptor)) + "." + encode([]byte(targetID)) + "." + encode([]byte(revision)))
		if err != nil {
			t.Fatal(err)
		}
		digest := sha256.Sum256(payload)
		repository := "https://github.com/publisher/" + name
		registry.targets[descriptor] = publicappregistry.ResolvedApprovedTarget{
			Selector: selector, DescriptorID: descriptor, RegistryRevision: revision, Visibility: "public", AppID: appID, DisplayName: name, Version: "1.2.3",
			Source: publicappregistry.Source{Repository: repository}, Release: publicappregistry.Release{Tag: "v1.2.3", Immutable: true},
			Package: publicappregistry.Package{Kind: "nimiapp", RuntimeKind: "native", RegistrationMode: "app-managed"},
			Target:  publicappregistry.Target{TargetID: targetID, OS: targetOS, Arch: targetArch, AssetName: name + ".nimiapp", AssetURL: repository + "/releases/download/v1.2.3/" + name + ".nimiapp", Size: int64(len(payload)), SHA256: hex.EncodeToString(digest[:])},
		}
	}
	endpoint, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	transport := server.Client().Transport
	if transport == nil {
		transport = http.DefaultTransport
	}
	var downloader targetDownloader = newDownloader(roundTripFunc(func(request *http.Request) (*http.Response, error) {
		local := request.Clone(request.Context())
		copiedURL := *request.URL
		local.URL = &copiedURL
		local.URL.Scheme, local.URL.Host = endpoint.Scheme, endpoint.Host
		return transport.RoundTrip(local)
	}), nil)
	if decorate != nil {
		downloader = decorate(downloader)
	}
	root := t.TempDir()
	identity, err := localappkernel.ValidateVerifiedWindowsInteractiveUserSID("S-1-5-21-100-200-300-1001")
	if err != nil {
		t.Fatal(err)
	}
	databasePath, _ := localappkernel.CanonicalRegistrationDatabasePath(root)
	kernel, err := localappkernel.OpenSQLite(context.Background(), databasePath, identity, localappkernel.Options{HostInstallID: "queue-owner-test", DataRoot: root})
	if err != nil {
		t.Fatal(err)
	}
	owner, err := newCoordinator(registry, downloader, kernel)
	if err != nil {
		_ = kernel.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = owner.Close(); _ = kernel.Close() })
	return owner, registry, kernel
}

func startQueueTestJob(t *testing.T, owner *Coordinator, registry *queueRegistry, name string) localappkernel.PackageJob {
	t.Helper()
	job, err := owner.StartInstall(context.Background(), registry.targets["publisher."+name+"@1.2.3"].Selector)
	if err != nil {
		t.Fatal(err)
	}
	return job
}

func waitQueueJob(t *testing.T, kernel *localappkernel.Kernel, id string, predicate func(localappkernel.PackageJob) bool) localappkernel.PackageJob {
	t.Helper()
	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()
	tick := time.NewTicker(time.Millisecond)
	defer tick.Stop()
	for {
		job, err := kernel.PackageLifecycle().GetJob(context.Background(), id)
		if err != nil {
			t.Fatal(err)
		}
		if predicate(job) {
			return job
		}
		select {
		case <-deadline.C:
			t.Fatalf("job did not reach expected state: %+v", job)
		case <-tick.C:
		}
	}
}

type queueRequest struct {
	name, byteRange string
	stopped         <-chan struct{}
}

func receiveQueueRequest(t *testing.T, requests <-chan queueRequest) queueRequest {
	t.Helper()
	select {
	case request := <-requests:
		return request
	case <-time.After(5 * time.Second):
		t.Fatal("download did not start")
		return queueRequest{}
	}
}

func serveQueuePrefix(payload []byte, requests chan<- queueRequest) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		name := strings.Split(request.URL.Path, "/")[2]
		stopped := make(chan struct{})
		defer close(stopped)
		start := 0
		if header := request.Header.Get("Range"); header != "" {
			start, _ = strconv.Atoi(strings.TrimSuffix(strings.TrimPrefix(header, "bytes="), "-"))
			writer.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, len(payload)-1, len(payload)))
			writer.Header().Set("Content-Length", strconv.Itoa(len(payload)-start))
			writer.WriteHeader(http.StatusPartialContent)
		} else {
			writer.Header().Set("Content-Length", strconv.Itoa(len(payload)))
		}
		end := min(start+4096, len(payload))
		_, _ = writer.Write(payload[start:end])
		writer.(http.Flusher).Flush()
		requests <- queueRequest{name: name, byteRange: request.Header.Get("Range"), stopped: stopped}
		<-request.Context().Done()
	}
}

func TestQueuePauseReleasesSocketResumesPrefixAndHonorsReorder(t *testing.T) {
	payload := bytes.Repeat([]byte("queue-body"), 16*1024)
	requests := make(chan queueRequest, 10)
	server := httptest.NewServer(serveQueuePrefix(payload, requests))
	t.Cleanup(server.Close)
	owner, registry, kernel := newQueueOwner(t, server, payload, nil)
	one := startQueueTestJob(t, owner, registry, "one")
	first := receiveQueueRequest(t, requests)
	if first.name != "one" {
		t.Fatal(first.name)
	}
	waitQueueJob(t, kernel, one.JobID, func(job localappkernel.PackageJob) bool {
		return job.Phase == localappkernel.PackageJobDownloading && job.BytesCompleted > 0
	})
	two := startQueueTestJob(t, owner, registry, "two")
	three := startQueueTestJob(t, owner, registry, "three")
	if _, err := owner.ReorderInstall(context.Background(), three.JobID, two.JobID); err != nil {
		t.Fatal(err)
	}
	paused, err := owner.PauseInstall(context.Background(), one.JobID)
	if err != nil || paused.Phase != localappkernel.PackageJobPaused || paused.ReasonCode != "user-paused" || paused.BytesCompleted == 0 || paused.SpeedBytesPerSec != 0 {
		t.Fatalf("pause=%+v err=%v", paused, err)
	}
	select {
	case <-first.stopped:
	case <-time.After(time.Second):
		t.Fatal("paused socket remained active")
	}
	next := receiveQueueRequest(t, requests)
	if next.name != "three" {
		t.Fatalf("reorder selected %q", next.name)
	}
	waitQueueJob(t, kernel, three.JobID, func(job localappkernel.PackageJob) bool {
		return job.Phase == localappkernel.PackageJobDownloading && job.BytesCompleted > 0
	})
	queued, err := owner.ResumeInstall(context.Background(), one.JobID)
	if err != nil || queued.Phase != localappkernel.PackageJobQueued || queued.QueuePosition != 2 || queued.BytesCompleted != paused.BytesCompleted {
		t.Fatalf("resume=%+v err=%v", queued, err)
	}
	if _, err := owner.CancelInstall(context.Background(), two.JobID, localappkernel.PackageJobQueued, "user-canceled"); err != nil {
		t.Fatal(err)
	}
	if _, err := owner.CancelInstall(context.Background(), three.JobID, localappkernel.PackageJobDownloading, "user-canceled"); err != nil {
		t.Fatal(err)
	}
	resumed := receiveQueueRequest(t, requests)
	if resumed.name != "one" || resumed.byteRange != fmt.Sprintf("bytes=%d-", paused.BytesCompleted) {
		t.Fatalf("resume request=%+v retained=%d", resumed, paused.BytesCompleted)
	}
	waitQueueJob(t, kernel, one.JobID, func(job localappkernel.PackageJob) bool {
		return job.Phase == localappkernel.PackageJobDownloading && job.BytesCompleted > paused.BytesCompleted
	})
	if _, err := owner.PauseInstall(context.Background(), one.JobID); err != nil {
		t.Fatal(err)
	}
	if _, err := owner.CancelInstall(context.Background(), one.JobID, localappkernel.PackageJobPaused, "user-canceled"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(owner.packagesPath, packageWorkDirectory, one.JobID)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("canceled partial remains: %v", err)
	}
}

type holdVerificationDownloader struct {
	inner   targetDownloader
	reached chan struct{}
}

func (downloader *holdVerificationDownloader) Download(ctx context.Context, target publicappregistry.ResolvedApprovedTarget, root *os.Root, hooks DownloadHooks) (DownloadedPackage, error) {
	if target.AppID == "publisher.one" {
		complete := hooks.TransferComplete
		hooks.TransferComplete = func() error {
			if err := complete(); err != nil {
				return err
			}
			close(downloader.reached)
			<-ctx.Done()
			return ctx.Err()
		}
	}
	return downloader.inner.Download(ctx, target, root, hooks)
}

func TestQueueVerificationOverlapsNextTransferAndDataRootQuiesces(t *testing.T) {
	payload := bytes.Repeat([]byte("bounded-package"), 8*1024)
	requests := make(chan queueRequest, 10)
	prefix := serveQueuePrefix(payload, requests)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if strings.Contains(request.URL.Path, "/one/") {
			writer.Header().Set("Content-Length", strconv.Itoa(len(payload)))
			_, _ = writer.Write(payload)
			return
		}
		prefix(writer, request)
	}))
	t.Cleanup(server.Close)
	reached := make(chan struct{})
	owner, registry, kernel := newQueueOwner(t, server, payload, func(inner targetDownloader) targetDownloader {
		return &holdVerificationDownloader{inner: inner, reached: reached}
	})
	one := startQueueTestJob(t, owner, registry, "one")
	select {
	case <-reached:
	case <-time.After(5 * time.Second):
		t.Fatal("transfer did not enter verification")
	}
	two := startQueueTestJob(t, owner, registry, "two")
	request := receiveQueueRequest(t, requests)
	if request.name != "two" {
		t.Fatal(request.name)
	}
	first, err := owner.GetJob(context.Background(), one.JobID)
	if err != nil || first.Phase != localappkernel.PackageJobVerifying || first.BytesCompleted != uint64(len(payload)) {
		t.Fatalf("pipeline first=%+v err=%v", first, err)
	}
	waitQueueJob(t, kernel, two.JobID, func(job localappkernel.PackageJob) bool { return job.BytesCompleted > 0 })
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := owner.QuiesceDataRootContext(ctx); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{one.JobID, two.JobID} {
		job, err := kernel.PackageLifecycle().GetJob(ctx, id)
		if err != nil || job.Phase != localappkernel.PackageJobPaused || job.ReasonCode != "runtime-interrupted" || job.BytesCompleted == 0 {
			t.Fatalf("quiesced=%+v err=%v", job, err)
		}
	}
	if _, err := owner.ListJobs(ctx); !errors.Is(err, ErrInstallQuiescing) {
		t.Fatalf("old owner remained admitted: %v", err)
	}
	owner.ResumeDataRootAfterAbort()
	jobs, err := owner.ListJobs(ctx)
	if err != nil || len(jobs) != 2 || jobs[0].Phase != localappkernel.PackageJobPaused || jobs[1].Phase != localappkernel.PackageJobPaused {
		t.Fatalf("abort resumed network: %+v %v", jobs, err)
	}
	owner.workersMu.Lock()
	workers, slot := len(owner.workers), owner.downloadJob
	owner.workersMu.Unlock()
	if workers != 0 || slot != "" {
		t.Fatalf("abort restored executor workers=%d slot=%s", workers, slot)
	}
	if err := owner.QuiesceDataRootContext(ctx); err != nil {
		t.Fatal(err)
	}
	// After successful handoff, Close may release the old os.Root handle but
	// cannot query the old DB or restart recovery against that former root.
	if err := kernel.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := owner.CancelUninstall(ctx, "apj_v1_absent", localappkernel.PackageJobQueued, "user-canceled"); !errors.Is(err, ErrInstallQuiescing) {
		t.Fatalf("CancelUninstall read the retired root: %v", err)
	}
	if err := owner.Recover(ctx); !errors.Is(err, ErrInstallQuiescing) {
		t.Fatalf("Recover read the retired root: %v", err)
	}
	if err := owner.Close(); err != nil {
		t.Fatalf("Close touched quiesced database: %v", err)
	}
}

func TestResumeRevalidatesBeforeQueueAndKnownIntegrityFailureStaysFailed(t *testing.T) {
	payload := bytes.Repeat([]byte("partial"), 4096)
	requests := make(chan queueRequest, 5)
	server := httptest.NewServer(serveQueuePrefix(payload, requests))
	t.Cleanup(server.Close)
	owner, registry, kernel := newQueueOwner(t, server, payload, nil)
	job := startQueueTestJob(t, owner, registry, "one")
	receiveQueueRequest(t, requests)
	waitQueueJob(t, kernel, job.JobID, func(job localappkernel.PackageJob) bool { return job.BytesCompleted > 0 })
	if _, err := owner.PauseInstall(context.Background(), job.JobID); err != nil {
		t.Fatal(err)
	}
	registry.mu.Lock()
	registry.failures["publisher.one@1.2.3"] = publicappregistry.ErrStaleSelection
	registry.mu.Unlock()
	if _, err := owner.ResumeInstall(context.Background(), job.JobID); !errors.Is(err, publicappregistry.ErrStaleSelection) {
		t.Fatalf("stale resume=%v", err)
	}
	current, err := kernel.PackageLifecycle().GetJob(context.Background(), job.JobID)
	if err != nil || current.Phase != localappkernel.PackageJobFailed || current.ReasonCode != "stale-selection" {
		t.Fatalf("stale job=%+v err=%v", current, err)
	}
	target := registry.targets["publisher.two@1.2.3"]
	_, invalid, err := owner.beginInstallLocked(context.Background(), target.Selector, "", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	_ = owner.failInstall(canceled, invalid, filedownload.ErrHashMismatch, false)
	current, err = kernel.PackageLifecycle().GetJob(context.Background(), invalid.JobID)
	if err != nil || current.Phase != localappkernel.PackageJobFailed || current.ReasonCode != "verification-failed" {
		t.Fatalf("known bad content became cancellation: %+v err=%v", current, err)
	}
}

func TestRecoveryReopensFullPartialAndVerifiesWithoutHTTP(t *testing.T) {
	payload := bytes.Repeat([]byte("complete-but-not-a-native-package"), 4096)
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requests.Add(1)
		writer.WriteHeader(http.StatusInternalServerError)
	}))
	t.Cleanup(server.Close)
	owner, registry, kernel := newQueueOwner(t, server, payload, nil)
	ctx := context.Background()
	resolved := registry.targets["publisher.one@1.2.3"]
	_, job, err := owner.beginInstallLocked(ctx, resolved.Selector, "", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	job, err = kernel.PackageLifecycle().Advance(ctx, job.JobID, job.Phase, localappkernel.PackageJobDownloading, localappkernel.PackageJobProgress{BytesCompleted: 4096})
	if err != nil {
		t.Fatal(err)
	}
	work := filepath.Join(owner.packagesPath, packageWorkDirectory, job.JobID)
	if err := os.MkdirAll(filepath.Join(work, "native-probe"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(work, downloadedPackageName+".download"), payload, 0o600); err != nil {
		t.Fatal(err)
	}
	dataRoot := kernel.DataRoot()
	downloader := owner.downloader
	if err := owner.Close(); err != nil {
		t.Fatal(err)
	}
	if err := kernel.Close(); err != nil {
		t.Fatal(err)
	}
	identity, _ := localappkernel.ValidateVerifiedWindowsInteractiveUserSID("S-1-5-21-100-200-300-1001")
	databasePath, _ := localappkernel.CanonicalRegistrationDatabasePath(dataRoot)
	reopened, err := localappkernel.OpenSQLite(ctx, databasePath, identity, localappkernel.Options{HostInstallID: "queue-owner-test", DataRoot: dataRoot})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = reopened.Close() }()
	if err := Recover(ctx, reopened); err != nil {
		t.Fatal(err)
	}
	restored, err := newCoordinator(registry, downloader, reopened)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = restored.Close() }()
	current, err := restored.GetJob(ctx, job.JobID)
	if err != nil || current.Phase != localappkernel.PackageJobPaused || current.BytesCompleted != uint64(len(payload)) || current.TargetVersion != "1.2.3" || current.ReasonCode != "runtime-interrupted" {
		t.Fatalf("restored=%+v err=%v", current, err)
	}
	if _, err := os.Stat(filepath.Join(work, "native-probe")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("interrupted verification residue survived: %v", err)
	}
	if requests.Load() != 0 {
		t.Fatal("restart issued HTTP")
	}
	if _, err := restored.ResumeInstall(ctx, job.JobID); err != nil {
		t.Fatal(err)
	}
	current = waitQueueJob(t, reopened, job.JobID, func(job localappkernel.PackageJob) bool { return terminalPackagePhase(job.Phase) })
	if requests.Load() != 0 || current.Phase != localappkernel.PackageJobFailed || current.ReasonCode != "verification-failed" {
		t.Fatalf("full partial skipped required package verification or used HTTP: requests=%d job=%+v", requests.Load(), current)
	}
}
