import * as THREE from 'three';
import { makeCreature } from './creatures.js';

// A small studio for the bestiary: the creature's real in-game model on a lit pedestal, swaying
// slowly so its face stays toward you, with its idle animation playing. A creature not yet met is
// shown as a silhouette. The same renderer makes the roster's portrait thumbnails.
const SILHOUETTE = new THREE.MeshBasicMaterial({ color: '#171221' });

export class CreatureStage {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'jb-canvas';
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    r.setPixelRatio(Math.min(2, devicePixelRatio));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.15;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
    this.scene.add(new THREE.HemisphereLight('#fff4e6', '#3a2e4a', 1.2));
    const key = this.key = new THREE.DirectionalLight('#ffffff', 2.4);
    key.position.set(-3, 6, 6); key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0008; key.shadow.normalBias = 0.03; // no banding on big rounded bodies
    Object.assign(key.shadow.camera, { left: -4, right: 4, top: 6, bottom: -2, near: 1, far: 20 });
    this.scene.add(key, key.target);
    this.rim = new THREE.DirectionalLight('#c04dff', 2.2); this.rim.position.set(2, 4, -6); this.scene.add(this.rim);
    // Pedestal: a low stone drum with a glowing ring in the creature's colour.
    const ped = this.pedestal = new THREE.Group();
    const stone = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.4, 0.26, 64), new THREE.MeshStandardMaterial({ color: '#2d2539', roughness: 0.75 }));
    stone.position.y = -0.13; stone.receiveShadow = true; ped.add(stone);
    this.ringMat = new THREE.MeshStandardMaterial({ color: '#c04dff', emissive: '#c04dff', emissiveIntensity: 0.55 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.016, 8, 96), this.ringMat); ring.rotation.x = Math.PI / 2; ring.position.y = 0.005; ped.add(ring);
    this.scene.add(ped);
    this.thumbs = new Map();
    this.c = null;
    this.w = { chasing: false, flash: 0, vel: { x: 0, z: 0 } };
  }

  // Put `kind` on the pedestal. seen = false shows its silhouette; tint = [body, glow] colours.
  show(kind, { seen = true, tint = ['#3a2350', '#c04dff'] } = {}) {
    if (this.c) { this.scene.remove(this.c.group); this.c = null; }
    const c = this.c = makeCreature(kind);
    const g = c.group;
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; if (!seen) o.material = SILHOUETTE; } if (o.isPointLight) o.visible = seen; });
    c.tick(0, 0, this.w);
    g.rotation.y = 0;
    g.updateMatrixWorld(true);
    // Stand it on the pedestal: grounded foes on their feet, floating ones hovering just above.
    const box = new THREE.Box3().setFromObject(g);
    g.position.y = -box.min.y + (c.grounded ? 0 : 0.18);
    this.baseY = g.position.y;
    this.scene.add(g);
    // Frame it: fit its height (and width) into the view, looking at its middle.
    const size = box.getSize(new THREE.Vector3()), h = size.y + (c.grounded ? 0 : 0.18), wide = Math.max(size.x, size.z);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const dist = Math.max((h * 0.7) / Math.tan(fov / 2), (wide * 0.7) / Math.tan(fov / 2) / Math.max(0.8, this.camera.aspect)) + wide * 0.35;
    this.target = new THREE.Vector3(0, h * 0.5, 0);
    this.camera.position.set(0, h * 0.62, dist);
    this.camera.lookAt(this.target);
    this.rim.color.set(tint[1]); this.ringMat.color.set(tint[1]); this.ringMat.emissive.set(tint[1]);
    this.key.intensity = seen ? 2.4 : 0.6;
  }

  resize(w, h) {
    if (w < 2 || h < 2) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  frame(dt, t) {
    if (!this.c) return;
    this.c.tick(dt, t, this.w);
    this.c.group.rotation.y = Math.sin(t * 0.45) * 0.55;
    this.renderer.render(this.scene, this.camera);
  }

  // A portrait for the roster (cached per creature and whether it has been seen).
  thumb(kind, seen, tint) {
    const key = `${kind}:${seen}`;
    if (this.thumbs.has(key)) return this.thumbs.get(key);
    const size = this.renderer.getSize(new THREE.Vector2()), aspect = this.camera.aspect;
    this.resize(128, 128);
    this.show(kind, { seen, tint });
    this.c.group.rotation.y = 0.35;
    this.renderer.render(this.scene, this.camera);
    const url = this.canvas.toDataURL('image/png');
    this.thumbs.set(key, url);
    if (size.x > 2) { this.resize(size.x, size.y); this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }
    return url;
  }
}
