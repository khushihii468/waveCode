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
        init_started_at = time.perf_counter()

        camera_started_at = time.perf_counter()
        self.camera = CameraStream()
        print(f"[WaveCode] CameraStream init: {time.perf_counter() - camera_started_at:.3f}s")

        detector_started_at = time.perf_counter()
        self.detector = MediaPipeHandDetector()
        print(f"[WaveCode] MediaPipeHandDetector init: {time.perf_counter() - detector_started_at:.3f}s")

        classifier_started_at = time.perf_counter()
        self.classifier = GestureClassifier(model_path=model_path)
        print(f"[WaveCode] GestureClassifier init: {time.perf_counter() - classifier_started_at:.3f}s")
        print(f"[WaveCode] GestureInferenceEngine init total: {time.perf_counter() - init_started_at:.3f}s")

        self._last_tick = time.perf_counter()
        self._loop_fps = 0.0
        self._message_counter = 0

    def start(self) -> None:
        self.camera.start()

    def stop(self) -> None:
        self.camera.stop()
        self.detector.close()

    def next_message(self) -> InferenceMessage:
        message_started_at = time.perf_counter()
        self._message_counter += 1

        frame_read_started_at = time.perf_counter()
        frame = self.camera.read()
        frame_read_elapsed = time.perf_counter() - frame_read_started_at
        camera_status = self.camera.status()
        self._update_loop_fps()

        if frame is None:
            self._log_message_timing(
                message_started_at=message_started_at,
                frame_read_elapsed=frame_read_elapsed,
                detection_elapsed=0.0,
                classification_elapsed=0.0,
                outcome="no_frame",
            )
            return InferenceMessage(
                {
                    "type": "status",
                    "camera_connected": camera_status.connected,
                    "hand_detected": False,
                    "fps": round(self._loop_fps, 2),
                    "message": "Waiting for camera frames",
                }
            )

        detection_started_at = time.perf_counter()
        detection = self.detector.detect(frame)
        detection_elapsed = time.perf_counter() - detection_started_at
        if detection.landmarks is None:
            self._log_message_timing(
                message_started_at=message_started_at,
                frame_read_elapsed=frame_read_elapsed,
                detection_elapsed=detection_elapsed,
                classification_elapsed=0.0,
                outcome="no_hand",
            )
            return InferenceMessage(
                {
                    "type": "status",
                    "camera_connected": camera_status.connected,
                    "hand_detected": False,
                    "fps": round(self._loop_fps, 2),
                    "message": "No hand detected",
                }
            )

        classification_started_at = time.perf_counter()
        prediction = self.classifier.predict(detection.landmarks, detection.handedness)
        classification_elapsed = time.perf_counter() - classification_started_at
        if prediction.gesture is None:
            self._log_message_timing(
                message_started_at=message_started_at,
                frame_read_elapsed=frame_read_elapsed,
                detection_elapsed=detection_elapsed,
                classification_elapsed=classification_elapsed,
                outcome="unrecognized",
            )
            return InferenceMessage(
                {
                    "type": "status",
                    "camera_connected": camera_status.connected,
                    "hand_detected": True,
                    "fps": round(self._loop_fps, 2),
                    "message": "Gesture not recognized",
                }
            )

        self._log_message_timing(
            message_started_at=message_started_at,
            frame_read_elapsed=frame_read_elapsed,
            detection_elapsed=detection_elapsed,
            classification_elapsed=classification_elapsed,
            outcome=f"gesture:{prediction.gesture}",
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

    def _log_message_timing(
        self,
        *,
        message_started_at: float,
        frame_read_elapsed: float,
        detection_elapsed: float,
        classification_elapsed: float,
        outcome: str,
    ) -> None:
        if self._message_counter > 20:
            return

        total_elapsed = time.perf_counter() - message_started_at
        print(
            "[WaveCode] next_message"
            f" #{self._message_counter}: total={total_elapsed:.3f}s"
            f" frame_read={frame_read_elapsed:.3f}s"
            f" detect={detection_elapsed:.3f}s"
            f" classify={classification_elapsed:.3f}s"
            f" outcome={outcome}"
        )
