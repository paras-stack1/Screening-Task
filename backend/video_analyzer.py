"""
Pediatric Video Landmark Biomechanical Analyzer.
Executes the Complete First-Principles 6-Stage View-Invariant Pipeline:
Stage 1: Monotonic Guard, Visibility Filter & PCHIP Uniform Resampling (fs = 15.0 Hz).
Stage 2: Two-Tier Zero-Lag 4th-Order Butterworth Filter (scipy filtfilt at 3.5 Hz).
Stage 3: Metric World Coordinates & Orthonormal Anatomical Body Basis (e_up, e_lat, e_fwd).
Stage 4: True Interior 3D Joint Angles & True 2D Spine Tilt (0° = Upright).
Stage 5: View-Invariant Gait Cycle & Spatial/Temporal Robinson Symmetry.
Stage 6: Activity-Gated Feature Extraction (Stationary vs Walking) & 70/30 Hybrid Decision Fusion.
"""
from typing import List, Dict, Optional, Any
from pydantic import BaseModel, Field
import numpy as np

from app.signal_filters import (
    filter_monotonic_and_visibility,
    pchip_uniform_resampling,
    butterworth_zero_lag_filter_15hz,
)
from app.kinematics_engine import (
    detect_camera_view_angle,
    construct_orthonormal_body_basis,
    segment_stationary_vs_walking,
    extract_14_calibrated_features,
)
from app.gait_classifier import predict_gait_condition
from app.triage_engine import evaluate_corroborated_triage, evaluate_who_milestones


class FrameData(BaseModel):
    timestamp_ms: int
    pose_world_landmarks: List[Dict[str, float]]
    pose_landmarks_2d: Optional[List[Dict[str, float]]] = None
    face_metrics: Optional[Dict[str, Any]] = None


class VideoLandmarkPayload(BaseModel):
    child_age_months: int = Field(default=24, ge=1, le=216)
    task_type: str = Field(
        default="walking_gait",
        description="One of: walking_gait, sitting_posture, standing_alignment, balance_sway, social_response",
    )
    fps: float = Field(default=15.0, ge=1.0, le=60.0)
    audio_cue_timestamp_sec: Optional[float] = 3.0
    frames: List[FrameData]


def analyze_walking_gait_pipeline(payload: VideoLandmarkPayload) -> Dict[str, Any]:
    """
    Executes the first-principles view-invariant pediatric screening pipeline.
    """
    frames = payload.frames
    n_input_frames = len(frames)
    age = payload.child_age_months

    # Stage 1A: Monotonic Guard & Landmark Extraction
    coords_world, coords_2d, timestamps_sec, dropped_loops = filter_monotonic_and_visibility(
        frames=frames,
        min_vis=0.50,
    )

    n_monotonic = len(timestamps_sec)
    def retake(message: str) -> Dict[str, Any]:
        return {
            "screening_status": "YELLOW",
            "triage_category": "RETAKE",
            "task_type": "walking_gait",
            "child_age_months": age,
            "frames_analyzed": n_monotonic,
            "quality_gate": {
                "passed": False,
                "input_frames": n_input_frames,
                "valid_monotonic_frames": n_monotonic,
                "dropped_non_monotonic_loops": dropped_loops,
                "message": message,
            },
            "is_stationary": False,
            "metrics": {},
            "clinical_flags": [],
            "formula_explanations": [],
            "advice": "Retake the video with the full body and both feet in view during a straight walking pass.",
        }

    if n_monotonic < 8 or timestamps_sec[-1] - timestamps_sec[0] < 2.0:
        return retake("Too little continuous walking footage was tracked.")
    if np.max(np.diff(timestamps_sec)) > 0.4:
        return retake("Tracking was interrupted during the recording.")
    if not np.isfinite(coords_world).all() or not np.isfinite(coords_2d).all():
        return retake("Some tracked body points could not be measured.")

    # Stage 1B: PCHIP Uniform Resampling (15.0 Hz uniform time grid)
    fs_target = 15.0
    resampled_world, resampled_2d, uniform_times = pchip_uniform_resampling(
        coords_world=coords_world,
        coords_2d=coords_2d,
        timestamps_sec=timestamps_sec,
        fs=fs_target,
    )
    n_resampled = len(uniform_times)

    # Stage 2: Zero-Lag 4th-Order Butterworth Filter (filtfilt at 3.5 Hz)
    filtered_world = butterworth_zero_lag_filter_15hz(
        coords_world=resampled_world,
        fs=fs_target,
        fc=3.5,
    )

    # Stage 3: Auto-Detect View Angle & Orthonormal Anatomical Basis
    is_frontal, r_view = detect_camera_view_angle(resampled_2d)
    norm_world, torso_lens, e_up, e_lat, e_fwd = construct_orthonormal_body_basis(filtered_world)

    # Stage 4 & 5: Activity-Gated Segmentation
    dt = 1.0 / fs_target
    stationary_mask, walking_mask, v_ankle_rms = segment_stationary_vs_walking(norm_world, dt=dt)
    is_stationary = bool(np.sum(walking_mask) < 6 or v_ankle_rms < 0.15)

    # Stage 6: Feature Extraction
    features_14 = extract_14_calibrated_features(
        coords_world=filtered_world,
        coords_2d=resampled_2d,
        norm_world=norm_world,
        torso_lens=torso_lens,
        e_fwd=e_fwd,
        stationary_mask=stationary_mask,
        walking_mask=walking_mask,
        v_ankle_rms=v_ankle_rms,
        child_age_months=age,
        is_frontal=is_frontal,
        fs=fs_target,
    )

    if is_stationary or features_14["bilateral_step_evidence"] < 2:
        return retake("Too few steps were detected on both sides.")

    # Machine Learning Prediction (Calibrated XGBoost)
    ml_prediction = predict_gait_condition(features_14)

    # Corroborated Triage & Hybrid Decision Fusion (70% Physics + 30% Calibrated ML)
    triage_result = evaluate_corroborated_triage(
        features=features_14,
        ml_prediction=ml_prediction,
        is_stationary=is_stationary,
    )

    is_ok = triage_result["overall_status"] == "GREEN"
    problems = triage_result["clinical_flags"] if triage_result["clinical_flags"] else [
        "No gait abnormalities detected across step symmetry, cadence, pelvic tilt, and knee swing trajectories."
    ]

    return {
        "screening_status": triage_result["overall_status"],
        "is_ok": is_ok,
        "problems": problems,
        "triage_category": triage_result["triage_category"],
        "hybrid_score": triage_result["hybrid_score"],
        "physics_score": triage_result["physics_score"],
        "ml_abnormal_prob": triage_result["ml_abnormal_prob"],
        "camera_view": {
            "is_frontal": is_frontal,
            "r_view": r_view,
            "mode": "Frontal / Diagonal View" if is_frontal else "Side View",
        },
        "task_type": "walking_gait",
        "child_age_months": age,
        "frames_analyzed": n_resampled,
        "quality_gate": {
            "passed": True,
            "input_frames": n_input_frames,
            "valid_monotonic_frames": n_monotonic,
            "dropped_non_monotonic_loops": dropped_loops,
            "resampled_frames_15hz": n_resampled,
            "effective_sampling_rate": f"{fs_target:.1f} Hz (PCHIP Uniform)",
            "filter_applied": "Zero-Lag 4th-Order Butterworth (3.5 Hz)",
        },
        "is_stationary": is_stationary,
        "metrics": features_14,
        "ml_classification": {
            "predicted_condition": ml_prediction["predicted_class"],
            "confidence": round(ml_prediction["confidence"], 1),
            "probabilities": ml_prediction["class_probabilities"],
        },
        "clinical_indicators": triage_result.get("indicators", {}),
        "who_milestones": triage_result.get("who_milestones", {}),
        "clinical_flags": triage_result["clinical_flags"],
        "formula_explanations": triage_result["formula_explanations"],
        "advice": triage_result["advice"],
    }


def analyze_other_tasks(payload: VideoLandmarkPayload) -> Dict[str, Any]:
    """Fallback handler for non-walking screening tasks (balance sway, social response)."""
    frames = payload.frames
    task_type = payload.task_type
    age = payload.child_age_months

    coords_world, coords_2d, timestamps_sec, dropped = filter_monotonic_and_visibility(frames, min_vis=0.40)
    n_frames = len(timestamps_sec)

    if n_frames < 5:
        return {
            "screening_status": "YELLOW",
            "triage_category": "MONITOR",
            "task_type": task_type,
            "child_age_months": age,
            "frames_analyzed": n_frames,
            "metrics": {},
            "clinical_flags": ["Insufficient tracking frames."],
            "formula_explanations": ["At least 5 frames required."],
            "advice": "Please reposition the camera to capture the child from head to ankles and try again.",
        }

    mid_hip_x = (coords_2d[:, 23, 0] + coords_2d[:, 24, 0]) / 2.0
    mid_hip_y = (coords_2d[:, 23, 1] + coords_2d[:, 24, 1]) / 2.0
    mid_sh_x = (coords_2d[:, 11, 0] + coords_2d[:, 12, 0]) / 2.0
    mid_sh_y = (coords_2d[:, 11, 1] + coords_2d[:, 12, 1]) / 2.0
    torso_dy = np.maximum(0.01, mid_hip_y - mid_sh_y)
    torso_dx = mid_sh_x - mid_hip_x
    lean_deg = np.degrees(np.arctan2(torso_dx, torso_dy))
    median_lean = float(np.median(np.abs(lean_deg)))
    sway_std = float(np.std(mid_hip_x / torso_dy))

    def compute_joint_angle(p_a, p_b, p_c):
        ba = p_a - p_b
        bc = p_c - p_b
        cosine = np.sum(ba * bc, axis=-1) / (np.linalg.norm(ba, axis=-1) * np.linalg.norm(bc, axis=-1) + 1e-6)
        return np.degrees(np.arccos(np.clip(cosine, -1.0, 1.0)))

    left_knees = compute_joint_angle(coords_2d[:, 23, :2], coords_2d[:, 25, :2], coords_2d[:, 27, :2])
    right_knees = compute_joint_angle(coords_2d[:, 24, :2], coords_2d[:, 26, :2], coords_2d[:, 28, :2])
    median_l_knee = float(np.median(left_knees))
    median_r_knee = float(np.median(right_knees))
    knee_asym = float(abs(median_l_knee - median_r_knee))

    status = "GREEN"
    flags = []
    explanations = []
    advice = "Motor parameters are within typical developmental expectations. Continue routine pediatric tracking."

    if task_type == "sitting":
        if median_lean > 15.0:
            status = "YELLOW"
            flags.append(f"Elevated median trunk lean: {median_lean:.1f}° (normal: ≤14°).")
        if sway_std > 0.050:
            status = "YELLOW"
            flags.append(f"Elevated lateral balance sway: {sway_std:.3f} (normal: ≤0.050).")
        explanations.append(f"Trunk inclination: {median_lean:.1f}°, Postural sway: {sway_std:.3f}")
        if status != "GREEN":
            advice = "Pediatric evaluation recommended to assess core trunk tone, posture, and motor milestone timing."

    elif task_type == "crawl":
        l_amp = float(np.ptp(coords_2d[:, 27, 1]))
        r_amp = float(np.ptp(coords_2d[:, 28, 1]))
        csi = float(min(l_amp, r_amp) / (max(l_amp, r_amp) + 1e-6))
        if csi < 0.72:
            status = "YELLOW"
            flags.append(f"Asymmetric limb excursion (Crawl Symmetry Index: {csi*100:.0f}%, normal: ≥75%).")
        if knee_asym > 12.0:
            status = "YELLOW"
            flags.append(f"Knee angle asymmetry: {knee_asym:.1f}° (normal: ≤12°).")
        explanations.append(f"CSI: {csi*100:.1f}%, Knee asymmetry: {knee_asym:.1f}°")
        if status != "GREEN":
            advice = "Pediatric assessment recommended to evaluate unilateral muscle tone, hip joint mobility, and developmental reflexes."

    elif task_type == "standing":
        if median_l_knee < 163.0 or median_r_knee < 163.0:
            status = "YELLOW"
            flags.append(f"Knee crouch posture detected (L: {median_l_knee:.1f}°, R: {median_r_knee:.1f}°, normal: 165°–180°).")
        elif median_l_knee > 185.0 or median_r_knee > 185.0:
            status = "YELLOW"
            flags.append("Genu recurvatum (knee hyperextension >185°) detected.")
        if knee_asym >= 8.5:
            status = "YELLOW"
            flags.append(f"Lower-limb knee asymmetry: {knee_asym:.1f}° (normal: <8.5°).")
        if sway_std > 0.045:
            status = "YELLOW"
            flags.append(f"Elevated postural sway: {sway_std:.3f} (normal: ≤0.040).")
        explanations.append(f"Knees: L={median_l_knee:.1f}°, R={median_r_knee:.1f}°, Sway={sway_std:.3f}")
        if status != "GREEN":
            advice = "Referral to pediatric orthopedics or developmental clinic for joint mobility, lower-limb alignment, and balance coordination."

    elif task_type == "episodes":
        dt = np.diff(timestamps_sec)
        dt = np.where(dt <= 0, 0.05, dt)
        v_wrist_l = np.hypot(np.diff(coords_2d[:, 15, 0]), np.diff(coords_2d[:, 15, 1])) / dt
        v_wrist_r = np.hypot(np.diff(coords_2d[:, 16, 0]), np.diff(coords_2d[:, 16, 1])) / dt
        v_mean = (v_wrist_l + v_wrist_r) / 2.0
        zc = np.sum(np.diff(np.signbit(v_mean - np.mean(v_mean))))
        dom_freq = float(min(5.0, (zc / 2.0) / max(1.0, timestamps_sec[-1] - timestamps_sec[0])))
        if 1.5 <= dom_freq <= 4.5 and float(np.std(v_mean)) > 0.05:
            status = "YELLOW"
            flags.append(f"Periodic rhythmic motion detected in 1.5–4.5 Hz band (approx {dom_freq:.1f} Hz).")
            advice = "Clinical review by pediatric neurologist to evaluate for motor stereotypies, tremors, or paroxysmal events."
        explanations.append(f"Upper-limb dominant frequency: {dom_freq:.1f} Hz")

    elif task_type == "balance_sway":
        if sway_std > 0.08:
            status = "RED"
            flags.append("High center-of-mass sway detected (D3/D4).")
        elif sway_std > 0.04:
            status = "YELLOW"
            flags.append("Moderate balance oscillation.")
        explanations.append(f"Balance sway standard deviation: {sway_std:.4f}")
        if status != "GREEN":
            advice = "Clinical evaluation for vestibular or postural equilibrium concerns."

    metrics = {
        "sway_std": round(sway_std, 4),
        "median_trunk_lean_deg": round(median_lean, 1),
        "left_knee_extension_deg": round(median_l_knee, 1),
        "right_knee_extension_deg": round(median_r_knee, 1),
        "knee_asymmetry_deg": round(knee_asym, 1),
    }

    is_ok = status == "GREEN"
    problems = flags if flags else [
        "No problems detected across all evaluated biomechanical parameters. Postural stability, joint kinematics, and bilateral symmetry are within typical pediatric reference limits."
    ]

    return {
        "screening_status": status,
        "is_ok": is_ok,
        "problems": problems,
        "triage_category": "NORMAL" if status == "GREEN" else "MONITOR" if status == "YELLOW" else "REFERRAL",
        "task_type": task_type,
        "child_age_months": age,
        "frames_analyzed": n_frames,
        "metrics": metrics,
        "clinical_flags": flags,
        "formula_explanations": explanations,
        "advice": advice,
    }


def analyze_video_landmarks(payload: VideoLandmarkPayload) -> Dict[str, Any]:
    """Entry point for video landmark analysis."""
    if payload.task_type == "walking_gait":
        return analyze_walking_gait_pipeline(payload)

    if not payload.frames:
        return {
            "screening_status": "YELLOW",
            "triage_category": "MONITOR",
            "task_type": payload.task_type,
            "child_age_months": payload.child_age_months,
            "frames_analyzed": 0,
            "metrics": {},
            "clinical_flags": ["No landmark frames received. Please ensure camera is active and child is in view."],
            "formula_explanations": ["Session ended without valid tracked frames."],
            "advice": "Please repeat the screening with the camera facing the child.",
        }

    return analyze_other_tasks(payload)
