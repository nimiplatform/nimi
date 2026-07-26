#[cfg(test)]
use std::cell::RefCell;
#[cfg(test)]
use std::collections::HashMap;
#[cfg(test)]
use std::sync::{Mutex, MutexGuard, OnceLock};
#[cfg(test)]
use std::thread_local;

#[cfg(test)]
fn shared_test_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

#[cfg(test)]
thread_local! {
    static TEST_GUARD_DEPTH: RefCell<usize> = const { RefCell::new(0) };
    static TEST_GUARD_HELD: RefCell<Option<MutexGuard<'static, ()>>> = const { RefCell::new(None) };
}

#[cfg(test)]
pub(crate) struct TestGuard;

#[cfg(test)]
fn acquire_test_guard() {
    TEST_GUARD_DEPTH.with(|depth| {
        let mut depth = depth.borrow_mut();
        if *depth == 0 {
            let guard = match shared_test_lock().lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            TEST_GUARD_HELD.with(|held| {
                *held.borrow_mut() = Some(guard);
            });
        }
        *depth += 1;
    });
}

#[cfg(test)]
fn release_test_guard() {
    TEST_GUARD_DEPTH.with(|depth| {
        let mut depth = depth.borrow_mut();
        if *depth == 0 {
            return;
        }
        *depth -= 1;
        if *depth == 0 {
            TEST_GUARD_HELD.with(|held| {
                held.borrow_mut().take();
            });
        }
    });
}

#[cfg(test)]
pub(crate) fn test_guard() -> TestGuard {
    acquire_test_guard();
    TestGuard
}

#[cfg(test)]
impl Drop for TestGuard {
    fn drop(&mut self) {
        release_test_guard();
    }
}

#[cfg(test)]
pub(crate) fn with_env<R>(updates: &[(&str, Option<&str>)], run: impl FnOnce() -> R) -> R {
    let _guard = test_guard();
    let mut previous = HashMap::<String, Option<String>>::new();
    for (key, value) in updates {
        previous.insert((*key).to_string(), std::env::var(key).ok());
        match value {
            Some(next) => std::env::set_var(key, next),
            None => std::env::remove_var(key),
        }
    }
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(run));
    for (key, value) in previous {
        match value {
            Some(prev) => std::env::set_var(key, prev),
            None => std::env::remove_var(key),
        }
    }
    match result {
        Ok(value) => value,
        Err(payload) => std::panic::resume_unwind(payload),
    }
}
