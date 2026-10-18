//! Project layout benchmark for ADR-004: one file per module vs one file per object vs a hybrid
//! (one file per entity, one file per graph). ~100 000 objects: 10 000 entities and 300 chapter
//! graphs holding 50 000 nodes and 40 000 edges.
//! Usage: formatbench <dir>   — prints a JSON summary.

use herplan_proto_storage::write_atomic;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

const ENTITIES: usize = 10_000;
const GRAPHS: usize = 300;
const NODES: usize = 50_000;
const EDGES: usize = 40_000;

fn entity(i: usize) -> Value {
    json!({
        "id": format!("e{i}"), "type": if i % 3 == 0 { "character" } else if i % 3 == 1 { "location" } else { "item" },
        "name": format!("Сущность {i}"), "subtitle": "Подзаголовок",
        "values": { "health": i % 500, "trust": i % 7, "lore": "Длинное описание персонажа или места, примерно как в реальном проекте. ".repeat(6) },
        "tags": ["важное", "глава-1"], "order": i
    })
}

fn node(g: usize, n: usize) -> Value {
    json!({
        "id": format!("g{g}n{n}"), "kind": "dialogue", "title": format!("Сцена {n}"),
        "body": "Короткий текст сцены или реплики, который виден на узле холста.",
        "x": n * 300, "y": (n % 20) * 160, "w": 220, "h": 110,
        "lines": [{ "speaker": "e1", "text": "Реплика первого персонажа." }, { "speaker": "e2", "text": "Ответ второго персонажа." }]
    })
}

fn graph(g: usize) -> Value {
    let per = NODES / GRAPHS;
    let nodes: Vec<Value> = (0..per).map(|n| node(g, n)).collect();
    let edges: Vec<Value> = (0..EDGES / GRAPHS).map(|e| json!({ "id": format!("g{g}e{e}"), "from": format!("g{g}n{}", e % per), "to": format!("g{g}n{}", (e * 7 + 1) % per), "condition": "доверие >= 3" })).collect();
    json!({ "id": format!("g{g}"), "kind": "chapter", "name": format!("Глава {g}"), "nodes": nodes, "edges": edges })
}

fn pretty(v: &Value) -> Vec<u8> {
    serde_json::to_vec_pretty(v).unwrap()
}

fn dir_size(p: &Path) -> (u64, usize) {
    let mut bytes = 0;
    let mut files = 0;
    for e in fs::read_dir(p).unwrap().flatten() {
        let m = e.metadata().unwrap();
        if m.is_dir() {
            let (b, f) = dir_size(&e.path());
            bytes += b;
            files += f;
        } else {
            bytes += m.len();
            files += 1;
        }
    }
    (bytes, files)
}

fn read_all_json(p: &Path) -> usize {
    let mut count = 0;
    for e in fs::read_dir(p).unwrap().flatten() {
        let path = e.path();
        if path.is_dir() {
            count += read_all_json(&path);
        } else {
            let bytes = fs::read(&path).unwrap();
            let nl = bytes.iter().position(|&b| b == b'\n').unwrap();
            let _: Value = serde_json::from_slice(&bytes[nl + 1..]).unwrap();
            count += 1;
        }
    }
    count
}

struct Layout {
    name: &'static str,
    write: fn(&Path, &[Value], &[Value]),
    edit: fn(&Path, &[Value]) -> u64,
}

fn write_module(root: &Path, entities: &[Value], graphs: &[Value]) {
    write_atomic(&root.join("entities.json"), &pretty(&Value::Array(entities.to_vec()))).unwrap();
    write_atomic(&root.join("graphs.json"), &pretty(&Value::Array(graphs.to_vec()))).unwrap();
}
fn edit_module(root: &Path, graphs: &[Value]) -> u64 {
    let mut g = graphs.to_vec();
    g[150]["nodes"][10]["title"] = json!("Новое название");
    let bytes = pretty(&Value::Array(g));
    write_atomic(&root.join("graphs.json"), &bytes).unwrap();
    bytes.len() as u64
}

fn write_object(root: &Path, entities: &[Value], graphs: &[Value]) {
    fs::create_dir_all(root.join("entities")).unwrap();
    for e in entities {
        write_atomic(&root.join("entities").join(format!("{}.json", e["id"].as_str().unwrap())), &pretty(e)).unwrap();
    }
    for g in graphs {
        let gdir = root.join("graphs").join(g["id"].as_str().unwrap());
        fs::create_dir_all(gdir.join("nodes")).unwrap();
        for n in g["nodes"].as_array().unwrap() {
            write_atomic(&gdir.join("nodes").join(format!("{}.json", n["id"].as_str().unwrap())), &pretty(n)).unwrap();
        }
        let mut meta = g.clone();
        meta.as_object_mut().unwrap().remove("nodes");
        write_atomic(&gdir.join("graph.json"), &pretty(&meta)).unwrap();
    }
}
fn edit_object(root: &Path, graphs: &[Value]) -> u64 {
    let mut n = graphs[150]["nodes"][10].clone();
    n["title"] = json!("Новое название");
    let bytes = pretty(&n);
    write_atomic(&root.join("graphs/g150/nodes").join(format!("{}.json", n["id"].as_str().unwrap())), &bytes).unwrap();
    bytes.len() as u64
}

fn write_hybrid(root: &Path, entities: &[Value], graphs: &[Value]) {
    fs::create_dir_all(root.join("entities")).unwrap();
    fs::create_dir_all(root.join("graphs")).unwrap();
    for e in entities {
        write_atomic(&root.join("entities").join(format!("{}.json", e["id"].as_str().unwrap())), &pretty(e)).unwrap();
    }
    for g in graphs {
        write_atomic(&root.join("graphs").join(format!("{}.json", g["id"].as_str().unwrap())), &pretty(g)).unwrap();
    }
}
fn edit_hybrid(root: &Path, graphs: &[Value]) -> u64 {
    let mut g = graphs[150].clone();
    g["nodes"][10]["title"] = json!("Новое название");
    let bytes = pretty(&g);
    write_atomic(&root.join("graphs/g150.json"), &bytes).unwrap();
    bytes.len() as u64
}

fn main() {
    let base = PathBuf::from(std::env::args().nth(1).unwrap_or_else(|| "formatbench-data".into()));
    let _ = fs::remove_dir_all(&base);
    let t = Instant::now();
    let entities: Vec<Value> = (0..ENTITIES).map(entity).collect();
    let graphs: Vec<Value> = (0..GRAPHS).map(graph).collect();
    let gen_ms = t.elapsed().as_millis();

    let layouts = [
        Layout { name: "module (file per module)", write: write_module, edit: edit_module },
        Layout { name: "object (file per entity and per node)", write: write_object, edit: edit_object },
        Layout { name: "hybrid (file per entity, file per graph)", write: write_hybrid, edit: edit_hybrid },
    ];
    let mut results = Vec::new();
    for l in &layouts {
        let root = base.join(l.name.split(' ').next().unwrap());
        fs::create_dir_all(&root).unwrap();
        let t = Instant::now();
        (l.write)(&root, &entities, &graphs);
        let write_ms = t.elapsed().as_millis();
        let (bytes, files) = dir_size(&root);
        let t = Instant::now();
        let read = read_all_json(&root);
        let open_ms = t.elapsed().as_millis();
        let t = Instant::now();
        let edit_bytes = (l.edit)(&root, &graphs);
        let edit_ms = t.elapsed().as_secs_f64() * 1000.0;
        assert_eq!(read, files);
        results.push(json!({
            "layout": l.name, "files": files, "totalMB": (bytes as f64 / 1e6 * 10.0).round() / 10.0,
            "writeAllMs": write_ms, "openAllMs": open_ms,
            "editOneNodeBytesRewritten": edit_bytes, "editOneNodeMs": (edit_ms * 10.0).round() / 10.0
        }));
    }
    let _ = fs::remove_dir_all(&base);
    println!("{}", serde_json::to_string_pretty(&json!({ "os": std::env::consts::OS, "objects": ENTITIES + NODES + EDGES + GRAPHS, "generateMs": gen_ms, "results": results })).unwrap());
}
