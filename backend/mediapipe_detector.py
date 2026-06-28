from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import cv2
import mediapipe as mp
import numpy as np


@dataclass
class DetectionResult:
    landmarks: Optional[np.ndarray]
    handedness: Optional[str]


class MediaPipeHandDetector:
    def __init__(
        self,
        max_num_hands: int = 1,
        min_detection_confidence: float = 0.6,
        min_tracking_confidence: float = 0.6,
    ) -> None:
        self._hands = mp.solutions.hands.Hands(
            static_image_mode=False,
            max_num_hands=max_num_hands,
            min_detection_confidence=min_detection_confidence,
            min_tracking_confidence=min_tracking_confidence,
        )

    def detect(self, frame_bgr: np.ndarray) -> DetectionResult:
        frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        results = self._hands.process(frame_rgb)

        if not results.multi_hand_landmarks:
            return DetectionResult(landmarks=None, handedness=None)

        hand_landmarks = results.multi_hand_landmarks[0]
        landmarks = np.array(
            [[landmark.x, landmark.y, landmark.z] for landmark in hand_landmarks.landmark],
            dtype=np.float32,
        )
        handedness = None
        if results.multi_handedness:
            handedness = results.multi_handedness[0].classification[0].label.lower()

        return DetectionResult(landmarks=landmarks, handedness=handedness)

    def close(self) -> None:
        self._hands.close()

