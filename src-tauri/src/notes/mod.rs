//! The notes vault: the parser, the index, the commands, the migration and the
//! rounds store that used to live inside kanban.json.
//!
//! `parse` lands ahead of its consumers (the index and commands come in later
//! tasks), so nothing here is called yet — allow dead_code until they are.
#![allow(dead_code)]
pub mod parse;
