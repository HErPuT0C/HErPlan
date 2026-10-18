//! Recursive folder listing shared by project reading, backups and archives.

use std::fs;
use std::path::{Path, PathBuf};

use crate::atomic::is_temp_name;
use crate::error::{AtPath, Result};

/// A file, or a folder with nothing inside, found under a project.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Found {
    /// Project-relative path with forward slashes.
    pub rel: String,
    pub abs: PathBuf,
    pub is_dir: bool,
}

/// Lists files under `dir` (whose project-relative path is `rel`), skipping temporary files.
/// With `empty_dirs`, folders without files are listed too, so archives keep the user's empty
/// folders. Symlinked folders are not followed, which rules out cycles.
pub(crate) fn walk(dir: &Path, rel: &str, empty_dirs: bool, out: &mut Vec<Found>) -> Result<()> {
    let mut has_content = false;
    for entry in fs::read_dir(dir).at(dir)? {
        let entry = entry.at(dir)?;
        let abs = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let child_rel = format!("{rel}/{name}");
        let file_type = entry.file_type().at(&abs)?;
        if file_type.is_dir() {
            has_content = true;
            walk(&abs, &child_rel, empty_dirs, out)?;
        } else if is_file(&abs, file_type.is_symlink(), file_type.is_file()) && !is_temp_name(&name)
        {
            has_content = true;
            out.push(Found {
                rel: child_rel,
                abs,
                is_dir: false,
            });
        }
    }
    if empty_dirs && !has_content {
        out.push(Found {
            rel: rel.to_owned(),
            abs: dir.to_path_buf(),
            is_dir: true,
        });
    }
    Ok(())
}

fn is_file(abs: &Path, is_symlink: bool, is_file: bool) -> bool {
    // A symlink to a file counts as that file; a broken one is skipped.
    is_file || (is_symlink && fs::metadata(abs).is_ok_and(|m| m.is_file()))
}

/// Everything a backup or an export contains: the whole project except `backups/`, `.herplan/`
/// and temporary files, sorted by path so archives are reproducible.
pub(crate) fn project_content(dir: &Path) -> Result<Vec<Found>> {
    let mut out = Vec::new();
    for entry in fs::read_dir(dir).at(dir)? {
        let entry = entry.at(dir)?;
        let abs = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if matches!(name.as_str(), "backups" | ".herplan") || is_temp_name(&name) {
            continue;
        }
        let file_type = entry.file_type().at(&abs)?;
        if file_type.is_dir() {
            walk(&abs, &name, true, &mut out)?;
        } else if is_file(&abs, file_type.is_symlink(), file_type.is_file()) {
            out.push(Found {
                rel: name,
                abs,
                is_dir: false,
            });
        }
    }
    out.sort_by(|a, b| a.rel.cmp(&b.rel));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_content_without_backups_cache_and_temp_files() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        for sub in [
            "data/entities",
            "documents/empty",
            "backups/auto",
            ".herplan",
        ] {
            fs::create_dir_all(root.join(sub)).unwrap();
        }
        fs::write(root.join("project.json"), "{}").unwrap();
        fs::write(root.join("data/entities/a.json"), "{}").unwrap();
        fs::write(root.join("data/entities/.a.json.tmp-1"), "x").unwrap();
        fs::write(root.join("backups/auto/x.zip"), "x").unwrap();
        fs::write(root.join(".herplan/cache.json"), "x").unwrap();
        fs::write(root.join(".project.json.tmp-9"), "x").unwrap();

        let found: Vec<(String, bool)> = project_content(root)
            .unwrap()
            .into_iter()
            .map(|f| (f.rel, f.is_dir))
            .collect();
        assert_eq!(
            found,
            vec![
                ("data/entities/a.json".to_owned(), false),
                ("documents/empty".to_owned(), true),
                ("project.json".to_owned(), false),
            ]
        );
    }
}
