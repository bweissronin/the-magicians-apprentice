import * as THREE from 'three';

// One pooled, additive point cloud for every magical effect in the game.
export class Particles {
  constructor(scene, capacity = 4000) {
    this.cap = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.baseSize = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.cursor = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: window.innerHeight * 0.5 } },
      vertexShader: /* glsl */`
        attribute float size; attribute float alpha; attribute vec3 color;
        varying vec3 vColor; varying float vAlpha;
        uniform float uScale;
        void main() {
          vColor = color; vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vColor; varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float core = smoothstep(0.5, 0.0, d);
          float a = pow(core, 1.6) * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor * (1.0 + core * 1.5), a);
        }`,
    });
    this.mat = mat;
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    window.addEventListener('resize', () => { mat.uniforms.uScale.value = window.innerHeight * 0.5; });
  }

  spawn(x, y, z, vx, vy, vz, color, size, life, gravity = 0, drag = 0.5) {
    if (this.density < 1 && Math.random() > this.density) return; // quality setting
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.cap;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.col[i3] = color.r; this.col[i3 + 1] = color.g; this.col[i3 + 2] = color.b;
    this.baseSize[i] = size; this.life[i] = life; this.maxLife[i] = life;
    this.grav[i] = gravity; this.drag[i] = drag;
  }

  // Radial burst — the workhorse for impacts, pickups and level-ups.
  burst(p, { count = 30, color = '#ffffff', speed = 4, size = 0.4, life = 1, gravity = 0, spread = 1, up = 0, drag = 1.2 } = {}) {
    const c = color instanceof THREE.Color ? color : new THREE.Color(color);
    for (let k = 0; k < count; k++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const sp = speed * (0.4 + Math.random() * 0.6);
      this.spawn(
        p.x + (Math.random() - 0.5) * spread, p.y + (Math.random() - 0.5) * spread, p.z + (Math.random() - 0.5) * spread,
        r * Math.cos(th) * sp, u * sp + up, r * Math.sin(th) * sp,
        c, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.6), gravity, drag,
      );
    }
  }

  // Expanding flat ring (level-up, construction).
  ring(p, { count = 80, color = '#ffd36b', speed = 10, size = 0.5, life = 1.2, y = 0.2 } = {}) {
    const c = new THREE.Color(color);
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2;
      this.spawn(p.x, p.y + y, p.z, Math.cos(a) * speed, 0.3, Math.sin(a) * speed, c, size, life, 0, 1.5);
    }
  }

  update(dt) {
    const { pos, vel, life, maxLife, size, alpha, baseSize, grav, drag } = this;
    for (let i = 0; i < this.cap; i++) {
      if (life[i] <= 0) { alpha[i] = 0; size[i] = 0; continue; }
      life[i] -= dt;
      const i3 = i * 3;
      const dk = Math.exp(-drag[i] * dt);
      vel[i3] *= dk; vel[i3 + 1] = vel[i3 + 1] * dk - grav[i] * dt; vel[i3 + 2] *= dk;
      pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt;
      const t = Math.max(life[i] / maxLife[i], 0);
      alpha[i] = Math.min(1, t * 2.5) * Math.min(1, (1 - t) * 8 + 0.2);
      size[i] = baseSize[i] * (0.4 + 0.6 * t);
    }
    const a = this.geo.attributes;
    a.position.needsUpdate = true; a.color.needsUpdate = true;
    a.size.needsUpdate = true; a.alpha.needsUpdate = true;
  }
}
