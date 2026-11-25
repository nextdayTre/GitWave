#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod agent_bridge;
mod git_engine;

use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

struct DesktopState {
    root_path: Mutex<PathBuf>,
    cache: Mutex<HashMap<String, (String, Value)>>,
}

#[tauri::command]
fn discover_repos(root_path: Option<String>, state: State<'_, DesktopState>) -> Result<Vec<Value>, String> {
    let target = if let Some(raw) = root_path {
        let p = PathBuf::from(raw);
        if let Ok(mut guard) = state.root_path.lock() {
            *guard = p.clone();
        }
        p
    } else {
        state
            .root_path
            .lock()
            .map(|g| g.clone())
            .unwrap_or_else(|_| git_engine::default_workspace_root())
    };
    Ok(git_engine::discover_repos(&target))
}

#[tauri::command]
fn load_repo_snapshot(
    repo_path: String,
    force: Option<bool>,
    state: State<'_, DesktopState>,
) -> Result<Value, String> {
    let path = PathBuf::from(&repo_path);
    let key = git_engine::normalize_path_str(&path).to_lowercase();
    let fp = git_engine::repo_fingerprint(&path);

    if !force.unwrap_or(false) && !fp.is_empty() {
        if let Ok(cache) = state.cache.lock() {
            if let Some((cached_fp, cached_val)) = cache.get(&key) {
                if cached_fp == &fp {
                    return Ok(cached_val.clone());
                }
            }
        }
    }

    let snapshot = git_engine::load_repo_snapshot(&path)?;
    let next_fp = git_engine::repo_fingerprint(&path);
    if let Ok(mut cache) = state.cache.lock() {
        if cache.len() >= 16 {
            if let Some(first_key) = cache.keys().next().cloned() {
                cache.remove(&first_key);
            }
        }
        cache.insert(key, (next_fp, snapshot.clone()));
    }
    Ok(snapshot)
}

#[tauri::command]
fn read_repo_file(repo_path: String, rel_path: String) -> Result<Value, String> {
    git_engine::read_repo_file_safe(&PathBuf::from(repo_path), &rel_path)
}

#[tauri::command]
async fn pick_workspace_folder(app: AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().pick_folder(move |folder| {
        let out = folder.and_then(|f| f.into_path().ok()).map(|p| git_engine::normalize_path_str(&p));
        let _ = tx.send(out);
    });
    rx.recv()
        .map_err(|_| "folder picker cancelled".to_string())
}

#[tauri::command]
fn bootstrap_workspace(state: State<'_, DesktopState>) -> Result<Value, String> {
    let root = state
        .root_path
        .lock()
        .map(|g| g.clone())
        .unwrap_or_else(|_| git_engine::default_workspace_root());
    let repos = git_engine::discover_repos(&root);

    // Prefer GitWave itself if inside the workspace, else first non-empty repo
    let chosen = repos
        .iter()
        .find(|r| {
            r["repoName"].as_str().map(|n| n.eq_ignore_ascii_case("GitWave")).unwrap_or(false)
                && !r["unborn"].as_bool().unwrap_or(false)
        })
        .or_else(|| repos.iter().find(|r| !r["unborn"].as_bool().unwrap_or(false)));

    let (active_repo, snapshot) = if let Some(entry) = chosen {
        if let Some(rp) = entry["repoPath"].as_str() {
            match load_repo_snapshot(rp.to_string(), Some(false), state) {
                Ok(snap) => (Some(rp.to_string()), Some(snap)),
                Err(_) => (None, None),
            }
        } else {
            (None, None)
        }
    } else {
        (None, None)
    };

    Ok(json!({
        "rootPath": git_engine::normalize_path_str(&root),
        "activeRepo": active_repo,
        "repos": repos,
        "snapshot": snapshot
    }))
}

fn main() {
    let initial_root = git_engine::default_workspace_root();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(DesktopState {
            root_path: Mutex::new(initial_root),
            cache: Mutex::new(HashMap::new()),
        })
        .setup(|app| {
            agent_bridge::spawn_agent_bridge(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bootstrap_workspace,
            discover_repos,
            load_repo_snapshot,
            read_repo_file,
            pick_workspace_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running GitWave Desktop");
}
