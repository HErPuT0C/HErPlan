//! Project storage for HErPlan (ADR-004).
//!
//! Every project file is replaced atomically: the new content goes to a temporary file next to the
//! target, is flushed to disk, and then renamed over the target. A crash at any point leaves either
//! the old or the new file, never a truncated one. The first line holds a SHA-256 of the payload so
//! a reader can detect damage and offer a backup instead.

mod atomic;

pub use atomic::{read_verified, remove_stale_temp_files, write_atomic, ReadOutcome};
