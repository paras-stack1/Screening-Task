"""
Signal Filtering, Monotonic Guard, PCHIP Uniform Resampling & Butterworth Smoothing.
Enforces strictly continuous time-series, eliminates browser time-jitter and video loop resets.
"""
from typing import List, Tuple, Any, Optional
import numpy as np
from scipy import signal
from scipy.interpolate import PchipInterpolator

# Critical lower limb & pelvic landmarks: hips (23, 24), knees (25, 26), ankles (27, 28)
KEY_LOWER_LIMBS = [23, 24, 25, 26, 27, 28]
KEY_SHOULDERS = [11, 12]
CORE_LANDMARKS = KEY_LOWER_LIMBS + KEY_SHOULDERS


def filter_monotonic_and_visibility(
    frames: List[Any],
    min_vis: float = 0.50,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray, int]:
    """
    Stage 1A: Monotonic Guard & Landmark Extraction.
    - Discards any frame where timestamp is non-monotonic (t_k <= t_{k-1}), fixing the 6-loop bug.
    - Checks visibility on hips, knees, ankles.
    - Returns:
      - raw_coords_world: (N_valid, 33, 3) in real-world metric coordinates
      - raw_coords_2d: (N_valid, 33, 2) in screen [0, 1] coordinates
      - timestamps_sec: (N_valid,) strictly increasing
      - dropped_non_monotonic_count: int
    """
    valid_world = []
    valid_2d = []
    valid_times = []
    dropped_non_monotonic = 0
    last_t = -1.0

    for f in frames:
        # Extract timestamp
        t_raw = getattr(f, "timestamp_ms", None)
        if t_raw is None and isinstance(f, dict):
            t_raw = f.get("timestamp_ms", 0)
        t_sec = float(t_raw) / 1000.0

        # Monotonic check
        if t_sec <= last_t:
            dropped_non_monotonic += 1
            continue

        # Extract 3D World Landmarks (real-world metric coords)
        wlms = getattr(f, "pose_world_landmarks", None)
        if wlms is None and isinstance(f, dict):
            wlms = f.get("pose_world_landmarks")

        # Extract 2D Screen Landmarks (for robust spine tilt & view ratio)
        lms_2d = getattr(f, "pose_landmarks_2d", None)
        if lms_2d is None and isinstance(f, dict):
            lms_2d = f.get("pose_landmarks_2d")
        if lms_2d is None:
            # Fallback to world landmarks if 2D was not separately provided
            lms_2d = wlms

        if not wlms or len(wlms) < 33:
            continue

        # Check if wlms is in metric meter space (centered around hip with negative head y)
        # while our dataset-calibrated model was trained on normalized [0, 1] screen landmarks with depth
        is_metric_meters = any(
            (lm.get("y", 0.0) if isinstance(lm, dict) else getattr(lm, "y", 0.0)) < 0.0
            for lm in wlms[:15]
        )
        if is_metric_meters and lms_2d and len(lms_2d) >= 33:
            wlms = lms_2d

        # Visibility check on critical lower limb landmarks
        vis_ok = True
        for idx in KEY_LOWER_LIMBS:
            lm = wlms[idx]
            v = lm.get("visibility", 1.0) if isinstance(lm, dict) else getattr(lm, "visibility", 1.0)
            if v < min_vis:
                vis_ok = False
                break

        # Allow frame if at least 4 of 6 lower limb landmarks meet visibility
        if not vis_ok:
            passed_count = sum(
                1 for idx in KEY_LOWER_LIMBS
                if (wlms[idx].get("visibility", 1.0) if isinstance(wlms[idx], dict) else getattr(wlms[idx], "visibility", 1.0)) >= min_vis
            )
            if passed_count < 4:
                continue

        # Collect 33x3 world coords
        w_pts = np.zeros((33, 3), dtype=np.float32)
        for j in range(33):
            lm = wlms[j]
            w_pts[j, 0] = lm.get("x", 0.0) if isinstance(lm, dict) else getattr(lm, "x", 0.0)
            w_pts[j, 1] = lm.get("y", 0.0) if isinstance(lm, dict) else getattr(lm, "y", 0.0)
            w_pts[j, 2] = lm.get("z", 0.0) if isinstance(lm, dict) else getattr(lm, "z", 0.0)

        # Collect 33x2 screen coords
        s_pts = np.zeros((33, 2), dtype=np.float32)
        if lms_2d and len(lms_2d) >= 33:
            for j in range(33):
                lm = lms_2d[j]
                s_pts[j, 0] = lm.get("x", 0.0) if isinstance(lm, dict) else getattr(lm, "x", 0.0)
                s_pts[j, 1] = lm.get("y", 0.0) if isinstance(lm, dict) else getattr(lm, "y", 0.0)
        else:
            s_pts = w_pts[:, :2]

        valid_world.append(w_pts)
        valid_2d.append(s_pts)
        valid_times.append(t_sec)
        last_t = t_sec

    if len(valid_times) == 0:
        return (
            np.zeros((0, 33, 3), dtype=np.float32),
            np.zeros((0, 33, 2), dtype=np.float32),
            np.zeros((0,), dtype=np.float32),
            dropped_non_monotonic,
        )

    return (
        np.array(valid_world, dtype=np.float32),
        np.array(valid_2d, dtype=np.float32),
        np.array(valid_times, dtype=np.float32),
        dropped_non_monotonic,
    )


def pchip_uniform_resampling(
    coords_world: np.ndarray,
    coords_2d: np.ndarray,
    timestamps_sec: np.ndarray,
    fs: float = 15.0,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Stage 1B: Piecewise Cubic Hermite Interpolation (PCHIP) Resampling.
    Resamples non-uniform browser timestamps (48–116 ms intervals) onto a strictly
    uniform time grid t_n = t_0 + n / fs.
    Unlike standard cubic splines, PCHIP is shape-preserving and NEVER overshoots.
    """
    n_frames = len(timestamps_sec)
    if n_frames < 4:
        return coords_world, coords_2d, timestamps_sec

    t_start = timestamps_sec[0]
    t_end = timestamps_sec[-1]
    duration = t_end - t_start

    if duration < 0.2:
        return coords_world, coords_2d, timestamps_sec

    # Uniform time grid
    dt = 1.0 / fs
    uniform_times = np.arange(t_start, t_end, dt)
    n_uniform = len(uniform_times)

    if n_uniform < 4:
        return coords_world, coords_2d, timestamps_sec

    resampled_world = np.zeros((n_uniform, 33, 3), dtype=np.float32)
    resampled_2d = np.zeros((n_uniform, 33, 2), dtype=np.float32)

    # Resample World Coordinates
    for j in range(33):
        for d in range(3):
            y_arr = coords_world[:, j, d]
            try:
                pchip = PchipInterpolator(timestamps_sec, y_arr, extrapolate=True)
                resampled_world[:, j, d] = pchip(uniform_times)
            except Exception:
                resampled_world[:, j, d] = np.interp(uniform_times, timestamps_sec, y_arr)

    # Resample 2D Screen Coordinates
    for j in range(33):
        for d in range(2):
            y_arr = coords_2d[:, j, d]
            try:
                pchip = PchipInterpolator(timestamps_sec, y_arr, extrapolate=True)
                resampled_2d[:, j, d] = pchip(uniform_times)
            except Exception:
                resampled_2d[:, j, d] = np.interp(uniform_times, timestamps_sec, y_arr)

    return resampled_world, resampled_2d, uniform_times


def butterworth_zero_lag_filter_15hz(
    coords_world: np.ndarray,
    fs: float = 15.0,
    fc: float = 3.5,
) -> np.ndarray:
    """
    Stage 2: Backend Zero-Lag Butterworth Low-Pass Filter.
    At verified uniform rate fs = 15.0 Hz (Nyquist f_N = 7.5 Hz),
    pediatric walking cadence (1.5-2.5 steps/s) harmonics live below 3.5 Hz.
    Forward and backward 2nd-order filter via filtfilt (effective 4th-order, zero phase lag).
    Normalized cutoff Wn = 3.5 / 7.5 = 0.4667.
    """
    n_frames = coords_world.shape[0]
    if n_frames < 10:
        return coords_world

    nyquist = 0.5 * fs
    wn = min(0.95, fc / nyquist)

    try:
        b, a = signal.butter(2, wn, btype="low", analog=False)
        padlen = min(12, n_frames - 2)
        filtered = signal.filtfilt(b, a, coords_world, axis=0, padlen=padlen)
        return filtered.astype(np.float32)
    except Exception as e:
        print(f"Filter fallback warning: {e}")
        return coords_world
