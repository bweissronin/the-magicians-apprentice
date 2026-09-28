"""Builds the character & creature library — the apprentice, Aldric and the six common foes —
in a chunky, glossy "toy troop" style (big heads and hands, stubby bodies, soft fused forms,
bold colour blocking) and exports it as one glTF binary.

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/build_characters.py

Each creature is split into parts the game animates (creatures.js / characters.js): a body
plus limbs whose origin sits on their joint. Everything is modelled in the creature's own
space, so the game places parts without offsets:
  * floating foes: origin = the creature's centre (the game hovers it above the ground)
  * walking foes and people: origin on the ground between the feet
  * arms/wings/legs: origin at the joint; arms hang down -Z, the right side is +X (the game
    mirrors it for the left)
Front faces -Y (+Z in three.js). Part names carry a c_ prefix.

Forms are blocked out from primitives and fused (kit.fuse_paint: voxel remesh + relax, then
each face takes the colour of the primitive it grew from). Glowing bits — eyes, cores, magma —
stay separate so they keep crisp edges and their own emissive material (the game pulses and
hit-flashes materials whose name ends in Eye / Core / Glow).
"""
import os, sys, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector, Matrix
import kit
from kit import (mat, sphere, ico, cyl, box, torus, lathe, join, sweep, chain, garment, xform,
                 fuse_paint, mirror_x, publish, decimate, smooth, apply_tf, spline)

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'assets', 'models', 'characters.glb')
kit.reset()
random.seed(7)


def glow(name, color, emit, strength):
    return mat(name, color, 0.3, 0.0, emit, strength)


def ell(loc, r, m, segs=32):
    """Ellipsoid primitive: r = (rx, ry, rz)."""
    return (sphere(1.0, loc, r, segs), m)


def limb(pts, r0, r1, m, step=None):
    """A tapering sausage along a path, as fuse parts."""
    return [(s, m) for s in chain(pts, r0, r1, step=step, segs=16)]


def teeth(n, x0, x1, z, y, h, r, m, down=True, jag=0.0):
    out = []
    for i in range(n):
        x = x0 + (x1 - x0) * (i + 0.5) / n
        hh = h * (1 + (jag * (1 if i % 2 else -1)))
        c = cyl(r, hh, (x, y, z - (hh / 2 if down else -hh / 2)), (0, math.pi if down else 0, 0), 10, r2=0.0, m=m)
        out.append(c)
    return out


def blob(parts, m, voxel=0.012, it=6, factor=0.5, target=None, angle=85, amp=0.0, freq=1.0, seed=0):
    """One colour region: primitives fused into a single smooth shell. Regions are separate
    shells that intersect, so every colour border is a clean curve (painted-toy look).
    amp/freq: a gentle noise pushed into the surface first (weathered stone)."""
    objs = [p[0] if isinstance(p, tuple) else p for p in parts]
    return kit.sculpt(objs, voxel, m, target, amp=amp, freq=freq, seed=seed, it=it, factor=factor, angle=angle)


def surf(o, x, z, front=-1):
    """Point and normal where a ray from the front (−Y) at (x, z) meets o."""
    t = kit.bvh(o)
    hit = t.ray_cast(Vector((x, front * 50, z)), Vector((0, -front, 0)))
    if hit[0] is None:
        raise RuntimeError(f'surf miss at {x},{z}')
    return hit[0], hit[1]


def eye(o, x, z, r, sock_m, eye_m, sink=0.25, squash=(1.2, 0.55, 0.85), tilt=0.0, pop=0.1):
    """A glowing eye set into a dark socket on o's front surface at (x, z)."""
    p, n = surf(o, x, z)
    rot = n.to_track_quat('-Y', 'Z').to_euler()
    rot.y += tilt
    s = sphere(r * 1.45, tuple(p + n * (-r * sink)), (squash[0], squash[1], squash[2]), 20, sock_m, tuple(rot))
    e = sphere(r, tuple(p + n * (r * pop)), (squash[0], squash[1] * 1.1, squash[2]), 20, eye_m, tuple(rot))
    return [s, e]


def fang(o, x, z, h, r, m, down=True):
    """A curved cone tooth rooted on o's front surface at (x, z), hanging down (or up)."""
    p, n = surf(o, x, z)
    d = Vector((0, 0, -1 if down else 1))
    pts = spline([p - n * r * 0.5, p + n * r * 0.4 + d * h * 0.5, p + n * r * 0.2 + d * h], 7)
    return sweep(pts, [r * (1 - i / 6) ** 0.8 + 0.002 for i in range(7)], m, 12)


# ================================================================ Shadow Wisp (shade)
def shade():
    body = mat('ShadeBody', '#4d2280', 0.4)
    belly = mat('ShadeBelly', '#7a45b8', 0.45)
    mask = mat('ShadeMask', '#f4eef9', 0.3)
    brow = mat('ShadeBrow', '#2a0d44', 0.5)
    mouth = mat('ShadeMouth', '#1a0624', 0.6)
    tooth = mat('ShadeTooth', '#fff7ea', 0.3)
    eyeM = glow('ShadeEye', '#ffe0ff', '#ff5af0', 6.0)
    sock = mat('ShadeSocket', '#0b0212', 0.8)
    # A plump, round body that tapers into a curl of smoke.
    b = blob([sphere(1, (0, 0, 0.06), (0.46, 0.42, 0.44), 32), sphere(1, (0, -0.04, -0.18), (0.38, 0.35, 0.34), 32)]
             + chain([(0, -0.02, -0.3), (0, 0.04, -0.5), (0.02, 0.16, -0.66), (0.0, 0.3, -0.72)], 0.26, 0.05, segs=16), body, target=5000)
    bel = blob([sphere(1, (0, -0.19, -0.14), (0.3, 0.2, 0.25), 32)], belly, target=1200)
    # A porcelain half-mask with bulging cheeks, and heavy scowling brows over it.
    mk = blob([sphere(1, (0, -0.27, 0.15), (0.35, 0.18, 0.25), 32), sphere(1, (-0.16, -0.31, 0.04), (0.13, 0.1, 0.1), 20),
               sphere(1, (0.16, -0.31, 0.04), (0.13, 0.1, 0.1), 20)], mask, target=2000)
    br = []
    for s in (-1, 1):
        br += chain([(s * 0.27, -0.37, 0.3), (s * 0.15, -0.43, 0.25), (s * 0.03, -0.44, 0.2)], 0.055, 0.035, segs=14)
    brw = blob(br, brow, target=900)
    mo = blob([sphere(1, (0, -0.35, -0.16), (0.23, 0.08, 0.08), 28)], mouth, target=600)
    extra = []
    for s in (-1, 1):
        extra += eye(mk, s * 0.125, 0.13, 0.045, sock, eyeM, tilt=s * 0.25)
    lip = lambda x: 0.08 * math.sqrt(max(0.0, 1 - (x / 0.23) ** 2)) * 0.8  # mouth half-height at x
    for x, h in ((-0.14, 0.085), (-0.055, 0.06), (0.055, 0.06), (0.14, 0.085)):
        extra.append(fang(mo, x, -0.16 + lip(x), h, 0.03, tooth))
    for x in (-0.1, 0.1):
        extra.append(fang(mo, x, -0.16 - lip(x), 0.05, 0.026, tooth, down=False))
    publish([b, bel, mk, brw, mo] + extra, 'c_shade_body')

    # Arm: a smoky sleeve swelling into a big three-clawed hand. Origin at the shoulder.
    arm = blob(chain([(0, 0, 0), (0.07, -0.05, -0.18), (0.11, -0.12, -0.36)], 0.1, 0.085, segs=16)
               + [sphere(1, (0.13, -0.16, -0.46), (0.15, 0.14, 0.13), 24), sphere(1, (0.03, -0.24, -0.43), (0.06, 0.06, 0.05), 16)], body, target=2000)
    claws = []
    for a in (-0.5, 0.0, 0.5):
        base = Vector((0.13 + math.sin(a) * 0.09, -0.24, -0.55))
        d = Vector((math.sin(a) * 0.35, -0.7, -1.0)).normalized()
        claws.append(sweep(spline([base, base + d * 0.12, base + d * 0.2 + Vector((0, -0.07, 0.03))], 8), [0.04, 0.036, 0.03, 0.025, 0.02, 0.014, 0.008, 0.002], eyeM, 10))
    publish([arm] + claws, 'c_shade_arm')


# ================================================================ Restless Spirit (specter)
def specter():
    robe = mat('SpecterRobe', '#2f7a5e', 0.55, 0.0, '#1f8a4c', 0.25)
    trim = mat('SpecterTrim', '#8fd9b0', 0.45)
    dark = mat('SpecterRobeDark', '#1d4a3c', 0.6, 0.0, '#12583a', 0.2)
    void = mat('SpecterVoid', '#030807', 0.9)
    eyeM = glow('SpecterEye', '#eafff0', '#6dff9a', 7.0)
    bone = mat('SpecterBone', '#e9f2e0', 0.45)
    gem = glow('SpecterGlow', '#b8ffd0', '#3dff7a', 4.0)
    iron = mat('SpecterIron', '#3a3844', 0.35, 0.6)
    # A deep cowl with a floppy peak; the front is scooped out to a black void.
    hood = blob([sphere(1, (0, 0.02, 0.56), (0.42, 0.42, 0.47), 32)]
                + chain([(0, 0.12, 0.88), (0, 0.32, 1.02), (0.02, 0.55, 0.96), (0.04, 0.68, 0.82)], 0.2, 0.04, segs=16), robe, target=4000)
    kit.carve(hood, [sphere(1, (0, -0.36, 0.5), (0.28, 0.26, 0.32), 32)])
    smooth(hood, 85)
    face = sphere(1, (0, -0.06, 0.5), (0.3, 0.3, 0.34), 32, void)
    # A thick rolled trim around the face opening.
    ring = [Vector((math.sin(a) * 0.28, -0.3 - 0.06 * math.cos(a) ** 2, 0.5 + math.cos(a) * 0.31)) for a in [i / 40 * math.tau for i in range(41)]]
    rim = sweep(ring, 0.045, trim, 12)
    parts = [hood, face, rim]
    for sx in (-1, 1):
        parts += eye(face, sx * 0.115, 0.57, 0.075, void, eyeM, sink=0.1, squash=(1.3, 0.5, 0.75), tilt=sx * 0.4, pop=0.4)
    # A skull's grin of big square teeth, floating in the dark.
    for i, x in enumerate((-0.12, -0.06, 0.0, 0.06, 0.12)):
        p, n = surf(face, x, 0.36)
        t = box((0.05, 0.03, 0.07 - abs(x) * 0.15), tuple(p + n * 0.01), m=bone, bevel=0.012, segs=2)
        parts.append(t)
    # Robe: a flared bell with deep folds and a ragged hem, and a short mantle over it.
    rb = garment([(0.64, -1.38), (0.56, -0.95), (0.46, -0.45), (0.38, -0.02), (0.33, 0.28), (0.22, 0.42)], robe,
                 segs=48, sub=3, hem=kit.tatters(9, 0.3, 3), hem_h=0.5, folds=(0.09, 7), thick=0.035, seed=2)
    mt = garment([(0.56, -0.05), (0.5, 0.12), (0.4, 0.28), (0.26, 0.4)], dark, segs=48, sub=2,
                 hem=kit.tatters(7, 0.12, 5), hem_h=0.2, folds=(0.06, 6), thick=0.03, seed=4)
    clasp = ico(0.065, (0, -0.47, 0.06), 2, (1, 0.6, 1.3), gem)
    publish(parts + [rb, mt, clasp], 'c_specter_body')

    # Arm: a flared sleeve and an oversized bony hand with a broken manacle. Origin at the shoulder.
    sl = blob(chain([(0, 0, 0), (0.05, -0.1, -0.2), (0.06, -0.22, -0.36)], 0.1, 0.13, segs=16), robe, target=1500)
    cuff = blob([sphere(1, (0.06, -0.26, -0.42), (0.16, 0.1, 0.16), 24)], dark, target=600)
    kit.carve(cuff, [sphere(1, (0.06, -0.33, -0.45), (0.11, 0.08, 0.11), 20)])
    palm = sphere(1, (0.06, -0.36, -0.5), (0.1, 0.07, 0.1), 20, bone)
    fingers = []
    for i, dx in enumerate((-0.06, -0.02, 0.02, 0.06)):
        for o in kit.digit((0.06 + dx, -0.4, -0.56), (dx * 1.5, -0.45, -1), (1, 0, 0), [0.07, 0.06, 0.05], 0.022, curl=0.3):
            o.data.materials.clear(); o.data.materials.append(bone); fingers.append(o)
    for o in kit.digit((-0.02, -0.36, -0.5), (-0.8, -0.6, -0.4), (0, 0, 1), [0.05, 0.05], 0.024, curl=0.3):
        o.data.materials.clear(); o.data.materials.append(bone); fingers.append(o)
    hand = blob([palm] + fingers, bone, voxel=0.008, it=3, target=2500)
    hand.scale = (1.4, 1.4, 1.4); hand.location = Vector((0.06, -0.3, -0.44)) * -0.4; apply_tf(hand)
    man = torus(0.085, 0.022, (0.06, -0.3, -0.44), (math.radians(70), 0, 0), iron, 20, 8)
    links = [torus(0.03, 0.009, (0.14, -0.3 - 0.01 * i, -0.47 - i * 0.05), (0, math.radians(90 * (i % 2)), 0), iron, 12, 6) for i in range(3)]
    publish([sl, cuff, hand, man] + links, 'c_specter_arm')


# ================================================================ Fire Imp (imp)
def imp():
    skin = mat('ImpSkin', '#c8321e', 0.45)
    dark = mat('ImpDark', '#7a1a12', 0.5)
    belly = glow('ImpCore', '#ffd070', '#ff8a1c', 3.0)
    horn = mat('ImpHorn', '#2a1a16', 0.35)
    tooth = mat('ImpTooth', '#fff4d8', 0.3)
    mouth = mat('ImpMouth', '#3a0a06', 0.6)
    eyeW = mat('ImpEyeWhite', '#fff6c8', 0.25, 0.0, '#ffd23a', 1.5)
    eyeM = glow('ImpEye', '#1a0a04', '#ff6a00', 1.0)
    brow = mat('ImpBrow', '#4a0e08', 0.5)
    # Pot-bellied body with stubby legs and arms, all one smooth piece.
    b = [sphere(1, (0, 0, -0.12), (0.36, 0.32, 0.36), 32)]
    for sx in (-1, 1):
        b += chain([(sx * 0.2, -0.02, 0.08), (sx * 0.36, -0.12, -0.04), (sx * 0.34, -0.24, -0.18)], 0.085, 0.07, segs=14)
        b.append(sphere(1, (sx * 0.34, -0.28, -0.22), (0.085, 0.08, 0.075), 16))            # fist
        b += chain([(sx * 0.16, 0, -0.4), (sx * 0.2, -0.06, -0.54)], 0.1, 0.085, segs=14)
        b.append(sphere(1, (sx * 0.21, -0.12, -0.62), (0.1, 0.14, 0.06), 16))              # foot
    body = blob(b, skin, target=5000)
    bel = blob([sphere(1, (0, -0.16, -0.16), (0.25, 0.18, 0.24), 32)], belly, target=1500)
    # A big head sitting right on the shoulders: wide cheeks, a snout, pointed ears.
    h = [sphere(1, (0, -0.04, 0.3), (0.34, 0.3, 0.28), 32), sphere(1, (0, -0.24, 0.24), (0.2, 0.14, 0.13), 24)]
    for sx in (-1, 1):
        h += chain([(sx * 0.28, 0.0, 0.34), (sx * 0.44, 0.04, 0.44), (sx * 0.52, 0.08, 0.5)], 0.08, 0.015, segs=12)
    head = blob(h, skin, target=5000)
    mo = blob([sphere(1, (0, -0.3, 0.18), (0.21, 0.07, 0.065), 28)], mouth, target=600)
    br = []
    for sx in (-1, 1):
        br += chain([(sx * 0.24, -0.26, 0.47), (sx * 0.13, -0.32, 0.42), (sx * 0.03, -0.33, 0.39)], 0.045, 0.03, segs=12)
    brw = blob(br, brow, target=800)
    extra = []
    for sx in (-1, 1):
        p, n = surf(head, sx * 0.12, 0.35)
        rot = n.to_track_quat('-Y', 'Z').to_euler()
        extra.append(sphere(0.075, tuple(p + n * 0.01), (1.1, 0.55, 1.0), 20, eyeW, tuple(rot)))
        extra.append(sphere(0.035, tuple(p + n * 0.045), (0.7, 0.4, 1.3), 16, eyeM, tuple(rot)))
        # Curling horns sweeping back from the brow.
        pts = spline([(sx * 0.16, -0.02, 0.5), (sx * 0.28, 0.02, 0.66), (sx * 0.26, 0.14, 0.8), (sx * 0.16, 0.24, 0.82)], 10)
        extra.append(sweep(pts, [0.07 * (1 - i / 9) ** 0.7 + 0.004 for i in range(10)], horn, 14))
    lip = lambda x: 0.07 * math.sqrt(max(0.0, 1 - (x / 0.21) ** 2)) * 0.8
    for x, hh in ((-0.13, 0.06), (0.13, 0.06)):
        extra.append(fang(mo, x, 0.18 + lip(x), hh, 0.028, tooth))
    for x in (-0.05, 0.05):
        extra.append(fang(mo, x, 0.18 - lip(x), 0.045, 0.024, tooth, down=False))
    # Claws on fists and feet.
    for sx in (-1, 1):
        for c in (-1, 0, 1):
            base = Vector((sx * 0.34 + c * 0.04, -0.34, -0.24))
            extra.append(sweep(spline([base, base + Vector((0, -0.05, -0.04)), base + Vector((0, -0.05, -0.1))], 6), [0.022, 0.018, 0.013, 0.009, 0.005, 0.001], horn, 8))
    publish([body, bel, head, mo, brw] + extra, 'c_imp_body')

    # Wing: a scalloped membrane on three finger bones. Origin at the root, spreading +X.
    wm = mat('ImpWing', '#8a1a14', 0.55, 0.0, '#ff4a0a', 0.3)
    tips = [Vector((0.55, 0.05, 0.42)), Vector((0.78, 0.1, 0.12)), Vector((0.6, 0.12, -0.2)), Vector((0.3, 0.08, -0.3))]
    bones = [sweep(spline([(0, 0, 0), t * 0.5 + Vector((0, 0.02, 0.06)), t], 8), [0.035 * (1 - i / 7) + 0.008 for i in range(8)], dark, 10) for t in tips[:3]]
    import bmesh
    bm = bmesh.new()
    root = bm.verts.new((0, 0, 0))
    edge = []
    for k in range(len(tips)):
        a, bb = tips[k], tips[k + 1] if k + 1 < len(tips) else Vector((0.05, 0.0, -0.12))
        for i in range(6):
            t = i / 6
            p = a.lerp(bb, t)
            sag = math.sin(t * math.pi) * 0.12
            p = p + (p.normalized() * -sag)
            edge.append(bm.verts.new(p))
    for i in range(len(edge) - 1):
        bm.faces.new((root, edge[i], edge[i + 1]))
    mem = kit.mesh_obj(bm, 'wing', wm)
    sol = mem.modifiers.new('sol', 'SOLIDIFY'); sol.thickness = 0.015; kit.apply_mod(mem, sol)
    sub = mem.modifiers.new('sub', 'SUBSURF'); sub.levels = 2; kit.apply_mod(mem, sub)
    smooth(mem, 60)
    publish([mem] + bones, 'c_imp_wing')

    # Tail: a whip curling up to a barbed spade. Origin at the root.
    pts = spline([(0, 0, 0), (0, 0.22, -0.18), (0, 0.5, -0.12), (0, 0.66, 0.1), (0, 0.7, 0.3)], 16)
    tail = sweep(pts, [0.07 * (1 - i / 15) + 0.02 for i in range(16)], skin, 14)
    smooth(tail, 80)
    spade = blob([sphere(1, (0, 0.7, 0.36), (0.03, 0.09, 0.1), 16), sphere(1, (0, 0.7, 0.42), (0.02, 0.05, 0.06), 12)], dark, voxel=0.008, target=600)
    publish([tail, spade], 'c_imp_tail')


# ================================================================ Frost Wraith (wraith)
def wraith():
    ice = mat('WraithIce', '#8fd0f5', 0.18, 0.0, '#2f8ee0', 0.35)
    deep = mat('WraithDeep', '#3f7fc8', 0.25, 0.0, '#1a5ab0', 0.3)
    maskM = mat('WraithMask', '#f2fbff', 0.22)
    brow = mat('WraithBrow', '#2a5a96', 0.4)
    eyeM = glow('WraithEye', '#eafcff', '#5fd8ff', 7.0)
    sock = mat('WraithSocket', '#0a1a30', 0.7)
    crys = mat('WraithCrystal', '#d4f2ff', 0.08, 0.0, '#6fc8ff', 0.8)
    core = glow('WraithCore', '#e8fbff', '#6fd8ff', 4.0)
    mouthM = mat('WraithMouth', '#0e2544', 0.6)
    # Hunched torso: broad shoulders, narrow waist fading into mist (the game adds streamers).
    t = [sphere(1, (0, 0.04, 0.3), (0.46, 0.34, 0.3), 32), sphere(1, (0, 0.02, 0.02), (0.3, 0.26, 0.3), 32)]
    t += chain([(0, 0.02, -0.2), (0, 0.06, -0.55), (0, 0.12, -0.85)], 0.22, 0.05, segs=16)
    torso = blob(t, ice, target=5000)
    # Ribs of deep ice framing a glowing heart crystal.
    ribs = []
    for k, z in enumerate((0.3, 0.18, 0.06)):
        w = 0.26 - k * 0.035
        arc = [Vector((math.sin(a) * w, -0.25 + 0.06 * (1 - math.cos(a)) - 0.02 * k, z - 0.05 * math.cos(a) ** 2)) for a in [(-1 + 2 * i / 16) * 1.1 for i in range(17)]]
        ribs.append(sweep(arc, [0.035] * 17, deep, 10))
    heart = kit.crystal((0, -0.26, 0.08), (0, -0.2, 1), 0.26, 0.07, core, sides=6, tip=0.3, double=True)
    # A frosted mask with a jutting chin, heavy brow and a jagged icicle grin.
    hd = blob([sphere(1, (0, -0.06, 0.66), (0.23, 0.21, 0.26), 32), sphere(1, (0, -0.15, 0.5), (0.15, 0.12, 0.11), 20)], maskM, target=3000)
    br = []
    for sx in (-1, 1):
        br += chain([(sx * 0.2, -0.19, 0.79), (sx * 0.1, -0.26, 0.74), (sx * 0.02, -0.27, 0.71)], 0.045, 0.03, segs=12)
    brw = blob(br, brow, target=700)
    mo = blob([sphere(1, (0, -0.24, 0.53), (0.13, 0.06, 0.045), 24)], mouthM, target=500)
    parts = [torso, hd, brw, mo, heart] + ribs
    for sx in (-1, 1):
        parts += eye(hd, sx * 0.09, 0.67, 0.048, sock, eyeM, squash=(1.5, 0.5, 0.7), tilt=sx * 0.3, pop=0.25)
    lip = lambda x: 0.045 * math.sqrt(max(0.0, 1 - (x / 0.13) ** 2)) * 0.8
    for x in (-0.07, 0.0, 0.07):
        parts.append(fang(mo, x, 0.53 + lip(x), 0.045, 0.018, crys))
    for x in (-0.035, 0.035):
        parts.append(fang(mo, x, 0.53 - lip(x), 0.03, 0.015, crys, down=False))
    # Crown and shoulder spikes: chunky ice crystals.
    random.seed(12)
    for i, a in enumerate((-0.6, -0.3, 0.0, 0.3, 0.6)):
        L = 0.36 - abs(a) * 0.25
        parts.append(kit.crystal((math.sin(a) * 0.13, 0.03, 0.84), (math.sin(a) * 0.6, 0.25, 1), L, 0.055, crys, sides=6, tip=0.35))
    for sx in (-1, 1):
        for k, (dx, L) in enumerate(((0.0, 0.44), (0.1, 0.32), (-0.08, 0.28))):
            parts.append(kit.crystal((sx * (0.38 + dx * 0.4), 0.04 + dx, 0.46), (sx * 0.8, 0.1 + dx, 1), L, 0.075, crys, sides=6, tip=0.35))
    publish(parts, 'c_wraith_body')

    # Arm: slim upper arm, a forearm swelling into a big hand with three icicle claws.
    arm = blob(chain([(0, 0, 0), (0.08, -0.04, -0.26)], 0.1, 0.075, segs=16)
               + chain([(0.08, -0.04, -0.26), (0.11, -0.14, -0.46), (0.12, -0.22, -0.6)], 0.08, 0.12, segs=16)
               + [sphere(1, (0.12, -0.26, -0.68), (0.14, 0.12, 0.12), 24)], ice, target=2400)
    cuffs = blob([sphere(1, (0.11, -0.16, -0.5), (0.14, 0.13, 0.07), 24)], deep, target=600)
    claws = []
    for a in (-0.45, 0.0, 0.45):
        base = Vector((0.12 + math.sin(a) * 0.08, -0.33, -0.74))
        d = Vector((math.sin(a) * 0.3, -0.5, -1)).normalized()
        claws.append(kit.crystal(tuple(base), tuple(d), 0.32, 0.04, crys, sides=5, tip=0.6))
    claws.append(cuffs)
    publish([arm] + claws, 'c_wraith_arm')


# ================================================================ Crag Golem (golem)
# Walks: origin on the ground. Parts: torso (with its heart), plates (armour the game can drop),
# head (origin at the neck), arm (shoulder pivot), leg (hip pivot).
GOLEM = {'shoulder': (0.95, 0.0, 2.05), 'hip': (0.42, 0.05, 0.86), 'neck': (0.0, -0.3, 2.3)}


def golem():
    rock = mat('GolemRock', '#9a8470', 0.7)
    rockD = mat('GolemRockDark', '#6e5c4e', 0.75)
    moss = mat('GolemMoss', '#6aa83e', 0.8)
    core = glow('GolemCore', '#ffd08a', '#ff8a1a', 4.0)
    eyeM = glow('GolemEye', '#fff3b0', '#ffc23a', 5.0)
    plateM = mat('GolemPlate', '#7c7682', 0.6)
    rune = glow('GolemRuneGlow', '#ffcf7a', '#ff9a2a', 2.5)
    # Torso: a huge hunched boulder — massive shoulders, a smaller belly, a cavity for the heart.
    t = [sphere(1, (0, 0.05, 1.8), (0.98, 0.72, 0.72), 32), sphere(1, (0, -0.05, 1.22), (0.66, 0.55, 0.5), 32)]
    for sx in (-1, 1):
        t.append(sphere(1, (sx * 0.78, 0.0, 2.0), (0.46, 0.44, 0.44), 24))
    torso = blob(t, rock, voxel=0.025, target=5000, amp=0.05, freq=2.2, seed=1)
    kit.carve(torso, [sphere(1, (0, -0.62, 1.55), (0.3, 0.25, 0.32), 24)])
    smooth(torso, 80)
    mo = blob([sphere(1, (sx * 0.72, 0.05, 2.36), (0.42, 0.4, 0.2), 20) for sx in (-1, 1)] + [sphere(1, (0, 0.2, 2.42), (0.5, 0.4, 0.14), 20)],
              moss, voxel=0.025, target=1800, amp=0.04, freq=4, seed=2)
    heart = [kit.crystal((0, -0.46, 1.5 + dz), (dx, -0.6, 1), L, 0.1, core, sides=6, tip=0.35) for dx, dz, L in ((0, 0, 0.36), (-0.4, -0.04, 0.24), (0.4, -0.02, 0.26))]
    publish([torso, mo] + heart, 'c_golem_torso')
    # Armour plates over the heart and shoulders, stitched with glowing runes.
    pl = blob([sphere(1, (0, -0.64, 1.56), (0.46, 0.14, 0.4), 28)], plateM, voxel=0.02, target=1200, amp=0.02, freq=3)
    sp = [blob([sphere(1, (sx * 0.86, 0.02, 2.26), (0.44, 0.44, 0.18), 24)], plateM, voxel=0.02, target=900, amp=0.02, freq=3, seed=4) for sx in (-1, 1)]
    runes = [sweep(spline([(-0.2, -0.79, 1.72), (0, -0.8, 1.52), (0.2, -0.79, 1.72)], 10), 0.028, rune, 8),
             sweep(spline([(0, -0.8, 1.52), (0, -0.78, 1.3)], 6), 0.028, rune, 8)]
    publish([pl] + sp + runes, 'c_golem_plates', origin=(0, 0, 0))
    # Head: small and sunk between the shoulders, a jutting brow over glowing eyes.
    n = Vector(GOLEM['neck'])
    hd = blob([sphere(1, tuple(n + Vector((0, -0.05, 0.2))), (0.34, 0.3, 0.28), 28), sphere(1, tuple(n + Vector((0, -0.2, 0.07))), (0.26, 0.18, 0.15), 20)],
              rock, voxel=0.02, target=2000, amp=0.03, freq=3, seed=5)
    brow = blob([sphere(1, tuple(n + Vector((0, -0.24, 0.3))), (0.34, 0.14, 0.09), 24)], rockD, voxel=0.02, target=800, amp=0.02, freq=3)
    tuft = blob([sphere(1, tuple(n + Vector((0, 0.02, 0.44))), (0.24, 0.2, 0.08), 16)], moss, voxel=0.02, target=500, amp=0.03, freq=5)
    eyes = []
    for sx in (-1, 1):
        p, nn = surf(hd, n.x + sx * 0.12, n.z + 0.2)
        eyes.append(sphere(0.055, tuple(p + nn * 0.005), (1.4, 0.5, 0.7), 16, eyeM, tuple(nn.to_track_quat('-Y', 'Z').to_euler())))
    publish([hd, brow, tuft] + eyes, 'c_golem_head', origin=tuple(n))
    # Arm: boulders strung shoulder → elbow → a huge fist, hanging down −Z from the shoulder.
    sh = Vector(GOLEM['shoulder'])
    a = [sphere(1, tuple(sh + Vector((0.1, 0, -0.35))), (0.36, 0.34, 0.42), 24), sphere(1, tuple(sh + Vector((0.14, -0.06, -0.9))), (0.4, 0.38, 0.4), 24)]
    arm = blob(a, rock, voxel=0.025, target=2400, amp=0.05, freq=2.4, seed=6)
    fist = blob([sphere(1, tuple(sh + Vector((0.16, -0.12, -1.42))), (0.5, 0.46, 0.44), 24)], rockD, voxel=0.025, target=1800, amp=0.04, freq=3, seed=7)
    knuck = [sphere(0.13, tuple(sh + Vector((0.16 + dx, -0.5, -1.36))), (1, 0.8, 1), 16, rockD) for dx in (-0.24, -0.08, 0.08, 0.24)]
    fist = blob([fist] + knuck, rockD, voxel=0.02, target=2000)
    mA = blob([sphere(1, tuple(sh + Vector((0.12, 0.05, -0.05))), (0.3, 0.3, 0.14), 16)], moss, voxel=0.02, target=500, amp=0.03, freq=5)
    publish([arm, fist, mA], 'c_golem_arm', origin=tuple(sh))
    # Leg: short and stout, a flat foot.
    hp = Vector(GOLEM['hip'])
    leg = blob([sphere(1, tuple(hp + Vector((0, 0, -0.3))), (0.36, 0.36, 0.4), 24)], rock, voxel=0.025, target=1500, amp=0.04, freq=2.6, seed=8)
    foot = blob([sphere(1, (hp.x + 0.02, hp.y - 0.12, 0.16), (0.4, 0.5, 0.2), 24)], rockD, voxel=0.025, target=1200, amp=0.03, freq=3, seed=9)
    kit.cut_plane(foot, (0, 0, 0.0), (0, 0, -1))
    publish([leg, foot], 'c_golem_leg', origin=tuple(hp))


# ================================================================ Bone Soldier (bones)
# Walks: origin on the ground. Body (skull, helm, ribs, legs) + two arms: sword (right), shield (left).
BONES = {'shoulder': (0.26, 0.0, 1.08)}


def bones():
    bone = mat('BonesBone', '#efe6cf', 0.45)
    boneD = mat('BonesShadow', '#c9bd9f', 0.5)
    rust = mat('BonesRust', '#8a5a3c', 0.45, 0.35)
    iron = mat('BonesIron', '#6b6e78', 0.35, 0.6)
    eyeM = glow('BonesEye', '#dcffe6', '#5dff8a', 6.0)
    sock = mat('BonesSocket', '#140f0c', 0.8)
    wood = mat('BonesWood', '#7a4a28', 0.6)
    # A big skull with a heavy jaw and hollow sockets.
    sk = blob([sphere(1, (0, 0, 1.52), (0.27, 0.26, 0.26), 32), sphere(1, (0, -0.1, 1.32), (0.19, 0.15, 0.1), 24)], bone, target=3000)
    kit.carve(sk, [sphere(1, (sx * 0.1, -0.26, 1.5), (0.075, 0.06, 0.08), 16) for sx in (-1, 1)] + [sphere(1, (0, -0.27, 1.4), (0.03, 0.05, 0.04), 12)])
    smooth(sk, 80)
    parts = [sk]
    for sx in (-1, 1):
        parts.append(sphere(0.06, (sx * 0.1, -0.19, 1.5), (1, 0.8, 1), 16, sock))
        parts.append(sphere(0.03, (sx * 0.1, -0.235, 1.5), (1, 0.6, 1), 12, eyeM))
    for i, x in enumerate((-0.09, -0.045, 0.0, 0.045, 0.09)):
        parts.append(box((0.042, 0.03, 0.07), (x, -0.245, 1.3), m=bone, bevel=0.012, segs=2))
    # A dented kettle helm with a crest.
    helm = lathe([(0.0, 1.84), (0.1, 1.83), (0.2, 1.78), (0.27, 1.68), (0.29, 1.6), (0.37, 1.56), (0.38, 1.53), (0.3, 1.54), (0.26, 1.58), (0.0, 1.6)], rust, 40, shade=60)
    crest = blob(chain([(0, 0.18, 1.72), (0, 0.0, 1.9), (0, -0.14, 1.8)], 0.04, 0.03, segs=12), iron, target=500)
    parts += [helm, crest]
    # Spine, a stubby ribcage, pelvis and bony legs.
    body = [*chain([(0, 0.05, 1.22), (0, 0.06, 0.78)], 0.045, 0.045, segs=12)]
    for k, z in enumerate((1.1, 1.0, 0.9)):
        w = 0.19 - k * 0.02
        body.append(sweep([Vector((math.sin(a) * w, -0.09 * math.cos(a) + 0.04, z)) for a in [(-1 + 2 * i / 16) * 2.4 for i in range(17)]], 0.03, bone, 10))
    body.append(sphere(1, (0, 0.04, 0.72), (0.2, 0.13, 0.09), 20))
    for sx in (-1, 1):
        body += chain([(sx * 0.12, 0.04, 0.68), (sx * 0.13, 0.02, 0.38)], 0.05, 0.045, segs=12)
        body.append(sphere(0.07, (sx * 0.13, 0.02, 0.37), segs=16))
        body += chain([(sx * 0.13, 0.02, 0.36), (sx * 0.13, 0.03, 0.1)], 0.045, 0.04, segs=12)
        body.append(sphere(1, (sx * 0.13, -0.06, 0.05), (0.08, 0.14, 0.05), 16))
    torso = blob(body, bone, target=4500)
    belt = torus(0.2, 0.025, (0, 0.04, 0.76), m=rust, seg=24, minor=6)
    publish(parts + [torso, belt], 'c_bones_body')
    # Right arm with a chunky notched sword; origin at the shoulder, hanging down −Z.
    sh = Vector(BONES['shoulder'])
    arm = blob(chain([tuple(sh), tuple(sh + Vector((0.05, -0.02, -0.22))), tuple(sh + Vector((0.07, -0.14, -0.38)))], 0.04, 0.035, segs=12)
               + [sphere(1, tuple(sh + Vector((0.07, -0.17, -0.42))), (0.06, 0.06, 0.055), 16), sphere(0.055, tuple(sh), segs=16)], bone, target=1500)
    grip = tuple(sh + Vector((0.07, -0.2, -0.42)))
    # Built upright about the grip, then tipped to point forward and up out of the fist.
    blade = box((0.11, 0.035, 0.6), (0, 0, 0.36), m=iron, bevel=0.014, segs=2)
    tip = cyl(0.056, 0.14, (0, 0, 0.73), (0, 0, math.pi / 4), 4, r2=0.0, m=iron)
    tip.scale = (1.0, 0.32, 1.0); apply_tf(tip)
    guard = box((0.26, 0.06, 0.06), (0, 0, 0.04), m=rust, bevel=0.018, segs=2)
    hilt = cyl(0.025, 0.14, (0, 0, -0.05), verts=10, m=wood)
    pommel = sphere(0.045, (0, 0, -0.13), segs=12, m=rust)
    sword = join([blade, tip, guard, hilt, pommel])
    sword.matrix_world = Matrix.Translation(Vector(grip)) @ Vector((0, 0, 1)).rotation_difference(Vector((0, -0.8, 0.7)).normalized()).to_matrix().to_4x4()
    apply_tf(sword)
    publish([arm, sword], 'c_bones_sword', origin=tuple(sh))
    # Left arm (modelled on the +X side like the right; the game mirrors it) with a round shield.
    arm2 = blob(chain([tuple(sh), tuple(sh + Vector((0.06, -0.08, -0.2))), tuple(sh + Vector((0.05, -0.2, -0.3)))], 0.04, 0.035, segs=12)
                + [sphere(0.055, tuple(sh), segs=16)], bone, target=1200)
    c = sh + Vector((0.03, -0.3, -0.3))
    shield = lathe([(0.0, 0.07), (0.08, 0.065), (0.1, 0.04), (0.3, 0.02), (0.33, 0.0), (0.32, -0.02), (0.0, -0.02)], wood, 32, shade=40)
    rim = torus(0.32, 0.03, (0, 0, 0), m=iron, seg=40, minor=8)
    boss = sphere(0.08, (0, 0, 0.06), (1, 1, 0.6), 16, iron)
    sh_obj = join([shield, rim, boss])
    sh_obj.matrix_world = Matrix.Translation(c) @ Vector((0, 0, 1)).rotation_difference(Vector((0.2, -1, 0.05)).normalized()).to_matrix().to_4x4()
    apply_tf(sh_obj)
    publish([arm2, sh_obj], 'c_bones_shield', origin=tuple(sh))


# ================================================================ people
# Walk on the ground: origin between the feet. Head parts have their origin at the head's
# centre, arms at the shoulder (hanging −Z, +X side), boots at the body origin, and the eye at
# its own centre (the game blinks it by squashing Z).
APP = {'head': (0, 0, 1.38), 'eye': (0.14, -0.345, 1.41), 'shoulder': (0.3, 0.0, 0.9), 'arm_len': 0.42}
ALD = {'head': (0, 0, 1.52), 'eye': (0.15, -0.37, 1.55), 'shoulder': (0.36, -0.02, 0.98), 'arm_len': 0.44}


def robe_part(name, prof, base, trim, belt_m, mantle_m, gem_m, belt_z, mantle, clasp_z, placket=True, extra=()):
    rb = garment(prof, base, segs=56, sub=3, folds=(0.035, 8), thick=0.025, seed=3)
    z0, r0 = prof[0][1], prof[0][0]
    hem = torus(r0 + 0.005, 0.045, (0, 0, z0 + 0.03), m=trim, seg=56, minor=12)
    parts = [rb, hem]
    def rad(z):
        for (ra, za), (rb_, zb) in zip(prof, prof[1:]):
            if za <= z <= zb:
                return ra + (rb_ - ra) * (z - za) / (zb - za)
        return prof[-1][0]
    if placket:
        # A raised gold band down the front of the robe, hugging its surface.
        pts = [Vector((0, -rad(z) + 0.006, z)) for z in [z0 + 0.06 + i * (belt_z - 0.04 - z0 - 0.06) / 8 for i in range(9)]]
        parts.append(sweep(pts, 0.038, trim, 12, squash=0.4))
    rb_z = rad(belt_z)
    parts.append(torus(rb_z + 0.01, 0.045, (0, 0, belt_z), m=belt_m, seg=48, minor=10))
    parts.append(box((0.12, 0.06, 0.1), (0, -rb_z - 0.045, belt_z), m=trim, bevel=0.025, segs=2))
    parts.append(lathe(mantle, mantle_m, 48, shade=70))
    parts.append(ico(0.055, (0, -mantle[0][0] * 0.78 - 0.02, clasp_z), 2, (1, 0.6, 1.2), gem_m))
    publish(parts + list(extra), name)


def mitten_arm(name, sh, length, sleeve_m, cuff_m, skin_m):
    sh = Vector(sh)
    sl = blob(chain([tuple(sh), tuple(sh + Vector((0, 0, -length * 0.45))), tuple(sh + Vector((0, 0, -length * 0.74)))], 0.1, 0.14, segs=16), sleeve_m, target=1500)
    cuff = torus(0.13, 0.035, tuple(sh + Vector((0, 0, -length * 0.78))), m=cuff_m, seg=32, minor=10)
    h = sh + Vector((0, 0, -length))
    hand = blob([sphere(1, tuple(h), (0.105, 0.1, 0.115), 24), sphere(1, tuple(h + Vector((-0.07, -0.06, 0.02))), (0.045, 0.045, 0.055), 16)]
                + [sphere(1, tuple(h + Vector((dx, -0.03, -0.1))), (0.035, 0.05, 0.04), 12) for dx in (-0.04, 0.0, 0.04)], skin_m, voxel=0.008, target=1800)
    publish([sl, cuff, hand], name, origin=tuple(sh))


def eyeball(name, r, iris_c):
    white = mat('EyeWhite', '#fbfbf7', 0.2)
    iris = mat(name + 'Iris', iris_c, 0.25)
    pupil = mat('EyePupil', '#140f12', 0.15)
    shine = mat('EyeShine', '#ffffff', 0.1, 0.0, '#ffffff', 1.0)
    e = sphere(r, (0, 0, 0), (1, 0.8, 1.1), 32, white)
    ir = sphere(r * 0.62, (0, -r * 0.52, 0), (1, 0.55, 1.1), 24, iris)
    pu = sphere(r * 0.36, (0, -r * 0.72, 0), (1, 0.4, 1.1), 20, pupil)
    gl = sphere(r * 0.16, (-r * 0.2, -r * 0.83, r * 0.25), (1, 0.4, 1), 12, shine)
    publish([e, ir, pu, gl], name)


def apprentice():
    skin = mat('AppSkin', '#ffcfa6', 0.5)
    nose = mat('AppNose', '#f7b690', 0.45)
    hair = mat('AppHair', '#6b3a1e', 0.45)
    brow = mat('AppBrow', '#4a2610', 0.5)
    mouth = mat('AppMouth', '#5a1a1a', 0.6)
    tooth = mat('AppTooth', '#ffffff', 0.25)
    tongue = mat('AppTongue', '#e0606a', 0.5)
    blue = mat('AppRobe', '#3f5fd8', 0.55)
    blueD = mat('AppMantle', '#2f47b8', 0.55)
    gold = mat('Gold', '#ffcf5a', 0.3, 0.3)
    leather = mat('AppLeather', '#8a5429', 0.55)
    boot = mat('AppBoot', '#6a3d20', 0.45)
    sole = mat('AppSole', '#3a2212', 0.6)
    gem = mat('AppClasp', '#9fe8ff', 0.15, 0.0, '#4fc8ff', 2.0)
    robe_part('c_app_body', [(0.52, 0.08), (0.46, 0.3), (0.38, 0.55), (0.31, 0.78), (0.27, 0.92)], blue, gold, leather, blueD, gem, 0.62,
              [(0.4, 0.84), (0.39, 0.9), (0.31, 0.99), (0.19, 1.05), (0.001, 1.07)], 0.95)
    c = Vector(APP['head'])
    L = lambda x, y, z: tuple(c + Vector((x, y, z)))
    head = blob([sphere(1, L(0, 0, 0.02), (0.42, 0.4, 0.4), 40), sphere(1, L(0, -0.1, -0.14), (0.34, 0.3, 0.24), 32)]
                + [sphere(1, L(sx * 0.4, 0.02, -0.02), (0.07, 0.1, 0.13), 16) for sx in (-1, 1)]
                + [sphere(1, L(sx * 0.2, -0.3, -0.12), (0.12, 0.08, 0.09), 20) for sx in (-1, 1)], skin, target=5000)
    nz = blob([sphere(1, L(0, -0.43, -0.07), (0.085, 0.08, 0.075), 24), sphere(1, L(0, -0.4, -0.02), (0.045, 0.06, 0.06), 16)], nose, voxel=0.008, target=900)
    # A wide, confident grin: a smiling dark crescent with a bright row of teeth.
    smile = lambda x, dz=0.0, dy=0.0: L(x, -0.37 + abs(x) * 0.28 + dy, -0.215 + x * x * 3.2 + dz)
    mo = blob(chain([smile(x) for x in (-0.15, -0.08, 0.0, 0.08, 0.15)], 0.05, 0.05, segs=14)
              + [sphere(1, L(0, -0.35, -0.23), (0.11, 0.06, 0.05), 20)], mouth, voxel=0.008, target=1200)
    teeth = blob(chain([smile(x, 0.02, -0.022) for x in (-0.11, -0.055, 0.0, 0.055, 0.11)], 0.026, 0.026, segs=12), tooth, voxel=0.006, target=700)
    tg = blob([sphere(1, L(0, -0.372, -0.255), (0.06, 0.035, 0.022), 16)], tongue, voxel=0.006, target=300)
    br = []
    for sx in (-1, 1):
        br += chain([L(sx * 0.25, -0.33, 0.14), L(sx * 0.15, -0.39, 0.16), L(sx * 0.05, -0.405, 0.13)], 0.04, 0.03, segs=14)
    brw = blob(br, brow, voxel=0.008, target=900)
    # Hair: a cap under the hat and chunky pointed locks — a fringe, sideburns and a back tuft.
    hr = [sphere(1, L(0, 0.05, 0.14), (0.45, 0.43, 0.3), 32)]
    for k, x in enumerate((-0.28, -0.14, 0.0, 0.14, 0.28)):
        hr += chain([L(x, -0.3 + abs(x) * 0.4, 0.3), L(x * 1.15, -0.37 + abs(x) * 0.45, 0.22), L(x * 1.25 + 0.03, -0.39 + abs(x) * 0.5, 0.17 - (k % 2) * 0.03)], 0.07, 0.012, segs=12)
    for sx in (-1, 1):
        hr += chain([L(sx * 0.37, -0.12, 0.16), L(sx * 0.42, -0.14, 0.0), L(sx * 0.4, -0.13, -0.1)], 0.07, 0.015, segs=12)
        hr += chain([L(sx * 0.2, 0.32, 0.06), L(sx * 0.26, 0.4, -0.08), L(sx * 0.22, 0.38, -0.18)], 0.08, 0.015, segs=12)
    hr += chain([L(0, 0.36, 0.08), L(0, 0.44, -0.06), L(0, 0.4, -0.2)], 0.09, 0.015, segs=12)
    hairO = blob(hr, hair, target=4000)
    publish([head, nz, mo, teeth, tg, brw, hairO], 'c_app_head', origin=tuple(c))
    eyeball('c_app_eye', 0.072, '#5a3a1a')
    mitten_arm('c_app_arm', APP['shoulder'], APP['arm_len'], blue, gold, skin)
    b = blob([sphere(1, (0.15, -0.1, 0.1), (0.12, 0.19, 0.11), 24), sphere(1, (0.15, -0.26, 0.13), (0.07, 0.07, 0.06), 16)], boot, target=1200)
    so = blob([sphere(1, (0.15, -0.1, 0.025), (0.13, 0.2, 0.04), 20)], sole, target=500)
    kit.cut_plane(so, (0, 0, 0.0), (0, 0, -1))
    publish([b, so], 'c_app_boot')


def aldric():
    skin = mat('AldSkin', '#f6c7a0', 0.5)
    nose = mat('AldNose', '#eaa27e', 0.45)
    beard = mat('AldBeard', '#f6f6fb', 0.55)
    purple = mat('AldRobe', '#7a3fc0', 0.55)
    purpleD = mat('AldMantle', '#5b2c96', 0.55)
    gold = mat('Gold', '#ffcf5a', 0.3, 0.3)
    rope = mat('AldRope', '#e0b877', 0.6)
    rim = mat('AldGlasses', '#2b2330', 0.3, 0.4)
    lens = mat('AldLens', '#dff4ff', 0.05, 0.0, '#bfe8ff', 0.2)
    gem = mat('AldClasp', '#ffc4ff', 0.15, 0.0, '#ff5cf0', 2.0)
    cover = mat('AldBook', '#b4452f', 0.5)
    pages = mat('AldPages', '#fff4d6', 0.6)
    bk = join([box((0.1, 0.3, 0.38), (0, 0, 0), m=cover, bevel=0.02, segs=2), box((0.085, 0.27, 0.34), (0.02, 0, 0), m=pages, bevel=0.01, segs=1)])
    bk.matrix_world = Matrix.Translation(Vector((-0.44, -0.18, 0.52))) @ Matrix.Rotation(-0.9, 4, 'Z'); apply_tf(bk)
    robe_part('c_ald_body', [(0.64, 0.02), (0.56, 0.3), (0.46, 0.6), (0.37, 0.88), (0.33, 1.02)], purple, gold, rope, purpleD, gem, 0.66,
              [(0.49, 0.97), (0.46, 1.04), (0.36, 1.13), (0.2, 1.2), (0.001, 1.21)], 1.08, placket=True, extra=[bk])
    c = Vector(ALD['head'])
    L = lambda x, y, z: tuple(c + Vector((x, y, z)))
    head = blob([sphere(1, L(0, 0, 0.02), (0.44, 0.42, 0.42), 40), sphere(1, L(0, -0.08, -0.14), (0.35, 0.3, 0.24), 32)]
                + [sphere(1, L(sx * 0.42, 0.02, -0.02), (0.07, 0.1, 0.14), 16) for sx in (-1, 1)], skin, target=5000)
    nz = blob([sphere(1, L(0, -0.46, -0.05), (0.11, 0.1, 0.1), 24), sphere(1, L(0, -0.42, 0.02), (0.05, 0.07, 0.07), 16)], nose, voxel=0.008, target=900)
    # A great fluffy beard and a curling moustache, fused into soft clumps.
    bd = [sphere(1, L(0, -0.3, -0.3), (0.36, 0.25, 0.26), 32), sphere(1, L(0, -0.3, -0.52), (0.3, 0.22, 0.22), 28),
          sphere(1, L(0, -0.26, -0.72), (0.2, 0.17, 0.17), 24), sphere(1, L(0, -0.22, -0.86), (0.1, 0.1, 0.1), 16)]
    bd += [sphere(1, L(sx * 0.24, -0.24, -0.34), (0.2, 0.2, 0.22), 24) for sx in (-1, 1)]
    for sx in (-1, 1):
        bd += chain([L(sx * 0.04, -0.47, -0.12), L(sx * 0.2, -0.45, -0.16), L(sx * 0.32, -0.38, -0.1), L(sx * 0.36, -0.32, 0.0)], 0.075, 0.025, segs=14)
        bd += chain([L(sx * 0.24, -0.36, 0.17), L(sx * 0.14, -0.42, 0.18), L(sx * 0.05, -0.43, 0.15)], 0.055, 0.035, segs=12)   # bushy brows
        bd += chain([L(sx * 0.4, -0.08, 0.12), L(sx * 0.44, 0.06, 0.02), L(sx * 0.4, 0.2, -0.04), L(sx * 0.3, 0.3, -0.02)], 0.075, 0.03, segs=14)  # swept side hair
    bdO = blob(bd, beard, target=6000)
    extra = []
    for sx in (-1, 1):
        ec = Vector(ALD['eye']) * Vector((sx, 1, 1))
        extra.append(torus(0.09, 0.013, tuple(ec + Vector((0, -0.045, 0))), (math.radians(90), 0, sx * -0.25), rim, 28, 8))
        extra.append(cyl(0.085, 0.006, tuple(ec + Vector((0, -0.045, 0))), (math.radians(90), 0, sx * -0.25), 28, m=lens))
    extra.append(sweep(spline([L(-0.065, -0.43, 0.04), L(0, -0.46, 0.06), L(0.065, -0.43, 0.04)], 6), 0.012, rim, 8))
    publish([head, nz, bdO] + extra, 'c_ald_head', origin=tuple(c))
    eyeball('c_ald_eye', 0.06, '#3a5a8a')
    mitten_arm('c_ald_arm', ALD['shoulder'], ALD['arm_len'], purple, gold, skin)


# ================================================================ guardians
# Bosses keep the guardian conventions of bosses.glb: body origin on the ground under it (the
# game hovers the floating ones), arms at the shoulder. Joints (Blender coords):
GUARD = {'lich': (0.66, 0.0, 2.3), 'queen': (0.4, 0.0, 2.36), 'tyrant': (1.0, 0.0, 2.55)}


def big_hand(c, m, s=1.0, bony=False, claws=None):
    """A chunky hand at c: palm, four fingers and a thumb, fused (bony = knuckled digits)."""
    c = Vector(c)
    parts = [sphere(1, tuple(c), (0.13 * s, 0.1 * s, 0.14 * s), 20)]
    for dx in (-0.075, -0.025, 0.025, 0.075):
        base = c + Vector((dx * s, -0.04 * s, -0.1 * s))
        if bony:
            for o in kit.digit(tuple(base), (dx * 0.8, -0.35, -1), (1, 0, 0), [0.09 * s, 0.07 * s, 0.06 * s], 0.026 * s, curl=0.35):
                parts.append(o)
        else:
            parts += chain([tuple(base), tuple(base + Vector((dx * 0.3, -0.06, -0.12)) * 1.0), tuple(base + Vector((dx * 0.4, -0.12, -0.2)))], 0.045 * s, 0.035 * s, segs=12)
    th = c + Vector((-0.1 * s, -0.08 * s, -0.02 * s))
    if bony:
        parts += kit.digit(tuple(th), (-0.8, -0.6, -0.3), (0, 0, 1), [0.07 * s, 0.06 * s], 0.028 * s, curl=0.3)
    else:
        parts += chain([tuple(th), tuple(th + Vector((-0.06, -0.08, -0.06)))], 0.05 * s, 0.04 * s, segs=12)
    h = blob(parts, m, voxel=0.01 * s, it=3 if bony else 5, target=3000)
    out = [h]
    if claws:
        for dx in (-0.075, -0.025, 0.025, 0.075):
            base = c + Vector((dx * s * 1.1, -0.2 * s, -0.28 * s))
            out.append(sweep(spline([base, base + Vector((0, -0.06, -0.06)) * s, base + Vector((0, -0.04, -0.14)) * s], 6), [0.03 * s * (1 - i / 6) + 0.003 for i in range(6)], claws, 8))
    return out


def lich():
    robe = mat('LichRobe', '#43275f', 0.55)
    robeD = mat('LichRobeDark', '#24143a', 0.6)
    gold = mat('LichGold', '#f0c24a', 0.3, 0.5)
    bone = mat('LichBone', '#efe6cf', 0.45)
    boneD = mat('LichBoneShadow', '#1a0f14', 0.8)
    eyeM = glow('LichEye', '#e8fff0', '#5dff8a', 6.0)
    core = glow('LichCore', '#c8ffd8', '#3dff7a', 5.0)
    gem = glow('LichGemGlow', '#b8ffcc', '#3dff7a', 3.0)
    # Robe: wide bell with deep folds and a ragged hem, gold-trimmed mantle with high collar spikes.
    rb = garment([(1.02, 0.0), (0.92, 0.55), (0.76, 1.2), (0.62, 1.75), (0.54, 2.1), (0.4, 2.36)], robe, segs=64, sub=3,
                 hem=kit.tatters(11, 0.28, 8), hem_h=0.5, folds=(0.07, 8), thick=0.05, seed=5)
    # The front hangs open over a dark chest: a bony ribcage cradling the phylactery.
    chest = blob([sphere(1, (0, -0.46, 1.95), (0.34, 0.2, 0.36), 28)], boneD, target=1200)
    ribs = []
    for k, z in enumerate((2.14, 2.0, 1.86, 1.72)):
        w = 0.3 - k * 0.03
        ribs.append(sweep([Vector((math.sin(a) * w, -0.64 + 0.14 * (1 - math.cos(a)), z - 0.06 * (1 - math.cos(a)))) for a in [(-1 + 2 * i / 16) * 1.2 for i in range(17)]], 0.045, bone, 10))
    ribs.append(sweep(spline([(0, -0.62, 2.22), (0, -0.6, 1.95), (0, -0.58, 1.66)], 8), 0.055, bone, 10))
    heart = kit.crystal((0, -0.62, 1.74), (0, -0.25, 1), 0.36, 0.1, core, sides=6, tip=0.3, double=True)
    mt = garment([(0.86, 1.95), (0.78, 2.12), (0.64, 2.3), (0.44, 2.44)], robeD, segs=64, sub=2, hem=kit.tatters(8, 0.18, 9), hem_h=0.2, folds=(0.05, 6), thick=0.04, seed=6)
    # Part the robe and mantle down the front so the ribcage and its phylactery show.
    for o in (rb, mt):
        kit.carve(o, [sphere(1, (0, -0.72, 1.92), (0.3, 0.4, 0.42), 28)])
        smooth(o, 60)
    trim = torus(0.46, 0.05, (0, 0, 2.42), m=gold, seg=48, minor=10)
    collar = [kit.crystal((math.sin(a) * 0.46, math.cos(a) * 0.3 + 0.1, 2.44), (math.sin(a) * 0.5, math.cos(a) * 0.3 + 0.4, 1), 0.45 - abs(a - math.pi) * 0.05, 0.07, robeD, sides=5, tip=0.5)
              for a in (math.pi - 1.3, math.pi - 0.8, math.pi + 0.8, math.pi + 1.3)]
    # A massive skull: heavy brow, deep sockets, wide cheekbones and a jaw of square teeth.
    hc = Vector((0, -0.08, 2.78))
    H = lambda x, y, z: tuple(hc + Vector((x, y, z)))
    sk = blob([sphere(1, H(0, 0, 0.05), (0.36, 0.34, 0.34), 36), sphere(1, H(0, -0.1, -0.2), (0.27, 0.22, 0.16), 28)]
              + [sphere(1, H(sx * 0.22, -0.2, -0.06), (0.1, 0.1, 0.09), 16) for sx in (-1, 1)], bone, target=5000)
    kit.carve(sk, [sphere(1, H(sx * 0.13, -0.33, 0.05), (0.1, 0.09, 0.09), 20) for sx in (-1, 1)] + [sphere(1, H(0, -0.36, -0.08), (0.035, 0.06, 0.05), 12)])
    smooth(sk, 80)
    brow = blob(chain([H(-0.26, -0.26, 0.16), H(-0.1, -0.33, 0.12), H(0, -0.33, 0.1), H(0.1, -0.33, 0.12), H(0.26, -0.26, 0.16)], 0.06, 0.06, segs=16), bone, target=1200)
    parts = [sk, brow]
    for sx in (-1, 1):
        parts.append(sphere(0.09, H(sx * 0.13, -0.26, 0.05), (1, 0.8, 1), 20, boneD))
        parts.append(sphere(0.05, H(sx * 0.13, -0.32, 0.04), (1.3, 0.5, 0.8), 16, eyeM))
    for i, x in enumerate((-0.14, -0.07, 0.0, 0.07, 0.14)):
        parts.append(box((0.06, 0.04, 0.085), H(x, -0.3 + abs(x) * 0.35, -0.24), m=bone, bevel=0.015, segs=2))
    # Cowl behind the skull, and a spiked gold crown with glowing gems on top.
    hood = blob([sphere(1, H(0, 0.12, 0.06), (0.46, 0.4, 0.48), 32)] + chain([H(0, 0.2, 0.46), H(0, 0.46, 0.5), H(0, 0.6, 0.3)], 0.2, 0.05, segs=14), robe, target=3000)
    kit.carve(hood, [sphere(1, H(0, -0.36, 0.0), (0.42, 0.36, 0.52), 28)])
    smooth(hood, 85)
    band = lathe([(0.3, 0.0), (0.32, 0.06), (0.31, 0.12), (0.28, 0.12), (0.27, 0.0)], gold, 40, loc=H(0, 0.02, 0.28), shade=60)
    spikes = [kit.crystal(H(math.sin(a) * 0.3, math.cos(a) * 0.3 + 0.02, 0.38), (math.sin(a) * 0.25, math.cos(a) * 0.25, 1), 0.2 + 0.08 * (k % 2), 0.05, gold, sides=4, tip=0.6)
              for k, a in enumerate([i / 8 * math.tau + math.pi for i in range(8)])]
    gems = [ico(0.035, H(math.sin(a) * 0.315, math.cos(a) * 0.315 + 0.02, 0.34), 2, m=gem) for a in [i / 8 * math.tau + math.pi for i in range(8)]]
    publish([rb, chest, heart, mt, trim, hood, band] + ribs + collar + parts + spikes + gems, 'c_lich_body')
    # Arm: a great flared sleeve with a gold cuff and a huge bony hand.
    sh = Vector(GUARD['lich'])
    sl = garment([(0.26, -0.62), (0.2, -0.36), (0.15, -0.1), (0.13, 0.06)], robe, segs=32, sub=2, hem=kit.tatters(5, 0.1, 3), hem_h=0.15, folds=(0.06, 4), thick=0.03, seed=7)
    xform(sl, tuple(sh + Vector((0.04, -0.04, 0))), (0.12, -0.08, 0))
    cuff = torus(0.24, 0.035, tuple(sh + Vector((0.06, -0.11, -0.56))), (0.12, 0, 0), gold, 32, 8)
    hand = big_hand(sh + Vector((0.07, -0.14, -0.72)), bone, 1.4, bony=True)
    publish([sl, cuff] + hand, 'c_lich_arm', origin=tuple(sh))


def queen():
    gown = mat('QueenGown', '#9fd4f5', 0.3)
    deep = mat('QueenDeep', '#3a74c8', 0.35)
    ice = mat('QueenIce', '#e6f7ff', 0.08, 0.0, '#7fd0ff', 0.6)
    skin = mat('QueenSkin', '#dceeff', 0.4)
    hair = mat('QueenHair', '#f5fbff', 0.35)
    brow = mat('QueenBrow', '#27518f', 0.5)
    lips = mat('QueenLips', '#6f5ab8', 0.4)
    eyeM = glow('QueenEye', '#eafcff', '#5fd8ff', 6.0)
    sock = mat('QueenSocket', '#1a3a66', 0.6)
    # Bell gown with an icy crystal fringe at the hem.
    gw = garment([(0.98, 0.0), (0.84, 0.5), (0.6, 1.2), (0.42, 1.75), (0.34, 1.95)], gown, segs=64, sub=3, folds=(0.05, 10), thick=0.05, seed=11)
    fringe = [kit.crystal((math.cos(a) * 0.96, math.sin(a) * 0.96, 0.18), (math.cos(a) * 0.6, math.sin(a) * 0.6, -0.3), 0.22 + 0.08 * (i % 2), 0.06, ice, sides=5, tip=0.5)
              for i, a in enumerate([k / 22 * math.tau for k in range(22)])]
    sash = torus(0.37, 0.05, (0, 0, 1.9), m=deep, seg=48, minor=10)
    torso = blob([sphere(1, (0, 0, 2.15), (0.34, 0.26, 0.3), 32), sphere(1, (0, -0.02, 1.9), (0.3, 0.24, 0.16), 24)], deep, target=3000)
    neck = blob(chain([(0, 0, 2.38), (0, -0.02, 2.55)], 0.1, 0.09, segs=10), skin, target=500)
    # A stern face: high cheekbones, heavy brows, glowing eyes, a crystal crown and a sculpted updo.
    hc = Vector((0, -0.04, 2.76))
    H = lambda x, y, z: tuple(hc + Vector((x, y, z)))
    hd = blob([sphere(1, H(0, 0, 0.02), (0.27, 0.26, 0.3), 32), sphere(1, H(0, -0.1, -0.15), (0.17, 0.15, 0.12), 24)]
              + [sphere(1, H(sx * 0.15, -0.19, -0.04), (0.08, 0.07, 0.07), 16) for sx in (-1, 1)]
              + [sphere(1, H(0, -0.27, -0.02), (0.035, 0.05, 0.06), 12)], skin, target=4000)
    br = []
    for sx in (-1, 1):
        br += chain([H(sx * 0.2, -0.2, 0.12), H(sx * 0.11, -0.25, 0.1), H(sx * 0.03, -0.26, 0.06)], 0.03, 0.02, segs=12)
    brw = blob(br, brow, voxel=0.008, target=600)
    lp = blob(chain([H(-0.06, -0.25, -0.16), H(0, -0.265, -0.155), H(0.06, -0.25, -0.16)], 0.025, 0.025, segs=10), lips, voxel=0.006, target=400)
    parts = [gw, sash, torso, neck, hd, brw, lp]
    for sx in (-1, 1):
        parts += eye(hd, sx * 0.1, 2.78, 0.045, sock, eyeM, squash=(1.4, 0.5, 0.75), tilt=sx * 0.3, pop=0.3)
    hr = [sphere(1, H(0, 0.08, 0.12), (0.3, 0.28, 0.26), 28), sphere(1, H(0, 0.18, 0.3), (0.22, 0.2, 0.2), 24), sphere(1, H(0, 0.2, 0.46), (0.14, 0.14, 0.14), 20)]
    for sx in (-1, 1):
        hr += chain([H(sx * 0.22, -0.1, 0.18), H(sx * 0.3, 0.02, 0.0), H(sx * 0.26, 0.08, -0.2)], 0.08, 0.04, segs=12)
    hairO = blob(hr, hair, target=3000)
    crown = [kit.crystal(H(math.sin(a) * 0.17, -0.12 + math.cos(a) * 0.08, 0.28), (math.sin(a) * 0.4, -0.1, 1), 0.34 - abs(a) * 0.28, 0.05, ice, sides=6, tip=0.4) for a in (-0.7, -0.35, 0.0, 0.35, 0.7)]
    fan = [kit.crystal((math.sin(a) * 0.3, 0.2, 2.45), (math.sin(a) * 1.0, 0.35, 1), 0.55 - abs(a) * 0.12, 0.06, ice, sides=5, tip=0.5) for a in (-1.3, -0.9, -0.45, 0.0, 0.45, 0.9, 1.3)]
    pauld = []
    for sx in (-1, 1):
        pauld += [kit.crystal((sx * (0.36 + dx), 0.0 + dx * 0.5, 2.36), (sx * 1.0, 0.1, 0.7 + dx), L, 0.07, ice, sides=6, tip=0.4) for dx, L in ((0.0, 0.32), (0.08, 0.24), (-0.06, 0.22))]
    publish(parts + [hairO] + fringe + crown + fan + pauld, 'c_queen_body')
    sh = Vector(GUARD['queen'])
    arm = blob(chain([tuple(sh), tuple(sh + Vector((0.04, -0.02, -0.28))), tuple(sh + Vector((0.06, -0.1, -0.55)))], 0.085, 0.07, segs=14), deep, target=1500)
    cuff = blob([sphere(1, tuple(sh + Vector((0.06, -0.1, -0.52))), (0.11, 0.11, 0.07), 20)], ice, target=500)
    hand = big_hand(sh + Vector((0.06, -0.13, -0.66)), skin, 0.9)
    publish([arm, cuff] + hand, 'c_queen_arm', origin=tuple(sh))


def tyrant():
    rock = mat('TyrantRock', '#3d2c2a', 0.6)
    rockL = mat('TyrantRockLight', '#5a403a', 0.6)
    magma = glow('TyrantCore', '#ffd070', '#ff6a1a', 3.5)
    horn = mat('TyrantHorn', '#1c1414', 0.35)
    tooth = mat('TyrantTooth', '#fff0d0', 0.3)
    mouth = mat('TyrantMouth', '#2a0604', 0.6)
    eyeM = glow('TyrantEye', '#fff6c0', '#ffb020', 6.0)
    gold = mat('TyrantGold', '#ffb347', 0.25, 0.6, '#ff8a1a', 1.2)
    plateM = mat('TyrantPlate', '#241a1c', 0.3, 0.2)
    # A hulking brute: massive chest and shoulders, pot belly, short thick legs — all one mass.
    t = [sphere(1, (0, 0.05, 2.1), (0.95, 0.7, 0.62), 36), sphere(1, (0, -0.12, 1.5), (0.72, 0.6, 0.55), 32)]
    for sx in (-1, 1):
        t.append(sphere(1, (sx * 0.85, 0.02, 2.38), (0.46, 0.44, 0.42), 24))
        t += chain([(sx * 0.35, 0.02, 1.1), (sx * 0.42, 0.0, 0.55)], 0.3, 0.26, segs=16)
        t.append(sphere(1, (sx * 0.44, -0.12, 0.16), (0.3, 0.4, 0.17), 20))
    body = blob(t, rock, voxel=0.022, target=7000, amp=0.03, freq=2.5, seed=3)
    kit.cut_plane(body, (0, 0, 0.0), (0, 0, -1))
    belly = blob([sphere(1, (0, -0.52, 1.5), (0.46, 0.2, 0.4), 28)], rockL, voxel=0.02, target=1200)
    # Magma veins glowing across the rock.
    tree = kit.bvh(body)
    random.seed(21)
    veins = []
    for k in range(14):
        a, z = random.uniform(-2.6, 2.6), random.uniform(0.7, 2.5)
        pts = []
        for i in range(7):
            d = Vector((math.sin(a), -math.cos(a), 0))
            hit = tree.find_nearest(Vector((d.x * 1.5, d.y * 1.5, z)))
            if hit[0] is not None:
                pts.append(hit[0] + hit[1] * 0.01)
            a += random.uniform(-0.18, 0.18); z += random.uniform(-0.12, 0.12)
        if len(pts) > 2:
            veins.append(sweep(spline(pts, 12), [0.035 * (1 - abs(i - 5.5) / 6) + 0.008 for i in range(12)], magma, 8))
    # Head: horned demon skull sunk into the shoulders, wide fanged jaw, burning eyes, molten crown.
    hc = Vector((0, -0.45, 2.62))
    H = lambda x, y, z: tuple(hc + Vector((x, y, z)))
    hd = blob([sphere(1, H(0, 0, 0.05), (0.36, 0.32, 0.3), 32), sphere(1, H(0, -0.16, -0.14), (0.32, 0.2, 0.16), 28)], rockL, target=4000)
    brow = blob(chain([H(-0.3, -0.24, 0.14), H(-0.12, -0.33, 0.08), H(0, -0.32, 0.1), H(0.12, -0.33, 0.08), H(0.3, -0.24, 0.14)], 0.07, 0.07, segs=16), rock, target=1200)
    mo = blob([sphere(1, H(0, -0.34, -0.16), (0.24, 0.07, 0.07), 28)], mouth, target=600)
    parts = [body, belly, hd, brow, mo] + veins
    for sx in (-1, 1):
        p, n = surf(hd, sx * 0.13, hc.z + 0.02)
        parts.append(sphere(0.06, tuple(p + n * 0.01), (1.4, 0.5, 0.8), 16, eyeM, tuple(n.to_track_quat('-Y', 'Z').to_euler())))
        pts = spline([H(sx * 0.26, -0.05, 0.22), H(sx * 0.55, 0.0, 0.42), H(sx * 0.62, 0.1, 0.78), H(sx * 0.45, 0.2, 0.98)], 12)
        parts.append(sweep(pts, [0.13 * (1 - i / 11) ** 0.8 + 0.01 for i in range(12)], horn, 16))
    lip = lambda x: 0.07 * math.sqrt(max(0.0, 1 - (x / 0.24) ** 2)) * 0.8
    for x, h in ((-0.17, 0.1), (-0.06, 0.07), (0.06, 0.07), (0.17, 0.1)):
        parts.append(fang(mo, x, hc.z - 0.16 + lip(x), h, 0.035, tooth, down=False if abs(x) > 0.1 else True))
    crown = [kit.crystal(H(math.sin(a) * 0.24, math.cos(a) * 0.2 + 0.05, 0.3), (math.sin(a) * 0.3, math.cos(a) * 0.2, 1), 0.2 + 0.07 * (k % 2), 0.05, gold, sides=4, tip=0.6)
             for k, a in enumerate([i / 7 * math.tau + math.pi for i in range(7)])]
    publish(parts + crown, 'c_tyrant_body')
    # Lava plates: obsidian slabs over chest and shoulders with glowing seams.
    pl = [blob([sphere(1, (0, -0.64, 2.05), (0.6, 0.15, 0.42), 28)], plateM, voxel=0.02, target=1400, amp=0.02, freq=3)]
    pl += [blob([sphere(1, (sx * 0.92, 0.0, 2.62), (0.45, 0.45, 0.18), 24)], plateM, voxel=0.02, target=1000, amp=0.02, freq=3, seed=2) for sx in (-1, 1)]
    seams = [sweep(spline([(-0.45, -0.8, 2.2), (0, -0.82, 2.0), (0.45, -0.8, 2.2)], 10), 0.03, magma, 8)]
    publish(pl + seams, 'c_tyrant_plates')
    sh = Vector(GUARD['tyrant'])
    arm = blob([sphere(1, tuple(sh + Vector((0.08, 0, -0.35))), (0.34, 0.33, 0.42), 24), sphere(1, tuple(sh + Vector((0.12, -0.06, -0.92))), (0.38, 0.36, 0.4), 24)],
               rock, voxel=0.022, target=2400, amp=0.03, freq=2.5, seed=6)
    fist = blob([sphere(1, tuple(sh + Vector((0.14, -0.12, -1.42))), (0.46, 0.42, 0.4), 24)], rockL, voxel=0.022, target=1800, amp=0.02, freq=3, seed=7)
    clawsL = [sweep(spline([sh + Vector((0.14 + dx, -0.42, -1.5)), sh + Vector((0.14 + dx, -0.56, -1.58)), sh + Vector((0.14 + dx, -0.6, -1.72))], 6), [0.06 * (1 - i / 6) + 0.005 for i in range(6)], horn, 10)
              for dx in (-0.22, -0.07, 0.08, 0.23)]
    tree = kit.bvh(arm)
    av = []
    for z in (-0.3, -0.8):
        ring = []
        for i in range(9):
            a = -1.4 + i * 0.35
            hit = tree.find_nearest(sh + Vector((0.1 + math.sin(a) * 0.6, -math.cos(a) * 0.6, z + math.sin(i) * 0.08)))
            if hit[0] is not None:
                ring.append(hit[0] + hit[1] * 0.01)
        av.append(sweep(spline(ring, 14), 0.028, magma, 8))
    publish([arm, fist] + clawsL + av, 'c_tyrant_arm', origin=tuple(sh))


def unraveller():
    gown = mat('VeyraGown', '#3a2466', 0.45)
    gownL = mat('VeyraGownLight', '#6a4aa8', 0.45)
    gold = mat('VeyraGold', '#ffd36b', 0.25, 0.6)
    skin = mat('VeyraSkin', '#e8d8f4', 0.4)
    hair = mat('VeyraHair', '#dcd6f0', 0.35)
    brow = mat('VeyraBrow', '#5a3a8a', 0.45)
    lips = mat('VeyraLips', '#b04a9a', 0.4)
    eyeM = glow('VeyraEye', '#ffe8ff', '#ff5ae8', 6.0)
    sock = mat('VeyraSocket', '#2a1040', 0.6)
    thread = glow('VeyraThreadGlow', '#ffc0f0', '#ff6ad8', 2.5)
    # Floating: the gown frays into Veil threads that trail to the lowest point.
    gw = garment([(0.7, 0.9), (0.62, 1.3), (0.46, 1.8), (0.34, 2.15), (0.28, 2.3)], gown, segs=56, sub=3,
                 hem=kit.tatters(10, 0.4, 12), hem_h=0.6, folds=(0.08, 8), thick=0.04, seed=13)
    sash = torus(0.33, 0.045, (0, 0, 2.02), m=gold, seg=40, minor=10)
    torso = blob([sphere(1, (0, 0, 2.35), (0.3, 0.22, 0.26), 28)], gownL, target=2000)
    random.seed(4)
    threads = []
    for k in range(16):
        a = k / 16 * math.tau + random.uniform(-0.1, 0.1)
        r0 = 0.6
        pts = [Vector((math.cos(a) * r0, math.sin(a) * r0, 0.85))]
        for i in range(1, 6):
            pts.append(pts[-1] + Vector((math.cos(a + i * 0.4) * 0.08, math.sin(a + i * 0.4) * 0.08, -0.15)))
        threads.append(sweep(spline(pts, 12), [0.035 * (1 - i / 11) + 0.006 for i in range(12)], gown if k % 3 else thread, 8))
    # Arms spread wide, palms up, threads spilling from the fingers.
    arms = []
    for sx in (-1, 1):
        sh = Vector((sx * 0.3, 0, 2.48))
        arms.append(blob(chain([tuple(sh), tuple(sh + Vector((sx * 0.3, -0.08, -0.05))), tuple(sh + Vector((sx * 0.62, -0.14, 0.05)))], 0.08, 0.065, segs=14), gownL, target=1200))
        arms += big_hand(sh + Vector((sx * 0.74, -0.16, 0.08)), skin, 0.75)
        for j in range(3):
            base = sh + Vector((sx * 0.8, -0.2, 0.04))
            arms.append(sweep(spline([base, base + Vector((sx * 0.1, -0.05 * j, -0.3)), base + Vector((sx * 0.05, 0.05 * j, -0.7))], 10), [0.015] * 10, thread, 6))
    hc = Vector((0, -0.03, 2.8))
    H = lambda x, y, z: tuple(hc + Vector((x, y, z)))
    hd = blob([sphere(1, H(0, 0, 0.02), (0.25, 0.24, 0.28), 32), sphere(1, H(0, -0.09, -0.15), (0.15, 0.13, 0.11), 20),
               sphere(1, H(0, -0.25, -0.02), (0.03, 0.045, 0.055), 12)], skin, target=3500)
    br = []
    for sx in (-1, 1):
        br += chain([H(sx * 0.19, -0.19, 0.12), H(sx * 0.1, -0.235, 0.1), H(sx * 0.03, -0.24, 0.05)], 0.028, 0.018, segs=12)
    brw = blob(br, brow, voxel=0.008, target=600)
    lp = blob(chain([H(-0.055, -0.23, -0.15), H(0, -0.245, -0.14), H(0.055, -0.23, -0.15)], 0.022, 0.022, segs=10), lips, voxel=0.006, target=400)
    parts = [gw, sash, torso, hd, brw, lp] + threads + arms
    for sx in (-1, 1):
        parts += eye(hd, sx * 0.095, 2.82, 0.045, sock, eyeM, squash=(1.3, 0.5, 0.85), tilt=sx * 0.25, pop=0.3)
    # Wild hair streaming upward like smoke, and a broken halo of gold shards.
    hr = [sphere(1, H(0, 0.06, 0.1), (0.3, 0.28, 0.26), 28)]
    for k, a in enumerate((-1.2, -0.75, -0.3, 0.3, 0.75, 1.2, 0.0)):
        base = H(math.sin(a) * 0.22, 0.08, 0.2)
        hr += chain([base, (base[0] + math.sin(a) * 0.25, base[1] + 0.12, base[2] + 0.3), (base[0] + math.sin(a) * 0.4, base[1] + 0.24, base[2] + 0.55 - abs(a) * 0.1)], 0.1, 0.02, segs=12)
    hairO = blob(hr, hair, target=4000)
    halo = [kit.crystal(H(math.sin(a) * 0.55, 0.25, 0.25 + math.cos(a) * 0.55), (math.sin(a), 0, math.cos(a)), 0.18, 0.04, gold, sides=4, tip=0.5) for a in [i / 9 * math.tau for i in range(9) if i != 4]]
    publish(parts + [hairO] + halo, 'c_unraveller_body', ground=True)


# ================================================================ the apprentice (lavender wizard)
# A chibi young wizard: wide ragged-brimmed hat with a curling tip and a swirl-patterned band,
# a hooded lavender coat open over a sage tunic, patterned cream trims (UV-mapped strips the game
# paints: WizTrim / WizBand), belt with a ring buckle and pouch, a medallion, and a gnarled staff
# whose crescent top cradles the orb (the orb itself is the game's, so it can glow and pulse).
# Head, eyes and hat are modelled at a reference size and shrunk by HEAD_K about their own origins
# (the game places them); the body is stretched by K (a taller coat and legs, as in the concept).
WIZ = {'head': (0, 0, 1.36), 'eye': (0.15, -0.34, 1.33), 'shoulder': (0.27, 0.0, 1.19), 'arm_len': 0.52,
       'hat': (0, 0.02, 1.64), 'tip': (0, 0.07, 2.2), 'grip': (0, 0, 0)}
K, HEAD_K = 1.3, 0.9


def shrink(o, k):
    """Scale a published part about its origin (location untouched)."""
    o.scale = (k, k, k)
    kit.select_only(o)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return o


def strip(pts, nrms, width, m, thick=0.012, uv_rep=1.0, lift=0.004):
    """A flat band laid over a surface: pts along its centre line, nrms the surface normals there.
    UVs run u along the length (in band widths × uv_rep) and v across, for a repeating pattern."""
    import bmesh
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    L, rows = 0.0, []
    for i, p in enumerate(pts):
        p, n = Vector(p), Vector(nrms[i]).normalized()
        t = (Vector(pts[min(i + 1, len(pts) - 1)]) - Vector(pts[max(i - 1, 0)])).normalized()
        b = t.cross(n).normalized()
        if i:
            L += (p - Vector(pts[i - 1])).length
        c = p + n * lift
        rows.append((bm.verts.new(c - b * width / 2), bm.verts.new(c + b * width / 2), L / width * uv_rep))
    for i in range(len(rows) - 1):
        a0, a1, u0 = rows[i]
        b0, b1, u1 = rows[i + 1]
        f = bm.faces.new((a0, a1, b1, b0))
        for loop, (u, v) in zip(f.loops, ((u0, 0), (u0, 1), (u1, 1), (u1, 0))):
            loop[uv].uv = (u, v)
    o = kit.mesh_obj(bm, 'strip', m)
    if thick:
        sol = o.modifiers.new('sol', 'SOLIDIFY'); sol.thickness = thick; sol.offset = 1; kit.apply_mod(o, sol)
    smooth(o, 60)
    return o


def textured(m):
    """Give m a small placeholder image so the glTF exporter keeps the UVs of its strips (it drops
    UV maps no material samples). The game replaces the image with the real pattern."""
    img = bpy.data.images.new(m.name + 'Tex', 4, 4)
    img.pixels = [1.0] * 64
    img.pack()
    nt = m.node_tree
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img
    nt.links.new(tex.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
    return m


def on_surface(o, pts, push=0.0):
    """Project points onto o; returns (points, normals)."""
    tree = kit.bvh(o)
    P, N = [], []
    for p in pts:
        loc, n, _, _ = tree.find_nearest(Vector(p))
        P.append(loc + n * push); N.append(n)
    return P, N


def wizard():
    lav = mat('WizCoat', '#8c86ae', 0.62)
    lavD = mat('WizCoatDark', '#716b96', 0.62)
    trim = textured(mat('WizTrim', '#ece6f2', 0.55))
    sage = mat('WizTunic', '#9aa58a', 0.7)
    sageD = mat('WizPants', '#8a927a', 0.7)
    leather = mat('WizLeather', '#7a4a2a', 0.5)
    boot = mat('WizBoot', '#8a5634', 0.45)
    sole = mat('WizSole', '#4a2c18', 0.6)
    silver = mat('WizSilver', '#c9c9d2', 0.25, 0.8)
    bronze = mat('WizBronze', '#b08a5a', 0.3, 0.7)
    skin = mat('WizSkin', '#ffdcc6', 0.5)
    blush = mat('WizBlush', '#ffb4ae', 0.55)
    hairM = mat('WizHair', '#2b2836', 0.32)
    brow = mat('WizBrow', '#221c20', 0.55)
    mouth = mat('WizMouth', '#3a2422', 0.5)
    hatM = mat('WizHat', '#918bb8', 0.62)
    band = textured(mat('WizBand', '#caa074', 0.5))
    wood = mat('WizWood', '#8a5a36', 0.6)
    woodD = mat('WizWoodDark', '#6a4226', 0.6)
    wrap = mat('WizWrap', '#5a3a24', 0.55)

    # ---------------- body: coat, tunic, trousers, belt, pouch, medallion, hood
    OPEN = 0.42  # half-width (radians) of the coat's front opening
    front = -math.pi / 2
    tails = lambda a: -0.1 * max(0.0, math.sin(a)) * (0.6 + 0.4 * math.sin(a * 7 + 1.0))  # ragged points at the back
    prof = [(0.5, 0.1 * K), (0.44, 0.34 * K), (0.36, 0.6 * K), (0.3, 0.8 * K), (0.27, 0.93 * K)]
    coat = garment(prof, lav, segs=64, sub=3, hem=tails, hem_h=0.25, folds=(0.04, 7), thick=0.03, seed=21,
                   arc=(front + OPEN, front + math.tau - OPEN))
    tunic = garment([(0.34, 0.24 * K), (0.32, 0.5 * K), (0.28, 0.75 * K), (0.24, 0.95 * K)], sage, segs=48, sub=2, thick=0.02, seed=22)
    legs = []
    for sx in (-1, 1):
        legs += chain([(sx * 0.13, -0.02, 0.48), (sx * 0.14, -0.04, 0.3), (sx * 0.14, -0.05, 0.14)], 0.12, 0.1, segs=14)
    pants = blob(legs, sageD, target=1500)
    neck = blob(chain([(0, 0, 1.15), (0, 0, 1.36)], 0.1, 0.1, segs=10), skin, target=400)
    # A big hood lying down behind the shoulders, rolled into a cowl round the neck.
    hood = blob([sphere(1, (0, 0.24, 1.28), (0.34, 0.2, 0.2), 28), sphere(1, (0, 0.34, 1.16), (0.24, 0.12, 0.18), 20),
                 sphere(1, (0, 0.12, 1.24), (0.32, 0.24, 0.08), 24)], lav, target=3000)
    # The hood's edge wraps the neck and dips into a V at the front.
    vneck = [Vector((math.sin(a) * 0.23, -math.cos(a) * 0.19 + 0.03, 1.27 - 0.13 * max(0.0, math.cos(a)) ** 3)) for a in [i / 48 * math.tau for i in range(49)]]
    collar = sweep(spline(vneck, 60), 0.05, lav, 12, squash=0.7)
    smooth(collar, 70)
    hood = join([hood, collar])
    parts = [coat, tunic, pants, neck, hood]
    # Patterned trim: down both front edges, round the hem and the collar.
    def coat_pt(a, z, r_off=0.0):
        for (ra, za), (rb, zb) in zip(prof, prof[1:]):
            if za <= z <= zb:
                r = ra + (rb - ra) * (z - za) / (zb - za)
                break
        else:
            r = prof[-1][0]
        return (math.cos(a) * (r + r_off), math.sin(a) * (r + r_off), z)
    for sgn in (-1, 1):
        a = front + sgn * (OPEN + 0.08)
        P, N = on_surface(coat, [coat_pt(a, (0.12 + i * 0.8 / 20) * K, 0.05) for i in range(21)])
        parts.append(strip(P, N, 0.07, trim, uv_rep=1.0))
    P, N = on_surface(coat, [coat_pt(front + OPEN + 0.02 + i * (math.tau - 2 * OPEN - 0.04) / 60, 0.2, 0.05) for i in range(61)])
    parts.append(strip(P, N, 0.075, trim, uv_rep=1.0))
    # Belt over the coat with a silver ring buckle, a pouch on the right hip.
    BZ = 0.56 * K
    parts.append(torus(0.36, 0.035, (0, 0, BZ), m=leather, seg=48, minor=8))
    parts.append(xform(torus(0.05, 0.014, (0, 0, 0), m=silver, seg=24, minor=8), (0, -0.39, BZ), (math.radians(90), 0, 0)))
    pouch = blob([sphere(1, (0.3, -0.25, BZ - 0.13), (0.08, 0.05, 0.09), 16)], leather, voxel=0.006, target=600)
    flap = blob([sphere(1, (0.3, -0.28, BZ - 0.07), (0.085, 0.03, 0.04), 12)], woodD, voxel=0.006, target=300)
    parts += [pouch, flap, xform(torus(0.02, 0.006, (0, 0, 0), m=bronze, seg=12, minor=5), (0.3, -0.31, BZ - 0.1), (math.radians(90), 0, 0))]
    # Medallion on a cord.
    cord = [Vector((math.sin(a) * 0.15, -0.1 - math.cos(a) * 0.14, 1.28 - (1 - abs(math.cos(a))) * 0.02 - 0.2 * max(0, math.cos(a)) ** 2)) for a in [(-1 + 2 * i / 24) * 2.2 for i in range(25)]]
    parts.append(sweep(cord, 0.007, leather, 6))
    parts.append(xform(cyl(0.055, 0.015, (0, 0, 0), verts=24, m=bronze), (0, -0.3, 1.04), (math.radians(80), 0, 0)))
    parts.append(xform(torus(0.047, 0.009, (0, 0, 0), m=bronze, seg=24, minor=6), (0, -0.31, 1.04), (math.radians(80), 0, 0)))
    publish(parts, 'c_wiz_body')

    # ---------------- head: a simple chibi face — round, big anime eyes, rosy cheeks, a small
    # smile — under a spiky black fringe.
    c = Vector(WIZ['head'])
    L = lambda x, y, z: tuple(c + Vector((x, y, z)))
    # The face skin carries a soft blush, painted per vertex (no hard-edged cheek patches).
    face = mat('WizFace', '#ffdcc6', 0.5)
    vcn = face.node_tree.nodes.new('ShaderNodeVertexColor'); vcn.layer_name = 'Col'
    face.node_tree.links.new(vcn.outputs['Color'], face.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
    head = blob([sphere(1, L(0, 0, 0.03), (0.4, 0.38, 0.38), 40), sphere(1, L(0, -0.06, -0.13), (0.33, 0.3, 0.24), 32),
                 sphere(1, L(0, -0.14, -0.27), (0.12, 0.1, 0.08), 20)]
                + [sphere(1, L(sx * 0.38, 0.02, -0.03), (0.06, 0.08, 0.1), 16) for sx in (-1, 1)], face, target=6000)
    import numpy as np
    base, pink = np.array(kit.srgb('#ffdcc6')[:3]), np.array(kit.srgb('#f59488')[:3])
    ca = head.data.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    for v in head.data.vertices:
        q = v.co - c
        col = base.copy()
        for sx in (-1, 1):
            d2 = (q.x - sx * 0.21) ** 2 + ((q.z + 0.13) * 1.2) ** 2
            if q.y < -0.15:
                col = col + (pink - col) * 0.85 * math.exp(-d2 / 0.007)
        ca.data[v.index].color = (*col, 1.0)
    # A tiny, thin smile.
    mo = sweep(spline([surf(head, c.x + x, c.z - 0.19 + x * x * 4.5)[0] for x in (-0.042, -0.02, 0.0, 0.02, 0.042)], 12), 0.0065, mouth, 6)
    # Thick, softly arched brows.
    brows = []
    for sx in (-1, 1):
        bp = [surf(head, c.x + sx * x, c.z + z) for x, z in ((0.085, 0.045), (0.14, 0.068), (0.2, 0.068), (0.25, 0.045))]
        brows.append(sweep(spline([p + n * 0.01 for p, n in bp], 14), [0.022, 0.03, 0.034, 0.036, 0.036, 0.035, 0.034, 0.032, 0.03, 0.027, 0.024, 0.02, 0.016, 0.012], brow, 10, squash=0.5))
    # Hair: a cap, a spiky fringe of separate tapered strands swept to one side, locks over the
    # ears and down the nape.
    random.seed(33)
    cap = blob([sphere(1, L(0, 0.0, 0.14), (0.44, 0.43, 0.33), 32)], hairM, target=4000)
    kit.cut_plane(cap, L(0, -0.24, 0.22), (0, -0.55, -0.62))           # hairline: forehead and brows stay clear
    fringe = []
    for k, (x, drop, sweep_x) in enumerate(((-0.28, 0.1, -0.06), (-0.19, 0.03, -0.07), (-0.1, 0.07, -0.06), (-0.01, 0.0, -0.08),
                                            (0.08, 0.06, -0.07), (0.17, 0.02, -0.05), (0.26, 0.11, -0.04))):
        root = L(x * 0.9, -0.3 + abs(x) * 0.1, 0.33)
        mid = L(x + sweep_x * 0.4, -0.39 + abs(x) * 0.22, 0.22)
        tip = L(x + sweep_x, -0.41 + abs(x) * 0.3, 0.11 + drop * 0.8)
        fringe.append(sweep(spline([root, mid, tip], 12), [0.055 * (1 - i / 11) ** 0.9 + 0.004 for i in range(12)], hairM, 10, squash=0.55))
    hr = []
    for sx in (-1, 1):
        for k, dz in enumerate((0.1, -0.02)):
            hr += chain([L(sx * 0.33, -0.12 + k * 0.1, 0.2), L(sx * 0.41, -0.12 + k * 0.1, dz), L(sx * 0.39, -0.1 + k * 0.12, dz - 0.14)], 0.07, 0.012, segs=12)
    for k in range(5):
        x = -0.24 + k * 0.12
        hr += chain([L(x, 0.3, 0.1), L(x * 1.1, 0.38, -0.08), L(x * 1.1, 0.33, -0.22)], 0.08, 0.012, segs=12)
    locks = blob(hr, hairM, target=3000)
    for f in fringe:
        smooth(f, 70)
    for o in [mo, cap, locks] + fringe + brows:          # only the face skin is tinted; the rest stays true
        wa = o.data.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        for d in wa.data:
            d.color = (1, 1, 1, 1)
    shrink(publish([head, mo, cap, locks] + fringe + brows, 'c_wiz_head', origin=tuple(c)), HEAD_K)

    # ---------------- eye: a happy crescent — a thick arc bowed upward, tapering to rounded tips
    # (origin at its centre, so the blink squashes it)
    dot = mat('WizEyeDot', '#161214', 0.28)
    arc = [Vector((0.066 * math.sin(t), -0.012 - 0.01 * math.cos(t), 0.034 * math.cos(t) - 0.012)) for t in [(-1 + 2 * i / 20) * 1.35 for i in range(21)]]
    e = sweep(spline(arc, 32), [0.006 + 0.015 * math.sin(math.pi * k / 31) ** 0.7 for k in range(32)], dot, 12, squash=0.6)
    smooth(e, 80)
    shrink(publish([e], 'c_wiz_eye'), HEAD_K)

    # ---------------- arm: a bell sleeve with a patterned cuff and a small hand
    sh = Vector(WIZ['shoulder'])
    sl = lathe([(0.001, 0.02), (0.1, 0.0), (0.115, -0.14), (0.15, -0.3), (0.21, -0.44), (0.19, -0.455), (0.13, -0.37), (0.08, -0.3)], lav, 40, loc=tuple(sh), shade=60)
    ring = [tuple(sh + Vector((math.cos(a) * 0.206, math.sin(a) * 0.206, -0.43))) for a in [i / 40 * math.tau for i in range(41)]]
    cuff = strip(ring, [Vector((math.cos(a), math.sin(a), 0.25)) for a in [i / 40 * math.tau for i in range(41)]], 0.065, trim, uv_rep=1.0)
    h = sh + Vector((0, 0, -WIZ['arm_len']))
    hand = blob([sphere(1, tuple(h), (0.07, 0.06, 0.075), 20), sphere(1, tuple(h + Vector((-0.05, -0.04, 0.02))), (0.03, 0.03, 0.04), 14)]
                + [sphere(1, tuple(h + Vector((dx, -0.02, -0.065))), (0.022, 0.03, 0.03), 10) for dx in (-0.03, 0.0, 0.03)], skin, voxel=0.006, target=1500)
    wrist = blob(chain([tuple(sh + Vector((0, 0, -0.34))), tuple(h + Vector((0, 0, 0.05)))], 0.05, 0.045, segs=10), skin, voxel=0.008, target=500)
    publish([sl, cuff, hand, wrist], 'c_wiz_arm', origin=tuple(sh))

    # ---------------- boot (right; the game mirrors it)
    b = blob([sphere(1, (0.14, -0.08, 0.1), (0.1, 0.16, 0.1), 24), sphere(1, (0.14, -0.2, 0.07), (0.08, 0.08, 0.06), 16),
              *chain([(0.14, -0.04, 0.12), (0.14, -0.04, 0.3)], 0.09, 0.095, segs=10)], boot, target=1400)
    turn = torus(0.105, 0.024, (0.14, -0.04, 0.3), m=boot, seg=24, minor=8)
    so = blob([sphere(1, (0.14, -0.1, 0.022), (0.11, 0.18, 0.035), 20)], sole, target=500)
    kit.cut_plane(so, (0, 0, 0.0), (0, 0, -1))
    publish([b, turn, so], 'c_wiz_boot')

    # ---------------- hat: a wide, floppy, notched brim; a crumpled crown; a patterned band
    import bmesh
    hc = Vector(WIZ['hat'])
    # Torn triangular notches round a wide brim that droops at the sides and back.
    notches = [(0.35, 0.09), (1.2, 0.07), (1.95, 0.11), (2.75, 0.08), (3.5, 0.1), (4.3, 0.07), (5.0, 0.1), (5.75, 0.08)]
    def outer(a):
        r = 0.8 + 0.025 * math.sin(a * 2 + 0.5)
        for n, depth in notches:
            d = abs(math.atan2(math.sin(a - n), math.cos(a - n)))
            if d < 0.06:
                r -= depth * (1 - d / 0.06)
        return r
    bm = bmesh.new()
    NA, NR = 144, 10
    grid = []
    for j in range(NR + 1):
        row = []
        for i in range(NA):
            a = i / NA * math.tau
            t = j / NR
            r = 0.36 + (outer(a) - 0.36) * t
            side = abs(math.cos(a))                                      # the sides droop most
            z = -(0.1 + 0.14 * side + 0.06 * max(0.0, math.sin(a))) * t ** 1.8 + 0.03 * t * math.sin(a * 3 + 1.1)
            row.append(bm.verts.new(hc + Vector((math.cos(a) * r, math.sin(a) * r, z))))
        grid.append(row)
    for j in range(NR):
        for i in range(NA):
            k = (i + 1) % NA
            bm.faces.new((grid[j][i], grid[j][k], grid[j + 1][k], grid[j + 1][i]))
    brim = kit.mesh_obj(bm, 'brim', hatM)
    sol = brim.modifiers.new('sol', 'SOLIDIFY'); sol.thickness = 0.03; sol.offset = 0; kit.apply_mod(brim, sol)
    smooth(brim, 70)
    # A shorter, crumpled crown.
    crown = garment([(0.37, hc.z - 0.02), (0.34, hc.z + 0.16), (0.27, hc.z + 0.32), (0.17, WIZ['tip'][2] - 0.02), (0.14, WIZ['tip'][2] + 0.02)], hatM,
                    segs=48, sub=3, folds=(0.09, 5), fold_fall=0.4, wob=0.07, thick=0.03, seed=31)
    P = [tuple(hc + Vector((math.cos(a) * 0.365, math.sin(a) * 0.365, 0.08))) for a in [i / 64 * math.tau for i in range(65)]]
    P, N = on_surface(crown, P, 0.004)
    bandO = strip(P, N, 0.14, band, thick=0.02, uv_rep=0.5)
    shrink(publish([brim, crown, bandO], 'c_wiz_hat', origin=tuple(hc)), HEAD_K)
    # The tip: rises, then hooks over to one side and droops — its own piece so it can sway.
    tp = Vector(WIZ['tip'])
    path = spline([tp, tp + Vector((0.0, 0.02, 0.16)), tp + Vector((-0.08, 0.06, 0.3)), tp + Vector((-0.24, 0.08, 0.34)), tp + Vector((-0.36, 0.06, 0.24)), tp + Vector((-0.38, 0.02, 0.12))], 20)
    tipO = sweep(path, [0.14 * (1 - i / 19) ** 1.0 + 0.012 for i in range(20)], hatM, 20)
    kit.rough(tipO, 0.012, 6, 2, 9)
    smooth(tipO, 70)
    shrink(publish([tipO], 'c_wiz_hat_tip', origin=tuple(tp)), HEAD_K)

    # ---------------- staff: gnarled shaft with a wrapped grip; the top curls round the orb
    g = Vector(WIZ['grip'])
    random.seed(41)
    shaft_pts = [g + Vector((random.uniform(-0.02, 0.02), random.uniform(-0.02, 0.02), -0.7 + i * 0.11)) for i in range(16)]
    shaft_pts[0] = g + Vector((0, 0, -0.7))
    rad = [0.028 + 0.012 * (i / 15) + (0.01 if i in (4, 9, 12) else 0.0) for i in range(16)]
    shaft = sweep(spline(shaft_pts, 40), [rad[min(15, int(k / 39 * 15))] for k in range(40)], wood, 10)
    kit.rough(shaft, 0.006, 12, 2, 3)
    smooth(shaft, 60)
    top = shaft_pts[-1]
    oc = top + Vector((0, 0, 0.24))
    WIZ['orb'] = tuple(oc)
    arc = [oc + Vector((math.sin(a) * 0.22, 0, -math.cos(a) * 0.22)) for a in [0.0 + i * (5.0 / 30) for i in range(31)]]
    crescent = sweep(spline(arc, 44), [0.06 * (1 - (k / 43) ** 1.6) + 0.012 for k in range(44)], wood, 12)
    kit.rough(crescent, 0.005, 14, 2, 5)
    smooth(crescent, 60)
    grip = []
    for k in range(40):
        a = k * 0.9
        z = -0.18 + k * 0.009
        grip.append(g + Vector((math.cos(a) * 0.036, math.sin(a) * 0.036, z)))
    wrapO = sweep(grip, 0.012, wrap, 6, cap=True)
    knots = [ico(0.035, tuple(shaft_pts[i] + Vector((0.02, 0, 0))), 2, (1, 1, 1.4), woodD) for i in (4, 9, 12)]
    publish([shaft, crescent, wrapO] + knots, 'c_wiz_staff', origin=tuple(g))
    print('WIZ ORB', WIZ['orb'])


BUILD = [shade, specter, imp, wraith, golem, bones, apprentice, aldric, lich, queen, tyrant, unraveller, wizard]
ONLY = os.environ.get('CHAR_ONLY')
for fn in BUILD:
    if ONLY and fn.__name__ not in ONLY.split(','):
        continue
    fn()
kit.export(os.environ.get('CHAR_OUT') or OUT)
