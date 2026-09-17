//! The designs folder is watched on its own: bursts of writes from a design turn
//! collapse to one `designs-changed` per design, and never touch the project-wide
//! rescan or the notes index.
use std::collections::{BTreeSet, HashMap};
use std::path::Path;
use std::sync::Mutex;

static PENDING: Mutex<Option<HashMap<(String, String), BTreeSet<String>>>> = Mutex::new(None);

pub fn design_event(path: &Path) -> Option<(String, String)> {
    let s = path.to_string_lossy();
    let (_, rest) = s.split_once("/.chronicle/designs/")?;
    let (slug, rel) = rest.split_once('/')?;
    if !super::valid_slug(slug) || rel.is_empty() || rel.starts_with(".versions/") { return None; }
    Some((slug.to_string(), rel.to_string()))
}

pub fn queue(dir: &str, slug: &str, rel: String) -> bool {
    let mut g = PENDING.lock().unwrap();
    let map = g.get_or_insert_with(HashMap::new);
    let key = (dir.to_string(), slug.to_string());
    let first = !map.contains_key(&key);
    map.entry(key).or_default().insert(rel);
    first
}

pub fn drain(dir: &str, slug: &str) -> Vec<String> {
    let mut g = PENDING.lock().unwrap();
    g.as_mut().and_then(|m| m.remove(&(dir.to_string(), slug.to_string()))).map(|s| s.into_iter().collect()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    #[test]
    fn design_events_name_their_design() {
        assert_eq!(design_event(Path::new("/p/.chronicle/designs/home/frames/a.html")), Some(("home".into(), "frames/a.html".into())));
        assert_eq!(design_event(Path::new("/p/.chronicle/designs/home/design.json")), Some(("home".into(), "design.json".into())));
        assert_eq!(design_event(Path::new("/p/.chronicle/designs/home/.versions/v1/meta.json")), None);
        assert_eq!(design_event(Path::new("/p/.chronicle/designs/.threads/s/thread.jsonl")), None);
        assert_eq!(design_event(Path::new("/p/.chronicle/designs/order.json")), None);
        assert_eq!(design_event(Path::new("/p/src/a.ts")), None);
    }
    #[test]
    fn bursts_collect_until_drained() {
        assert!(queue("/d", "s", "a".into()));
        assert!(!queue("/d", "s", "b".into()));
        assert!(!queue("/d", "s", "a".into()));
        let mut got = drain("/d", "s"); got.sort();
        assert_eq!(got, vec!["a".to_string(), "b".to_string()]);
        assert!(queue("/d", "s", "c".into()), "a new burst starts after a drain");
        drain("/d", "s");
    }
}
