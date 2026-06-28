from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from camera import CameraStream
from classifier import GestureClassifier
from mediapipe_detector import MediaPipeHandDetector


@dataclass
class InferenceMessage:
    payload: dict[str, Any]


class GestureInferenceEngine:
    def __init__(self, model_path: Path) -> None:
        self.camera = CameraStream()
        self.detector = MediaPipeHandDetector()
        self.classifier = GestureClassifier(model_path=model_path)
        self._last_tick = time.perf_counter()
        self._loop_fps = 0.0

    def start(self) -> None:
        self.camera.start()

    def stop(self) -> None:
        self.camera.stop()
        self.detector.close()

    def next_message(self) -> InferenceMessage:
        frame = self.camera.read()
        camera_status = self.camera.status()
        self._update_loop_fps()

        if frame is None:
            return InferenceMessage(
                {
                    "type": "status",
                    "camera_connected": camera_status.connected,
                    "hand_detected": False,
                    "fps": round(self._loop_fps, 2),
                    "message": "Waiting for camera frames",
                }
            )

        detection = self.detector.detect(frame)
        if detection.landmarks is None:
            return InferenceMessage(
                {
                    "type": "status",
                    "camera_connected": camera_status.connected,
                    "hand_detected": False,
                    "fps": round(self._loop_fps, 2),
                    "message": "No hand detected",
                }
            )

        prediction = self.classifier.predict(detection.landmarks, detection.handedness)
        if prediction.gesture is None:
            return InferenceMessage(
                {
                    "type": "status",
                    "camera_connected": camera_status.connected,
                    "hand_detected": True,
                    "fps": round(self._loop_fps, 2),
                    "message": "Gesture not recognized",
                }
            )

        return InferenceMessage(
            {
                "type": "prediction",
                "gesture": prediction.gesture,
                "confidence": round(prediction.confidence, 4),
                "hand_detected": True,
                "camera_connected": camera_status.connected,
                "fps": round(self._loop_fps, 2),
            }
        )

    def _update_loop_fps(self) -> None:
        now = time.perf_counter()
        elapsed = now - self._last_tick
        self._last_tick = now
        if elapsed > 0:
            self._loop_fps = 1.0 / elapsed

