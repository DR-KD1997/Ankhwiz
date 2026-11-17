//! A small random source. The interface seeds it at start-up, because the
//! WebAssembly build has no clock or system randomness of its own.

use std::cell::Cell;
use std::sync::atomic::{AtomicU64, Ordering};

// One state per thread. The app runs the core on a single thread, so this is
// the same as one global state there; tests running side by side no longer
// disturb each other's sequences.
thread_local! {
    static STATE: Cell<u64> = const { Cell::new(0x9E37_79B9_7F4A_7C15) };
}
static COUNTER: AtomicU64 = AtomicU64::new(0);

pub fn seed(value: u64) {
    STATE.with(|s| s.set(value | 1));
}

pub fn next_u64() -> u64 {
    // xorshift64*
    STATE.with(|s| {
        let mut x = s.get();
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        s.set(x);
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    })
}

/// A whole number from 0 up to, not including, `n`.
pub fn below(n: usize) -> usize {
    if n == 0 {
        0
    } else {
        ((next_u64() >> 11) % n as u64) as usize
    }
}

pub fn shuffle<T>(items: &mut [T]) {
    for i in (1..items.len()).rev() {
        items.swap(i, below(i + 1));
    }
}

fn base36(mut n: u64, width: usize) -> String {
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut out = Vec::new();
    while n > 0 {
        out.push(DIGITS[(n % 36) as usize]);
        n /= 36;
    }
    while out.len() < width {
        out.push(b'0');
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_default()
}

/// A new identifier such as `n0003k9x2ab`.
pub fn uid(prefix: &str) -> String {
    let count = COUNTER.fetch_add(1, Ordering::Relaxed) + 1;
    format!("{prefix}{}{}", base36(count, 4), base36(next_u64() % 36u64.pow(8), 8))
}
