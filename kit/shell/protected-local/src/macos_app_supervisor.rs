//! One current-user process owns installed App handles and their protected Runtime channel.
//! Home uses a mutually verified local connection. Closing that connection never stops a run.
use crate::{
    installed_app_control as native, macos_peer_trust, NimiHostError, NimiHostErrorReasonCode,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    ffi::CString,
    fs, io,
    os::{
        fd::{AsRawFd, OwnedFd},
        unix::{
            ffi::OsStrExt,
            fs::{DirBuilderExt, MetadataExt, OpenOptionsExt},
        },
    },
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{UnixListener, UnixStream},
    sync::oneshot,
};
use tonic::transport::Channel;

#[derive(Debug, Deserialize, Serialize)]
#[serde(
    tag = "operation",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum AppSupervisorCommand {
    List,
    Drain,
    Launch { launch_selector: String },
    Cancel { launch_selector: String },
    Status { launch_id: String },
    Focus { launch_id: String },
    Stop { launch_id: String },
    End { launch_id: String },
    Access { launch_id: String },
}
use AppSupervisorCommand as Op;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Run {
    launch_selector: String,
    launch_id: String,
    process_id: u32,
    app_id: String,
    version: String,
    #[serde(skip)]
    stopping: bool,
    #[serde(skip)]
    reaping: bool,
}

#[derive(Default)]
struct Registry {
    closing: bool,
    finished: HashMap<String, (String, Option<u32>)>,
    active: HashMap<String, Run>,
    pending: HashMap<String, Option<oneshot::Sender<()>>>,
}
type Runs = Arc<Mutex<Registry>>;
const MAX_FRAME: usize = 1024 * 1024;
fn refused() -> NimiHostError {
    NimiHostError::new(NimiHostErrorReasonCode::InstalledAppLaunchFailed, false)
}
fn unavailable() -> NimiHostError {
    NimiHostError::new(NimiHostErrorReasonCode::RuntimeServiceUnavailable, true)
}
fn wire_error(error: NimiHostError) -> Value {
    json!({"status":"error", "reasonCode":error.reason_code().as_str(), "retryable":error.retryable(), "reasonMetadata":error.reason_metadata()})
}
fn encode(id: &[u8; 32]) -> String {
    id.iter().map(|b| format!("{b:02x}")).collect()
}
fn decode(text: &str) -> Result<[u8; 32], NimiHostError> {
    if text.len() != 64
        || !text
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(refused());
    }
    let mut id = [0; 32];
    for (i, byte) in id.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&text[2 * i..2 * i + 2], 16).map_err(|_| refused())?;
    }
    Ok(id)
}
fn directory() -> io::Result<PathBuf> {
    unsafe extern "C" {
        fn nimi_macos_supervisor_session(asid: *mut u32) -> i32;
    }
    // SAFETY: the native call writes only to the supplied session ID.
    let mut asid = 0;
    if unsafe { nimi_macos_supervisor_session(&mut asid) } != 0 {
        return Err(io::ErrorKind::PermissionDenied.into());
    }
    // SAFETY: geteuid has no arguments or memory preconditions.
    let uid = unsafe { libc::geteuid() };
    let profile = if cfg!(feature = "macos-source-local-development") {
        "source"
    } else if cfg!(feature = "macos-local-development") {
        "dev"
    } else {
        "product"
    };
    let dir = PathBuf::from(format!(
        "/private/tmp/ai.nimi.supervisor.{uid}.{asid}.{profile}"
    ));
    match fs::DirBuilder::new().mode(0o700).create(&dir) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {}
        Err(e) => return Err(e),
    }
    let meta = fs::symlink_metadata(&dir)?;
    if !meta.is_dir() || meta.uid() != uid || meta.mode() & 0o777 != 0o700 {
        return Err(io::ErrorKind::PermissionDenied.into());
    }
    Ok(dir)
}

async fn frame(socket: &mut UnixStream) -> io::Result<Vec<u8>> {
    let size = socket.read_u32().await? as usize;
    if size == 0 || size > MAX_FRAME {
        return Err(io::ErrorKind::InvalidData.into());
    }
    let mut bytes = vec![0; size];
    socket.read_exact(&mut bytes).await?;
    Ok(bytes)
}
async fn write_frame(socket: &mut UnixStream, data: &[u8]) -> io::Result<()> {
    if data.len() > MAX_FRAME {
        return Err(io::ErrorKind::InvalidData.into());
    }
    socket.write_u32(data.len() as u32).await?;
    socket.write_all(data).await
}

fn start_agent() -> Result<(), NimiHostError> {
    let (executable, _) = macos_peer_trust::supervisor_paths()?;
    let executable = CString::new(executable.as_os_str().as_bytes()).map_err(|_| refused())?;
    let env = crate::macos_supervised_process::sanitized_environment()?;
    let mut envp: Vec<_> = env.iter().map(|value| value.as_ptr().cast_mut()).collect();
    envp.push(std::ptr::null_mut());
    unsafe extern "C" {
        fn nimi_macos_spawn_app_supervisor(
            path: *const libc::c_char,
            env: *const *mut libc::c_char,
            pid: *mut u32,
        ) -> i32;
    }
    let mut pid = 0;
    // SAFETY: path and every terminated environment string live through spawn.
    if unsafe { nimi_macos_spawn_app_supervisor(executable.as_ptr(), envp.as_ptr(), &mut pid) } != 0
    {
        return Err(unavailable());
    }
    std::thread::spawn(move || {
        // Reap only our own exact child if Home outlives it.
        while unsafe { libc::waitpid(pid as libc::pid_t, std::ptr::null_mut(), 0) } < 0
            && io::Error::last_os_error().kind() == io::ErrorKind::Interrupted
        {}
    });
    Ok(())
}

async fn connect(path: &Path, launch: bool) -> Result<Option<UnixStream>, NimiHostError> {
    let until = tokio::time::Instant::now() + Duration::from_secs(8);
    let mut started = false;
    loop {
        match UnixStream::connect(path).await {
            Ok(mut sock) => {
                // Wait until accept has established the peer audit token before checking identity.
                if sock.read_u8().await.map_err(|_| unavailable())? != 1 {
                    return Err(refused());
                }
                macos_peer_trust::verify_supervisor_peer(sock.as_raw_fd(), true)?;
                return Ok(Some(sock));
            }
            Err(e)
                if matches!(
                    e.kind(),
                    io::ErrorKind::NotFound | io::ErrorKind::ConnectionRefused
                ) =>
            {
                if !launch {
                    return Ok(None);
                }
                if !started {
                    start_agent()?;
                    started = true
                }
                if tokio::time::Instant::now() >= until {
                    return Err(unavailable());
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            Err(_) => return Err(unavailable()),
        }
    }
}
pub async fn manage_installed_apps(op: Op) -> Value {
    match tokio::time::timeout(Duration::from_secs(100), call(op)).await {
        Ok(Ok(value)) => value,
        Ok(Err(e)) => wire_error(e),
        Err(_) => wire_error(unavailable()),
    }
}
async fn call(op: Op) -> Result<Value, NimiHostError> {
    let path = directory().map_err(|_| refused())?.join("control.sock");
    let Some(mut socket) = connect(&path, matches!(op, Op::Launch { .. })).await? else {
        return match op {
            Op::Drain => Ok(json!({"status":"ok","value":{"drained":true}})),
            Op::List => Ok(json!({"status":"ok","value":{"runs":[]}})),
            _ => Err(unavailable()),
        };
    };
    write_frame(
        &mut socket,
        &serde_json::to_vec(&op).map_err(|_| refused())?,
    )
    .await
    .map_err(|_| unavailable())?;
    serde_json::from_slice(&frame(&mut socket).await.map_err(|_| unavailable())?)
        .map_err(|_| refused())
}

async fn launch(channel: Channel, runs: &Runs, selector: String) -> Result<Value, NimiHostError> {
    if selector.is_empty() || selector.len() > 160 {
        return Err(refused());
    }
    let (cancel, canceled) = oneshot::channel();
    {
        let mut registry = runs.lock().map_err(|_| refused())?;
        if registry.closing {
            return Err(refused());
        }
        if let Some(run) = registry
            .active
            .values()
            .find(|r| r.launch_selector == selector)
        {
            if run.reaping {
                return Err(refused());
            }
            return Ok(json!(run));
        }
        if registry.pending.contains_key(&selector) {
            return Err(refused());
        }
        registry.pending.insert(selector.clone(), Some(cancel));
    }
    let result = tokio::select! {biased; _=canceled=>Err(refused()), r=native::launch(channel,selector.as_bytes().to_vec())=>r};
    let mut registry = runs.lock().map_err(|_| refused())?;
    registry.pending.remove(&selector);
    let result = result?;
    let run = Run {
        launch_id: encode(&result.launch_id),
        launch_selector: selector,
        process_id: result.process_id,
        app_id: result.app_id,
        version: result.version,
        stopping: false,
        reaping: false,
    };
    registry.finished.remove(&run.launch_selector);
    registry.active.insert(run.launch_id.clone(), run.clone());
    Ok(json!(run))
}

async fn dispatch(op: Op, channel: Channel, runs: &Runs) -> Result<Value, NimiHostError> {
    match op {
        Op::List => {
            let r = runs.lock().map_err(|_| refused())?;
            Ok(json!({"runs":r.active.values().collect::<Vec<_>>()}))
        }
        Op::Launch { launch_selector } => launch(channel, runs, launch_selector).await,
        Op::Cancel { launch_selector } => {
            if let Some(tx) = runs
                .lock()
                .map_err(|_| refused())?
                .pending
                .get_mut(&launch_selector)
                .and_then(Option::take)
            {
                let _ = tx.send(());
            }
            Ok(json!({"canceled":true}))
        }
        Op::Status { launch_id } => {
            let id = decode(&launch_id)?;
            let terminal = runs
                .lock()
                .map_err(|_| refused())?
                .finished
                .values()
                .find(|(old, _)| old == &launch_id)
                .map(|(_, code)| *code);
            let (running, exit) = match terminal {
                Some(code) => (false, code),
                None => native::installed_app_process_status(id)?,
            };
            Ok(json!({"running":running,"exitCode":exit}))
        }
        Op::Drain => {
            {
                let mut state = runs.lock().map_err(|_| refused())?;
                state.closing = true;
                for cancel in state.pending.values_mut() {
                    if let Some(cancel) = cancel.take() {
                        let _ = cancel.send(());
                    }
                }
                for run in state.active.values_mut() {
                    run.stopping = true;
                }
            }
            let outcome = drain(channel, runs).await;
            if outcome.is_err() {
                runs.lock().map_err(|_| refused())?.closing = false;
            }
            outcome
        }
        Op::Focus { launch_id } => {
            native::focus_installed_app_process(decode(&launch_id)?)?;
            Ok(json!({"focused":true}))
        }
        Op::Stop { launch_id } => {
            if let Some(run) = runs
                .lock()
                .map_err(|_| refused())?
                .active
                .get_mut(&launch_id)
            {
                run.stopping = true;
            }
            native::stop_installed_app_process(decode(&launch_id)?)?;
            Ok(json!({"stopped":true}))
        }
        Op::End { launch_id } => {
            native::end(channel, decode(&launch_id)?).await?;
            runs.lock()
                .map_err(|_| refused())?
                .active
                .remove(&launch_id);
            Ok(json!({"ended":true}))
        }
        Op::Access { launch_id } => {
            let a = native::access(channel, decode(&launch_id)?).await?;
            Ok(
                json!({"available":a.available,"reasonCode":a.reason_code,"executionScopeRef":a.execution_scope_ref}),
            )
        }
    }
}
async fn drain(channel: Channel, runs: &Runs) -> Result<Value, NimiHostError> {
    let until = tokio::time::Instant::now() + Duration::from_secs(30);
    while !runs.lock().map_err(|_| refused())?.pending.is_empty() {
        if tokio::time::Instant::now() >= until {
            return Err(unavailable());
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let ids: Vec<_> = runs
        .lock()
        .map_err(|_| refused())?
        .active
        .keys()
        .cloned()
        .collect();
    for key in ids {
        let id = decode(&key)?;
        native::stop_installed_app_process(id)?;
        native::end(channel.clone(), id).await?;
        runs.lock().map_err(|_| refused())?.active.remove(&key);
    }
    Ok(json!({"drained":true}))
}

// Reap owned process groups even while Home is absent. Exit 75 is the App
// shell's explicit request for a fresh instance of the same exact release.
async fn reap(channel: Channel, runs: &Runs) -> Result<(), NimiHostError> {
    let finished = {
        let mut state = runs.lock().map_err(|_| refused())?;
        let mut finished = Vec::new();
        for run in state.active.values_mut() {
            if run.reaping {
                continue;
            }
            let id = decode(&run.launch_id)?;
            let (live, code) = native::installed_app_process_status(id)?;
            if !live {
                run.reaping = true;
                finished.push((run.clone(), id, code))
            }
        }
        finished
    };
    for (old, id, code) in finished {
        let released = match native::stop_installed_app_process(id) {
            Ok(()) => native::end(channel.clone(), id).await,
            Err(err) => Err(err),
        };
        let restart = {
            let mut state = runs.lock().map_err(|_| refused())?;
            if released.is_err() {
                if let Some(run) = state.active.get_mut(&old.launch_id) {
                    run.reaping = false;
                }
                continue;
            }
            let Some(run) = state.active.remove(&old.launch_id) else {
                continue;
            };
            state
                .finished
                .insert(run.launch_selector.clone(), (run.launch_id, code));
            !state.closing && !run.stopping && code == Some(75)
        };
        if restart {
            let _ = launch(channel.clone(), runs, old.launch_selector).await;
        }
    }
    Ok(())
}

async fn read_management_request(socket: &mut UnixStream) -> io::Result<Op> {
    socket.write_u8(1).await?;
    let data = tokio::time::timeout(Duration::from_secs(10), frame(socket))
        .await
        .map_err(|_| io::ErrorKind::TimedOut)??;
    Ok(serde_json::from_slice(&data)?)
}

async fn serve(
    mut socket: UnixStream,
    channel: Channel,
    runs: Runs,
    retire: Arc<tokio::sync::Notify>,
) -> io::Result<()> {
    let op = read_management_request(&mut socket).await?;
    let draining = matches!(op, Op::Drain);
    let result = dispatch(op, channel, &runs).await;
    let exiting = draining && result.is_ok();
    let reply = match result {
        Ok(value) => json!({"status":"ok","value":value}),
        Err(e) => wire_error(e),
    };
    let sent = write_frame(&mut socket, &serde_json::to_vec(&reply)?).await;
    if exiting {
        retire.notify_one();
    }
    sent
}
fn disconnected(fd: OwnedFd) {
    unsafe extern "C" {
        fn nimi_macos_wait_control_disconnect(fd: i32);
    }
    // SAFETY: the duplicate descriptor lives through kevent. The watcher
    // never consumes HTTP/2 bytes from the shared file description.
    unsafe { nimi_macos_wait_control_disconnect(fd.as_raw_fd()) };
}
pub async fn run_macos_app_supervisor() -> Result<(), Box<dyn std::error::Error>> {
    let dir = directory()?;
    let guard = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(dir.join("owner.lock"))?;
    // SAFETY: the descriptor stays open while the agent owns the socket.
    if unsafe { libc::flock(guard.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
        let e = io::Error::last_os_error();
        if e.raw_os_error() == Some(libc::EWOULDBLOCK) {
            return Ok(());
        }
        return Err(e.into());
    }
    let path = dir.join("control.sock");
    match fs::remove_file(&path) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }
    let listener = UnixListener::bind(&path)?;
    // Starting the image directly cannot activate Runtime. Only the exact
    // authenticated Home in this login session can start a management request.
    let mut first = tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            let (socket, _) = listener.accept().await?;
            if macos_peer_trust::verify_supervisor_peer(socket.as_raw_fd(), false).is_ok() {
                return Ok::<_, io::Error>(socket);
            }
        }
    })
    .await??;
    let (channel, lifetime) = match crate::macos_service_control::open_supervisor_runtime_channel().await {
        Ok(connected) => connected,
        Err(error) => {
            // Return the carrier's typed failure to the authenticated caller.
            read_management_request(&mut first).await?;
            let error = NimiHostError::from(error);
            write_frame(&mut first, &serde_json::to_vec(&wire_error(error.clone()))?).await?;
            return Err(error.into());
        }
    };
    let runs = Arc::new(Mutex::new(Registry::default()));
    let (lost_tx, mut lost) = oneshot::channel();
    std::thread::spawn(move || {
        disconnected(lifetime);
        let _ = lost_tx.send(());
    });
    let retire = Arc::new(tokio::sync::Notify::new());
    tokio::spawn(serve(
        first,
        channel.clone(),
        Arc::clone(&runs),
        Arc::clone(&retire),
    ));
    let mut timer = tokio::time::interval(Duration::from_secs(1));
    timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            _=&mut lost=>break,
            _=retire.notified()=>break,
            _=timer.tick()=>{reap(channel.clone(),&runs).await?;},
            accepted=listener.accept()=>{let (socket,_)=accepted?;
                if macos_peer_trust::verify_supervisor_peer(socket.as_raw_fd(),false).is_ok(){
                    tokio::spawn(serve(socket,channel.clone(),Arc::clone(&runs),Arc::clone(&retire)));
                }}
        }
    }
    // Parent loss also trips the App shell watchdog. Terminate native process groups before exiting normally.
    for run in runs.lock().map_err(|_| refused())?.active.values() {
        let _ = native::stop_installed_app_process(decode(&run.launch_id)?);
    }
    drop(listener);
    fs::remove_file(path)?;
    Ok(())
}
