use std::sync::{Mutex, OnceLock};
use std::time::Duration;

#[cfg(test)]
use std::sync::atomic::{AtomicUsize, Ordering};

use tonic::transport::{Channel, Endpoint};

use super::error_map::bridge_error;

#[derive(Debug, Clone)]
struct CachedChannel {
    endpoint_uri: String,
    channel: Channel,
}

static CHANNEL_CACHE: OnceLock<Mutex<Option<CachedChannel>>> = OnceLock::new();
#[cfg(test)]
static INVALIDATION_COUNT: AtomicUsize = AtomicUsize::new(0);

fn cache() -> &'static Mutex<Option<CachedChannel>> {
    CHANNEL_CACHE.get_or_init(|| Mutex::new(None))
}

fn to_endpoint_uri(grpc_addr: &str) -> String {
    let value = grpc_addr.trim();
    if value.starts_with("http://") || value.starts_with("https://") {
        return value.to_string();
    }
    format!("http://{}", value)
}

pub fn invalidate_channel() {
    let mut guard = cache()
        .lock()
        .expect("runtime bridge channel cache lock poisoned");
    *guard = None;
    #[cfg(test)]
    INVALIDATION_COUNT.fetch_add(1, Ordering::Relaxed);
}

#[cfg(test)]
pub fn invalidation_count() -> usize {
    INVALIDATION_COUNT.load(Ordering::Relaxed)
}

#[cfg(test)]
pub fn reset_invalidation_count() {
    INVALIDATION_COUNT.store(0, Ordering::Relaxed);
}

pub async fn shared_channel(grpc_addr: &str) -> Result<Channel, String> {
    let endpoint_uri = to_endpoint_uri(grpc_addr);
    {
        let guard = cache()
            .lock()
            .expect("runtime bridge channel cache lock poisoned");
        if let Some(cached) = guard.as_ref() {
            if cached.endpoint_uri == endpoint_uri {
                return Ok(cached.channel.clone());
            }
        }
    }

    let endpoint = Endpoint::from_shared(endpoint_uri.clone())
        .map_err(|error| {
            bridge_error(
                "RUNTIME_BRIDGE_ENDPOINT_INVALID",
                error.to_string().as_str(),
            )
        })?
        .connect_timeout(Duration::from_secs(5))
        .tcp_nodelay(true);
    let channel = endpoint.connect().await.map_err(|error| {
        bridge_error("RUNTIME_BRIDGE_CONNECT_FAILED", error.to_string().as_str())
    })?;

    {
        let mut guard = cache()
            .lock()
            .expect("runtime bridge channel cache lock poisoned");
        *guard = Some(CachedChannel {
            endpoint_uri,
            channel: channel.clone(),
        });
    }

    Ok(channel)
}
