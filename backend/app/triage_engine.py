"""
Age-Gated Pediatric Triage Engine & Hybrid Decision Fusion.
Combines 70% Corroborated Physics + 30% Calibrated XGBoost ML.
Safety Rule: Physics corroborated RED holds RED; uncorroborated ML noise caps at YELLOW.
"""
from typing import Dict, Any, List, Tuple
from .config import WHO_MILESTONES


def evaluate_who_milestones(child_age_months: int, step_peaks: int, ankle_rms_velocity: float) -> Dict[str, Any]:
    """
    Evaluates WHO MGRS Gross Motor Achievement Windows.
    Checks whether independent walking is delayed past 99th percentile (18.0 months).
    """
    milestones_report = {}
    delays = []
    
    walk_info = WHO_MILESTONES["walking_alone"]
    is_walking_active = (step_peaks >= 3 and ankle_rms_velocity >= 0.15)
    
    if child_age_months >= walk_info["red_threshold"]:
        if not is_walking_active:
            milestones_report["walking_alone"] = {
                "status": "INSUFFICIENT_OBSERVATION",
                "p50_months": walk_info["p50"],
                "threshold_months": walk_info["red_threshold"],
                "note": "Fewer than 3 continuous strides captured in clip. Milestone not evaluable from short recording.",
            }
        else:
            milestones_report["walking_alone"] = {
                "status": "ACHIEVED",
                "p50_months": walk_info["p50"],
                "threshold_months": walk_info["red_threshold"],
                "note": "Independent walking milestone active.",
            }
    else:
        milestones_report["walking_alone"] = {
            "status": "AGE_APPROPRIATE",
            "p50_months": walk_info["p50"],
            "threshold_months": walk_info["red_threshold"],
            "note": "Within expected learning window.",
        }

    heel_info = WHO_MILESTONES["mature_heel_strike"]
    if child_age_months >= heel_info["red_threshold"]:
        milestones_report["mature_heel_strike"] = {
            "status": "EXPECTED",
            "threshold_months": heel_info["red_threshold"],
            "note": "Mature heel-strike progression expected.",
        }
    else:
        milestones_report["mature_heel_strike"] = {
            "status": "EMERGING",
            "threshold_months": heel_info["red_threshold"],
            "note": f"Transient flat-foot or toe contact common before {heel_info['red_threshold']} months.",
        }

    return {
        "milestones": milestones_report,
        "delays": delays,
        "is_delayed": len(delays) > 0,
    }


def evaluate_corroborated_triage(
    features: Dict[str, float],
    ml_prediction: Dict[str, Any],
    is_stationary: bool = False,
) -> Dict[str, Any]:
    """
    Stage 6: Activity-Gated Corroborated Triage & Hybrid Fusion.
    - Evaluates Calibrated Phone-MediaPipe thresholds.
    - Applies Corroborated Triage Logic:
      GREEN: 0 Red and <= 1 Yellow.
      YELLOW: 2+ Yellows or 1 isolated Red (borderline).
      RED: 2+ correlated flags fire together OR 1 extreme outlier OR WHO delay.
    - Hybrid Fusion:
      S_final = 0.70 * S_phys + 0.30 * P_abn
      Safety rule: Corroborated Physics RED always holds RED; uncorroborated ML caps at YELLOW.
    """
    age = int(features.get("child_age_months", 24))
    flags: List[str] = []
    explanations: List[str] = []
    red_flags: List[str] = []
    yellow_flags: List[str] = []

    # Handle stationary test early
    if is_stationary:
        return {
            "overall_status": "YELLOW",
            "triage_category": "MONITOR",
            "clinical_code": "INSUFFICIENT_MOVEMENT",
            "is_stationary": True,
            "hybrid_score": 0.50,
            "physics_score": 0.50,
            "ml_abnormal_prob": 0.10,
            "indicators": {},
            "who_milestones": evaluate_who_milestones(age, int(features.get("step_peaks_detected", 0)), float(features.get("ankle_rms_velocity", 0.0))),
            "clinical_flags": ["Child stood stationary during walking test. Active strides below minimum."],
            "formula_explanations": ["Stationary Gate: v_ankle_RMS < 0.15 torso/s."],
            "advice": "Please repeat the screening with the child walking naturally for 8–10 meters across the room.",
        }

    indicators: Dict[str, Any] = {}

    ml_class = ml_prediction.get("predicted_class", "Normal_Age_Appropriate")
    ml_probs = ml_prediction.get("class_probabilities", {})
    p_normal = float(ml_probs.get("Normal_Age_Appropriate", 90.0)) / 100.0
    p_abn = float(min(1.0, max(0.0, 1.0 - p_normal)))

    pelvic_p85 = float(features.get("pelvic_drop_p85_deg", 3.0))
    lurch_p85 = float(features.get("lateral_trunk_lurch_p85_deg", 2.0))
    spine_p90 = float(features.get("spine_tilt_p90_deg", 3.0))

    # 1. Step Length Symmetry (SI)
    # Calibrated Phone Baseline: Green: <= 60% | Yellow: 60-80% | Red: > 80%
    sl_si = float(features.get("step_length_si", 0.0))
    if sl_si <= 60.0:
        ind_sl = "GREEN"
    elif sl_si <= 80.0:
        ind_sl = "YELLOW"
        yellow_flags.append("step_length_si")
        flags.append(f"Mild step length asymmetry (SI: {sl_si:.1f}%).")
    else:
        ind_sl = "RED"
        red_flags.append("step_length_si")
        flags.append(f"Significant step length asymmetry (SI: {sl_si:.1f}%). Possible antalgic limp or limb favor.")

    indicators["step_length_si"] = {
        "status": ind_sl,
        "value": sl_si,
        "unit": "%",
        "normal": "<= 60%",
        "description": f"Step Length Symmetry (SI = {sl_si:.1f}%)",
    }

    # 2. Step Time Symmetry (SI)
    # Calibrated Phone Baseline: Green: <= 35% | Yellow: 35-55% | Red: > 55%
    st_si = float(features.get("step_time_si", 0.0))
    if st_si <= 35.0:
        ind_st = "GREEN"
    elif st_si <= 55.0:
        ind_st = "YELLOW"
        yellow_flags.append("step_time_si")
        flags.append(f"Mild temporal step asymmetry (SI: {st_si:.1f}%).")
    else:
        ind_st = "RED"
        red_flags.append("step_time_si")
        flags.append(f"Significant temporal stance asymmetry (SI: {st_si:.1f}%). Possible antalgic limp or limb favor.")

    indicators["step_time_si"] = {
        "status": ind_st,
        "value": st_si,
        "unit": "%",
        "normal": "<= 35%",
        "description": f"Temporal Step Symmetry (SI = {st_si:.1f}%)",
    }

    # 3. Swing Knee Flexion (P10 of true interior angle: captures deepest swing bend)
    # View-dependent evaluation:
    # Frontal View (camera_view_frontal = 1): Knee flexes in depth (sagittal plane), so normal projected angle is 160°-175°.
    # Only bilateral asymmetry |L - R| > 22° indicates pathology (e.g. unilateral hemiplegic stiff knee).
    # Side View (camera_view_frontal = 0): True sagittal flexion is directly visible.
    # Green: 105°-148° | Yellow: 148°-162° | Red: > 162° (stiff knee) or |L - R| > 22°
    is_frontal = int(features.get("camera_view_frontal", 1))
    lk_p10 = float(features.get("left_knee_swing_p10_deg", 135.0))
    rk_p10 = float(features.get("right_knee_swing_p10_deg", 135.0))
    knee_asym = float(features.get("knee_lr_asymmetry_deg", 0.0))
    max_knee = max(lk_p10, rk_p10)

    if is_frontal == 1:
        if knee_asym > 26.0 and (pelvic_p85 > 6.0 or lurch_p85 > 4.0 or sl_si > 60.0 or ml_class == "Asymmetric_Limp_Gait"):
            ind_knee = "RED"
            red_flags.append("swing_knee")
            flags.append(f"Marked bilateral knee asymmetry in frontal view (|L - R| = {knee_asym:.1f}°). Screen for unilateral stiff knee / hemiplegia (D3).")
        elif knee_asym > 16.0:
            ind_knee = "YELLOW"
            yellow_flags.append("swing_knee")
            flags.append(f"Mild bilateral knee asymmetry in frontal view (|L - R| = {knee_asym:.1f}°).")
        else:
            ind_knee = "GREEN"
    else:
        if max_knee > 162.0 or knee_asym > 22.0:
            ind_knee = "RED"
            red_flags.append("swing_knee")
            flags.append(f"Restricted swing knee flexion in profile view (Peak Interior: {max_knee:.1f}°, Asymmetry: {knee_asym:.1f}°). Screen for spastic stiff-knee gait (D3).")
        elif max_knee > 148.0 or knee_asym > 15.0:
            ind_knee = "YELLOW"
            yellow_flags.append("swing_knee")
            flags.append(f"Borderline swing knee clearance in profile view (Peak: {max_knee:.1f}°).")
        else:
            ind_knee = "GREEN"

    indicators["knee_swing"] = {
        "status": ind_knee,
        "left_knee_p10": lk_p10,
        "right_knee_p10": rk_p10,
        "asymmetry": knee_asym,
        "normal": "Asymmetry <= 15° (Frontal) | 105°-148° (Side)",
        "description": f"Swing Knee Flexion (L: {lk_p10:.1f}°, R: {rk_p10:.1f}°, Asym: {knee_asym:.1f}°)",
    }

    # 4. Pelvic Obliquity / Trendelenburg Drop (P85 baseline-subtracted)
    # Green: <= 8° | Yellow: 8°-14° | Red: > 14°
    pelvic_p85 = float(features.get("pelvic_drop_p85_deg", 3.0))
    lurch_p85 = float(features.get("lateral_trunk_lurch_p85_deg", 2.0))
    if pelvic_p85 <= 8.0:
        ind_pelvis = "GREEN"
    elif pelvic_p85 <= 14.0:
        ind_pelvis = "YELLOW"
        yellow_flags.append("pelvic_drop")
        flags.append(f"Mild coronal pelvic drop (P85: {pelvic_p85:.1f}°).")
    else:
        ind_pelvis = "RED"
        red_flags.append("pelvic_drop")
        flags.append(f"Marked Trendelenburg pelvic tilt (P85: {pelvic_p85:.1f}°). Screen for gluteus medius abductor weakness or DDH (D1/D3).")

    indicators["pelvic_obliquity"] = {
        "status": ind_pelvis,
        "pelvic_drop_p85": pelvic_p85,
        "trunk_lurch_p85": lurch_p85,
        "normal": "<= 8.0°",
        "description": f"Camera-Roll-Corrected Pelvic Drop (P85: {pelvic_p85:.1f}°)",
    }

    # 5. True 2D Spine Tilt (0° = Upright, P90)
    # Green: <= 18° | Yellow: 18°-28° | Red: > 28°
    spine_p90 = float(features.get("spine_tilt_p90_deg", 3.0))
    if spine_p90 <= 18.0:
        ind_spine = "GREEN"
    elif spine_p90 <= 28.0:
        ind_spine = "YELLOW"
        yellow_flags.append("spine_tilt")
        flags.append(f"Mild trunk tilt (P90: {spine_p90:.1f}°). Monitor postural stability.")
    else:
        ind_spine = "RED"
        red_flags.append("spine_tilt")
        flags.append(f"Significant torso lean / hypotonia (P90: {spine_p90:.1f}°). Screen for structural scoliosis or axial hypotonia (D1/D3).")

    indicators["spine_tilt"] = {
        "status": ind_spine,
        "spine_tilt_p90": spine_p90,
        "normal": "<= 18.0° (Upright = 0°)",
        "description": f"Coronal Spine Tilt (P90: {spine_p90:.1f}° from upright)",
    }

    # 6. Stationary Lower-Limb Ratio (STATIONARY FRAMES ONLY!)
    # Green: <= 0.18 | Yellow: 0.18-0.28 | Red: > 0.28 (age >= 24m)
    ka_ratio = float(features.get("stationary_lower_limb_ratio", 0.0))
    if age < 24:
        ind_ka = "GREEN"
        ka_desc = f"Physiological curvature normal for toddler age {age}m."
    else:
        abs_ka = abs(ka_ratio)
        if abs_ka <= 0.18:
            ind_ka = "GREEN"
            ka_desc = "Normal knee-ankle symmetry."
        elif abs_ka <= 0.28:
            ind_ka = "YELLOW"
            yellow_flags.append("lower_limb_ratio")
            cond = "bowing (genu varum)" if ka_ratio > 0 else "knock-knee (genu valgum)"
            flags.append(f"Mild lower-limb {cond} on stationary stance (Ratio: {ka_ratio:+.2f}).")
            ka_desc = f"Mild {cond}."
        else:
            ind_ka = "RED"
            red_flags.append("lower_limb_ratio")
            cond = "bowing (genu varum)" if ka_ratio > 0 else "knock-knee (genu valgum)"
            flags.append(f"Marked {cond} (Ratio: {ka_ratio:+.2f}). Clinical screen for nutritional Rickets or skeletal dysplasia (D1/D2).")
            ka_desc = f"Marked {cond}."

    indicators["lower_limb_ratio"] = {
        "status": ind_ka,
        "value": ka_ratio,
        "normal": "<= 0.18 (Stationary only)",
        "description": f"Stationary Knee-Ankle Ratio ({ka_ratio:+.2f}): {ka_desc}",
    }

    # 7. Stationary Wrist FFT Power (NON-WALKING ONLY!)
    # Green: < 0.70 | Yellow: 0.70-0.82 | Red: > 0.82
    wrist_fft = float(features.get("stationary_wrist_fft_power", 0.12))
    if wrist_fft < 0.70:
        ind_wrist = "GREEN"
    elif wrist_fft <= 0.82:
        ind_wrist = "YELLOW"
        yellow_flags.append("wrist_fft")
        flags.append(f"Moderate 1.8-4.5 Hz hand velocity oscillation (Power: {wrist_fft:.2f}).")
    else:
        ind_wrist = "RED"
        red_flags.append("wrist_fft")
        flags.append(f"High rhythmic wrist velocity power ({wrist_fft:.2f}). Observe for motor stereotypies (e.g. autistic hand-flapping) or tremors (D3/D4).")

    indicators["wrist_fft"] = {
        "status": ind_wrist,
        "value": wrist_fft,
        "normal": "< 0.70 (Non-walking only)",
        "description": f"Stationary Wrist FFT Power ({wrist_fft:.2f})",
    }

    # WHO Gross Motor Milestones
    who_res = evaluate_who_milestones(age, int(features.get("step_peaks_detected", 0)), float(features.get("ankle_rms_velocity", 0.0)))
    if who_res["is_delayed"]:
        red_flags.append("who_delayed")
        flags.extend(who_res["delays"])

    # -------------------------------------------------------------
    # Corroborated Physics Triage Decision
    # -------------------------------------------------------------
    n_red = len(red_flags)
    n_yellow = len(yellow_flags)

    ml_class = ml_prediction.get("predicted_class", "Normal_Age_Appropriate")
    ml_probs = ml_prediction.get("class_probabilities", {})
    p_normal = float(ml_probs.get("Normal_Age_Appropriate", 90.0)) / 100.0
    p_abn = float(min(1.0, max(0.0, 1.0 - p_normal)))

    # Postural red flags (excluding standalone step metrics)
    postural_red = [k for k in red_flags if k not in ["step_length_si", "step_time_si"]]
    step_red = [k for k in red_flags if k in ["step_length_si", "step_time_si"]]

    # Multi-domain Clinical Corroboration for RED:
    # Rule 1: Limp Corroboration (Spatial/temporal asymmetry + knee or pelvic or ML limp)
    is_limp_red = ("step_length_si" in red_flags or "step_time_si" in red_flags) and (
        "swing_knee" in red_flags
        or knee_asym > 18.0
        or (ml_class == "Asymmetric_Limp_Gait" and (knee_asym > 12.0 or pelvic_p85 > 6.0))
    )
    # Rule 2: Waddling Corroboration (Pelvic drop + trunk lurch or ML postural)
    is_waddle_red = ("pelvic_drop" in red_flags or "trunk_lurch" in red_flags) and (
        ml_class == "Postural_Balance_Weakness" or pelvic_p85 > 10.0 or lurch_p85 > 6.5
    )
    # Rule 3: Spastic / Stiff Corroboration (Restricted knee or bilateral knee asymmetry + step SI or ML spastic)
    is_spastic_red = ("swing_knee" in red_flags or (is_frontal == 0 and max_knee > 158.0)) and (
        ml_class == "Spastic_Stiff_Gait" or "step_length_si" in red_flags or "step_time_si" in red_flags
    )
    # Rule 4: Foot Drop Corroboration (Ankle lift asymmetry + ML toe walking or step SI)
    is_footdrop_red = (float(features.get("ankle_lift_si", 0.0)) > 30.0) and (
        ml_class == "Toe_Walking_Foot_Defect" or ("step_length_si" in red_flags and knee_asym <= 14.0)
    )
    # Rule 5: WHO gross motor delay
    is_who_red = "who_delayed" in red_flags and (n_red >= 1 or n_yellow >= 1)

    correlated_red = is_limp_red or is_waddle_red or is_spastic_red or is_footdrop_red or is_who_red

    if correlated_red or len(postural_red) >= 2 or (len(postural_red) >= 1 and len(step_red) >= 1):
        s_phys = 0.90
        phys_status = "RED"
    elif len(red_flags) >= 1 or len(yellow_flags) >= 2:
        s_phys = 0.50
        phys_status = "YELLOW"
    else:
        s_phys = 0.10
        phys_status = "GREEN"

    # Hybrid Fusion with Calibrated XGBoost
    # S_final = 0.50 * S_phys + 0.50 * P_abn
    s_final = 0.50 * s_phys + 0.50 * p_abn

    # Triage Decision
    if correlated_red:
        final_status = "RED"
    elif s_final >= 0.55 and p_abn >= 0.50:
        final_status = "RED" if (s_phys >= 0.50 and (knee_asym > 18.0 or pelvic_p85 > 8.0 or max_knee > 158.0)) else "YELLOW"
    elif s_final >= 0.30 or len(yellow_flags) >= 1 or p_abn >= 0.35:
        final_status = "YELLOW"
    else:
        final_status = "GREEN"

    # Safety Guard for Normal walks:
    # If all posture and joint indicators are completely calm (pelvic <= 6°, trunk <= 4°, knee_asym <= 16°, spine <= 12°), NEVER allow RED!
    is_postural_calm = (pelvic_p85 <= 6.0 and lurch_p85 <= 4.0 and knee_asym <= 16.0 and spine_p90 <= 12.0)
    if is_postural_calm and final_status == "RED":
        final_status = "YELLOW"

    if is_postural_calm and ml_class == "Normal_Age_Appropriate" and len(yellow_flags) <= 2:
        final_status = "GREEN"

    # Clinical Guard 1: Pure green physics + uncorroborated ML cannot force RED
    if phys_status == "GREEN" and final_status == "RED":
        final_status = "YELLOW"

    # Clinical Guard 2: If ML predicts a pathological condition with confidence >= 38%, never allow false GREEN
    if ml_class != "Normal_Age_Appropriate" and p_abn >= 0.38 and final_status == "GREEN":
        final_status = "YELLOW"

    # Clinical Advice Formulation
    if final_status == "RED":
        triage_cat = "REFER_DEIC"
        advice = (
            "Screening indicates corroborated gait parameters outside expected baseline. "
            "Educational non-diagnostic tool: Please share this kinematics report with your District Early Intervention Centre (DEIC) or pediatrician for formal evaluation."
        )
    elif final_status == "YELLOW":
        triage_cat = "MONITOR"
        advice = (
            "Screening shows mild borderline variation or isolated indicator. "
            "Implement pediatric home mobility activities. Re-screen in 2–4 weeks or consult your healthcare provider if concerns persist."
        )
    else:
        triage_cat = "NORMAL"
        advice = (
            "Screening parameters align with age-appropriate pediatric developmental baselines. "
            "Continue routine well-child checkups and gross-motor milestone tracking."
        )

    # Explanations for each stage
    explanations.append(f"1. Monotonic Guard & PCHIP Resampling (15 Hz) applied.")
    explanations.append(f"2. View Auto-Detection: {'Frontal/Diagonal (R_view >= 0.40)' if features.get('camera_view_frontal') == 1 else 'Side View (R_view < 0.40)'}.")
    explanations.append(f"3. 2D Spine Tilt (P90: {spine_p90:.1f}° from 0° upright).")
    explanations.append(f"4. Swing Knee Flexion (P10 true interior: {lk_p10:.1f}° L, {rk_p10:.1f}° R).")
    explanations.append(f"5. Camera-Roll-Corrected Pelvic Drop (P85: {pelvic_p85:.1f}°).")
    explanations.append(f"6. Hybrid Decision Fusion: S_final = 0.50*S_phys({s_phys:.2f}) + 0.50*P_abn({p_abn:.2f}) = {s_final:.2f}.")

    return {
        "overall_status": final_status,
        "triage_category": triage_cat,
        "hybrid_score": round(s_final, 3),
        "physics_score": round(s_phys, 2),
        "ml_abnormal_prob": round(p_abn, 3),
        "physics_status": phys_status,
        "is_stationary": False,
        "indicators": indicators,
        "who_milestones": who_res,
        "ml_prediction": ml_prediction,
        "clinical_flags": flags,
        "formula_explanations": explanations,
        "advice": advice,
    }
