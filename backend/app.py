from __future__ import annotations

import argparse
import asyncio
from contextlib import suppress
from pathlib import Path

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from inference import GestureInferenceEngine
from websocket import ConnectionManager


ROOT_DIR = Path(__file__).resolve().parents[1]
MODEL_PATH = ROOT_DIR / "model" / "gesture_model.pkl"


class WaveCodeBackend:
    def __init__(self) -> None:
        self.manager = ConnectionManager()
        self.engine = GestureInferenceEngine(model_path=MODEL_PATH)
        self.publisher_task: asyncio.Task[None] | None = None
        self.running = False

    async def start(self) -> None:
        if self.running:
            return
        self.engine.start()
        self.running = True
        self.publisher_task = asyncio.create_task(self._publisher_loop(), name="wavecode-publisher")

    async def stop(self) -> None:
        self.running = False
        if self.publisher_task:
            self.publisher_task.cancel()
            with suppress(asyncio.CancelledError):
                await self.publisher_task
            self.publisher_task = None
        self.engine.stop()

    async def _publisher_loop(self) -> None:
        while self.running:
            message = self.engine.next_message()
            if self.manager.has_connections:
                await self.manager.broadcast_json(message.payload)
            await asyncio.sleep(0.03)


backend = WaveCodeBackend()
app = FastAPI(title="WaveCode Backend", version="0.1.0")


@app.on_event("startup")
async def on_startup() -> None:
    await backend.start()


@app.on_event("shutdown")
async def on_shutdown() -> None:
    await backend.stop()


@app.get("/health")
async def health() -> dict[str, object]:
    return {
        "status": "ok",
        "modelLoaded": MODEL_PATH.exists(),
    }


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await backend.manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        backend.manager.disconnect(websocket)
    except Exception:
        backend.manager.disconnect(websocket)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="WaveCode gesture backend")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()

