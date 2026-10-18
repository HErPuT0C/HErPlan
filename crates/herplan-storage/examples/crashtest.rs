//! Crash test for project storage (F1-19, NFR-06): kill the process in the middle of saving and
//! check that the project still opens, every time.
//!
//! `crashtest run <dir> [iterations]` creates a project, then repeatedly starts a writer child and
//! kills it at a random moment. The writer saves the project in a loop the way autosave does
//! (project.json plus a batch of entity files, some deleted and recreated) and makes a backup every
//! few rounds. After each kill the project must open with no damaged files, every JSON file must
//! parse, and the backup list must read. Prints a JSON summary; exits with 1 on any failure.
//!
//! `crashtest writer <dir>` is the child process.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use herplan_storage::{
    create_backup, create_project, list_backups, read_project, write_project, BackupKind, FileText,
};

const ENTITIES: usize = 40;

fn entity(id: usize, round: u64) -> FileText {
    // Around 20 KB each, so a save takes long enough to be interrupted.
    let lore = format!("Строка лора {round}. ").repeat(600);
    FileText {
        path: format!("data/entities/e{id:03}.json"),
        text: format!("{{\n  \"id\": \"e{id:03}\",\n  \"name\": \"Персонаж {id}\",\n  \"round\": {round},\n  \"lore\": \"{lore}\"\n}}\n"),
    }
}

fn project_json(round: u64) -> FileText {
    FileText {
        path: "project.json".into(),
        text: format!(
            "{{\n  \"format\": \"herplan-project\",\n  \"formatVersion\": 1,\n  \"id\": \"crashtest00000000\",\n  \"name\": \"Crash test\",\n  \"round\": {round}\n}}\n"
        ),
    }
}

fn writer(dir: &Path) -> ! {
    let start = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    for round in start.. {
        let mut writes = vec![project_json(round)];
        writes.extend((0..ENTITIES).map(|i| entity(i, round)));
        // Every other round one entity disappears and comes back, like delete + undo.
        let deletes = if round % 2 == 0 {
            vec![format!(
                "data/entities/e{:03}.json",
                round % ENTITIES as u64
            )]
        } else {
            Vec::new()
        };
        if !deletes.is_empty() {
            writes.retain(|w| w.path != deletes[0]);
        }
        write_project(dir, &writes, &deletes).expect("save failed");
        if round % 5 == 0 {
            create_backup(dir, BackupKind::Auto, None).expect("backup failed");
        }
    }
    unreachable!()
}

fn next_random(seed: &mut u64) -> u64 {
    *seed ^= *seed << 13;
    *seed ^= *seed >> 7;
    *seed ^= *seed << 17;
    *seed
}

/// Problems found in the project after a kill; empty means it opens cleanly.
fn check(dir: &Path) -> Vec<String> {
    let mut problems = Vec::new();
    match read_project(dir) {
        Err(e) => problems.push(format!("project does not open: {e:?}")),
        Ok(snapshot) => {
            for damaged in &snapshot.damaged {
                problems.push(format!("damaged {}: {:?}", damaged.path, damaged.reason));
            }
            if !snapshot.files.iter().any(|f| f.path == "project.json") {
                problems.push("project.json missing".into());
            }
            for file in &snapshot.files {
                if serde_json::from_str::<serde_json::Value>(&file.text).is_err() {
                    problems.push(format!("invalid JSON in {}", file.path));
                }
            }
        }
    }
    if let Err(e) = list_backups(dir) {
        problems.push(format!("backups do not list: {e:?}"));
    }
    problems
}

fn run(dir: PathBuf, iterations: u32) -> bool {
    let _ = std::fs::remove_dir_all(&dir);
    let mut initial = vec![project_json(0)];
    initial.extend((0..ENTITIES).map(|i| entity(i, 0)));
    create_project(&dir, &initial).expect("cannot create the test project");

    let exe = std::env::current_exe().expect("no current exe");
    let mut seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos() as u64
        | 1;
    let started = Instant::now();
    let mut intact = 0u32;
    let mut failures = Vec::new();

    for i in 0..iterations {
        let mut child = Command::new(&exe)
            .arg("writer")
            .arg(&dir)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("cannot start the writer");
        // Between 30 and 400 ms: several saves in, usually in the middle of one.
        std::thread::sleep(Duration::from_millis(30 + next_random(&mut seed) % 370));
        child.kill().expect("cannot kill the writer");
        child.wait().ok();
        let problems = check(&dir);
        if problems.is_empty() {
            intact += 1;
        } else {
            failures.push(format!("iteration {i}: {}", problems.join("; ")));
        }
    }

    let backups = list_backups(&dir).map(|b| b.len()).unwrap_or(0);
    let ok = failures.is_empty();
    println!(
        "{}",
        serde_json::json!({
            "os": std::env::consts::OS,
            "iterations": iterations,
            "projectOpens": intact,
            "backupsMade": backups,
            "seconds": started.elapsed().as_secs(),
            "failures": failures,
            "ok": ok,
        })
    );
    ok
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("writer") => writer(Path::new(&args[2])),
        Some("run") => {
            let dir = PathBuf::from(
                args.get(2)
                    .cloned()
                    .unwrap_or_else(|| "crashtest-project".into()),
            );
            let iterations = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(200);
            if !run(dir, iterations) {
                std::process::exit(1);
            }
        }
        _ => {
            eprintln!("usage: crashtest run <dir> [iterations] | crashtest writer <dir>");
            std::process::exit(2);
        }
    }
}
