//! Provider keys in the macOS Keychain (spec §9): service
//! `chronicle.provider.<id>`, account = the user. Written through
//! `security -i` on stdin so a key is never on a command line; read with
//! `find-generic-password -w`. Never in a repo file, never in config.json.
use std::io::Write;
use std::process::{Command, Stdio};

pub trait Secrets: Send + Sync {
    fn get(&self, id: &str) -> Option<String>;
    /// Is a key saved? (No secret read — the Setup row only needs yes or no.)
    fn has(&self, id: &str) -> bool { self.get(id).is_some() }
    fn set(&self, id: &str, secret: &str) -> Result<(), String>;
    fn remove(&self, id: &str) -> Result<(), String>;
}

pub fn service(id: &str) -> String { format!("chronicle.provider.{id}") }

/// The Keychain account, read once: every call in a run must use the same name,
/// or a key saved under one account could not be found, replaced or removed under another.
fn account() -> &'static str {
    static ACCOUNT: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    ACCOUNT.get_or_init(|| std::env::var("USER").unwrap_or_else(|_| "chronicle".into()))
}

fn quote(s: &str) -> String { format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\"")) }

/// Text from `security` that may quote our command line, with the secret taken out (raw and escaped forms).
pub fn scrub(text: &str, secret: &str) -> String {
    let secret = secret.trim();
    if secret.is_empty() { return text.to_string(); }
    let escaped = quote(secret);
    let escaped = &escaped[1..escaped.len() - 1];
    text.replace(escaped, "…").replace(secret, "…")
}

/// One `security -i` line that saves (or replaces, `-U`) a key.
pub fn add_command(service: &str, account: &str, secret: &str) -> Result<String, String> {
    let secret = secret.trim();
    if secret.is_empty() { return Err("paste a key first".into()); }
    if secret.chars().any(char::is_control) { return Err("a key is a single line of plain characters".into()); }
    let q = quote;
    Ok(format!("add-generic-password -U -s {} -a {} -w {}\n", q(service), q(account), q(secret)))
}

pub struct Keychain;

impl Secrets for Keychain {
    fn get(&self, id: &str) -> Option<String> {
        let out = Command::new("security").args(["find-generic-password", "-s", &service(id), "-a", account(), "-w"])
            .stdin(Stdio::null()).stderr(Stdio::null()).output().ok()?;
        if !out.status.success() { return None; }
        let k = String::from_utf8_lossy(&out.stdout).trim().to_string();
        (!k.is_empty()).then_some(k)
    }
    fn has(&self, id: &str) -> bool {
        Command::new("security").args(["find-generic-password", "-s", &service(id), "-a", account()])
            .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
            .status().map(|s| s.success()).unwrap_or(false)
    }
    fn set(&self, id: &str, secret: &str) -> Result<(), String> {
        let line = add_command(&service(id), account(), secret)?;
        let mut child = Command::new("security").arg("-i")
            .stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::piped())
            .spawn().map_err(|e| format!("couldn't reach your Keychain: {e}"))?;
        child.stdin.take().ok_or("no stdin")?.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
        let out = child.wait_with_output().map_err(|e| e.to_string())?;
        // the exit code decides; stderr is only the reason, and never carries the key
        let err = scrub(String::from_utf8_lossy(&out.stderr).trim(), secret);
        if !out.status.success() { return Err(format!("couldn't save the key in your Keychain: {err}")); }
        if self.get(id).as_deref() != Some(secret.trim()) { return Err("the Keychain didn't keep the key".into()); }
        Ok(())
    }
    fn remove(&self, id: &str) -> Result<(), String> {
        let out = Command::new("security").args(["delete-generic-password", "-s", &service(id), "-a", account()])
            .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped()).output()
            .map_err(|e| format!("couldn't reach your Keychain: {e}"))?;
        // exit 44 is "no such item": the key is gone either way
        match out.status.code() {
            Some(0) | Some(44) => Ok(()),
            _ => Err(format!("couldn't remove the key from your Keychain: {}", String::from_utf8_lossy(&out.stderr).trim())),
        }
    }
}

/// The Keychain's stand-in for tests: nothing touches the real one.
#[cfg(test)]
pub struct FakeSecrets(std::sync::Mutex<std::collections::HashMap<String, String>>);

#[cfg(test)]
impl FakeSecrets {
    pub fn new() -> FakeSecrets { FakeSecrets(std::sync::Mutex::new(std::collections::HashMap::new())) }
}

#[cfg(test)]
impl Secrets for FakeSecrets {
    fn get(&self, id: &str) -> Option<String> { self.0.lock().unwrap().get(id).cloned() }
    fn set(&self, id: &str, secret: &str) -> Result<(), String> {
        add_command("s", "a", secret)?;
        self.0.lock().unwrap().insert(id.into(), secret.trim().into());
        Ok(())
    }
    fn remove(&self, id: &str) -> Result<(), String> { self.0.lock().unwrap().remove(id); Ok(()) }
}

#[cfg(test)]
mod keys_tests {
    use super::*;

    #[test]
    fn the_add_command_quotes_and_refuses_what_it_cannot_store() {
        assert_eq!(add_command("chronicle.provider.anthropic", "tg", "sk-ant-1").unwrap(),
            "add-generic-password -U -s \"chronicle.provider.anthropic\" -a \"tg\" -w \"sk-ant-1\"\n");
        assert!(add_command("s", "a", "we\"ird\\key").unwrap().contains("-w \"we\\\"ird\\\\key\""));
        assert!(add_command("s", "a", "  ").is_err());
        assert!(add_command("s", "a", "two\nlines").is_err());
        assert!(add_command("s", "a", "tab\there").is_err());
    }

    #[test]
    fn the_scrub_removes_the_raw_and_the_escaped_key() {
        let k = "we\"ird\\key";
        let line = add_command("s", "a", k).unwrap();
        let out = scrub(&format!("bad line: {line} / {k}"), k);
        assert!(!out.contains("ird"), "{out}");
        assert_eq!(scrub("nothing here", "sk-1"), "nothing here");
        assert_eq!(scrub("x sk-1 y", " sk-1 "), "x … y");
    }

    #[test]
    fn the_service_name_is_per_provider() {
        assert_eq!(service("openrouter"), "chronicle.provider.openrouter");
    }

    #[test]
    fn the_fake_keeps_and_forgets() {
        let f = FakeSecrets::new();
        assert!(!f.has("anthropic"));
        f.set("anthropic", " sk-1 ").unwrap();
        assert_eq!(f.get("anthropic").as_deref(), Some("sk-1"));
        f.remove("anthropic").unwrap();
        assert!(f.get("anthropic").is_none());
    }
}
