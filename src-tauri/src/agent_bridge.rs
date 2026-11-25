use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use tauri::{AppHandle, Emitter};

/// Lightweight zero-dependency localhost Agent Bridge (`127.0.0.1:4173`) built
/// straight into GitWave Desktop so `tools/mcp-server.mjs` and `tools/gitwave-cli.mjs`
/// can steer the desktop window and animate the Floating Agent Oscillator with
/// zero external servers running.
pub fn spawn_agent_bridge(app: AppHandle) {
    let port: u16 = std::env::var("GITWAVE_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(4173);

    std::thread::spawn(move || {
        let Ok(listener) = TcpListener::bind(("127.0.0.1", port)) else {
            // Port may already be in use by a browser live-server; skip gracefully.
            return;
        };
        for stream in listener.incoming().flatten() {
            let handle = app.clone();
            std::thread::spawn(move || {
                handle_client(stream, handle);
            });
        }
    });
}

fn send_json(stream: &mut TcpStream, status: &str, body: &Value) {
    let payload = body.to_string();
    let resp = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
        payload.len()
    );
    let _ = stream.write_all(resp.as_bytes());
    let _ = stream.flush();
}

fn handle_client(mut stream: TcpStream, app: AppHandle) {
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(3)));
    let mut reader = BufReader::new(match stream.try_clone() {
        Ok(s) => s,
        Err(_) => return,
    });

    let mut request_line = String::new();
    if reader.read_line(&mut request_line).unwrap_or(0) == 0 {
        return;
    }
    let parts: Vec<&str> = request_line.split_whitespace().collect();
    if parts.len() < 2 {
        return;
    }
    let method = parts[0];
    let path = parts[1].split('?').next().unwrap_or("/");

    let mut content_length: usize = 0;
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header).unwrap_or(0) == 0 {
            break;
        }
        let trimmed = header.trim();
        if trimmed.is_empty() {
            break;
        }
        if let Some((k, v)) = trimmed.split_once(':') {
            if k.trim().eq_ignore_ascii_case("content-length") {
                content_length = v.trim().parse().unwrap_or(0).min(1024 * 1024);
            }
        }
    }

    if method == "GET" && path == "/api/health" {
        send_json(
            &mut stream,
            "200 OK",
            &json!({ "ok": true, "runtime": "gitwave-desktop", "clients": 1 }),
        );
        return;
    }

    if method == "POST" && path == "/api/command" {
        let mut buf = vec![0u8; content_length];
        if content_length > 0 && reader.read_exact(&mut buf).is_err() {
            send_json(&mut stream, "400 Bad Request", &json!({ "ok": false, "error": "short read" }));
            return;
        }
        let parsed: Value = serde_json::from_slice(&buf).unwrap_or_else(|_| json!({}));
        let _ = app.emit("gitwave://command", &parsed);
        send_json(
            &mut stream,
            "200 OK",
            &json!({ "ok": true, "clients": 1, "runtime": "gitwave-desktop", "dispatched": parsed }),
        );
        return;
    }

    send_json(&mut stream, "404 Not Found", &json!({ "ok": false, "error": "not found" }));
}
