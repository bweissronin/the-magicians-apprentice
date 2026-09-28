"""Builds the tower-interior furniture library and exports it as one glTF binary.

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/build_furniture.py

Each prop is joined into a single mesh named after it (e.g. "bookshelf"), modelled at
real scale in metres, standing on the floor at the origin with its front facing -Y
(which becomes +Z in three.js after the glTF Y-up conversion). Detail comes from
bevelled edges, turned (lathed) legs, individual planks, rivets and mouldings.
"""
import bpy, bmesh, math, os, random
from mathutils import Vector

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'assets', 'models', 'furniture.glb')
random.seed(7)

# ---------------------------------------------------------------- scene & materials
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


WOOD = lambda: mat('wood', '#c98a4b', 0.55)
WOOD_D = lambda: mat('woodDark', '#8d5a2b', 0.55)
WOOD_L = lambda: mat('woodLight', '#dba468', 0.5)
GOLD = lambda: mat('gold', '#ffcf5a', 0.35, 0.6)
IRON = lambda: mat('iron', '#4a4458', 0.4, 0.3)
STONE = lambda: mat('stone', '#e3d6bd', 0.7)
STONE_D = lambda: mat('stoneDark', '#cdbd9f', 0.75)
SOOT = lambda: mat('soot', '#2a1d1a', 0.9)
PAPER = lambda: mat('paper', '#fff4d6', 0.7)
BOOKS = ['#c0392b', '#2e6fd8', '#2e9b57', '#8a3fc0', '#d98a2b', '#1f8f9a', '#b8456f']


def book_mat(i):
    return mat('book%d' % i, BOOKS[i % len(BOOKS)], 0.55)


# ---------------------------------------------------------------- primitive helpers
def finish(obj, m, bevel=0.0, segs=3, smooth=True):
    obj.data.materials.append(m)
    if bevel > 0:
        mod = obj.modifiers.new('bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = segs
        mod.limit_method = 'ANGLE'
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
    if smooth:
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))
    return obj


def box(size, loc, m, bevel=0.03, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(o, m, bevel)


def cyl(r, depth, loc, m, verts=24, rot=(0, 0, 0), bevel=0.0, r2=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, vertices=verts, location=loc, rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=depth, vertices=verts, location=loc, rotation=rot)
    return finish(bpy.context.active_object, m, bevel)


def sphere(r, loc, m, scale=(1, 1, 1), segs=20):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=segs, ring_count=segs // 2)
    o = bpy.context.active_object
    o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(o, m)


def torus(R, r, loc, m, rot=(0, 0, 0), seg=32, arc=None):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, location=loc, rotation=rot, major_segments=seg, minor_segments=10)
    return finish(bpy.context.active_object, m)


def lathe(profile, loc, m, segs=24, rot=(0, 0, 0), wobble=None):
    """Revolve a (radius, height) profile around Z. `wobble(i, a)` can perturb radius (e.g. barrel staves)."""
    me = bpy.data.meshes.new('lathe')
    bm = bmesh.new()
    rings = []
    for (r, z) in profile:
        ring = []
        for i in range(segs):
            a = i / segs * math.tau
            rr = r * (wobble(i, a) if wobble and r > 0.002 else 1)
            ring.append(bm.verts.new((math.cos(a) * rr, math.sin(a) * rr, z)))
        rings.append(ring)
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
    o.rotation_euler = rot
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    o.location = (0, 0, 0)
    return finish(o, m)


def turned_leg(h, loc, m, r=0.07):
    """A classic turned furniture leg: foot, bulb, neck, collar."""
    prof = [(0.001, 0), (r * 0.9, 0), (r * 1.1, h * 0.06), (r * 0.7, h * 0.12), (r * 1.35, h * 0.3), (r * 0.75, h * 0.48),
            (r * 0.9, h * 0.62), (r * 1.2, h * 0.8), (r * 1.2, h * 0.95), (r * 1.0, h), (0.001, h)]
    return lathe(prof, loc, m, segs=16)


def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    o.data.name = name
    return o


# Lay props out in a row so the .blend is readable if opened (positions reset on export via origin).
LAYOUT = {'x': 0.0}


def publish(objs, name):
    o = join(objs, name)
    # Origin at the floor centre so three.js can place it directly.
    bpy.context.scene.cursor.location = (0, 0, 0)
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    o.location.x = LAYOUT['x']
    LAYOUT['x'] += 4.0
    return o


# ================================================================ props
def bookshelf():
    W, D, H = 2.3, 0.7, 3.4
    parts = []
    for s in (-1, 1):
        parts.append(box((0.12, D, H), (s * (W / 2 - 0.06), 0, H / 2), WOOD_D()))
    parts.append(box((W, D - 0.05, 0.05), (0, 0.02, H / 2), WOOD_D(), 0.01))  # (hidden) spine
    parts.append(box((W - 0.1, 0.06, H - 0.1), (0, D / 2 - 0.05, H / 2), WOOD(), 0.01))  # back panel
    parts.append(box((W + 0.18, D + 0.12, 0.16), (0, -0.03, H + 0.02), WOOD_D(), 0.05))  # crown
    parts.append(box((W + 0.08, D + 0.06, 0.08), (0, -0.02, H - 0.1), WOOD(), 0.02))
    parts.append(box((W + 0.06, D + 0.04, 0.18), (0, -0.01, 0.09), WOOD_D(), 0.04))  # plinth
    rows = [0.2, 1.0, 1.8, 2.6]
    for y in rows:
        parts.append(box((W - 0.22, D - 0.1, 0.06), (0, 0.02, y), WOOD(), 0.015))
        parts.append(box((W - 0.22, 0.04, 0.05), (0, -D / 2 + 0.07, y + 0.02), WOOD_L(), 0.01))  # shelf lip
        x = -W / 2 + 0.2
        while x < W / 2 - 0.3:
            if random.random() < 0.12:  # a little horizontal stack
                for k in range(3):
                    parts.append(box((0.34, 0.26, 0.07), (x + 0.17, 0.0, y + 0.07 + k * 0.07), book_mat(random.randint(0, 6)), 0.012))
                x += 0.42
                continue
            bw, bh = 0.08 + random.random() * 0.08, 0.45 + random.random() * 0.25
            tilt = 0.18 if random.random() < 0.1 else 0
            mi = random.randint(0, 6)
            parts.append(box((bw, 0.36, bh), (x + bw / 2, 0.0, y + 0.03 + bh / 2), book_mat(mi), 0.01, rot=(0, tilt, 0)))
            parts.append(box((bw + 0.004, 0.02, 0.035), (x + bw / 2, -0.185, y + 0.03 + bh * 0.8), GOLD(), 0.0, rot=(0, tilt, 0)))
            x += bw + 0.012
    return publish(parts, 'bookshelf')


def desk():
    W, D, H = 2.6, 1.3, 1.0
    parts = [box((W, D, 0.1), (0, 0, H - 0.05), WOOD(), 0.04),
             box((W - 0.1, D - 0.1, 0.06), (0, 0, H - 0.12), WOOD_D(), 0.02)]
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(turned_leg(H - 0.14, (sx * (W / 2 - 0.14), sy * (D / 2 - 0.14), 0), WOOD_D()))
    # Drawer bank with knobs.
    for i, x in enumerate((-0.7, 0.0, 0.7)):
        parts.append(box((0.62, 0.05, 0.22), (x, -D / 2 + 0.07, H - 0.26), WOOD_L(), 0.02))
        parts.append(sphere(0.035, (x, -D / 2 + 0.03, H - 0.26), GOLD()))
    parts.append(box((W - 0.3, 0.08, 0.3), (0, -D / 2 + 0.12, H - 0.26), WOOD_D(), 0.01))
    parts.append(box((W - 0.4, 0.06, 0.06), (0, 0, 0.25), WOOD_D(), 0.02))  # stretcher
    return publish(parts, 'desk')


def table():
    W, D, H = 2.2, 1.2, 1.0
    parts = [box((W, D, 0.1), (0, 0, H - 0.05), WOOD(), 0.04)]
    # Plank seams on the top.
    for k in (-1, 0, 1):
        parts.append(box((W - 0.02, 0.012, 0.012), (0, k * D / 4, H + 0.001), WOOD_D(), 0.0))
    parts.append(box((W - 0.2, D - 0.2, 0.14), (0, 0, H - 0.16), WOOD_D(), 0.02))  # apron
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(turned_leg(H - 0.1, (sx * (W / 2 - 0.15), sy * (D / 2 - 0.15), 0), WOOD_D(), 0.06))
    return publish(parts, 'table')


def chair():
    parts = [box((0.8, 0.8, 0.1), (0, 0, 0.58), WOOD(), 0.03),
             box((0.72, 0.72, 0.1), (0, 0, 0.66), mat('cushionBlue', '#3f5fd8', 0.7), 0.05)]
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(turned_leg(0.54, (sx * 0.32, sy * 0.32, 0), WOOD_D(), 0.045))
    for sx in (-1, 1):
        parts.append(cyl(0.045, 1.1, (sx * 0.34, 0.35, 1.1), WOOD_D(), 12))
        parts.append(sphere(0.06, (sx * 0.34, 0.35, 1.68), WOOD_D()))
    parts.append(box((0.76, 0.08, 0.18), (0, 0.35, 1.52), WOOD(), 0.03))
    for x in (-0.18, 0, 0.18):
        parts.append(cyl(0.03, 0.8, (x, 0.35, 1.08), WOOD_L(), 10))
    return publish(parts, 'chair')


def bed():
    parts = []
    parts.append(box((2.0, 3.0, 0.3), (0, 0, 0.35), WOOD(), 0.05))
    parts.append(box((1.9, 2.9, 0.28), (0, 0, 0.62), PAPER(), 0.1))  # mattress
    quilt = box((1.96, 2.2, 0.16), (0, -0.35, 0.8), mat('quilt', '#3f5fd8', 0.75), 0.07)
    parts.append(quilt)
    for y in (-1.1, -0.6, -0.1, 0.4):
        parts.append(box((1.98, 0.12, 0.17), (0, y, 0.805), mat('quiltStripe', '#ffcf5a', 0.7), 0.04))
    parts.append(box((1.3, 0.6, 0.26), (0, 1.05, 0.84), PAPER(), 0.12))  # pillow
    # Headboard with arched top and posts.
    parts.append(box((2.0, 0.14, 1.2), (0, 1.45, 0.9), WOOD_D(), 0.04))
    parts.append(cyl(1.0, 0.14, (0, 1.45, 1.5), WOOD_D(), 32, rot=(math.pi / 2, 0, 0)))
    parts.append(box((2.2, 0.2, 0.5), (0, 1.45, 1.25), WOOD_D(), 0.0))  # hides lower half of the arch disc
    for sx in (-1, 1):
        for y, h in ((1.45, 1.8), (-1.45, 1.0)):
            parts.append(turned_leg(h, (sx * 1.0, y, 0), WOOD(), 0.08))
            parts.append(sphere(0.1, (sx * 1.0, y, h + 0.05), GOLD()))
    parts.append(box((2.0, 0.12, 0.6), (0, -1.45, 0.55), WOOD_D(), 0.04))  # footboard
    return publish(parts, 'bed')


def chest():
    parts = []
    for i, z in enumerate((0.1, 0.28, 0.46)):
        parts.append(box((1.2, 0.75, 0.17), (0, 0, z), WOOD() if i % 2 else WOOD_L(), 0.02))
    parts.append(cyl(0.375, 1.22, (0, 0, 0.56), WOOD(), 24, rot=(0, math.pi / 2, 0)))
    parts.append(box((1.24, 0.78, 0.04), (0, 0, 0.56), WOOD_D(), 0.01))
    for x in (-0.45, 0.45):
        parts.append(box((0.09, 0.8, 0.58), (x, 0, 0.29), IRON(), 0.01))
        parts.append(torus(0.385, 0.03, (x, 0, 0.56), IRON(), rot=(0, math.pi / 2, 0)))
        for z in (0.1, 0.3, 0.5):
            for s in (-1, 1):
                parts.append(sphere(0.022, (x, s * 0.405, z), GOLD(), segs=8))
    parts.append(box((0.2, 0.05, 0.24), (0, -0.4, 0.52), GOLD(), 0.02))
    parts.append(torus(0.05, 0.015, (0, -0.43, 0.46), GOLD(), rot=(math.pi / 2, 0, 0)))
    return publish(parts, 'chest')


def cauldron():
    prof = [(0.001, 0.2), (0.6, 0.22), (0.95, 0.4), (1.15, 0.8), (1.08, 1.22), (0.96, 1.36), (1.02, 1.42), (0.92, 1.44), (0.86, 1.3)]
    parts = [lathe(prof, (0, 0, 0), IRON(), 40)]
    parts.append(torus(1.0, 0.06, (0, 0, 1.42), IRON(), seg=48))
    for i in range(3):
        a = i / 3 * math.tau
        parts.append(cyl(0.09, 0.45, (math.cos(a) * 0.72, math.sin(a) * 0.72, 0.18), IRON(), 12, rot=(0, 0, 0), r2=0.05))
    for s in (-1, 1):
        parts.append(torus(0.18, 0.04, (s * 1.12, 0, 1.2), IRON(), rot=(math.pi / 2, 0, 0)))
    # Rivet band.
    for i in range(16):
        a = i / 16 * math.tau
        parts.append(sphere(0.035, (math.cos(a) * 1.13, math.sin(a) * 1.13, 0.9), GOLD(), segs=8))
    return publish(parts, 'cauldron')


def barrel():
    staves = 18
    wob = lambda i, a: 1.0 if i % 2 else 0.975
    prof = [(0.001, 0), (0.4, 0), (0.46, 0.2), (0.5, 0.45), (0.46, 0.7), (0.4, 0.9), (0.001, 0.9)]
    parts = [lathe(prof, (0, 0, 0), mat('barrelWood', '#b8763a', 0.55), staves * 2, wobble=wob)]
    for z, r in ((0.12, 0.44), (0.3, 0.49), (0.6, 0.49), (0.78, 0.44)):
        parts.append(torus(r, 0.025, (0, 0, z), IRON(), seg=40))
    return publish(parts, 'barrel')


def lectern():
    prof = [(0.001, 0), (0.42, 0), (0.42, 0.08), (0.3, 0.12), (0.14, 0.2), (0.11, 0.5), (0.16, 0.62), (0.11, 0.75), (0.1, 1.0), (0.2, 1.05), (0.001, 1.08)]
    parts = [lathe(prof, (0, 0, 0), WOOD_D(), 20)]
    parts.append(box((0.9, 0.7, 0.07), (0, 0, 1.16), WOOD(), 0.02, rot=(math.radians(-18), 0, 0)))
    parts.append(box((0.9, 0.05, 0.08), (0, -0.36, 1.07), WOOD_L(), 0.015, rot=(math.radians(-18), 0, 0)))
    for s in (-1, 1):
        parts.append(box((0.08, 0.3, 0.1), (s * 0.2, 0, 1.08), WOOD_D(), 0.02))
    return publish(parts, 'lectern')


def clock():
    parts = [box((0.9, 0.6, 2.4), (0, 0, 1.3), WOOD_D(), 0.04),
             box((1.0, 0.7, 0.14), (0, 0, 0.07), WOOD(), 0.03),
             box((1.0, 0.7, 0.7), (0, 0, 2.85), WOOD_D(), 0.04),
             box((1.1, 0.75, 0.12), (0, 0, 3.26), WOOD(), 0.04)]
    parts.append(cyl(0.34, 0.06, (0, -0.32, 2.85), GOLD(), 32, rot=(math.pi / 2, 0, 0)))
    parts.append(cyl(0.3, 0.07, (0, -0.33, 2.85), PAPER(), 32, rot=(math.pi / 2, 0, 0)))
    for i in range(12):
        a = i / 12 * math.tau
        parts.append(box((0.02, 0.02, 0.05), (math.sin(a) * 0.25, -0.37, 2.85 + math.cos(a) * 0.25), IRON(), 0.0, rot=(0, -a, 0)))
    parts.append(box((0.6, 0.04, 1.3), (0, -0.3, 1.35), mat('clockGlass', '#3b2a1a', 0.2), 0.02))
    parts.append(box((0.68, 0.05, 1.38), (0, -0.28, 1.35), GOLD(), 0.01))
    for s in (-1, 1):
        parts.append(sphere(0.07, (s * 0.45, 0, 3.4), GOLD()))
    parts.append(cyl(0.05, 0.3, (0, 0, 3.45), GOLD(), 12, r2=0.001))
    return publish(parts, 'clock')


def fireplace():
    parts = [box((3.4, 1.2, 0.18), (0, -0.05, 0.09), STONE_D(), 0.04)]  # hearth slab
    # Stacked stone blocks with a gap for the firebox.
    rng = random.Random(3)
    y = 0.18
    row = 0
    while y < 2.3:
        h = 0.36
        x = -1.5 + (0.25 if row % 2 else 0)
        while x < 1.5:
            w = 0.45 + rng.random() * 0.25
            w = min(w, 1.5 - x)
            cx = x + w / 2
            if not (abs(cx) < 0.85 and y < 1.35):
                parts.append(box((w - 0.03, 0.9, h - 0.03), (cx, 0.1, y + h / 2), STONE() if rng.random() < 0.6 else STONE_D(), 0.04))
            x += w
        y += h
        row += 1
    parts.append(box((1.7, 0.6, 1.25), (0, 0.3, 0.8), SOOT(), 0.05))  # firebox back
    parts.append(box((3.6, 1.15, 0.22), (0, -0.05, 2.42), WOOD_D(), 0.05))  # mantel
    for s in (-1, 1):
        parts.append(box((0.22, 0.3, 0.4), (s * 1.4, -0.38, 2.17), WOOD(), 0.04))  # corbels
    # Andirons.
    for s in (-1, 1):
        parts.append(cyl(0.04, 0.35, (s * 0.45, -0.15, 0.36), IRON(), 10))
        parts.append(sphere(0.07, (s * 0.45, -0.15, 0.56), GOLD()))
    return publish(parts, 'fireplace')


def throne():
    velvet = mat('velvet', '#7a3fc0', 0.75)
    parts = [box((1.5, 1.3, 0.5), (0, 0, 0.35), GOLD(), 0.06),
             box((1.3, 1.1, 0.22), (0, -0.05, 0.7), velvet, 0.1),
             box((1.3, 0.3, 2.2), (0, 0.5, 1.7), velvet, 0.12),
             box((1.6, 0.2, 2.4), (0, 0.66, 1.6), GOLD(), 0.05)]
    parts.append(cyl(0.8, 0.2, (0, 0.66, 2.8), GOLD(), 32, rot=(math.pi / 2, 0, 0)))
    parts.append(box((1.7, 0.25, 0.6), (0, 0.66, 2.55), GOLD(), 0.0))
    for s in (-1, 1):
        parts.append(box((0.25, 1.2, 0.3), (s * 0.78, -0.05, 1.0), GOLD(), 0.06))
        parts.append(sphere(0.12, (s * 0.78, -0.62, 1.2), GOLD()))
        parts.append(turned_leg(0.5, (s * 0.65, -0.55, -0.1), WOOD_D(), 0.07))
    parts.append(sphere(0.18, (0, 0.66, 3.65), mat('throneGem', '#ff7f8a', 0.2, 0.0, '#ff3f6a', 1.5)))
    for i in range(7):
        a = math.pi * (i / 6)
        parts.append(sphere(0.06, (math.cos(a) * 0.72, 0.56, 2.8 + math.sin(a) * 0.72), mat('pearl', '#fff4d6', 0.3)))
    return publish(parts, 'throne')


def telescope():
    brass = GOLD()
    ring_m = mat('brassDark', '#c89a3a', 0.35, 0.6)
    parts = []
    # Tube: tapering segments along an axis tilted 52 degrees from vertical toward the front (-Y).
    tilt = math.radians(52)
    axis = Vector((0, -math.sin(tilt), math.cos(tilt)))
    base = Vector((0, 0.35, 2.05))
    t = 0.0
    for r, L in ((0.36, 1.1), (0.3, 1.0), (0.24, 0.9)):
        c = base + axis * (t + L / 2)
        parts.append(cyl(r, L, tuple(c), brass, 28, rot=(tilt, 0, 0)))
        parts.append(torus(r + 0.025, 0.03, tuple(base + axis * (t + L)), ring_m, rot=(tilt, 0, 0)))
        t += L * 0.92
    parts.append(cyl(0.22, 0.04, tuple(base + axis * (t + 0.05)), mat('lens', '#bfe8ff', 0.1, 0.0, '#8fd8ff', 1.2), 28, rot=(tilt, 0, 0)))
    parts.append(cyl(0.07, 0.4, tuple(base - axis * 0.2), brass, 12, rot=(tilt, 0, 0)))  # eyepiece
    parts.append(sphere(0.17, (0, 0.2, 1.95), brass))  # mount
    # Tripod: tops meet under the mount, feet splay outward.
    for i in range(3):
        a = i / 3 * math.tau + math.pi / 2
        top = Vector((0, 0.2, 1.9))
        foot = Vector((math.cos(a) * 0.8, 0.2 + math.sin(a) * 0.8, 0.0))
        mid = (top + foot) / 2
        d = top - foot
        # Tilt +Z onto the leg direction: rotate about X then Y.
        rx = -math.atan2(d.y, d.z)
        ry = math.atan2(d.x, math.hypot(d.y, d.z))
        parts.append(cyl(0.05, d.length, tuple(mid), WOOD_D(), 10, rot=(rx, ry, 0)))
        parts.append(sphere(0.07, tuple(foot + Vector((0, 0, 0.04))), brass))
    return publish(parts, 'telescope')


def armchair():
    velvet = mat('rose', '#b8456f', 0.75)
    parts = [box((1.5, 1.3, 0.45), (0, 0, 0.35), velvet, 0.14),
             box((1.25, 1.05, 0.2), (0, -0.05, 0.66), velvet, 0.1),
             box((1.5, 0.35, 1.3), (0, 0.5, 1.05), velvet, 0.16)]
    for s in (-1, 1):
        parts.append(box((0.3, 1.2, 0.55), (s * 0.65, -0.05, 0.75), velvet, 0.13))
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(turned_leg(0.14, (sx * 0.6, sy * 0.5, 0), WOOD_D(), 0.06))
    for i in range(6):
        parts.append(sphere(0.03, (-0.6 + i * 0.24, 0.33, 1.55), GOLD(), segs=8))
    return publish(parts, 'armchair')


def potion_shelf():
    parts = [box((2.6, 0.4, 2.6), (0, 0.15, 1.3), WOOD_D(), 0.04),
             box((2.8, 0.5, 0.14), (0, 0.1, 2.66), WOOD(), 0.04)]
    for z in (0.7, 1.6):
        parts.append(box((2.6, 0.6, 0.08), (0, -0.15, z), WOOD(), 0.02))
        for s in (-1, 1):
            parts.append(box((0.08, 0.35, 0.25), (s * 1.1, -0.1, z - 0.14), WOOD_D(), 0.02))  # brackets
    return publish(parts, 'potionShelf')


def statue():
    s = mat('marble', '#e8e2d6', 0.4)
    parts = [box((1.1, 1.1, 0.8), (0, 0, 0.4), STONE_D(), 0.06),
             box((1.25, 1.25, 0.12), (0, 0, 0.06), STONE_D(), 0.04),
             box((1.2, 1.2, 0.1), (0, 0, 0.82), STONE(), 0.03)]
    parts.append(lathe([(0.001, 0.85), (0.55, 0.85), (0.5, 1.2), (0.36, 1.6), (0.26, 1.9), (0.001, 1.95)], (0, 0, 0), s, 28))
    parts.append(sphere(0.3, (0, 0, 2.15), s))
    parts.append(lathe([(0.001, 2.3), (0.55, 2.3), (0.56, 2.34), (0.32, 2.36), (0.2, 2.7), (0.08, 3.05), (0.001, 3.12)], (0, 0, 0), s, 28))
    parts.append(sphere(0.25, (0, -0.2, 1.85), s, scale=(1, 0.7, 1.4)))  # beard
    parts.append(cyl(0.04, 1.8, (0.5, -0.1, 1.7), s, 10))  # staff
    parts.append(sphere(0.1, (0.5, -0.1, 2.65), s))
    return publish(parts, 'statue')


for fn in (bookshelf, desk, table, chair, bed, chest, cauldron, barrel, lectern, clock, fireplace, throne, telescope, armchair, potion_shelf, statue):
    fn()

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True, export_yup=True, export_materials='EXPORT')
print('EXPORTED', OUT, len([o for o in scene.objects if o.type == 'MESH']), 'props')
