use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::UNIX_EPOCH;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn run_git(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let out = cmd
        .output()
        .map_err(|e| format!("failed to run git: {e}"))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(stderr.trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

fn try_git(cwd: &Path, args: &[&str]) -> String {
    run_git(cwd, args).unwrap_or_default()
}

pub fn normalize_path_str(p: &Path) -> String {
    let s = p.to_string_lossy().to_string();
    #[cfg(target_os = "windows")]
    {
        s.strip_prefix(r"\\?\").unwrap_or(&s).to_string()
    }
    #[cfg(not(target_os = "windows"))]
    {
        s
    }
}

pub fn default_workspace_root() -> PathBuf {
    if let Ok(env_root) = std::env::var("GITWAVE_ROOT") {
        let p = PathBuf::from(env_root);
        if p.exists() {
            return p;
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        // If launched inside a repo folder (e.g. Documents/GitWave), mount its parent
        // when the parent holds sibling repositories.
        if cwd.join(".git").exists() {
            if let Some(parent) = cwd.parent() {
                if parent.exists() {
                    return parent.to_path_buf();
                }
            }
            return cwd;
        }
        // When launched from src-tauri during `tauri dev`
        if cwd.file_name().and_then(|n| n.to_str()) == Some("src-tauri") {
            if let Some(repo) = cwd.parent() {
                if let Some(parent) = repo.parent() {
                    if parent.exists() {
                        return parent.to_path_buf();
                    }
                }
                return repo.to_path_buf();
            }
        }
    }
    #[cfg(target_os = "windows")]
    let home = std::env::var_os("USERPROFILE").map(PathBuf::from);
    #[cfg(not(target_os = "windows"))]
    let home = std::env::var_os("HOME").map(PathBuf::from);

    if let Some(h) = home {
        let docs = h.join("Documents");
        if docs.exists() {
            return docs;
        }
        return h;
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

pub fn repo_fingerprint(repo_path: &Path) -> String {
    let git_dir = repo_path.join(".git");
    let head = fs::read_to_string(git_dir.join("HEAD"))
        .unwrap_or_default()
        .trim()
        .to_string();
    let tip = if let Some(rel) = head.strip_prefix("ref: ") {
        fs::read_to_string(git_dir.join(rel.trim()))
            .unwrap_or_default()
            .trim()
            .to_string()
    } else {
        head.clone()
    };
    let idx_mtime = fs::metadata(git_dir.join("index"))
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{head}|{tip}|{idx_mtime}")
}

fn read_origin_url_fast(repo_path: &Path) -> Option<String> {
    let cfg = fs::read_to_string(repo_path.join(".git").join("config")).ok()?;
    let mut in_origin = false;
    for line in cfg.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            in_origin = trimmed.eq_ignore_ascii_case("[remote \"origin\"]");
            continue;
        }
        if in_origin {
            if let Some(rest) = trimmed.strip_prefix("url") {
                if let Some(eq) = rest.find('=') {
                    let raw = rest[eq + 1..].trim();
                    if !raw.is_empty() {
                        // Strip embedded credentials if any
                        let cleaned = if let Some(scheme_pos) = raw.find("://") {
                            let after = &raw[scheme_pos + 3..];
                            if let Some(at_pos) = after.find('@') {
                                let slash_pos = after.find('/').unwrap_or(after.len());
                                if at_pos < slash_pos {
                                    format!("{}://{}", &raw[..scheme_pos], &after[at_pos + 1..])
                                } else {
                                    raw.to_string()
                                }
                            } else {
                                raw.to_string()
                            }
                        } else {
                            raw.to_string()
                        };
                        return Some(cleaned);
                    }
                }
            }
        }
    }
    None
}

fn quick_repo_summary(dir: &Path) -> Option<Value> {
    let out = run_git(dir, &["status", "--porcelain=v2", "--branch"]).ok()?;
    let mut head_ref = "(detached)".to_string();
    let mut unborn = false;
    let mut upstream: Option<String> = None;
    let mut ahead: u64 = 0;
    let mut behind: u64 = 0;
    let mut dirty_count: u64 = 0;
    let mut conflicted: u64 = 0;

    for line in out.lines() {
        if line.starts_with("# branch.oid (initial)") {
            unborn = true;
        } else if let Some(h) = line.strip_prefix("# branch.head ") {
            let trimmed = h.trim();
            if !trimmed.is_empty() {
                head_ref = trimmed.to_string();
            }
        } else if let Some(u) = line.strip_prefix("# branch.upstream ") {
            let trimmed = u.trim();
            if !trimmed.is_empty() {
                upstream = Some(trimmed.to_string());
            }
        } else if let Some(ab) = line.strip_prefix("# branch.ab ") {
            for part in ab.split_whitespace() {
                if let Some(a) = part.strip_prefix('+') {
                    ahead = a.parse().unwrap_or(0);
                } else if let Some(b) = part.strip_prefix('-') {
                    behind = b.parse().unwrap_or(0);
                }
            }
        } else if line.starts_with("u ") {
            conflicted += 1;
            dirty_count += 1;
        } else if line.starts_with("1 ") || line.starts_with("2 ") || line.starts_with("? ") {
            dirty_count += 1;
        }
    }

    let sync_state = if unborn {
        "empty"
    } else if conflicted > 0 {
        "conflict"
    } else if dirty_count > 0 && (ahead > 0 || behind > 0) {
        "dirty+diverged"
    } else if dirty_count > 0 {
        "dirty"
    } else if ahead > 0 && behind > 0 {
        "diverged"
    } else if ahead > 0 {
        "ahead"
    } else if behind > 0 {
        "behind"
    } else if upstream.is_none() {
        "local-only"
    } else {
        "synced"
    };

    let repo_name = dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("repo")
        .to_string();

    Some(json!({
        "repoPath": normalize_path_str(dir),
        "repoName": repo_name,
        "headRef": head_ref,
        "syncState": sync_state,
        "unborn": unborn,
        "summary": {
            "dirtyCount": dirty_count,
            "totalAhead": ahead,
            "totalBehind": behind,
            "unpushedBranches": if upstream.is_none() || ahead > 0 { 1 } else { 0 },
            "remoteOnlyCount": 0
        }
    }))
}

pub fn discover_repos(root_path: &Path) -> Vec<Value> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    let mut add_if_repo = |p: PathBuf| {
        if !p.join(".git").exists() {
            return;
        }
        let abs = fs::canonicalize(&p).unwrap_or(p);
        let key = normalize_path_str(&abs).to_lowercase();
        if seen.insert(key) {
            candidates.push(abs);
        }
    };

    add_if_repo(root_path.to_path_buf());
    if let Ok(entries) = fs::read_dir(root_path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.starts_with('.') || name == "node_modules" || name == "target" {
                    continue;
                }
            }
            add_if_repo(path);
        }
    }

    let mut repos: Vec<Value> = std::thread::scope(|s| {
        let handles: Vec<_> = candidates
            .iter()
            .map(|dir| s.spawn(move || quick_repo_summary(dir)))
            .collect();
        handles
            .into_iter()
            .filter_map(|h| h.join().ok().flatten())
            .collect()
    });

    repos.sort_by(|a, b| {
        let an = a["repoName"].as_str().unwrap_or("").to_lowercase();
        let bn = b["repoName"].as_str().unwrap_or("").to_lowercase();
        an.cmp(&bn)
    });
    repos
}

fn parse_patch_by_file(raw: &str) -> HashMap<String, (String, String)> {
    let mut map = HashMap::new();
    if raw.is_empty() {
        return map;
    }
    let normalized = raw.replace("\r\n", "\n");
    let mut chunks = normalized.split("\ndiff --git ");
    let first = chunks.next().unwrap_or("");
    let mut all_chunks: Vec<String> = Vec::new();
    if let Some(rest) = first.strip_prefix("diff --git ") {
        all_chunks.push(rest.to_string());
    }
    for c in chunks {
        all_chunks.push(c.to_string());
    }

    for chunk in all_chunks {
        let first_line = chunk.lines().next().unwrap_or("");
        let path = if let Some(pos) = first_line.find(" b/") {
            first_line[pos + 3..].trim().to_string()
        } else {
            first_line.trim().to_string()
        };
        let full = format!("diff --git {}", chunk.trim_end());
        let status = if full.contains("\nnew file mode ") {
            "added"
        } else if full.contains("\ndeleted file mode ") {
            "deleted"
        } else if full.contains("\nrename from ") {
            "renamed"
        } else {
            "modified"
        };
        let truncated: String = full.chars().take(32768).collect();
        map.insert(path, (status.to_string(), truncated));
    }
    map
}

fn parse_numstat(raw: &str) -> HashMap<String, (u64, u64)> {
    let mut map = HashMap::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parts: Vec<&str> = trimmed.split('\t').collect();
        if parts.len() < 3 {
            continue;
        }
        let ins: u64 = parts[0].parse().unwrap_or(0);
        let del: u64 = parts[1].parse().unwrap_or(0);
        let path = parts[2..].join("\t");
        let entry = map.entry(path).or_insert((0, 0));
        entry.0 += ins;
        entry.1 += del;
    }
    map
}

fn untracked_preview(repo_path: &Path, rel_path: &str) -> (u64, String) {
    let full = repo_path.join(rel_path);
    let Ok(meta) = fs::metadata(&full) else {
        return (0, String::new());
    };
    if !meta.is_file() {
        return (0, String::new());
    }
    if meta.len() > 40_000 {
        return (
            0,
            format!(
                "diff --git a/{rel_path} b/{rel_path}\nnew file (untracked · {:.1} KB — preview skipped)",
                meta.len() as f64 / 1024.0
            ),
        );
    }
    let Ok(buf) = fs::read(&full) else {
        return (0, String::new());
    };
    if buf.iter().take(4096).any(|&b| b == 0) {
        return (
            0,
            format!(
                "diff --git a/{rel_path} b/{rel_path}\nnew binary file (untracked · {:.1} KB)",
                meta.len() as f64 / 1024.0
            ),
        );
    }
    let text = String::from_utf8_lossy(&buf).replace("\r\n", "\n");
    let lines: Vec<&str> = text.split('\n').collect();
    let shown: Vec<String> = lines.iter().take(260).map(|l| format!("+{l}")).collect();
    let patch = format!(
        "diff --git a/{rel_path} b/{rel_path}\nnew file mode 100644\n--- /dev/null\n+++ b/{rel_path}\n@@ -0,0 +1,{} @@\n{}",
        shown.len(),
        shown.join("\n")
    );
    (lines.len() as u64, patch.chars().take(32768).collect())
}

fn build_repo_tree(tracked: &[String], dirty_paths: &HashSet<String>) -> Value {
    let mut all_paths: BTreeSet<String> = BTreeSet::new();
    for p in tracked {
        let clean = p.replace('\\', "/").trim().to_string();
        if !clean.is_empty() {
            all_paths.insert(clean);
        }
    }
    for p in dirty_paths {
        if !p.is_empty() {
            all_paths.insert(p.clone());
        }
    }

    let mut folder_map: BTreeMap<String, (usize, usize, Vec<String>)> = BTreeMap::new();
    let mut root_files: Vec<Value> = Vec::new();
    let mut all_list: Vec<String> = Vec::new();

    for p in &all_paths {
        all_list.push(p.clone());
        let is_dirty = dirty_paths.contains(p);
        if let Some(slash) = p.find('/') {
            let dir = format!("{}/", &p[..slash]);
            let rec = folder_map.entry(dir).or_insert((0, 0, Vec::new()));
            rec.0 += 1;
            if is_dirty {
                rec.1 += 1;
            }
            if rec.2.len() < 6 {
                rec.2.push(p.clone());
            }
        } else if root_files.len() < 48 {
            root_files.push(json!({
                "name": p,
                "path": p,
                "dirty": is_dirty
            }));
        }
    }

    let mut folders: Vec<(String, usize, usize, Vec<String>)> = folder_map
        .into_iter()
        .map(|(name, (fc, dc, samples))| (name, fc, dc, samples))
        .collect();
    folders.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));

    let folders_json: Vec<Value> = folders
        .into_iter()
        .take(32)
        .map(|(name, fc, dc, samples)| {
            json!({
                "name": name,
                "path": name,
                "fileCount": fc,
                "dirtyCount": dc,
                "sampleFiles": samples
            })
        })
        .collect();

    json!({
        "totalFiles": all_paths.len(),
        "folders": folders_json,
        "rootFiles": root_files,
        "allFiles": all_list.into_iter().take(600).collect::<Vec<_>>()
    })
}

fn to_utc_iso_basic(iso: &str) -> String {
    // Git `--date=iso-strict` produces e.g. `2026-11-24T19:33:00-05:00` or `...Z`.
    // Keep valid ISO-8601 strict strings directly (JS Date.parse handles offsets cleanly).
    let trimmed = iso.trim();
    if trimmed.is_empty() {
        "2026-01-01T00:00:00Z".to_string()
    } else {
        trimmed.to_string()
    }
}

fn is_agent_author(name: &str) -> bool {
    let lower = name.to_lowercase();
    ["bot", "agent", "claude", "gemini", "copilot", "codex", "antigravity"]
        .iter()
        .any(|kw| lower.contains(kw))
}

struct DirtyItem {
    code: String,
    state: String,
    path: String,
}

struct BranchMeta {
    name: String,
    tip: String,
    date: String,
}

struct CommitRec {
    sha: String,
    parents: Vec<String>,
    time: String,
    author_name: String,
    is_agent: bool,
    subject: String,
    insertions: u64,
    deletions: u64,
    files: u64,
    refs: Vec<String>,
    merge: bool,
    file_stats: Vec<(String, u64, u64)>,
    changes: Option<Vec<Value>>,
}

pub fn load_repo_snapshot(repo_path: &Path) -> Result<Value, String> {
    let top_level = if repo_path.join(".git").exists() {
        fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf())
    } else {
        let top = run_git(repo_path, &["rev-parse", "--show-toplevel"])?;
        let p = PathBuf::from(top.trim());
        fs::canonicalize(&p).unwrap_or(p)
    };

    let repo_name = top_level
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("local-repo")
        .to_string();
    let repo_id: String = repo_name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    let repo_id = if repo_id.is_empty() { "local-repo".to_string() } else { repo_id };
    let remote_url = read_origin_url_fast(&top_level);

    /* Phase 1: 3 parallel git commands */
    let (status_out, refs_out, ls_files_out) = std::thread::scope(|s| {
        let h1 = s.spawn(|| try_git(&top_level, &["status", "--porcelain=v2", "--branch"]));
        let h2 = s.spawn(|| {
            try_git(
                &top_level,
                &[
                    "for-each-ref",
                    "--format=%(refname)\t%(refname:short)\t%(objectname)\t%(*objectname)\t%(committerdate:iso-strict)\t%(creatordate:iso-strict)\t%(upstream:short)\t%(upstream:track,nobracket)",
                    "refs/heads",
                    "refs/remotes/origin",
                    "refs/tags",
                ],
            )
        });
        let h3 = s.spawn(|| try_git(&top_level, &["ls-files"]));
        (
            h1.join().unwrap_or_default(),
            h2.join().unwrap_or_default(),
            h3.join().unwrap_or_default(),
        )
    });

    let mut head_ref = "(detached)".to_string();
    let mut staged: u64 = 0;
    let mut modified: u64 = 0;
    let mut untracked: u64 = 0;
    let mut conflicted: u64 = 0;
    let mut dirty_items: Vec<DirtyItem> = Vec::new();

    for line in status_out.lines() {
        if let Some(h) = line.strip_prefix("# branch.head ") {
            if !h.trim().is_empty() {
                head_ref = h.trim().to_string();
            }
        } else if let Some(path) = line.strip_prefix("? ") {
            untracked += 1;
            dirty_items.push(DirtyItem {
                code: "?".to_string(),
                state: "untracked".to_string(),
                path: path.trim().replace('\\', "/"),
            });
        } else if line.starts_with("u ") {
            conflicted += 1;
            let parts: Vec<&str> = line.split(' ').collect();
            let path = if parts.len() > 10 { parts[10..].join(" ") } else { String::new() };
            dirty_items.push(DirtyItem {
                code: "!".to_string(),
                state: "conflicted".to_string(),
                path: path.replace('\\', "/"),
            });
        } else if line.starts_with("1 ") || line.starts_with("2 ") {
            let parts: Vec<&str> = line.split(' ').collect();
            let xy = parts.get(1).copied().unwrap_or("..");
            let bytes = xy.as_bytes();
            let x = bytes.first().copied().unwrap_or(b'.') as char;
            let y = bytes.get(1).copied().unwrap_or(b'.') as char;
            let x_dirty = x != '.' && x != ' ';
            let y_dirty = y != '.' && y != ' ';
            if x_dirty {
                staged += 1;
            }
            if y_dirty {
                modified += 1;
            }
            let file_path = if line.starts_with("2 ") {
                let first_tab = line.split('\t').next().unwrap_or("");
                let cols: Vec<&str> = first_tab.split(' ').collect();
                if cols.len() > 9 { cols[9..].join(" ") } else { String::new() }
            } else if parts.len() > 8 {
                parts[8..].join(" ")
            } else {
                String::new()
            };
            let code = format!(
                "{}{}",
                if x_dirty { x.to_string() } else { String::new() },
                if y_dirty { y.to_string() } else { String::new() }
            );
            let state = if x_dirty && y_dirty {
                "staged+modified"
            } else if x_dirty {
                "staged"
            } else {
                "modified"
            };
            dirty_items.push(DirtyItem {
                code: if code.is_empty() { "M".to_string() } else { code },
                state: state.to_string(),
                path: file_path.replace('\\', "/"),
            });
        }
    }

    let mut branch_entries: Vec<BranchMeta> = Vec::new();
    let mut sync_branches: Vec<Value> = Vec::new();
    let mut local_names: HashSet<String> = HashSet::new();
    let mut remote_names: Vec<String> = Vec::new();
    let mut raw_tags: Vec<(String, String, String)> = Vec::new();
    let mut total_ahead: u64 = 0;
    let mut total_behind: u64 = 0;
    let mut unpushed_branches: u64 = 0;

    for line in refs_out.lines() {
        let cols: Vec<&str> = line.split('\t').collect();
        if cols.len() < 6 {
            continue;
        }
        let full_ref = cols[0];
        let short_ref = cols[1];
        let obj_sha = cols[2];
        let deref_sha = cols[3];
        let commit_date = cols[4];
        let creator_date = cols[5];
        let upstream = cols.get(6).copied().unwrap_or("");
        let track = cols.get(7).copied().unwrap_or("");

        if full_ref.starts_with("refs/heads/") {
            local_names.insert(short_ref.to_string());
            if branch_entries.len() < 32 {
                branch_entries.push(BranchMeta {
                    name: short_ref.to_string(),
                    tip: obj_sha.to_string(),
                    date: commit_date.to_string(),
                });
            }
            let mut ahead: u64 = 0;
            let mut behind: u64 = 0;
            for part in track.split(',') {
                let pt = part.trim();
                if let Some(a) = pt.strip_prefix("ahead ") {
                    ahead = a.trim().parse().unwrap_or(0);
                } else if let Some(b) = pt.strip_prefix("behind ") {
                    behind = b.trim().parse().unwrap_or(0);
                }
            }
            let gone = track.contains("gone");
            let local_only = upstream.is_empty() || gone;
            total_ahead += ahead;
            total_behind += behind;
            if local_only || ahead > 0 {
                unpushed_branches += 1;
            }
            sync_branches.push(json!({
                "name": short_ref,
                "current": short_ref == head_ref,
                "tip": obj_sha,
                "upstream": if upstream.is_empty() { Value::Null } else { json!(upstream) },
                "ahead": ahead,
                "behind": behind,
                "gone": gone,
                "localOnly": local_only
            }));
        } else if full_ref.starts_with("refs/remotes/origin/")
            && short_ref != "origin/HEAD"
            && short_ref != "origin"
        {
            if let Some(stripped) = short_ref.strip_prefix("origin/") {
                remote_names.push(stripped.to_string());
            }
        } else if full_ref.starts_with("refs/tags/") {
            let target_sha = if !deref_sha.is_empty() { deref_sha } else { obj_sha };
            raw_tags.push((
                short_ref.to_string(),
                target_sha.to_string(),
                creator_date.to_string(),
            ));
        }
    }

    let remote_only: Vec<String> = remote_names
        .into_iter()
        .filter(|r| !local_names.contains(r))
        .collect();
    let tracked_list: Vec<String> = ls_files_out
        .lines()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let dirty_path_set: HashSet<String> = dirty_items.iter().map(|d| d.path.clone()).collect();
    let tree = build_repo_tree(&tracked_list, &dirty_path_set);
    let dirty_count = dirty_items.len() as u64;

    let sync_state = if branch_entries.is_empty() {
        "empty"
    } else if conflicted > 0 {
        "conflict"
    } else if dirty_count > 0 && (total_ahead > 0 || total_behind > 0) {
        "dirty+diverged"
    } else if dirty_count > 0 {
        "dirty"
    } else if total_ahead > 0 && total_behind > 0 {
        "diverged"
    } else if total_ahead > 0 {
        "ahead"
    } else if total_behind > 0 {
        "behind"
    } else if remote_url.is_none() {
        "local-only"
    } else {
        "synced"
    };

    let files_json: Vec<Value> = dirty_items
        .iter()
        .take(80)
        .map(|f| json!({ "code": f.code, "state": f.state, "path": f.path }))
        .collect();

    if branch_entries.is_empty() {
        return Ok(json!({
            "unborn": true,
            "doc": Value::Null,
            "sync": {
                "repoPath": normalize_path_str(&top_level),
                "repoName": repo_name,
                "headRef": head_ref,
                "remoteUrl": remote_url,
                "syncState": sync_state,
                "unborn": true,
                "tree": tree,
                "workingTree": {
                    "clean": dirty_count == 0,
                    "dirtyCount": dirty_count,
                    "staged": staged,
                    "modified": modified,
                    "untracked": untracked,
                    "conflicted": conflicted,
                    "files": files_json
                },
                "branches": [],
                "remoteOnlyBranches": remote_only,
                "summary": {
                    "dirtyCount": dirty_count,
                    "totalAhead": 0,
                    "totalBehind": 0,
                    "unpushedBranches": 0,
                    "remoteOnlyCount": remote_only.len()
                }
            }
        }));
    }

    let trunk_idx = branch_entries
        .iter()
        .position(|b| b.name == "main")
        .or_else(|| branch_entries.iter().position(|b| b.name == "master"))
        .or_else(|| branch_entries.iter().position(|b| b.name == head_ref))
        .unwrap_or(0);
    let trunk_name = branch_entries[trunk_idx].name.clone();
    let trunk_tip = branch_entries[trunk_idx].tip.clone();

    /* Phase 2: Parallel git log across branches + working-tree diffs ONLY if dirty */
    let (log_outputs, wt_diffs) = std::thread::scope(|s| {
        let log_handles: Vec<_> = branch_entries
            .iter()
            .map(|b| {
                let bname = b.name.clone();
                let tl = top_level.clone();
                s.spawn(move || {
                    let out = try_git(
                        &tl,
                        &[
                            "log",
                            &bname,
                            "-n",
                            "200",
                            "--date=iso-strict",
                            "--numstat",
                            "--format=COMMIT\x1f%H\x1f%P\x1f%aI\x1f%an\x1f%s",
                        ],
                    );
                    (bname, out)
                })
            })
            .collect();

        let wt_handle = if dirty_count > 0 {
            let tl = top_level.clone();
            Some(s.spawn(move || {
                std::thread::scope(|inner| {
                    let h1 = inner.spawn(|| try_git(&tl, &["diff", "--unified=3", "--no-color"]));
                    let h2 = inner.spawn(|| try_git(&tl, &["diff", "--cached", "--unified=3", "--no-color"]));
                    let h3 = inner.spawn(|| try_git(&tl, &["diff", "--numstat"]));
                    let h4 = inner.spawn(|| try_git(&tl, &["diff", "--cached", "--numstat"]));
                    (
                        h1.join().unwrap_or_default(),
                        h2.join().unwrap_or_default(),
                        h3.join().unwrap_or_default(),
                        h4.join().unwrap_or_default(),
                    )
                })
            }))
        } else {
            None
        };

        let logs: Vec<(String, String)> = log_handles
            .into_iter()
            .filter_map(|h| h.join().ok())
            .collect();
        let wt = wt_handle.and_then(|h| h.join().ok());
        (logs, wt)
    });

    let mut commit_map: HashMap<String, CommitRec> = HashMap::new();
    let mut ref_shas: HashMap<String, Vec<String>> = HashMap::new();

    for (branch_name, out) in log_outputs {
        let mut shas_here: Vec<String> = Vec::new();
        for block in out.split("COMMIT\x1f").skip(1) {
            let mut lines = block.lines();
            let Some(header) = lines.next() else { continue };
            let cols: Vec<&str> = header.split('\x1f').collect();
            if cols.len() < 5 {
                continue;
            }
            let sha = cols[0].trim();
            if sha.len() != 40 || !sha.chars().all(|c| c.is_ascii_hexdigit()) {
                continue;
            }
            let sha_lower = sha.to_lowercase();
            shas_here.push(sha_lower.clone());

            if let Some(existing) = commit_map.get_mut(&sha_lower) {
                if !existing.refs.contains(&branch_name) {
                    existing.refs.push(branch_name.clone());
                }
                continue;
            }

            let parents: Vec<String> = cols[1]
                .split_whitespace()
                .map(|p| p.to_lowercase())
                .collect();
            let iso_time = to_utc_iso_basic(cols[2]);
            let author_name = if cols[3].trim().is_empty() {
                "Unknown".to_string()
            } else {
                cols[3].trim().to_string()
            };
            let subject = if cols[4].trim().is_empty() {
                "(no subject)".to_string()
            } else {
                cols[4].trim().to_string()
            };

            let mut ins_total: u64 = 0;
            let mut del_total: u64 = 0;
            let mut files_count: u64 = 0;
            let mut file_stats: Vec<(String, u64, u64)> = Vec::new();

            for l in lines {
                let lt = l.trim();
                if lt.is_empty() {
                    continue;
                }
                let parts: Vec<&str> = lt.split('\t').collect();
                if parts.len() < 3 {
                    continue;
                }
                let ins: u64 = parts[0].parse().unwrap_or(0);
                let del: u64 = parts[1].parse().unwrap_or(0);
                let fpath = parts[2..].join("\t").replace('\\', "/");
                ins_total += ins;
                del_total += del;
                files_count += 1;
                file_stats.push((fpath, ins, del));
            }

            let merge = parents.len() > 1;
            let is_agent = is_agent_author(&author_name);
            commit_map.insert(
                sha_lower.clone(),
                CommitRec {
                    sha: sha_lower,
                    parents,
                    time: iso_time,
                    author_name,
                    is_agent,
                    subject,
                    insertions: ins_total,
                    deletions: del_total,
                    files: files_count,
                    refs: vec![branch_name.clone()],
                    merge,
                    file_stats,
                    changes: None,
                },
            );
        }
        ref_shas.insert(branch_name, shas_here);
    }

    let valid_shas: HashSet<String> = commit_map.keys().cloned().collect();
    let mut commits: Vec<CommitRec> = commit_map.into_values().collect();
    commits.sort_by(|a, b| a.time.cmp(&b.time).then_with(|| a.sha.cmp(&b.sha)));

    for c in &mut commits {
        c.parents.retain(|p| valid_shas.contains(p));
    }

    /* Phase 3: Batched patches for newest 16 non-merge commits + merge-base checks */
    let patch_shas: Vec<String> = commits
        .iter()
        .filter(|c| !c.merge && !c.file_stats.is_empty())
        .rev()
        .take(16)
        .map(|c| c.sha.clone())
        .collect();

    let (raw_patches, merged_branches) = std::thread::scope(|s| {
        let patch_h = if !patch_shas.is_empty() {
            let tl = top_level.clone();
            let shas = patch_shas.clone();
            Some(s.spawn(move || {
                let mut args: Vec<&str> = vec![
                    "show",
                    "--format=PATCHSHA\x1f%H",
                    "--patch",
                    "--unified=3",
                    "--no-color",
                ];
                for sha in &shas {
                    args.push(sha.as_str());
                }
                try_git(&tl, &args)
            }))
        } else {
            None
        };

        let anc_handles: Vec<_> = branch_entries
            .iter()
            .filter(|b| b.name != trunk_name && b.tip != trunk_tip && valid_shas.contains(&b.tip))
            .map(|b| {
                let tl = top_level.clone();
                let bname = b.name.clone();
                let btip = b.tip.clone();
                let ttip = trunk_tip.clone();
                s.spawn(move || {
                    let ok = run_git(&tl, &["merge-base", "--is-ancestor", &btip, &ttip]).is_ok();
                    (bname, ok)
                })
            })
            .collect();

        let patches = patch_h.and_then(|h| h.join().ok()).unwrap_or_default();
        let merged: HashSet<String> = anc_handles
            .into_iter()
            .filter_map(|h| h.join().ok())
            .filter(|(_, ok)| *ok)
            .map(|(n, _)| n)
            .collect();
        (patches, merged)
    });

    if !raw_patches.is_empty() {
        let mut by_sha: HashMap<String, HashMap<String, (String, String)>> = HashMap::new();
        for sec in raw_patches.split("PATCHSHA\x1f").skip(1) {
            if let Some(nl) = sec.find('\n') {
                let sha = sec[..nl].trim().to_lowercase();
                let body = &sec[nl + 1..];
                if !sha.is_empty() {
                    by_sha.insert(sha, parse_patch_by_file(body));
                }
            }
        }
        for c in &mut commits {
            if let Some(pmap) = by_sha.get(&c.sha) {
                let ch: Vec<Value> = c
                    .file_stats
                    .iter()
                    .take(60)
                    .map(|(fpath, ins, del)| {
                        if let Some((st, patch)) = pmap.get(fpath) {
                            json!({
                                "path": fpath,
                                "status": st,
                                "insertions": ins,
                                "deletions": del,
                                "patch": patch
                            })
                        } else {
                            json!({
                                "path": fpath,
                                "status": "modified",
                                "insertions": ins,
                                "deletions": del
                            })
                        }
                    })
                    .collect();
                c.changes = Some(ch);
            }
        }
    }

    let time_by_sha: HashMap<String, String> = commits
        .iter()
        .map(|c| (c.sha.clone(), c.time.clone()))
        .collect();

    let mut refs_json: Vec<Value> = Vec::new();
    let mut color_idx: usize = 0;
    for b in &branch_entries {
        let Some(shas) = ref_shas.get(&b.name) else { continue };
        if shas.is_empty() || !valid_shas.contains(&b.tip) {
            continue;
        }
        let is_trunk = b.name == trunk_name;
        let created_at = shas
            .last()
            .and_then(|s| time_by_sha.get(s))
            .cloned()
            .unwrap_or_else(|| to_utc_iso_basic(&b.date));
        let pr = if !is_trunk && !merged_branches.contains(&b.name) && b.tip != trunk_tip {
            let lower = b.name.to_lowercase();
            let is_draft =
                lower.starts_with("wip/") || lower.starts_with("draft/") || lower.starts_with("agent/");
            json!({
                "number": refs_json.len() + 1,
                "title": format!("{} (local unmerged branch)", b.name),
                "state": if is_draft { "draft" } else { "open" },
                "review": "none",
                "checks": "none",
                "conflicts": false,
                "draft": is_draft,
                "mergedAt": Value::Null
            })
        } else {
            Value::Null
        };
        let color_key = if is_trunk {
            0
        } else {
            let k = (color_idx % 5) + 1;
            color_idx += 1;
            k
        };
        refs_json.push(json!({
            "id": b.name,
            "name": b.name,
            "kind": if is_trunk { "trunk" } else { "branch" },
            "base": if is_trunk { Value::Null } else { json!(trunk_name) },
            "tip": b.tip,
            "createdAt": created_at,
            "mergedAt": Value::Null,
            "colorKey": color_key,
            "pr": pr
        }));
    }

    let mut tags_json: Vec<Value> = Vec::new();
    for (tname, tsha, tdate) in raw_tags {
        let tsha_low = tsha.to_lowercase();
        if tname.is_empty() || !valid_shas.contains(&tsha_low) {
            continue;
        }
        let ttime = if !tdate.is_empty() {
            to_utc_iso_basic(&tdate)
        } else {
            time_by_sha
                .get(&tsha_low)
                .cloned()
                .unwrap_or_else(|| "2026-01-01T00:00:00Z".to_string())
        };
        tags_json.push(json!({
            "name": tname,
            "sha": tsha_low,
            "time": ttime
        }));
    }

    let mut churns: Vec<u64> = commits.iter().map(|c| c.insertions + c.deletions).collect();
    churns.sort_unstable();
    let p90 = if churns.is_empty() {
        250
    } else {
        churns[((churns.len() - 1) * 9) / 10]
    };
    let churn_ceiling = std::cmp::max(100, p90.saturating_mul(2));
    let from_iso = commits
        .first()
        .map(|c| c.time.clone())
        .unwrap_or_else(|| "2026-01-01T00:00:00Z".to_string());
    let to_iso = commits
        .last()
        .map(|c| c.time.clone())
        .unwrap_or_else(|| from_iso.clone());

    let commits_json: Vec<Value> = commits
        .into_iter()
        .map(|c| {
            let paths: Vec<String> = c.file_stats.iter().take(100).map(|(p, _, _)| p.clone()).collect();
            let mut obj = json!({
                "sha": c.sha,
                "parents": c.parents,
                "time": c.time,
                "author": {
                    "name": c.author_name,
                    "kind": if c.is_agent { "agent" } else { "human" }
                },
                "agent": if c.is_agent {
                    json!({ "runtime": "git", "model": c.author_name })
                } else {
                    Value::Null
                },
                "subject": c.subject,
                "insertions": c.insertions,
                "deletions": c.deletions,
                "files": c.files,
                "refs": c.refs,
                "merge": c.merge
            });
            if !paths.is_empty() {
                obj["paths"] = json!(paths);
            }
            if let Some(ch) = c.changes {
                obj["changes"] = json!(ch);
            }
            obj
        })
        .collect();

    let working_changes: Option<Vec<Value>> = wt_diffs.map(|(u_diff_raw, s_diff_raw, u_stat_raw, s_stat_raw)| {
        let u_diff = parse_patch_by_file(&u_diff_raw);
        let s_diff = parse_patch_by_file(&s_diff_raw);
        let u_stat = parse_numstat(&u_stat_raw);
        let s_stat = parse_numstat(&s_stat_raw);

        dirty_items
            .iter()
            .take(60)
            .map(|f| {
                if f.state == "untracked" {
                    let (ins, patch) = untracked_preview(&top_level, &f.path);
                    let mut v = json!({
                        "path": f.path,
                        "status": "added",
                        "state": f.state,
                        "insertions": ins,
                        "deletions": 0
                    });
                    if !patch.is_empty() {
                        v["patch"] = json!(patch);
                    }
                    return v;
                }
                let (ui, ud) = u_stat.get(&f.path).copied().unwrap_or((0, 0));
                let (si, sd) = s_stat.get(&f.path).copied().unwrap_or((0, 0));
                let uh = u_diff.get(&f.path);
                let sh = s_diff.get(&f.path);
                let patch = match (sh, uh) {
                    (Some((_, sp)), Some((_, up))) => {
                        format!("# --- STAGED ---\n{sp}\n\n# --- UNSTAGED WORKING TREE ---\n{up}")
                    }
                    (None, Some((_, up))) => up.clone(),
                    (Some((_, sp)), None) => sp.clone(),
                    (None, None) => String::new(),
                };
                let status = uh
                    .map(|(s, _)| s.as_str())
                    .or_else(|| sh.map(|(s, _)| s.as_str()))
                    .unwrap_or_else(|| {
                        if f.code.contains('D') {
                            "deleted"
                        } else if f.code.contains('A') {
                            "added"
                        } else if f.code.contains('R') {
                            "renamed"
                        } else {
                            "modified"
                        }
                    });
                let mut v = json!({
                    "path": f.path,
                    "status": status,
                    "state": f.state,
                    "insertions": ui + si,
                    "deletions": ud + sd
                });
                if !patch.is_empty() {
                    v["patch"] = json!(patch.chars().take(32768).collect::<String>());
                }
                v
            })
            .collect()
    });

    let mut wt_obj = json!({
        "clean": dirty_count == 0,
        "dirtyCount": dirty_count,
        "staged": staged,
        "modified": modified,
        "untracked": untracked,
        "conflicted": conflicted,
        "files": files_json
    });
    if let Some(wc) = working_changes {
        wt_obj["changes"] = json!(wc);
    }

    Ok(json!({
        "unborn": false,
        "doc": {
            "schemaVersion": 1,
            "tool": "gitwave",
            "generatedBy": "gitwave-desktop",
            "repo": {
                "id": repo_id,
                "name": repo_name,
                "defaultRef": trunk_name,
                "snapshotAt": to_iso,
                "span": { "from": from_iso, "to": to_iso }
            },
            "refs": refs_json,
            "commits": commits_json,
            "tags": tags_json,
            "scale": {
                "churnCeiling": churn_ceiling,
                "levels": 16
            }
        },
        "sync": {
            "repoPath": normalize_path_str(&top_level),
            "repoName": repo_name,
            "headRef": head_ref,
            "remoteUrl": remote_url,
            "syncState": sync_state,
            "unborn": false,
            "tree": tree,
            "workingTree": wt_obj,
            "branches": sync_branches,
            "remoteOnlyBranches": remote_only,
            "summary": {
                "dirtyCount": dirty_count,
                "totalAhead": total_ahead,
                "totalBehind": total_behind,
                "unpushedBranches": unpushed_branches,
                "remoteOnlyCount": remote_only.len()
            }
        }
    }))
}

pub fn read_repo_file_safe(repo_path: &Path, rel_path: &str) -> Result<Value, String> {
    let clean = rel_path
        .replace('\\', "/")
        .trim_start_matches('/')
        .trim()
        .to_string();
    if clean.is_empty()
        || clean.contains("..")
        || clean == ".git"
        || clean.starts_with(".git/")
    {
        return Err("invalid or restricted file path".to_string());
    }

    let root = fs::canonicalize(repo_path).map_err(|e| format!("invalid repo root: {e}"))?;
    let candidate = root.join(&clean);
    let full = fs::canonicalize(&candidate).map_err(|_| format!("file not found: {clean}"))?;

    if !full.starts_with(&root) {
        return Err("path escapes repository root".to_string());
    }
    let meta = fs::metadata(&full).map_err(|e| format!("stat failed: {e}"))?;
    if !meta.is_file() {
        return Err(format!("not a regular file: {clean}"));
    }

    let buf = fs::read(&full).map_err(|e| format!("read failed: {e}"))?;
    let binary = buf.iter().take(4096).any(|&b| b == 0);
    if binary {
        return Ok(json!({
            "path": clean,
            "sizeBytes": meta.len(),
            "lineCount": 0,
            "binary": true,
            "truncated": false,
            "content": ""
        }));
    }

    const MAX_BYTES: usize = 128 * 1024;
    let truncated = buf.len() > MAX_BYTES;
    let slice = if truncated { &buf[..MAX_BYTES] } else { &buf[..] };
    let text = String::from_utf8_lossy(slice).replace("\r\n", "\n");
    let line_count = if text.is_empty() { 0 } else { text.split('\n').count() };

    Ok(json!({
        "path": clean,
        "sizeBytes": meta.len(),
        "lineCount": line_count,
        "binary": false,
        "truncated": truncated,
        "content": text
    }))
}
