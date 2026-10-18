//! Kill-during-write crash test.
//!
//! `crashtest run <dir> <iterations>` starts a writer child process, kills it at a random moment
//! while it is rewriting a ~1–2 MB project file in a loop, and checks that the file on disk is
//! always valid (old or new content, never torn). Prints a JSON summary; exits non-zero on failure.
//! `crashtest run-naive <dir> <iterations>` is the control group: the writer overwrites in place.
//! `crashtest writer <file>` is the child: it rewrites the file forever with growing content.

use herplan_proto_storage::{read_verified, write_atomic, ReadOutcome};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

fn payload(version: u64) -> Vec<u8> {
    // ~1–2 MB of JSON-like text, different for every version.
    let mut s = format!("{{\"version\":{version},\"nodes\":[");
    let count = 8_000 + (version % 8_000) as usize;
    for i in 0..count {
        if i > 0 {
            s.push(',');
        }
        s.push_str(&format!("{{\"id\":\"n{i}\",\"title\":\"Сцена {i} v{version}\",\"x\":{},\"y\":{}}}", i * 3, version));
    }
    s.push_str("]}");
    s.into_bytes()
}

fn writer(file: PathBuf, naive: bool) -> ! {
    let mut version = 0u64;
    loop {
        version += 1;
        let data = payload(version);
        if naive {
            // Control group: overwrite in place, the way an unprotected save does.
            use sha2::{Digest, Sha256};
            let mut bytes = format!("sha256:{:x}\n", Sha256::digest(&data)).into_bytes();
            bytes.extend_from_slice(&data);
            std::fs::write(&file, bytes).expect("write failed");
        } else {
            write_atomic(&file, &data).expect("write failed");
        }
    }
}

fn next_random(seed: &mut u64) -> u64 {
    *seed ^= *seed << 13;
    *seed ^= *seed >> 7;
    *seed ^= *seed << 17;
    *seed
}

fn run(dir: PathBuf, iterations: u32, naive: bool) -> bool {
    std::fs::create_dir_all(&dir).expect("cannot create test dir");
    let file = dir.join("project.json");
    let _ = std::fs::remove_file(&file);
    let exe = std::env::current_exe().expect("no current exe");
    let mut seed = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos() as u64 | 1;
    let (mut valid, mut missing, mut corrupt) = (0u32, 0u32, 0u32);
    let mut failures = Vec::new();
    let started = Instant::now();

    for i in 0..iterations {
        let mut child = Command::new(&exe)
            .arg(if naive { "writer-naive" } else { "writer" })
            .arg(&file)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("cannot start writer");
        // Kill somewhere between 30 and 400 ms: several writes in, usually mid-write.
        std::thread::sleep(Duration::from_millis(30 + next_random(&mut seed) % 370));
        child.kill().expect("cannot kill writer");
        child.wait().ok();
        match read_verified(&file) {
            ReadOutcome::Valid(_) => valid += 1,
            ReadOutcome::Missing => missing += 1,
            ReadOutcome::Corrupt(why) => {
                corrupt += 1;
                failures.push(format!("iteration {i}: {why}"));
            }
        }
    }
    // Leftover temp files are harmless (cleaned on next start in the real app) but worth counting.
    let leftovers = std::fs::read_dir(&dir).map(|d| d.filter_map(Result::ok).filter(|e| e.file_name().to_string_lossy().contains(".tmp-")).count()).unwrap_or(0);
    let ok = corrupt == 0;
    println!(
        "{}",
        serde_json::json!({
            "os": std::env::consts::OS,
            "mode": if naive { "naive overwrite (control)" } else { "atomic" },
            "iterations": iterations,
            "valid": valid,
            "missingBeforeFirstWrite": missing,
            "corrupt": corrupt,
            "leftoverTempFiles": leftovers,
            "seconds": started.elapsed().as_secs_f64().round(),
            "failures": failures,
            "ok": ok,
        })
    );
    ok
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("writer") => writer(PathBuf::from(&args[2]), false),
        Some("writer-naive") => writer(PathBuf::from(&args[2]), true),
        Some(mode @ ("run" | "run-naive")) => {
            let dir = PathBuf::from(args.get(2).cloned().unwrap_or_else(|| "crashtest-data".into()));
            let iterations = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(200);
            let naive = mode == "run-naive";
            // The control run is expected to find corruption; it never fails the process.
            if !run(dir, iterations, naive) && !naive {
                std::process::exit(1);
            }
        }
        _ => {
            eprintln!("usage: crashtest run|run-naive <dir> [iterations] | crashtest writer|writer-naive <file>");
            std::process::exit(2);
        }
    }
}
