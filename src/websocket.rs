use std::{sync::Arc, path::PathBuf};
use axum::{
    extract::{ws::{WebSocketUpgrade, WebSocket, Message}, State},
    response::Response,
    routing::get,
    Router,
};
use flate2::{write::GzEncoder, Compression};
use std::io::Write;
use tokio::sync::RwLock;
use tower_http::services::ServeDir;

use crate::comms::{RadarData, ArcRwlockRadarData};

#[derive(Clone)]
struct AppState {
    data_lock: Arc<RwLock<RadarData>>
}

async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    let clone = state.clone();
    ws.on_upgrade(|socket| handle_socket(socket, clone))
}

async fn handle_socket(mut socket: WebSocket, state: AppState) {
    let mut compression_buffer: Vec<u8> = Vec::with_capacity(65536);

    while let Some(msg) = socket.recv().await {
        if let Ok(msg) = msg {
            if let Ok(text) = msg.to_text() {
                if text == "requestInfo" {
                    let radar_data = state.data_lock.read().await;

                    if let Ok(json) = serde_json::to_string(&*radar_data) {
                        compression_buffer.clear();

                        let compression_level = if json.len() > 10000 {
                            Compression::best()
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
                }
            }
        } else {
            break;
        }
    }
}

pub async fn run(path: PathBuf, port: u16, data_lock: Arc<RwLock<RadarData>>) -> anyhow::Result<()> {
    let app = Router::new()
        .nest_service("/", ServeDir::new(path))
        .route("/ws", get(ws_handler))
        .with_state(AppState { data_lock });

    let address = format!("0.0.0.0:{}", port);
    log::info!("Starting WebSocket server on {}", address);
    let listener = tokio::net::TcpListener::bind(address).await?;
    axum::serve(listener, app.into_make_service())
        .await?;

    Ok(())
}