// Skitta-bestandsserver: bewaart grote bijlagen (> 8 MB) zodat ze niet bij Cloudflare staan.
// Alles wat hier binnenkomt is al end-to-end versleuteld; deze server kan de inhoud niet lezen.
// Toegang alleen met een kortlopend token dat de Skitta-Worker ondertekent (HMAC-SHA256).
// Opruimen: bestanden vanaf 50 MB na 7 dagen, kleinere na 90 dagen.
//
// Instellingen (omgevingsvariabelen):
//   SKITTA_FILES_SECRET  hetzelfde geheim als FILES_SECRET in de Worker (verplicht)
//   SKITTA_FILES_DIR     opslagmap (standaard /var/lib/skitta-bestanden)
//   SKITTA_FILES_LISTEN  adres (standaard 127.0.0.1:8090; zet Caddy of een tunnel ervoor voor https)
//   SKITTA_FILES_ORIGIN  website die mag uploaden (standaard https://skitta.timvanbergen.nl)
//   SKITTA_FILES_MAX_GB  maximale totale opslag in GB (standaard 50)

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::put;
use axum::Router;
use futures_util::StreamExt;
use hmac::{Hmac, KeyInit, Mac};
use sha2::Sha256;
use tokio::io::AsyncWriteExt;
use tower_http::cors::CorsLayer;

const BIG: u64 = 50 * 1024 * 1024;
const SHORT: Duration = Duration::from_secs(7 * 86400);
const LONG: Duration = Duration::from_secs(90 * 86400);

struct Config {
    secret: Vec<u8>,
    dir: PathBuf,
    max_bytes: u64,
}

/// Het token mag ook als ?t=... meekomen (voor downloads); eigen kleine parser, geen serde nodig.
struct TokenQuery {
    t: Option<String>,
}

impl axum::extract::FromRequestParts<Arc<Config>> for TokenQuery {
    type Rejection = std::convert::Infallible;
    async fn from_request_parts(parts: &mut axum::http::request::Parts, _: &Arc<Config>) -> Result<Self, Self::Rejection> {
        let t = parts.uri.query().and_then(|q| {
            q.split('&').find_map(|kv| kv.strip_prefix("t=").map(|v| v.to_string()))
        });
        Ok(TokenQuery { t })
    }
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn valid_id(id: &str) -> bool {
    (16..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Controleert "<handeling>.<id>.<grootte>.<verloopt>.<handtekening>" en geeft de grootte terug.
fn check_token(cfg: &Config, token: &str, action: &str, id: &str) -> Option<u64> {
    let (body, sig) = token.rsplit_once('.')?;
    let mut parts = body.split('.');
    let (a, i, size, exp) = (parts.next()?, parts.next()?, parts.next()?, parts.next()?);
    if a != action || i != id || parts.next().is_some() {
        return None;
    }
    if exp.parse::<u64>().ok()? < now() {
        return None;
    }
    let mut mac = <Hmac<Sha256> as KeyInit>::new_from_slice(&cfg.secret).ok()?;
    mac.update(body.as_bytes());
    mac.verify_slice(&hex::decode(sig).ok()?).ok()?;
    size.parse().ok()
}

fn token_from(headers: &HeaderMap, q: &TokenQuery) -> String {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::to_string)
        .or_else(|| q.t.clone())
        .unwrap_or_default()
}

async fn used_bytes(dir: &PathBuf) -> u64 {
    let mut total = 0;
    if let Ok(mut rd) = tokio::fs::read_dir(dir).await {
        while let Ok(Some(e)) = rd.next_entry().await {
            if let Ok(m) = e.metadata().await {
                total += m.len();
            }
        }
    }
    total
}

async fn upload(State(cfg): State<Arc<Config>>, Path(id): Path<String>, q: TokenQuery, headers: HeaderMap, body: Body) -> Response {
    if !valid_id(&id) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let Some(size) = check_token(&cfg, &token_from(&headers, &q), "put", &id) else {
        return StatusCode::FORBIDDEN.into_response();
    };
    let path = cfg.dir.join(&id);
    if path.exists() {
        return StatusCode::CONFLICT.into_response();
    }
    if used_bytes(&cfg.dir).await + size > cfg.max_bytes {
        return (StatusCode::INSUFFICIENT_STORAGE, "De bestandsserver is vol").into_response();
    }
    let tmp = cfg.dir.join(format!(".{id}.deel"));
    let Ok(mut file) = tokio::fs::File::create(&tmp).await else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    let mut stream = body.into_data_stream();
    let mut written: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let Ok(chunk) = chunk else {
            let _ = tokio::fs::remove_file(&tmp).await;
            return StatusCode::BAD_REQUEST.into_response();
        };
        written += chunk.len() as u64;
        // Niet meer aannemen dan in het token staat.
        if written > size || file.write_all(&chunk).await.is_err() {
            let _ = tokio::fs::remove_file(&tmp).await;
            return StatusCode::PAYLOAD_TOO_LARGE.into_response();
        }
    }
    if file.flush().await.is_err() || tokio::fs::rename(&tmp, &path).await.is_err() {
        let _ = tokio::fs::remove_file(&tmp).await;
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    StatusCode::CREATED.into_response()
}

async fn download(State(cfg): State<Arc<Config>>, Path(id): Path<String>, q: TokenQuery, headers: HeaderMap) -> Response {
    if !valid_id(&id) || check_token(&cfg, &token_from(&headers, &q), "get", &id).is_none() {
        return StatusCode::FORBIDDEN.into_response();
    }
    let Ok(file) = tokio::fs::File::open(cfg.dir.join(&id)).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let len = file.metadata().await.map(|m| m.len()).unwrap_or(0);
    let mut res = Body::from_stream(tokio_util::io::ReaderStream::new(file)).into_response();
    let h = res.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/octet-stream"));
    h.insert(header::CONTENT_LENGTH, HeaderValue::from(len));
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("private, no-store"));
    h.insert("x-content-type-options", HeaderValue::from_static("nosniff"));
    res
}

// Elk uur: verlopen bestanden en halve uploads weggooien.
async fn cleanup(cfg: Arc<Config>) {
    loop {
        if let Ok(mut rd) = tokio::fs::read_dir(&cfg.dir).await {
            while let Ok(Some(e)) = rd.next_entry().await {
                let Ok(m) = e.metadata().await else { continue };
                let age = m.modified().ok().and_then(|t| t.elapsed().ok()).unwrap_or_default();
                let partial = e.file_name().to_string_lossy().starts_with('.');
                let keep = if partial { Duration::from_secs(6 * 3600) } else if m.len() >= BIG { SHORT } else { LONG };
                if age > keep {
                    let _ = tokio::fs::remove_file(e.path()).await;
                }
            }
        }
        tokio::time::sleep(Duration::from_secs(3600)).await;
    }
}

#[tokio::main]
async fn main() {
    let secret = std::env::var("SKITTA_FILES_SECRET").expect("SKITTA_FILES_SECRET ontbreekt");
    assert!(secret.len() >= 32, "SKITTA_FILES_SECRET moet minstens 32 tekens zijn");
    let dir = PathBuf::from(std::env::var("SKITTA_FILES_DIR").unwrap_or_else(|_| "/var/lib/skitta-bestanden".into()));
    std::fs::create_dir_all(&dir).expect("opslagmap");
    let listen = std::env::var("SKITTA_FILES_LISTEN").unwrap_or_else(|_| "127.0.0.1:8090".into());
    let origin = std::env::var("SKITTA_FILES_ORIGIN").unwrap_or_else(|_| "https://skitta.timvanbergen.nl".into());
    let max_gb: u64 = std::env::var("SKITTA_FILES_MAX_GB").ok().and_then(|v| v.parse().ok()).unwrap_or(50);
    let cfg = Arc::new(Config { secret: secret.into_bytes(), dir, max_bytes: max_gb * 1024 * 1024 * 1024 });

    tokio::spawn(cleanup(cfg.clone()));
    let cors = CorsLayer::new()
        .allow_origin(origin.parse::<HeaderValue>().expect("SKITTA_FILES_ORIGIN"))
        .allow_methods([Method::GET, Method::PUT])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE])
        .max_age(Duration::from_secs(86400));
    let app = Router::new()
        .route("/f/{id}", put(upload).get(download))
        .layer(axum::extract::DefaultBodyLimit::disable())
        .layer(cors)
        .with_state(cfg);
    let listener = tokio::net::TcpListener::bind(&listen).await.expect("luisteren");
    println!("Skitta-bestandsserver luistert op {listen}");
    axum::serve(listener, app).await.expect("server");
}
