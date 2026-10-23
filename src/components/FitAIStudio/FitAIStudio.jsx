/**
 * FitAI Studio — virtual try-on with Threadly garment photos on a real 3D mannequin (single file).
 *
 * Install:  npm i react react-dom three      (three r152 or newer; tested logic with r160)
 * Usage:    import FitAIStudio from "./FitAIStudio.jsx";  ->  <FitAIStudio />
 *
 * Files you need in public/:
 *   public/models/mannequin.glb            (female mannequin, already used)
 *   public/models/mannequin_running.glb    (NEW male mannequin, textureless 1.4 MB build supplied in this bundle)
 *   public/teal.png navy.png brown.png green.png dress_blue.png dress_floral.png   (Threadly transparent cut-outs)
 *
 * HOW IT WORKS
 *  - REAL 3D HUMAN: loads a rigged GLB avatar (Mixamo-style skeleton). Height and weight in step 2 reshape the avatar.
 *  - THREADLY PHOTO GARMENTS ONLY: every garment is a Threadly product cut-out (or your own uploaded photo). The photo is
 *    anchored on the avatar's real shoulders, scaled to its torso length and drawn on a 2D overlay above the 3D canvas.
 *    The old lofted 3D cloth engine (and its "hide the avatar's clothes" step) has been removed.
 *  - LIVE TRY-ON: camera + MediaPipe pose; the same photo overlay follows your shoulders/hips (needs HTTPS or localhost).
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import React, { useEffect, useMemo, useRef, useState } from "react";

/* =====================================================================
   1. CONFIG
   ===================================================================== */
const RAW = "https://raw.githubusercontent.com/mrdoob/three.js/r160/examples/models/gltf/";
const JSD = "https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/models/gltf/";
const MODELS = [
  { id: "f1", g: "f", name: "Michelle", urls: [RAW + "Michelle.glb", JSD + "Michelle.glb"] },
  { id: "f2", g: "f", name: "Mannequin", urls: ["/models/mannequin.glb"] }, // User-provided neutral female mannequin GLB
  { id: "m1", g: "m", name: "Mannequin", urls: ["/models/mannequin_running.glb"] }, // Male mannequin (replaces Soldier + Xbot)
  // { id: "m3", g: "m", name: "My avatar", urls: ["/models/my-avatar.glb"] },
];
const defaultModelFor = (g) => (MODELS.find((x) => x.g === g) || MODELS[0]).id;

// Only garments that have a Threadly photo cut-out (see THREADLY_OVERLAYS below).  kind: top | dress.
const GARMENTS = [
  { id: "tee", name: "T-shirt", g: "m", kind: "top", mat: "cotton", w: { breath: 0.5 } },
  { id: "polo", name: "Polo", g: "m", kind: "top", mat: "cotton", w: { wrinkle: 1, drape: 0.5 } },
  { id: "shirt", name: "Oxford shirt", g: "m", kind: "top", mat: "cotton", w: { wrinkle: 1.5, breath: 0.5 } },
  { id: "ftee", name: "Fitted tee", g: "f", kind: "top", mat: "cotton", w: { breath: 0.5 } },
  { id: "blouse", name: "Silk blouse", g: "f", kind: "top", mat: "silk", w: { drape: 1, soft: 1 } },
  { id: "dress", name: "Midi dress", g: "f", kind: "dress", mat: "silk", w: { drape: 1.5 } },
  { id: "gown", name: "Evening gown", g: "f", kind: "dress", mat: "silk", w: { drape: 2, soft: 0.5 } },
  { id: "kurti", name: "Kurti", g: "f", kind: "dress", mat: "cotton", w: { drape: 1, breath: 0.8 } },
];

/* =====================================================================
   2. DATA + AI scoring (from the reference project)
   ===================================================================== */
const MATS = [
  { id: "cotton", name: "Cotton", feel: "Soft, breathable, easy to wash", t: { breath: 8, soft: 7, durable: 6, drape: 5, wrinkle: 4, warm: 4, stretch: 5 }, edge: 3.4, colors: ["#F2F0EA", "#1E2A44", "#6F7F4F", "#8DB4D6", "#D9A62E", "#15191A"] },
  { id: "linen", name: "Linen", feel: "Airy and cool, creases easily", t: { breath: 10, soft: 5, durable: 6, drape: 6, wrinkle: 2, warm: 2, stretch: 2 }, edge: 6.2, colors: ["#D8C9A8", "#F1EEE6", "#9DB09A", "#31456E", "#B0583A", "#3A3F40"] },
  { id: "denim", name: "Denim", feel: "Tough, structured, heavier", t: { breath: 4, soft: 3, durable: 10, drape: 3, wrinkle: 8, warm: 6, stretch: 3 }, edge: 5, colors: ["#2C3E66", "#5B7BA8", "#1B1F27", "#6D737A"] },
  { id: "silk", name: "Silk", feel: "Smooth with a light sheen", t: { breath: 6, soft: 9, durable: 3, drape: 10, wrinkle: 3, warm: 4, stretch: 3 }, edge: 1.2, colors: ["#7A1F35", "#136B52", "#D8C6A0", "#14213D", "#C98A98"] },
  { id: "wool", name: "Wool knit", feel: "Warm, springy, textured", t: { breath: 5, soft: 5, durable: 8, drape: 6, wrinkle: 8, warm: 10, stretch: 4 }, edge: 11, colors: ["#CDBFA3", "#3B4145", "#2F4A3A", "#6D2431", "#25324F"] },
  { id: "poly", name: "Sport polyester", feel: "Light, quick-drying, stretchy", t: { breath: 3, soft: 4, durable: 8, drape: 5, wrinkle: 9, warm: 4, stretch: 7 }, edge: 1.8, colors: ["#16191B", "#C0392B", "#2459C7", "#EDEDED", "#9ACD32"] },
];
const matOf = (id) => MATS.find((m) => m.id === id) || MATS[0];
const SK = ["S", "M", "L", "XL"];
const SIZE_CHEST = { S: 90, M: 98, L: 106, XL: 114 };
const FIT_MUL = { slim: 0.95, regular: 1, relaxed: 1.09 };
const CLIMATE = { hot: { breath: 3, warm: -2.5, soft: 1 }, mild: { breath: 1.5, soft: 1.5, durable: 1, drape: 1 }, cold: { warm: 3.5, durable: 1, soft: 1 } };
const OCC = { everyday: { soft: 1.5, durable: 1.5, breath: 1 }, office: { wrinkle: 2.5, drape: 1.5, soft: 1 }, sport: { breath: 2, stretch: 2.5, wrinkle: 1, warm: -1 }, party: { drape: 2.5, soft: 1.5, wrinkle: 0.5 } };
const GOOD = { breath: "breathes well", warm_p: "keeps you warm", warm_n: "stays light and cool", soft: "feels soft on skin", durable: "holds up to repeated washing", drape: "drapes smoothly on the body", wrinkle: "resists creases", stretch: "moves with you" };
const BAD = { breath: "can feel stuffy", warm_p: "may not be warm enough", warm_n: "runs warm", soft: "can feel rough on skin", durable: "wears out faster", drape: "hangs stiffly", wrinkle: "creases easily", stretch: "has little give" };

const SIZE_CHART = {
  S: { chest: 90, waist: 72, hip: 94, shoulder: 40 },
  M: { chest: 98, waist: 80, hip: 102, shoulder: 42 },
  L: { chest: 106, waist: 88, hip: 110, shoulder: 44 },
  XL: { chest: 114, waist: 96, hip: 118, shoulder: 46 },
};

// Style DNA is a transparent rule-based preference system, not a trained AI model.
const STYLE_DNA = {
  minimal: { label: "Minimal", description: "Clean silhouettes and versatile neutrals", mat: "cotton", climate: "mild", occ: "office", colors: ["#F2F0EA", "#1E2A44", "#15191A"] },
  streetwear: { label: "Streetwear", description: "Relaxed layers and confident contrast", mat: "denim", climate: "mild", occ: "everyday", colors: ["#15191A", "#5B7BA8", "#6F7F4F"] },
  elegant: { label: "Elegant", description: "Fluid fabrics and evening-ready colour", mat: "silk", climate: "mild", occ: "party", colors: ["#7A1F35", "#14213D", "#D8C6A0"] },
  active: { label: "Active", description: "Comfort-first pieces for movement", mat: "poly", climate: "hot", occ: "sport", colors: ["#16191B", "#2459C7", "#C0392B"] },
};
const FITAI_API_BASE = ""; // Optional: prefill with your backend URL in this constant, or enter it in the UI.
const FITAI_PROFILE_KEY = "fitai-studio:profile:v1";

function fitTargets(g, fit) {
  const relaxed = fit === "relaxed", slim = fit === "slim", dress = g.kind === "dress";
  return {
    chest: slim ? 4 : relaxed ? 14 : 8,
    waist: dress ? (slim ? 3 : relaxed ? 12 : 7) : null,
    hip: dress ? (slim ? 4 : relaxed ? 14 : 9) : null,
    shoulder: slim ? 0 : relaxed ? 4 : 2,
  };
}
function assessSizeFit(g, size, fit, measurements) {
  const chart = SIZE_CHART[size] || SIZE_CHART.M;
  const multiplier = FIT_MUL[fit] || 1;
  const targets = fitTargets(g, fit);
  const dimensions = ["chest", "waist", "hip", "shoulder"].filter((k) => targets[k] != null && Number.isFinite(+measurements?.[k]) && +measurements[k] > 0);
  if (!dimensions.length) return { score: null, label: "Add measurements", details: [], ease: null };
  const details = dimensions.map((key) => ({ key, body: +measurements[key], garment: Math.round(chart[key] * multiplier), ease: Math.round(chart[key] * multiplier - +measurements[key]), target: targets[key] }));
  const score = Math.round(details.reduce((sum, d) => sum + clamp(100 - Math.abs(d.ease - d.target) * 5, 0, 100), 0) / details.length);
  const minEase = Math.min(...details.map((d) => d.ease - d.target));
  const maxEase = Math.max(...details.map((d) => d.ease - d.target));
  const label = maxEase < -3 ? "Likely tight" : minEase > 7 ? "Likely loose" : minEase < -3 ? "May feel snug" : maxEase > 7 ? "Roomy fit" : "Closest fit";
  return { score, label, details, ease: details.find((d) => d.key === "chest")?.ease ?? details[0]?.ease ?? null };
}
function recommendSize(g, fit, measurements) {
  if (!measurements || !["chest", "waist", "hip"].some((k) => Number.isFinite(+measurements[k]) && +measurements[k] > 0)) return null;
  return SK.map((size) => ({ size, ...assessSizeFit(g, size, fit, measurements) }))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || SK.indexOf(a.size) - SK.indexOf(b.size))[0];
}
function analyse(st, g, measurements) {
  const w = {};
  [CLIMATE[st.climate], OCC[st.occ], g.w || {}].forEach((o) => { for (const k in o) w[k] = (w[k] || 0) + o[k]; });
  const list = MATS.map((m) => {
    let raw = 0, max = 0; const parts = [];
    for (const k in w) { const wt = w[k], a = Math.abs(wt), val = wt >= 0 ? m.t[k] : 10 - m.t[k]; raw += a * val; max += a * 10; parts.push({ k: k === "warm" ? (wt >= 0 ? "warm_p" : "warm_n") : k, val, gain: a * val, loss: a * (10 - val) }); }
    return { m, score: Math.round((raw / max) * 100), parts };
  });
  const sel = list.find((x) => x.m.id === st.mat) || list[0];
  const bestFit = recommendSize(g, st.profile.fit, measurements);
  // Keep the legacy height/weight estimate only until a measured body or manual measurements are available.
  const h = +st.profile.height || 170, wt = +st.profile.weight || 65, f = g.g === "f";
  const fallback = wt + (h - (f ? 160 : 170)) * 0.35;
  let ri = f ? (fallback < 46 ? 0 : fallback < 58 ? 1 : fallback < 70 ? 2 : 3) : fallback < 56 ? 0 : fallback < 70 ? 1 : fallback < 84 ? 2 : 3;
  if (st.profile.fit === "relaxed") ri = Math.min(3, ri + 1);
  const rec = bestFit?.size || SK[ri];
  const selectedFit = assessSizeFit(g, st.size, st.profile.fit, measurements);
  const sizeScore = selectedFit.score == null ? (SK.indexOf(st.size) === ri ? 100 : Math.abs(SK.indexOf(st.size) - ri) === 1 ? 76 : 42) : selectedFit.score;
  const sizeLabel = selectedFit.score == null ? "Add measurements" : selectedFit.label;
  return { list, sel, rec, sizeLabel, sizeScore, fitDetails: selectedFit.details, recommendedFit: bestFit, overall: Math.round(sel.score * 0.75 + sizeScore * 0.25) };
}

/* =====================================================================
   3. 2D helpers: Threadly overlays, photo cut-out, tint, fabric reading
   ===================================================================== */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, k) => a + (b - a) * k;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mk = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
const hex2rgb = (h) => { const n = parseInt(h.replace("#", ""), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgb2hex = (r, g, b) => "#" + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("");
function loadImage(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    if (!src.startsWith("blob:") && !src.startsWith("data:")) im.crossOrigin = "anonymous";
    im.onload = () => res(im); im.onerror = () => rej(new Error("image failed"));
    im.src = src;
  });
}

// Threadly product cut-outs (transparent PNGs in public/).
// L / R = left and right SHOULDER anchor points inside the image (pixels). type: top | dress.
// lenK = dress length in torso-lengths below the shoulder (midi about 2.2, knee about 1.95, floor about 2.7).
const THREADLY_OVERLAYS = {
  shirt: { file: "navy.png", L: [52, 60], R: [308, 60], type: "top" },
  tee: { file: "teal.png", L: [65, 70], R: [335, 70], type: "top" },
  polo: { file: "brown.png", L: [100, 72], R: [378, 72], type: "top" },
  ftee: { file: "green.png", L: [62, 88], R: [352, 88], type: "top" },
  blouse: { file: "green.png", L: [62, 88], R: [352, 88], type: "top" },
  dress: { file: "dress_blue.png", L: [48, 42], R: [196, 40], type: "dress", lenK: 2.2 },
  gown: { file: "dress_floral.png", L: [65, 45], R: [228, 45], type: "dress", lenK: 2.7 },
  kurti: { file: "dress_blue.png", L: [48, 42], R: [196, 40], type: "dress", lenK: 1.95 },
};
// anchors for a photo the user uploads (already cropped to the garment)
const uploadMeta = (cv, kind) => kind === "dress"
  ? { L: [cv.width * 0.28, cv.height * 0.03], R: [cv.width * 0.72, cv.height * 0.03], type: "dress", lenK: 2.1 }
  : { L: [cv.width * 0.17, cv.height * 0.06], R: [cv.width * 0.83, cv.height * 0.06], type: "top" };
const SIZE_SCALE = { S: 0.92, M: 1, L: 1.08, XL: 1.16 };
const FIT_SCALE = { slim: 0.94, regular: 1, relaxed: 1.07 };

// size the 2D overlay canvas for the current host and clear it; returns a context already scaled to CSS pixels
function sizeOverlayCanvas(canvas, cw, ch) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(cw * dpr)), h = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(w / Math.max(1, cw), 0, 0, h / Math.max(1, ch), 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  return ctx;
}

/**
 * Draw one Threadly garment photo.
 *  mid, hip   : shoulder-centre and hip-centre in canvas CSS pixels
 *  swFront    : shoulder width in px as seen from the FRONT (drives the garment width)
 *  frontFrac  : 0..1, how much of that width is visible (1 = facing the viewer, less when the avatar is turned)
 *  angle      : shoulder-line rotation in radians
 */
function drawGarmentOverlay(ctx, image, meta, p) {
  const { mid, hip, swFront, frontFrac = 1, angle = 0, alpha = 1, size = "M", fit = "regular", lenAdj = 1 } = p;
  const iw = image.naturalWidth || image.width, ih = image.naturalHeight || image.height;
  if (!iw || !ih || !(swFront >= 8) || frontFrac < 0.05 || alpha <= 0.01) return;
  const torso = Math.max(swFront * 0.7, Math.hypot(hip.x - mid.x, hip.y - mid.y));
  const srcWidth = Math.max(1, meta.R[0] - meta.L[0]);
  const sizeScale = SIZE_SCALE[size] || 1, fitScale = FIT_SCALE[fit] || 1;
  const sxFull = (swFront * 1.04 * sizeScale * fitScale) / srcWidth;
  const sx = sxFull * frontFrac;
  const syRaw = meta.type === "dress" ? (torso * (meta.lenK || 2.2) * sizeScale * lenAdj) / Math.max(1, ih - meta.L[1]) : sxFull * 1.04 * lenAdj;
  const sy = clamp(syRaw, sxFull * 0.6, sxFull * 2.4); // never let a photo stretch absurdly
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(mid.x, mid.y + swFront * 0.035);
  ctx.rotate(angle);
  ctx.scale(sx, sy);
  ctx.shadowColor = "rgba(0,0,0,.25)"; ctx.shadowBlur = swFront * 0.05; ctx.shadowOffsetY = swFront * 0.02;
  ctx.drawImage(image, -(meta.L[0] + meta.R[0]) / 2, -meta.L[1]);
  ctx.restore();
}

const patCache = new Map();
function weavePattern(matId) {
  if (patCache.has(matId)) return patCache.get(matId);
  const s = 128, c = mk(s, s), x = c.getContext("2d"), rnd = Math.random;
  x.fillStyle = "#808080"; x.fillRect(0, 0, s, s);
  if (matId === "denim") { for (let y = 0; y < s; y += 2) for (let i = 0; i < s; i += 2) { x.fillStyle = (i + y) % 6 < 3 ? "rgba(0,0,0,.2)" : "rgba(255,255,255,.22)"; x.fillRect(i, y, 2, 2); } }
  else if (matId === "linen") { for (let i = 0; i < 380; i++) { x.strokeStyle = rnd() > 0.5 ? `rgba(255,255,255,${0.1 + rnd() * 0.25})` : `rgba(0,0,0,${0.1 + rnd() * 0.25})`; x.lineWidth = 1 + rnd() * 1.5; const px = rnd() * s, py = rnd() * s, l = 8 + rnd() * 26; x.beginPath(); x.moveTo(px, py); rnd() > 0.5 ? x.lineTo(px + l, py) : x.lineTo(px, py + l); x.stroke(); } }
  else if (matId === "wool") { for (let y = 0; y < s; y += 8) for (let i = 0; i < s; i += 6) { x.fillStyle = "rgba(0,0,0,.3)"; x.fillRect(i, y, 2, 6); x.fillStyle = "rgba(255,255,255,.28)"; x.fillRect(i + 2, y + 1, 3, 5); } }
  else if (matId === "silk") { for (let i = -s; i < s * 2; i += 6) { x.strokeStyle = i % 12 ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.08)"; x.lineWidth = 2; x.beginPath(); x.moveTo(i, 0); x.lineTo(i + s, s); x.stroke(); } }
  else { for (let y = 0; y < s; y += 3) for (let i = 0; i < s; i += 3) { x.fillStyle = (i / 3 + y / 3) % 2 ? "rgba(255,255,255,.1)" : "rgba(0,0,0,.1)"; x.fillRect(i, y, 2, 2); } }
  patCache.set(matId, c);
  return c;
}

function removeBackground(cv) {
  const x = cv.getContext("2d"), { width: w, height: h } = cv, id = x.getImageData(0, 0, w, h), d = id.data;
  if (d[3] < 10 && d[(w - 1) * 4 + 3] < 10) return cv;
  const px = (i) => [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]];
  const cs = [0, w - 1, (h - 1) * w, h * w - 1].map(px), bg = [0, 1, 2].map((k) => cs.reduce((a, c) => a + c[k], 0) / 4);
  const seen = new Uint8Array(w * h), st = [];
  const push = (i) => { if (seen[i]) return; const p = px(i); if (Math.hypot(p[0] - bg[0], p[1] - bg[1], p[2] - bg[2]) < 46) { seen[i] = 1; st.push(i); } };
  for (let i = 0; i < w; i++) { push(i); push((h - 1) * w + i); }
  for (let j = 0; j < h; j++) { push(j * w); push(j * w + w - 1); }
  while (st.length) { const i = st.pop(), cx = i % w, cy = (i / w) | 0; if (cx > 0) push(i - 1); if (cx < w - 1) push(i + 1); if (cy > 0) push(i - w); if (cy < h - 1) push(i + w); }
  for (let i = 0; i < w * h; i++) if (seen[i]) d[i * 4 + 3] = 0;
  for (let y = 1; y < h - 1; y++) for (let i = 1; i < w - 1; i++) { const p = y * w + i; if (!seen[p] && (seen[p - 1] || seen[p + 1] || seen[p - w] || seen[p + w])) d[p * 4 + 3] = 140; }
  x.putImageData(id, 0, 0); return cv;
}
function cropToContent(cv) {
  const x = cv.getContext("2d"), { width: w, height: h } = cv, d = x.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) if (d[(y * w + i) * 4 + 3] > 40) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 <= x0 || y1 <= y0) return cv;
  const o = mk(x1 - x0 + 1, y1 - y0 + 1); o.getContext("2d").drawImage(cv, x0, y0, o.width, o.height, 0, 0, o.width, o.height); return o;
}
// user photo -> transparent cut-out cropped to the garment
function cutOutPhoto(photo) {
  const k = Math.min(1, 1024 / Math.max(photo.width, photo.height));
  const cv = mk(Math.round(photo.width * k), Math.round(photo.height * k));
  cv.getContext("2d").drawImage(photo, 0, 0, cv.width, cv.height);
  return cropToContent(removeBackground(cv));
}
// same size as the source (so the Threadly anchor points stay valid), recoloured by luminance, alpha preserved
function tintImage(img, color) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const cv = mk(w, h), x = cv.getContext("2d");
  x.drawImage(img, 0, 0);
  const id = x.getImageData(0, 0, w, h), d = id.data;
  let sum = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 100) { sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; n++; }
  const mean = sum / Math.max(1, n) || 128, [r, g, b] = hex2rgb(color);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const l = clamp((0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / mean, 0.25, 1.9);
    d[i] = clamp(r * l, 0, 255); d[i + 1] = clamp(g * l, 0, 255); d[i + 2] = clamp(b * l, 0, 255);
  }
  x.putImageData(id, 0, 0); return cv;
}

function readFabric(base, W, H) {
  const rx = Math.round(W * 0.3), ry = Math.round(H * 0.45), rw = Math.round(W * 0.4), rh = Math.round(H * 0.3);
  const s = mk(64, 64), sc = s.getContext("2d"); sc.drawImage(base, rx, ry, rw, rh, 0, 0, 64, 64);
  const d = sc.getImageData(0, 0, 64, 64).data, lum = new Float32Array(4096);
  let sr = 0, sg = 0, sb = 0, ml = 0;
  for (let i = 0; i < 4096; i++) { sr += d[i * 4]; sg += d[i * 4 + 1]; sb += d[i * 4 + 2]; lum[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; ml += lum[i]; }
  sr /= 4096; sg /= 4096; sb /= 4096; ml /= 4096;
  let vr = 0; for (let i = 0; i < 4096; i++) vr += (lum[i] - ml) ** 2;
  const sd = Math.sqrt(vr / 4096); let eg = 0;
  for (let y = 0; y < 63; y++) for (let x = 0; x < 63; x++) { const p = y * 64 + x; eg += Math.abs(lum[p] - lum[p + 1]) + Math.abs(lum[p] - lum[p + 64]); }
  eg /= 63 * 63 * 2;
  const blue = sb > sr + 16 && ml < 135;
  const sc2 = MATS.map((m) => { const dd = m.edge - eg; let v = Math.exp(-(dd * dd) / (2 * 2.4 * 2.4)); if (m.id === "denim") v *= blue ? 1.6 : 0.45; if (m.id === "silk" && sd > 24) v *= 1.3; return v; });
  const tot = sc2.reduce((a, b) => a + b, 0); let bi = 0; sc2.forEach((v, j) => { if (v > sc2[bi]) bi = j; });
  return { mat: MATS[bi].id, color: rgb2hex(sr, sg, sb), conf: Math.round((sc2[bi] / tot) * 100), bars: MATS.map((m, j) => ({ n: m.name, v: Math.round((sc2[j] / tot) * 100) })) };
}

/* =====================================================================
   4. BODY ANALYSIS — measure the real skinned avatar
   ===================================================================== */
const V3 = THREE.Vector3;
// Normalize common humanoid naming conventions to FitAI Studio's canonical bone names.
// Supports Mixamo (incl. "mixamorig1:Hips_01" / three.js-sanitised "mixamorig1Hips_01"), Ready Player Me, Character Creator.
const cleanName = (rawName) => {
  const n = String(rawName || "").replace(/^.*mixamorig\d*[:_]?/i, "").replace(/^(Armature|Genesis\d*)[_.:]?/i, "");
  const compact = n.replace(/[^a-z0-9]/gi, "").toLowerCase();
  const cc = compact.replace(/^ccbase/, "");
  const aliases = [
    [/^(hips|pelvis|hip|ccbasepelvis|ccbasehip)\d*$/, "Hips"],
    [/^(neck|necktwist0?1|necktwist0?2)\d*$/, "Neck"],
    [/^(leftarm|larm|upperarml|lupperarm|lupperarmtwist0?1|lupperarmtwist0?2)\d*$/, "LeftArm"],
    [/^(rightarm|rarm|upperarmr|rupperarm|rupperarmtwist0?1|rupperarmtwist0?2)\d*$/, "RightArm"],
    [/^(leftforearm|forearml|lforearm|lforearmtwist0?1|lforearmtwist0?2)\d*$/, "LeftForeArm"],
    [/^(rightforearm|forearmr|rforearm|rforearmtwist0?1|rforearmtwist0?2)\d*$/, "RightForeArm"],
    [/^(lefthand|handl|lhand)\d*$/, "LeftHand"],
    [/^(righthand|handr|rhand)\d*$/, "RightHand"],
    [/^(leftupleg|leftthigh|thighl|lthigh|lthightwist0?1|lthightwist0?2)\d*$/, "LeftUpLeg"],
    [/^(rightupleg|rightthigh|thighr|rthigh|rthightwist0?1|rthightwist0?2)\d*$/, "RightUpLeg"],
    [/^(leftleg|leftcalf|calfl|lcalf|lcalftwist0?1|lcalftwist0?2)\d*$/, "LeftLeg"],
    [/^(rightleg|rightcalf|calfr|rcalf|rcalftwist0?1|rcalftwist0?2)\d*$/, "RightLeg"],
    [/^(leftfoot|footl|lfoot)\d*$/, "LeftFoot"],
    [/^(rightfoot|footr|rfoot)\d*$/, "RightFoot"],
    [/^(leftshoulder|shoulderl|lclavicle|claviclel)\d*$/, "LeftShoulder"],
    [/^(rightshoulder|shoulderr|rclavicle|clavicler)\d*$/, "RightShoulder"],
  ];
  for (const [re, canonical] of aliases) {
    if (re.test(compact) || re.test(cc)) return canonical;
  }
  // Character Creator uses CC_Base_L_/CC_Base_R_ prefixes and numeric suffixes.
  // Keep non-required bones readable for body-region classification.
  let readable = n.replace(/^CC_Base_/i, "").replace(/^CC_Base/i, "");
  readable = readable.replace(/^L_/, "Left").replace(/^R_/, "Right");
  readable = readable.replace(/\d+$/g, "").replace(/_/g, "");
  return readable || n;
};
const G = { head: 0, neck: 1, sh: 2, armL: 3, armR: 4, legL: 5, legR: 6, torso: 7 };
function groupOf(n) {
  const side = /^Left/i.test(n) ? "L" : /^Right/i.test(n) ? "R" : "";
  if (/Head|Eye|Jaw|Teeth|Tongue/i.test(n)) return G.head;
  if (/Neck/i.test(n)) return G.neck;
  if (/Shoulder/i.test(n)) return G.sh;
  if (/Arm|Hand/i.test(n)) return side === "R" ? G.armR : G.armL;
  if (/Leg|Foot|Toe/i.test(n)) return side === "R" ? G.legR : G.legL;
  return G.torso;
}
const REQUIRED = ["Hips", "Neck", "LeftArm", "RightArm", "LeftForeArm", "RightForeArm", "LeftHand", "RightHand", "LeftUpLeg", "RightUpLeg", "LeftLeg", "RightLeg", "LeftFoot", "RightFoot"];

// BufferAttribute and InterleavedBufferAttribute both have getX/Y/Z/W, but not every three version has getComponent
const attrAt = (a, i, k) => (k === 0 ? a.getX(i) : k === 1 ? a.getY(i) : k === 2 ? a.getZ(i) : a.getW(i));

export function collectBones(root) {
  const bones = {}, meshes = [];
  root.traverse((o) => {
    if (o.isBone) {
      const canonical = cleanName(o.name);
      // Prefer primary joints over twist/helper joints that normalize to the same name.
      const isHelper = /twist|sharebone|end/i.test(o.name);
      if (!bones[canonical] || (!isHelper && /twist|sharebone|end/i.test(bones[canonical].name))) bones[canonical] = o;
    }
    if (o.isSkinnedMesh) meshes.push(o);
  });
  const miss = REQUIRED.filter((n) => !bones[n]);
  if (miss.length) throw new Error("This avatar needs a humanoid rig (Mixamo or Ready Player Me). Missing: " + miss.join(", "));
  if (!meshes.length) throw new Error("This avatar has no skinned mesh.");
  return { bones, meshes };
}

// rotate the arms from T-pose down into a relaxed A-pose (works for any rig orientation)
export function poseArmsDown(root, degOut = 16) {
  const { bones } = collectBones(root);
  root.updateMatrixWorld(true);
  ["Left", "Right"].forEach((s) => {
    const arm = bones[s + "Arm"], fore = bones[s + "ForeArm"];
    const a = arm.getWorldPosition(new V3()), e = fore.getWorldPosition(new V3());
    const dir = e.sub(a).normalize();
    const out = Math.sign(dir.x) || 1;
    const target = new V3(out * Math.sin(degOut * Math.PI / 180), -Math.cos(degOut * Math.PI / 180), 0.0).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(dir, target);
    const wq = arm.getWorldQuaternion(new THREE.Quaternion());
    const pq = arm.parent.getWorldQuaternion(new THREE.Quaternion());
    arm.quaternion.copy(pq.clone().invert().multiply(q).multiply(wq));
    arm.updateMatrixWorld(true);
  });
  root.updateMatrixWorld(true);
}

const perim = (rx, rz) => Math.PI * (3 * (rx + rz) - Math.sqrt((3 * rx + rz) * (rx + 3 * rz))) * 100 * 0.94; // cm, estimate

// works on any three version: new (getVertexPosition) -> r151+ (applyBoneTransform) -> old (boneTransform)
function vertexPos(m, i, target) {
  if (typeof m.getVertexPosition === "function") return m.getVertexPosition(i, target);
  target.fromBufferAttribute(m.geometry.attributes.position, i);
  if (typeof m.applyBoneTransform === "function") m.applyBoneTransform(i, target);
  else if (typeof m.boneTransform === "function") m.boneTransform(i, target);
  return target;
}

export function analyzeBody(root) {
  root.updateMatrixWorld(true);
  const { bones, meshes } = collectBones(root);
  meshes.forEach((m) => { m.skeleton.update(); });
  const P = [], Gp = [], v = new V3();
  for (const m of meshes) {
    const g = m.geometry, n = g.attributes.position.count, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    if (!si || !sw) continue;
    const names = m.skeleton.bones.map((b) => cleanName(b.name));
    for (let i = 0; i < n; i++) {
      vertexPos(m, i, v); v.applyMatrix4(m.matrixWorld);
      let best = 0, bw = -1; for (let k = 0; k < 4; k++) { const w = attrAt(sw, i, k); if (w > bw) { bw = w; best = k; } }
      P.push(v.x, v.y, v.z); Gp.push(groupOf(names[attrAt(si, i, best)] || ""));
    }
  }
  const N = Gp.length; if (!N) throw new Error("Avatar has no skin weights.");
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < N; i++) { const y = P[i * 3 + 1]; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const H = maxY - minY;
  const wp = (n) => bones[n].getWorldPosition(new V3());
  const B = { Hips: wp("Hips"), Neck: wp("Neck"), LA: wp("LeftArm"), RA: wp("RightArm"), LU: wp("LeftUpLeg"), RU: wp("RightUpLeg"), LN: wp("LeftFoot"), RN: wp("RightFoot") };
  const hipY = (B.LU.y + B.RU.y) / 2, shoulderY = (B.LA.y + B.RA.y) / 2;
  const chestY = shoulderY - 0.105 * H, waistY = lerp(hipY, shoulderY, 0.35), measureHipY = hipY - 0.05 * H;
  // Measure only torso/neck-weighted vertices at each landmark so arms and legs don't inflate the circumference.
  // A robust central percentile reduces the effect of isolated stray vertices on stylised avatars.
  // withLegs: at hip height the thighs ARE the hip width (the pelvis alone measures far too small)
  const torsoSection = (targetY, withLegs) => {
    for (const band of [0.012, 0.022, 0.035, 0.06]) {
      const xs = [], zs = [];
      for (let i = 0; i < N; i++) {
        const gp = Gp[i];
        if (gp !== G.torso && gp !== G.neck && !(withLegs && (gp === G.legL || gp === G.legR))) continue;
        const y = P[i * 3 + 1];
        if (Math.abs(y - targetY) <= H * band) { xs.push(P[i * 3]); zs.push(P[i * 3 + 2]); }
      }
      if (xs.length >= 12) {
        const quantile = (a, q) => { a.sort((u, v) => u - v); return a[Math.floor((a.length - 1) * q)]; };
        const minX = quantile(xs.slice(), 0.03), maxX = quantile(xs.slice(), 0.97);
        const minZ = quantile(zs.slice(), 0.03), maxZ = quantile(zs.slice(), 0.97);
        return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, rx: Math.max(0.005, (maxX - minX) / 2), rz: Math.max(0.005, (maxZ - minZ) / 2) };
      }
    }
    return { cx: (B.LA.x + B.RA.x) / 2, cz: B.Hips.z, rx: 0.1 * H, rz: 0.06 * H }; // last resort
  };
  const chestE = torsoSection(chestY), waistE = torsoSection(waistY), hipE = torsoSection(measureHipY, true);
  return {
    H, minY, hipY, shoulderY, neckY: B.Neck.y, ankleY: (B.LN.y + B.RN.y) / 2, B,
    shoulderW: Math.abs(B.LA.x - B.RA.x) + 0.06, hipW: Math.abs(B.LU.x - B.RU.x),
    cx: (B.LA.x + B.RA.x) / 2, cz: chestE.cz,
    chestCm: perim(chestE.rx, chestE.rz), waistCm: perim(waistE.rx, waistE.rz), hipCm: perim(hipE.rx, hipE.rz),
  };
}

/* =====================================================================
   5. STAGE ENGINE (three.js) — avatar, lights, camera, photo overlay, live try-on
   ===================================================================== */
const MP_VER = "0.10.14";
const MP_BUNDLE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/vision_bundle.mjs`;
const MP_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/wasm`;
const MP_MODEL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
const THEMES = {
  milan: { key: [0xfff0d6, 2.4], fill: [0x9cb0e8, 0.7], rim: [0xffe0a8, 2.0], exp: 1.0 },
  daylight: { key: [0xffffff, 2.6], fill: [0xd0e4ff, 1.2], rim: [0xffffff, 1.2], exp: 1.05 },
  golden: { key: [0xffb35e, 2.8], fill: [0x6b5a7b, 0.6], rim: [0xffd699, 2.4], exp: 1.0 },
  minimal: { key: [0xfaf7fa, 2.2], fill: [0xdddddd, 1.0], rim: [0xe0e0e0, 0.9], exp: 1.1 },
};
// the garment photo is a FRONT view, so every preset except side/back looks straight at the avatar
const PRESETS = { full: { az: 0, el: 4, d: 2.45, ty: 0.5 }, front: { az: 0, el: 3, d: 1.75, ty: 0.6 }, threeQuarter: { az: 38, el: 5, d: 1.9, ty: 0.56 }, side: { az: 90, el: 4, d: 1.9, ty: 0.56 }, back: { az: 180, el: 4, d: 1.9, ty: 0.56 }, detail: { az: 0, el: 4, d: 1.0, ty: 0.7 } };

let poseLoader = null;
function loadPose() {
  if (poseLoader) return poseLoader;
  poseLoader = (async () => {
    const vision = await import(/* @vite-ignore */ /* webpackIgnore: true */ MP_BUNDLE);
    const fs = await vision.FilesetResolver.forVisionTasks(MP_WASM);
    const o = (delegate) => ({ baseOptions: { modelAssetPath: MP_MODEL, delegate }, runningMode: "VIDEO", numPoses: 1 });
    try { return await vision.PoseLandmarker.createFromOptions(fs, o("GPU")); } catch { return vision.PoseLandmarker.createFromOptions(fs, o("CPU")); }
  })();
  poseLoader.catch(() => { poseLoader = null; });
  return poseLoader;
}

function createStage(canvas, overlayCanvas, host, cb) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
  if ("outputColorSpace" in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace; else renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  if ("environmentIntensity" in scene) scene.environmentIntensity = 0.55;
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 60);

  const key = new THREE.DirectionalLight(0xffffff, 2.4); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
  const fill = new THREE.DirectionalLight(0xffffff, 0.7), rim = new THREE.DirectionalLight(0xffffff, 2);
  const hemi = new THREE.HemisphereLight(0x9a9ab8, 0x2a2420, 0.5);
  scene.add(key, key.target, fill, rim, hemi);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: 0.4 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const pedestal = new THREE.Group(); scene.add(pedestal);
  const modelHolder = new THREE.Group(); scene.add(modelHolder);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.enablePan = false; controls.autoRotateSpeed = 1.6;
  let tween = null; controls.addEventListener("start", () => { tween = null; });

  // Neutral, fully opaque studio-mannequin material shared by every avatar, so the garment photo is the only colour on the body.
  const skinMat = new THREE.MeshStandardMaterial({
    color: 0xc8c7c4, roughness: 0.78, metalness: 0, transparent: false, opacity: 1,
    depthWrite: true, side: THREE.FrontSide,
  });
  skinMat.userData.shared = true;
  const S = { root: null, bind: new Map(), body: null, overlay: null, ar: false, video: null, lmk: null, lastVideoTime: -1, lastOk: 0, arPts: null, bodyParams: { heightCm: 170, widthF: 1 }, theme: "milan", disposed: false, loadTok: 0 };

  const setTheme = (name) => {
    S.theme = name; const t = THEMES[name] || THEMES.milan;
    key.color.setHex(t.key[0]); key.intensity = t.key[1]; fill.color.setHex(t.fill[0]); fill.intensity = t.fill[1]; rim.color.setHex(t.rim[0]); rim.intensity = t.rim[1];
    renderer.toneMappingExposure = t.exp;
  };
  const resize = () => {
    const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  };
  const ro = new ResizeObserver(resize); ro.observe(host); resize();

  function layoutStage(H) {
    key.position.set(H * 1.6, H * 2.4, H * 1.8); key.target.position.set(0, H * 0.5, 0);
    const sc = key.shadow.camera; sc.left = -H; sc.right = H; sc.top = H * 1.4; sc.bottom = -H * 0.3; sc.near = 0.1; sc.far = H * 8; sc.updateProjectionMatrix();
    fill.position.set(-H * 1.8, H * 1.2, H * 1.4); rim.position.set(-H * 1.2, H * 1.8, -H * 1.8);
    pedestal.clear();
    const top = new THREE.Mesh(new THREE.CylinderGeometry(H * 0.36, H * 0.38, 0.05, 72), new THREE.MeshStandardMaterial({ color: 0x15121f, roughness: 0.5, metalness: 0.2 })); top.position.y = -0.025; top.receiveShadow = true; pedestal.add(top);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(H * 0.375, 0.008, 12, 96), new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.25, metalness: 0.9 })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.001; pedestal.add(ring);
    floor.position.y = -0.05;
  }
  function setPreset(name, instant) {
    const p = PRESETS[name] || PRESETS.full, H = S.body ? S.body.H : 1.7, az = (p.az * Math.PI) / 180, el = (p.el * Math.PI) / 180, d = p.d * H;
    const tgt = new V3(0, p.ty * H, 0), pos = new V3(Math.sin(az) * Math.cos(el) * d, tgt.y + Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d);
    if (instant) { camera.position.copy(pos); controls.target.copy(tgt); controls.update(); tween = null; } else tween = { pos, tgt };
  }

  /* ----- avatar ----- */
  function restoreBind() { S.bind.forEach((q, b) => b.quaternion.copy(q)); }
  function applyBody() {
    const root = S.root; if (!root) return;
    restoreBind(); root.scale.set(1, 1, 1); root.position.set(0, 0, 0); root.updateMatrixWorld(true);
    const info = analyzeBody(root);
    const sc = (S.bodyParams.heightCm / 100) / info.H, wf = S.bodyParams.widthF;
    root.scale.set(sc * wf, sc, sc * wf); root.position.y = -info.minY * sc; root.updateMatrixWorld(true);
    poseArmsDown(root); root.updateMatrixWorld(true);
    S.body = analyzeBody(root); layoutStage(S.body.H);
    const b = S.body;
    cb.onBody && cb.onBody({ H: b.H, chestCm: Math.round(b.chestCm), waistCm: Math.round(b.waistCm), hipCm: Math.round(b.hipCm), shoulderCm: Math.round(b.shoulderW * 100) });
  }
  async function loadModel(source) {
    const tok = ++S.loadTok;
    cb.onLoad && cb.onLoad("loading");
    try {
      const loader = new GLTFLoader(); let gltf = null, lastErr = null;
      if (source instanceof ArrayBuffer) gltf = await new Promise((res, rej) => loader.parse(source, "", res, rej));
      else for (const url of source) { try { gltf = await loader.loadAsync(url); break; } catch (e) { lastErr = e; } }
      if (!gltf) throw lastErr || new Error("Could not download the model");
      if (S.disposed || tok !== S.loadTok) return; // a newer load replaced this one
      const root = gltf.scene;
      root.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
          if (!o.userData.fitAiOriginalMaterial) o.userData.fitAiOriginalMaterial = o.material;
          o.material = skinMat; // neutral mannequin, not a textured character
          o.renderOrder = 0;
        }
      });
      // validate the rig before swapping, so a bad avatar never leaves the stage half-broken
      collectBones(root);
      modelHolder.clear(); S.bind.clear();
      root.traverse((o) => { if (o.isBone) S.bind.set(o, o.quaternion.clone()); });
      modelHolder.add(root); S.root = root; S.body = null;
      applyBody(); setPreset("full", true);
      cb.onLoad && cb.onLoad("ready");
    } catch (e) { console.error(e); if (tok === S.loadTok) cb.onLoad && cb.onLoad("error", e && e.message ? e.message : String(e)); }
  }

  /* ----- Threadly photo overlay ----- */
  // overlay = { image, meta, size, fit, lenAdj } or null
  function setOverlay(o) { S.overlay = o; }
  // 3D mode: anchor the photo on the avatar's real shoulders / hips, projected through the camera every frame
  function paint3D() {
    const cw = host.clientWidth, ch = host.clientHeight;
    const ctx = sizeOverlayCanvas(overlayCanvas, cw, ch);
    const o = S.overlay, b = S.body;
    if (!o || !b || S.ar || !cw || !ch) return;
    camera.updateMatrixWorld();
    const pr = (x, y, z) => { const v = new V3(x, y, z).project(camera); return { x: (v.x * 0.5 + 0.5) * cw, y: (-v.y * 0.5 + 0.5) * ch }; };
    const mid = pr(b.cx, b.shoulderY, b.cz), hip = pr(b.cx, b.hipY, b.cz);
    const torsoPx = Math.hypot(hip.x - mid.x, hip.y - mid.y);
    const swFront = (torsoPx / Math.max(0.2, b.shoulderY - b.hipY)) * b.shoulderW;
    const dx = camera.position.x - controls.target.x, dz = camera.position.z - controls.target.z;
    const facing = dz / (Math.hypot(dx, dz) || 1); // 1 = looking at the avatar's front, -1 = its back
    drawGarmentOverlay(ctx, o.image, o.meta, { mid, hip, swFront, frontFrac: clamp(facing, 0, 1), alpha: smoothstep(0.22, 0.6, facing), angle: 0, size: o.size, fit: o.fit, lenAdj: o.lenAdj });
  }
  // AR mode: anchor the photo on the MediaPipe shoulders (hips are estimated when they are out of frame)
  function paintAR(lm, vw, vh, cw, ch) {
    const vis = (i) => lm[i] && (lm[i].visibility === undefined || lm[i].visibility > 0.45);
    if (!vis(11) || !vis(12) || !vw || !vh) { S.arPts = null; return false; }
    const scale = Math.max(cw / vw, ch / vh), ox = (cw - vw * scale) / 2, oy = (ch - vh * scale) / 2;
    const pt = (i) => ({ x: ox + (1 - lm[i].x) * vw * scale, y: oy + lm[i].y * vh * scale });
    const Ls = pt(11), Rs = pt(12);
    const sw0 = Math.hypot(Rs.x - Ls.x, Rs.y - Ls.y);
    if (sw0 < 8) return false;
    const ctx = sizeOverlayCanvas(overlayCanvas, cw, ch); // clear only when a new frame is really drawn (no flicker on a missed frame)
    let hip;
    if (vis(23) && vis(24)) { const a = pt(23), b = pt(24); hip = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
    else { const ux = (Rs.x - Ls.x) / sw0, uy = (Rs.y - Ls.y) / sw0; hip = { x: (Ls.x + Rs.x) / 2 - uy * sw0 * 1.25, y: (Ls.y + Rs.y) / 2 + ux * sw0 * 1.25 }; }
    const T = { lx: Ls.x, ly: Ls.y, rx: Rs.x, ry: Rs.y, hx: hip.x, hy: hip.y };
    const move = S.arPts ? Math.hypot(T.lx - S.arPts.lx, T.ly - S.arPts.ly) : 0;
    const a = move > Math.min(cw, ch) * 0.12 ? 0.55 : 0.3; // calm small jitter, keep up with deliberate movement
    const q = S.arPts ? Object.fromEntries(Object.keys(T).map((k) => [k, lerp(S.arPts[k], T[k], a)])) : T;
    S.arPts = q;
    const o = S.overlay; if (!o) return true;
    const mid = { x: (q.lx + q.rx) / 2, y: (q.ly + q.ry) / 2 };
    const sw = Math.hypot(q.rx - q.lx, q.ry - q.ly);
    drawGarmentOverlay(ctx, o.image, o.meta, { mid, hip: { x: q.hx, y: q.hy }, swFront: sw, frontFrac: 1, angle: Math.atan2(q.ry - q.ly, q.rx - q.lx), alpha: 1, size: o.size, fit: o.fit, lenAdj: o.lenAdj });
    return true;
  }

  function setBodyParams(p) { S.bodyParams = { ...S.bodyParams, ...p }; if (S.root) applyBody(); }

  /* ----- live try-on ----- */
  function setArMode(on, video) {
    S.ar = on; S.video = video || null; S.arPts = null; S.lastVideoTime = -1; S.lastOk = performance.now();
    modelHolder.visible = !on; floor.visible = !on; pedestal.visible = !on;
    renderer.clear(); resize(); sizeOverlayCanvas(overlayCanvas, host.clientWidth, host.clientHeight);
  }
  async function loadPoseModel() { S.lmk = await loadPose(); }

  /* ----- loop ----- */
  let raf = 0, last = performance.now();
  const loop = (t) => {
    raf = requestAnimationFrame(loop);
    const dt = Math.min((t - last) / 1000, 0.1); last = t;
    try {
      if (S.ar) {
        const v = S.video;
        if (v && v.readyState >= 2 && S.lmk && v.currentTime !== S.lastVideoTime) {
          S.lastVideoTime = v.currentTime;
          let ok = false;
          try { const r = S.lmk.detectForVideo(v, performance.now()); const lm = r.landmarks && r.landmarks[0]; ok = lm ? paintAR(lm, v.videoWidth, v.videoHeight, host.clientWidth, host.clientHeight) : false; } catch (e) { /* ignore a bad frame */ }
          const now = performance.now(); if (ok) S.lastOk = now;
          const lost = !ok && now - S.lastOk > 500;
          if (lost) sizeOverlayCanvas(overlayCanvas, host.clientWidth, host.clientHeight);
          cb.onArBody && cb.onArBody(!lost);
        }
      } else {
        if (tween) { camera.position.lerp(tween.pos, Math.min(dt * 5, 1)); controls.target.lerp(tween.tgt, Math.min(dt * 5, 1)); if (camera.position.distanceTo(tween.pos) < 0.005) tween = null; }
        controls.update(); renderer.render(scene, camera); paint3D();
      }
    } catch (e) { console.error(e); cancelAnimationFrame(raf); cb.onLoad && cb.onLoad("error", "Render error: " + e.message); }
  };
  raf = requestAnimationFrame(loop);
  setTheme("milan"); setPreset("full", true);

  return {
    loadModel, setOverlay, setBodyParams, setTheme, setPreset, setArMode, loadPose: loadPoseModel,
    setAutoRotate: (v) => { controls.autoRotate = v; },
    get ready() { return !!S.body; }, get isAr() { return S.ar; },
    render: () => { if (!S.ar) { renderer.render(scene, camera); paint3D(); } },
    dispose() { S.disposed = true; cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); skinMat.dispose(); renderer.dispose(); },
  };
}

/* =====================================================================
   6. React UI
   ===================================================================== */
const CSS = `
html,body,#root{margin:0;padding:0;width:100%;min-height:100%;background:#0d0b14}
.d3{width:100%;--bg:#0d0b14;--panel:#17131f;--line:rgba(255,255,255,.1);--acc:#e879f9;--txt:#ece9f3;--mut:#9a95aa;background:radial-gradient(900px 500px at 10% -10%,rgba(217,70,239,.18),transparent 60%),var(--bg);color:var(--txt);min-height:100vh;font:14px/1.45 "DM Sans",system-ui,sans-serif}
.d3 *{box-sizing:border-box}.d3 button{font:inherit;color:inherit;cursor:pointer;background:none;border:0;padding:0}.d3 button:disabled{opacity:.4;cursor:default}
.d3-bar{display:flex;justify-content:space-between;align-items:center;padding:14px 24px;border-bottom:1px solid var(--line);position:sticky;top:0;background:rgba(13,11,20,.85);backdrop-filter:blur(10px);z-index:20}
.d3-brand{font:700 20px "Syne",system-ui,sans-serif}.d3-brand i{font:500 11px "DM Mono",monospace;color:var(--acc);border:1px solid rgba(232,121,249,.35);border-radius:99px;padding:2px 9px;margin-left:10px;font-style:normal}
.d3-layout{display:grid;grid-template-columns:minmax(340px,440px) 1fr;gap:24px;width:100%;max-width:none;margin:0;padding:20px 24px}
@media(max-width:900px){.d3-layout{grid-template-columns:1fr}.d3-stage{order:-1;position:static!important}}
.d3-ctl{background:var(--panel);border:1px solid var(--line);border-radius:20px;padding:20px}
.d3-tape{display:flex;gap:6px;margin-bottom:18px}.d3-tape button{flex:1;padding:8px 0;border-radius:10px;font-size:11px;font-weight:600;background:rgba(255,255,255,.05);color:var(--mut)}
.d3-tape button.on{background:var(--acc);color:#1a0b1f}.d3-tape button.done{color:var(--txt)}
.d3 h2{font:700 22px "Syne",sans-serif;margin:0 0 4px}.d3 .sub{color:var(--mut);font-size:13px;margin:0 0 14px}
.d3 .lab{display:block;font:600 11px "DM Mono",monospace;text-transform:uppercase;letter-spacing:.08em;color:var(--mut);margin:16px 0 8px}
.d3-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(108px,1fr));gap:10px}
.d3-opt{border:1px solid var(--line)!important;border-radius:14px;padding:8px;text-align:left;background:rgba(255,255,255,.03)!important}
.d3-opt[aria-pressed=true]{border-color:var(--acc)!important;background:rgba(232,121,249,.12)!important;box-shadow:0 0 0 1px var(--acc)}
.d3-opt .th{aspect-ratio:4/5;border-radius:10px;background:#0e0c14;margin-bottom:6px;display:flex;align-items:center;justify-content:center;overflow:hidden}
.d3-opt .th img{width:100%;height:100%;object-fit:contain}.d3-opt b{display:block;font-size:12px}.d3-opt small{color:var(--mut);font-size:11px}
.d3-seg{display:inline-flex;gap:4px;background:rgba(255,255,255,.05);padding:4px;border-radius:12px}.d3-seg button{padding:6px 16px;border-radius:9px;font-weight:600;font-size:12px;color:var(--mut)}.d3-seg button[aria-pressed=true]{background:#fff;color:#111}
.d3-row{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.d3-field span{display:block;font-size:11px;color:var(--mut);margin-bottom:4px}
.d3 input[type=number],.d3 select{width:100%;background:#0e0c14;border:1px solid var(--line);color:var(--txt);border-radius:10px;padding:8px;font:inherit}
.d3-dots{display:flex;gap:9px;flex-wrap:wrap;align-items:center}.d3-dot{width:30px;height:30px;border-radius:50%;border:2px solid rgba(255,255,255,.25)!important}.d3-dot[aria-pressed=true]{border-color:#fff!important;box-shadow:0 0 0 3px var(--acc)}
.d3-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 15px;border-radius:11px;font-weight:600;font-size:13px;background:#fff;color:#111}.d3-btn.ghost{background:rgba(255,255,255,.07);color:var(--txt);border:1px solid var(--line)}.d3-btn.acc{background:linear-gradient(90deg,#e879f9,#a78bfa);color:#1a0b1f}.d3-btn.red{background:#f43f5e;color:#fff}.d3-btn.sel{border-color:var(--acc);box-shadow:0 0 0 1px var(--acc);background:rgba(232,121,249,.15)}
.d3-wrap{display:flex;gap:8px;flex-wrap:wrap}.d3-nav{display:flex;justify-content:space-between;margin-top:22px;padding-top:16px;border-top:1px solid var(--line)}
.d3-stage{position:sticky;top:68px;align-self:start}
.d3-frame{position:relative;border-radius:22px;overflow:hidden;border:1px solid var(--line);background:linear-gradient(180deg,#2a2438,#15121f 70%,#0e0c14);height:calc(100vh - 104px);min-height:460px}
.d3-frame canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab}
.d3-frame .threadly-overlay-canvas{z-index:4;pointer-events:none;cursor:default}
.d3-frame video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none;transform:scaleX(-1)}
.d3-top{position:absolute;left:0;right:0;top:0;z-index:6;padding:12px;display:flex;justify-content:space-between;gap:8px;pointer-events:none;flex-wrap:wrap}
.d3-glass{pointer-events:auto;background:rgba(15,12,22,.78);backdrop-filter:blur(10px);border:1px solid var(--line);border-radius:99px;padding:4px;display:flex;gap:2px;align-items:center}
.d3-glass button{height:28px;padding:0 11px;border-radius:99px;font-size:11px;font-weight:600;color:var(--mut);white-space:nowrap}.d3-glass button.on{background:#fff;color:#111}.d3-glass button.acc{background:var(--acc);color:#1a0b1f}.d3-glass button.red{background:#f43f5e;color:#fff}
.d3-bottom{position:absolute;left:0;right:0;bottom:0;z-index:6;padding:12px;display:flex;justify-content:space-between;align-items:flex-end;gap:8px;pointer-events:none;flex-wrap:wrap}
.d3-hint{pointer-events:none;font-size:11px;background:rgba(0,0,0,.5);padding:4px 11px;border-radius:99px;color:#ccc}
.d3-center{position:absolute;inset:0;z-index:8;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;pointer-events:none}
.d3-card{pointer-events:auto;max-width:360px;background:rgba(10,8,16,.85);border:1px solid var(--line);border-radius:16px;padding:16px;font-size:13px}
.d3-toasts{position:absolute;left:50%;transform:translateX(-50%);top:62px;z-index:7;width:max-content;max-width:90%;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none}
.d3-toast{font-size:12px;background:rgba(0,0,0,.78);border:1px solid rgba(232,121,249,.35);color:#f3c9fb;padding:7px 14px;border-radius:14px;text-align:center}
.d3-toast.ok{border-color:rgba(52,211,153,.4);color:#a7f3d0}.d3-toast.warn{border-color:rgba(251,191,36,.5);color:#fde68a}
.d3-status{font-size:12px;color:var(--mut);margin:10px 0}
.d3-bars .rk{display:grid;grid-template-columns:110px 1fr 30px;gap:8px;align-items:center;font-size:12px;padding:3px 0;width:100%;text-align:left}.d3-bars .rk.on b{color:var(--acc)}
.d3-bars .trk{height:6px;background:rgba(255,255,255,.1);border-radius:9px;overflow:hidden;display:block}.d3-bars .fill{display:block;height:100%;background:var(--acc)}
.d3-verdict{display:flex;gap:14px;align-items:center;margin-bottom:12px}.d3-verdict .big{font:700 46px "Syne",sans-serif;line-height:1}.d3-verdict small{font-size:16px;color:var(--mut)}
.d3-tag{display:inline-block;padding:3px 10px;border-radius:99px;font-size:12px;font-weight:700}.d3-tag.good{background:rgba(52,211,153,.15);color:#34d399}.d3-tag.warn{background:rgba(251,191,36,.15);color:#fbbf24}.d3-tag.bad{background:rgba(248,113,113,.15);color:#f87171}
.d3-list{list-style:none;margin:0;padding:0}.d3-list li{display:flex;gap:10px;padding:7px 0;border-top:1px solid var(--line);font-size:13px}.d3-list i{font:600 11px "DM Mono",monospace;color:var(--acc);width:70px;flex-shrink:0;font-style:normal;text-transform:uppercase}
.d3-meas{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:6px}.d3-meas div{background:#0e0c14;border:1px solid var(--line);border-radius:12px;padding:8px;text-align:center}.d3-meas b{display:block;font-size:16px}.d3-meas small{color:var(--mut);font-size:10px}
.d3-chk{display:flex;gap:8px;align-items:center;margin:8px 0;font-size:13px}.d3-sl{display:grid;grid-template-columns:90px 1fr 44px;gap:8px;align-items:center;font-size:12px;color:var(--mut);margin:5px 0}.d3-sl input{accent-color:#e879f9}
.d3-note{background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.3);border-radius:10px;padding:9px 12px;font-size:12px;margin-top:10px}
.d3-bot{position:absolute;left:0;right:0;bottom:0;z-index:5;padding:60px 10px 10px;background:linear-gradient(to top,rgba(0,0,0,.8),transparent);display:flex;gap:8px;overflow-x:auto}
.d3-bot button{flex:0 0 auto;width:70px;border-radius:12px;padding:5px;background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.2)!important;font-size:9px;font-weight:600;color:#fff}.d3-bot button.on{background:rgba(255,255,255,.92);color:#000;transform:scale(1.05)}
.d3-hero{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;padding:16px;margin:0 0 16px;border:1px solid rgba(232,121,249,.22);border-radius:16px;background:linear-gradient(125deg,rgba(232,121,249,.13),rgba(167,139,250,.06) 60%,rgba(255,255,255,.025))}
.d3-hero h3{font:700 16px "Syne",sans-serif;margin:0 0 5px}.d3-hero p{margin:0;color:var(--mut);font-size:12px;max-width:390px}
.d3-hero .spark{flex:0 0 auto;width:42px;height:42px;display:grid;place-items:center;border-radius:13px;background:rgba(232,121,249,.14);font-size:21px}
.d3-progress{height:5px;background:rgba(255,255,255,.08);border-radius:99px;overflow:hidden;margin:0 0 16px}.d3-progress span{display:block;height:100%;background:linear-gradient(90deg,#e879f9,#a78bfa);transition:width .25s ease}
.d3-toast-ui{position:sticky;top:72px;z-index:19;margin:0 0 12px;padding:10px 13px;border-radius:12px;background:#21162b;border:1px solid rgba(232,121,249,.4);color:#f4d7fa;font-size:12px;box-shadow:0 8px 30px rgba(0,0,0,.22)}
.d3-engagement{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin:0 0 14px}.d3-chip{font-size:11px;color:#d9d4e5;border:1px solid var(--line);background:rgba(255,255,255,.04);padding:5px 9px;border-radius:99px}.d3-chip strong{color:var(--acc)}
.d3-shelf{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:10px}.d3-look{position:relative;min-width:0}.d3-look>button:first-child{display:block;width:100%;text-align:left;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:rgba(255,255,255,.03)}.d3-look img{display:block;width:100%;aspect-ratio:3/4;object-fit:cover}.d3-look small{display:block;padding:5px;color:var(--mut);font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.d3-look .remove{position:absolute;right:4px;top:4px;width:22px;height:22px;border-radius:50%;background:rgba(10,8,16,.88);border:1px solid var(--line);font-size:14px}
.d3-disclaimer{font-size:11px;line-height:1.5;color:var(--mut);padding:10px 12px;border:1px dashed var(--line);border-radius:11px;margin-top:12px}
.d3-style-swatches{display:flex;gap:5px;align-items:center;height:46px;padding:6px 0}.d3-style-swatches i{display:block;width:24px;height:24px;border-radius:50%;border:1px solid rgba(255,255,255,.3);box-shadow:0 2px 8px rgba(0,0,0,.2)}
.d3-challenge{display:grid;gap:12px;margin-top:14px;padding:14px;border-radius:15px;border:1px solid rgba(167,139,250,.28);background:linear-gradient(130deg,rgba(167,139,250,.12),rgba(232,121,249,.04))}.d3-challenge-kicker{display:block;font:500 10px "DM Mono",monospace;letter-spacing:.1em;color:var(--acc);margin-bottom:6px}.d3-challenge>b,.d3-challenge div>b{display:block;font-size:14px}.d3-challenge p{margin:5px 0 0;font-size:12px;line-height:1.5;color:var(--mut)}
.d3-ar-guide{padding:12px;border-radius:12px;background:rgba(255,255,255,.035);border:1px solid var(--line);font-size:12px;margin-top:12px}.d3-ar-guide ul{padding-left:18px;color:var(--mut);line-height:1.7;margin:8px 0}.d3-ar-state{display:flex;align-items:center;gap:7px;color:var(--mut);font-size:11px}.d3-ar-state i{width:7px;height:7px;border-radius:50%;background:#777;display:inline-block}.d3-ar-state.live i{background:#34d399;box-shadow:0 0 0 4px rgba(52,211,153,.12)}
.d3-account-panel{margin-top:18px;padding:15px;border:1px solid var(--line);border-radius:16px;background:rgba(255,255,255,.025)}.d3-account-head{display:flex;justify-content:space-between;gap:10px;margin-bottom:14px}.d3-account-head h3{font:700 16px "Syne",sans-serif;margin:0 0 5px}.d3-account-head p{font-size:12px;color:var(--mut);margin:0;max-width:470px;line-height:1.5}.d3-account-icon{display:grid;place-items:center;flex:0 0 38px;height:38px;border-radius:12px;background:rgba(232,121,249,.14);color:var(--acc);font-size:20px}.d3-account-panel input[type=text],.d3-account-panel input[type=email],.d3-account-panel input[type=url],.d3-account-panel input[type=password]{width:100%;box-sizing:border-box;background:#0e0c14;border:1px solid var(--line);color:var(--txt);border-radius:10px;padding:8px;font:inherit}.d3-sync-details{margin-top:14px;border-top:1px solid var(--line);padding-top:12px}.d3-sync-details summary{cursor:pointer;font-size:12px;font-weight:600;color:#d9d4e5}.d3-sync-details .sub{margin:9px 0}.d3-sync-state{font-size:11px;color:var(--mut)}.d3-sync-state.success{color:#34d399}.d3-sync-state.error{color:#fbbf24}
@media(max-width:520px){.d3-layout{padding:10px;gap:12px}.d3-ctl{padding:14px}.d3-bar{padding:12px}.d3-brand{font-size:17px}.d3-brand i{display:none}.d3-frame{height:58vh;min-height:390px}.d3-hero{padding:12px}.d3-meas{grid-template-columns:repeat(2,1fr)}.d3-shelf{grid-template-columns:repeat(3,minmax(0,1fr))}}
`;

const STEP_NAMES = ["Garment", "Size", "Fabric", "Model & AR", "Outcome"];
const LIGHTS = [["milan", "Runway"], ["daylight", "Daylight"], ["golden", "Golden"], ["minimal", "White"]];
const VIEWS = [["full", "Full"], ["front", "Front"], ["threeQuarter", "3/4"], ["side", "Side"], ["back", "Back"], ["detail", "Detail"]];
const shortName = (n) => n.replace(" knit", "").replace("Sport p", "P");
const verdictOf = (o) => (o >= 76 ? ["good", "Excellent match"] : o >= 64 ? ["good", "Good match"] : o >= 52 ? ["warn", "Fair match"] : ["bad", "Not ideal"]);
const AR_HINT = "Step in front of the camera. Your shoulders must be visible.";

export default function FitAIStudio() {
  const hostRef = useRef(null), canvasRef = useRef(null), overlayRef = useRef(null), videoRef = useRef(null), stageRef = useRef(null), streamRef = useRef(null);
  const [stageReady, setStageReady] = useState(false);
  const [load, setLoad] = useState({ state: "loading", msg: "" });
  const [step, setStep] = useState(1);
  const [gender, setGender] = useState("f");
  const [gid, setGid] = useState("dress");
  const [wearing, setWearing] = useState(true); // false = bare mannequin
  const [size, setSize] = useState("M");
  const [matId, setMatId] = useState("silk");
  const [color, setColor] = useState(matOf("silk").colors[0]);
  const [recolor, setRecolor] = useState(false); // false = keep the colours of the Threadly photo
  const [climate, setClimate] = useState("hot");
  const [occ, setOcc] = useState("everyday");
  const [profile, setProfile] = useState({ height: 165, weight: 58, fit: "regular" });
  const [lenAdj, setLenAdj] = useState(1);
  const [threadlyImgs, setThreadlyImgs] = useState({});
  const [assetsReady, setAssetsReady] = useState(false);
  const [uploaded, setUploaded] = useState([]);
  const [body, setBody] = useState(null);
  const [useManualMeasurements, setUseManualMeasurements] = useState(false);
  const [manualMeasurements, setManualMeasurements] = useState({ chest: "", waist: "", hip: "" });
  const [view, setView] = useState("full");
  const [spin, setSpin] = useState(false);
  const [light, setLight] = useState("milan");
  const [ar, setAr] = useState("off");
  const [arMsg, setArMsg] = useState("");
  const [reading, setReading] = useState(null);
  const [looks, setLooks] = useState(() => {
    try { return typeof window !== "undefined" ? JSON.parse(window.localStorage.getItem("fitai-studio:saved-looks") || "[]") : []; }
    catch { return []; }
  });
  const [uiNotice, setUiNotice] = useState("");
  const [avatarId, setAvatarId] = useState("f1"); // a stock model id, or "custom"
  const [customName, setCustomName] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [styleDNA, setStyleDNA] = useState(() => {
    try { return typeof window !== "undefined" ? JSON.parse(window.localStorage.getItem(FITAI_PROFILE_KEY) || "{}")?.styleDNA || "minimal" : "minimal"; }
    catch { return "minimal"; }
  });
  const [profileName, setProfileName] = useState(() => {
    try { return typeof window !== "undefined" ? JSON.parse(window.localStorage.getItem(FITAI_PROFILE_KEY) || "{}")?.name || "" : ""; }
    catch { return ""; }
  });
  const [profileEmail, setProfileEmail] = useState(() => {
    try { return typeof window !== "undefined" ? JSON.parse(window.localStorage.getItem(FITAI_PROFILE_KEY) || "{}")?.email || "" : ""; }
    catch { return ""; }
  });
  const [apiBase, setApiBase] = useState(() => {
    try { return typeof window !== "undefined" ? window.localStorage.getItem("fitai-studio:api-base") || FITAI_API_BASE : FITAI_API_BASE; }
    catch { return FITAI_API_BASE; }
  });
  const [apiToken, setApiToken] = useState("");
  const [syncState, setSyncState] = useState("idle");
  const [styleChallenge, setStyleChallenge] = useState(() => Math.floor(Math.random() * 3));

  const allG = useMemo(() => [...uploaded, ...GARMENTS], [uploaded]);
  const garment = allG.find((x) => x.id === gid) || GARMENTS[0];
  const mat = matOf(matId);
  const effectiveMeasurements = useMemo(() => {
    if (useManualMeasurements) {
      const manual = Object.fromEntries(Object.entries(manualMeasurements).map(([k, v]) => [k, v === "" ? NaN : Number(v)]));
      return Object.values(manual).some((v) => Number.isFinite(v) && v > 0) ? manual : null;
    }
    return body ? { chest: body.chestCm, waist: body.waistCm, hip: body.hipCm, shoulder: body.shoulderCm } : null;
  }, [useManualMeasurements, manualMeasurements, body]);
  const A = useMemo(() => analyse({ size, mat: matId, climate, occ, profile }, garment, effectiveMeasurements), [size, matId, climate, occ, profile, garment, effectiveMeasurements]);
  const modelName = avatarId === "custom" ? customName : (MODELS.find((m) => m.id === avatarId) || MODELS[0]).name;

  // the Threadly photo (or the user's own cut-out) for the selected garment
  const metaFile = !garment.custom && THREADLY_OVERLAYS[garment.id] ? THREADLY_OVERLAYS[garment.id].file : null;
  const baseOverlay = useMemo(() => {
    if (garment.custom) return garment.canvas ? { image: garment.canvas, meta: uploadMeta(garment.canvas, garment.kind) } : null;
    const meta = THREADLY_OVERLAYS[garment.id], image = meta && threadlyImgs[meta.file];
    return image ? { image, meta } : null;
  }, [garment, threadlyImgs]);
  const tinted = useMemo(() => (baseOverlay && recolor ? tintImage(baseOverlay.image, color) : null), [baseOverlay, recolor, color]);
  const missingFile = assetsReady && wearing && metaFile && !threadlyImgs[metaFile] ? metaFile : null;
  const garmentChestCm = Math.round(SIZE_CHEST[size] * (FIT_MUL[profile.fit] || 1));

  // css + fonts
  useEffect(() => {
    if (document.getElementById("d3-css")) return;
    const s = document.createElement("style"); s.id = "d3-css"; s.textContent = CSS; document.head.appendChild(s);
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600&family=Syne:wght@700;800&display=swap"; document.head.appendChild(l);
  }, []);

  // Saved looks survive refreshes. Thumbnails are deliberately compressed before storage.
  useEffect(() => {
    try { window.localStorage.setItem("fitai-studio:saved-looks", JSON.stringify(looks.slice(0, 4))); }
    catch (e) { console.warn("FitAI Studio could not persist saved looks", e); }
  }, [looks]);
  useEffect(() => {
    try {
      window.localStorage.setItem(FITAI_PROFILE_KEY, JSON.stringify({ name: profileName, email: profileEmail, styleDNA }));
    } catch (e) { console.warn("FitAI Studio could not persist profile preferences", e); }
  }, [profileName, profileEmail, styleDNA]);
  useEffect(() => {
    try { window.localStorage.setItem("fitai-studio:api-base", apiBase.trim()); }
    catch (e) { /* storage may be disabled */ }
  }, [apiBase]);
  useEffect(() => {
    if (!uiNotice) return;
    const timer = window.setTimeout(() => setUiNotice(""), 3200);
    return () => window.clearTimeout(timer);
  }, [uiNotice]);

  // stage
  useEffect(() => {
    let stage;
    try {
      stage = createStage(canvasRef.current, overlayRef.current, hostRef.current, {
        onBody: setBody,
        onLoad: (state, msg) => setLoad({ state, msg: msg || "" }),
        onArBody: (ok) => setArMsg(ok ? "" : AR_HINT),
      });
    } catch (e) { setLoad({ state: "error", msg: "3D could not start: " + e.message }); return; }
    stageRef.current = stage; setStageReady(true);
    return () => { stopStream(); stage.dispose(); stageRef.current = null; setStageReady(false); };
  }, []); // eslint-disable-line

  // Load the transparent Threadly cut-outs from public/
  useEffect(() => {
    let dead = false;
    const files = [...new Set(Object.values(THREADLY_OVERLAYS).map((x) => x.file))];
    Promise.all(files.map(async (file) => { try { return [file, await loadImage(`/${file}`)]; } catch { return [file, null]; } }))
      .then((entries) => { if (!dead) { setThreadlyImgs(Object.fromEntries(entries.filter((x) => x[1]))); setAssetsReady(true); } });
    return () => { dead = true; };
  }, []);

  // load the chosen stock avatar (re-runs on Retry)
  useEffect(() => {
    if (!stageReady || avatarId === "custom") return;
    const m = MODELS.find((x) => x.id === avatarId) || MODELS[0];
    stageRef.current.loadModel(m.urls);
  }, [stageReady, avatarId, reloadKey]);

  // body shape from height + weight
  const widthF = useMemo(() => { const h = (+profile.height || 170) / 100, w = +profile.weight || 65, bmi = w / (h * h); return clamp(1 + (bmi - 21.5) * 0.028, 0.86, 1.22); }, [profile.height, profile.weight]);
  useEffect(() => { if (stageReady) stageRef.current.setBodyParams({ heightCm: clamp(+profile.height || 170, 140, 210), widthF }); }, [stageReady, profile.height, widthF]);

  // garment photo -> engine (3D avatar and live camera use the same overlay)
  useEffect(() => {
    if (!stageReady) return;
    stageRef.current.setOverlay(wearing && baseOverlay ? { image: tinted || baseOverlay.image, meta: baseOverlay.meta, size, fit: profile.fit, lenAdj } : null);
  }, [stageReady, wearing, baseOverlay, tinted, size, profile.fit, lenAdj]);

  useEffect(() => { stageReady && stageRef.current.setTheme(light); }, [stageReady, light]);
  useEffect(() => { stageReady && stageRef.current.setAutoRotate(spin); }, [stageReady, spin]);
  useEffect(() => { if (step !== 4 && ar !== "off") stopAr(); }, [step]); // eslint-disable-line

  /* ---- live camera try-on ---- */
  function stopStream() { if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; } if (videoRef.current) videoRef.current.srcObject = null; }
  function stopAr() { stopStream(); stageRef.current && stageRef.current.setArMode(false); setAr("off"); setArMsg(""); }
  async function startAr() {
    setAr("loading"); setArMsg("Starting camera and body tracking...");
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("Camera needs HTTPS or localhost.");
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      streamRef.current = stream; const v = videoRef.current; v.srcObject = stream; await v.play();
      await stageRef.current.loadPose();
      stageRef.current.setArMode(true, v); setAr("on"); setArMsg(AR_HINT);
    } catch (e) { stopStream(); setAr("off"); setArMsg("Live try-on could not start: " + (e && e.message ? e.message : e)); }
  }
  const toggleAr = () => (ar === "on" ? stopAr() : ar === "off" ? startAr() : null);
  function analyzeFabric() {
    const v = videoRef.current; if (!v || !v.videoWidth) return;
    const W = 720, H = 900, c = mk(W, H), x = c.getContext("2d"), k = Math.max(W / v.videoWidth, H / v.videoHeight), dw = v.videoWidth * k, dh = v.videoHeight * k;
    x.translate(W, 0); x.scale(-1, 1); x.drawImage(v, (W - dw) / 2, (H - dh) / 2, dw, dh);
    setReading(readFabric(c, W, H));
  }

  /* ---- avatar + garment upload ---- */
  async function onAvatar(e) {
    const f = e.target.files && e.target.files[0]; e.target.value = ""; if (!f) return;
    setAvatarId("custom"); setCustomName(f.name); stageRef.current.loadModel(await f.arrayBuffer());
  }
  const retryAvatar = () => { if (avatarId === "custom") setAvatarId(defaultModelFor(gender)); else setReloadKey((k) => k + 1); };
  function onGarmentUpload(e) {
    const f = e.target.files && e.target.files[0]; e.target.value = ""; if (!f) return;
    loadImage(URL.createObjectURL(f)).then((im) => {
      const canvas = cutOutPhoto(im);
      const g = { id: "up-" + Date.now(), name: f.name.replace(/\.[^.]+$/, "").slice(0, 16) || "My garment", g: gender, kind: "top", canvas, thumb: canvas.toDataURL("image/png"), mat: "cotton", w: {}, custom: true };
      setUploaded((u) => [g, ...u]); setGid(g.id); setWearing(true); setRecolor(false);
    }).catch(() => setUiNotice("Could not read that photo. Try a JPG or PNG."));
  }
  const setKind = (kind) => setUploaded((u) => u.map((g) => (g.id !== gid ? g : { ...g, kind })));

  const pickMaterial = (id) => { setMatId(id); setColor(matOf(id).colors[0]); };
  function applyStyleDNA(id) {
    const dna = STYLE_DNA[id] || STYLE_DNA.minimal;
    setStyleDNA(id); setMatId(dna.mat); setClimate(dna.climate); setOcc(dna.occ);
    const targetMat = matOf(dna.mat);
    setColor(dna.colors.find((c) => targetMat.colors.includes(c)) || targetMat.colors[0]);
    const recommended = GARMENTS.find((g) => g.g === gender && (id === "elegant" ? ["dress", "blouse", "gown", "kurti"].includes(g.id) : id === "streetwear" ? ["tee", "polo"].includes(g.id) : id === "active" ? ["tee", "ftee"].includes(g.id) : ["shirt", "blouse", "ftee", "tee"].includes(g.id)));
    if (recommended) pickGarment(recommended);
    setUiNotice(`${dna.label} style applied. Fine-tune the look or save it to your style board.`);
  }
  const styleChallenges = [
    { title: "One colour, three ways", text: "Build a look around one colour and compare three fabric choices.", action: "Try elegant", dna: "elegant" },
    { title: "Comfort meets confidence", text: "Choose a comfortable fabric and create an everyday look.", action: "Try active", dna: "active" },
    { title: "Build a capsule look", text: "Pick a versatile garment you could wear more than one way.", action: "Try minimal", dna: "minimal" },
  ];
  function exportWardrobe() {
    const payload = { version: 1, exportedAt: new Date().toISOString(), profile: { name: profileName, email: profileEmail, styleDNA, gender, profile, useManualMeasurements, manualMeasurements }, looks };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "fitai-studio-wardrobe.json"; a.click(); URL.revokeObjectURL(url);
    setUiNotice("Wardrobe exported. Keep the JSON file as a backup or import it on another device.");
  }
  function importWardrobe(e) {
    const file = e.target.files && e.target.files[0]; e.target.value = ""; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result || "{}"));
        if (!data || data.version !== 1 || !Array.isArray(data.looks)) throw new Error("This is not a FitAI Studio wardrobe backup.");
        setLooks(data.looks.filter((x) => x && x.id && x.s && x.thumb).slice(0, 4));
        if (data.profile) {
          if (data.profile.name) setProfileName(data.profile.name);
          if (data.profile.email) setProfileEmail(data.profile.email);
          if (data.profile.styleDNA && STYLE_DNA[data.profile.styleDNA]) setStyleDNA(data.profile.styleDNA);
          if (data.profile.gender) setGender(data.profile.gender);
          if (data.profile.profile) setProfile((p) => ({ ...p, ...data.profile.profile }));
          if (typeof data.profile.useManualMeasurements === "boolean") setUseManualMeasurements(data.profile.useManualMeasurements);
          if (data.profile.manualMeasurements) setManualMeasurements(data.profile.manualMeasurements);
        }
        setUiNotice("Wardrobe imported successfully on this device.");
      } catch (err) { setUiNotice(err.message || "Could not import this wardrobe file."); }
    };
    reader.onerror = () => setUiNotice("Could not read that file."); reader.readAsText(file);
  }
  async function syncWardrobe() {
    if (!apiBase.trim()) { setSyncState("error"); setUiNotice("Enter your FitAI backend base URL to enable cloud sync."); return; }
    setSyncState("syncing");
    try {
      const headers = { "Content-Type": "application/json" };
      if (apiToken.trim()) headers.Authorization = `Bearer ${apiToken.trim()}`;
      const payload = { profile: { name: profileName, email: profileEmail, styleDNA, gender, bodyProfile: profile, useManualMeasurements, manualMeasurements }, looks };
      const response = await fetch(`${apiBase.replace(/\/$/, "")}/api/fitai/sync`, { method: "PUT", headers, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error(`Sync endpoint returned ${response.status}. Configure PUT /api/fitai/sync on your backend.`);
      setSyncState("success"); setUiNotice("Wardrobe synced with your configured FitAI backend.");
    } catch (err) { setSyncState("error"); setUiNotice(`Cloud sync unavailable: ${err.message}. Your local wardrobe remains saved.`); }
  }
  const pickGarment = (g, keep) => { if (!keep) setWearing(true); setGid(g.id); setRecolor(false); if (!g.custom) { setMatId(g.mat); setColor(matOf(g.mat).colors[0]); } setLenAdj(1); };
  const switchGender = (g) => {
    setGender(g);
    const first = GARMENTS.find((x) => x.g === g); if (first) pickGarment(first, true);
    setProfile((p) => ({ ...p, height: g === "f" ? 165 : 176, weight: g === "f" ? 58 : 70 }));
    setAvatarId((a) => (a === "custom" ? a : defaultModelFor(g)));
  };

  // 3D canvas + garment overlay (+ camera frame in live mode) merged into one PNG
  const snapshot = () => {
    const st = stageRef.current, cv = canvasRef.current, ov = overlayRef.current; if (!st || !cv || !ov) return;
    st.render();
    const out = mk(cv.width, cv.height), c = out.getContext("2d"), v = videoRef.current;
    if (ar === "on" && v && v.videoWidth) {
      const sc = Math.max(out.width / v.videoWidth, out.height / v.videoHeight), w = v.videoWidth * sc, h = v.videoHeight * sc;
      c.save(); c.translate(out.width, 0); c.scale(-1, 1); c.drawImage(v, (out.width - w) / 2, (out.height - h) / 2, w, h); c.restore();
    } else {
      const bg = c.createLinearGradient(0, 0, 0, out.height); bg.addColorStop(0, "#2a2438"); bg.addColorStop(0.7, "#15121f"); bg.addColorStop(1, "#0e0c14");
      c.fillStyle = bg; c.fillRect(0, 0, out.width, out.height);
    }
    c.drawImage(cv, 0, 0);
    c.drawImage(ov, 0, 0, out.width, out.height);
    return out.toDataURL("image/png");
  };
  const download = () => { const u = snapshot(); if (!u) return; const a = document.createElement("a"); a.download = `fitai-studio-${garment.id}-${size}.png`; a.href = u; a.click(); };
  const saveLook = () => {
    const u = snapshot();
    if (!u) { setUiNotice("The 3D preview is still getting ready. Try saving again in a moment."); return; }
    // Reduce image dimensions/quality so a few saved looks fit safely in browser storage.
    const image = new Image();
    image.onload = () => {
      const t = mk(240, 320), c = t.getContext("2d");
      c.fillStyle = "#17131f"; c.fillRect(0, 0, t.width, t.height);
      const scale = Math.min(t.width / image.width, t.height / image.height);
      const w = image.width * scale, h = image.height * scale;
      c.drawImage(image, (t.width - w) / 2, (t.height - h) / 2, w, h);
      const look = { id: `${Date.now()}-${gid}`, thumb: t.toDataURL("image/jpeg", 0.72), label: `${size} ${garment.name}`, score: A.overall, s: { gid, size, matId, color, recolor, wearing, climate, occ, fit: profile.fit, lenAdj } };
      setLooks((items) => [look, ...items.filter((x) => !(x.s?.gid === gid && x.s?.size === size && x.s?.matId === matId && x.s?.color === color))].slice(0, 4));
      setUiNotice("Look saved! Your style board is kept on this device.");
    };
    image.onerror = () => setUiNotice("Couldn't prepare this preview. Please try again.");
    image.src = u;
  };
  const restoreLook = (l) => {
    setGid(l.s.gid); setSize(l.s.size); setMatId(l.s.matId); setColor(l.s.color);
    if (l.s.recolor !== undefined) setRecolor(l.s.recolor);
    if (l.s.wearing !== undefined) setWearing(l.s.wearing);
    if (l.s.climate) setClimate(l.s.climate); if (l.s.occ) setOcc(l.s.occ);
    if (l.s.fit) setProfile((p) => ({ ...p, fit: l.s.fit }));
    if (l.s.lenAdj) setLenAdj(l.s.lenAdj);
    setUiNotice(`Restored ${l.label}. Make it yours or save a new variation.`);
  };

  const goodP = A.sel.parts.filter((p) => p.val >= 7).sort((x, y) => y.gain - x.gain).slice(0, 2).map((p) => GOOD[p.k]);
  const badP = A.sel.parts.filter((p) => p.val <= 5).sort((x, y) => y.loss - x.loss).slice(0, 1).map((p) => BAD[p.k]);
  const why = goodP.length ? `${mat.name} ${goodP.join(" and ")} for this weather and occasion.` : `${mat.name} is an average match for this weather and occasion.`;
  const better = [...A.list].sort((x, y) => y.score - x.score)[0];
  const [vc, vt] = verdictOf(A.overall);
  const heavy = garment.id === "shirt" && climate === "hot";
  const visible = allG.filter((g) => g.g === gender || g.custom);
  const ease = effectiveMeasurements && Number.isFinite(+effectiveMeasurements.chest) ? garmentChestCm - +effectiveMeasurements.chest : null;

  const thumb = (g) => <span className="th">{g.custom ? <img alt="" src={g.thumb} /> : <img alt="" src={`/${THREADLY_OVERLAYS[g.id].file}`} onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />}</span>;

  return (
    <div className="d3">
      <header className="d3-bar"><div className="d3-brand">FitAI Studio<i>3D · virtual style lab</i></div><div style={{ color: "var(--mut)", fontSize: 12 }}>Step {step} of 5 · {STEP_NAMES[step - 1]}</div></header>
      <div className="d3-layout">
        <section className="d3-ctl">
          <div className="d3-hero"><div><h3>Your style, brought to life.</h3><p>Build a look, explore fabric choices, and preview it on a 3D avatar. Save your favourites to compare later.</p></div><div className="spark" aria-hidden="true">✦</div></div>
          <div className="d3-engagement"><span className="d3-chip">Style journey <strong>{Math.round(step / 5 * 100)}%</strong></span><span className="d3-chip">Saved looks <strong>{looks.length}/4</strong></span><span className="d3-chip">{wearing ? "Garment selected" : "Choose a garment to begin"}</span></div>
          <div className="d3-progress" role="progressbar" aria-label="Style journey progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(step / 5 * 100)}><span style={{ width: `${step / 5 * 100}%` }} /></div>
          {uiNotice && <div className="d3-toast-ui" role="status">✦ {uiNotice}</div>}
          <nav className="d3-tape" aria-label="Style journey steps">{STEP_NAMES.map((n, i) => <button key={n} className={step === i + 1 ? "on" : step > i + 1 ? "done" : ""} aria-current={step === i + 1 ? "step" : undefined} onClick={() => setStep(i + 1)}>{i + 1}. {n}</button>)}</nav>

          {step === 1 && (<>
            <h2>Choose a garment</h2><p className="sub">Each piece is a Threadly product photo, placed on the avatar's shoulders and scaled to its measured torso.</p>
            <div className="d3-wrap" style={{ alignItems: "center" }}><div className="d3-seg">{[["f", "Women"], ["m", "Men"]].map(([g, l]) => <button key={g} aria-pressed={gender === g} onClick={() => switchGender(g)}>{l}</button>)}</div><button className={`d3-btn ghost${!wearing ? " sel" : ""}`} onClick={() => setWearing(false)}>No garment</button></div>
            <div className="d3-grid" style={{ marginTop: 14 }}>{visible.map((g) => <button key={g.id} className="d3-opt" aria-pressed={wearing && gid === g.id} onClick={() => (wearing && gid === g.id ? setWearing(false) : pickGarment(g))}>{thumb(g)}<b>{g.name}</b><small>{g.custom ? "Your photo" : "Threadly photo"}</small></button>)}</div>
            <p className="sub" style={{ marginTop: 10 }}>Tap the selected garment again, or press No garment, to see the bare mannequin.</p>
            <div className="d3-wrap" style={{ marginTop: 4 }}><label className="d3-btn ghost" style={{ cursor: "pointer" }}>Upload garment photo<input type="file" accept="image/*" hidden onChange={onGarmentUpload} /></label></div>
            <span className="lab">Discover your Style DNA</span>
            <p className="sub">Choose a vibe to get a coordinated starting point. You can customize every choice afterwards.</p>
            <div className="d3-grid" style={{ marginTop: 8 }}>{Object.entries(STYLE_DNA).map(([id, dna]) => <button key={id} className="d3-opt" aria-pressed={styleDNA === id} onClick={() => applyStyleDNA(id)}><span className="d3-style-swatches">{dna.colors.map((c) => <i key={c} style={{ background: c }} />)}</span><b>{dna.label}</b><small>{dna.description}</small></button>)}</div>
            <div className="d3-challenge"><div><span className="d3-challenge-kicker">TODAY'S STYLE CHALLENGE</span><b>{styleChallenges[styleChallenge].title}</b><p>{styleChallenges[styleChallenge].text}</p></div><div className="d3-wrap"><button className="d3-btn acc" onClick={() => applyStyleDNA(styleChallenges[styleChallenge].dna)}>{styleChallenges[styleChallenge].action}</button><button className="d3-btn ghost" onClick={() => setStyleChallenge((v) => (v + 1) % styleChallenges.length)}>New challenge ↻</button></div></div>
            {garment.custom && (<><span className="lab">Type of your uploaded garment</span><div className="d3-seg">{[["top", "Top"], ["dress", "Dress"]].map(([k, l]) => <button key={k} aria-pressed={garment.kind === k} onClick={() => setKind(k)}>{l}</button>)}</div><p className="sub" style={{ marginTop: 8 }}>Use a front view on a plain background. The cut-out is placed on the shoulders of the avatar and of the live camera.</p></>)}
          </>)}

          {step === 2 && (<>
            <h2>Size and body</h2><p className="sub">Height and weight reshape the 3D avatar. Measurements below are taken from it.</p>
            <div className="d3-grid" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>{SK.map((s) => <button key={s} className="d3-opt" aria-pressed={size === s} onClick={() => setSize(s)} style={{ textAlign: "center", padding: 14 }}><b style={{ fontSize: 18 }}>{s}</b><small>{SIZE_CHEST[s]} cm</small></button>)}</div>
            <span className="lab">About you</span>
            <div className="d3-row">
              <label className="d3-field"><span>Height (cm)</span><input type="number" min="140" max="210" value={profile.height} onChange={(e) => setProfile({ ...profile, height: e.target.value })} /></label>
              <label className="d3-field"><span>Weight (kg)</span><input type="number" min="35" max="160" value={profile.weight} onChange={(e) => setProfile({ ...profile, weight: e.target.value })} /></label>
              <label className="d3-field"><span>Preferred fit</span><select value={profile.fit} onChange={(e) => setProfile({ ...profile, fit: e.target.value })}><option value="slim">Slim</option><option value="regular">Regular</option><option value="relaxed">Relaxed</option></select></label>
            </div>
            {body && <><span className="lab">Estimated 3D body measurements</span><div className="d3-meas"><div><b>{body.chestCm}</b><small>Chest cm</small></div><div><b>{body.waistCm}</b><small>Waist cm</small></div><div><b>{body.hipCm}</b><small>Hip cm</small></div><div><b>{body.shoulderCm}</b><small>Shoulder cm</small></div></div></>}
            <label className="d3-chk" style={{ marginTop: 12 }}><input type="checkbox" checked={useManualMeasurements} onChange={(e) => setUseManualMeasurements(e.target.checked)} /> Use my tape-measured body measurements for sizing</label>
            {useManualMeasurements && <><p className="sub">Measure around your body with a flexible tape. Enter centimetres; leave a field blank if you do not know it.</p><div className="d3-row"><label className="d3-field"><span>Chest (cm)</span><input type="number" min="50" max="180" placeholder={body ? String(body.chestCm) : "e.g. 92"} value={manualMeasurements.chest} onChange={(e) => setManualMeasurements((m) => ({ ...m, chest: e.target.value }))} /></label><label className="d3-field"><span>Waist (cm)</span><input type="number" min="45" max="180" placeholder={body ? String(body.waistCm) : "e.g. 78"} value={manualMeasurements.waist} onChange={(e) => setManualMeasurements((m) => ({ ...m, waist: e.target.value }))} /></label><label className="d3-field"><span>Hip (cm)</span><input type="number" min="55" max="190" placeholder={body ? String(body.hipCm) : "e.g. 100"} value={manualMeasurements.hip} onChange={(e) => setManualMeasurements((m) => ({ ...m, hip: e.target.value }))} /></label></div></>}
            <div className="d3-wrap" style={{ alignItems: "center", marginTop: 14 }}><span style={{ color: "var(--mut)" }}>Suggested size</span><b style={{ fontSize: 20, color: "var(--acc)" }}>{A.rec}</b><button className="d3-btn ghost" onClick={() => { setSize(A.rec); setUiNotice(`Size ${A.rec} selected. Check the fit notes before choosing a final size.`); }}>Use this size</button></div>
            {A.recommendedFit && <div className="d3-note" style={{ marginTop: 10 }}>Why {A.rec}? Your measurements are closest to this size's estimated garment ease. {A.recommendedFit.details.map((d) => `${d.key}: ${d.ease >= 0 ? "+" : ""}${d.ease} cm ease`).join(" · ")}.</div>}
            <div className="d3-disclaimer">Sizing uses an illustrative S–XL garment chart and estimated 3D or manually entered body measurements. Real sizing varies by brand, garment cut and stretch; verify the seller's size chart before purchasing.</div>
            <span className="lab">Garment length</span>
            <label className="d3-sl">Length<input type="range" min="70" max="125" value={Math.round(lenAdj * 100)} onChange={(e) => setLenAdj(+e.target.value / 100)} /><output>{Math.round(lenAdj * 100)}%</output></label>
          </>)}

          {step === 3 && (<>
            <h2>Material and colour</h2><p className="sub">Each fabric is scored for your weather and occasion. Pick a colour to tint the garment photo, or keep its original colour.</p>
            <div className="d3-grid">{MATS.map((m) => <button key={m.id} className="d3-opt" aria-pressed={matId === m.id} onClick={() => pickMaterial(m.id)}><span className="th" style={{ aspectRatio: "3/2", backgroundColor: m.colors[0], backgroundImage: `url(${weavePattern(m.id).toDataURL()})`, backgroundBlendMode: "soft-light", backgroundSize: "64px" }} /><b>{m.name}</b><small>{m.feel}</small></button>)}</div>
            <span className="lab">Colour</span>
            <div className="d3-dots">{mat.colors.map((c) => <button key={c} className="d3-dot" style={{ background: c }} aria-label={c} aria-pressed={recolor && color.toLowerCase() === c.toLowerCase()} onClick={() => { setColor(c); setRecolor(true); }} />)}<label style={{ fontSize: 12, color: "var(--mut)" }}>Custom <input type="color" value={color} onChange={(e) => { setColor(e.target.value); setRecolor(true); }} style={{ verticalAlign: "middle" }} /></label></div>
            <label className="d3-chk"><input type="checkbox" checked={!recolor} onChange={(e) => setRecolor(!e.target.checked)} /> Keep the original colour of the photo</label>
            <span className="lab">Where will you wear it?</span>
            <div className="d3-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <label className="d3-field"><span>Weather</span><select value={climate} onChange={(e) => setClimate(e.target.value)}><option value="hot">Hot and humid</option><option value="mild">Mild</option><option value="cold">Cold</option></select></label>
              <label className="d3-field"><span>Occasion</span><select value={occ} onChange={(e) => setOcc(e.target.value)}><option value="everyday">Everyday</option><option value="office">Office</option><option value="sport">Sport</option><option value="party">Evening out</option></select></label>
            </div>
          </>)}

          {step === 4 && (<>
            <h2>Real model and live try-on</h2><p className="sub">Rotate the 3D model, or put the garment on yourself through the camera.</p>
            <span className="lab">3D avatar</span>
            <div className="d3-wrap">{MODELS.map((m) => <button key={m.id} className={`d3-btn ghost${avatarId === m.id ? " sel" : ""}`} onClick={() => { setAvatarId(m.id); if (m.g !== gender) switchGender(m.g); }}>{m.name}{m.g === "f" ? " (W)" : " (M)"}</button>)}</div>
            <p className="sub" style={{ margin: "8px 0" }}>Current: <b style={{ color: "var(--txt)" }}>{modelName || "..."}</b>. Garments follow the Women / Men switch in step 1.</p>
            <div className="d3-wrap">
              <label className={`d3-btn ghost${avatarId === "custom" ? " sel" : ""}`} style={{ cursor: "pointer" }}>Load my avatar (.glb)<input type="file" accept=".glb,.gltf,model/gltf-binary" hidden onChange={onAvatar} /></label>
            </div>
            <p className="sub" style={{ marginTop: 8 }}>Any humanoid GLB with a Mixamo or Ready Player Me skeleton works. Use a body without clothes for best fit.</p>
            <span className="lab">Live camera try-on</span>
            <div className="d3-wrap"><button className={`d3-btn ${ar === "on" ? "red" : "acc"}`} onClick={toggleAr} disabled={ar === "loading"}>{ar === "on" ? "Stop camera" : ar === "loading" ? "Starting..." : "Start live try-on"}</button></div>
            <p className="d3-status">Stand about 2 metres back so your shoulders are visible. Hips are used when they are in frame.</p>
            <div className="d3-ar-guide"><b>For the steadiest preview</b><ul><li>Keep both shoulders inside the frame.</li><li>Use even lighting and avoid busy backgrounds.</li><li>Face the camera; this is a front-view photo overlay, not a full body replacement.</li></ul><span className={`d3-ar-state ${ar === "on" ? "live" : ""}`}><i />{ar === "on" ? "Camera active · pose tracking running" : ar === "loading" ? "Requesting camera access…" : "Camera off · your video is not being recorded by this component"}</span></div>
            <span className="lab">Read the fabric in your hand</span>
            <p className="sub">Hold a fabric in the centre of the frame, then read it.</p>
            <div className="d3-wrap"><button className="d3-btn" disabled={ar !== "on"} onClick={analyzeFabric}>Read fabric in frame</button>{reading && <button className="d3-btn ghost" onClick={() => { setMatId(reading.mat); setColor(reading.color); setRecolor(true); }}>Apply colour and material</button>}</div>
            {reading && (<><p className="sub" style={{ marginTop: 10 }}>Texture reads as <b>{matOf(reading.mat).name}</b> ({reading.conf}% match), colour <b style={{ fontFamily: "DM Mono,monospace" }}>{reading.color.toUpperCase()}</b>.</p><div className="d3-bars">{reading.bars.map((b) => <div key={b.n} className="rk"><b>{shortName(b.n)}</b><span className="trk"><span className="fill" style={{ width: `${b.v}%` }} /></span><em style={{ fontStyle: "normal" }}>{b.v}</em></div>)}</div></>)}
          </>)}

          {step === 5 && (<>
            <h2>How it looks on you</h2>
            {!wearing && <div className="d3-note" style={{ marginBottom: 10 }}>The avatar is bare right now. <button className="d3-btn ghost" style={{ padding: "2px 10px", marginLeft: 4 }} onClick={() => setWearing(true)}>Try {garment.name} on</button></div>}
            <div className="d3-verdict"><div className="big">{A.overall}<small>/100</small></div><div><span className={`d3-tag ${vc}`}>{vt}</span><div style={{ color: "var(--mut)", fontSize: 12, marginTop: 5 }}>Material {A.sel.score} · Size {A.sizeLabel.toLowerCase()}</div></div></div>
            <div className="d3-disclaimer">This style score is a rule-based guide using the selected fabric, weather, occasion and size inputs. It is not a laboratory fabric test or a guarantee of fit.</div>
            {effectiveMeasurements && <div className="d3-meas"><div><b>{effectiveMeasurements.chest || "—"}</b><small>Body chest cm</small></div><div><b>{garmentChestCm}</b><small>Garment chest</small></div><div><b>{ease > 0 ? "+" : ""}{ease ?? "—"}</b><small>Chest ease cm</small></div><div><b>{A.rec}</b><small>Suggested size</small></div></div>}
            <ul className="d3-list" style={{ marginTop: 12 }}>
              <li><i>Why</i><span>{why}</span></li>
              {badP.length > 0 && <li><i>Watch out</i><span>It {badP[0]}.</span></li>}
              <li><i>Fit check</i><span>{A.sizeLabel}. {A.recommendedFit ? `The ${A.rec} recommendation is based on your available body measurements and estimated garment ease.` : `The ${A.rec} suggestion is a basic height/weight fallback until body measurements are available.`}</span></li>
              {better.m.id !== matId && <li><i>Better pick</i><span>{better.m.name} scores {better.score}. <button className="d3-btn ghost" style={{ padding: "2px 10px", marginLeft: 4 }} onClick={() => pickMaterial(better.m.id)}>Try it</button></span></li>}
            </ul>
            {heavy && <div className="d3-note">A {garment.name.toLowerCase()} is heavy for hot, humid weather. A T-shirt or polo will feel better.</div>}
            <span className="lab">Every material for this garment</span>
            <div className="d3-bars">{[...A.list].sort((x, y) => y.score - x.score).map((x) => <button key={x.m.id} className={`rk${x.m.id === matId ? " on" : ""}`} onClick={() => pickMaterial(x.m.id)}><b>{shortName(x.m.name)}</b><span className="trk"><span className="fill" style={{ width: `${x.score}%` }} /></span><em style={{ fontStyle: "normal" }}>{x.score}</em></button>)}</div>
            <div className="d3-wrap" style={{ marginTop: 14 }}><button className="d3-btn acc" onClick={saveLook}>Save this look</button><button className="d3-btn" onClick={download}>Download photo</button></div>
            <div className="d3-shelf">{looks.map((l, i) => <div className="d3-look" key={l.id || `${l.label}-${i}`}><button onClick={() => restoreLook(l)} title={`Restore ${l.label} · score ${l.score}`}><img alt={`Saved look: ${l.label}`} src={l.thumb} /><small>{l.label} · {l.score}/100</small></button><button className="remove" aria-label={`Remove saved look ${l.label}`} title="Remove saved look" onClick={() => { setLooks((items) => items.filter((x) => x !== l)); setUiNotice(`${l.label} removed from your style board.`); }}>×</button></div>)}</div>
            {looks.length === 0 && <p className="sub" style={{ marginTop: 8 }}>Your personal style board is empty. Save a look to keep it on this device and compare up to four favourites.</p>}
            <div className="d3-account-panel">
              <div className="d3-account-head"><div><span className="d3-challenge-kicker">YOUR STYLE PROFILE</span><h3>Keep your style yours.</h3><p>Save preferences on this device, back up your wardrobe, or connect a compatible backend for cross-device sync.</p></div><span className="d3-account-icon">✦</span></div>
              <div className="d3-row"><label className="d3-field"><span>Name (optional)</span><input type="text" value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="Your name" /></label><label className="d3-field"><span>Email (optional)</span><input type="email" value={profileEmail} onChange={(e) => setProfileEmail(e.target.value)} placeholder="you@example.com" /></label><label className="d3-field"><span>Style DNA</span><select value={styleDNA} onChange={(e) => setStyleDNA(e.target.value)}>{Object.entries(STYLE_DNA).map(([id, dna]) => <option key={id} value={id}>{dna.label}</option>)}</select></label></div>
              <div className="d3-wrap" style={{ marginTop: 12 }}><button className="d3-btn ghost" onClick={exportWardrobe}>Export wardrobe JSON</button><label className="d3-btn ghost" style={{ cursor: "pointer" }}>Import wardrobe<input type="file" accept="application/json,.json" hidden onChange={importWardrobe} /></label></div>
              <details className="d3-sync-details"><summary>Optional cloud sync settings</summary><p className="sub">Cloud sync requires your own backend endpoint. This component sends the profile and saved looks to <code>PUT /api/fitai/sync</code>; it does not create accounts or authenticate users by itself.</p><div className="d3-row"><label className="d3-field"><span>Backend base URL</span><input type="url" value={apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder="https://your-api.example.com" /></label><label className="d3-field" style={{ gridColumn: "span 2" }}><span>Bearer token (optional)</span><input type="password" autoComplete="off" value={apiToken} onChange={(e) => setApiToken(e.target.value)} placeholder="Paste a short-lived access token" /></label></div><div className="d3-wrap" style={{ marginTop: 10, alignItems: "center" }}><button className="d3-btn acc" disabled={syncState === "syncing"} onClick={syncWardrobe}>{syncState === "syncing" ? "Syncing…" : "Sync wardrobe"}</button><span className={`d3-sync-state ${syncState}`}>{syncState === "success" ? "Last sync succeeded" : syncState === "error" ? "Sync needs attention" : "Local-first mode"}</span></div></details>
            </div>
          </>)}

          <div className="d3-nav"><button className="d3-btn ghost" disabled={step === 1} onClick={() => setStep(step - 1)}>Back</button>{step < 5 && <button className="d3-btn acc" onClick={() => setStep(step + 1)}>Next: {STEP_NAMES[step]}</button>}</div>
        </section>

        <aside className="d3-stage">
          <div className="d3-frame" ref={hostRef}>
            <video ref={videoRef} playsInline muted style={{ opacity: ar === "on" ? 1 : 0 }} />
            <canvas ref={canvasRef} />
            <canvas ref={overlayRef} className="threadly-overlay-canvas" aria-label="Garment photo overlay" />
            <div className="d3-top">
              <div className="d3-glass"><button className="on" style={{ cursor: "default" }}>{wearing ? `${garment.name} · ${size}` : "No garment"}</button></div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {ar !== "on" && <div className="d3-glass">{LIGHTS.map(([k, l]) => <button key={k} className={light === k ? "on" : ""} onClick={() => setLight(k)}>{l}</button>)}</div>}
                <div className="d3-glass"><button className={ar === "on" ? "red" : "acc"} onClick={toggleAr} disabled={ar === "loading"}>{ar === "on" ? "Stop camera" : ar === "loading" ? "Starting..." : "Live try-on"}</button><button onClick={download}>Snapshot</button></div>
              </div>
            </div>
            <div className="d3-toasts">
              {arMsg && <div className="d3-toast">{arMsg}</div>}
              {ar === "on" && wearing && !arMsg && baseOverlay && <div className="d3-toast ok">Threadly photo overlay · pose aligned</div>}
              {missingFile && <div className="d3-toast warn">Garment photo /{missingFile} not found. Put it in your public/ folder.</div>}
            </div>
            {load.state === "loading" && <div className="d3-center"><div className="d3-card">Loading real 3D model...<br /><span style={{ color: "var(--mut)", fontSize: 12 }}>First load downloads about 3 MB.</span></div></div>}
            {load.state === "error" && <div className="d3-center"><div className="d3-card" style={{ borderColor: "rgba(248,113,113,.5)" }}><b style={{ color: "#fca5a5" }}>3D model problem</b><div style={{ color: "#fecaca", fontSize: 12, margin: "6px 0 10px", wordBreak: "break-word" }}>{load.msg}</div><div className="d3-wrap"><button className="d3-btn" onClick={retryAvatar}>Retry</button><label className="d3-btn ghost" style={{ cursor: "pointer" }}>Load my avatar<input type="file" accept=".glb,.gltf" hidden onChange={onAvatar} /></label></div></div></div>}
            {ar === "on" && (
              <div className="d3-bot">{visible.map((g) => <button key={g.id} className={wearing && gid === g.id ? "on" : ""} onClick={() => pickGarment(g)}>{g.name}</button>)}</div>
            )}
            {ar !== "on" && (
              <div className="d3-bottom"><div className="d3-hint">Drag to rotate · garment photo is a front view</div>
                <div className="d3-glass" style={{ maxWidth: "100%", overflowX: "auto" }}>
                  {VIEWS.map(([k, l]) => <button key={k} className={view === k ? "on" : ""} onClick={() => { setView(k); stageRef.current && stageRef.current.setPreset(k); }}>{l}</button>)}
                  <button className={spin ? "acc" : ""} onClick={() => setSpin((v) => !v)}>Spin</button>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
