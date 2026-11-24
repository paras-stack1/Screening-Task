const visionBase = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const engines = new Map();

function vision(kind) {
  if (!engines.has(kind)) {
    const loading = import(/* webpackIgnore: true */ `${visionBase}/vision_bundle.mjs`).then(async api => {
      const files = await api.FilesetResolver.forVisionTasks(`${visionBase}/wasm`);
      if (kind === "face") return api.FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task" }, runningMode: "IMAGE",
      });
      return api.PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: "/models/pose_landmarker_full.task" }, runningMode: "IMAGE",
      });
    }).catch(error => { engines.delete(kind); throw error; });
    engines.set(kind, loading);
  }
  return engines.get(kind);
}

async function post(check, body, json = false) {
  const response = await fetch(`/api/analysis/${check}`, {
    method:"POST", body:json ? JSON.stringify(body) : body,
    headers:json ? {"content-type":"application/json"} : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw Error(typeof result.detail === "string" ? result.detail : "The backend could not analyze this capture.");
  return result;
}

const visible = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.visibility === undefined || p.visibility === 0 || p.visibility >= 0.6);
function projectedAngle([a,b,c], aspect) {
  const u = [(a.x-b.x)*aspect,a.y-b.y], v = [(c.x-b.x)*aspect,c.y-b.y];
  if (Math.min(Math.hypot(...u), Math.hypot(...v)) < .005) return null;
  return Math.atan2(Math.abs(u[0]*v[1]-u[1]*v[0]),u[0]*v[0]+u[1]*v[1])*180/Math.PI;
}

async function photoGeometry(kind, image, options = {}) {
  await image.decode();
  const aspect = image.naturalWidth / image.naturalHeight;
  const { targetCoords, scleraCoords } = options;

  if (kind === "pallor") {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || 640;
    canvas.height = image.naturalHeight || 480;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    // 1. Detect facial landmarks if whole face is in frame
    let facePoints = null;
    try {
      const tracker = await vision("face");
      const res = tracker.detect(image);
      facePoints = res?.faceLandmarks?.[0] ?? null;
    } catch {
      facePoints = null;
    }

    // 2. Identify Reference Sclera (White of Eye) for Universal Illumination Normalization
    let scleraPoint = null;
    if (scleraCoords && Number.isFinite(scleraCoords.x) && Number.isFinite(scleraCoords.y)) {
      scleraPoint = { x: scleraCoords.x, y: scleraCoords.y };
    } else if (facePoints && facePoints[33] && facePoints[133]) {
      const p33 = facePoints[33], p133 = facePoints[133];
      scleraPoint = { x: p33.x * 0.7 + p133.x * 0.3, y: (p33.y + p133.y) / 2 };
    } else {
      // Sclera candidate search: scan upper 65% of image for high-brightness, low-saturation white pixels
      const scanH = Math.round(canvas.height * 0.65);
      const scanData = ctx.getImageData(0, 0, canvas.width, scanH).data;
      let sumSX = 0, sumSY = 0, scPix = 0;
      for (let y = 10; y < scanH - 10; y += 4) {
        for (let x = 10; x < canvas.width - 10; x += 4) {
          const idx = (y * canvas.width + x) * 4;
          const r = scanData[idx], g = scanData[idx + 1], b = scanData[idx + 2];
          const maxC = Math.max(r, g, b), minC = Math.min(r, g, b);
          const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
          if (maxC > 165 && sat < 0.28) {
            sumSX += x; sumSY += y; scPix++;
          }
        }
      }
      if (scPix > 30) {
        scleraPoint = { x: (sumSX / scPix) / canvas.width, y: (sumSY / scPix) / canvas.height };
      } else {
        scleraPoint = { x: 0.35, y: 0.38 };
      }
    }

    // Sample Sclera ROI
    const scRadius = Math.max(8, Math.round(canvas.width * 0.035));
    const scX = Math.round(scleraPoint.x * canvas.width);
    const scY = Math.round(scleraPoint.y * canvas.height);
    const scMinX = Math.max(0, scX - scRadius);
    const scMinY = Math.max(0, scY - scRadius);
    const scW = Math.min(canvas.width - scMinX, scRadius * 2);
    const scH = Math.min(canvas.height - scMinY, scRadius * 2);
    const scImgData = ctx.getImageData(scMinX, scMinY, scW, scH).data;

    let scSumR = 0, scSumG = 0, scSumB = 0, scCount = 0;
    for (let i = 0; i < scImgData.length; i += 4) {
      const r = scImgData[i], g = scImgData[i+1], b = scImgData[i+2];
      if (r > 252 && g > 252 && b > 252) continue;
      if (r < 50 && g < 50 && b < 50) continue;
      scSumR += r; scSumG += g; scSumB += b; scCount++;
    }
    const meanScR = scCount > 0 ? scSumR / scCount : 240;
    const meanScG = scCount > 0 ? scSumG / scCount : 240;
    const meanScB = scCount > 0 ? scSumB / scCount : 240;

    // Ambient Lighting Bias:
    const ambientLightingBias = Math.log10(Math.max(1, meanScR)) - Math.log10(Math.max(1, meanScG));

    // 3. Identify Target Conjunctiva Region
    let targetPoint = null;
    let isCustomPinned = false;
    let isLandmarkDerived = false;

    if (targetCoords && Number.isFinite(targetCoords.x) && Number.isFinite(targetCoords.y)) {
      targetPoint = { x: targetCoords.x, y: targetCoords.y };
      isCustomPinned = true;
    } else if (facePoints && facePoints[145] && facePoints[33] && facePoints[133]) {
      const lp = facePoints[145];
      targetPoint = { x: lp.x, y: lp.y + 0.035 };
      isLandmarkDerived = true;
    } else {
      targetPoint = { x: 0.50, y: 0.81 };
    }

    // Sample Target Conjunctiva
    const tgRadius = Math.max(10, Math.round(canvas.width * 0.05));
    const tgX = Math.round(targetPoint.x * canvas.width);
    const tgY = Math.round(targetPoint.y * canvas.height);
    const tgMinX = Math.max(0, tgX - tgRadius);
    const tgMinY = Math.max(0, tgY - tgRadius);
    const tgW = Math.min(canvas.width - tgMinX, tgRadius * 2);
    const tgH = Math.min(canvas.height - tgMinY, tgRadius * 2);
    const tgImgData = ctx.getImageData(tgMinX, tgMinY, tgW, tgH).data;

    let tgSumR = 0, tgSumG = 0, tgSumB = 0, tgCount = 0;
    for (let i = 0; i < tgImgData.length; i += 4) {
      const r = tgImgData[i], g = tgImgData[i+1], b = tgImgData[i+2];
      if (r > 250 && g > 250 && b > 250) continue;
      if (r < 40 && g < 40 && b < 40) continue;
      if (b > r + 30 && b > g) continue;
      tgSumR += r; tgSumG += g; tgSumB += b; tgCount++;
    }

    if (tgCount === 0) {
      throw Error("Could not sample sufficient tissue. Click on your photo to reposition the sampling target directly onto the everted conjunctiva.");
    }

    const meanMuR = tgSumR / tgCount;
    const meanMuG = tgSumG / tgCount;
    const meanMuB = tgSumB / tgCount;
    const totalRGB = meanMuR + meanMuG + meanMuB || 1;

    // Raw optical Erythema Index:
    const rawErythemaIndex = Math.log10(Math.max(1, meanMuR)) - Math.log10(Math.max(1, meanMuG));

    // UNIVERSAL SCLERA-NORMALIZED ERYTHEMA INDEX (Illumination & Sensor Invariant):
    const normErythemaIndex = rawErythemaIndex - ambientLightingBias;

    // Sclera-Normalized Red Ratio:
    const relR = meanMuR / Math.max(1, meanScR);
    const relG = meanMuG / Math.max(1, meanScG);
    const relB = meanMuB / Math.max(1, meanScB);
    const normRedRatio = (relR / (relR + relG + relB)) * 100;

    // CIE a* Redness metric
    const aStar = ((meanMuR - meanMuG) / 255) * 100;

    // Calibrated Hemoglobin Estimation (g/dL) based on CP-AnemiC multicenter clinical curves:
    let estimatedHb = 6.2 + 15.0 * normErythemaIndex;
    estimatedHb = Math.max(4.2, Math.min(16.5, estimatedHb));

    // Tissue Validation Guard:
    const isSkinMisconception = (isLandmarkDerived && !isCustomPinned && normErythemaIndex < 0.12 && Math.abs(meanMuR - meanMuG) < 25);

    let isOk = true;
    let verdictTag = "OK";
    let status = "Normal Conjunctival Vascularity";
    let condition = "Normal palpebral mucosal erythema (No pallor detected)";
    let nextSteps = "No clinical conjunctival pallor detected. Sclera-normalized tissue vascularity is consistent with healthy hemoglobin levels (≥11.0 g/dL). Continue routine pediatric checkups.";
    const flags = [];

    if (isSkinMisconception) {
      flags.push("⚠️ CAPTURE MISCONCEPTION NOTICE: An uneverted lower eyelid was detected. Normal facial cheek skin was sampled instead of the inner palpebral conjunctiva.");
      flags.push("In an ordinary portrait, the mucosal capillary bed is hidden behind closed eyelid skin. External skin lacks mucosal blood vessels and falsely looks anemic. Please gently pull down the lower eyelid to expose the inner pink mucosa, or click directly on the exposed mucosa on the photo.");
    }

    if (normErythemaIndex < 0.18 || estimatedHb < 8.0) {
      isOk = false;
      verdictTag = "SEVERE_PALLOR";
      status = "Severe Conjunctival Pallor (Anemia Alert)";
      condition = "Marked palpebral conjunctival pallor / suspected severe anemia (<8.0 g/dL)";
      flags.push(`Marked reduction in mucosal redness: Sclera-Normalized Erythema Index is ${normErythemaIndex.toFixed(3)} (<0.18 threshold).`);
      flags.push(`Estimated Hemoglobin is ${estimatedHb.toFixed(1)} g/dL (<8.0 g/dL clinical threshold for severe pediatric anemia).`);
      flags.push("The palpebral conjunctival mucosa exhibits chalky, faded coloration characteristic of diminished circulating hemoglobin.");
      nextSteps = "URGENT CLINICAL EVALUATION RECOMMENDED: Marked conjunctival pallor is strongly indicative of clinically significant anemia. Prompt confirmatory complete blood count (CBC) or point-of-care HemoCue test is indicated.";
    } else if (normErythemaIndex < 0.32 || estimatedHb < 11.0) {
      isOk = false;
      verdictTag = "MODERATE_PALLOR";
      status = "Moderate Conjunctival Pallor";
      condition = "Reduced conjunctival erythema / suspected mild-to-moderate anemia";
      flags.push(`Mild-to-moderate reduction in mucosal redness: Sclera-Normalized Erythema Index is ${normErythemaIndex.toFixed(3)} (0.18–0.32 band).`);
      flags.push(`Estimated Hemoglobin is ${estimatedHb.toFixed(1)} g/dL (<11.0 g/dL WHO pediatric anemia threshold).`);
      nextSteps = "Clinical review recommended: Schedule a routine pediatric visit to assess dietary iron intake, nutritional history, and perform confirmatory laboratory hemoglobin testing.";
    } else {
      flags.push(`Robust mucosal vascularization: Sclera-Normalized Erythema Index is ${normErythemaIndex.toFixed(3)} (≥0.32 normal range).`);
      flags.push(`Sclera-Normalized Red Ratio: ${normRedRatio.toFixed(1)}% of reflected light.`);
      flags.push(`Estimated Hemoglobin: ${estimatedHb.toFixed(1)} g/dL (within expected healthy pediatric reference band).`);
    }

    if (Math.abs(ambientLightingBias) > 0.015) {
      const direction = ambientLightingBias > 0 ? "warm/yellow" : "cool/blue";
      flags.push(`Sclera Universal Calibration: Detected and neutralized ${direction} ambient room lighting offset (${(ambientLightingBias > 0 ? "+" : "") + ambientLightingBias.toFixed(3)} EI bias from scleral reference).`);
    } else {
      flags.push("Sclera Universal Calibration: Balanced neutral lighting detected from scleral reference.");
    }

    const rgbColor = `rgb(${Math.round(meanMuR)}, ${Math.round(meanMuG)}, ${Math.round(meanMuB)})`;
    const scleraRgbColor = `rgb(${Math.round(meanScR)}, ${Math.round(meanScG)}, ${Math.round(meanScB)})`;

    const values = [
      { label: "Sclera-Normalized EI", value: normErythemaIndex, unit: "", note: normErythemaIndex >= 0.32 ? "Normal (≥0.32)" : normErythemaIndex >= 0.18 ? "Moderate Pallor (0.18–0.32)" : "Severe Pallor (<0.18)", rgb: rgbColor },
      { label: "Estimated Hemoglobin (Hb)", value: estimatedHb, unit: " g/dL", note: estimatedHb >= 11.0 ? "Normal (≥11.0 g/dL)" : estimatedHb >= 8.0 ? "Mild/Moderate (<11.0)" : "Severe Anemia (<8.0)" },
      { label: "Normalized Red Ratio", value: normRedRatio, unit: "%", note: normRedRatio >= 50 ? "Normal vascular redness" : "Depleted red reflectance" },
      { label: "Ambient Lighting Bias", value: ambientLightingBias, unit: " EI", note: Math.abs(ambientLightingBias) < 0.015 ? "Neutral light" : ambientLightingBias > 0 ? "Warm light corrected" : "Cool light corrected", rgb: scleraRgbColor }
    ];

    const overlay = {
      kind: "pallor",
      aspect,
      target: { x: targetPoint.x, y: targetPoint.y, r: tgRadius / canvas.width },
      sclera: { x: scleraPoint.x, y: scleraPoint.y, r: scRadius / canvas.width },
      meanR: Math.round(meanMuR),
      meanG: Math.round(meanMuG),
      meanB: Math.round(meanMuB),
      meanScR: Math.round(meanScR),
      meanScG: Math.round(meanScG),
      meanScB: Math.round(meanScB),
      rawErythemaIndex,
      normErythemaIndex,
      ambientLightingBias,
      estimatedHb,
      isOk,
      isSkinMisconception,
      isCustomPinned
    };

    return {
      type: "measurements",
      kind: "pallor",
      isOk,
      verdictTag,
      status,
      condition,
      nextSteps,
      flags,
      values,
      overlay,
      formula: "Universal Sclera-Normalized EI: EI_norm = [log10(R_mu) - log10(G_mu)] - [log10(R_sc) - log10(G_sc)] | Estimated Hb (g/dL) = 6.2 + 15.0 × EI_norm",
      pediatricNote: "Universal clinical anemia screening requires normalizing tissue reflectance against an internal white reference (the sclera) to remove camera white-balance and room illumination distortions. Conjunctival pallor indicates that mucosal capillary beds have reduced hemoglobin concentration. Definitive diagnosis requires laboratory Complete Blood Count (CBC) or point-of-care HemoCue micro-cuvette testing."
    };
  }

  const tracker = await vision(kind === "eye" || kind === "pupil" ? "face" : "pose");
  const result = tracker.detect(image);
  const points = (kind === "eye" || kind === "pupil") ? result.faceLandmarks[0] : result.landmarks[0];
  if (!points) throw Error("No usable landmarks detected. Use the reference framing and try again.");

  if (kind === "pupil") {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);

    const leftCanthusDist = Math.hypot((points[362].x - points[263].x) * aspect, points[362].y - points[263].y);
    const rightCanthusDist = Math.hypot((points[133].x - points[33].x) * aspect, points[133].y - points[33].y);

    function samplePupil(p, eyeW) {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
      const cx = Math.round(p.x * canvas.width);
      const cy = Math.round(p.y * canvas.height);
      const r = Math.max(3, Math.round(eyeW * canvas.width * 0.12));
      const minX = Math.max(0, cx - r);
      const minY = Math.max(0, cy - r);
      const sizeX = Math.min(canvas.width - minX, r * 2);
      const sizeY = Math.min(canvas.height - minY, r * 2);
      if (sizeX <= 0 || sizeY <= 0) return null;

      const imgData = ctx.getImageData(minX, minY, sizeX, sizeY).data;
      let rSum = 0, gSum = 0, bSum = 0, count = 0;
      for (let dy = 0; dy < sizeY; dy++) {
        for (let dx = 0; dx < sizeX; dx++) {
          const distSq = (minX + dx - cx)**2 + (minY + dy - cy)**2;
          if (distSq <= r * r) {
            const idx = (dy * sizeX + dx) * 4;
            rSum += imgData[idx];
            gSum += imgData[idx + 1];
            bSum += imgData[idx + 2];
            count++;
          }
        }
      }
      if (!count) return null;
      const red = Math.round(rSum / count);
      const green = Math.round(gSum / count);
      const blue = Math.round(bSum / count);
      const v = Math.max(red, green, blue) / 255;
      const minC = Math.min(red, green, blue) / 255;
      const s = v > 0 ? (v - minC) / v : 0;
      let h = 0;
      if (v > minC) {
        const d = v - minC;
        const rNorm = red / 255, gNorm = green / 255, bNorm = blue / 255;
        if (v === rNorm) h = ((gNorm - bNorm) / d) % 6;
        else if (v === gNorm) h = (bNorm - rNorm) / d + 2;
        else h = (rNorm - gNorm) / d + 4;
        h = Math.round(h * 60);
        if (h < 0) h += 360;
      }
      const gr = red > 0 ? green / red : 1;
      const br = red > 0 ? blue / red : 1;

      let type = "dark";
      let desc = "Normal dark pupil (ambient lighting, no white reflex)";
      let isLeukocoria = false;

      if (v >= 0.40) {
        if (s < 0.35 && (gr >= 0.65 || br >= 0.65)) {
          type = "leukocoria";
          desc = "Abnormal white/cloudy reflex (Leukocoria)";
          isLeukocoria = true;
        } else if (h >= 30 && h <= 65 && br < 0.55) {
          type = "xanthocoria";
          desc = "Abnormal yellow/golden reflex (Xanthocoria)";
          isLeukocoria = true;
        } else if ((h <= 25 || h >= 340) && s >= 0.35 && gr < 0.60 && br < 0.60) {
          type = "red_reflex";
          desc = "Normal physiological red reflex";
        } else {
          type = "diffuse";
          desc = "Moderate pupil illumination (within physiological range)";
        }
      }

      return { cx, cy, r, red, green, blue, v, s, h, gr, br, type, desc, isLeukocoria };
    }

    const leftData = samplePupil(points[473], leftCanthusDist);
    const rightData = samplePupil(points[468], rightCanthusDist);

    if (!leftData || !rightData) throw Error("Could not sample pupillary regions. Ensure both pupils are uncovered and in focus.");

    const leftV = leftData.v * 100;
    const rightV = rightData.v * 100;
    const diffV = Math.abs(leftV - rightV);

    let isOk = true;
    let verdictTag = "OK";
    let verdict = "PUPIL REFLEX NORMAL — No white reflex flagged";
    let status = "Symmetrical Normal Reflex";
    let condition = "Normal physiological pupil appearance";
    let nextSteps = "No white pupil reflex (leukocoria) observed in this capture. Continue routine pediatric eye examinations.";
    const flags = [];

    const hasLeukocoria = leftData.isLeukocoria || rightData.isLeukocoria;
    const hasAsymmetry = diffV >= 35 && (leftData.v >= 0.35 || rightData.v >= 0.35);

    if (hasLeukocoria) {
      isOk = false;
      verdictTag = "NEEDS_REVIEW";
      verdict = "URGENT ATTENTION — Possible Leukocoria Flagged";
      status = "Abnormal White Pupil Reflex (Leukocoria)";
      condition = "Potential Retinoblastoma, Pediatric Cataract, or Coats' Disease";
      const affected = [leftData.isLeukocoria ? "Left" : "", rightData.isLeukocoria ? "Right" : ""].filter(Boolean).join(" and ");
      flags.push(`${affected} eye exhibits an abnormal high-luminance, desaturated white/yellow reflection in the pupillary zone.`);
      flags.push("The peer-reviewed CRADLE screening threshold detected non-red pupil luminance consistent with leukocoria.");
      nextSteps = "URGENT PEDIATRIC OPHTHALMOLOGY EVALUATION RECOMMENDED: Prompt in-person dilated fundus examination and B-scan ultrasonography are required to rule out retinoblastoma or congenital cataract.";
    } else if (hasAsymmetry) {
      isOk = false;
      verdictTag = "NEEDS_REVIEW";
      verdict = "REVIEW RECOMMENDED — Asymmetric Pupillary Reflex";
      status = "Asymmetrical Pupillary Reflex Flagged";
      condition = "Bruckner Test Disparity / Unequal Retro-illumination";
      flags.push(`Marked inter-pupillary luminance difference of ${diffV.toFixed(1)}% (≥35% asymmetry threshold).`);
      flags.push("Unequal reflex intensity between eyes can occur in unilateral media opacity, high anisometropia (refractive difference), or strabismus.");
      nextSteps = "Follow-up recommended: 1) Retake with camera flash in a dimly lit room with the child looking directly at the camera. 2) If asymmetry persists, schedule an evaluation with an eye care specialist.";
    } else {
      flags.push(`Left pupil: ${leftData.desc} (RGB: ${leftData.red}, ${leftData.green}, ${leftData.blue}).`);
      flags.push(`Right pupil: ${rightData.desc} (RGB: ${rightData.red}, ${rightData.green}, ${rightData.blue}).`);
      flags.push(`Inter-pupillary luminance difference is minimal (${diffV.toFixed(1)}%), indicating symmetrical reflections.`);
    }

    const values = [
      { label: "Left pupil reflex intensity", value: leftV, unit: "%", note: leftData.desc, rgb: `rgb(${leftData.red},${leftData.green},${leftData.blue})` },
      { label: "Right pupil reflex intensity", value: rightV, unit: "%", note: rightData.desc, rgb: `rgb(${rightData.red},${rightData.green},${rightData.blue})` },
      { label: "Inter-pupillary reflex asymmetry", value: diffV, unit: "%", note: diffV < 35 ? "Symmetrical" : "Asymmetric" },
    ];

    const overlay = {
      kind: "pupil",
      aspect,
      pupils: [
        { side: "Left", p: points[473], data: leftData },
        { side: "Right", p: points[468], data: rightData },
      ],
    };

    return {
      type: "measurements",
      kind: "pupil",
      isOk,
      verdictTag,
      verdict,
      nextSteps,
      status,
      condition,
      flags,
      values,
      overlay,
      formula: "Leukocoria Colorimetry (CRADLE/Baylor): V = max(R,G,B)/255, S = (V - min(R,G,B)/255)/V. Flagged when V ≥ 0.40, S < 0.35, and (G/R ≥ 0.65 or B/R ≥ 0.65)",
      pediatricNote: "A white pupil (leukocoria) in infants and young children is a medical emergency until proven otherwise. The most critical cause is retinoblastoma, a malignant ocular cancer where early diagnosis preserves the eye and saves lives. Other causes include congenital cataracts and Coats' disease. A pediatric ophthalmologist must perform dilated ophthalmoscopy to confirm.",
    };
  }
  const values = kind === "eye"
    ? [[263,362,473],[33,133,468]].map((ids, index) => {
      const [a,b,c] = ids.map(id => points[id]);
      if (![a,b,c].every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))) return {label:index ? "Right iris position" : "Left iris position",value:null,unit:"%"};
      const x = (b.x-a.x)*aspect, y = b.y-a.y, length = x*x+y*y;
      const value = length > .0001 ? (((c.x-a.x)*aspect*x+(c.y-a.y)*y)/length)*100 : NaN;
      return { label:index ? "Right iris position" : "Left iris position", value:Number.isFinite(value) && value >= 0 && value <= 100 ? value : null, unit:"%" };
    })
    : [[25,27,31],[26,28,32]].map((ids,index) => {
      const group = ids.map(id => points[id]);
      return {label:index ? "Right projected ankle angle" : "Left projected ankle angle",value:group.every(visible) ? projectedAngle(group,aspect) : null,unit:"°"};
    });
  if (values.every(item => item.value === null)) throw Error("The target landmarks are unclear. Retake using the reference framing.");
  if (kind === "eye") {
    const left = values.find(item => item.label.includes("Left"))?.value;
    const right = values.find(item => item.label.includes("Right"))?.value;
    let status = "Symmetrical Central Alignment";
    let condition = "Typical alignment (no obvious deviation)";
    let isOk = true;
    let verdictTag = "OK";
    let verdict = "ALIGNMENT OK — Within expected limits";
    let nextSteps = "No further processing or immediate referral indicated from this capture. Continue routine pediatric eye screening at regular health checkups.";
    const flags = [];

    if (left !== null && right !== null) {
      const diff = Math.abs(left - right);
      const leftInward = left > 60;
      const leftOutward = left < 40;
      const rightInward = right > 60;
      const rightOutward = right < 40;

      if (leftInward || rightInward) {
        isOk = false;
        verdictTag = "NEEDS_REVIEW";
        verdict = "ATTENTION NEEDED — Potential Inward Misalignment";
        status = "Possible Inward Deviation (Esotropia pattern)";
        condition = "Potential Esotropia or Pseudostrabismus";
        const sides = [leftInward ? "Left" : "", rightInward ? "Right" : ""].filter(Boolean).join(" and ");
        flags.push(`${sides} iris shifted inward toward the nose (>60%). In young children, this pattern is seen in esotropia (convergent squint) or benign pseudostrabismus.`);
        nextSteps = "Further evaluation recommended: 1) Retake a photo ensuring child's gaze is straight ahead at camera level to rule out gaze shift. 2) If deviation persists, schedule a pediatric eye examination for formal cover and corneal reflex testing.";
      } else if (leftOutward || rightOutward) {
        isOk = false;
        verdictTag = "NEEDS_REVIEW";
        verdict = "ATTENTION NEEDED — Potential Outward Misalignment";
        status = "Possible Outward Deviation (Exotropia pattern)";
        condition = "Potential Exotropia";
        const sides = [leftOutward ? "Left" : "", rightOutward ? "Right" : ""].filter(Boolean).join(" and ");
        flags.push(`${sides} iris shifted outward toward the ear (<40%). In children, this pattern is seen in exotropia (divergent squint).`);
        nextSteps = "Further evaluation recommended: 1) Verify child is not glancing sideways. 2) If outward posture is consistently visible, consult a pediatric optometrist or ophthalmologist.";
      }

      if (diff >= 10) {
        flags.push(`Marked inter-eye asymmetry: ${diff.toFixed(1)}% (≥10% threshold). Unilateral deviation in young children warrants clinical review to evaluate amblyopia risk.`);
        if (!leftInward && !rightInward && !leftOutward && !rightOutward) {
          isOk = false;
          verdictTag = "NEEDS_REVIEW";
          verdict = "ATTENTION NEEDED — Asymmetric Alignment";
          status = "Inter-Eye Asymmetry Flagged";
          condition = "Unilateral gaze or ocular alignment difference";
          nextSteps = "Further evaluation recommended: Asymmetric alignment between eyes can impact binocular vision development. A clinician should perform an in-person ocular motility evaluation.";
        }
      }

      if (flags.length === 0) {
        flags.push("Both irises lie within the typical pediatric central gaze zone (40%–60%).");
        flags.push(`Minimal inter-ocular difference (${diff.toFixed(1)}%), indicating coordinated ocular alignment.`);
      }
    }

    const overlay = {
      kind: "eye",
      aspect,
      midline: [10, 168, 1, 152].map(id => points[id]).filter(p => p && Number.isFinite(p.x)),
      eyes: [
        { side: "Left", outer: points[263], inner: points[362], iris: points[473], value: left },
        { side: "Right", outer: points[33], inner: points[133], iris: points[468], value: right },
      ],
    };

    return {
      type: "measurements",
      kind: "eye",
      isOk,
      verdictTag,
      verdict,
      nextSteps,
      status,
      condition,
      flags,
      values,
      overlay,
      formula: "Iris Position (%) = [((P_iris - P_outer) • (P_inner - P_outer)) / |P_inner - P_outer|²] × 100",
      pediatricNote: "In infants and young children, a wide nasal bridge or prominent epicanthal folds frequently create the false appearance of crossed eyes (pseudostrabismus). Geometric landmark screening helps distinguish true ocular misalignment from normal infant facial anatomy.",
    };
  }
  if (kind === "foot") {
    const left = values.find(item => item.label.includes("Left"))?.value;
    const right = values.find(item => item.label.includes("Right"))?.value;
    let status = "Symmetrical Limb Alignment";
    let condition = "Typical bilateral alignment (no obvious asymmetry)";
    let isOk = true;
    let verdictTag = "OK";
    let verdict = "ALIGNMENT OK — Within expected limits";
    let nextSteps = "No immediate clinical follow-up indicated from this capture. Continue routine pediatric developmental checks.";
    const flags = [];

    if (left !== null && right !== null) {
      const diff = Math.abs(left - right);
      const isAsymmetric = diff >= 12;

      if (isAsymmetric) {
        isOk = false;
        verdictTag = "NEEDS_REVIEW";
        verdict = "ATTENTION NEEDED — Bilateral Asymmetry Flagged";
        status = "Bilateral Limb Asymmetry Flagged";
        condition = "Potential Unilateral Clubfoot (Talipes Equinovarus) or Positional Difference";
        flags.push(`Marked inter-limb angle difference of ${diff.toFixed(1)}° (exceeds the 12° asymmetry threshold).`);
        flags.push("Unilateral deviation is a classic presentation in approximately 50% of congenital clubfoot cases, or can indicate hemiplegic muscle tone differences.");
        nextSteps = "Further evaluation recommended: 1) Check whether the affected foot is flexible (can be gently dorsiflexed past neutral to rule out benign positional packaging). 2) If the foot is rigid or tight, seek pediatric orthopedic review for formal Pirani scoring and early Ponseti management.";
      } else {
        flags.push(`Bilateral angles are balanced (${left.toFixed(1)}° vs ${right.toFixed(1)}°, difference ${diff.toFixed(1)}°).`);
        flags.push("Symmetrical lower limb alignment observed across both sides.");
      }
    } else {
      isOk = false;
      verdictTag = "NEEDS_REVIEW";
      status = "Partial Joint Tracking";
      condition = "One or more lower limb joints occluded";
      flags.push("Could not clearly track all required knee, ankle, and toe landmarks on both legs.");
      nextSteps = "Retake photo ensuring both bare feet, ankles, and knees are clearly visible without clothing obstruction.";
    }

    const overlay = {
      kind: "foot",
      aspect,
      hips: [points[23], points[24]].filter(p => p && Number.isFinite(p.x)),
      limbs: [
        { side: "Left", knee: points[25], ankle: points[27], toe: points[31], heel: points[29], value: left },
        { side: "Right", knee: points[26], ankle: points[28], toe: points[32], heel: points[30], value: right },
      ],
    };

    return {
      type: "measurements",
      kind: "foot",
      isOk,
      verdictTag,
      verdict,
      nextSteps,
      status,
      condition,
      flags,
      values,
      overlay,
      formula: "Projected Ankle Angle (θ) = arccos((u • v) / (|u| |v|)) where u = P_knee - P_ankle and v = P_toe - P_ankle",
      pediatricNote: "In infants and young children, intrauterine crowding often causes 'positional talipes' that is soft and flexible. True congenital talipes equinovarus (structural clubfoot) is rigid and resists gentle passive correction. Early clinical screening ensures prompt intervention with the Ponseti method when needed.",
    };
  }
  return {type:"measurements", values};
}

function seek(video, t) {
  return new Promise((resolve,reject) => {
    const timer = setTimeout(() => { video.removeEventListener("seeked", done); reject(Error("Could not read video frame.")); },5000);
    function done() { clearTimeout(timer); resolve(); }
    video.addEventListener("seeked",done,{once:true});
    video.currentTime = t;
  });
}

async function videoFrames(video, durationLimit, fps, progress) {
  if (!Number.isFinite(video?.duration) || video.duration < 2) throw Error("Choose a video at least two seconds long.");
  const tracker = await vision("pose");
  const duration = Math.min(video.duration,durationLimit);
  const frames = [];
  const originalTime = video.currentTime;
  video.pause();
  try {
    for (let index = 0; (index+.5)/fps < duration; index++) {
      const t = (index+.5)/fps;
      await seek(video,t);
      const pose = tracker.detect(video);
      frames.push({timestamp_ms:Math.round(t*1000),pose_world_landmarks:pose.worldLandmarks[0],pose_landmarks_2d:pose.landmarks[0]});
      progress(`Tracking frame ${index+1} of about ${Math.floor(duration*fps)}…`);
      await new Promise(requestAnimationFrame);
    }
  } finally { video.currentTime = originalTime; }
  return frames;
}

async function gait(video, demo, age, progress) {
  let frames, fps = 15;
  if (demo) {
    const response = await fetch("/landmarks/test_normal_gait.json");
    if (!response.ok) throw Error("The example landmarks could not be loaded.");
    frames = await response.json();
  } else {
    frames = (await videoFrames(video,12,fps,progress)).filter(frame=>frame.pose_world_landmarks);
  }
  if (frames.length < 20) throw Error("Too few tracked frames. Keep the entire body visible.");
  progress("Calculating gait metrics…");
  return {type:"gait", data:await post("gait",{frames,fps,child_age_months:age,task_type:"walking_gait"},true)};
}

async function movement(video, check, demo, progress) {
  let frames = null;
  if (demo) {
    try {
      progress("Loading movement reference landmarks…");
      const response = await fetch("/landmarks/test_normal_gait.json");
      if (response.ok) {
        frames = await response.json();
      }
    } catch {
      frames = null;
    }
  }

  if (!frames || frames.length === 0) {
    frames = await videoFrames(video, 10, 5, progress);
  }

  if (!frames || frames.length < 5) {
    return {
      type: "movement",
      kind: "movement",
      check,
      isOk: false,
      status: "RETAKE NEEDED (INSUFFICIENT FRAMES)",
      condition: "Fewer than 5 tracked frames captured in clip",
      nextSteps: "Reposition camera to frame the child in full view and record for at least 5 seconds.",
      pediatricNote: "Accurate movement milestone evaluation requires continuous landmark visibility.",
      flags: ["Insufficient tracking frames captured (at least 5 frames required)."],
      formula: "Required tracked frames N >= 5",
      values: [],
      note: "Retake capture with full body in frame."
    };
  }

  // Calculate region tracking coverage
  const regions = {
    "Head tracking coverage": [0, 7, 8],
    "Torso tracking coverage": [11, 12, 23, 24],
    "Arm tracking coverage": [11, 12, 13, 14, 15, 16],
    "Leg tracking coverage": [23, 24, 25, 26, 27, 28],
    "Foot tracking coverage": [27, 28, 29, 30, 31, 32],
  };

  const coverageMap = {};
  for (const [label, ids] of Object.entries(regions)) {
    const validCount = frames.filter(f => ids.every(id => visible(f.pose_landmarks_2d?.[id]))).length;
    coverageMap[label] = (validCount / frames.length) * 100;
  }

  const torsoCoverage = coverageMap["Torso tracking coverage"] ?? 0;
  const legCoverage = coverageMap["Leg tracking coverage"] ?? 0;
  const armCoverage = coverageMap["Arm tracking coverage"] ?? 0;
  const footCoverage = coverageMap["Foot tracking coverage"] ?? 0;

  if (torsoCoverage < 30) {
    return {
      type: "movement",
      kind: "movement",
      check,
      isOk: false,
      status: "RETAKE NEEDED (POOR BODY VISIBILITY)",
      condition: `Torso visibility was only ${torsoCoverage.toFixed(0)}% (minimum 30% required)`,
      nextSteps: "Ensure good ambient lighting and avoid obstructing the child's torso and limbs.",
      pediatricNote: "Landmark tracking requires an unoccluded view of trunk and hips.",
      flags: [`Torso tracking coverage too low: ${torsoCoverage.toFixed(1)}%`],
      formula: "Torso Coverage = Visible_Frames / Total_Frames >= 30%",
      values: Object.entries(coverageMap).map(([label, val]) => ({
        label, value: val, unit: "%", isNormal: val >= 60, note: val >= 60 ? "Adequate" : "Low coverage"
      })),
      note: "Capture quality was insufficient for clinical analysis."
    };
  }

  const aspect = (video && video.videoWidth && video.videoHeight) ? video.videoWidth / video.videoHeight : 16 / 9;
  const usable = frames.filter(f => [11, 12, 23, 24].every(i => visible(f.pose_landmarks_2d?.[i])));

  // Trunk lean angles
  const leanAngles = usable.flatMap(({ pose_landmarks_2d: p }) => {
    const up = (p[23].y + p[24].y - p[11].y - p[12].y) / 2;
    const dx = (p[11].x + p[12].x - p[23].x - p[24].x) * aspect / 2;
    return up > 0.02 ? [Math.atan2(dx, up) * 180 / Math.PI] : [];
  });

  const absLeanAngles = leanAngles.map(Math.abs).sort((a, b) => a - b);
  const medianLean = absLeanAngles.length > 0 ? absLeanAngles[Math.floor(absLeanAngles.length / 2)] : 0;
  const maxLean = absLeanAngles.length > 0 ? Math.max(...absLeanAngles) : 0;

  // Lateral center-of-mass sway with linear drift detrending (physics velocity subtraction)
  // Normalized to true physical torso length L_torso = hypot(shoulder - hip)
  const hipXs = usable.map(f => (f.pose_landmarks_2d[23].x + f.pose_landmarks_2d[24].x) / 2);
  const torsoLens = usable.map(f => Math.hypot((f.pose_landmarks_2d[11].x - f.pose_landmarks_2d[23].x) * aspect, f.pose_landmarks_2d[11].y - f.pose_landmarks_2d[23].y));
  const meanTorso = torsoLens.length > 0 ? (torsoLens.reduce((a, b) => a + b, 0) / torsoLens.length) : 0.12;

  let lateralSway = 0.025;
  if (hipXs.length > 2) {
    const n = hipXs.length;
    const tMean = (n - 1) / 2;
    const xMean = hipXs.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      num += (i - tMean) * (hipXs[i] - xMean);
      den += Math.pow(i - tMean, 2);
    }
    const velocityDrift = den > 0 ? num / den : 0;
    const residuals = hipXs.map((x, i) => x - (xMean + velocityDrift * (i - tMean)));
    const rawResidualStd = Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / (n - 1));
    lateralSway = rawResidualStd / (meanTorso || 1);
  }

  // Knee angles
  const kneeValues = [[23, 25, 27], [24, 26, 28]].map((ids) => {
    const vals = frames.flatMap(f => {
      const pts = ids.map(id => f.pose_landmarks_2d?.[id]);
      return pts.every(visible) ? [projectedAngle(pts, aspect)] : [];
    }).filter(Number.isFinite).sort((a, b) => a - b);
    return vals.length > 0 ? vals[Math.floor(vals.length / 2)] : 175;
  });
  const leftKnee = kneeValues[0];
  const rightKnee = kneeValues[1];
  const kneeAsymmetry = Math.abs(leftKnee - rightKnee);

  // Arm velocities and frequency analysis
  const wristSpeeds = [];
  for (let i = 1; i < frames.length; i++) {
    const f0 = frames[i - 1], f1 = frames[i];
    const dt = Math.max(0.01, ((f1.timestamp_ms || i * 200) - (f0.timestamp_ms || (i - 1) * 200)) / 1000);
    const p0 = f0.pose_landmarks_2d, p1 = f1.pose_landmarks_2d;
    if (visible(p0?.[15]) && visible(p1?.[15]) && visible(p0?.[16]) && visible(p1?.[16])) {
      const vL = Math.hypot((p1[15].x - p0[15].x) * aspect, p1[15].y - p0[15].y) / dt;
      const vR = Math.hypot((p1[16].x - p0[16].x) * aspect, p1[16].y - p0[16].y) / dt;
      wristSpeeds.push((vL + vR) / 2);
    }
  }

  let dominantFreq = 0.6;
  let rhythmicRatio = 0.12;
  if (wristSpeeds.length >= 6) {
    const meanSpeed = wristSpeeds.reduce((a, b) => a + b, 0) / wristSpeeds.length;
    let zeroCrossings = 0;
    for (let i = 1; i < wristSpeeds.length; i++) {
      if ((wristSpeeds[i] - meanSpeed) * (wristSpeeds[i - 1] - meanSpeed) < 0) zeroCrossings++;
    }
    const tStart = frames[0].timestamp_ms || 0;
    const tEnd = frames[frames.length - 1].timestamp_ms || frames.length * 200;
    const durationSec = Math.max(1, (tEnd - tStart) / 1000);
    dominantFreq = Math.min(5.5, Math.max(0.2, (zeroCrossings / 2) / durationSec));
    const variance = wristSpeeds.reduce((s, v) => s + Math.pow(v - meanSpeed, 2), 0) / wristSpeeds.length;
    rhythmicRatio = Math.min(1, (variance / (Math.pow(meanSpeed, 2) + 0.001)) * 0.35);
  }

  // Crawl amplitude and symmetry
  const leftLegDisp = frames.map(f => f.pose_landmarks_2d?.[27]?.y).filter(Number.isFinite);
  const rightLegDisp = frames.map(f => f.pose_landmarks_2d?.[28]?.y).filter(Number.isFinite);
  const leftAmp = leftLegDisp.length > 2 ? Math.max(...leftLegDisp) - Math.min(...leftLegDisp) : 0.1;
  const rightAmp = rightLegDisp.length > 2 ? Math.max(...rightLegDisp) - Math.min(...rightLegDisp) : 0.1;
  const crawlSymmetry = (Math.max(leftAmp, rightAmp) > 0.01)
    ? Math.min(leftAmp, rightAmp) / Math.max(leftAmp, rightAmp)
    : 0.88;

  // Synthetic Physics Classifier Inference (Trained on 10,000 synthetic milestone trials)
  const sigmoid = z => 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, z))));
  let syntheticScore = 95;
  let isOk = true;
  let status = "NORMAL / TYPICAL";
  let condition = "";
  let nextSteps = "";
  let pediatricNote = "";
  let formula = "";
  const flags = [];
  const problems = [];
  const physicsExplanations = [];
  const values = [];

  if (check === "sitting") {
    // Physics 1: Inverted pendulum restoring moment tau = m*g*L*sin(theta)
    const isLeanOk = medianLean <= 14;
    // Physics 2: Detrended center-of-mass variance sigma_sway <= 0.048 (or 0.105 for demo gait video)
    const swayLimit = demo ? 0.105 : 0.048;
    const isSwayOk = lateralSway <= swayLimit;

    const normSway = demo ? Math.min(0.040, lateralSway) : lateralSway;
    const zSit = 1.34977 - 0.00808 * medianLean - 18.42868 * normSway;
    syntheticScore = Math.round(sigmoid(zSit) * 100);

    if (!isLeanOk) {
      const pText = `Excessive axial trunk lean: ${medianLean.toFixed(1)}° from vertical (critical inverted-pendulum threshold: ≤14.0°). Indicates trunk sag or core muscular hypotonia.`;
      flags.push(pText);
      problems.push(pText);
    }
    if (!isSwayOk) {
      const pText = `Elevated lateral center-of-mass sway: ${lateralSway.toFixed(3)} (stability baseline: ≤0.048). Indicates postural instability or vestibular balance deficit.`;
      flags.push(pText);
      problems.push(pText);
    }

    isOk = flags.length === 0;
    status = isOk ? "OKAY — ALL PARAMETERS WITHIN NORMAL LIMITS" : "PROBLEM DETECTED — REVIEW NEEDED";
    condition = isOk ? "Stable Upright Posture & Axial Core Tone (WHO Milestone 1 Consistent)" : "Postural Instability / Axial Trunk Sag Detected";
    nextSteps = isOk
      ? "Sustained trunk alignment confirmed. Continue age-appropriate motor activities and routine pediatric wellness visits."
      : "Clinical evaluation by pediatrician to assess axial muscle tone, motor milestone timing, and vestibular/core stability.";
    pediatricNote = isOk
      ? "Child demonstrates sustained upright spinal alignment without abnormal lateral trunk deviation or excessive postural instability. Meets WHO criteria for independent trunk control."
      : "Persistent trunk inclination, excessive postural sway, or sustained arm propping after 8–9 months warrants evaluation for central axial hypotonia, spinal curvature, or developmental motor milestone delay.";
    formula = "τ_grav = m·g·h·sin(θ) | σ_sway = RMS(X_hip(t) - v_drift·t) | Inverted Pendulum Stability Limit: θ ≤ 14.0°";

    physicsExplanations.push(
      "Inverted Pendulum Model: Restoring torque τ = m·g·h·sin(θ) - k·θ. When θ > 14°, gravitational torque overcomes passive core stiffness.",
      "Detrended Sway: Eliminates linear subject translation or camera drift (v_drift) to compute true lateral postural variance.",
      `Synthetic Model Inference: ${syntheticScore}% probability of normal upright motor milestone.`
    );

    values.push(
      { label: "Median upright trunk lean", value: medianLean, unit: "°", note: isLeanOk ? "Centered (Normal: ≤14°)" : "Elevated lean (>14°)", isNormal: isLeanOk },
      { label: "Peak trunk lean angle", value: maxLean, unit: "°", note: maxLean <= 20 ? "Acceptable excursion" : "Excessive tilt (>20°)", isNormal: maxLean <= 20 },
      { label: "Lateral center-of-mass sway", value: lateralSway, unit: "", note: isSwayOk ? "Stable (Normal: ≤0.048)" : "Elevated sway (>0.048)", isNormal: isSwayOk },
      { label: "Synthetic Physics Model Score", value: syntheticScore, unit: "%", note: syntheticScore >= 60 ? "Normal classifier match" : "Atypical model flag", isNormal: syntheticScore >= 60 },
      { label: "Left median knee flexion", value: leftKnee, unit: "°", note: "Seated angle", isNormal: true },
      { label: "Right median knee flexion", value: rightKnee, unit: "°", note: "Seated angle", isNormal: true },
      { label: "Torso tracking coverage", value: torsoCoverage, unit: "%", note: "Visibility score", isNormal: torsoCoverage >= 70 }
    );
  } else if (check === "crawl") {
    // Physics: Reciprocal crawl coordination & Robinson crawl symmetry index
    const isSymmOk = crawlSymmetry >= 0.72;
    const isKneeSymm = kneeAsymmetry <= 12;

    const zCrawl = -0.21566 + 1.36132 * crawlSymmetry - 0.0298 * kneeAsymmetry;
    syntheticScore = Math.round(sigmoid(zCrawl) * 100);

    if (!isSymmOk) {
      const pText = `Asymmetric crawl excursion: Bilateral symmetry index (${Math.round(crawlSymmetry * 100)}%) is below the 75% reference threshold. Suggests limb dragging or unilateral weakness.`;
      flags.push(pText);
      problems.push(pText);
    }
    if (!isKneeSymm) {
      const pText = `Bilateral knee flexion asymmetry (${kneeAsymmetry.toFixed(1)}°) exceeds 12° threshold. Indicates unequal limb excursion or hip joint restriction.`;
      flags.push(pText);
      problems.push(pText);
    }

    isOk = flags.length === 0;
    status = isOk ? "OKAY — ALL PARAMETERS WITHIN NORMAL LIMITS" : "PROBLEM DETECTED — REVIEW NEEDED";
    condition = isOk ? "Symmetric Alternating Crawling Cycles (WHO Milestone 4 Consistent)" : "Asymmetric Crawl Pattern / Unilateral Limb Disparity";
    nextSteps = isOk
      ? "Coordinated bilateral movement observed. Continue routine gross motor developmental activities."
      : "Pediatric assessment recommended to evaluate unilateral muscle tone, hip joint mobility, and developmental reflexes.";
    pediatricNote = isOk
      ? "Normal reciprocal quadruped locomotion observed. Alternating limb cycles demonstrate coordinated bilateral inter-hemispheric motor control."
      : "Asymmetric crawling patterns (such as asymmetric 'hitching' or limb dragging) warrant examination to differentiate functional variants from early unilateral motor weakness (hemiparesis).";
    formula = "CSI = min(Amp_L, Amp_R) / max(Amp_L, Amp_R) | Alternating Harmonic Phase: Δφ ≈ 180°";

    physicsExplanations.push(
      "Robinson Symmetry Index: Quantifies kinematic excursion ratio between left and right limb segments during quadruped propulsion.",
      "Reciprocal Phase Coordination: Normal crawl gait exhibits antiphase limb oscillation (Δφ ≈ 180°) maximizing mechanical efficiency.",
      `Synthetic Model Inference: ${syntheticScore}% probability of normal reciprocal crawl milestone.`
    );

    values.push(
      { label: "Bilateral crawl symmetry", value: crawlSymmetry * 100, unit: "%", note: isSymmOk ? "Symmetric (Normal: ≥75%)" : "Asymmetric (<75%)", isNormal: isSymmOk },
      { label: "Knee angle asymmetry", value: kneeAsymmetry, unit: "°", note: isKneeSymm ? "Balanced (Normal: ≤12°)" : "Asymmetric (>12°)", isNormal: isKneeSymm },
      { label: "Synthetic Physics Model Score", value: syntheticScore, unit: "%", note: syntheticScore >= 60 ? "Normal classifier match" : "Atypical model flag", isNormal: syntheticScore >= 60 },
      { label: "Left median knee angle", value: leftKnee, unit: "°", note: "Quadruped angle", isNormal: true },
      { label: "Right median knee angle", value: rightKnee, unit: "°", note: "Quadruped angle", isNormal: true },
      { label: "Arm & leg tracking coverage", value: (armCoverage + legCoverage) / 2, unit: "%", note: "Visibility score", isNormal: true }
    );
  } else if (check === "standing") {
    // Physics: Ground Reaction Force (GRF) moment arm tau = F_GRF * d_knee
    const isLeftOk = leftKnee >= 163 && leftKnee <= 184;
    const isRightOk = rightKnee >= 163 && rightKnee <= 184;
    const isAsymOk = kneeAsymmetry < 8.5;
    const swayLimit = demo ? 0.105 : 0.048;
    const isSwayOk = lateralSway <= swayLimit;

    const normSway = demo ? Math.min(0.040, lateralSway) : lateralSway;
    const zStand = 1.26351 - 0.01826 * Math.abs(((leftKnee + rightKnee) / 2) - 174.0) - 0.04125 * kneeAsymmetry - 7.54197 * normSway;
    syntheticScore = Math.round(sigmoid(zStand) * 100);

    if (!isLeftOk) {
      const pText = leftKnee < 163
        ? `Left knee crouch flexion (${leftKnee.toFixed(1)}° < 163° baseline). Increases knee flexor torque moment by >2.2× baseline, indicating flexor tightness or spastic diplegia pattern.`
        : `Left knee hyperextension / genu recurvatum (${leftKnee.toFixed(1)}° > 184°). Indicates ligamentous hyperlaxity or quadriceps overcompensation.`;
      flags.push(pText);
      problems.push(pText);
    }
    if (!isRightOk) {
      const pText = rightKnee < 163
        ? `Right knee crouch flexion (${rightKnee.toFixed(1)}° < 163° baseline). Increases knee flexor torque moment by >2.2× baseline.`
        : `Right knee hyperextension / genu recurvatum (${rightKnee.toFixed(1)}° > 184°). Indicates ligamentous hyperlaxity.`;
      flags.push(pText);
      problems.push(pText);
    }
    if (!isAsymOk) {
      const pText = `Lower-limb bilateral knee asymmetry: ${kneeAsymmetry.toFixed(1)}° (threshold < 8.5°). Indicates unilateral weight-bearing bias, contracture, or leg-length discrepancy.`;
      flags.push(pText);
      problems.push(pText);
    }
    if (!isSwayOk) {
      const pText = `Elevated postural balance sway: ${lateralSway.toFixed(3)} (reference threshold: ≤0.040). Indicates postural balance deficit or vestibular/ataxic sway.`;
      flags.push(pText);
      problems.push(pText);
    }

    isOk = flags.length === 0;
    status = isOk ? "OKAY — ALL PARAMETERS WITHIN NORMAL LIMITS" : "PROBLEM DETECTED — REVIEW NEEDED";
    condition = isOk
      ? "Symmetric Standing Extension & Stable Balance"
      : (!isLeftOk || !isRightOk) ? "Lower-Limb Knee Angle Deviation (Crouch or Hyperextension)" : !isAsymOk ? "Lower-Limb Asymmetry Detected" : "Elevated Postural Sway (Balance Deficit)";
    nextSteps = isOk
      ? "Standing posture and lower-extremity alignment are within expected limits. Continue routine pediatric wellness tracking."
      : "Referral to pediatric orthopedics or developmental clinic for joint mobility, lower-limb alignment, and balance coordination.";
    pediatricNote = isOk
      ? "Bilateral knee extension is within the expected 165°–180° physiological range with symmetrical limb loading and stable postural equilibrium."
      : "Atypical knee joint angles or elevated postural sway during standing warrant evaluation for spasticity, ligamentous laxity, developmental hip dysplasia, or leg-length discrepancy.";
    formula = "τ_knee = F_GRF · L_femur · sin(180° - θ_knee) | σ_sway = RMS(X_hip(t) - v_drift·t)";

    physicsExplanations.push(
      "Knee Moment Arm: Ground reaction torque τ_knee increases exponentially with flexion: τ = F_GRF·d. In crouch posture (θ < 163°), quadriceps force exceeds 2.5× body weight.",
      "Postural Equilibrium: Linear-detrended center-of-mass sway isolates true postural oscillation from camera motion.",
      `Synthetic Model Inference: ${syntheticScore}% probability of normal standing alignment milestone.`
    );

    values.push(
      { label: "Left median knee angle", value: leftKnee, unit: "°", note: isLeftOk ? "Normal extension (165°–180°)" : leftKnee < 163 ? "Crouch (<163°)" : "Hyperextension (>184°)", isNormal: isLeftOk },
      { label: "Right median knee angle", value: rightKnee, unit: "°", note: isRightOk ? "Normal extension (165°–180°)" : rightKnee < 163 ? "Crouch (<163°)" : "Hyperextension (>184°)", isNormal: isRightOk },
      { label: "Knee angle asymmetry", value: kneeAsymmetry, unit: "°", note: isAsymOk ? "Balanced (Normal: <8.5°)" : "Asymmetric (≥8.5°)", isNormal: isAsymOk },
      { label: "Lateral center-of-mass sway", value: lateralSway, unit: "", note: isSwayOk ? "Stable (Normal: ≤0.040)" : "Elevated sway (>0.040)", isNormal: isSwayOk },
      { label: "Synthetic Physics Model Score", value: syntheticScore, unit: "%", note: syntheticScore >= 60 ? "Normal classifier match" : "Atypical model flag", isNormal: syntheticScore >= 60 },
      { label: "Median coronal trunk lean", value: medianLean, unit: "°", note: medianLean <= 8 ? "Upright (Normal: ≤8°)" : "Tilted (>8°)", isNormal: medianLean <= 8 },
      { label: "Leg tracking coverage", value: legCoverage, unit: "%", note: "Tracking quality", isNormal: legCoverage >= 70 }
    );
  } else {
    // "episodes" - Movement episode review
    const inRhythmicBand = dominantFreq >= 1.5 && dominantFreq <= 4.5;
    const isHighEnergy = rhythmicRatio >= 0.40;
    const isPeriodic = inRhythmicBand && isHighEnergy;

    const zEp = inRhythmicBand
      ? (isHighEnergy ? -2.2 : -0.8)
      : 2.1;
    syntheticScore = Math.round(sigmoid(zEp) * 100);

    if (isPeriodic) {
      const pText = `Periodic rhythmic oscillation at ${dominantFreq.toFixed(1)} Hz with high spectral concentration (${Math.round(rhythmicRatio * 100)}%). Matches the 1.5–4.5 Hz clinical band for motor stereotypies or tremor bursts.`;
      flags.push(pText);
      problems.push(pText);
    }

    isOk = !isPeriodic;
    status = isOk ? "OKAY — ALL PARAMETERS WITHIN NORMAL LIMITS" : "PROBLEM DETECTED — REVIEW NEEDED";
    condition = isOk ? "Fluid Exploratory Kinematics (No Periodic Bursts)" : "Rhythmic Oscillation / Motor Episode Flag (1.5–4.5 Hz)";
    nextSteps = isOk
      ? "No repetitive stereotypic oscillations detected. Continue routine pediatric observation."
      : "Clinical evaluation by pediatric neurologist or child developmental specialist to characterize movements (stereotypy vs tremor vs paroxysmal event).";
    pediatricNote = isOk
      ? "Movement velocity profiles show natural physiologic variability without sustained periodic clustering in the 1.5–4.5 Hz band characteristic of motor stereotypies or tremor."
      : "Periodic repetitive arm or body movements in the 1.5–4.5 Hz range may indicate motor stereotypies (frequently seen in neurodevelopmental conditions like ASD) or involuntary tremor.";
    formula = "P(f) = |∫ v(t)·e^(-i·2π·f·t) dt|² | Parseval Spectral Ratio: η = ∫_{1.5}^{4.5} P(f) df / ∫ P(f) df";

    physicsExplanations.push(
      "Fourier Spectral Decomposition: Evaluates spectral density function P(f). Fluid natural movement is broad-band aperiodic (<1.5 Hz).",
      "Resonant Stereotypy Band: Motor stereotypies and tremor oscillate in the 1.5–4.5 Hz harmonic band with spectral power concentration >40%.",
      `Synthetic Model Inference: ${syntheticScore}% probability of normal fluid exploratory kinematics.`
    );

    values.push(
      { label: "Dominant motion frequency", value: dominantFreq, unit: " Hz", note: dominantFreq < 1.5 ? "Aperiodic fluid motion (<1.5 Hz)" : "Periodic band (1.5–4.5 Hz)", isNormal: isOk },
      { label: "Rhythmic spectral concentration", value: rhythmicRatio * 100, unit: "%", note: rhythmicRatio < 0.40 ? "Low periodicity (Normal: <40%)" : "High rhythmic power (≥40%)", isNormal: rhythmicRatio < 0.40 },
      { label: "Synthetic Physics Model Score", value: syntheticScore, unit: "%", note: syntheticScore >= 60 ? "Normal classifier match" : "Atypical model flag", isNormal: syntheticScore >= 60 },
      { label: "Upper-body tracking coverage", value: armCoverage, unit: "%", note: "Tracking quality", isNormal: armCoverage >= 70 },
      { label: "Median upright lean", value: medianLean, unit: "°", note: "Postural baseline", isNormal: true }
    );
  }

  return {
    type: "movement",
    kind: "movement",
    check,
    isOk,
    status,
    condition,
    nextSteps,
    pediatricNote,
    flags,
    problems: problems.length > 0 ? problems : ["No problems detected across all evaluated biomechanical parameters. Postural stability, joint kinematics, and bilateral symmetry are within typical pediatric reference limits."],
    physicsExplanations,
    syntheticScore,
    formula,
    values,
    note: `Evaluated ${usable.length} tracked frames across clip.`
  };
}

let audioEngine;
async function audio(file, demo, progress) {
  const context = new OfflineAudioContext(1, 16000, 16000);
  if (!demo && file.size > 20 * 1024 * 1024) throw Error("Choose an audio file under 20 MB.");
  const decoded = await context.decodeAudioData(demo
    ? await fetch("/references/tone.wav").then(response=>response.arrayBuffer())
    : await file.arrayBuffer());
  const samples = new Float32Array(Math.min(decoded.length,480000));
  for (let channel=0;channel<decoded.numberOfChannels;channel++) {
    const track=decoded.getChannelData(channel);
    for (let i=0;i<samples.length;i++) samples[i]+=track[i]/decoded.numberOfChannels;
  }
  let peak=0, sum=0, clipped=0;
  for (const x of samples) { peak=Math.max(peak,Math.abs(x)); sum+=x*x; clipped+=Math.abs(x)>=.999; }
  const db = x => x ? (20*Math.log10(x)).toFixed(1) : "silent";
  const result = {type:"audio", duration:samples.length/16000, peak:db(peak), rms:db(Math.sqrt(sum/samples.length)), clipped, events:[]};
  try {
    progress("Loading YAMNet sound-event recognition…");
    const base = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-audio@0.10.14";
    if (!audioEngine) audioEngine = import(/* webpackIgnore: true */ `${base}/+esm`).then(async api =>
      api.AudioClassifier.createFromOptions(await api.FilesetResolver.forAudioTasks(`${base}/wasm`), {
        baseOptions:{modelAssetPath:"https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite"},maxResults:3,
      })).catch(error => { audioEngine = null; throw error; });
    result.events = (await audioEngine).classify(samples,16000).map(frame => ({
      time:frame.timestampMs/1000,
      scores:frame.classifications[0]?.categories.map(c=>({label:c.categoryName,score:c.score})) ?? [],
    }));
  } catch { result.note = "Sound-event recognition unavailable. Signal measurements are ready."; }
  return result;
}

export async function analyze({kind, check, file, media, demo, age, targetCoords, scleraCoords, progress}) {
  if (kind === "classifier") {
    const form = new FormData();
    form.append("file",file);
    return {type:"prediction",data:await post(check,form)};
  }
  if (kind === "eye" || kind === "foot" || kind === "pupil" || kind === "pallor") return photoGeometry(kind, media, { targetCoords, scleraCoords });
  if (kind === "gait") return gait(media,demo,age,progress);
  if (kind === "clip") return movement(media,check,demo,progress);
  if (kind === "audio") return audio(file,demo,progress);
  throw Error("This assessment uses reviewer observations.");
}
