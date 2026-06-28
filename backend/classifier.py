from __future__ import annotations

import pickle
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

import numpy as np


GESTURE_LABELS = ["thumbs_up", "peace", "fist", "point", "open_palm"]


@dataclass
class GesturePrediction:
    gesture: Optional[str]
    confidence: float


def normalize_landmarks(landmarks: np.ndarray) -> np.ndarray:
    centered = landmarks - landmarks[0]
    scale = np.max(np.linalg.norm(centered[:, :2], axis=1))
    if scale <= 0:
        return centered
    return centered / scale


def landmarks_to_feature_vector(landmarks: np.ndarray) -> np.ndarray:
    normalized = normalize_landmarks(landmarks)
    return normalized.reshape(-1)


class HeuristicGestureClassifier:
    """Rule-based fallback so the MVP works before a trained model exists."""

    def predict(self, landmarks: np.ndarray, handedness: Optional[str] = None) -> GesturePrediction:
        normalized = normalize_landmarks(landmarks)
        finger_states = {
            "thumb": self._thumb_up(normalized),
            "index": self._finger_extended(normalized, 8, 6),
            "middle": self._finger_extended(normalized, 12, 10),
            "ring": self._finger_extended(normalized, 16, 14),
            "pinky": self._finger_extended(normalized, 20, 18),
        }

        extended_count = sum(1 for value in finger_states.values() if value)

        if finger_states["thumb"] and extended_count == 1 and self._thumb_points_up(normalized):
            return GesturePrediction("thumbs_up", 0.92)

        if finger_states["index"] and finger_states["middle"] and not finger_states["ring"] and not finger_states["pinky"] and not finger_states["thumb"]:
            separation = abs(normalized[8][0] - normalized[12][0])
            return GesturePrediction("peace", min(0.95, 0.82 + separation))

        if finger_states["index"] and not finger_states["middle"] and not finger_states["ring"] and not finger_states["pinky"] and not finger_states["thumb"]:
            return GesturePrediction("point", 0.9)

        if extended_count >= 4:
            openness = np.mean([
                self._finger_distance(normalized, 8),
                self._finger_distance(normalized, 12),
                self._finger_distance(normalized, 16),
                self._finger_distance(normalized, 20),
            ])
            return GesturePrediction("open_palm", min(0.98, 0.75 + openness / 4))

        if extended_count == 0:
            compactness = np.mean(np.linalg.norm(normalized[[8, 12, 16, 20]] - normalized[0], axis=1))
            return GesturePrediction("fist", max(0.8, 1.0 - compactness))

        return GesturePrediction(None, 0.0)

    @staticmethod
    def _finger_extended(landmarks: np.ndarray, tip_index: int, pip_index: int) -> bool:
        return landmarks[tip_index][1] < landmarks[pip_index][1]

    @staticmethod
    def _thumb_up(landmarks: np.ndarray) -> bool:
        return landmarks[4][1] < landmarks[3][1] < landmarks[2][1]

    @staticmethod
    def _thumb_points_up(landmarks: np.ndarray) -> bool:
        return landmarks[4][1] < landmarks[0][1] - 0.15

    @staticmethod
    def _finger_distance(landmarks: np.ndarray, tip_index: int) -> float:
        return float(np.linalg.norm(landmarks[tip_index] - landmarks[0]))


class GestureClassifier:
    def __init__(self, model_path: Optional[Path] = None) -> None:
        self.model_path = model_path
        self._bundle: Optional[dict[str, Any]] = None
        self._heuristic = HeuristicGestureClassifier()

        if model_path and model_path.exists():
            with model_path.open("rb") as model_file:
                self._bundle = pickle.load(model_file)

    def predict(self, landmarks: np.ndarray, handedness: Optional[str] = None) -> GesturePrediction:
        if not self._bundle:
            return self._heuristic.predict(landmarks, handedness)

        features = landmarks_to_feature_vector(landmarks).reshape(1, -1)
        scaler = self._bundle.get("scaler")
        if scaler is not None:
            features = scaler.transform(features)

        model = self._bundle["model"]
        labels = self._bundle.get("labels", GESTURE_LABELS)
        probabilities = model.predict_proba(features)[0]
        best_index = int(np.argmax(probabilities))
        confidence = float(probabilities[best_index])
        return GesturePrediction(labels[best_index], confidence)
