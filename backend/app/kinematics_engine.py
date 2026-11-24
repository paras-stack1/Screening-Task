"""
Pediatric Kinematics Physics Engine.
Implements the 6-Stage View-Invariant Biomechanical Derivations:
- Auto-Detect Camera View Angle (Frontal/Diagonal vs Side)
- Metric World Coordinates & Orthonormal Anatomical Basis (e_up, e_lat, e_fwd)
- True Interior 3D Joint Angles (Straight = 180°, Deep Swing Bend = 105°–148°)
- True 2D Spine Tilt (0° = Upright)
- Camera-Roll-Corrected Pelvic Drop & Lateral Trunk Lurch (P85)
- Signed Forward Ankle Progression + Head-On Vertical Lift Symmetry
- Activity-Gated Feature Extraction (Stationary vs Walking separation)
"""
from typing import Dict, Any, Tuple, List, Optional
import numpy as np
from scipy import signal

from .config import FEATURE_COLUMNS


def compute_true_interior_angle(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    """
    True Interior Joint Angle theta_B in [0°, 180°].
    Straight joint = 180°.
    Uses metric poseWorldLandmarks.
    """
    u = a - b
    v = c - b
    norm_u = np.linalg.norm(u)
    norm_v = np.linalg.norm(v)
    if norm_u < 1e-6 or norm_v < 1e-6:
        return 180.0
    cosine = np.dot(u, v) / (norm_u * norm_v)
    cosine = np.clip(cosine, -1.0, 1.0)
    return float(np.degrees(np.arccos(cosine)))


def compute_true_spine_tilt_2d(s_mid_2d: np.ndarray, h_mid_2d: np.ndarray) -> float:
    """
    True Spine Tilt Angle theta_spine in [0°, 90°].
    Upright = 0°.
    Uses 2D screen (x, y) coordinates.
    Since screen y increases downward, upward vertical vector is (0, -1).
    theta_spine = atan2(|dx|, dy) * 180 / pi where dy = h_mid_y - s_mid_y > 0 when head is above hip.
    """
    dx = abs(float(s_mid_2d[0] - h_mid_2d[0]))
    dy = float(h_mid_2d[1] - s_mid_2d[1])  # Positive when shoulders are higher on screen
    if dy <= 1e-4:
        return 0.0
    ang = float(np.degrees(np.arctan2(dx, dy)))
    return max(0.0, min(90.0, ang))


def detect_camera_view_angle(coords_2d: np.ndarray) -> Tuple[int, float]:
    """
    Auto-Detect Camera View Angle.
    Ratio R_view = median(|x11 - x12|) / median(L_torso_2d).
    - R_view >= 0.40 -> Frontal / Diagonal View (1)
    - R_view < 0.40  -> Side View (0)
    """
    n_frames = coords_2d.shape[0]
    if n_frames == 0:
        return 1, 0.50

    shoulder_widths = []
    torso_lengths = []

    for t in range(n_frames):
        s_left = coords_2d[t, 11]
        s_right = coords_2d[t, 12]
        h_mid = (coords_2d[t, 23] + coords_2d[t, 24]) / 2.0
        s_mid = (s_left + s_right) / 2.0

        sw = float(np.abs(s_left[0] - s_right[0]))
        tl = float(np.linalg.norm(s_mid - h_mid))
        if tl > 1e-4:
            shoulder_widths.append(sw)
            torso_lengths.append(tl)

    med_sw = float(np.median(shoulder_widths)) if shoulder_widths else 0.20
    med_tl = float(np.median(torso_lengths)) if torso_lengths else 0.40
    r_view = med_sw / max(med_tl, 1e-4)

    is_frontal = 1 if r_view >= 0.40 else 0
    return is_frontal, round(r_view, 3)


def construct_orthonormal_body_basis(
    coords_world: np.ndarray,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """
    Stage 3: Metric World Coordinates & Orthonormal Anatomical Basis.
    - H_mid = (P23 + P24) / 2
    - S_mid = (P11 + P12) / 2
    - L_torso = ||S_mid - H_mid||_2
    - Normalized: P_tilde_i = (P_i - H_mid) / L_torso
    - Orthonormal axes:
      e_up = (S_tilde_mid - H_tilde_mid) / ||...||
      h_raw = P_tilde_24 - P_tilde_23
      e_lat = (h_raw - (h_raw . e_up) e_up) / ||...||
      e_fwd = e_up x e_lat
    """
    n_frames = coords_world.shape[0]
    norm_world = np.zeros_like(coords_world)
    torso_lens = np.zeros(n_frames, dtype=np.float32)
    e_up = np.zeros((n_frames, 3), dtype=np.float32)
    e_lat = np.zeros((n_frames, 3), dtype=np.float32)
    e_fwd = np.zeros((n_frames, 3), dtype=np.float32)

    for t in range(n_frames):
        pts = coords_world[t]
        h_mid = (pts[23] + pts[24]) / 2.0
        s_mid = (pts[11] + pts[12]) / 2.0

        l_torso = float(np.linalg.norm(s_mid - h_mid))
        if l_torso < 1e-4:
            l_torso = 1.0
        torso_lens[t] = l_torso

        # Shift to mid-hip origin and scale by torso length
        p_norm = (pts - h_mid) / l_torso
        norm_world[t] = p_norm

        # Up axis: points along spine from hip to shoulder
        up_vec = p_norm[11] + p_norm[12]  # since h_mid is origin (0, 0, 0)
        norm_up = np.linalg.norm(up_vec)
        up_ax = up_vec / norm_up if norm_up > 1e-4 else np.array([0.0, -1.0, 0.0], dtype=np.float32)

        # Lateral hip vector (from left hip 23 to right hip 24)
        h_raw = p_norm[24] - p_norm[23]
        # Gram-Schmidt orthogonalization against up_ax
        h_proj = h_raw - np.dot(h_raw, up_ax) * up_ax
        norm_lat = np.linalg.norm(h_proj)
        lat_ax = h_proj / norm_lat if norm_lat > 1e-4 else np.array([1.0, 0.0, 0.0], dtype=np.float32)

        # Forward progression axis = e_up x e_lat
        fwd_ax = np.cross(up_ax, lat_ax)
        norm_fwd = np.linalg.norm(fwd_ax)
        if norm_fwd > 1e-4:
            fwd_ax = fwd_ax / norm_fwd
        else:
            fwd_ax = np.array([0.0, 0.0, 1.0], dtype=np.float32)

        e_up[t] = up_ax
        e_lat[t] = lat_ax
        e_fwd[t] = fwd_ax

    return norm_world, torso_lens, e_up, e_lat, e_fwd


def segment_stationary_vs_walking(
    norm_world: np.ndarray,
    dt: float = 1.0 / 15.0,
) -> Tuple[np.ndarray, np.ndarray, float]:
    """
    Activity-Gated Segmentation:
    Computes instantaneous ankle speed in torso units / sec.
    - Stationary Frames: v_ankle < 0.15 torso/s
    - Walking Frames: v_ankle >= 0.15 torso/s
    Returns: (stationary_mask, walking_mask, v_ankle_rms)
    """
    n_frames = norm_world.shape[0]
    if n_frames < 2:
        return np.ones(n_frames, dtype=bool), np.zeros(n_frames, dtype=bool), 0.0

    # Ankle positions (left: 27, right: 28)
    v_l = np.linalg.norm(norm_world[1:, 27] - norm_world[:-1, 27], axis=1) / dt
    v_r = np.linalg.norm(norm_world[1:, 28] - norm_world[:-1, 28], axis=1) / dt
    v_both = 0.5 * (v_l + v_r)

    # Pad first frame
    v_profile = np.concatenate([[v_both[0]], v_both])
    v_ankle_rms = float(np.sqrt(np.mean(v_profile ** 2)))

    walking_mask = v_profile >= 0.15
    stationary_mask = ~walking_mask

    return stationary_mask, walking_mask, round(v_ankle_rms, 3)


def extract_14_calibrated_features(
    coords_world: np.ndarray,
    coords_2d: np.ndarray,
    norm_world: np.ndarray,
    torso_lens: np.ndarray,
    e_fwd: np.ndarray,
    stationary_mask: np.ndarray,
    walking_mask: np.ndarray,
    v_ankle_rms: float,
    child_age_months: int,
    is_frontal: int,
    fs: float = 15.0,
    include_step_features: bool = False,
) -> Dict[str, Any]:
    """
    Computes the 14 View-Invariant, Percentile-Stabilized Features:
    1. child_age_months
    2. camera_view_frontal
    3. step_length_si
    4. step_time_si
    5. ankle_lift_si
    6. ankle_rms_velocity
    7. pelvic_drop_p85_deg
    8. lateral_trunk_lurch_p85_deg
    9. left_knee_swing_p10_deg
    10. right_knee_swing_p10_deg
    11. knee_lr_asymmetry_deg
    12. spine_tilt_p90_deg
    13. stationary_lower_limb_ratio
    14. stationary_wrist_fft_power
    """
    n_frames = coords_world.shape[0]
    dt = 1.0 / fs
    walk_indices = np.where(walking_mask)[0]
    stat_indices = np.where(stationary_mask)[0]
    n_walk = len(walk_indices)

    # Edge Trimming: Discard first 10% and last 10% of active walking frames
    if n_walk >= 10:
        trim_start = int(0.10 * n_walk)
        trim_end = int(0.90 * n_walk)
        active_walk_idx = walk_indices[trim_start:trim_end]
    else:
        active_walk_idx = walk_indices

    # 1. True 2D Spine Tilt (Upright = 0°) across all valid frames
    spine_tilts = []
    for t in range(n_frames):
        s_mid = (coords_2d[t, 11] + coords_2d[t, 12]) / 2.0
        h_mid = (coords_2d[t, 23] + coords_2d[t, 24]) / 2.0
        tilt = compute_true_spine_tilt_2d(s_mid, h_mid)
        spine_tilts.append(tilt)
    spine_tilt_p90 = float(np.percentile(spine_tilts, 90)) if spine_tilts else 0.0

    # 2. Camera-Roll-Corrected Pelvic Drop & Lateral Trunk Lurch (P85 on Walking Frames)
    pelvic_drops = []
    trunk_lurches = []
    eval_indices = active_walk_idx if len(active_walk_idx) >= 4 else np.arange(n_frames)

    # Compute raw coronal hip angles theta_hip_raw(t) = atan2(y24 - y23, |x24 - x23|)
    raw_hip_angles = []
    raw_trunk_angles = []
    for t in range(n_frames):
        dy_hip = coords_2d[t, 24, 1] - coords_2d[t, 23, 1]
        dx_hip = abs(coords_2d[t, 24, 0] - coords_2d[t, 23, 0])
        raw_hip_angles.append(float(np.degrees(np.arctan2(dy_hip, max(dx_hip, 1e-4)))))

        s_mid = (coords_2d[t, 11] + coords_2d[t, 12]) / 2.0
        h_mid = (coords_2d[t, 23] + coords_2d[t, 24]) / 2.0
        dx_trunk = abs(s_mid[0] - h_mid[0])
        dy_trunk = abs(s_mid[1] - h_mid[1])
        raw_trunk_angles.append(float(np.degrees(np.arctan2(dx_trunk, max(dy_trunk, 1e-4)))))

    # Subtract median to cancel camera roll / tilt
    med_hip = float(np.median(raw_hip_angles)) if raw_hip_angles else 0.0
    med_trunk = float(np.median(raw_trunk_angles)) if raw_trunk_angles else 0.0

    for t in eval_indices:
        pelvic_drops.append(abs(raw_hip_angles[t] - med_hip))
        trunk_lurches.append(abs(raw_trunk_angles[t] - med_trunk))

    pelvic_drop_p85 = float(np.percentile(pelvic_drops, 85)) if pelvic_drops else 3.5
    trunk_lurch_p85 = float(np.percentile(trunk_lurches, 85)) if trunk_lurches else 2.5

    # 3. True Interior 3D Knee Swing Angles (P10 captures deepest swing bend)
    l_knee_angles = []
    r_knee_angles = []
    for t in eval_indices:
        lk = compute_true_interior_angle(coords_world[t, 23], coords_world[t, 25], coords_world[t, 27])
        rk = compute_true_interior_angle(coords_world[t, 24], coords_world[t, 26], coords_world[t, 28])
        l_knee_angles.append(lk)
        r_knee_angles.append(rk)

    l_knee_p10 = float(np.percentile(l_knee_angles, 10)) if l_knee_angles else 135.0
    r_knee_p10 = float(np.percentile(r_knee_angles, 10)) if r_knee_angles else 135.0
    knee_asym = abs(l_knee_p10 - r_knee_p10)

    # 4. View-Invariant Step Progression & Symmetry (Spatial & Temporal)
    # Signed forward ankle progression s_fwd(n) = (P_tilde_27 - P_tilde_28) . e_fwd
    s_fwd = np.array([
        np.dot(norm_world[t, 27] - norm_world[t, 28], e_fwd[t])
        for t in range(n_frames)
    ])

    # Frontal-view vertical lift backup signal:
    # h_L = y28 - y27 (positive when left foot lifts higher, since y is downward)
    # h_R = y27 - y28
    h_L = np.array([norm_world[t, 28, 1] - norm_world[t, 27, 1] for t in range(n_frames)])
    h_R = np.array([norm_world[t, 27, 1] - norm_world[t, 28, 1] for t in range(n_frames)])

    # Subtract median to remove baseline DC offset from body alignment / optical axis tilt
    s_fwd_detrend = s_fwd - float(np.median(s_fwd)) if len(s_fwd) > 0 else s_fwd
    h_L_detrend = h_L - float(np.median(h_L)) if len(h_L) > 0 else h_L

    # Peak detection for steps
    min_step_dist = max(2, int(0.25 * fs))  # at least 250 ms between steps
    peaks_fwd_L, _ = signal.find_peaks(s_fwd_detrend, prominence=0.05, distance=min_step_dist)
    peaks_fwd_R, _ = signal.find_peaks(-s_fwd_detrend, prominence=0.05, distance=min_step_dist)

    peaks_lift_L, _ = signal.find_peaks(h_L_detrend, prominence=0.05, distance=min_step_dist)
    peaks_lift_R, _ = signal.find_peaks(-h_L_detrend, prominence=0.05, distance=min_step_dist)

    # Ankle vertical lift symmetry %
    if len(peaks_lift_L) > 0 and len(peaks_lift_R) > 0:
        mean_lift_L = max(0.01, abs(float(np.median(h_L_detrend[peaks_lift_L]))))
        mean_lift_R = max(0.01, abs(float(np.median(-h_L_detrend[peaks_lift_R]))))
        ankle_lift_si = float(200.0 * abs(mean_lift_L - mean_lift_R) / (mean_lift_L + mean_lift_R))
    else:
        ankle_lift_si = 8.5  # default balanced baseline
    ankle_lift_si = min(100.0, max(0.0, ankle_lift_si))

    # Spatial Step Length Symmetry
    if len(peaks_fwd_L) > 0 and len(peaks_fwd_R) > 0:
        dL = max(0.02, abs(float(np.median(s_fwd_detrend[peaks_fwd_L]))))
        dR = max(0.02, abs(float(np.median(-s_fwd_detrend[peaks_fwd_R]))))
        if dL + dR >= 0.05:
            step_len_si = float(200.0 * abs(dL - dR) / (dL + dR))
        else:
            step_len_si = ankle_lift_si
    else:
        # Fallback to ankle lift SI if forward progression has fewer peaks (e.g. pure frontal)
        step_len_si = ankle_lift_si
    step_len_si = min(100.0, max(0.0, step_len_si))

    # Temporal Step Time Symmetry
    all_step_times = []
    for p in peaks_fwd_L:
        all_step_times.append((p * dt, "L"))
    for p in peaks_fwd_R:
        all_step_times.append((p * dt, "R"))
    all_step_times.sort(key=lambda x: x[0])

    dt_L_to_R = []
    dt_R_to_L = []
    for i in range(len(all_step_times) - 1):
        t1, side1 = all_step_times[i]
        t2, side2 = all_step_times[i + 1]
        dur = t2 - t1
        if 0.15 <= dur <= 1.5:
            if side1 == "L" and side2 == "R":
                dt_L_to_R.append(dur)
            elif side1 == "R" and side2 == "L":
                dt_R_to_L.append(dur)

    if dt_L_to_R and dt_R_to_L:
        med_lr = float(np.median(dt_L_to_R))
        med_rl = float(np.median(dt_R_to_L))
        step_time_si = float(200.0 * abs(med_lr - med_rl) / (med_lr + med_rl + 1e-6))
    else:
        step_time_si = 7.0  # default smooth baseline

    # 5. Stationary Lower-Limb Ratio (|x25 - x26| - |x27 - x28|) / L_torso (STATIONARY ONLY!)
    # Avoids false bowed-leg / rickets spikes during walking
    stat_ratios = []
    if len(stat_indices) > 0:
        for t in stat_indices:
            # Check if knees are relatively straight (> 155°)
            lk = compute_true_interior_angle(coords_world[t, 23], coords_world[t, 25], coords_world[t, 27])
            rk = compute_true_interior_angle(coords_world[t, 24], coords_world[t, 26], coords_world[t, 28])
            if lk > 155.0 and rk > 155.0:
                dx_knees = abs(coords_2d[t, 25, 0] - coords_2d[t, 26, 0])
                dx_ankles = abs(coords_2d[t, 27, 0] - coords_2d[t, 28, 0])
                tl = torso_lens[t] if torso_lens[t] > 0.05 else 0.40
                stat_ratios.append((dx_knees - dx_ankles) / tl)

    stationary_lower_limb_ratio = float(np.median(stat_ratios)) if stat_ratios else 0.0
    stationary_lower_limb_ratio = float(np.clip(stationary_lower_limb_ratio, -0.40, 0.40))

    # 6. Stationary Wrist FFT Power (1.8 - 4.5 Hz, NON-WALKING ONLY!)
    # Avoids normal reciprocal arm swing during walking
    wrist_y_stat = norm_world[stat_indices, 15, 1] if len(stat_indices) >= 16 else norm_world[:, 15, 1]
    if len(wrist_y_stat) >= 16:
        vy = np.diff(wrist_y_stat) / dt
        win = np.hanning(len(vy))
        fft_vals = np.abs(np.fft.rfft(vy * win)) ** 2
        freqs = np.fft.rfftfreq(len(vy), d=dt)

        band_mask = (freqs >= 1.8) & (freqs <= 4.5)
        total_mask = (freqs >= 0.5)
        band_p = float(np.sum(fft_vals[band_mask]))
        tot_p = float(np.sum(fft_vals[total_mask])) + 1e-6
        stat_wrist_fft = float(min(1.0, max(0.0, band_p / tot_p)))
    else:
        stat_wrist_fft = 0.12

    # Clamp and round to realistic precision
    bilateral_step_evidence = max(
        min(int(walking_mask[peaks_fwd_L].sum()), int(walking_mask[peaks_fwd_R].sum())),
        min(int(walking_mask[peaks_lift_L].sum()), int(walking_mask[peaks_lift_R].sum())),
    )
    features = {
        "child_age_months": float(child_age_months),
        "camera_view_frontal": float(is_frontal),
        "step_length_si": round(min(100.0, max(0.0, step_len_si)), 2),
        "step_time_si": round(min(100.0, max(0.0, step_time_si)), 2),
        "ankle_lift_si": round(min(100.0, max(0.0, ankle_lift_si)), 2),
        "ankle_rms_velocity": round(v_ankle_rms, 3),
        "pelvic_drop_p85_deg": round(min(45.0, max(0.0, pelvic_drop_p85)), 2),
        "lateral_trunk_lurch_p85_deg": round(min(45.0, max(0.0, trunk_lurch_p85)), 2),
        "left_knee_swing_p10_deg": round(min(180.0, max(60.0, l_knee_p10)), 1),
        "right_knee_swing_p10_deg": round(min(180.0, max(60.0, r_knee_p10)), 1),
        "knee_lr_asymmetry_deg": round(min(90.0, max(0.0, knee_asym)), 1),
        "spine_tilt_p90_deg": round(min(90.0, max(0.0, spine_tilt_p90)), 2),
        "stationary_lower_limb_ratio": round(stationary_lower_limb_ratio, 3),
        "stationary_wrist_fft_power": round(stat_wrist_fft, 3),
        # Diagnostic tracking counters
        "step_peaks_detected": max(len(peaks_fwd_L) + len(peaks_fwd_R), len(peaks_lift_L) + len(peaks_lift_R)),
        "total_active_walk_frames": len(active_walk_idx),
        "total_stationary_frames": len(stat_indices),
        "bilateral_step_evidence": bilateral_step_evidence,
    }
    if include_step_features:
        # An ankle lift peak is a swing proxy, not a measured foot contact.
        # Use it to look at foot orientation and pelvis position by side.
        hip = np.asarray(raw_hip_angles) - med_hip
        l_foot = norm_world[:, 31] - norm_world[:, 29]
        r_foot = norm_world[:, 32] - norm_world[:, 30]
        l_pitch = -l_foot[:, 1] / np.maximum(np.linalg.norm(l_foot, axis=1), 1e-4)
        r_pitch = -r_foot[:, 1] / np.maximum(np.linalg.norm(r_foot, axis=1), 1e-4)
        for side, peaks, pitch, toe, hip_id in (
            ("left", peaks_lift_L, l_pitch, 31, 23),
            ("right", peaks_lift_R, r_pitch, 32, 24),
        ):
            peaks = peaks[walking_mask[peaks]]
            toe_height = norm_world[:, hip_id, 1] - norm_world[:, toe, 1]
            toe_height -= np.median(toe_height)
            features[f"{side}_swing_toe_height"] = float(np.median(toe_height[peaks])) if len(peaks) else np.nan
            features[f"{side}_swing_foot_pitch"] = float(np.median(pitch[peaks])) if len(peaks) else np.nan
            features[f"{side}_swing_pelvic_tilt"] = float(np.median(hip[peaks])) if len(peaks) else np.nan
        features["pelvic_tilt_range"] = float(np.percentile(hip, 90) - np.percentile(hip, 10))
    return features
