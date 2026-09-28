import * as THREE from 'three';
import { mulberry32 } from './util.js';

// Shared art direction: a soft "clay diorama" look. Every surface uses clay() so the
// whole world shares one lighting response — smooth, slightly glossy, with a warm rim.

export const PALETTE = {
  grass: '#79b84a', grassDark: '#4c9230', grassLight: '#a2d060',
  dirt: '#e2b77a', dirtDark: '#c28f55',
  cliff: '#c4935f', cliffDark: '#a0714a',
  sand: '#f0d9a4',
  water: '#3cc6cf', waterDeep: '#1f8fa6',
  stone: '#efe4cf', stoneDark: '#cdbd9f',
  wood: '#c98a4b', woodDark: '#8d5a2b',
  roof: '#e0674a', roofDark: '#b8473a',
  leaf: '#5fb33b', leafDark: '#3f8a2a', leafLight: '#8fd15a',
  gold: '#ffcf5a',
};

const matCache = new Map();

// Clay material: MeshStandard + a fresnel rim that lifts silhouettes like soft plastic.
export function clay(color, { roughness = 0.62, metalness = 0, rim = 0.28, map = null, emissive = null, emissiveIntensity = 1, transparent = false, opacity = 1, side = THREE.FrontSide, vertexColors = false, key = null } = {}) {
  const k = key || [color, roughness, metalness, rim, map?.uuid, emissive, emissiveIntensity, transparent, opacity, side, vertexColors].join('|');
  if (matCache.has(k)) return matCache.get(k);
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, map, transparent, opacity, side, vertexColors });
  if (emissive) { m.emissive = new THREE.Color(emissive); m.emissiveIntensity = emissiveIntensity; }
  if (rim > 0) addRim(m, rim);
  matCache.set(k, m);
  return m;
}

export function addRim(m, strength = 0.28) {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = { value: strength };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uRim;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float rimF = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 3.0);
        totalEmissiveRadiance += diffuseColor.rgb * rimF * uRim;`);
  };
  m.customProgramCacheKey = () => 'rim' + strength;
  return m;
}

// ---------- Tileable painted textures ----------
const texCache = {};
function canvasTex(key, size, draw, { repeat = [1, 1], srgb = true } = {}) {
  if (texCache[key]) return texCache[key];
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size, mulberry32(key.length * 7919 + size));
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  texCache[key] = t;
  return t;
}

// Draw a shape at (x,y) and at its wrapped copies so the texture tiles seamlessly.
function wrapDraw(size, x, y, r, fn) {
  for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) {
    const X = x + dx, Y = y + dy;
    if (X + r < 0 || X - r > size || Y + r < 0 || Y - r > size) continue;
    fn(X, Y);
  }
}

// Stylised lawn: soft mottling plus little "w" grass strokes.
export function grassTexture() {
  return canvasTex('grass', 512, (g, S, rand) => {
    g.fillStyle = PALETTE.grass; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 70; i++) {
      const x = rand() * S, y = rand() * S, r = 20 + rand() * 50;
      wrapDraw(S, x, y, r, (X, Y) => {
        const grd = g.createRadialGradient(X, Y, 0, X, Y, r);
        const c = rand() < 0.5 ? '120,190,60' : '100,170,50';
        grd.addColorStop(0, `rgba(${c},0.35)`); grd.addColorStop(1, `rgba(${c},0)`);
        g.fillStyle = grd; g.fillRect(X - r, Y - r, r * 2, r * 2);
      });
    }
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (let i = 0; i < 260; i++) {
      const x = rand() * S, y = rand() * S, s = 5 + rand() * 6;
      const dark = rand() < 0.6;
      wrapDraw(S, x, y, s * 2, (X, Y) => {
        g.strokeStyle = dark ? 'rgba(60,130,35,0.55)' : 'rgba(190,235,120,0.5)';
        g.lineWidth = 2.2;
        g.beginPath();
        g.moveTo(X - s, Y - s * 0.6); g.lineTo(X - s * 0.5, Y + s * 0.4); g.lineTo(X, Y - s * 0.3);
        g.lineTo(X + s * 0.5, Y + s * 0.4); g.lineTo(X + s, Y - s * 0.6);
        g.stroke();
      });
    }
  });
}

export function dirtTexture() {
  return canvasTex('dirt', 256, (g, S, rand) => {
    g.fillStyle = PALETTE.dirt; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 40; i++) {
      const x = rand() * S, y = rand() * S, r = 10 + rand() * 30;
      wrapDraw(S, x, y, r, (X, Y) => {
        const grd = g.createRadialGradient(X, Y, 0, X, Y, r);
        grd.addColorStop(0, 'rgba(200,150,95,0.35)'); grd.addColorStop(1, 'rgba(200,150,95,0)');
        g.fillStyle = grd; g.fillRect(X - r, Y - r, r * 2, r * 2);
      });
    }
    for (let i = 0; i < 60; i++) {
      const x = rand() * S, y = rand() * S, r = 1.5 + rand() * 3.5;
      wrapDraw(S, x, y, r + 2, (X, Y) => {
        g.fillStyle = 'rgba(150,100,55,0.45)';
        g.beginPath(); g.ellipse(X, Y + 1, r, r * 0.7, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(255,235,200,0.6)';
        g.beginPath(); g.ellipse(X, Y, r, r * 0.7, 0, 0, Math.PI * 2); g.fill();
      });
    }
  });
}

// Clean cream ashlar with soft bevel shading (no gritty noise).
export function stoneBlockTexture(tint = PALETTE.stone, rows = 6, cols = 4) {
  return canvasTex('stone' + tint + rows + cols, 512, (g, S, rand) => {
    const base = new THREE.Color(tint);
    g.fillStyle = '#' + base.clone().offsetHSL(0, -0.05, -0.22).getHexString();
    g.fillRect(0, 0, S, S);
    const bh = S / rows, bw = S / cols, gap = 7, rad = 10;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * bw * 0.5;
      for (let c = -1; c <= cols; c++) {
        const x = c * bw + off + gap / 2, y = r * bh + gap / 2, w = bw - gap, h = bh - gap;
        const col = base.clone().offsetHSL((rand() - 0.5) * 0.02, 0, (rand() - 0.5) * 0.06);
        const grd = g.createLinearGradient(0, y, 0, y + h);
        grd.addColorStop(0, '#' + col.clone().offsetHSL(0, 0, 0.06).getHexString());
        grd.addColorStop(1, '#' + col.clone().offsetHSL(0, 0, -0.06).getHexString());
        g.fillStyle = grd;
        roundRect(g, x, y, w, h, rad); g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 3;
        g.beginPath(); g.moveTo(x + rad, y + 2.5); g.lineTo(x + w - rad, y + 2.5); g.stroke();
      }
    }
  });
}

// Overlapping scalloped roof tiles (terracotta by default).
export function shingleTexture(color = PALETTE.roof, dark = PALETTE.roofDark) {
  return canvasTex('shingle' + color, 512, (g, S, rand) => {
    g.fillStyle = dark; g.fillRect(0, 0, S, S);
    const rows = 8, cols = 8, h = S / rows, w = S / cols;
    for (let r = rows; r >= -1; r--) {
      const off = (r % 2) * w * 0.5;
      for (let c = -1; c <= cols; c++) {
        const x = c * w + off, y = r * h;
        const col = new THREE.Color(color).offsetHSL(0, 0, (rand() - 0.5) * 0.06);
        const grd = g.createLinearGradient(0, y, 0, y + h * 1.3);
        grd.addColorStop(0, '#' + col.clone().offsetHSL(0, 0, -0.08).getHexString());
        grd.addColorStop(1, '#' + col.clone().offsetHSL(0, 0, 0.05).getHexString());
        g.fillStyle = grd;
        g.beginPath();
        g.moveTo(x + 3, y);
        g.lineTo(x + w - 3, y);
        g.lineTo(x + w - 3, y + h * 0.75);
        g.quadraticCurveTo(x + w - 3, y + h * 1.3, x + w / 2, y + h * 1.3);
        g.quadraticCurveTo(x + 3, y + h * 1.3, x + 3, y + h * 0.75);
        g.closePath(); g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 2; g.stroke();
      }
    }
  });
}

// Scalloped leaf layers for tree canopies and hedges.
export function leafTexture(color = PALETTE.leaf, dark = PALETTE.leafDark, light = PALETTE.leafLight) {
  return canvasTex('leaf' + color, 256, (g, S, rand) => {
    g.fillStyle = color; g.fillRect(0, 0, S, S);
    const rows = 5, cols = 5, h = S / rows, w = S / cols;
    for (let r = 0; r <= rows; r++) {
      const off = (r % 2) * w * 0.5;
      for (let c = -1; c <= cols; c++) {
        const x = c * w + off + w / 2, y = r * h;
        g.fillStyle = dark; g.globalAlpha = 0.5;
        g.beginPath(); g.arc(x, y + h * 0.35, w * 0.42, 0, Math.PI); g.fill();
        g.globalAlpha = 1; g.fillStyle = color;
        g.beginPath(); g.arc(x, y + h * 0.2, w * 0.42, 0, Math.PI); g.fill();
        g.strokeStyle = light; g.globalAlpha = 0.5; g.lineWidth = 3;
        g.beginPath(); g.arc(x, y + h * 0.1, w * 0.3, Math.PI * 0.15, Math.PI * 0.85); g.stroke();
        g.globalAlpha = 1;
      }
    }
  });
}

export function plankTexture(color = PALETTE.wood) {
  return canvasTex('plank' + color, 256, (g, S, rand) => {
    const n = 4, ph = S / n;
    for (let i = 0; i < n; i++) {
      const col = new THREE.Color(color).offsetHSL(0, 0, (rand() - 0.5) * 0.06);
      g.fillStyle = '#' + col.getHexString(); g.fillRect(0, i * ph, S, ph);
      g.strokeStyle = 'rgba(120,70,30,0.25)'; g.lineWidth = 2;
      for (let k = 0; k < 3; k++) {
        const y = i * ph + ph * (0.3 + k * 0.2);
        g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(S * 0.3, y + 4, S * 0.6, y - 4, S, y); g.stroke();
      }
      g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(0, i * ph + 2, S, 3);
      g.fillStyle = 'rgba(90,50,20,0.5)'; g.fillRect(0, i * ph, S, 2);
    }
  });
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
}
