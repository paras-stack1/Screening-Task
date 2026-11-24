"""
Video Landmark Biomechanical Analyzer for Child Health Screening Across the 4Ds:
1. Defects at birth (congenital hip dysplasia, club foot, structural scoliosis)
2. Deficiencies (Rickets / lower-limb bowing, stunting)
3. Diseases (Cerebral palsy spasticity, neuromuscular dystrophies, ataxias)
4. Development delays & disabilities (gross motor milestones, autism orienting latency, stereotypies)

Privacy-First:
Zero video is stored or transmitted. Analyzes normalized MediaPipe coordinate streams.
"""

from typing import List, Dict, Optional, Any
from pydantic import BaseModel, Field
import numpy as np


class Landmark(BaseModel):
    x: float
    y: float
    z: float
    visibility: float = 1.0


class FaceMetrics(BaseModel):
    head_yaw: Optional[float] = None
    iris_center_ratio: Optional[float] = None
    face_detected: Optional[bool] = True


class FrameData(BaseModel):
    timestamp_ms: int
    pose_world_landmarks: List[Dict[str, float]]
    face_metrics: Optional[Dict[str, Any]] = None


class VideoLandmarkPayload(BaseModel):
    child_age_months: int = Field(default=24, ge=1, le=216)
    task_type: str = Field(
        default="walking_gait",
        description="One of: walking_gait, sitting_posture, standing_alignment, balance_sway, social_response",
    )
    fps: float = Field(default=10.0, ge=1.0, le=60.0)
    audio_cue_timestamp_sec: Optional[float] = 3.0
    frames: List[FrameData]


def compute_3d_angle(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    """Computes angle at joint B given 3D vectors A, B, C in degrees."""
    u = a - b
    v = c - b
    norm_u = np.linalg.norm(u)
    norm_v = np.linalg.norm(v)
    if norm_u < 1e-6 or norm_v < 1e-6:
        return 180.0
    cosine = np.dot(u, v) / (norm_u * norm_v)
    cosine = np.clip(cosine, -1.0, 1.0)
    return float(np.degrees(np.arccos(cosine)))


def normalize_landmarks_frame(landmarks: List[Dict[str, float]]) -> Optional[tuple[np.ndarray, float]]:
    """
    Stage 1 Invariant Normalization:
    - Origin shift: Subtract Mid-Hip H_mid = (P23 + P24) / 2
    - Scale normalization: Divide by Torso Length L_torso = ||S_mid - H_mid||
    Returns (normalized_33x3_array, torso_length) or None if invalid.
    """
    if len(landmarks) < 33:
        return None

    pts = np.array([[lm.get("x", 0.0), lm.get("y", 0.0), lm.get("z", 0.0)] for lm in landmarks[:33]], dtype=np.float32)

    # 11: left_shoulder, 12: right_shoulder, 23: left_hip, 24: right_hip
    s_mid = (pts[11] + pts[12]) / 2.0
    h_mid = (pts[23] + pts[24]) / 2.0

    torso_vec = s_mid - h_mid
    l_torso = float(np.linalg.norm(torso_vec))
    if l_torso < 1e-4:
        l_torso = 1.0

    norm_pts = (pts - h_mid) / l_torso
    return norm_pts, l_torso


def analyze_video_landmarks(payload: VideoLandmarkPayload) -> Dict[str, Any]:
    """
    Executes Stage 1 Normalization and Stage 2 Biomechanical & Time-Series calculations.
    Returns structured pediatric screening report.
    """
    frames = payload.frames
    fps = payload.fps if payload.fps > 0 else 10.0
    task_type = payload.task_type
    age = payload.child_age_months

    if not frames:
        return {
            "screening_status": "YELLOW",
            "task_type": task_type,
            "child_age_months": age,
            "frames_analyzed": 0,
            "metrics": {},
            "clinical_flags": ["No landmark frames received. Please ensure camera is enabled and child is visible."],
            "formula_explanations": ["Session ended without valid tracked frames."],
            "advice": "Please repeat the screening in a well-lit room with the child clearly visible in the camera frame.",
        }

    # Normalize all valid frames
    norm_frames: List[np.ndarray] = []
    torso_lengths: List[float] = []
    face_metrics_list: List[Dict[str, Any]] = []
    timestamps_sec: List[float] = []

    for f in frames:
        res = normalize_landmarks_frame(f.pose_world_landmarks)
        if res is not None:
            norm_pts, l_torso = res
            norm_frames.append(norm_pts)
            torso_lengths.append(l_torso)
            timestamps_sec.append(f.timestamp_ms / 1000.0)
            face_metrics_list.append(f.face_metrics or {})

    n_frames = len(norm_frames)
    if n_frames < 5:
        return {
            "screening_status": "YELLOW",
            "task_type": task_type,
            "child_age_months": age,
            "frames_analyzed": n_frames,
            "metrics": {},
            "clinical_flags": ["Insufficient tracking frames. Full body could not be sustained in camera view."],
            "formula_explanations": ["At least 5 tracked frames required for time-series analysis."],
            "advice": "Please reposition the camera to capture the child from head to ankles and try again.",
        }

    spine_tilts = []
    left_knee_angles = []
    right_knee_angles = []
    ankle_separations = []
    hip_mid_x = []
    wrist_y_left = []
    wrist_y_right = []
    knee_dists = []
    ankle_dists = []

    for pts in norm_frames:
        # S_mid and H_mid in normalized coords
        # H_mid is at (0, 0, 0)
        s_mid = (pts[11] + pts[12]) / 2.0
        v_torso = s_mid  # s_mid - (0,0,0)
        v_norm = np.linalg.norm(v_torso)
        if v_norm > 1e-6:
            # Angle relative to vertical (y-axis)
            tilt = np.degrees(np.arccos(np.clip(abs(v_torso[1]) / v_norm, -1.0, 1.0)))
            spine_tilts.append(tilt)

        # Knee angles (23: hip, 25: knee, 27: ankle / 24, 26, 28)
        lk_angle = compute_3d_angle(pts[23], pts[25], pts[27])
        rk_angle = compute_3d_angle(pts[24], pts[26], pts[28])
        left_knee_angles.append(lk_angle)
        right_knee_angles.append(rk_angle)

        # Ankle separation: x27 - x28
        ankle_separations.append(pts[27, 0] - pts[28, 0])

        # Hip mid X
        h_mid_x = (pts[23, 0] + pts[24, 0]) / 2.0
        hip_mid_x.append(h_mid_x)

        # Wrists Y (15: left wrist, 16: right wrist)
        wrist_y_left.append(pts[15, 1])
        wrist_y_right.append(pts[16, 1])

        # Lower limb alignment: distance between knees (25, 26) and ankles (27, 28)
        # Only when knees are relatively straight (>140 deg)
        if lk_angle > 140.0 and rk_angle > 140.0:
            k_dist = abs(pts[25, 0] - pts[26, 0])
            a_dist = abs(pts[27, 0] - pts[28, 0])
            knee_dists.append(k_dist)
            ankle_dists.append(a_dist)

    mean_spine_tilt = float(np.mean(spine_tilts)) if spine_tilts else 0.0
    mean_lk = float(np.mean(left_knee_angles)) if left_knee_angles else 170.0
    mean_rk = float(np.mean(right_knee_angles)) if right_knee_angles else 170.0
    sway_std = float(np.std(hip_mid_x)) if hip_mid_x else 0.0

    # 1. Gait Symmetry Index (GSI)
    gsi = 1.0
    if len(ankle_separations) >= 8:
        sep_arr = np.array(ankle_separations)
        # Detrend or zero-center
        centered_sep = sep_arr - np.mean(sep_arr)
        pos_vals = centered_sep[centered_sep > 0.02]
        neg_vals = np.abs(centered_sep[centered_sep < -0.02])

        if len(pos_vals) > 0 and len(neg_vals) > 0:
            # Look for 80th percentile stride excursions
            p_step = np.percentile(pos_vals, 80)
            n_step = np.percentile(neg_vals, 80)
            gsi = float(min(p_step, n_step) / (max(p_step, n_step) + 1e-6))
            gsi = round(min(1.0, max(0.0, gsi)), 3)
        else:
            gsi = 0.92  # Fallback smooth baseline if stationary

    # 2. Lower-Limb Alignment Ratio
    knee_ankle_ratio = 0.0
    if knee_dists and ankle_dists:
        mean_k = np.mean(knee_dists)
        mean_a = np.mean(ankle_dists)
        # Positive = knees further apart than ankles (Bowed legs / Varum)
        # Negative = ankles further apart than knees (Knock knees / Valgum)
        knee_ankle_ratio = round(float(mean_k - mean_a), 3)

    # 3. FFT on Wrist Velocity for Tremor / Stereotypies
    wrist_oscillation_hz = 0.0
    rhythmic_tremor_flag = False
    if len(wrist_y_left) >= 16:
        v_wrist = np.diff(np.array(wrist_y_left))
        n_v = len(v_wrist)
        fft_vals = np.abs(np.fft.rfft(v_wrist))
        freqs = np.fft.rfftfreq(n_v, d=1.0 / fps)

        # Target band 1.5 - 4.5 Hz
        band_mask = (freqs >= 1.5) & (freqs <= 4.5)
        if np.any(band_mask):
            band_fft = fft_vals[band_mask]
            band_freqs = freqs[band_mask]
            max_idx = np.argmax(band_fft)
            peak_power = band_fft[max_idx]
            total_power = np.sum(fft_vals) + 1e-6

            if (peak_power / total_power) > 0.32 and np.std(v_wrist) > 0.015:
                wrist_oscillation_hz = round(float(band_freqs[max_idx]), 2)
                rhythmic_tremor_flag = True
            else:
                wrist_oscillation_hz = round(float(band_freqs[max_idx]), 2) if len(band_freqs) else 0.0

    # 4. Social & Autism Cues
    head_yaws = []
    eye_contact_count = 0
    total_face_frames = 0
    audio_cue_sec = payload.audio_cue_timestamp_sec or 3.0
    cue_turn_detected = False
    response_latency_sec = 0.0

    for i, fm in enumerate(face_metrics_list):
        yaw = fm.get("head_yaw")
        iris_ratio = fm.get("iris_center_ratio")
        detected = fm.get("face_detected", True)

        if detected and yaw is not None:
            head_yaws.append((timestamps_sec[i], float(yaw)))
            total_face_frames += 1

            # Eye contact check: head nearly straight (|yaw| < 0.15 rad ~ 8.5 deg) and iris near center
            if abs(float(yaw)) < 0.15:
                if iris_ratio is None or (0.35 <= float(iris_ratio) <= 0.65):
                    eye_contact_count += 1

    eye_contact_pct = round((eye_contact_count / total_face_frames * 100.0), 1) if total_face_frames > 0 else 70.0

    # Response to name latency
    if head_yaws:
        pre_cue_yaws = [y for (t, y) in head_yaws if t < audio_cue_sec]
        base_yaw = float(np.mean(pre_cue_yaws)) if pre_cue_yaws else head_yaws[0][1]

        post_cue_turns = [(t, y) for (t, y) in head_yaws if t >= audio_cue_sec]
        for t, y in post_cue_turns:
            if abs(y - base_yaw) > 0.18:  # ~10.3 degrees rotation
                response_latency_sec = round(float(t - audio_cue_sec), 2)
                cue_turn_detected = True
                break

        if not cue_turn_detected and post_cue_turns:
            response_latency_sec = round(float(post_cue_turns[-1][0] - audio_cue_sec), 2)

    # Classify against clinical baselines
    status_levels = []
    clinical_flags: List[str] = []
    explanations: List[str] = []

    # A. Spine Tilt check
    if mean_spine_tilt <= 12.0:
        status_levels.append("GREEN")
        explanations.append(f"Spine Tilt ({mean_spine_tilt:.1f}° <= 12.0° baseline): Normal upright trunk alignment.")
    elif mean_spine_tilt <= 22.0:
        status_levels.append("YELLOW")
        explanations.append(f"Spine Tilt ({mean_spine_tilt:.1f}° in 12.0°–22.0° range): Mild trunk inclination / postural asymmetry.")
        clinical_flags.append("Mild trunk lean or postural asymmetry observed. Monitor sitting and standing posture.")
    else:
        status_levels.append("RED")
        explanations.append(f"Spine Tilt ({mean_spine_tilt:.1f}° > 22.0° baseline): Marked torso lean or trunk hypotonia.")
        clinical_flags.append("Significant spinal or postural tilt detected. Screen for structural scoliosis or axial hypotonia (D1/D3).")

    # B. Task-Specific Checks
    if task_type == "walking_gait":
        if gsi >= 0.85:
            status_levels.append("GREEN")
            explanations.append(f"Gait Symmetry Index (GSI = {gsi:.2f} >= 0.85 baseline): Left and right strides are symmetrical.")
        elif gsi >= 0.70:
            status_levels.append("YELLOW")
            explanations.append(f"Gait Symmetry Index (GSI = {gsi:.2f} in 0.70–0.84): Mild asymmetric stride or transient favor of one leg.")
            clinical_flags.append("Mild gait asymmetry observed. Observe for transient favor or mild fatigue.")
        else:
            status_levels.append("RED")
            explanations.append(f"Gait Symmetry Index (GSI = {gsi:.2f} < 0.70 baseline): Pronounced stride asymmetry.")
            clinical_flags.append("Marked gait asymmetry detected. Potential antalgic limp, mild hemiplegia/CP, or hip dysplasia (D1/D3).")

    elif task_type == "standing_alignment":
        abs_ratio = abs(knee_ankle_ratio)
        if age > 24:
            if abs_ratio <= 0.15:
                status_levels.append("GREEN")
                explanations.append(f"Lower-Limb Alignment ({knee_ankle_ratio:+.2f} within ±0.15 baseline): Balanced knee-ankle spacing.")
            elif abs_ratio <= 0.25:
                status_levels.append("YELLOW")
                cond = "Genu Varum (bowed legs)" if knee_ankle_ratio > 0 else "Genu Valgum (knock knees)"
                explanations.append(f"Lower-Limb Alignment ({knee_ankle_ratio:+.2f}): Mild {cond}.")
                clinical_flags.append(f"Mild lower-extremity curvature ({cond}). Check nutritional vitamin D intake (D2).")
            else:
                status_levels.append("RED")
                cond = "Marked Genu Varum (bow legs)" if knee_ankle_ratio > 0 else "Marked Genu Valgum (knock knees)"
                explanations.append(f"Lower-Limb Alignment ({knee_ankle_ratio:+.2f} exceeds ±0.25 threshold): {cond}.")
                clinical_flags.append(f"Prominent lower-limb bowing ({cond}). Screen for nutritional Rickets or skeletal dysplasia (D1/D2).")
        else:
            status_levels.append("GREEN")
            explanations.append(f"Lower-Limb Alignment ({knee_ankle_ratio:+.2f}): Normal physiological variation for age <= 24 months.")

    elif task_type == "balance_sway":
        if sway_std <= 0.04:
            status_levels.append("GREEN")
            explanations.append(f"Balance Sway (σ = {sway_std:.3f} <= 0.04 baseline): Stable center-of-mass control.")
        elif sway_std <= 0.08:
            status_levels.append("YELLOW")
            explanations.append(f"Balance Sway (σ = {sway_std:.3f} in 0.04–0.08 range): Moderate postural sway.")
            clinical_flags.append("Moderate balance oscillation. Normal during early toddler years; retest when well rested.")
        else:
            status_levels.append("RED")
            explanations.append(f"Balance Sway (σ = {sway_std:.3f} > 0.08 baseline): Pronounced postural instability.")
            clinical_flags.append("High center-of-mass sway detected. Screen for vestibular imbalance or motor coordination ataxia (D3/D4).")

    elif task_type == "social_response":
        # Latency check
        if cue_turn_detected:
            if response_latency_sec <= 2.0:
                status_levels.append("GREEN")
                explanations.append(f"Response to Name Latency ({response_latency_sec:.1f}s <= 2.0s baseline): Prompt auditory orientation.")
            elif response_latency_sec <= 4.0:
                status_levels.append("YELLOW")
                explanations.append(f"Response to Name Latency ({response_latency_sec:.1f}s in 2.0s–4.0s range): Delayed head turn response.")
                clinical_flags.append("Delayed auditory orienting response. Observe environmental distractions.")
            else:
                status_levels.append("RED")
                explanations.append(f"Response to Name Latency ({response_latency_sec:.1f}s > 4.0s baseline): Very delayed head turn.")
                clinical_flags.append("Significantly delayed auditory orientation (>4.0s). Screen hearing or social communication flags (D4).")
        else:
            status_levels.append("RED")
            explanations.append(f"Response to Name: No noticeable head turn detected after cue timestamp ({audio_cue_sec:.1f}s).")
            clinical_flags.append("No orientation to auditory name prompt detected. Rule out hearing impairment or early ASD markers (D4).")

        # Eye contact check
        if eye_contact_pct >= 50.0:
            status_levels.append("GREEN")
            explanations.append(f"Eye Contact ({eye_contact_pct:.1f}% >= 50.0% baseline): Sustained social engagement.")
        elif eye_contact_pct >= 25.0:
            status_levels.append("YELLOW")
            explanations.append(f"Eye Contact ({eye_contact_pct:.1f}% in 25%–49% range): Moderate visual engagement.")
        else:
            status_levels.append("RED")
            explanations.append(f"Eye Contact ({eye_contact_pct:.1f}% < 25.0% baseline): Minimal central eye contact.")
            clinical_flags.append("Low sustained camera engagement. Early developmental indicator to monitor with pediatrician (D4).")

    # Tremor / repetitive stereotypy flag
    if rhythmic_tremor_flag:
        status_levels.append("YELLOW")
        explanations.append(f"Wrist Oscillation ({wrist_oscillation_hz:.1f} Hz in 1.5–4.5 Hz band): Rhythmic hand velocity pattern detected.")
        clinical_flags.append(f"Rhythmic wrist motion detected at {wrist_oscillation_hz:.1f} Hz. Observe for motor stereotypies (e.g., hand flapping) or tremors (D3/D4).")

    # Overall Status Aggregation
    if "RED" in status_levels:
        final_status = "RED"
        advice = (
            "Screening indicates movement or developmental parameters outside standard baseline. "
            "This is a non-diagnostic screening tool. Share these telemetry readings with your pediatrician for clinical evaluation."
        )
    elif "YELLOW" in status_levels:
        final_status = "YELLOW"
        advice = (
            "Screening indicates mild movement variations or borderline parameters. "
            "Ensure the child is well rested and comfortable. Repeat the screening or discuss with a healthcare professional."
        )
    else:
        final_status = "GREEN"
        advice = (
            "Screening parameters align with standard age-gated pediatric developmental baselines. "
            "Educational prototype: Continue routine well-child checkups with your pediatrician."
        )

    metrics = {
        "gait_symmetry_index": gsi,
        "mean_spine_tilt_deg": round(mean_spine_tilt, 1),
        "mean_left_knee_deg": round(mean_lk, 1),
        "mean_right_knee_deg": round(mean_rk, 1),
        "knee_ankle_ratio": knee_ankle_ratio,
        "sway_std": round(sway_std, 3),
        "wrist_oscillation_hz": wrist_oscillation_hz,
        "eye_contact_pct": eye_contact_pct,
        "response_latency_sec": response_latency_sec,
    }

    return {
        "screening_status": final_status,
        "task_type": task_type,
        "child_age_months": age,
        "frames_analyzed": n_frames,
        "metrics": metrics,
        "clinical_flags": clinical_flags,
        "formula_explanations": explanations,
        "advice": advice,
    }
