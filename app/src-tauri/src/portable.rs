//! The portable build: `portable.txt` next to `HErPlan.exe` keeps everything the program writes for itself
//! (settings, bug reports, the window's own data) in a `data` folder beside it, and new projects go to a
//! `Projects` folder there by default. Without the file the program keeps them in the user's folders.

use std::path::PathBuf;
use std::sync::OnceLock;

/// The file that switches the portable mode on; it also tells the user what the mode is.
pub const MARKER: &str = "portable.txt";

/// The folder of the program when it runs portable.
pub fn root() -> Option<&'static PathBuf> {
    static ROOT: OnceLock<Option<PathBuf>> = OnceLock::new();
    ROOT.get_or_init(|| {
        let exe = std::env::current_exe().ok()?;
        let dir = exe.parent()?.to_path_buf();
        dir.join(MARKER).is_file().then_some(dir)
    })
    .as_ref()
}

/// `data` beside the program: settings, reports, the window's data.
pub fn data_dir() -> Option<PathBuf> {
    root().map(|r| r.join("data"))
}

/// `Projects` beside the program: where new projects go unless the settings say otherwise.
pub fn projects_dir() -> Option<PathBuf> {
    root().map(|r| r.join("Projects"))
}
