use std::{sync::Arc, path::PathBuf, collections::HashMap};
use axum::{
    extract::{ws::{WebSocketUpgrade, WebSocket, Message}, State},
    response::Response,
    routing::get,
    Router,
};
use flate2::{write::GzEncoder, Compression};
use std::io::Write;
use tokio::sync::{RwLock, Mutex};
use tower_http::services::ServeDir;

use crate::comms::{RadarData};

struct ClientState {
    last_entity_count: usize,
    ping_ms: u32,
    high_latency: bool,
}

#[derive(Clone)]
struct AppState {
    data_lock: Arc<RwLock<RadarData>>,
    clients: Arc<Mutex<HashMap<String, ClientState>>>,
}

async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    let clone = state.clone();
    ws.on_upgrade(|socket| handle_socket(socket, clone))
}

async fn handle_socket(mut socket: WebSocket, state: AppState) {
    let client_id = uuid::Uuid::new_v4().to_string();

    {
        let mut clients = state.clients.lock().await;
        clients.insert(client_id.clone(), ClientState {
            last_entity_count: 0,
            ping_ms: 0,
            high_latency: false,
        });
    }

    let mut compression_buffer: Vec<u8> = Vec::with_capacity(65536);
    let mut frame_counter = 0;
    let mut skip_frames = false;

    while let Some(msg) = socket.recv().await {
        if let Ok(msg) = msg {
            if let Ok(text) = msg.to_text() {
                if text == "requestInfo" {
                    frame_counter += 1;
                    if skip_frames && frame_counter % 2 != 0 {
                        continue;
                    }

                    let radar_data = state.data_lock.read().await;
                    let mut clients = state.clients.lock().await;
                    let client_state = clients.get_mut(&client_id).unwrap();

                    let entity_count = radar_data.get_entities().len();

                    if entity_count > 5 && !skip_frames && client_state.ping_ms > 100 {
                        skip_frames = true;
                        log::info!("Enabling frame skipping for high latency client");
                    }

                    client_state.last_entity_count = entity_count;

                    let Ok(json) = serde_json::to_string(&*radar_data) else {
                        continue;
                    };

                    compression_buffer.clear();

                    let compression_level = if json.len() > 20000 || client_state.high_latency {
                        Compression::best()
                    } else if json.len() > 5000 {
                        Compression::default()
                    } else {
                        Compression::fast()
                    };

                    let mut encoder = GzEncoder::new(Vec::new(), compression_level);
                    if encoder.write_all(json.as_bytes()).is_ok() {
                        match encoder.finish() {
                            Ok(compressed) => {
                                if compressed.len() < json.len() {
                                    let mut message = vec![0x01];
                                    message.extend_from_slice(&compressed);
                                    let _ = socket.send(Message::Binary(message)).await;
                                } else {
                                    let mut uncompressed = vec![0x00];
                                    uncompressed.extend_from_slice(json.as_bytes());
                                    let _ = socket.send(Message::Binary(uncompressed)).await;
                                }
                            },
                            Err(_) => {
                                let mut uncompressed = vec![0x00];
                                uncompressed.extend_from_slice(json.as_bytes());
                                let _ = socket.send(Message::Binary(uncompressed)).await;
                            }
                        }
                    } else {
                        let mut uncompressed = vec![0x00];
                        uncompressed.extend_from_slice(json.as_bytes());
                        let _ = socket.send(Message::Binary(uncompressed)).await;
                    }
                } else if text == "toggleMoneyReveal" {
                    let new_value = {
                        let mut data = state.data_lock.write().await;
                        data.money_reveal_enabled = !data.money_reveal_enabled;
                        data.money_reveal_enabled
                    };

                    let response = serde_json::json!({
                        "action": "toggleMoneyReveal",
                        "status": "success",
                        "enabled": new_value
                    });

                    let _ = socket.send(Message::Text(response.to_string())).await;
                } else if text.starts_with("ping:") {
                    if let Some(ping_str) = text.strip_prefix("ping:") {
                        if let Ok(ping_ms) = ping_str.parse::<u32>() {
                            let mut clients = state.clients.lock().await;
                            if let Some(client) = clients.get_mut(&client_id) {
                                client.ping_ms = ping_ms;
                                client.high_latency = ping_ms > 100;
                            }
                        }
                    }
                    let _ = socket.send(Message::Text("pong".to_string())).await;
                }
            }
        } else {
            break;
        }
    }
    let mut clients = state.clients.lock().await;
    clients.remove(&client_id);
}

pub async fn run(path: PathBuf, port: u16, data_lock: Arc<RwLock<RadarData>>) -> anyhow::Result<()> {
    let app = Router::new()
        .nest_service("/", ServeDir::new(path))
        .route("/ws", get(ws_handler))
        .with_state(AppState {
            data_lock,
            clients: Arc::new(Mutex::new(HashMap::new()))
        });

    let address = format!("0.0.0.0:{}", port);
    log::info!("Starting WebSocket server on {}", address);
    let listener = tokio::net::TcpListener::bind(address).await?;
    axum::serve(listener, app.into_make_service())
        .await?;

    Ok(())
}