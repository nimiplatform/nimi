use std::sync::{Mutex, OnceLock};
use std::time::Duration;

#[cfg(any(test, feature = "test-observability"))]
use std::sync::atomic::{AtomicUsize, Ordering};

use tonic::transport::{Channel, Endpoint};

use super::error_map::bridge_error;

#[derive(Debug, Clone)]
struct CachedChannel {
    endpoint_uri: String,
    channel: Channel,
}

#[derive(Debug, Default)]
struct ChannelCache {
    unary: Option<CachedChannel>,
    stream: Option<CachedChannel>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ChannelRole {
    Unary,
    Stream,
}

static CHANNEL_CACHE: OnceLock<Mutex<ChannelCache>> = OnceLock::new();
#[cfg(any(test, feature = "test-observability"))]
static INVALIDATION_COUNT: AtomicUsize = AtomicUsize::new(0);
#[cfg(test)]
static INVALIDATION_OBSERVER_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn cache() -> &'static Mutex<ChannelCache> {
    CHANNEL_CACHE.get_or_init(|| Mutex::new(ChannelCache::default()))
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
    *guard = ChannelCache::default();
    #[cfg(any(test, feature = "test-observability"))]
    INVALIDATION_COUNT.fetch_add(1, Ordering::Relaxed);
}

#[cfg(any(test, feature = "test-observability"))]
pub fn invalidation_count() -> usize {
    INVALIDATION_COUNT.load(Ordering::Relaxed)
}

#[cfg(any(test, feature = "test-observability"))]
pub fn reset_invalidation_count() {
    INVALIDATION_COUNT.store(0, Ordering::Relaxed);
}

#[cfg(test)]
pub(super) fn invalidation_observer_lock() -> std::sync::MutexGuard<'static, ()> {
    INVALIDATION_OBSERVER_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("runtime bridge invalidation observer lock poisoned")
}

fn cached_channel_for_role(cache: &ChannelCache, role: ChannelRole) -> Option<&CachedChannel> {
    match role {
        ChannelRole::Unary => cache.unary.as_ref(),
        ChannelRole::Stream => cache.stream.as_ref(),
    }
}

fn store_channel_for_role(cache: &mut ChannelCache, role: ChannelRole, channel: CachedChannel) {
    match role {
        ChannelRole::Unary => cache.unary = Some(channel),
        ChannelRole::Stream => cache.stream = Some(channel),
    }
}

async fn shared_channel_for_role(grpc_addr: &str, role: ChannelRole) -> Result<Channel, String> {
    let endpoint_uri = to_endpoint_uri(grpc_addr);
    {
        let guard = cache()
            .lock()
            .expect("runtime bridge channel cache lock poisoned");
        if let Some(cached) = cached_channel_for_role(&guard, role) {
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
        store_channel_for_role(
            &mut guard,
            role,
            CachedChannel {
                endpoint_uri,
                channel: channel.clone(),
            },
        );
    }

    Ok(channel)
}

pub async fn shared_unary_channel(grpc_addr: &str) -> Result<Channel, String> {
    shared_channel_for_role(grpc_addr, ChannelRole::Unary).await
}

pub async fn shared_stream_channel(grpc_addr: &str) -> Result<Channel, String> {
    shared_channel_for_role(grpc_addr, ChannelRole::Stream).await
}

#[cfg(test)]
mod tests {
    use super::{
        cache, invalidate_channel, invalidation_observer_lock, CachedChannel, ChannelCache,
    };
    use tonic::transport::Endpoint;

    fn lazy_channel() -> tonic::transport::Channel {
        Endpoint::from_static("http://127.0.0.1:1").connect_lazy()
    }

    #[tokio::test]
    async fn invalidate_channel_clears_unary_and_stream_caches() {
        let _observer = invalidation_observer_lock();
        {
            let mut guard = cache()
                .lock()
                .expect("runtime bridge channel cache lock poisoned");
            *guard = ChannelCache {
                unary: Some(CachedChannel {
                    endpoint_uri: "http://127.0.0.1:1".to_string(),
                    channel: lazy_channel(),
                }),
                stream: Some(CachedChannel {
                    endpoint_uri: "http://127.0.0.1:2".to_string(),
                    channel: lazy_channel(),
                }),
            };
        }

        invalidate_channel();

        let guard = cache()
            .lock()
            .expect("runtime bridge channel cache lock poisoned");
        assert!(guard.unary.is_none());
        assert!(guard.stream.is_none());
    }
}
