//! Ankhwiz core: the learning rules shared by every build of the app.
//!
//! Stages, grading, sessions, lesson splitting, scheduling and the AI
//! request and reply handling all live here, behind one JSON entry point
//! (`api::call`). The same code is compiled to WebAssembly for the shared
//! interface and can be linked natively by a desktop or Android shell.

pub mod ai;
pub mod anki;
pub mod api;
pub mod cards;
pub mod edit;
pub mod distract;
pub mod model;
pub mod occlusion;
pub mod rng;
pub mod sample;
pub mod schedule;
pub mod session;
pub mod split;
pub mod stages;
pub mod testout;
pub mod text;

// ---------- C interface, used by the WebAssembly build ----------
// Text passes as UTF-8 in memory owned by this module. The caller asks for
// a buffer, writes the call into it, and frees both buffers afterwards.

#[no_mangle]
pub extern "C" fn ankh_alloc(len: usize) -> *mut u8 {
    let mut buf = Vec::<u8>::with_capacity(len.max(1));
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

/// # Safety
/// `ptr` and `len` must come from `ankh_alloc` or `ankh_call`.
#[no_mangle]
pub unsafe extern "C" fn ankh_free(ptr: *mut u8, len: usize) {
    if !ptr.is_null() {
        drop(Vec::from_raw_parts(ptr, 0, len.max(1)));
    }
}

static mut LAST_LEN: usize = 0;

/// Run one call. Returns a pointer to the reply; its length is read with
/// `ankh_reply_len`.
///
/// # Safety
/// `ptr` must point to `len` bytes of UTF-8 written by the caller.
#[no_mangle]
pub unsafe extern "C" fn ankh_call(ptr: *const u8, len: usize) -> *mut u8 {
    let input = std::slice::from_raw_parts(ptr, len);
    let reply = match std::str::from_utf8(input) {
        Ok(text) => api::call(text),
        Err(_) => r#"{"err":"call was not valid text"}"#.to_string(),
    };
    let mut bytes = reply.into_bytes();
    bytes.shrink_to_fit();
    LAST_LEN = bytes.len();
    // Keep capacity equal to length so `ankh_free` can rebuild the buffer.
    let mut boxed = bytes.into_boxed_slice();
    let out = boxed.as_mut_ptr();
    std::mem::forget(boxed);
    out
}

#[no_mangle]
pub extern "C" fn ankh_reply_len() -> usize {
    unsafe { LAST_LEN }
}
