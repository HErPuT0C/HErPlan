//! Project storage for HErPlan (ADR-004).
//!
//! Every project file is replaced atomically: the new content goes to a temporary file next to the
//! target, is flushed to disk, and then renamed over the target. A crash at any point leaves either
//! the old or the new file, never a truncated one.
//!
//! Files stay plain JSON and plain Markdown, so other tools (git, Obsidian, a text editor) can read
//! and edit them. Damage is detected by the reader (a JSON file that does not parse, an empty file),
//! not by checksums: a changed checksum would also flag legitimate edits made outside HErPlan.

mod atomic;

pub use atomic::{read_file, remove_stale_temp_files, write_atomic, ReadOutcome};
