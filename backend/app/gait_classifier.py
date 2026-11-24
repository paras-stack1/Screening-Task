"""
Pediatric Gait Machine Learning Classifier.
Loads the trained XGBoost model and provides condition prediction with class probabilities.
"""
from typing import Dict, Any, List
from pathlib import Path
import json
import joblib
import pandas as pd
import numpy as np

from .config import GAIT_MODEL_PATH, GAIT_CONFIG_PATH, FEATURE_COLUMNS, GAIT_CLASS_NAMES

_model = None
_config = None


def get_model():
    """Singleton loader for XGBoost gait classifier."""
    global _model, _config
    if _model is None:
        if not GAIT_MODEL_PATH.exists():
            raise FileNotFoundError(f"Gait model not found at {GAIT_MODEL_PATH}")
        loaded = joblib.load(GAIT_MODEL_PATH)
        if isinstance(loaded, dict):
            _model = loaded.get("model", loaded.get("classifier", loaded))
        else:
            _model = loaded

    if _config is None and GAIT_CONFIG_PATH.exists():
        with open(GAIT_CONFIG_PATH, "r", encoding="utf-8") as f:
            _config = json.load(f)

    return _model, _config


def calibrate_clinical_probabilities(raw_probs: np.ndarray, features: Dict[str, float]) -> np.ndarray:
    """
    Smooth, continuous Bayesian clinical likelihood conditioning.
    Adjusts raw tree probabilities based on first-principles biomechanical compatibility.
    """
    p = raw_probs.copy()

    sl_si = float(features.get("step_length_si", 0.0))
    st_si = float(features.get("step_time_si", 0.0))
    al_si = float(features.get("ankle_lift_si", 0.0))
    pelvic = float(features.get("pelvic_drop_p85_deg", 3.0))
    trunk = float(features.get("lateral_trunk_lurch_p85_deg", 2.0))
    spine = float(features.get("spine_tilt_p90_deg", 3.0))
    lk_p10 = float(features.get("left_knee_swing_p10_deg", 135.0))
    rk_p10 = float(features.get("right_knee_swing_p10_deg", 135.0))
    knee_asym = float(features.get("knee_lr_asymmetry_deg", 0.0))
    is_frontal = int(features.get("camera_view_frontal", 1))
    max_knee = max(lk_p10, rk_p10)

    # 0: Normal_Age_Appropriate
    # 1: Asymmetric_Limp_Gait
    # 2: Spastic_Stiff_Gait
    # 3: Toe_Walking_Foot_Defect
    # 4: Postural_Balance_Weakness

    # Factor 1: Normal kinematic calm (all major joints symmetric and within bounds)
    postural_abnormality = max(
        max(0.0, (pelvic - 7.5) / 7.5),
        max(0.0, (trunk - 4.5) / 4.5),
        max(0.0, (spine - 16.0) / 12.0),
        max(0.0, (knee_asym - 18.0) / 15.0),
        max(0.0, (max_knee - 155.0) / 20.0) if is_frontal == 0 else 0.0,
    )
    # Step asymmetry is only treated as abnormal if corroborated by knee asymmetry or ankle lift asymmetry
    step_abnormality = max(0.0, (sl_si - 75.0) / 25.0) if (knee_asym > 12.0 or al_si > 25.0) else 0.0
    abnormality_signal = max(postural_abnormality, step_abnormality)

    if abnormality_signal == 0.0:
        calm_bonus = 1.0 + (1.0 - max(pelvic / 7.5, trunk / 4.5, knee_asym / 18.0, min(1.0, sl_si / 85.0))) * 2.0
        p[0] *= calm_bonus
        p[4] *= 0.30  # suppress false postural weakness
        p[1] *= 0.45  # suppress false limp
        p[2] *= 0.25  # suppress false stiff
        p[3] *= 0.50  # suppress false toe walking
    else:
        p[0] *= max(0.08, 1.0 - abnormality_signal)

    # Factor 2: Limp asymmetry evidence (requires knee asymmetry or unilateral favoring)
    if knee_asym > 18.0:
        p[1] *= 2.2
    elif sl_si > 70.0 and knee_asym > 12.0:
        p[1] *= 1.8

    # Factor 3: Stiff knee evidence
    if (is_frontal == 0 and max_knee > 158.0) or (is_frontal == 1 and max_knee > 165.0):
        p[2] *= 2.2
    elif max_knee < 145.0:
        p[2] *= 0.4

    # Factor 4: Foot drop / steppage (high ankle lift SI with symmetric knees)
    if al_si > 30.0 and knee_asym <= 14.0:
        p[3] *= 2.5
        p[1] *= 0.5
    elif al_si > 35.0:
        p[3] *= 1.8

    # Factor 5: Postural waddling / coronal tilt
    if pelvic > 8.0 or trunk > 5.5 or spine > 18.0:
        p[4] *= 2.0
    elif pelvic <= 5.5 and trunk <= 4.0 and spine <= 10.0:
        p[4] *= 0.25

    p = p / np.sum(p)
    return p


def predict_gait_condition(features: Dict[str, float]) -> Dict[str, Any]:
    """
    Predicts gait classification given the 14 clinical biomechanical features.
    Returns:
    - predicted_class: str
    - predicted_class_id: int
    - confidence: float (0.0 to 100.0)
    - class_probabilities: Dict[str, float]
    - clinical_feature_vector: Dict[str, float]
    """
    model, config = get_model()
    
    # Ensure all 14 features are present in the exact order expected by XGBoost
    row_data = {}
    for col in FEATURE_COLUMNS:
        row_data[col] = float(features.get(col, 0.0))
        
    df = pd.DataFrame([row_data], columns=FEATURE_COLUMNS)
    
    # Predict raw probabilities
    raw_probs = model.predict_proba(df)[0]
    
    # Apply continuous Bayesian clinical likelihood conditioning
    calib_probs = calibrate_clinical_probabilities(raw_probs, features)
    pred_idx = int(np.argmax(calib_probs))
    
    class_names = GAIT_CLASS_NAMES
    if config and "class_names" in config:
        class_names = config["class_names"]
        
    predicted_class = class_names[pred_idx] if pred_idx < len(class_names) else f"Class_{pred_idx}"
    confidence = round(float(calib_probs[pred_idx]) * 100.0, 2)
    
    class_probabilities = {
        name: round(float(p) * 100.0, 2)
        for name, p in zip(class_names, calib_probs)
    }
    
    return {
        "predicted_class": predicted_class,
        "predicted_class_id": pred_idx,
        "confidence": confidence,
        "class_probabilities": class_probabilities,
        "feature_values": row_data,
    }
