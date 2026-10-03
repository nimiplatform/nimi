use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tokio::sync::watch;

fn pending() -> &'static Mutex<HashMap<String, watch::Sender<bool>>> {
    static PENDING: OnceLock<Mutex<HashMap<String, watch::Sender<bool>>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(super) struct Pending {
    selector: String,
    receiver: watch::Receiver<bool>,
}

pub(super) fn begin(selector: &str) -> Option<Pending> {
    if selector.is_empty() || selector.len() > 160 {
        return None;
    }
    let mut entries = pending().lock().ok()?;
    if entries.contains_key(selector) {
        return None;
    }
    let (sender, receiver) = watch::channel(false);
    entries.insert(selector.to_owned(), sender);
    Some(Pending {
        selector: selector.to_owned(),
        receiver,
    })
}

pub(super) fn cancel(selector: &str) {
    if let Ok(entries) = pending().lock() {
        if let Some(sender) = entries.get(selector) {
            let _ = sender.send(true);
        }
    }
}

impl Pending {
    pub(super) async fn canceled(&mut self) {
        let _ = self.receiver.wait_for(|canceled| *canceled).await;
    }
}

impl Drop for Pending {
    fn drop(&mut self) {
        if let Ok(mut entries) = pending().lock() {
            entries.remove(&self.selector);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn cancel_before_first_poll_and_release_for_next_attempt() {
        let mut launch = begin("cancel-test").unwrap();
        assert!(begin("cancel-test").is_none());
        cancel("cancel-test");
        tokio::time::timeout(std::time::Duration::from_millis(100), launch.canceled())
            .await
            .unwrap();
        drop(launch);
        let next = begin("cancel-test").unwrap();
        assert!(!*next.receiver.borrow());
    }
}
