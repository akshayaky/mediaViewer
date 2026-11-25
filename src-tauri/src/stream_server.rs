use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::Once;
use std::thread;

static STREAM_PORT: AtomicU16 = AtomicU16::new(0);
static START_SERVER_ONCE: Once = Once::new();
static APP_HANDLE: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

pub fn init_app_handle(app: tauri::AppHandle) {
    let _ = APP_HANDLE.set(app);
}

pub fn ensure_stream_server_running() -> u16 {
    START_SERVER_ONCE.call_once(|| {
        let listener = TcpListener::bind("127.0.0.1:0")
            .or_else(|_| TcpListener::bind("127.0.0.1:18492"))
            .expect("Failed to bind local video streaming server");

        let port = listener.local_addr().expect("Failed to get local addr").port();
        STREAM_PORT.store(port, Ordering::SeqCst);

        thread::spawn(move || {
            for stream in listener.incoming() {
                if let Ok(mut stream) = stream {
                    thread::spawn(move || {
                        handle_connection(&mut stream);
                    });
                }
            }
        });
    });

    STREAM_PORT.load(Ordering::SeqCst)
}

fn handle_connection(stream: &mut TcpStream) {
    let mut buffer = [0u8; 4096];
    let bytes_read = match stream.read(&mut buffer) {
        Ok(n) if n > 0 => n,
        _ => return,
    };

    let request_str = String::from_utf8_lossy(&buffer[..bytes_read]);
    let first_line = match request_str.lines().next() {
        Some(line) => line,
        None => return,
    };

    let parts: Vec<&str> = first_line.split_whitespace().collect();
    if parts.len() < 2 {
        return;
    }

    let raw_path = parts[1];

    // Parse path and query parameters
    let (_endpoint, query_str) = match raw_path.split_once('?') {
        Some((ep, q)) => (ep, q),
        None => (raw_path, ""),
    };

    let file_path = match parse_query_param(query_str, "path") {
        Some(p) => url_decode(&p),
        None => {
            let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 15\r\n\r\nMissing path param");
            return;
        }
    };

    let (mut file, file_len, mime_type) = if file_path.starts_with("content://") {
        #[cfg(target_os = "android")]
        {
            use tauri_plugin_android_fs::AndroidFsExt;
            let Some(app) = APP_HANDLE.get() else {
                let _ = stream.write_all(b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 22\r\n\r\nMissing app handle");
                return;
            };
            let uri = tauri_plugin_android_fs::FsUri::from_uri(&file_path);
            let file = match app.android_fs().open_file_readable(&uri) {
                Ok(f) => f,
                Err(e) => {
                    eprintln!("Failed to open content URI: {e}");
                    let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 14\r\n\r\nFile Not Found");
                    return;
                }
            };
            let mut file = file;
            let len = match file.metadata().map(|m| m.len()) {
                Ok(l) if l > 0 => l,
                _ => {
                    let cur = file.stream_position().unwrap_or(0);
                    let end = file.seek(SeekFrom::End(0)).unwrap_or(0);
                    let _ = file.seek(SeekFrom::Start(cur));
                    end
                }
            };
            let mime = app.android_fs().get_mime_type(&uri).unwrap_or_else(|_| "video/mp4".to_string());
            (file, len, mime)
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 14\r\n\r\nFile Not Found");
            return;
        }
    } else {
        let path = Path::new(&file_path);
        if !path.exists() || !path.is_file() {
            let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 14\r\n\r\nFile Not Found");
            return;
        }

        // Allowed extensions security filter
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        let is_video = matches!(ext.as_str(), "mp4" | "mkv" | "webm" | "avi" | "mov" | "m4v" | "ts" | "flv" | "wmv" | "ogv");
        let is_sub = matches!(ext.as_str(), "srt" | "vtt" | "txt" | "ass");

        if !is_video && !is_sub {
            let _ = stream.write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 18\r\n\r\nUnsupported format");
            return;
        }

        let mime = match ext.as_str() {
            "mp4" | "m4v" => "video/mp4",
            "webm" => "video/webm",
            "mkv" => "video/x-matroska",
            "avi" => "video/x-msvideo",
            "mov" => "video/quicktime",
            "ogv" => "video/ogg",
            "vtt" => "text/vtt",
            "srt" | "txt" | "ass" => "text/plain; charset=utf-8",
            _ => "application/octet-stream",
        }.to_string();

        let file = match File::open(path) {
            Ok(f) => f,
            Err(_) => {
                let _ = stream.write_all(b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 17\r\n\r\nFailed to open file");
                return;
            }
        };

        let len = match file.metadata() {
            Ok(m) => m.len(),
            Err(_) => 0,
        };

        (file, len, mime)
    };

    // Check for Range header
    let range_header = request_str
        .lines()
        .find(|l| l.to_lowercase().starts_with("range:"))
        .map(|l| l["range:".len()..].trim().to_string());

    if let Some(range_val) = range_header {
        if let Some((start, end)) = parse_range_header(&range_val, file_len) {
            let chunk_size = end - start + 1;
            if file.seek(SeekFrom::Start(start)).is_err() {
                let _ = stream.write_all(b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 10\r\n\r\nSeek Error");
                return;
            }

            let response_headers = format!(
                "HTTP/1.1 206 Partial Content\r\n\
                 Content-Type: {}\r\n\
                 Content-Length: {}\r\n\
                 Content-Range: bytes {}-{}/{}\r\n\
                 Accept-Ranges: bytes\r\n\
                 Access-Control-Allow-Origin: *\r\n\
                 Connection: close\r\n\r\n",
                mime_type, chunk_size, start, end, file_len
            );

            if stream.write_all(response_headers.as_bytes()).is_err() {
                return;
            }

            let mut remaining = chunk_size;
            let mut chunk_buf = [0u8; 65536];

            while remaining > 0 {
                let to_read = std::cmp::min(remaining as usize, chunk_buf.len());
                let bytes_read = match file.read(&mut chunk_buf[..to_read]) {
                    Ok(n) if n > 0 => n,
                    _ => break,
                };

                if stream.write_all(&chunk_buf[..bytes_read]).is_err() {
                    break;
                }
                remaining -= bytes_read as u64;
            }
            return;
        }
    }

    // No range request or full content
    let response_headers = format!(
        "HTTP/1.1 200 OK\r\n\
         Content-Type: {}\r\n\
         Content-Length: {}\r\n\
         Accept-Ranges: bytes\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Connection: close\r\n\r\n",
        mime_type, file_len
    );

    if stream.write_all(response_headers.as_bytes()).is_err() {
        return;
    }

    let mut chunk_buf = [0u8; 65536];
    loop {
        let bytes_read = match file.read(&mut chunk_buf) {
            Ok(n) if n > 0 => n,
            _ => break,
        };
        if stream.write_all(&chunk_buf[..bytes_read]).is_err() {
            break;
        }
    }
}

fn parse_query_param(query: &str, key: &str) -> Option<String> {
    for pair in query.split('&') {
        let mut kv = pair.splitn(2, '=');
        if let (Some(k), Some(v)) = (kv.next(), kv.next()) {
            if k == key {
                return Some(v.to_string());
            }
        }
    }
    None
}

fn url_decode(s: &str) -> String {
    let mut result = Vec::new();
    let bytes = s.as_bytes();
    let mut i = 0;

    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(val) = u8::from_str_radix(std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or(""), 16) {
                result.push(val);
                i += 3;
                continue;
            }
        } else if bytes[i] == b'+' {
            result.push(b' ');
            i += 1;
            continue;
        }
        result.push(bytes[i]);
        i += 1;
    }

    String::from_utf8_lossy(&result).to_string()
}

fn parse_range_header(header: &str, file_len: u64) -> Option<(u64, u64)> {
    if file_len == 0 {
        return None;
    }
    let val = header.strip_prefix("bytes=")?;
    let mut parts = val.split('-');
    let start_str = parts.next()?.trim();
    let end_str = parts.next()?.trim();

    let start = if start_str.is_empty() {
        if end_str.is_empty() {
            return None;
        }
        let back: u64 = end_str.parse().ok()?;
        file_len.saturating_sub(back)
    } else {
        start_str.parse().ok()?
    };

    let end = if end_str.is_empty() {
        file_len.saturating_sub(1)
    } else {
        let e: u64 = end_str.parse().ok()?;
        std::cmp::min(e, file_len.saturating_sub(1))
    };

    if start <= end && start < file_len {
        Some((start, end))
    } else {
        None
    }
}
