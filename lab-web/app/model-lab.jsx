"use client";

import { useEffect, useRef, useState } from "react";
import { protocols } from "./protocols";
import { analyze } from "./analysis";

const examples = {eye:"eye",alignment:"face",foot:"standing",pupil:"face",pallor:"pallor_normal",skin:"skin",gait:"walking",sitting:"sitting",standing:"standing"};

function Reference({ kind }) {
  const canvas = useRef(null);
  useEffect(() => {
    const c = canvas.current.getContext("2d");
    c.clearRect(0,0,400,220);
    c.strokeStyle="#233c42";
    c.setLineDash([4,6]);
    c.beginPath(); c.moveTo(200,18); c.lineTo(200,202); c.moveTo(30,110); c.lineTo(370,110); c.stroke();
    c.setLineDash([]);
    c.strokeStyle="#b5dcd5"; c.lineWidth=2.5; c.lineCap="round";
    const line = (...points) => {
      c.beginPath(); points.forEach(([x,y],i)=>i ? c.lineTo(x,y) : c.moveTo(x,y)); c.stroke();
    };
    const oval = (x,y,w,h) => { c.beginPath(); c.ellipse(x,y,w,h,0,0,2*Math.PI); c.stroke(); };
    const point = (x,y) => { c.fillStyle="#81f1c2"; c.beginPath(); c.arc(x,y,4,0,2*Math.PI); c.fill(); };
    if (kind === "body" || kind === "foot") {
      oval(200,43,15,18);
      line([200,62],[200,115]); line([170,74],[230,74]);
      line([170,74],[157,108],[151,136]); line([230,74],[243,108],[249,136]);
      line([184,115],[216,115]); line([184,115],[177,151],[173,183],[161,189]);
      line([216,115],[224,151],[229,183],[242,189]);
      (kind === "foot" ? [[177,151],[173,183],[161,189],[224,151],[229,183],[242,189]] : [[170,74],[230,74],[184,115],[216,115],[177,151],[224,151],[173,183],[229,183]]).forEach(p=>point(...p));
    } else if (kind === "wave") {
      line(...Array.from({length:141},(_,i)=>[32+i*2.4,110+Math.sin(i*.82)*44*Math.pow(Math.sin(i*Math.PI/140),2)]));
    } else if (kind === "patch") {
      oval(200,110,92,57); c.strokeStyle="#81f1c2"; oval(203,112,37,26); point(203,112);
    } else {
      if (kind !== "eye") oval(200,105,71,83);
      if (kind === "eye" || kind === "face") {
        for (const x of (kind === "eye" ? [200] : [171,229])) {
          const w=kind==="eye"?65:22;
          oval(x,96,w,w*.35); oval(x,96,w*.31,w*.31); point(x,96);
          point(x-w,96); point(x+w,96);
        }
      }
      if (kind !== "eye") { oval(200,137,29,kind==="mouth"?15:5); point(171,137); point(229,137); }
      if (kind==="mouth") line([180,137],[220,137]);
    }
  },[kind]);
  return <canvas ref={canvas} width="400" height="220" role="img" aria-label={`Illustrated ${kind} capture reference with highlighted landmarks`}/>;
}

function AnnotatedPhoto({ overlay, media, onRetarget, onResetPins, pinMode, setPinMode }) {
  const canvasRef = useRef(null);
  const [showMarkings, setShowMarkings] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    const img = media?.current;
    if (!canvas || !img || !overlay) return;

    function render() {
      const w = img.naturalWidth || img.videoWidth || img.width || 600;
      const h = img.naturalHeight || img.videoHeight || img.height || 600;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);

      if (!showMarkings) return;

      const lw = Math.max(2, Math.round(w * 0.004));
      const pr = Math.max(4, Math.round(w * 0.007));

      if (overlay.kind === "eye") {
        if (overlay.midline?.length >= 2) {
          ctx.save();
          ctx.setLineDash([lw * 2.5, lw * 2]);
          ctx.strokeStyle = "rgba(6, 182, 212, 0.85)";
          ctx.lineWidth = lw;
          ctx.beginPath();
          overlay.midline.forEach((p, idx) => {
            const x = p.x * w, y = p.y * h;
            if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          });
          ctx.stroke();
          ctx.restore();
        }

        const leftOuter = overlay.eyes?.find(e => e.side === "Left")?.outer;
        const rightOuter = overlay.eyes?.find(e => e.side === "Right")?.outer;
        if (leftOuter && rightOuter) {
          ctx.save();
          ctx.setLineDash([lw * 2, lw * 2]);
          ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
          ctx.lineWidth = Math.max(1, lw * 0.7);
          ctx.beginPath();
          ctx.moveTo(rightOuter.x * w, rightOuter.y * h);
          ctx.lineTo(leftOuter.x * w, leftOuter.y * h);
          ctx.stroke();
          ctx.restore();
        }

        overlay.eyes?.forEach(eye => {
          const { side, outer, inner, iris, value } = eye;
          if (!outer || !inner || !iris) return;
          const ax = outer.x * w, ay = outer.y * h;
          const bx = inner.x * w, by = inner.y * h;
          const cx = iris.x * w, cy = iris.y * h;

          ctx.strokeStyle = "#10b981";
          ctx.lineWidth = lw * 1.5;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();

          ctx.fillStyle = "#facc15";
          ctx.beginPath(); ctx.arc(ax, ay, pr, 0, 2 * Math.PI); ctx.fill();
          ctx.beginPath(); ctx.arc(bx, by, pr, 0, 2 * Math.PI); ctx.fill();

          const irisR = Math.max(pr * 1.6, Math.hypot(bx - ax, by - ay) * 0.18);
          ctx.strokeStyle = "#f59e0b";
          ctx.lineWidth = lw * 1.2;
          ctx.beginPath();
          ctx.arc(cx, cy, irisR, 0, 2 * Math.PI);
          ctx.stroke();

          ctx.fillStyle = "#ef4444";
          ctx.beginPath(); ctx.arc(cx, cy, pr * 0.7, 0, 2 * Math.PI); ctx.fill();

          const tag = `${side}: ${value !== null ? value.toFixed(1) + "%" : "Unclear"}`;
          ctx.font = `bold ${Math.max(12, Math.round(w * 0.024))}px system-ui, sans-serif`;
          ctx.fillStyle = "rgba(7, 31, 26, 0.85)";
          const tm = ctx.measureText(tag);
          const tagX = Math.max(10, Math.min(w - tm.width - 20, cx - tm.width / 2));
          const tagY = Math.max(24, Math.min(ay, by) - pr * 2.5);
          ctx.fillRect(tagX - 5, tagY - 14, tm.width + 10, 20);
          ctx.fillStyle = "#ffffff";
          ctx.fillText(tag, tagX, tagY + 1);
        });
      }

      if (overlay.kind === "foot") {
        if (overlay.hips?.length === 2) {
          const [h1, h2] = overlay.hips;
          ctx.save();
          ctx.setLineDash([lw * 2.5, lw * 2]);
          ctx.strokeStyle = "rgba(6, 182, 212, 0.85)";
          ctx.lineWidth = lw;
          ctx.beginPath();
          ctx.moveTo(h1.x * w, h1.y * h);
          ctx.lineTo(h2.x * w, h2.y * h);
          ctx.stroke();
          ctx.restore();
          ctx.fillStyle = "#38bdf8";
          ctx.beginPath(); ctx.arc(h1.x * w, h1.y * h, pr * 0.8, 0, 2 * Math.PI); ctx.fill();
          ctx.beginPath(); ctx.arc(h2.x * w, h2.y * h, pr * 0.8, 0, 2 * Math.PI); ctx.fill();
        }

        overlay.limbs?.forEach(limb => {
          const { side, knee, ankle, toe, heel, value } = limb;
          if (!knee || !ankle || !toe) return;
          const kx = knee.x * w, ky = knee.y * h;
          const ax = ankle.x * w, ay = ankle.y * h;
          const tx = toe.x * w, ty = toe.y * h;

          ctx.strokeStyle = "#10b981";
          ctx.lineWidth = lw * 1.5;
          ctx.beginPath();
          ctx.moveTo(kx, ky);
          ctx.lineTo(ax, ay);
          ctx.stroke();

          ctx.strokeStyle = "#06b6d4";
          ctx.lineWidth = lw * 1.5;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(tx, ty);
          ctx.stroke();

          if (heel) {
            const hx = heel.x * w, hy = heel.y * h;
            ctx.strokeStyle = "rgba(6, 182, 212, 0.6)";
            ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(hx, hy); ctx.lineTo(tx, ty); ctx.stroke();
            ctx.fillStyle = "#a7f3d0";
            ctx.beginPath(); ctx.arc(hx, hy, pr * 0.7, 0, 2 * Math.PI); ctx.fill();
          }

          ctx.fillStyle = "#34d399";
          ctx.beginPath(); ctx.arc(kx, ky, pr, 0, 2 * Math.PI); ctx.fill();

          ctx.fillStyle = "#f59e0b";
          ctx.beginPath(); ctx.arc(ax, ay, pr * 1.25, 0, 2 * Math.PI); ctx.fill();

          ctx.fillStyle = "#ef4444";
          ctx.beginPath(); ctx.arc(tx, ty, pr, 0, 2 * Math.PI); ctx.fill();

          const tag = `${side}: ${value !== null ? value.toFixed(1) + "°" : "Unclear"}`;
          ctx.font = `bold ${Math.max(12, Math.round(w * 0.024))}px system-ui, sans-serif`;
          ctx.fillStyle = "rgba(7, 31, 26, 0.85)";
          const tm = ctx.measureText(tag);
          const offsetX = side === "Left" ? 12 : -(tm.width + 12);
          ctx.fillRect(ax + offsetX - 4, ay - 11, tm.width + 8, 20);
          ctx.fillStyle = "#ffffff";
          ctx.fillText(tag, ax + offsetX, ay + 4);
        });
      }

      if (overlay.kind === "pupil") {
        overlay.pupils?.forEach(pupilItem => {
          const { side, p, data } = pupilItem;
          if (!p || !data) return;
          const px = p.x * w, py = p.y * h;
          const r = Math.max(8, data.r || Math.round(w * 0.015));

          ctx.strokeStyle = data.isLeukocoria ? "#ef4444" : "#10b981";
          ctx.lineWidth = lw * 1.5;
          ctx.beginPath();
          ctx.arc(px, py, r, 0, 2 * Math.PI);
          ctx.stroke();

          ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(px - r * 0.6, py); ctx.lineTo(px + r * 0.6, py);
          ctx.moveTo(px, py - r * 0.6); ctx.lineTo(px, py + r * 0.6);
          ctx.stroke();

          ctx.fillStyle = `rgb(${data.red}, ${data.green}, ${data.blue})`;
          ctx.beginPath();
          ctx.arc(px + r + 14, py, pr * 1.1, 0, 2 * Math.PI);
          ctx.fill();
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1.5;
          ctx.stroke();

          const tag = `${side}: ${data.isLeukocoria ? "⚠ LEUKOCORIA" : data.type === "red_reflex" ? "Red Reflex" : "Dark Pupil"}`;
          ctx.font = `bold ${Math.max(12, Math.round(w * 0.024))}px system-ui, sans-serif`;
          ctx.fillStyle = "rgba(7, 31, 26, 0.85)";
          const tm = ctx.measureText(tag);
          const tagX = side === "Right"
            ? Math.max(10, px - tm.width - 8)
            : Math.min(w - tm.width - 10, px + 8);
          const tagY = Math.max(24, py - r - 12);
          ctx.fillRect(tagX - 5, tagY - 14, tm.width + 10, 20);
          ctx.fillStyle = data.isLeukocoria ? "#fca5a5" : "#ffffff";
          ctx.fillText(tag, tagX, tagY + 1);
        });
      }

      if (overlay.kind === "pallor") {
        const { target, sclera, isOk, normErythemaIndex, estimatedHb, meanR, meanG, meanB, meanScR, meanScG, meanScB } = overlay;

        // 1. Target Conjunctiva disk
        if (target) {
          const tx = target.x * w, ty = target.y * h;
          const tr = Math.max(12, target.r * w);

          ctx.strokeStyle = isOk ? "#10b981" : "#ef4444";
          ctx.lineWidth = lw * 2;
          ctx.setLineDash([5, 4]);
          ctx.beginPath();
          ctx.arc(tx, ty, tr, 0, 2 * Math.PI);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(tx - tr * 0.7, ty); ctx.lineTo(tx + tr * 0.7, ty);
          ctx.moveTo(tx, ty - tr * 0.7); ctx.lineTo(tx, ty + tr * 0.7);
          ctx.stroke();

          const swatchR = Math.max(7, Math.round(w * 0.016));
          ctx.fillStyle = `rgb(${meanR}, ${meanG}, ${meanB})`;
          ctx.beginPath();
          ctx.arc(tx + tr + 12, ty, swatchR, 0, 2 * Math.PI);
          ctx.fill();
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1.5;
          ctx.stroke();

          const tag = `● Target: Conjunctiva (${isOk ? "Normal" : "Pallor"} · EI: ${normErythemaIndex.toFixed(2)} · Hb: ${estimatedHb.toFixed(1)} g/dL)`;
          ctx.font = `bold ${Math.max(12, Math.round(w * 0.024))}px system-ui, sans-serif`;
          ctx.fillStyle = "rgba(7, 31, 26, 0.90)";
          const tm = ctx.measureText(tag);
          const tagX = Math.max(10, Math.min(w - tm.width - 24, tx - tm.width / 2));
          const tagY = ty > 36 ? ty - tr - 10 : ty + tr + 24;
          ctx.fillRect(tagX - 6, tagY - 14, tm.width + 12, 22);
          ctx.fillStyle = isOk ? "#a7f3d0" : "#fca5a5";
          ctx.fillText(tag, tagX, tagY + 2);
        }

        // 2. Reference Sclera disk (White Balance)
        if (sclera) {
          const sx = sclera.x * w, sy = sclera.y * h;
          const sr = Math.max(10, sclera.r * w);

          ctx.strokeStyle = "#f59e0b";
          ctx.lineWidth = lw * 1.5;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.arc(sx, sy, sr, 0, 2 * Math.PI);
          ctx.stroke();
          ctx.setLineDash([]);

          const scSwatchR = Math.max(6, Math.round(w * 0.014));
          ctx.fillStyle = `rgb(${meanScR}, ${meanScG}, ${meanScB})`;
          ctx.beginPath();
          ctx.arc(sx + sr + 10, sy, scSwatchR, 0, 2 * Math.PI);
          ctx.fill();
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1;
          ctx.stroke();

          const scTag = `⚪ Sclera Baseline (White Reference)`;
          ctx.font = `bold ${Math.max(11, Math.round(w * 0.020))}px system-ui, sans-serif`;
          ctx.fillStyle = "rgba(20, 30, 25, 0.85)";
          const scTm = ctx.measureText(scTag);
          const scTagX = Math.max(10, Math.min(w - scTm.width - 20, sx - scTm.width / 2));
          const scTagY = sy > 26 ? sy - sr - 8 : sy + sr + 18;
          ctx.fillRect(scTagX - 5, scTagY - 12, scTm.width + 10, 18);
          ctx.fillStyle = "#fef3c7";
          ctx.fillText(scTag, scTagX, scTagY + 2);
        }
      }
    }

    if (img.complete) {
      render();
    } else {
      img.addEventListener("load", render, { once: true });
    }
  }, [overlay, media, showMarkings]);

  if (!overlay) return null;

  return (
    <div style={{ marginTop: "14px", marginBottom: "16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <h4 style={{ margin: 0, fontSize: "0.95rem", color: "var(--ink)", fontWeight: 700 }}>
          Symmetry & Landmark Visual Markings
        </h4>
        <button
          type="button"
          onClick={() => setShowMarkings(!showMarkings)}
          style={{ padding: "4px 10px", fontSize: "0.8rem", borderRadius: "8px" }}
        >
          {showMarkings ? "Hide markings" : "Show markings"}
        </button>
      </div>
      <canvas
        ref={canvasRef}
        onClick={(e) => {
          if (overlay.kind !== "pallor" || !onRetarget) return;
          const rect = canvasRef.current.getBoundingClientRect();
          const cx = (e.clientX - rect.left) / rect.width;
          const cy = (e.clientY - rect.top) / rect.height;
          onRetarget(cx, cy);
        }}
        style={{
          display: "block",
          width: "100%",
          maxHeight: "360px",
          objectFit: "contain",
          background: "#081d19",
          borderRadius: "14px",
          border: "1px solid var(--line)",
          cursor: overlay.kind === "pallor" ? "crosshair" : "default"
        }}
      />
      {overlay.kind === "pallor" && (
        <div style={{ marginTop: "10px", padding: "10px 14px", background: "#f8faf9", borderRadius: "10px", border: "1px solid #e2e8e5" }}>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: "0.82rem", color: "var(--ink)", fontWeight: 700 }}>Universal Targeting:</span>
            <button
              type="button"
              onClick={() => setPinMode?.("mucosa")}
              style={{
                padding: "4px 10px",
                fontSize: "0.78rem",
                borderRadius: "8px",
                background: pinMode === "mucosa" ? "#065f46" : "#e5e7eb",
                color: pinMode === "mucosa" ? "#fff" : "#111",
                fontWeight: pinMode === "mucosa" ? 700 : 500
              }}
            >
              🎯 Pin Everted Conjunctiva
            </button>
            <button
              type="button"
              onClick={() => setPinMode?.("sclera")}
              style={{
                padding: "4px 10px",
                fontSize: "0.78rem",
                borderRadius: "8px",
                background: pinMode === "sclera" ? "#92400e" : "#e5e7eb",
                color: pinMode === "sclera" ? "#fff" : "#111",
                fontWeight: pinMode === "sclera" ? 700 : 500
              }}
            >
              ⚪ Pin Sclera Reference
            </button>
            <button
              type="button"
              onClick={() => onResetPins?.()}
              style={{ padding: "4px 10px", fontSize: "0.78rem", borderRadius: "8px" }}
            >
              ↺ Reset Auto
            </button>
          </div>
          <p style={{ margin: "6px 0 0", fontSize: "0.78rem", color: "#4b5563", lineHeight: 1.4 }}>
            💡 <b>Universal Clinical Normalization:</b> {pinMode === "mucosa" ? "Click directly on the inner pink mucosal lining of your pulled-down eyelid to target." : "Click on the white sclera of your eye to calibrate room lighting and white balance."}
          </p>
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "14px", marginTop: "6px", fontSize: "0.78rem", color: "#60766f" }}>
        {overlay.kind === "eye" ? (
          <>
            <span><span style={{ color: "#06b6d4", fontWeight: 800 }}>--</span> Cyan dashed: Facial midline</span>
            <span><span style={{ color: "#10b981", fontWeight: 800 }}>—</span> Green line: Canthus axis</span>
            <span><span style={{ color: "#facc15" }}>●</span> Yellow: Eye corners</span>
            <span><span style={{ color: "#ef4444" }}>●</span> Red: Iris center</span>
          </>
        ) : overlay.kind === "pupil" ? (
          <>
            <span><span style={{ color: "#10b981", fontWeight: 800 }}>○</span> Green ring: Normal pupil</span>
            <span><span style={{ color: "#ef4444", fontWeight: 800 }}>○</span> Red ring: Leukocoria flag</span>
            <span><span style={{ color: "#f59e0b" }}>●</span> Swatch: Sampled reflex color</span>
          </>
        ) : overlay.kind === "pallor" ? (
          <>
            <span><span style={{ color: "#10b981", fontWeight: 800 }}>○</span> Target: Palpebral conjunctiva</span>
            <span><span style={{ color: "#f59e0b", fontWeight: 800 }}>○</span> Reference: Sclera white balance</span>
            <span><span style={{ color: "#34d399" }}>●</span> Swatches: Mucosa & Sclera colors</span>
          </>
        ) : (
          <>
            <span><span style={{ color: "#06b6d4", fontWeight: 800 }}>--</span> Cyan dashed: Hip level</span>
            <span><span style={{ color: "#10b981", fontWeight: 800 }}>—</span> Green: Shin (knee–ankle)</span>
            <span><span style={{ color: "#06b6d4", fontWeight: 800 }}>—</span> Blue: Foot (ankle–toe)</span>
            <span><span style={{ color: "#f59e0b" }}>●</span> Amber: Ankle vertex</span>
          </>
        )}
      </div>
    </div>
  );
}

function Result({ result, media, onRetarget, onResetPins, pinMode, setPinMode }) {
  if (result.type==="prediction") {
    const data=result.data;
    const predictedClass = (data.predicted_class || "").toLowerCase();
    const isOk = predictedClass.includes("normal") || predictedClass.includes("healthy") || predictedClass.includes("no_") || predictedClass.includes("non_");
    const topScore = data.all_predictions?.[data.predicted_class] ?? 0;
    const badgeBg = isOk ? "#e3f7ed" : "#fef3d6";
    const badgeColor = isOk ? "#065f46" : "#92400e";
    const badgeBorder = isOk ? "#75e2b8" : "#fcd34d";
    const badgeLabel = isOk ? "● OKAY — ALL PARAMETERS NORMAL" : "⚠️ PROBLEM DETECTED — REVIEW NEEDED";

    return <>
      <div className="result-summary">
        <span className="result-kicker">Clinical Image AI Classification</span>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", margin: "6px 0 10px" }}>
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "4px 12px",
            borderRadius: "999px",
            fontSize: "0.85rem",
            fontWeight: 800,
            background: badgeBg,
            color: badgeColor,
            border: `1px solid ${badgeBorder}`,
          }}>
            {badgeLabel}
          </span>
          <strong style={{ margin: 0, fontSize: "1.05rem" }}>{data.predicted_class?.replaceAll("_"," ") ?? "No class returned"}</strong>
        </div>
        <p><b>Observed classification:</b> {data.predicted_class?.replaceAll("_"," ")} ({topScore}% model score)</p>
        <p><b>Suggested next step:</b> {isOk ? "No suspicious morphological pattern detected. Continue routine pediatric health monitoring." : "Schedule in-person clinical review with a specialist to verify the finding and determine treatment."}</p>
        <p style={{ fontSize: "0.88rem", color: "#455d55" }}>These are deep-learning classification scores for this photo, not definitive disease diagnoses. A healthcare provider should confirm any concern.</p>
      </div>

      {/* Explicit Problem Analysis Card */}
      <div style={{
        background: isOk ? "#f0fdf4" : "#fff7ed",
        border: `1px solid ${isOk ? "#86efac" : "#fdba74"}`,
        borderRadius: "10px",
        padding: "14px 16px",
        margin: "14px 0",
        color: isOk ? "#166534" : "#9a3412",
        fontSize: "0.90rem",
        lineHeight: 1.5
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
          <span style={{ fontSize: "1.15rem" }}>{isOk ? "✅" : "⚠️"}</span>
          <strong style={{ fontSize: "0.98rem" }}>
            {isOk ? "Is this okay? Yes — Visual features are within typical normal appearance." : "Is this okay? No — Possible clinical issue detected requiring review."}
          </strong>
        </div>
        <p style={{ margin: "4px 0 6px" }}>
          <b>What is the problem?</b> {isOk ? "No lesions, tissue defects, caries, or structural anomalies were detected above threshold." : `The model detected visual patterns consistent with "${data.predicted_class?.replaceAll("_", " ")}" (model confidence: ${topScore}%).`}
        </p>
      </div>

      <h3>Scores by class</h3>
      <ul className="scores">
        {Object.entries(data.all_predictions ?? {}).sort((a,b)=>b[1]-a[1]).map(([name,score])=>(
          <li key={name}>
            <span>{name.replaceAll("_"," ")}</span>
            <meter min="0" max="100" value={score}/>
            <small>{score}%</small>
          </li>
        ))}
      </ul>
    </>;
  }
  if (result.type==="measurements") {
    if (result.kind === "eye" || result.kind === "foot" || result.kind === "pupil" || result.kind === "pallor") {
      const isEye = result.kind === "eye";
      const isFoot = result.kind === "foot";
      const isPupil = result.kind === "pupil";
      const isPallor = result.kind === "pallor";
      const titlePrefix = isPallor
        ? "Pediatric Conjunctival Pallor (Anemia) Screening"
        : isPupil
        ? "Pediatric White Pupil (Leukocoria) Screening"
        : isEye ? "Pediatric Eye Alignment Screening" : "Pediatric Foot & Limb Screening";
      const metricHeading = isPallor
        ? "Palpebral Conjunctival Colorimetry & Hemoglobin"
        : isPupil
        ? "Pupillary Color & Reflex Measurements"
        : isEye ? "Ocular Landmark Measurements" : "Limb Geometry Measurements";
      const breakdownTitle = isPallor
        ? "Erythema Index (EI) breakdown, thresholds & formula"
        : isPupil
        ? "CRADLE colorimetry breakdown, thresholds & formula"
        : isEye ? "Pediatric evaluation breakdown & formulas" : "Pediatric limb breakdown, symmetry & formulas";

      return <>
        <div className="result-summary">
          <span className="result-kicker">{titlePrefix}</span>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", margin: "6px 0 10px" }}>
            <span style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "4px 12px",
              borderRadius: "999px",
              fontSize: "0.85rem",
              fontWeight: 800,
              background: result.isOk ? "#e3f7ed" : "#fef3d6",
              color: result.isOk ? "#065f46" : "#92400e",
              border: result.isOk ? "1px solid #75e2b8" : "1px solid #fcd34d",
            }}>
              {result.isOk ? "● OKAY — ALL PARAMETERS NORMAL" : "⚠️ PROBLEM DETECTED — REVIEW NEEDED"}
            </span>
            <strong style={{ margin: 0, fontSize: "1.05rem" }}>{result.status}</strong>
          </div>
          <p><b>Observed pattern:</b> {result.condition}</p>
          <p><b>Suggested next step:</b> {result.nextSteps}</p>
          <p style={{ fontSize: "0.88rem", color: "#455d55" }}>{result.pediatricNote}</p>
        </div>

        {/* Explicit Problem Analysis Card */}
        <div style={{
          background: result.isOk ? "#f0fdf4" : "#fff7ed",
          border: `1px solid ${result.isOk ? "#86efac" : "#fdba74"}`,
          borderRadius: "10px",
          padding: "14px 16px",
          margin: "14px 0",
          color: result.isOk ? "#166534" : "#9a3412",
          fontSize: "0.90rem",
          lineHeight: 1.5
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
            <span style={{ fontSize: "1.15rem" }}>{result.isOk ? "✅" : "⚠️"}</span>
            <strong style={{ fontSize: "0.98rem" }}>
              {result.isOk ? "Is this okay? Yes — All parameters are within normal limits." : "Is this okay? No — Measurements deviate from normal reference limits."}
            </strong>
          </div>
          <p style={{ margin: "4px 0 6px" }}>
            <b>What is the problem?</b> {result.isOk ? "No anatomical asymmetry, misalignment, or abnormal colorimetric shifts were detected. Landmark geometry meets pediatric baselines." : "The following specific problem(s) were identified:"}
          </p>
          {!result.isOk && result.flags && result.flags.length > 0 && (
            <ul style={{ margin: "4px 0 0", paddingLeft: "20px" }}>
              {result.flags.map((p, i) => <li key={i} style={{ marginBottom: "4px" }}><b>Problem {i + 1}:</b> {p}</li>)}
            </ul>
          )}
        </div>
        {result.overlay?.isSkinMisconception && (
          <div style={{
            background: "#fffbeb",
            border: "1px solid #f59e0b",
            borderRadius: "10px",
            padding: "12px 16px",
            marginBottom: "14px",
            color: "#92400e",
            fontSize: "0.88rem",
            lineHeight: 1.45
          }}>
            <strong style={{ display: "block", marginBottom: "4px", fontSize: "0.95rem" }}>
              ⚠️ Uneverted Lower Eyelid Detected (Misconception Notice)
            </strong>
            In a regular face photo, the inner palpebral conjunctiva is hidden inside the closed lower lid. Ordinary facial cheek skin has high surface keratin and lacks mucosal capillary blood vessels, causing ordinary skin to falsely look anemic.
            <br/>
            <b>How to test accurately:</b> Gently pull down the lower eyelid to expose the inner pink mucosal lining, or use the interactive targeting tool on the photo below to click directly on the exposed mucosa.
          </div>
        )}
        {result.overlay && (
          <AnnotatedPhoto
            overlay={result.overlay}
            media={media}
            onRetarget={onRetarget}
            onResetPins={onResetPins}
            pinMode={pinMode}
            setPinMode={setPinMode}
          />
        )}
        <h3>{metricHeading}</h3>
        <dl className="metrics">
          {result.values.map(item => (
            <div key={item.label}>
              <dt style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span>{item.label}</span>
                {item.rgb && <span style={{ display: "inline-block", width: 14, height: 14, borderRadius: "50%", background: item.rgb, border: "1px solid #c2d6ce" }} />}
              </dt>
              <dd><strong>{item.value === null ? "Unclear" : `${item.value.toFixed(1)}${item.unit}`}</strong></dd>
              <small>{item.note || (item.value === null ? "Could not measure" : isEye ? (item.value < 40 ? "Temporal / Outward (<40%)" : item.value > 60 ? "Nasal / Inward (>60%)" : "Centered (Normal: 40%–60%)") : "Projected 2D angle (knee–ankle–toe)")}</small>
            </div>
          ))}
        </dl>
        <details open style={{ marginTop: "16px" }}>
          <summary>{breakdownTitle}</summary>
          {result.flags?.length > 0 && <ul>{result.flags.map((flag, i) => <li key={i}>{flag}</li>)}</ul>}
          <p><b>Geometric Formula:</b> <code>{result.formula}</code></p>
          {isPallor ? (
            <>
              <p><b>Universal Sclera-Normalized Erythema & Hemoglobin Thresholds:</b></p>
              <ul>
                <li><b>Normal Vascular Color (Healthy):</b> Normalized EI &ge; 0.32, Estimated Hb &ge; 11.0 g/dL (rich red/pink microvasculature)</li>
                <li><b>Moderate Pallor (Suspected Anemia):</b> 0.18 &le; Normalized EI &lt; 0.32, 8.0 &le; Estimated Hb &lt; 11.0 g/dL</li>
                <li><b>Severe Pallor (Severe Anemia Alert):</b> Normalized EI &lt; 0.18, Estimated Hb &lt; 8.0 g/dL (chalky, faded palpebral mucosa)</li>
                <li><b>Universal Calibration:</b> Scleral reference baseline subtraction removes camera white-balance and ambient room lighting biases</li>
              </ul>
            </>
          ) : isPupil ? (
            <>
              <p><b>CRADLE Quantitative Screening Thresholds:</b></p>
              <ul>
                <li><b>Normal Dark Pupil:</b> Intensity &lt;40% (ambient unlit pupil)</li>
                <li><b>Healthy Red Reflex:</b> Red dominant (G/R &lt; 0.60, B/R &lt; 0.60), Saturation &ge; 0.35</li>
                <li><b>Leukocoria Flag (Abnormal White/Gray):</b> Intensity &ge; 40%, Saturation &lt; 0.35, G/R &ge; 0.65 or B/R &ge; 0.65</li>
                <li><b>Xanthocoria Flag (Abnormal Yellow/Gold):</b> Hue 30°–65° with high intensity (Coats' disease marker)</li>
                <li><b>Bilateral Asymmetry Threshold:</b> &ge;35% difference in reflex intensity between eyes (Bruckner reflex disparity)</li>
              </ul>
            </>
          ) : isEye ? (
            <>
              <p><b>Pediatric Reference Ranges:</b></p>
              <ul>
                <li><b>Centered (Typical):</b> 40% – 60% of horizontal eye width</li>
                <li><b>Inward Deviation (Esotropia pattern):</b> &gt;60% toward inner corner</li>
                <li><b>Outward Deviation (Exotropia pattern):</b> &lt;40% toward outer corner</li>
                <li><b>Asymmetry Threshold:</b> &ge;10% difference between left and right eyes</li>
              </ul>
            </>
          ) : (
            <>
              <p><b>Pediatric Limb Evaluation Bands:</b></p>
              <ul>
                <li><b>Bilateral Symmetry:</b> &lt;12° difference between left and right limb projections</li>
                <li><b>Asymmetry Threshold (Clubfoot/Limb difference flag):</b> &ge;12° difference between sides</li>
                <li><b>Neutral Standing Projection:</b> Balanced knee-to-ankle and ankle-to-foot alignment</li>
              </ul>
            </>
          )}
          <p><small><b>Clinical Guidance:</b> {isPallor ? "Conjunctival pallor is an established clinical screening indicator for pediatric anemia. Definitive medical confirmation requires laboratory hemoglobin measurement via Complete Blood Count (CBC) or point-of-care hemoglobinometer (HemoCue)." : isPupil ? "Leukocoria is an urgent pediatric finding requiring prompt specialist evaluation to rule out retinoblastoma, congenital cataract, or Coats' disease. A pediatric ophthalmologist confirms ocular health through dilated fundoscopy and ultrasound." : isEye ? "Ocular misalignment in children can lead to amblyopia if untreated. Uncoordinated infant gaze or head turns can affect capture measurements. A pediatric ophthalmologist confirms alignment with Hirschberg corneal reflex and cover testing." : "Lower limb differences in infants require clinical assessment to differentiate flexible intrauterine molding from rigid congenital clubfoot. A pediatric orthopedic specialist performs physical Pirani/Dimeglio scoring and guides Ponseti management if required."}</small></p>
        </details>
      </>;
    }
    return <><div className="result-summary"><span className="result-kicker">Landmark measurements</span><strong>Observed geometry only</strong><p>MediaPipe estimates visible points and measurements. These values do not identify a disease or estimate disease risk.</p></div>{result.note&&<p>{result.note}</p>}<ul>{result.values.map(item=><li key={item.label}>{item.label} <strong>{item.value===null?"Unclear":`${item.value.toFixed(1)}${item.unit}`}</strong></li>)}</ul></>;
  }
  if (result.type==="movement") {
    const isRetake = result.status?.includes("RETAKE");
    const badgeColor = isRetake ? "#ef4444" : result.isOk ? "#065f46" : "#92400e";
    const badgeBg = isRetake ? "#fee2e2" : result.isOk ? "#e3f7ed" : "#fef3d6";
    const badgeBorder = isRetake ? "#fca5a5" : result.isOk ? "#75e2b8" : "#fcd34d";
    const badgeLabel = isRetake ? "⚠️ RETAKE NEEDED" : result.isOk ? "● OKAY — ALL PARAMETERS NORMAL" : "⚠️ PROBLEM DETECTED — REVIEW NEEDED";

    const titlePrefix = result.check === "sitting"
      ? "Pediatric Upright Sitting & Trunk Stability (WHO Motor Milestone 1)"
      : result.check === "crawl"
      ? "Pediatric Reciprocal Crawling & Coordination (WHO Motor Milestone 4)"
      : result.check === "standing"
      ? "Pediatric Standing Alignment & Balance Sway (WHO Motor Milestones 5 & 6)"
      : "Pediatric Motor Episode & Stereotypy Screening (1.5–4.5 Hz FFT Analysis)";

    const breakdownTitle = result.check === "sitting"
      ? "Inverted pendulum physics, detrended sway formulas & WHO thresholds"
      : result.check === "crawl"
      ? "Crawl symmetry index (CSI), reciprocal phase coordination & WHO criteria"
      : result.check === "standing"
      ? "Ground reaction force knee moment arm, sway detrending & alignment criteria"
      : "Fourier spectral power density, resonant band (1.5–4.5 Hz) & stereotypy physics";

    return <>
      <div className="result-summary">
        <span className="result-kicker">{titlePrefix}</span>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", margin: "6px 0 10px" }}>
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "4px 12px",
            borderRadius: "999px",
            fontSize: "0.85rem",
            fontWeight: 800,
            background: badgeBg,
            color: badgeColor,
            border: `1px solid ${badgeBorder}`,
          }}>
            {badgeLabel}
          </span>
          <strong style={{ margin: 0, fontSize: "1.05rem" }}>{result.status}</strong>
        </div>
        <p><b>Observed pattern:</b> {result.condition}</p>
        <p><b>Suggested next step:</b> {result.nextSteps}</p>
        <p style={{ fontSize: "0.88rem", color: "#455d55" }}>{result.pediatricNote}</p>
      </div>

      {/* Explicit Problem Analysis Card */}
      <div style={{
        background: result.isOk ? "#f0fdf4" : "#fff7ed",
        border: `1px solid ${result.isOk ? "#86efac" : "#fdba74"}`,
        borderRadius: "10px",
        padding: "14px 16px",
        margin: "14px 0",
        color: result.isOk ? "#166534" : "#9a3412",
        fontSize: "0.90rem",
        lineHeight: 1.5
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
          <span style={{ fontSize: "1.15rem" }}>{result.isOk ? "✅" : "⚠️"}</span>
          <strong style={{ fontSize: "0.98rem" }}>
            {result.isOk ? "Is this okay? Yes — All parameters are within healthy limits." : "Is this okay? No — Potential problems detected requiring review."}
          </strong>
        </div>
        <p style={{ margin: "4px 0 6px" }}>
          <b>What is the problem?</b> {result.isOk ? "No clinical, postural, or kinematic problems were detected. Limb symmetry, joint extension, and trunk stability meet typical expected baselines." : "The following specific problem(s) were identified by physics & milestone analysis:"}
        </p>
        {!result.isOk && result.problems && (
          <ul style={{ margin: "4px 0 0", paddingLeft: "20px" }}>
            {result.problems.map((p, i) => <li key={i} style={{ marginBottom: "4px" }}><b>Problem {i + 1}:</b> {p}</li>)}
          </ul>
        )}
      </div>

      {/* Physics & Synthetic Model Judgment Card */}
      {result.physicsExplanations && result.physicsExplanations.length > 0 && (
        <div style={{
          background: "#f8fafc",
          border: "1px solid #cbd5e1",
          borderRadius: "10px",
          padding: "12px 16px",
          margin: "12px 0 16px",
          fontSize: "0.88rem",
          color: "#334155",
          lineHeight: 1.5
        }}>
          <strong style={{ display: "block", color: "#0f172a", marginBottom: "6px", fontSize: "0.92rem" }}>
            📐 Physics Formulas & Synthetic Model Judgment:
          </strong>
          <ul style={{ margin: 0, paddingLeft: "18px", color: "#475569" }}>
            {result.physicsExplanations.map((exp, i) => <li key={i} style={{ marginBottom: "3px" }}>{exp}</li>)}
          </ul>
        </div>
      )}

      <h3>Kinematic & Milestone Telemetry</h3>
      <dl className="metrics">
        {result.values.map(item => (
          <div key={item.label}>
            <dt style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span>{item.label}</span>
              {item.isNormal !== undefined && (
                <span style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: item.isNormal ? "#10b981" : "#f59e0b",
                }} title={item.isNormal ? "Normal" : "Review flag"} />
              )}
            </dt>
            <dd><strong>{item.value === null ? "Unclear" : `${typeof item.value === "number" ? item.value.toFixed(1) : item.value}${item.unit}`}</strong></dd>
            <small>{item.note || (item.value === null ? "Could not measure" : "")}</small>
          </div>
        ))}
      </dl>

      <details open style={{ marginTop: "16px" }}>
        <summary>{breakdownTitle}</summary>
        <p><b>Biomechanical Physics Formula:</b> <code>{result.formula}</code></p>
        {result.check === "sitting" ? (
          <>
            <p><b>Inverted Pendulum Model & WHO Sitting Standard:</b></p>
            <ul>
              <li><b>Normal Upright Sitting:</b> Gravitational torque τ_grav = m·g·h·sin(θ) remains below critical stability limit (θ ≤ 14.0°), low detrended sway (σ ≤ 0.048)</li>
              <li><b>Axial Trunk Sag / Fatigue:</b> 14° &lt; lean &le; 20° (requires muscular compensation or hand propping)</li>
              <li><b>Severe Postural Instability:</b> Lean &gt; 20° or continuous arm weight-bearing</li>
              <li><b>WHO Milestone Criterion:</b> Upright sitting without upper-limb support for &ge;10 continuous seconds</li>
            </ul>
          </>
        ) : result.check === "crawl" ? (
          <>
            <p><b>Robinson Symmetry & WHO Crawling Standard:</b></p>
            <ul>
              <li><b>Normal Reciprocal Crawling:</b> Bilateral Crawl Symmetry Index (CSI) &ge;75% with antiphase limb cycles (Δφ ≈ 180°)</li>
              <li><b>Asymmetric Crawl Pattern:</b> CSI &lt;75% or unilateral knee angle asymmetry &ge;12° (indicates unilateral weakness / dragging)</li>
              <li><b>WHO Milestone Criterion:</b> Hands-and-knees alternating quadruped locomotion with abdomen elevated above floor</li>
            </ul>
          </>
        ) : result.check === "standing" ? (
          <>
            <p><b>Ground Reaction Torque & Standing Alignment Thresholds:</b></p>
            <ul>
              <li><b>Physiologic Knee Extension:</b> 165° – 180° in sagittal plane (neutral joint moment arm)</li>
              <li><b>Crouch Stance Flag:</b> Bilateral knee angle &lt;163° (quadriceps demand increases &gt;2.2× baseline to resist gravitational collapse)</li>
              <li><b>Genu Recurvatum Flag:</b> Hyperextension &gt;184° (posterior capsule stress)</li>
              <li><b>Bilateral Symmetry:</b> &lt;8.5° difference between left and right limb projections</li>
              <li><b>Detrended Sway:</b> Normal &le;0.040, Moderate 0.041–0.075, High &gt;0.075</li>
            </ul>
          </>
        ) : (
          <>
            <p><b>Parseval Spectral Density & Stereotypy Physics Thresholds:</b></p>
            <ul>
              <li><b>Typical Fluid Movement:</b> Broad-band aperiodic motion (&lt;1.5 Hz) with low periodic concentration (&lt;40%)</li>
              <li><b>Resonant Stereotypy Band:</b> Concentrated oscillations in the 1.5 Hz – 4.5 Hz frequency range with spectral ratio &ge;40%</li>
              <li><b>Abrupt Transition Flag:</b> High-velocity jerk peaks exceeding baseline exploratory motion</li>
            </ul>
          </>
        )}
        <p><small><b>Clinical Guidance:</b> Automated movement flags assist frontline triage and milestone tracking. Formal neurodevelopmental diagnosis requires comprehensive pediatric medical examination and standardized clinical assessment (Bayley, GMFM).</small></p>
      </details>
    </>;
  }
  if (result.type==="gait") {
    const { data }=result;
    const isGreen = data.screening_status === "GREEN";
    const isYellow = data.screening_status === "YELLOW";
    const isRed = data.screening_status === "RED";
    const isRetake = data.screening_status === "RETAKE";

    const isOk = isGreen;
    const badgeBg = isOk ? "#e3f7ed" : isYellow ? "#fef3d6" : "#fee2e2";
    const badgeColor = isOk ? "#065f46" : isYellow ? "#92400e" : "#991b1b";
    const badgeBorder = isOk ? "#75e2b8" : isYellow ? "#fcd34d" : "#fca5a5";
    const badgeLabel = isOk
      ? "● OKAY — ALL PARAMETERS NORMAL"
      : isYellow
      ? "⚠️ PROBLEM DETECTED — REVIEW NEEDED"
      : isRed
      ? "⚠️ PROBLEM DETECTED — CLINICAL EVALUATION NEEDED"
      : "⚠️ RETAKE NEEDED";

    const overallVerdict = isOk
      ? "Normal Gait Dynamics — All Parameters Within Baseline"
      : isYellow
      ? "Review Suggested — Mild Gait Variation Detected"
      : isRed
      ? "Prompt Specialist Evaluation Recommended"
      : "Retake Needed — Insufficient Tracking Coverage";

    return <>
      <div className="result-summary">
        <span className="result-kicker">Pediatric Video Gait & Biomechanical Analysis</span>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", margin: "6px 0 10px" }}>
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "4px 12px",
            borderRadius: "999px",
            fontSize: "0.85rem",
            fontWeight: 800,
            background: badgeBg,
            color: badgeColor,
            border: `1px solid ${badgeBorder}`,
          }}>
            {badgeLabel}
          </span>
          <strong style={{ margin: 0, fontSize: "1.05rem" }}>{overallVerdict}</strong>
        </div>
        <p><b>Observed pattern:</b> {data.ml_classification?.predicted_condition?.replaceAll("_"," ") || data.triage_category || "Bilateral walking gait"}{data.ml_classification?.confidence ? ` (${data.ml_classification.confidence}% model confidence)` : ""}</p>
        {data.advice && <p><b>Suggested next step:</b> {data.advice}</p>}
        <p style={{ fontSize: "0.88rem", color: "#455d55" }}>
          Gait analysis integrates multi-point 3D kinematic tracking normalized to torso length with Butterworth filtered angular velocities.
        </p>
      </div>

      {/* Explicit Problem Analysis Card for Gait */}
      <div style={{
        background: isOk ? "#f0fdf4" : "#fff7ed",
        border: `1px solid ${isOk ? "#86efac" : "#fdba74"}`,
        borderRadius: "10px",
        padding: "14px 16px",
        margin: "14px 0",
        color: isOk ? "#166534" : "#9a3412",
        fontSize: "0.90rem",
        lineHeight: 1.5
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
          <span style={{ fontSize: "1.15rem" }}>{isOk ? "✅" : "⚠️"}</span>
          <strong style={{ fontSize: "0.98rem" }}>
            {isOk ? "Is this okay? Yes — Walking gait is symmetric and typical." : "Is this okay? No — Gait anomaly flagged for review."}
          </strong>
        </div>
        <p style={{ margin: "4px 0 6px" }}>
          <b>What is the problem?</b> {isOk ? "No gait abnormalities detected. Step symmetry, cadence, pelvic tilt, and knee swing trajectories are all within typical pediatric reference bands." : "The following gait issues were identified:"}
        </p>
        {data.clinical_flags && data.clinical_flags.length > 0 && (
          <ul style={{ margin: "4px 0 0", paddingLeft: "20px" }}>
            {data.clinical_flags.map((flag, i) => <li key={i} style={{ marginBottom: "3px" }}>{flag}</li>)}
          </ul>
        )}
      </div>

      <h3>Gait Biomechanical Telemetry</h3>
      <dl className="metrics">
        {Object.entries(data.metrics ?? {}).filter(([,v])=>typeof v==="number").map(([k,v]) => {
          const isGsi = k.includes("symmetry");
          const isTilt = k.includes("tilt") || k.includes("lean");
          const isNormal = isGsi ? v >= 0.85 : isTilt ? v <= 12 : true;
          return (
            <div key={k}>
              <dt style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span>{k.replaceAll("_"," ")}</span>
                <span style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: isNormal ? "#10b981" : "#f59e0b",
                }} title={isNormal ? "Normal" : "Review flag"} />
              </dt>
              <dd><strong>{v.toFixed(2)}</strong></dd>
              <small>{isGsi ? (v >= 0.85 ? "Symmetric (Normal: ≥0.85)" : "Asymmetric (<0.85)") : isTilt ? (v <= 12 ? "Normal (≤12°)" : "Elevated (>12°)") : "Kinematic feature"}</small>
            </div>
          );
        })}
      </dl>

      {(data.formula_explanations?.length > 0 || data.quality_gate) && (
        <details open style={{ marginTop: "16px" }}>
          <summary>Biomechanical Formulas & Quality Verification</summary>
          {data.formula_explanations?.length > 0 && (
            <ol style={{ paddingLeft: "20px", marginBottom: "12px" }}>
              {data.formula_explanations.map((item, i) => <li key={i} style={{ marginBottom: "4px" }}>{item}</li>)}
            </ol>
          )}
          {data.quality_gate && (
            <p style={{ fontSize: "0.85rem", color: "#4b5563" }}>
              <b>Quality Gate:</b> {data.quality_gate.resampled_frames_15hz} frames resampled at {data.quality_gate.effective_sampling_rate}. Filter: {data.quality_gate.filter_applied}.
            </p>
          )}
        </details>
      )}
      <details style={{ marginTop: "10px" }}><summary>Full technical report</summary><pre>{JSON.stringify(data,null,2)}</pre></details>
    </>;
  }
  const isAudioOk = (result.clipped || 0) < 50;
  const audioBadgeBg = isAudioOk ? "#e3f7ed" : "#fef3d6";
  const audioBadgeColor = isAudioOk ? "#065f46" : "#92400e";
  const audioBadgeBorder = isAudioOk ? "#75e2b8" : "#fcd34d";
  const audioBadgeLabel = isAudioOk ? "● OKAY — ACOUSTIC RECORDING NORMAL" : "⚠️ PROBLEM DETECTED — REVIEW NEEDED";

  return <>
    <div className="result-summary">
      <span className="result-kicker">Audio signal and sound events</span>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", margin: "6px 0 10px" }}>
        <span style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "4px 12px",
          borderRadius: "999px",
          fontSize: "0.85rem",
          fontWeight: 800,
          background: audioBadgeBg,
          color: audioBadgeColor,
          border: `1px solid ${audioBadgeBorder}`,
        }}>
          {audioBadgeLabel}
        </span>
        <strong style={{ margin: 0, fontSize: "1.05rem" }}>{isAudioOk ? "Clear Audio Signal" : "Acoustic Clipping / Distortion"}</strong>
      </div>
      <p>YAMNet recognizes general sound categories. These labels cannot diagnose asthma, infection, language delay, autism, hearing loss, or neurological conditions.</p>
    </div>

    {/* Explicit Problem Analysis Card */}
    <div style={{
      background: isAudioOk ? "#f0fdf4" : "#fff7ed",
      border: `1px solid ${isAudioOk ? "#86efac" : "#fdba74"}`,
      borderRadius: "10px",
      padding: "14px 16px",
      margin: "14px 0",
      color: isAudioOk ? "#166534" : "#9a3412",
      fontSize: "0.90rem",
      lineHeight: 1.5
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
        <span style={{ fontSize: "1.15rem" }}>{isAudioOk ? "✅" : "⚠️"}</span>
        <strong style={{ fontSize: "0.98rem" }}>
          {isAudioOk ? "Is this okay? Yes — Audio signal quality is clear." : "Is this okay? No — Recording distortion or clipping detected."}
        </strong>
      </div>
      <p style={{ margin: "4px 0 6px" }}>
        <b>What is the problem?</b> {isAudioOk ? "No excessive audio clipping or microphone saturation was detected. Sound levels are within linear dynamic range." : `Excessive digital clipping detected (${result.clipped} full-scale samples). Audio input was overloaded/distorted.`}
      </p>
    </div>

    <dl className="metrics">
      <div><dt>Analyzed</dt><dd>{result.duration.toFixed(1)} s</dd></div>
      <div><dt>Peak</dt><dd>{result.peak} dBFS</dd></div>
      <div><dt>RMS</dt><dd>{result.rms} dBFS</dd></div>
      <div><dt>Full-scale samples</dt><dd>{result.clipped}</dd></div>
    </dl>
    {result.note && <p>{result.note}</p>}
    {result.events.length>0 && <details open><summary>Sound-event timeline</summary><ol>{result.events.map((event,index)=><li key={index}>
      {Number.isFinite(event.time) && <button type="button" onClick={()=>{if(media.current) media.current.currentTime=event.time;}}>{event.time.toFixed(2)} s</button>} {event.scores.map(s=>`${s.label} ${Math.round(s.score*100)}%`).join(" · ")}
    </li>)}</ol></details>}
  </>;
}

export default function Home() {
  const [check,setCheck]=useState("eye"),[file,setFile]=useState(null),[url,setUrl]=useState(""),[demo,setDemo]=useState(false);
  const [busy,setBusy]=useState(false),[status,setStatus]=useState(""),[result,setResult]=useState(null);
  const [age,setAge]=useState(24),[quality,setQuality]=useState("Unreviewed"),[note,setNote]=useState(""),[marks,setMarks]=useState([]),[start,setStart]=useState(null),[reviewFinding,setReviewFinding]=useState("Not assessed");
  const [recording,setRecording]=useState(false);
  const [consent,setConsent]=useState(false),[childCode,setChildCode]=useState(""),[savedCapture,setSavedCapture]=useState(null);
  const [assessmentContext,setAssessmentContext]=useState(null);
  const [targetCoords, setTargetCoords] = useState(null);
  const [scleraCoords, setScleraCoords] = useState(null);
  const [pinMode, setPinMode] = useState("mucosa");
  const media=useRef(null), recorder=useRef(null), recordingTimer=useRef(null);
  const [channel,title,reference,instructions,why,criteria,source,kind]=protocols[check];
  const accepted=channel==="Audio"?"audio/*":channel==="Movement"?"video/*":"image/jpeg,image/png,image/webp";
  useEffect(()=>{
    if(!file){setUrl("");return;}
    const link=URL.createObjectURL(file); setUrl(link);
    return ()=>URL.revokeObjectURL(link);
  },[file]);
  useEffect(()=>{
    const params=new URLSearchParams(window.location.search),requested=params.get("check"),child=params.get("child");
    if(requested&&protocols[requested])setCheck(requested);
    if(child)setChildCode(child.toUpperCase());
    if(params.get("assessment"))setAssessmentContext({assessmentId:params.get("assessment"),taskId:params.get("task"),conditionIds:(params.get("conditions")||"").split(",").map(Number).filter(Boolean)});
  },[]);
  function resetCapture(input=null,useDemo=false) {
    setFile(input);setDemo(useDemo);setResult(null);setMarks([]);setStart(null);setStatus("");setQuality("Unreviewed");setNote("");setReviewFinding("Not assessed");setSavedCapture(null);
    setTargetCoords(null);setScleraCoords(null);setPinMode("mucosa");
  }
  function select(id) { setCheck(id); resetCapture(); }
  async function run(overrideTarget = null, overrideSclera = null) {
    setBusy(true);setResult(null);setStatus("Preparing analysis…");
    const tCoords = overrideTarget !== null ? (overrideTarget === false ? null : overrideTarget) : targetCoords;
    const sCoords = overrideSclera !== null ? (overrideSclera === false ? null : overrideSclera) : scleraCoords;
    try {
      setResult(await analyze({
        kind,
        check,
        file,
        media: media.current,
        demo,
        age,
        targetCoords: tCoords,
        scleraCoords: sCoords,
        progress: setStatus
      }));
      setStatus("Analysis complete.");
    }
    catch(error){setStatus(error.message);}
    finally{setBusy(false);}
  }
  function handleRetarget(x, y) {
    if (pinMode === "sclera") {
      setScleraCoords({ x, y });
      run(targetCoords, { x, y });
    } else {
      setTargetCoords({ x, y });
      run({ x, y }, scleraCoords);
    }
  }
  function handleResetPins() {
    setTargetCoords(null);
    setScleraCoords(null);
    run(false, false);
  }
  async function record() {
    if(recording){recorder.current?.stop();return;}
    setBusy(true);
    let stream;
    try {
      if(!consent) throw Error("Verify guardian consent before recording.");
      const constraints=channel==="Movement"?{video:{facingMode:"environment",width:{ideal:1280},height:{ideal:720}},audio:true}:{audio:true};
      stream=await navigator.mediaDevices.getUserMedia(constraints);
      const preferred=channel==="Movement"?"video/webm;codecs=vp9,opus":"audio/webm;codecs=opus";
      const options=MediaRecorder.isTypeSupported(preferred)?{mimeType:preferred}:undefined;
      const device=new MediaRecorder(stream,options),chunks=[];
      recorder.current=device;
      device.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
      device.onstop=()=>{
        clearTimeout(recordingTimer.current);stream.getTracks().forEach(track=>track.stop());setRecording(false);
        if(chunks.length){
          const extension=device.mimeType.includes("mp4")?"mp4":"webm";
          resetCapture(new File(chunks,`${channel==="Movement"?check:"microphone"}-recording.${extension}`,{type:device.mimeType}));
        }
      };
      device.start();setRecording(true);
      recordingTimer.current=setTimeout(()=>{if(device.state==="recording")device.stop();},channel==="Movement"?45000:30000);
    } catch(error){stream?.getTracks().forEach(track=>track.stop());setStatus(error.message);}
    finally{setBusy(false);}
  }
  async function saveCapture() {
    if(!file || demo){setStatus("Record or choose an original capture before saving.");return;}
    if(!consent){setStatus("Verify guardian consent before server storage.");return;}
    const code=childCode.trim().toUpperCase();
    if(!/^[A-Z0-9-]{2,32}$/.test(code)){setStatus("Enter a 2-32 character child code using letters, numbers, or hyphens.");return;}
    setBusy(true);setSavedCapture(null);setStatus("Saving evidence and evaluation…");
    try {
      const form=new FormData();
      form.append("media",file,file.name);form.append("assessment",check);form.append("child_code",code);form.append("consent","true");
      form.append("evaluation",JSON.stringify(result||{}));
      form.append("review",JSON.stringify({captureQuality:quality,reviewerFinding:kind==="review"?reviewFinding:undefined,reviewerNote:note,marks}));
      const duration=media.current?.duration;if(Number.isFinite(duration))form.append("duration_seconds",String(duration));
      const response=await fetch("/api/captures",{method:"POST",body:form});const payload=await response.json();
      if(!response.ok)throw Error(payload.detail||"The server could not store this evidence.");
      if(assessmentContext){
        const linked=await fetch(`/api/platform/assessments/${assessmentContext.assessmentId}/evidence`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({capture_id:payload.id,task_id:assessmentContext.taskId,media_kind:channel.toLowerCase()==="movement"?"video":channel.toLowerCase(),condition_ids:assessmentContext.conditionIds,metadata:{assessment:check,duration_seconds:duration},quality:{usable:quality!=="Retake needed",worker_rating:quality}})});
        const linkedBody=await linked.json();if(!linked.ok)throw Error(linkedBody.detail||"Evidence stored but could not be linked to the assessment.");
      }
      setSavedCapture(payload);setStatus("Evidence and evaluation saved on the server.");
    }catch(error){setStatus(error.message);}finally{setBusy(false);}
  }
  function mark(type) {
    const time=media.current?.currentTime;
    if(!Number.isFinite(time))return;
    if(type==="start"){setStart(time);return;}
    if(type==="end" && (start===null || time<=start)){setStatus("Move playback after the interval start.");return;}
    setMarks([...marks,type==="end"?{start,end:time,seconds:time-start}:{time}]);
    if(type==="end")setStart(null);
    setStatus("");
  }
  function download() {
    const blob=new Blob([JSON.stringify({assessment:check,source:demo?"Example":file?.name,captureQuality:quality,reviewerFinding:kind==="review"?reviewFinding:undefined,reviewerNote:note,marks,analysis:result},null,2)],{type:"application/json"});
    const uri=URL.createObjectURL(blob),link=document.createElement("a");link.href=uri;link.download=`assessment-${check}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(uri),1000);
  }
  const hasCapture=Boolean(url||demo);
  return <main className="shell">
    <header className="topbar">
      <a className="brand" href="/">
        <span className="logo">✚</span> medivia <span style={{fontSize:"11px",color:"#83968d",letterSpacing:0,fontWeight:700}}>/ ASSESSMENT LAB</span>
      </a>
      <span className="pill">● Child Health 4Ds</span>
    </header>
    <div className="workspace">
      <aside aria-label="Assessment library"><h2>Library</h2>{["Image","Movement","Audio"].map(group=><section key={group}>
        <h3>{group==="Movement"?"Full-body movement":group}</h3>{Object.entries(protocols).filter(([,p])=>p[0]===group).map(([id,p])=><button key={id} type="button" className={check===id?"chosen":""} aria-current={check===id?"true":undefined} disabled={busy||recording} onClick={()=>select(id)}>{p[1]}{(id==="bitot"||id==="pallor")&&<small style={{marginLeft:"6px",color:"#d97706",fontSize:"0.72rem",fontWeight:700}}>🚧</small>}</button>)}
      </section>)}</aside>
      <article>
        <div className="intro"><p className="eyebrow">{channel} assessment</p><h1>{title}</h1><p>{why}</p></div>
        {(check === "bitot" || check === "pallor") && (
          <div style={{
            padding: "14px 18px",
            borderRadius: "14px",
            background: "#fffbeb",
            border: "1px solid #fcd34d",
            color: "#78350f",
            marginBottom: "16px",
            display: "flex",
            alignItems: "flex-start",
            gap: "12px",
          }}>
            <span style={{ fontSize: "1.5rem", lineHeight: 1 }}>🚧</span>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <strong style={{ fontSize: "1.05rem", color: "#92400e" }}>Automatic Model Under Construction</strong>
                <span style={{
                  display: "inline-block",
                  fontSize: "0.72rem",
                  fontWeight: 800,
                  padding: "2px 8px",
                  borderRadius: "999px",
                  background: "#fef3c7",
                  border: "1px solid #f59e0b",
                  color: "#b45309",
                }}>
                  {check === "pallor" ? "HARDWARE & DATA CALIBRATION IN PROGRESS" : "DATA INSUFFICIENT"}
                </span>
              </div>
              <p style={{ margin: "5px 0 0", fontSize: "0.88rem", lineHeight: 1.45, color: "#92400e" }}>
                {check === "pallor"
                  ? "Automatic smartphone pallor measurement is currently under construction due to camera hardware non-linearities, uncalibrated room lighting, tear film glare, and eyelid pressure artifacts across consumer devices. In the interim, this check operates in Human Review Mode where healthcare workers visually inspect the capture and document observations, while definitive confirmation requires a clinical hemoglobin test (CBC or HemoCue)."
                  : "Automatic AI detection for conjunctival patches (Bitot's spots) is currently under construction due to insufficient verified clinical training data. In the interim, this check operates in Human Review Mode where healthcare workers visually inspect the capture and document observations."}
              </p>
            </div>
          </div>
        )}
        <div className="assessment">
          <section className="card"><h2>Capture reference</h2><figure><Reference kind={reference}/><figcaption>Illustrated framing guide</figcaption></figure><p>{instructions}</p>
            {examples[check]&&<figure><img className="referencePhoto" src={`/references/${examples[check]}.jpg`} alt={`${title} capture example`}/><figcaption>Example from the lab’s demo media</figcaption></figure>}
            <h3>Evaluation criteria</h3><p>{criteria}</p><a className="source" href={source} target="_blank" rel="noreferrer">Method reference ↗</a>
          </section>
          <section className="card"><h2>Your capture</h2>
            <div className="capture-consent">
              <label className="field">Child screening code<input value={childCode} maxLength={32} placeholder="DEMO-001" onChange={event=>setChildCode(event.target.value.toUpperCase())}/></label>
              <label className="consent-check"><input type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)}/> I verify guardian consent covers this capture and server storage.</label>
            </div>
            <label className="upload">Choose or capture {channel==="Image"?"photo":channel==="Audio"?"audio":"video"}<input key={check} type="file" accept={accepted} capture={channel==="Image"?"environment":undefined} disabled={busy||recording} onChange={event=>resetCapture(event.target.files[0]??null)}/></label>
            <div className="actions">
              {(kind==="gait"||kind==="clip"||kind==="audio"||check==="alignment"||check==="foot"||check==="pupil"||check==="pallor")&&<button disabled={busy||recording} onClick={()=>resetCapture(null,true)}>{(check==="alignment"||check==="pupil")?"Use frontal portrait example":check==="foot"?"Use standing full-body example":check==="pallor"?"Use eye close-up example":kind==="gait"?"Use walking example":kind==="clip"?"Use sample movement video":"Use calibration tone"}</button>}
              {(kind==="audio"||kind==="gait"||kind==="clip")&&<button disabled={busy||(!recording&&!consent)} onClick={record}>{recording?"Stop recording":channel==="Movement"?"Record camera + audio":"Record microphone"}</button>}
            </div>
            {url&&(channel==="Image"?<img ref={media} src={url} alt="Selected assessment capture"/>:channel==="Audio"?<audio ref={media} controls src={url}/>:<video ref={media} controls playsInline src={url}/>)}
            {demo&&check==="pallor"&&<img ref={media} src="/references/pallor_normal.jpg" alt="Example capture for conjunctival pallor review"/>}
            {demo&&(check==="alignment"||check==="pupil")&&<img ref={media} src="/references/face.jpg" alt="Example portrait for alignment and pupil screening"/>}
            {demo&&check==="foot"&&<img ref={media} src="/references/standing.jpg" alt="Example standing photo for foot geometry"/>}
            {demo&&(kind==="gait"||kind==="clip")&&<video ref={media} controls playsInline src="/samples/test_normal_gait.mp4"/>}
            {demo&&kind==="audio"&&<><audio ref={media} controls src="/references/tone.wav"/><p>Two-second, 440 Hz synthetic calibration tone.</p></>}
            {kind==="gait"&&<label className="field">Age in months<input type="number" min="1" max="216" value={age} onChange={event=>setAge(event.target.valueAsNumber||1)} disabled={busy}/></label>}
            {kind!=="review"&&<button className="primary" disabled={!hasCapture||busy||recording||(kind==="gait"&&(age<1||age>216))} onClick={run}>{busy?"Analyzing…":kind==="clip"?"Run movement evaluation":"Run assessment"}</button>}
            <p className="status" role="status">{status}</p>
          </section>
        </div>
        <section className="card results"><h2>Results and review</h2>
          {result?<Result result={result} media={media} onRetarget={handleRetarget} onResetPins={handleResetPins} pinMode={pinMode} setPinMode={setPinMode}/>:kind==="review"?<>{check==="pallor"?(
            <div className="result-summary" style={{ borderLeftColor: "#f59e0b", background: "#fffdf5" }}>
              <span className="result-kicker" style={{ color: "#d97706" }}>Model Under Construction</span>
              <strong>Hardware Calibration & Clinical Dataset in Progress</strong>
              <p>Automatic anemia detection from uncalibrated smartphone cameras is susceptible to ambient light temperature, tear reflections, and eyelid pressure artifacts. This check operates in Human Review Mode for clinical triage. Definitive anemia evaluation requires a complete blood count (CBC) or point-of-care hemoglobinometer.</p>
            </div>
          ):check==="bitot"?(
            <div className="result-summary" style={{ borderLeftColor: "#f59e0b", background: "#fffdf5" }}>
              <span className="result-kicker" style={{ color: "#d97706" }}>Model Under Construction</span>
              <strong>Insufficient Trained Clinical Model Data</strong>
              <p>Automatic detection cannot run on MediaPipe alone and requires specialized clinical training datasets currently in development. Healthcare workers may record observations and capture quality below.</p>
            </div>
          ):(
            <div className="result-summary"><span className="result-kicker">Human review only</span><strong>No automatic model for this check</strong><p>This screen records what a reviewer sees in this capture. It does not infer or rule out a condition.</p></div>
          )}{hasCapture&&<label className="field">Reviewer finding<select value={reviewFinding} onChange={event=>setReviewFinding(event.target.value)}><option>Not assessed</option><option>Possible finding seen — needs clinical review</option><option>No obvious finding seen in this capture</option><option>Unclear — retake or refer for review</option></select></label>}</>:kind==="clip"?<div className="result-summary"><span className="result-kicker">Movement milestone screening</span><strong>Run evaluation to view motor analysis</strong><p>Evaluates trunk stability, limb symmetry, joint angles, and movement patterns against WHO developmental motor standards.</p></div>:<p>Run this check to see the model or measurement result here. Switching checks clears the previous capture and result.</p>}
          <div className="review"><label className="field">Capture quality<select value={quality} onChange={event=>setQuality(event.target.value)}>{["Unreviewed","Usable","Unclear","Retake needed"].map(value=><option key={value}>{value}</option>)}</select></label>
          <label className="field">Reviewer observation<textarea value={note} onChange={event=>setNote(event.target.value)} placeholder="Describe the visible finding or movement…"/></label></div>
          {url&&channel!=="Image"&&<div className="actions"><button disabled={busy} onClick={()=>mark("instant")}>Mark current time</button><button disabled={busy} onClick={()=>mark("start")}>Start interval</button><button disabled={busy||start===null} onClick={()=>mark("end")}>End interval</button>{start!==null&&<span>Start at {start.toFixed(2)} s</span>}</div>}
          {marks.length>0&&<ol>{marks.map((value,i)=><li key={i}>{"time"in value?`Event at ${value.time.toFixed(2)} s`:`${value.start.toFixed(2)}–${value.end.toFixed(2)} s · ${value.seconds.toFixed(2)} s`}</li>)}</ol>}
          <div className="actions">
            <button onClick={download} disabled={!result&&!hasCapture&&!note.trim()}>Export assessment JSON</button>
            <button className="primary" onClick={saveCapture} disabled={!file||demo||busy||recording||!consent||!childCode.trim()}>Save evidence + evaluation</button>
          </div>
          {savedCapture&&<p className="saved-record"><strong>Saved evidence {savedCapture.id}</strong><br/>{Math.round(savedCapture.size_bytes/1024)} KB · SHA-256 {savedCapture.sha256.slice(0,12)}… · {new Date(savedCapture.created).toLocaleString()}</p>}
        </section>
      </article>
    </div>
  </main>;
}
