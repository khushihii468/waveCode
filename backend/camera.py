from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np


@dataclass
class CameraStatus:
    connected: bool
    fps: float


class CameraStream:
    """Continuously reads the latest webcam frame on a background thread."""

    def __init__(self, camera_index: int = 0, width: int = 640, height: int = 480) -> None:
        self.camera_index = camera_index
        self.width = width
        self.height = height
        self._capture: Optional[cv2.VideoCapture] = None
        self._frame: Optional[np.ndarray] = None
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._fps = 0.0
        self._connected = False

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return

        self._stop_event.clear()
        self._capture = cv2.VideoCapture(self.camera_index)
        self._capture.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
        self._capture.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
        self._connected = bool(self._capture.isOpened())
        self._thread = threading.Thread(target=self._reader_loop, name="wavecode-camera", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2)
        if self._capture is not None:
            self._capture.release()
        self._capture = None
        self._thread = None
        self._frame = None
        self._connected = False

    def read(self) -> Optional[np.ndarray]:
        with self._lock:
            if self._frame is None:
                return None
            return self._frame.copy()

    def status(self) -> CameraStatus:
        return CameraStatus(connected=self._connected, fps=self._fps)

    def _reader_loop(self) -> None:
        last_frame_timestamp = time.perf_counter()

        while not self._stop_event.is_set():
            if self._capture is None:
                self._connected = False
                time.sleep(0.1)
                continue

            success, frame = self._capture.read()
            if not success:
                self._connected = False
                time.sleep(0.05)
                continue

            self._connected = True
            now = time.perf_counter()
            delta = now - last_frame_timestamp
            last_frame_timestamp = now
            if delta > 0:
                self._fps = 1.0 / delta

            with self._lock:
                self._frame = frame

        self._connected = False
