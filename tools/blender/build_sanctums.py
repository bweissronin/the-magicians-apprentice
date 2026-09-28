"""Builds the hero pieces for the three school sanctums and exports them as one glTF binary.

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/build_sanctums.py

Organic shapes (skulls, vertebrae, the phoenix) are blocked out from overlapping primitives,
fused with a voxel remesh so they read as one sculpted surface, carved with booleans (eye
sockets, nasal cavity) and decimated to a game budget. Hard-surface pieces (bell, bellows,
crucible, anvil) are lathed and bevelled. Front faces -Y, which is +Z in three.js.

Objects whose origin matters for animation (the jaw hinge, the phoenix shoulders, the
bellows hinge) keep their origin at that pivot; everything else sits on the floor at 0,0,0.
"""
import bpy, bmesh, math, os, random
from mathutils import Vector

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'assets', 'models', 'sanctums.glb')
random.seed(11)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def srgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return (*lin, 1.0)


MATS = {}


def mat(name, color, rough=0.6, metal=0.0, emit=None, strength=0.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = srgb(color)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = srgb(emit)
        b.inputs['Emission Strength'].default_value = strength
    MATS[name] = m
    return m


BONE = lambda: mat('bone', '#e9e0c8', 0.7)
BONE_D = lambda: mat('boneDark', '#c9bc9a', 0.75)
SOUL = lambda: mat('soulGlow', '#b8ffcc', 0.4, 0, '#5dff8a', 5.0)
BRONZE = lambda: mat('bronze', '#b98a4c', 0.35, 0.75)
IRON = lambda: mat('forgeIron', '#3b3542', 0.45, 0.4)
LEATHER = lambda: mat('leather', '#7a4a2c', 0.8)
WOOD = lambda: mat('sanctumWood', '#8d5a2b', 0.6)
MOLTEN = lambda: mat('molten', '#ffd27a', 0.3, 0, '#ff7a1a', 6.0)
EMBER = lambda: mat('phoenixCore', '#ffb13b', 0.4, 0, '#ff8a2a', 2.2)
FLAME = lambda: mat('phoenixFlame', '#ff6a1a', 0.4, 0, '#ff4a0a', 3.2)
GOLDF = lambda: mat('phoenixGold', '#ffe07a', 0.35, 0.2, '#ffc23a', 2.6)
ICE = lambda: mat('iceHeart', '#c9f0ff', 0.08, 0.0, '#4fb8ff', 1.4)


# ---------------------------------------------------------------- helpers
def active():
    return bpy.context.active_object


def select_only(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


def apply_mod(o, mod):
    select_only(o)
    bpy.ops.object.modifier_apply(modifier=mod.name)


def smooth(o, angle=40):
    select_only(o)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))


def assign(o, m):
    o.data.materials.clear()
    o.data.materials.append(m)
    return o


def sphere(r, loc, scale=(1, 1, 1), segs=24, m=None, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=segs, ring_count=segs // 2, rotation=rot)
    o = active()
    o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if m:
        assign(o, m)
    return o


def cyl(r, depth, loc, rot=(0, 0, 0), verts=24, r2=None, m=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, vertices=verts, location=loc, rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=depth, vertices=verts, location=loc, rotation=rot)
    o = active()
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if m:
        assign(o, m)
    return o


def box(size, loc, rot=(0, 0, 0), m=None, bevel=0.03):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = active()
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if bevel:
        mod = o.modifiers.new('bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = 3
        apply_mod(o, mod)
    if m:
        assign(o, m)
    return o


def torus(R, r, loc, rot=(0, 0, 0), m=None, seg=32):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, location=loc, rotation=rot, major_segments=seg, minor_segments=10)
    o = active()
    if m:
        assign(o, m)
    return o


def lathe(profile, m, segs=32, loc=(0, 0, 0)):
    me = bpy.data.meshes.new('lathe')
    bm = bmesh.new()
    rings = []
    for (r, z) in profile:
        rings.append([bm.verts.new((math.cos(i / segs * math.tau) * r, math.sin(i / segs * math.tau) * r, z)) for i in range(segs)])
    for k in range(len(rings) - 1):
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new((rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new('lathe', me)
    scene.collection.objects.link(o)
    o.location = loc
    select_only(o)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    assign(o, m)
    smooth(o, 50)
    return o


def join(objs, name=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = active()
    if name:
        o.name = name
        o.data.name = name
    return o


def fuse(objs, voxel, m, target_tris=None, flat=False):
    """Union overlapping primitives into one organic surface: voxel remesh, then decimate."""
    o = join(objs)
    mod = o.modifiers.new('remesh', 'REMESH')
    mod.mode = 'VOXEL'
    mod.voxel_size = voxel
    mod.adaptivity = 0.0
    apply_mod(o, mod)
    lap = o.modifiers.new('smooth', 'SMOOTH')
    lap.factor = 0.6
    lap.iterations = 4
    apply_mod(o, lap)
    if target_tris:
        tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
        if tris > target_tris:
            dec = o.modifiers.new('dec', 'DECIMATE')
            dec.ratio = target_tris / tris
            apply_mod(o, dec)
    assign(o, m)
    if flat:
        select_only(o)
        bpy.ops.object.shade_flat()
    else:
        smooth(o, 60)
    return o


def carve(o, cutters):
    """Boolean-subtract each cutter from o, then delete the cutters."""
    for c in cutters:
        mod = o.modifiers.new('cut', 'BOOLEAN')
        mod.operation = 'DIFFERENCE'
        mod.object = c
        apply_mod(o, mod)
        bpy.data.objects.remove(c, do_unlink=True)
    return o


LAYOUT = {'x': 0.0}


def publish(objs, name, origin=(0, 0, 0)):
    o = join(objs, name) if len(objs) > 1 else objs[0]
    o.name = name
    o.data.name = name
    bpy.context.scene.cursor.location = origin
    select_only(o)
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    o.location = (LAYOUT['x'], 0, 0)
    LAYOUT['x'] += 6.0
    tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
    print('PROP', name, tris, 'tris')
    return o


# ================================================================ Necromancy
def skull_parts(detail=1.0):
    return [
        sphere(1.0, (0, 0.1, 0.35), (0.92, 1.08, 0.95)),              # cranium
        sphere(0.5, (0, -0.74, 0.28), (1.55, 0.55, 0.38)),            # brow ridge
        sphere(0.62, (0, -0.6, -0.3), (1.1, 0.95, 0.95)),              # face
        sphere(0.28, (0.6, -0.52, -0.14), (1.0, 1.25, 0.8)),           # cheekbones
        sphere(0.28, (-0.6, -0.52, -0.14), (1.0, 1.25, 0.8)),
        sphere(0.4, (0, -0.72, -0.72), (1.25, 0.95, 0.42)),            # upper jaw ridge
        sphere(0.3, (0.78, 0.0, -0.1), (0.5, 1.2, 0.7)),               # temples
        sphere(0.3, (-0.78, 0.0, -0.1), (0.5, 1.2, 0.7)),
    ]


def skull_cutters():
    return [
        sphere(0.31, (0.35, -1.02, -0.02), (1.1, 1.0, 1.0)),
        sphere(0.31, (-0.35, -1.02, -0.02), (1.1, 1.0, 1.0)),
        sphere(0.11, (0.075, -1.12, -0.4), (0.8, 1.4, 1.7)),
        sphere(0.11, (-0.075, -1.12, -0.4), (0.8, 1.4, 1.7)),
    ]


def titan_skull():
    s = fuse(skull_parts(), 0.03, BONE(), target_tris=9000)
    carve(s, skull_cutters())
    smooth(s, 60)
    parts = [s]
    # Soul-fire burning deep in the sockets and nose.
    for x in (0.34, -0.34):
        parts.append(sphere(0.2, (x, -0.8, -0.02), (1.1, 0.7, 1.0), 16, SOUL()))
    parts.append(sphere(0.08, (0, -0.95, -0.4), (1.4, 0.6, 1.5), 12, SOUL()))
    # Upper teeth along an arc.
    for i in range(12):
        a = math.radians(-66 + i * 12)
        x, y = math.sin(a) * 0.48, -0.5 - math.cos(a) * 0.42
        t = box((0.11, 0.1, 0.2 - abs(i - 5.5) * 0.008), (x, y, -0.86), (0, 0, -a), BONE(), 0.03)
        parts.append(t)
    # Cracks: a few dark grooves on the crown for age.
    publish(parts, 'titan_skull')


def titan_jaw():
    pts = []
    for i in range(15):
        t = i / 14
        a = math.pi * t
        # U-shaped mandible: rami rise at the back, the chin juts forward.
        x = math.cos(a) * 0.62
        y = -0.12 - math.sin(a) * 0.85
        z = -1.02 + (0.55 if (t < 0.12 or t > 0.88) else 0.0) * (1 - min(t, 1 - t) / 0.12)
        pts.append((x, y, z))
    parts = [sphere(0.16, p, (1.0, 1.0, 1.25)) for p in pts]
    parts += [sphere(0.18, (0.62, -0.05, -0.55), (0.7, 1.0, 1.6)), sphere(0.18, (-0.62, -0.05, -0.55), (0.7, 1.0, 1.6))]  # rami
    parts += [sphere(0.22, (0, -0.96, -1.08), (1.3, 0.8, 0.9))]  # chin
    j = fuse(parts, 0.03, BONE(), target_tris=3500)
    out = [j]
    for i in range(10):
        a = math.radians(-58 + i * 12.9)
        x, y = math.sin(a) * 0.46, -0.45 - math.cos(a) * 0.4
        out.append(box((0.1, 0.09, 0.16), (x, y, -0.9), (0, 0, -a), BONE(), 0.03))
    publish(out, 'titan_jaw', origin=(0, -0.05, -0.55))  # hinge


def skull_small():
    s = fuse(skull_parts(), 0.09, BONE(), target_tris=520)
    carve(s, [sphere(0.33, (0.35, -1.02, -0.02), (1.1, 1.0, 1.0), 10), sphere(0.33, (-0.35, -1.02, -0.02), (1.1, 1.0, 1.0), 10),
              sphere(0.13, (0, -1.1, -0.4), (1.2, 1.4, 1.6), 8)])
    smooth(s, 60)
    publish([s], 'skull_small', origin=(0, 0, -1.0))


def vertebra():
    parts = [
        cyl(0.4, 0.5, (0, 0, 0), (math.pi / 2, 0, 0), 20),                        # centrum (along Y = spine axis)
        sphere(0.22, (0, 0, 0.55), (0.9, 0.6, 1.2)),                             # arch
        cyl(0.16, 1.1, (0, 0.15, 1.05), (0.35, 0, 0), 12, r2=0.06),              # spinous process
        cyl(0.13, 0.8, (0.55, 0, 0.45), (0, math.pi / 2 - 0.3, 0), 12, r2=0.07),  # transverse processes
        cyl(0.13, 0.8, (-0.55, 0, 0.45), (0, -math.pi / 2 + 0.3, 0), 12, r2=0.07),
    ]
    v = fuse(parts, 0.045, BONE(), target_tris=1400)
    publish([v], 'vertebra')


def bell():
    prof = [(0.001, 1.28), (0.18, 1.28), (0.31, 1.2), (0.36, 1.0), (0.4, 0.7), (0.47, 0.42), (0.6, 0.18), (0.72, 0.04), (0.74, 0.0),
            (0.67, 0.0), (0.56, 0.14), (0.42, 0.4), (0.34, 0.7), (0.3, 1.0), (0.001, 1.12)]
    b = lathe(prof, BRONZE(), 40)
    parts = [b,
             torus(0.12, 0.04, (0, 0, 1.36), (math.pi / 2, 0, 0), BRONZE(), 16),
             torus(0.73, 0.03, (0, 0, 0.06), (0, 0, 0), BRONZE(), 48),
             torus(0.44, 0.025, (0, 0, 0.5), (0, 0, 0), BRONZE(), 48),
             cyl(0.025, 0.8, (0, 0, 0.62), m=IRON()),
             sphere(0.12, (0, 0, 0.2), m=IRON(), segs=16)]
    publish(parts, 'bell', origin=(0, 0, 1.36))  # hangs from its crown loop


# ================================================================ Pyromancy
def spike(base, d, L, r0, r1, m, flat=1.0, segs=10):
    """A tapered blade from `base` along direction `d` (a feather, plume or flame tongue)."""
    d = Vector(d).normalized()
    bpy.ops.mesh.primitive_cone_add(radius1=r0, radius2=r1, depth=L, vertices=segs, location=(0, 0, L / 2))
    o = active()
    o.scale = (1, flat, 1)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    # Move the base to the origin, then aim +Z along d.
    for v in o.data.vertices:
        v.co.z += 0.0
    o.rotation_euler = Vector((0, 0, 1)).rotation_difference(d).to_euler()
    o.location = base
    select_only(o)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    assign(o, m)
    smooth(o, 40)
    return o


def streamer(pts, r0, r1, m, voxel=0.035, tris=900):
    """A flowing plume: spheres along a path, shrinking toward the tip, fused into one tube."""
    balls = []
    for k in range(len(pts) - 1):
        a, b = Vector(pts[k]), Vector(pts[k + 1])
        n = max(2, int((b - a).length / 0.05))
        for i in range(n):
            t = (k + i / n) / (len(pts) - 1)
            balls.append(sphere(r0 + (r1 - r0) * t, tuple(a.lerp(b, i / n)), segs=10))
    return fuse(balls, voxel, m, target_tris=tris)


def phoenix_body():
    core = [
        sphere(0.42, (0, 0.1, 0.55), (0.75, 0.8, 1.45)),    # slender torso
        sphere(0.38, (0, -0.16, 0.95), (0.9, 0.85, 1.0)),   # breast
    ]
    neck = [(0, -0.2, 1.25), (0, -0.3, 1.55), (0, -0.33, 1.85), (0, -0.3, 2.1)]
    for k in range(len(neck) - 1):  # dense spheres so the neck fuses into one smooth column
        for i in range(4):
            t = (k + i / 4) / (len(neck) - 1)
            core.append(sphere(0.2 - t * 0.06, tuple(Vector(neck[k]).lerp(Vector(neck[k + 1]), i / 4)), segs=14))
    core.append(sphere(0.2, (0, -0.4, 2.22), (0.85, 1.25, 0.85)))  # head
    body = fuse(core, 0.03, EMBER(), target_tris=4000)
    parts = [body,
             spike((0, -0.62, 2.22), (0, -1, -0.45), 0.34, 0.08, 0.0, GOLDF(), 1.0, 12),   # hooked beak
             sphere(0.045, (0.12, -0.52, 2.3), m=MOLTEN(), segs=10), sphere(0.045, (-0.12, -0.52, 2.3), m=MOLTEN(), segs=10)]
    # Crest: flame tongues sweeping back from the crown.
    for i in range(5):
        a = (i - 2) * 0.22
        parts.append(spike((math.sin(a) * 0.1, -0.35, 2.36), (math.sin(a) * 0.6, 0.9, 0.9 - abs(i - 2) * 0.15), 0.75 - abs(i - 2) * 0.12, 0.06, 0.0, GOLDF(), 0.5, 8))
    # Tail: long streamers flowing down and back in an S-curve, alternating flame and gold.
    for i in range(7):
        a = (i - 3) * 0.28
        sx = math.sin(a)
        L = 1.0 - abs(i - 3) * 0.08
        pts = [(sx * 0.1, 0.35, 0.15), (sx * 0.5 * L, 0.9 * L, -0.5 * L), (sx * 0.9 * L, 1.1 * L, -1.3 * L), (sx * 1.3 * L, 1.6 * L, -1.9 * L), (sx * 1.5 * L, 2.3 * L, -2.2 * L)]
        parts.append(streamer(pts, 0.1, 0.02, FLAME() if i % 2 else GOLDF()))
        parts.append(spike(pts[-1], (sx * 0.3, 1, 0.3), 0.5, 0.09, 0.0, FLAME() if i % 2 == 0 else GOLDF(), 0.4, 8))  # flared tips
    for x in (0.16, -0.16):  # talons tucked under
        parts.append(spike((x, -0.05, 0.25), (x, -0.4, -1), 0.45, 0.06, 0.01, GOLDF(), 1.0, 8))
    publish(parts, 'phoenix_body')


def phoenix_wing():
    # Right wing, pivot at the shoulder. The arm arcs up and out; primaries fan down and out
    # from it, longest at the tip, shading gold → ember → flame.
    sh = Vector((0.28, 0.05, 1.2))
    path = [sh + Vector((t * 2.8, 0.1 * t, math.sin(t * 2.2) * 0.9)) for t in [i / 5 for i in range(6)]]
    parts = [streamer([tuple(p) for p in path], 0.16, 0.07, EMBER(), 0.03, 1800)]
    for i in range(13):
        t = i / 12
        k = t * 5
        a, b = path[min(4, int(k))], path[min(5, int(k) + 1)]
        base = a.lerp(b, k - int(k))
        L = 0.9 + t * 1.7 - (0.35 if t > 0.93 else 0)
        d = (0.25 + t * 1.1, 0.05, -1.0 + t * 0.35)
        m = [GOLDF(), EMBER(), FLAME()][min(2, int(t * 3))]
        parts.append(spike(tuple(base), d, L, 0.2, 0.02, m, 0.28))
    # Coverts: a shorter layer over the feather roots.
    for i in range(8):
        t = i / 7
        base = path[0].lerp(path[4], t)
        parts.append(spike(tuple(base + Vector((0, -0.06, 0))), (0.3 + t * 0.6, -0.05, -1), 0.55 + t * 0.3, 0.16, 0.03, GOLDF(), 0.3))
    publish(parts, 'phoenix_wing', origin=tuple(sh))


def bellows():
    # Teardrop boards joined by pleated leather; nozzle points forward (-Y).
    def board(z, m):
        me = bpy.data.meshes.new('board')
        bm = bmesh.new()
        pts = []
        for i in range(24):
            a = i / 24 * math.tau
            r = 0.55 + 0.45 * max(0, math.cos(a))  # fat at the back
            pts.append((math.sin(a) * 0.55, math.cos(a) * r * 0.9 - 0.1, 0))
        top = [bm.verts.new((x, y, z + 0.06)) for x, y, _ in pts]
        bot = [bm.verts.new((x, y, z - 0.06)) for x, y, _ in pts]
        bm.faces.new(top)
        bm.faces.new(list(reversed(bot)))
        for i in range(24):
            j = (i + 1) % 24
            bm.faces.new((bot[i], bot[j], top[j], top[i]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        o = bpy.data.objects.new('board', me)
        scene.collection.objects.link(o)
        assign(o, m)
        mod = o.modifiers.new('bevel', 'BEVEL')
        mod.width = 0.03
        mod.segments = 2
        apply_mod(o, mod)
        return o
    parts = [board(0.0, WOOD()), board(0.7, WOOD())]
    for k in range(4):  # leather pleats
        z = 0.14 + k * 0.14
        s = 0.92 if k % 2 else 1.0
        p = sphere(0.55, (0, 0.12, z), (s, s * 0.95, 0.13), 24, LEATHER())
        parts.append(p)
    parts.append(cyl(0.1, 0.9, (0, -1.0, 0.35), (math.pi / 2, 0, 0), 16, r2=0.05, m=BRONZE()))  # nozzle
    parts.append(torus(0.11, 0.03, (0, -0.62, 0.35), (math.pi / 2, 0, 0), BRONZE(), 16))
    for z in (0.0, 0.7):
        parts.append(cyl(0.06, 0.9, (0, 1.2, z), (math.pi / 2, 0, 0), 10, m=WOOD()))  # handles
        for x in (-0.3, 0.3):
            parts.append(sphere(0.045, (x, 0.2, z + 0.07), m=BRONZE(), segs=8))
    publish(parts, 'bellows')


def crucible():
    bowl = lathe([(0.001, 0.0), (0.4, 0.0), (0.62, 0.2), (0.72, 0.6), (0.74, 0.9), (0.66, 0.9), (0.62, 0.62), (0.52, 0.28), (0.001, 0.2)], IRON(), 36)
    parts = [bowl,
             cyl(0.64, 0.04, (0, 0, 0.8), verts=36, m=MOLTEN()),                                 # molten surface
             box((0.3, 0.26, 0.12), (0, -0.74, 0.86), (0.25, 0, 0), IRON(), 0.03),               # pour lip
             torus(0.74, 0.05, (0, 0, 0.9), (0, 0, 0), IRON(), 48),
             torus(0.72, 0.05, (0, 0, 0.45), (0, 0, 0), BRONZE(), 48),
             cyl(0.1, 1.9, (0, 0, 0.55), (0, math.pi / 2, 0), 12, m=IRON())]                     # trunnion axle
    publish(parts, 'crucible', origin=(0, 0, 0.55))  # tips about its axle


def anvil():
    parts = [box((0.9, 0.7, 0.2), (0, 0, 0.1), m=IRON(), bevel=0.04),
             box((0.5, 0.4, 0.5), (0, 0, 0.45), m=IRON(), bevel=0.05),
             box((1.4, 0.55, 0.3), (0, 0, 0.85), m=IRON(), bevel=0.05),
             cyl(0.27, 0.7, (1.0, 0, 0.88), (0, math.pi / 2, 0), 16, r2=0.03, m=IRON())]
    publish(parts, 'anvil')


# ================================================================ Cryomancy
def ice_heart():
    parts = [sphere(0.6, (0.38, 0, 0.35), segs=16), sphere(0.6, (-0.38, 0, 0.35), segs=16),
             cyl(0.9, 1.3, (0, 0, -0.45), (math.pi, 0, 0), 16, r2=0.02)]
    h = fuse(parts, 0.1, ICE(), target_tris=240, flat=True)
    publish([h], 'ice_heart', origin=(0, 0, 0))


for fn in (titan_skull, titan_jaw, skull_small, vertebra, bell, phoenix_body, phoenix_wing, bellows, crucible, anvil, ice_heart):
    fn()

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True, export_yup=True, export_materials='EXPORT')
print('EXPORTED', OUT)
