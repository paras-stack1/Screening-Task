"""
Configuration and constants for pediatric gait analysis & classification.
Single source of truth for schema, extraction constants, and thresholds.
"""
from pathlib import Path
from dataclasses import dataclass

BASE_DIR = Path(__file__).resolve().parent.parent

# Model paths
MODELS_DIR = BASE_DIR / "models"
GAIT_MODEL_PATH = (
    MODELS_DIR / "gait_xgboost_model_2.joblib"
    if (MODELS_DIR / "gait_xgboost_model_2.joblib").exists()
    else (MODELS_DIR / "gait_xgboost_model.joblib" if (MODELS_DIR / "gait_xgboost_model.joblib").exists() else BASE_DIR / "gait_xgboost_model.joblib")
)
GAIT_CONFIG_PATH = (
    MODELS_DIR / "gait_model_config_2.json"
    if (MODELS_DIR / "gait_model_config_2.json").exists()
    else (MODELS_DIR / "gait_model_config.json" if (MODELS_DIR / "gait_model_config.json").exists() else BASE_DIR / "gait_model_config.json")
)
SKIN_MODEL_PATH = MODELS_DIR / "skin_model.keras" if (MODELS_DIR / "skin_model.keras").exists() else BASE_DIR / "skin_model.keras"
EYE_MODEL_PATH = MODELS_DIR / "best_eye_mobilenetv3_small.keras" if (MODELS_DIR / "best_eye_mobilenetv3_small.keras").exists() else BASE_DIR / "best_eye_mobilenetv3_small.keras"
DATA_DIR = BASE_DIR / "data"

SCHEMA_VERSION: str = "2.0.0"

# Order matters. Training, inference, and the web app all use this tuple.
FEATURE_NAMES: tuple[str, ...] = (
    "child_age_months",
    "camera_view_frontal",          # 1 = front/diagonal (R_view >= 0.40), 0 = side (R_view < 0.40)
    "step_length_si",               # Robinson Symmetry Index % with epsilon floor
    "step_time_si",                 # Temporal step duration symmetry %
    "ankle_lift_si",                # Vertical clearance symmetry % (works head-on)
    "ankle_rms_velocity",           # Overall dynamic walking speed (torso units/s)
    "pelvic_drop_p85_deg",          # Camera-roll-corrected Trendelenburg drop (P85)
    "lateral_trunk_lurch_p85_deg",  # Compensated coronal trunk lean (P85)
    "left_knee_swing_p10_deg",      # True interior angle at max swing flexion (P10)
    "right_knee_swing_p10_deg",     # True interior angle at max swing flexion (P10)
    "knee_lr_asymmetry_deg",        # Bilateral knee flexion delta |L - R|
    "spine_tilt_p90_deg",           # True 2D upright coronal tilt (0° = upright, P90)
    "stationary_lower_limb_ratio",  # Evaluated on STATIONARY frames ONLY (knee > 155°)
    "stationary_wrist_fft_power",   # Evaluated on NON-WALKING frames ONLY (1.8-4.5 Hz)
)

FEATURE_COLUMNS = list(FEATURE_NAMES)

CLASS_NAMES: tuple[str, ...] = (
    "Normal_Age_Appropriate",
    "Asymmetric_Limp_Gait",
    "Spastic_Stiff_Gait",
    "Toe_Walking_Foot_Defect",
    "Postural_Balance_Weakness",
)

GAIT_CLASS_NAMES = list(CLASS_NAMES)

@dataclass(frozen=True)
class ExtractionConfig:
    lowpass_cutoff_hz: float = 6.0     # set from measured step frequency (2-3x fundamental)
    filter_order: int = 4
    edge_trim_s: float = 0.3
    max_step_hz: float = 4.0
    min_steps_per_leg: int = 2
    si_eps: float = 0.03               # denominator floor in normalized torso units
    min_visibility: float = 0.45
    min_clip_seconds: float = 1.5
    min_fps: float = 10.0
    max_jitter_norm: float = 0.05      # tuned from measured MediaPipe landmark noise

CFG = ExtractionConfig()

# WHO Multicentre Growth Reference Study (MGRS) Windows of Achievement (Months)
WHO_MILESTONES = {
    "sitting_without_support": {"p1": 3.8, "p50": 6.0, "p99": 9.2, "red_threshold": 9.5},
    "hands_and_knees_crawling": {"p1": 5.2, "p50": 8.5, "p99": 13.5, "red_threshold": 13.5},
    "standing_alone": {"p1": 6.9, "p50": 11.0, "p99": 16.9, "red_threshold": 17.0},
    "walking_alone": {"p1": 8.2, "p50": 12.1, "p99": 17.6, "red_threshold": 18.0},
    "mature_heel_strike": {"p1": 18.0, "p50": 21.0, "p99": 24.0, "red_threshold": 24.0},
}
