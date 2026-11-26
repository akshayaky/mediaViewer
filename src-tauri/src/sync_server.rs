use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::sync::atomic::{AtomicBool, AtomicU16, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

const MAX_SYNC_BODY_BYTES: usize = 32 * 1024 * 1024;
const DEFAULT_HTTP_TIMEOUT_MS: u64 = 5000;
const REQUEST_BRIDGE_TIMEOUT_SECS: u64 = 30;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncIncomingRequestEvent {
    pub request_id: String,
    pub method: String,
    pub path: String,
    pub headers: HashMap<String, String>,
    pub body: String,
    pub remote_ip: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncHttpResponsePayload {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

pub struct SyncServerState {
    running: Arc<AtomicBool>,
    port: Arc<AtomicU16>,
    next_id: AtomicU64,
    pending: Arc<Mutex<HashMap<String, mpsc::Sender<SyncHttpResponsePayload>>>>,
}

impl SyncServerState {
    pub fn new() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            port: Arc::new(AtomicU16::new(0)),
            next_id: AtomicU64::new(1),
            pending: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

fn is_routable_lan_ipv4(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    if ip.is_loopback() || ip.is_unspecified() || ip.is_broadcast() || ip.is_multicast() {
        return false;
    }
    if octets[0] == 169 && octets[1] == 254 {
        return false;
    }
    true
}

#[tauri::command]
pub fn sync_server_get_local_ips() -> Vec<String> {
    // UDP connect asks the OS routing table for the outbound local interface
    // without transmitting any network packets.
    let probe_targets = [
        "192.168.1.1:80",
        "192.168.0.1:80",
        "10.0.0.1:80",
        "172.16.0.1:80",
        "172.20.10.1:80",
        "192.168.43.1:80",
        "8.8.8.8:80",
    ];

    let mut discovered: Vec<String> = Vec::new();
    for target in probe_targets {
        if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
            if socket.connect(target).is_ok() {
                if let Ok(local_addr) = socket.local_addr() {
                    if let IpAddr::V4(ipv4) = local_addr.ip() {
                        if is_routable_lan_ipv4(ipv4) {
                            let s = ipv4.to_string();
                            if !discovered.contains(&s) {
                                discovered.push(s);
                            }
                        }
                    }
                }
            }
        }
    }

    discovered
}

#[tauri::command]
pub fn sync_server_start(
    app: AppHandle,
    state: State<'_, SyncServerState>,
    preferred_port: Option<u16>,
) -> Result<u16, String> {
    if state.running.load(Ordering::SeqCst) {
        let current = state.port.load(Ordering::SeqCst);
        if current > 0 {
            return Ok(current);
        }
    }

    let bind_port = preferred_port.unwrap_or(47890);
    let listener = TcpListener::bind(("0.0.0.0", bind_port))
        .or_else(|_| TcpListener::bind("0.0.0.0:0"))
        .map_err(|e| format!("Failed to bind LAN sync listener: {e}"))?;

    listener
        .set_nonblocking(true)
        .map_err(|e| format!("Failed to configure nonblocking listener: {e}"))?;

    let actual_port = listener
        .local_addr()
        .map_err(|e| format!("Failed to inspect listener address: {e}"))?
        .port();

    state.running.store(true, Ordering::SeqCst);
    state.port.store(actual_port, Ordering::SeqCst);

    let running = Arc::clone(&state.running);
    let port_ref = Arc::clone(&state.port);
    let pending = Arc::clone(&state.pending);
    let next_id_base = state.next_id.fetch_add(1, Ordering::SeqCst);
    let local_counter = Arc::new(AtomicU64::new(next_id_base * 100_000));

    thread::spawn(move || {
        while running.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((mut stream, addr)) => {
                    let app_clone = app.clone();
                    let pending_clone = Arc::clone(&pending);
                    let req_num = local_counter.fetch_add(1, Ordering::SeqCst);
                    let req_id = format!("sync_req_{req_num}");
                    thread::spawn(move || {
                        handle_sync_connection(&mut stream, addr, req_id, &app_clone, &pending_clone);
                    });
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(40));
                }
                Err(_) => {
                    thread::sleep(Duration::from_millis(100));
                }
            }
        }
        port_ref.store(0, Ordering::SeqCst);
    });

    Ok(actual_port)
}

#[tauri::command]
pub fn sync_server_stop(state: State<'_, SyncServerState>) -> Result<(), String> {
    state.running.store(false, Ordering::SeqCst);
    state.port.store(0, Ordering::SeqCst);
    if let Ok(mut map) = state.pending.lock() {
        map.clear();
    }
    Ok(())
}

#[tauri::command]
pub fn sync_server_respond(
    state: State<'_, SyncServerState>,
    request_id: String,
    status: u16,
    body: String,
    headers: Option<HashMap<String, String>>,
) -> Result<(), String> {
    let sender = {
        let mut map = state
            .pending
            .lock()
            .map_err(|_| "Sync response map poisoned".to_string())?;
        map.remove(&request_id)
    };

    if let Some(tx) = sender {
        let _ = tx.send(SyncHttpResponsePayload {
            status,
            headers: headers.unwrap_or_default(),
            body,
        });
    }
    Ok(())
}

#[tauri::command]
pub fn sync_http_request(
    ip: String,
    port: u16,
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: String,
    timeout_ms: Option<u64>,
) -> Result<SyncHttpResponsePayload, String> {
    let parsed_ip: IpAddr = ip
        .trim()
        .parse()
        .map_err(|_| format!("Invalid IP address: {ip}"))?;
    let addr = SocketAddr::new(parsed_ip, port);
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(DEFAULT_HTTP_TIMEOUT_MS));

    let mut stream = TcpStream::connect_timeout(&addr, timeout)
        .map_err(|e| format!("Failed to connect to {addr}: {e}"))?;
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));

    let normalized_path = if path.starts_with('/') {
        path
    } else {
        format!("/{path}")
    };
    let upper_method = method.to_uppercase();

    let mut raw_req = format!(
        "{upper_method} {normalized_path} HTTP/1.1\r\nHost: {ip}:{port}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: {}\r\n",
        body.as_bytes().len()
    );
    for (k, v) in headers {
        let clean_k = k.replace(['\r', '\n'], "");
        let clean_v = v.replace(['\r', '\n'], "");
        raw_req.push_str(&format!("{clean_k}: {clean_v}\r\n"));
    }
    raw_req.push_str("\r\n");

    stream
        .write_all(raw_req.as_bytes())
        .map_err(|e| format!("Failed to send sync HTTP headers: {e}"))?;
    if !body.is_empty() {
        stream
            .write_all(body.as_bytes())
            .map_err(|e| format!("Failed to send sync HTTP body: {e}"))?;
    }
    let _ = stream.flush();

    read_http_response(&mut stream)
}

fn find_header_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}

fn parse_headers_map(lines: &[&str]) -> (HashMap<String, String>, usize) {
    let mut headers = HashMap::new();
    let mut content_length = 0usize;
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            let key = name.trim().to_ascii_lowercase();
            let val = value.trim().to_string();
            if key == "content-length" {
                if let Ok(len) = val.parse::<usize>() {
                    content_length = len;
                }
            }
            headers.insert(key, val);
        }
    }
    (headers, content_length)
}

fn read_http_stream(stream: &mut TcpStream) -> Result<(String, HashMap<String, String>, String), String> {
    let mut buffer = Vec::with_capacity(4096);
    let mut chunk = [0u8; 4096];

    let header_end = loop {
        let n = stream
            .read(&mut chunk)
            .map_err(|e| format!("HTTP read error: {e}"))?;
        if n == 0 {
            return Err("Connection closed before HTTP headers completed".to_string());
        }
        buffer.extend_from_slice(&chunk[..n]);
        if let Some(pos) = find_header_end(&buffer) {
            break pos;
        }
        if buffer.len() > 64 * 1024 {
            return Err("HTTP headers exceeded 64KB limit".to_string());
        }
    };

    let header_bytes = &buffer[..header_end];
    let header_text = String::from_utf8_lossy(header_bytes);
    let mut lines = header_text.split("\r\n");
    let start_line = lines.next().unwrap_or_default().to_string();
    let header_lines: Vec<&str> = lines.collect();
    let (headers, content_length) = parse_headers_map(&header_lines);

    if content_length > MAX_SYNC_BODY_BYTES {
        return Err("Sync payload exceeds size limit".to_string());
    }

    let body_start = header_end + 4;
    let mut body_bytes = buffer[body_start..].to_vec();

    while body_bytes.len() < content_length {
        let n = stream
            .read(&mut chunk)
            .map_err(|e| format!("HTTP body read error: {e}"))?;
        if n == 0 {
            break;
        }
        body_bytes.extend_from_slice(&chunk[..n]);
    }
    if content_length > 0 && body_bytes.len() > content_length {
        body_bytes.truncate(content_length);
    }

    let body = String::from_utf8_lossy(&body_bytes).into_owned();
    Ok((start_line, headers, body))
}

fn read_http_response(stream: &mut TcpStream) -> Result<SyncHttpResponsePayload, String> {
    let mut buffer = Vec::with_capacity(4096);
    let mut chunk = [0u8; 4096];

    let header_end = loop {
        let n = stream
            .read(&mut chunk)
            .map_err(|e| format!("Sync response read error: {e}"))?;
        if n == 0 {
            return Err("Peer closed connection before sending response".to_string());
        }
        buffer.extend_from_slice(&chunk[..n]);
        if let Some(pos) = find_header_end(&buffer) {
            break pos;
        }
        if buffer.len() > 64 * 1024 {
            return Err("Peer response headers exceeded 64KB".to_string());
        }
    };

    let header_text = String::from_utf8_lossy(&buffer[..header_end]);
    let mut lines = header_text.split("\r\n");
    let status_line = lines.next().unwrap_or_default();
    let status = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse::<u16>().ok())
        .ok_or_else(|| format!("Invalid HTTP status line: {status_line}"))?;

    let header_lines: Vec<&str> = lines.collect();
    let (headers, content_length) = parse_headers_map(&header_lines);
    if content_length > MAX_SYNC_BODY_BYTES {
        return Err("Peer response exceeds size limit".to_string());
    }

    let mut body_bytes = buffer[header_end + 4..].to_vec();
    if headers.contains_key("content-length") {
        while body_bytes.len() < content_length {
            let n = stream
                .read(&mut chunk)
                .map_err(|e| format!("Sync response body read error: {e}"))?;
            if n == 0 {
                break;
            }
            body_bytes.extend_from_slice(&chunk[..n]);
        }
        if body_bytes.len() > content_length {
            body_bytes.truncate(content_length);
        }
    } else {
        while body_bytes.len() < MAX_SYNC_BODY_BYTES {
            match stream.read(&mut chunk) {
                Ok(0) => break,
                Ok(n) => body_bytes.extend_from_slice(&chunk[..n]),
                Err(_) => break,
            }
        }
    }

    Ok(SyncHttpResponsePayload {
        status,
        headers,
        body: String::from_utf8_lossy(&body_bytes).into_owned(),
    })
}

fn write_http_response(stream: &mut TcpStream, status: u16, body: &str) {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        408 => "Request Timeout",
        500 => "Internal Server Error",
        _ => "OK",
    };
    let bytes = body.as_bytes();
    let header = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        bytes.len()
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(bytes);
    let _ = stream.flush();
}

fn handle_sync_connection(
    stream: &mut TcpStream,
    addr: SocketAddr,
    request_id: String,
    app: &AppHandle,
    pending: &Arc<Mutex<HashMap<String, mpsc::Sender<SyncHttpResponsePayload>>>>,
) {
    // Accepted sockets inherit non-blocking mode from the listener on Windows (os error 10035).
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(15)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(15)));

    let (start_line, headers, body) = match read_http_stream(stream) {
        Ok(parsed) => parsed,
        Err(err) => {
            write_http_response(
                stream,
                400,
                &format!(r#"{{"error":"{}"}}"#, err.replace('"', "'")),
            );
            return;
        }
    };

    let mut parts = start_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_uppercase();
    let raw_path = parts.next().unwrap_or("/");
    let path = raw_path.split('?').next().unwrap_or(raw_path).to_string();

    if method == "GET" && path == "/sync/ping" {
        write_http_response(stream, 200, r#"{"ok":true}"#);
        return;
    }

    if method != "POST" || (path != "/sync/pair" && path != "/sync/exchange") {
        write_http_response(stream, 404, r#"{"error":"Unknown sync route"}"#);
        return;
    }

    let (tx, rx) = mpsc::channel();
    {
        if let Ok(mut map) = pending.lock() {
            map.insert(request_id.clone(), tx);
        } else {
            write_http_response(stream, 500, r#"{"error":"Sync lock poisoned"}"#);
            return;
        }
    }

    let event = SyncIncomingRequestEvent {
        request_id: request_id.clone(),
        method,
        path,
        headers,
        body,
        remote_ip: addr.ip().to_string(),
    };

    if app.emit("sync:incoming-request", event).is_err() {
        if let Ok(mut map) = pending.lock() {
            map.remove(&request_id);
        }
        write_http_response(stream, 500, r#"{"error":"Failed to dispatch sync request"}"#);
        return;
    }

    match rx.recv_timeout(Duration::from_secs(REQUEST_BRIDGE_TIMEOUT_SECS)) {
        Ok(resp) => write_http_response(stream, resp.status, &resp.body),
        Err(_) => {
            if let Ok(mut map) = pending.lock() {
                map.remove(&request_id);
            }
            write_http_response(stream, 408, r#"{"error":"Sync handler timed out"}"#);
        }
    }
}
