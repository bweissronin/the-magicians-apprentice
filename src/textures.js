import * as THREE from 'three';
import { mulberry32 } from './util.js';

const cache = {};

function canvasTex(key, w, h, draw, repeat = [1, 1]) {
  if (cache[key]) return cache[key];
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  cache[key] = t;
  return t;
}

// Staggered, colour-jittered ashlar blocks for the tower.
export function brickTexture(tint = '#8d8a86') {
  return canvasTex('brick' + tint, 512, 512, (g, w, h) => {
    const rand = mulberry32(7);
    g.fillStyle = '#3b3733'; g.fillRect(0, 0, w, h);
    const rows = 10, bh = h / rows;
    const base = new THREE.Color(tint);
    for (let r = 0; r < rows; r++) {
      const cols = 5, bw = w / cols, off = (r % 2) * bw * 0.5;
      for (let c = -1; c < cols + 1; c++) {
        const col = base.clone().offsetHSL((rand() - 0.5) * 0.03, (rand() - 0.5) * 0.08, (rand() - 0.5) * 0.14);
        g.fillStyle = `#${col.getHexString()}`;
        const x = c * bw + off + 3, y = r * bh + 3;
        g.fillRect(x, y, bw - 6, bh - 6);
        // Speckle and a light top bevel.
        for (let k = 0; k < 40; k++) {
          g.fillStyle = `rgba(0,0,0,${rand() * 0.12})`;
          g.fillRect(x + rand() * (bw - 6), y + rand() * (bh - 6), 2 + rand() * 4, 2 + rand() * 3);
        }
        g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(x, y, bw - 6, 3);
        g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x, y + bh - 9, bw - 6, 3);
      }
    }
  });
}

export function barkTexture() {
  return canvasTex('bark', 128, 256, (g, w, h) => {
    const rand = mulberry32(11);
    g.fillStyle = '#5a3d27'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      g.strokeStyle = `rgba(${20 + rand() * 30},${12 + rand() * 20},${6},${0.3 + rand() * 0.4})`;
      g.lineWidth = 1 + rand() * 3;
      const x = rand() * w;
      g.beginPath(); g.moveTo(x, 0);
      for (let y = 0; y <= h; y += 16) g.lineTo(x + (rand() - 0.5) * 6, y);
      g.stroke();
    }
  }, [2, 1]);
}

export function woodPlankTexture() {
  return canvasTex('plank', 256, 256, (g, w, h) => {
    const rand = mulberry32(21);
    const n = 6, ph = h / n;
    for (let i = 0; i < n; i++) {
      const l = 30 + rand() * 12;
      g.fillStyle = `hsl(28, 45%, ${l}%)`; g.fillRect(0, i * ph, w, ph);
      for (let k = 0; k < 12; k++) {
        g.strokeStyle = `rgba(40,20,5,${0.1 + rand() * 0.2})`;
        g.beginPath(); const y = i * ph + rand() * ph;
        g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + rand() * 6 - 3, w * 0.6, y + rand() * 6 - 3, w, y); g.stroke();
      }
      g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, i * ph, w, 2);
    }
  });
}

// Circular glyph ring used on shrines and the build altar.
export function runeCircleTexture(color = '#9fe8ff') {
  return canvasTex('runes' + color, 512, 512, (g, w, h) => {
    const rand = mulberry32(99);
    g.clearRect(0, 0, w, h);
    g.translate(w / 2, h / 2);
    g.strokeStyle = color; g.fillStyle = color;
    g.shadowColor = color; g.shadowBlur = 12;
    g.lineWidth = 5;
    [240, 200, 120].forEach((r) => { g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); });
    g.lineWidth = 3;
    const N = 16;
    for (let i = 0; i < N; i++) {
      g.save();
      g.rotate((i / N) * Math.PI * 2);
      g.translate(0, -220);
      g.beginPath();
      for (let k = 0; k < 3; k++) {
        g.moveTo((rand() - 0.5) * 22, (rand() - 0.5) * 22);
        g.lineTo((rand() - 0.5) * 22, (rand() - 0.5) * 22);
      }
      g.stroke();
      g.restore();
    }
    // Inner star.
    g.beginPath();
    for (let i = 0; i <= 7; i++) {
      const a = (i * 3 / 7) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(a) * 118, y = Math.sin(a) * 118;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  });
}

export function glowSpriteTexture() {
  return canvasTex('glow', 128, 128, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,0.5)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
}
