//! Battery vs mains, straight from IOKit — the one activity input the webview
//! can't see for itself (visibility and focus come from the DOM in
//! src/lib/activity.ts). `on_battery()` reads a snapshot; `install()` adds an
//! IOKit run-loop source so a plug/unplug emits `power-source-changed`.
//! `UiVisible` is the webview's word on whether anyone can see it — the
//! session waiter (main.rs `watch_run`) skips log-growth events while false.

use core_foundation::base::TCFType;
use core_foundation::string::CFString;
use core_foundation_sys::base::{CFRelease, CFTypeRef};
use core_foundation_sys::runloop::{kCFRunLoopDefaultMode, CFRunLoopAddSource, CFRunLoopGetMain, CFRunLoopSourceRef};
use core_foundation_sys::string::CFStringRef;
use serde_json::{json, Value};
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Emitter;

#[link(name = "IOKit", kind = "framework")]
extern "C" {
    fn IOPSCopyPowerSourcesInfo() -> CFTypeRef;
    fn IOPSGetProvidingPowerSourceType(snapshot: CFTypeRef) -> CFStringRef;
    fn IOPSNotificationCreateRunLoopSource(callback: extern "C" fn(*mut c_void), context: *mut c_void) -> CFRunLoopSourceRef;
}

/// Managed state: is the webview visible (occlusion-aware, set from the DOM)?
pub struct UiVisible(pub AtomicBool);

pub fn battery_from_type(t: &str) -> bool {
    t == "Battery Power" || t == "UPS Power"
}

/// One IOKit snapshot. A failed read is "mains" — the spec's degrade-to-nothing.
pub fn on_battery() -> bool {
    unsafe {
        let snap = IOPSCopyPowerSourcesInfo();
        if snap.is_null() {
            eprintln!("[power] IOPSCopyPowerSourcesInfo returned null — assuming mains");
            return false;
        }
        let ty = IOPSGetProvidingPowerSourceType(snap);
        let s = if ty.is_null() { String::new() } else { CFString::wrap_under_get_rule(ty).to_string() };
        CFRelease(snap);
        battery_from_type(&s)
    }
}

extern "C" fn on_change(ctx: *mut c_void) {
    // ctx is a leaked Box<AppHandle> owned for the process lifetime (install below)
    let app = unsafe { &*(ctx as *const tauri::AppHandle) };
    let _ = app.emit("power-source-changed", json!({ "on_battery": on_battery() }));
}

/// Main thread only (the main run loop): register the plug/unplug callback.
pub fn install(app: tauri::AppHandle) {
    let ctx = Box::into_raw(Box::new(app)) as *mut c_void;
    unsafe {
        // the source is +1 retained and deliberately never released — it lives for the process, like the AppHandle box above
        let src = IOPSNotificationCreateRunLoopSource(on_change, ctx);
        if src.is_null() {
            eprintln!("[power] no IOKit notification source — battery state is read on demand only");
            return;
        }
        CFRunLoopAddSource(CFRunLoopGetMain(), src, kCFRunLoopDefaultMode);
    }
}

#[tauri::command]
pub fn get_power_source() -> Value {
    json!({ "on_battery": on_battery() })
}

#[tauri::command]
pub fn set_ui_visible(vis: tauri::State<UiVisible>, visible: bool) {
    vis.0.store(visible, Ordering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn battery_types_map_to_on_battery() {
        assert!(battery_from_type("Battery Power"));
        assert!(battery_from_type("UPS Power"));
        assert!(!battery_from_type("AC Power"));
        assert!(!battery_from_type(""));
    }
    #[test]
    fn snapshot_read_does_not_panic() {
        let _ = on_battery(); // true or false, but never a crash
    }
}
