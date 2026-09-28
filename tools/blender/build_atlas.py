"""Renders the world atlas (M) as layered images, in a bright, chunky 2.5D toy style.

    /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/blender/build_atlas.py

Writes assets/ui/atlas/:
  base.webp                   every island: a thick rounded top that overhangs layered bands of
                              earth and stone, boulders hanging beneath, rim stones and each
                              land's little props (trees, graves, crystals, pines, a volcano)
  energy-<land>.webp          that island's glowing rift cracks, white, with everything solid held
                              out (the game tints them violet → gold as the land heals)
  bridge-<a>-<b>.webp         a rope-and-plank bridge between two islands, and -broken.webp with
                              its middle planks gone (shown while either end is sealed)

The camera is orthographic and tilted, and world Y is pre-stretched so that anything at Z = 0 (the
island tops) lands exactly on the atlas SVG's 1000×700 coordinates, while the layers (Z < 0) show
below their rims and props (Z > 0) stand up out of them. Island outlines use the same seeded blob
as the SVG (src/atlas.js) — keep PLACE / VALLEY / BRIDGES / landmarks and the blob maths in sync.
"""
import bpy, bmesh, math, os
from mathutils import Vector, noise

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'ui', 'atlas')
W, H, VC = 1000, 700, (500, 350)
TILT = math.radians(48)
RES = 2  # output pixels per atlas unit

PLACE = {
    'necromancy': dict(x=192, y=368, r=112, sx=1, sy=1.12, seed=11, amp=0.15),
    'geomancy': dict(x=500, y=120, r=98, sx=1.45, sy=0.82, seed=21, amp=0.15),
    'cryomancy': dict(x=812, y=342, r=112, sx=0.95, sy=1.1, seed=31, amp=0.15),
    'pyromancy': dict(x=514, y=590, r=92, sx=1.5, sy=0.78, seed=41, amp=0.15),
}
LANDS = {'arcane': dict(x=VC[0], y=VC[1], r=120, sx=1, sy=114 / 120, seed=2, amp=0.1), **PLACE}
BRIDGES = [('arcane', 'necromancy'), ('arcane', 'geomancy'), ('arcane', 'cryomancy'), ('arcane', 'pyromancy'),
           ('necromancy', 'geomancy'), ('geomancy', 'cryomancy'), ('cryomancy', 'pyromancy'), ('pyromancy', 'necromancy')]
# Landmarks the SVG marks inside each realm (realm units), and the valley's shrines (world units):
# props keep clear of them so the markers stay readable.
REALM_LANDMARKS = {
    'necromancy': [(-118, -34), (106, 46), (42, -128), (-72, 116)],
    'pyromancy': [(-112, -64), (116, -46), (-76, 112), (84, 106)],
    'cryomancy': [(-106, 72), (112, -84), (102, 88), (-88, -112)],
    'geomancy': [(118, -64), (-112, -58), (-86, 102), (28, 146)],
}
SHRINES = [(62, -38), (-78, 34), (26, 104), (-54, -112), (128, 58)]
LANDMARK_IDS = {'necromancy': ['mausoleums', 'chapel', 'bonefields', 'hill'], 'pyromancy': ['obsidian', 'forge', 'vent', 'bridges'],
                'cryomancy': ['armada', 'giant', 'stones', 'caves'], 'geomancy': ['geode', 'mine', 'cathedral', 'colossus']}
# Each land's colours: its top, the top's darker lip, and its earth band.
SKIN = {
    'arcane': dict(top='#8fd45a', lip='#5f9e38', earth='#c08850'),
    'necromancy': dict(top='#7fa08a', lip='#557563', earth='#8e7a6a'),
    'geomancy': dict(top='#d7a86a', lip='#a8763e', earth='#b07a4c'),
    'cryomancy': dict(top='#f2f8ff', lip='#b9d6ec', earth='#9fb2c4'),
    'pyromancy': dict(top='#5e4a46', lip='#3e2f2c', earth='#7a4a36'),
}


# ---------------------------------------------------------------- shared maths (mirrors atlas.js)
def mulberry32(seed):
    s = [seed & 0xffffffff]

    def imul(a, b):
        return (a * b) & 0xffffffff

    def r():
        s[0] = (s[0] + 0x6d2b79f5) & 0xffffffff
        t = s[0]
        t = imul(t ^ (t >> 15), 1 | t)
        t = ((t + imul(t ^ (t >> 7), 61 | t)) & 0xffffffff) ^ t
        return ((t ^ (t >> 14)) & 0xffffffff) / 4294967296
    return r


def blob_k(seed, amp):
    rnd = mulberry32(seed * 977 + 3)
    ph = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28]
    return lambda a: 1 + amp * (math.sin(3 * a + ph[0]) * 0.5 + math.sin(5 * a + ph[1]) * 0.3 + math.sin(7 * a + ph[2]) * 0.2)


def world(x, y, z=0.0):
    """Atlas SVG px (x, y) at height z (world units = 10 px) → world coordinates."""
    return Vector(((x - VC[0]) / 10, -(y - VC[1]) / 10 / math.cos(TILT), z))


def rim_px(L, k, a, f):
    rr = L['r'] * k(a) * f
    return L['x'] + math.cos(a) * rr * L['sx'], L['y'] + math.sin(a) * rr * L['sy']


def realm_px(id, lx, lz):
    P = PLACE[id]
    k = (P['r'] * 0.78) / 180
    return P['x'] + lx * k * P['sx'], P['y'] + lz * k * P['sy']


def valley_px(x, z):
    return VC[0] + x * (104 / 185), VC[1] + z * (96 / 185)


# ---------------------------------------------------------------- scene and materials
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = W * RES, H * RES
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'WEBP'  # lossy with alpha: a fraction of PNG's size
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.image_settings.quality = 88
    sc.view_settings.view_transform = 'AgX'  # rich colour without blown-out highlights
    sc.view_settings.look = 'AgX - Punchy'
    sc.eevee.taa_render_samples = 48
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = W / 10
    cam.data.clip_end = 2000
    cam.rotation_euler = (TILT, 0, 0)
    cam.location = (0, -math.sin(TILT) * 400, math.cos(TILT) * 400)
    sc.collection.objects.link(cam)
    sc.camera = cam
    # Warm sun from the front-left and high, so the cliff faces you see are lit and shadows fall
    # up and to the right; a cool sky fill keeps the shade soft and colourful.
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.4
    sun.data.angle = math.radians(8)
    sun.data.color = (1.0, 0.95, 0.86)
    sun.rotation_mode = 'QUATERNION'
    sun.rotation_quaternion = Vector((0.4, 0.42, -0.81)).normalized().to_track_quat('-Z', 'Y')
    sc.collection.objects.link(sun)
    wd = bpy.data.worlds.new('w')
    wd.use_nodes = True
    bg = wd.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.62, 0.7, 0.95, 1)
    bg.inputs['Strength'].default_value = 0.6
    sc.world = wd
    return sc


def srgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple([x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c] + [1.0])


def shade(hexcol, k):
    rgb = [int(hexcol[i:i + 2], 16) for i in (1, 3, 5)]
    return '#%02x%02x%02x' % tuple(max(0, min(255, int(v * k))) for v in rgb)


MATS = {}


def node_mat(name, build):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(build(nt), out.inputs['Surface'])
    MATS[name] = m
    return m


def bsdf(nt, color_socket=None, color=None, rough=0.75, emit=None, emit_k=0.0):
    b = nt.nodes.new('ShaderNodeBsdfPrincipled')
    b.inputs['Roughness'].default_value = rough
    if color_socket is not None:
        nt.links.new(color_socket, b.inputs['Base Color'])
    else:
        b.inputs['Base Color'].default_value = srgb(color)
    if emit:
        b.inputs['Emission Color'].default_value = srgb(emit)
        b.inputs['Emission Strength'].default_value = emit_k
    return b.outputs['BSDF']


def ramp(nt, fac, stops):
    r = nt.nodes.new('ShaderNodeValToRGB')
    els = r.color_ramp.elements
    els[0].position, els[0].color = stops[0][0], srgb(stops[0][1])
    els[1].position, els[1].color = stops[-1][0], srgb(stops[-1][1])
    for p, c in stops[1:-1]:
        e = els.new(p)
        e.color = srgb(c)
    nt.links.new(fac, r.inputs['Fac'])
    return r.outputs['Color']


def flat(name, color, rough=0.75, emit=None, emit_k=0.0):
    return node_mat(name, lambda nt: bsdf(nt, color=color, rough=rough, emit=emit, emit_k=emit_k))


def gradient(name, top, bottom, z0, z1, rough=0.8):
    """A clean vertical blend from `top` (at world Z z0) to `bottom` (at z1): the soft,
    painted-looking shading of a toy diorama."""
    def build(nt):
        g = nt.nodes.new('ShaderNodeNewGeometry')
        sep = nt.nodes.new('ShaderNodeSeparateXYZ')
        nt.links.new(g.outputs['Position'], sep.inputs['Vector'])
        mr = nt.nodes.new('ShaderNodeMapRange')
        mr.inputs['From Min'].default_value, mr.inputs['From Max'].default_value = z1, z0
        nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
        return bsdf(nt, ramp(nt, mr.outputs['Result'], [(0.0, bottom), (1.0, top)]), rough=rough)
    return node_mat(name, build)


def top_mat(id):
    """The island top: its colour in big, soft, low-contrast patches."""
    c = SKIN[id]['top']

    def build(nt):
        g = nt.nodes.new('ShaderNodeNewGeometry')
        n = nt.nodes.new('ShaderNodeTexNoise')
        n.inputs['Scale'].default_value = 0.09
        n.inputs['Detail'].default_value = 2
        nt.links.new(g.outputs['Position'], n.inputs['Vector'])
        return bsdf(nt, ramp(nt, n.outputs['Fac'], [(0.35, shade(c, 0.92)), (0.5, c), (0.65, shade(c, 1.06))]), rough=0.85)
    return node_mat(f'top-{id}', build)


def emit_mat():
    def build(nt):
        e = nt.nodes.new('ShaderNodeEmission')
        e.inputs['Color'].default_value = (1, 1, 1, 1)
        e.inputs['Strength'].default_value = 1.0
        return e.outputs['Emission']
    return node_mat('vein', build)


def link(o, m=None):
    if o.name not in bpy.context.scene.collection.objects:
        bpy.context.scene.collection.objects.link(o)
    if m is not None:
        o.data.materials.clear()
        o.data.materials.append(m)
    return o


def mesh_obj(name, bm, m, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = link(bpy.data.objects.new(name, me), m)
    for p in o.data.polygons:
        p.use_smooth = smooth
    return o


def curve_obj(name, pts, m, depth=0.09):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = depth
    cu.bevel_resolution = 2
    sp = cu.splines.new('POLY')
    sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        sp.points[i].co = (p.x, p.y, p.z, 1)
    return link(bpy.data.objects.new(name, cu), m)


def pebble(name, loc, r, m, scale=(1, 1, 1), rot=(0, 0, 0), sub=2, lumpy=0.18, seed=0):
    """A rounded, slightly lumpy stone — the toy-rock look."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r)
    for v in bm.verts:
        v.co *= 1 + lumpy * noise.noise(v.co * (1.6 / r) + Vector((seed, seed * 0.7, 0)))
    o = mesh_obj(name, bm, m)
    o.location, o.scale, o.rotation_euler = loc, scale, rot
    return o


def prim(kind, name, loc, m, **kw):
    getattr(bpy.ops.mesh, f'primitive_{kind}_add')(location=loc, **kw)
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(m)
    bpy.ops.object.shade_smooth()
    return o


# ---------------------------------------------------------------- islands
# The island's layers, top to bottom: (z, radius factor) rings. The top's lip bulges out and tucks
# back under, then the earth band, a stone band and a deeper band, each a little inset.
CAP = [(0.0, 1.0), (-0.25, 1.035), (-0.7, 1.045), (-1.0, 1.02), (-1.15, 0.99)]
EARTH = [(-1.05, 0.985), (-1.3, 1.005), (-2.3, 1.015), (-3.1, 0.99), (-3.3, 0.96)]
STONE = [(-3.2, 0.955), (-3.45, 0.975), (-4.7, 0.965), (-5.5, 0.92), (-5.7, 0.885)]
DEEP = [(-5.6, 0.88), (-5.9, 0.895), (-6.9, 0.84), (-7.4, 0.76), (-7.6, 0.7)]
FACE = CAP[2:] + EARTH[1:] + STONE[1:] + DEEP[1:]


def face_f(z):
    """Radius factor of the island's outer face at depth z (for cracks laid on its surface)."""
    for (z0, f0), (z1, f1) in zip(FACE, FACE[1:]):
        if z1 <= z <= z0:
            return f0 + (f1 - f0) * (z0 - z) / (z0 - z1)
    return FACE[-1][1]


def band(name, L, k, rings, m, seed, N=144, wob=0.018):
    bm = bmesh.new()
    rr = []
    for z, f in rings:
        row = []
        for i in range(N):
            a = i / N * 2 * math.pi
            ff = f * (1 + wob * noise.noise(Vector((math.cos(a) * 3, math.sin(a) * 3, seed + z * 0.3))))
            row.append(bm.verts.new(world(*rim_px(L, k, a, ff), z)))
        rr.append(row)
    for r0, r1 in zip(rr, rr[1:]):
        for i in range(N):
            bm.faces.new((r0[i], r0[(i + 1) % N], r1[(i + 1) % N], r1[i]))
    return mesh_obj(name, bm, m)


def spot_ok(id, L, x, y, taken, gap):
    if any(math.hypot(x - tx, y - ty) < gap for tx, ty in taken):
        return False
    # Keep the middle clear for the tower icon and the land's name.
    if abs(x - L['x']) < 70 and -38 < y - L['y'] < 52:
        return False
    marks = [realm_px(id, *p) for p in REALM_LANDMARKS.get(id, [])] if id != 'arcane' else [valley_px(*p) for p in SHRINES]
    return all(math.hypot(x - mx, y - my) > 32 for mx, my in marks)


def scatter(id, L, k, rnd, n, lo=0.25, hi=0.84, gap=16):
    """Up to n spots on the island top, clear of each other and of the SVG's markers."""
    out = []
    for _ in range(n * 25):
        if len(out) >= n:
            break
        a, f = rnd() * 2 * math.pi, lo + (hi - lo) * math.sqrt(rnd())
        x, y = rim_px(L, k, a, f)
        if spot_ok(id, L, x, y, out, gap):
            out.append((x, y))
    return out


def tree(name, x, y, s, rnd, leaf, leaf2):
    p = world(x, y, 0)
    s *= 1.9  # chunky toy scale
    objs = [prim('cylinder', name + '-trunk', p + Vector((0, 0, 0.35 * s)), MATS['trunk'], radius=0.16 * s, depth=0.7 * s, vertices=10)]
    for j, (dx, dy, dz, r) in enumerate([(0, 0, 1.05, 0.62), (-0.3, 0.1, 0.8, 0.45), (0.32, -0.08, 0.85, 0.47), (0.05, -0.05, 1.45, 0.42)]):
        objs.append(pebble(f'{name}-leaf{j}', p + Vector((dx * s, dy * s, dz * s)), r * s, leaf if j != 3 else leaf2, sub=2, lumpy=0.12, seed=rnd() * 9))
    return objs


def props(id, L, k, rnd):
    """Each land's toy props on its top."""
    objs = []
    if id == 'arcane':
        for i, (x, y) in enumerate(scatter(id, L, k, rnd, 16, 0.3, 0.86, 24)):
            objs += tree(f'tree-{i}', x, y, 0.8 + rnd() * 0.45, rnd, MATS['leaf'], MATS['leaf-hi'])
        for i, (x, y) in enumerate(scatter(id, L, k, rnd, 6, 0.4, 0.8, 30)):
            objs.append(pebble(f'bush-{i}', world(x, y, 0.3), 0.7, MATS['leaf'], (1.3, 1.3, 0.8), seed=i))
    elif id == 'necromancy':
        for i, (x, y) in enumerate(scatter(id, L, k, rnd, 14, 0.25, 0.85, 22)):
            p = world(x, y, 0)
            g = prim('cube', f'grave-{i}', p + Vector((0, 0, 0.7)), MATS['grave'], size=1)
            g.scale = (0.64, 0.24, 0.68)
            g.rotation_euler = (0.1 * (rnd() - 0.5), 0, (rnd() - 0.5) * 0.5)
            bev = g.modifiers.new('b', 'BEVEL'); bev.width = 0.08; bev.segments = 3
            objs += [g, prim('uv_sphere', f'grave-top-{i}', p + Vector((0, 0, 1.04)), MATS['grave'], radius=0.64, segments=16, ring_count=8)]
            objs[-1].scale = (0.5, 0.375, 0.5)  # a rounded top exactly as wide as the slab
            objs[-1].rotation_euler = g.rotation_euler
        for i, (x, y) in enumerate(scatter(id, L, k, rnd, 7, 0.3, 0.8, 30)):
            p = world(x, y, 0)
            t = prim('cone', f'dead-{i}', p + Vector((0, 0, 1.5)), MATS['deadwood'], radius1=0.34, depth=3.0, vertices=8)
            objs.append(t)
            for b in range(3):
                c = prim('cylinder', f'dead-{i}-b{b}', p + Vector((0, 0, 1.4 + b * 0.55)), MATS['deadwood'], radius=0.1, depth=1.3, vertices=6)
                c.rotation_euler = (0.9, 0, b * 2.1 + rnd())
                objs.append(c)
        for i, (x, y) in enumerate(scatter(id, L, k, rnd, 8, 0.3, 0.85, 20)):
            objs.append(pebble(f'wisp-mush-{i}', world(x, y, 0.25), 0.32, MATS['ghostglow'], (1, 1, 0.7), seed=i))
    elif id == 'geomancy':
        for i, (x, y) in enumerate(scatter(id, L, k, rnd, 9, 0.25, 0.85, 26)):
            p = world(x, y, 0)
            m = MATS['crystal-a'] if i % 2 else MATS['crystal-b']
            for j in range(3):
                h = 1.8 + rnd() * 1.4 - j * 0.4
                c = prim('cylinder', f'crystal-{i}-{j}', p + Vector(((j - 1) * 0.5, 0, h / 2)), m, radius=0.32, depth=h, vertices=6)
                c.rotation_euler = ((j - 1) * 0.35, (rnd() - 0.5) * 0.4, 0)
                tip = prim('cone', f'crystal-{i}-{j}-tip', p + Vector(((j - 1) * 0.5 + (j - 1) * 0.35 * 0.5 * h, 0, h + 0.36)), m, radius1=0.32, depth=0.72, vertices=6)
                tip.rotation_euler = c.rotation_euler
                objs += [c, tip]
    elif id == 'cryomancy':
        for i, (x, y) in enumerate(scatter(id, L, k, rnd, 14, 0.28, 0.86, 24)):
            p, s = world(x, y, 0), (0.8 + rnd() * 0.5) * 1.8
            for j, (z, r, d) in enumerate([(0.55, 0.62, 1.0), (1.05, 0.48, 0.85), (1.5, 0.32, 0.7)]):
                objs.append(prim('cone', f'pine-{i}-{j}', p + Vector((0, 0, z * s)), MATS['pine'], radius1=r * s, depth=d * s, vertices=10))
                objs.append(prim('cone', f'pine-{i}-{j}-snow', p + Vector((0, 0, (z + d * 0.22) * s)), MATS['snowcap'], radius1=r * s * 0.62, depth=d * s * 0.55, vertices=10))
        for i, (x, y) in enumerate(scatter(id, L, k, rnd, 8, 0.3, 0.8, 22)):
            p = world(x, y, 0)
            for j in range(2):
                c = prim('cone', f'ice-{i}-{j}', p + Vector((j * 0.55, 0, 1.3)), MATS['ice'], radius1=0.42, depth=2.6 + rnd() * 1.0, vertices=5)
                c.rotation_euler = (0.2 * (j - 0.5), 0.25 * (rnd() - 0.5), 0)
                objs.append(c)
    elif id == 'pyromancy':
        for i, (x, y) in enumerate(scatter(id, L, k, rnd, 9, 0.35, 0.86, 28)):
            objs.append(pebble(f'basalt-{i}', world(x, y, 0.4), 0.9 + rnd() * 0.7, MATS['basalt'], (1, 1, 1.3), seed=i))
        for i in range(6):
            a0 = rnd() * 2 * math.pi
            f0 = 0.5 + rnd() * 0.3
            pts = [world(*rim_px(L, k, a0 + j * 0.05, f0 + (rnd() - 0.5) * 0.04), 0.03) for j in range(6)]
            objs.append(curve_obj(f'lavacrack-{i}', pts, MATS['lava-dim'], 0.08))
    return objs


# ---------------------------------------------------------------- landmark dioramas
# Small builders; p is the landmark's base point, offsets are in world units (1 = 10 atlas px).
def box(name, p, off, size, m, rot=(0, 0, 0), bevel=0.06):
    o = prim('cube', name, p + Vector(off), m, size=1)
    o.scale, o.rotation_euler = size, rot
    if bevel:
        b = o.modifiers.new('b', 'BEVEL'); b.width = bevel; b.segments = 2
    return o


def cyl(name, p, off, r, h, m, verts=16, rot=(0, 0, 0)):
    o = prim('cylinder', name, p + Vector(off) + Vector((0, 0, h / 2)), m, radius=r, depth=h, vertices=verts)
    o.rotation_euler = rot
    return o


def cone(name, p, off, r, h, m, verts=16, r2=0.0, rot=(0, 0, 0)):
    o = prim('cone', name, p + Vector(off) + Vector((0, 0, h / 2)), m, radius1=r, radius2=r2, depth=h, vertices=verts)
    o.rotation_euler = rot
    return o


def sph(name, p, off, r, m, scale=(1, 1, 1)):
    o = prim('uv_sphere', name, p + Vector(off), m, radius=r, segments=24, ring_count=12)
    o.scale = scale
    return o


def arch(name, p, off, R, r, m, rot_z=0.0):
    o = prim('torus', name, p + Vector(off), m, major_radius=R, minor_radius=r, major_segments=24, minor_segments=10)
    o.rotation_euler = (math.pi / 2, 0, rot_z)
    return o


def volcano(name, p, s):
    bm = bmesh.new()
    prof = [(0, 4.6), (0.8, 3.7), (2.2, 2.5), (3.8, 1.45), (4.6, 1.1), (4.75, 0.95)]
    rings = [[bm.verts.new(p + Vector((math.cos(a) * r * s, math.sin(a) * r * s, z * s))) for a in [i / 40 * 2 * math.pi for i in range(40)]] for z, r in prof]
    for r0, r1 in zip(rings, rings[1:]):
        for i in range(40):
            bm.faces.new((r0[i], r0[(i + 1) % 40], r1[(i + 1) % 40], r1[i]))
    objs = [mesh_obj(name, bm, MATS['volcano'])]
    objs.append(cyl(name + '-lava', p, (0, 0, 4.45 * s), 0.95 * s, 0.3 * s, MATS['lava'], 32))
    for i in range(5):
        a = math.pi * (1.15 + i * 0.17)
        pts = [p + Vector((math.cos(a) * (1.05 + t * 3.4) * s, math.sin(a) * (1.05 + t * 3.4) * s, (4.6 - t * 4.4 + 0.1) * s)) for t in [j / 8 for j in range(9)]]
        objs.append(curve_obj(f'{name}-flow-{i}', pts, MATS['lava'], 0.16 * s))
    return objs


def landmark(lid, p, rnd):
    """A little diorama of each named place in a realm, so the map shows what's there."""
    M, o = MATS, []
    if lid == 'mausoleums':      # two stone crypts with pitched roofs
        for i, (dx, dy) in enumerate([(-0.9, 0.2), (0.9, -0.2)]):
            o.append(box(f'{lid}{i}', p, (dx, dy, 0.5), (1.3, 1.0, 1.0), M['crypt']))
            roof = cone(f'{lid}{i}-roof', p, (dx, dy, 1.0), 1.0, 0.8, M['crypt-roof'], 4, rot=(0, 0, math.pi / 4))
            roof.scale = (1.0, 0.8, 1)
            o += [roof, box(f'{lid}{i}-door', p, (dx, dy - 0.51, 0.35), (0.4, 0.05, 0.6), M['dark'], bevel=0)]
    elif lid == 'chapel':        # a chapel sinking into black water
        o.append(cyl(f'{lid}-water', p, (0, 0, 0.02), 2.0, 0.08, M['water'], 32))
        rot = (0.12, -0.1, 0.2)
        o.append(box(f'{lid}-nave', p, (0, 0, 0.55), (1.0, 1.6, 1.1), M['crypt'], rot))
        o.append(cone(f'{lid}-roof', p, (0, 0, 1.05), 0.95, 0.7, M['crypt-roof'], 4, rot=(0.12, -0.1, 0.2 + math.pi / 4)))
        o.append(cyl(f'{lid}-tower', p, (0.1, -0.7, 0.2), 0.3, 1.9, M['crypt'], 8, rot))
        o.append(cone(f'{lid}-spire', p, (0.3, -0.55, 2.0), 0.36, 0.9, M['crypt-roof'], 8, rot=rot))
    elif lid == 'bonefields':    # bones and skulls strewn about
        for i in range(7):
            a, d = rnd() * 6.28, 0.3 + rnd() * 1.4
            q = p + Vector((math.cos(a) * d, math.sin(a) * d, 0.12))
            b = prim('cylinder', f'{lid}-b{i}', q, M['bone'], radius=0.09, depth=1.0, vertices=8)
            b.rotation_euler = (math.pi / 2, 0, rnd() * 6.28)
            o.append(b)
            for e in (-1, 1):
                o.append(sph(f'{lid}-b{i}-{e}', q, (math.cos(b.rotation_euler.z + math.pi / 2) * 0.5 * e, math.sin(b.rotation_euler.z + math.pi / 2) * 0.5 * e, 0), 0.14, M['bone']))
        for i, (dx, dy) in enumerate([(-0.5, 0.2), (0.7, -0.4)]):
            o.append(sph(f'{lid}-skull{i}', p, (dx, dy, 0.35), 0.38, M['bone'], (1, 1, 0.9)))
            for e in (-1, 1):
                o.append(sph(f'{lid}-skull{i}-eye{e}', p, (dx + 0.13 * e, dy - 0.3, 0.42), 0.09, M['dark']))
    elif lid == 'hill':          # a gallows on a bare hill
        o.append(pebble(f'{lid}-mound', p, 1.8, M['hill'], (1.2, 1.2, 0.55), lumpy=0.1))
        o.append(cyl(f'{lid}-post', p, (0, 0, 0.8), 0.1, 2.2, M['deadwood'], 8))
        o.append(box(f'{lid}-beam', p, (0.45, 0, 2.95), (1.1, 0.16, 0.16), M['deadwood']))
        o.append(cyl(f'{lid}-rope', p, (0.9, 0, 2.2), 0.03, 0.7, M['rope'], 6))
    elif lid == 'geode':         # a split boulder full of crystals
        o.append(pebble(f'{lid}-shell', p, 1.5, M['geode'], (1.1, 1.0, 0.8), lumpy=0.12))
        for i in range(7):
            a = -math.pi / 2 + (i - 3) * 0.35
            m = M['crystal-a'] if i % 2 else M['crystal-b']
            c = cone(f'{lid}-c{i}', p, (math.cos(a) * 0.9, math.sin(a) * 0.9 - 0.3, 0.6), 0.28, 1.2 + rnd() * 0.6, m, 6)
            c.rotation_euler = (-0.6, 0, a + math.pi / 2)
            o.append(c)
    elif lid == 'mine':          # a timber-framed mine mouth with a cart on rails
        o.append(pebble(f'{lid}-hill', p, 1.7, M['mound'], (1.2, 1.1, 0.75), lumpy=0.12))
        o.append(box(f'{lid}-mouth', p, (0, -1.2, 0.55), (1.1, 0.3, 1.1), M['dark'], bevel=0))
        for e in (-1, 1):
            o.append(box(f'{lid}-post{e}', p, (0.65 * e, -1.35, 0.6), (0.18, 0.18, 1.2), M['wood-b']))
        o.append(box(f'{lid}-lintel', p, (0, -1.35, 1.25), (1.5, 0.2, 0.2), M['wood-b']))
        for e in (-1, 1):
            o.append(box(f'{lid}-rail{e}', p, (0.28 * e, -2.4, 0.05), (0.08, 2.0, 0.06), M['iron'], bevel=0))
        o.append(box(f'{lid}-cart', p, (0, -2.6, 0.45), (0.8, 0.6, 0.5), M['iron']))
        o.append(sph(f'{lid}-ore', p, (0, -2.6, 0.7), 0.3, M['crystal-b'], (1.2, 0.9, 0.6)))
    elif lid == 'cathedral':     # giant glowing mushrooms
        for i, (dx, dy, h, r) in enumerate([(0, 0, 2.6, 1.1), (-1.0, 0.4, 1.8, 0.8), (0.95, 0.3, 1.5, 0.7)]):
            o.append(cyl(f'{lid}-stem{i}', p, (dx, dy, 0), r * 0.25, h, M['stem'], 12))
            o.append(sph(f'{lid}-cap{i}', p, (dx, dy, h), r, M['shroom-a'] if i != 1 else M['shroom-b'], (1, 1, 0.5)))
    elif lid == 'colossus':      # a stone giant's head half-buried, eyes still glowing
        o.append(sph(f'{lid}-head', p, (0, 0, 0.3), 1.6, M['colossus'], (1, 0.95, 1.0)))
        o.append(box(f'{lid}-brow', p, (0, -1.1, 1.0), (1.8, 0.6, 0.4), M['colossus']))
        for e in (-1, 1):
            o.append(sph(f'{lid}-eye{e}', p, (0.55 * e, -1.35, 0.6), 0.2, M['ember-eye']))
        o.append(box(f'{lid}-nose', p, (0, -1.5, 0.2), (0.4, 0.5, 0.6), M['colossus']))
    elif lid == 'armada':        # ships locked in the ice
        o.append(pebble(f'{lid}-ice', p, 2.0, M['ice-slab'], (1.3, 1.1, 0.25), lumpy=0.08))
        for i, (dx, dy, rz, tilt) in enumerate([(-0.8, 0.3, 0.4, 0.2), (0.9, -0.3, -0.3, -0.15)]):
            hull = box(f'{lid}-hull{i}', p, (dx, dy, 0.55), (1.8, 0.6, 0.55), M['wood-b'], (tilt, 0, rz))
            o += [hull, cyl(f'{lid}-mast{i}', p, (dx, dy, 0.7), 0.06, 2.0, M['wood-a'], 6, (tilt, 0, 0))]
            o.append(box(f'{lid}-sail{i}', p, (dx, dy, 1.9), (0.08, 0.9, 0.8), M['sail'], (tilt, 0, rz)))
    elif lid == 'giant':         # a frozen giant's great sword standing in the snow
        o.append(pebble(f'{lid}-cairn', p, 1.6, M['ice-slab'], (1.5, 1.0, 0.5), lumpy=0.12))
        o.append(box(f'{lid}-blade', p, (0, 0, 1.6), (0.35, 0.1, 2.8), M['steel'], (0, 0.15, 0)))
        o.append(box(f'{lid}-guard', p, (0.22, 0, 3.0), (1.3, 0.2, 0.2), M['iron'], (0, 0.15, 0)))
        o.append(cyl(f'{lid}-hilt', p, (0.27, 0, 3.1), 0.09, 0.8, M['wood-b'], 8, (0, 0.15, 0)))
    elif lid == 'stones':        # a ring of standing stones round an aurora glow
        o.append(cyl(f'{lid}-glow', p, (0, 0, 0.02), 0.9, 0.06, M['aurora'], 32))
        for i in range(7):
            a = i / 7 * 2 * math.pi
            o.append(box(f'{lid}-s{i}', p, (math.cos(a) * 1.4, math.sin(a) * 1.4, 0.65), (0.4, 0.3, 1.3), M['stone'], (0, 0, a)))
    elif lid == 'caves':         # an ice cave mouth
        o.append(pebble(f'{lid}-hill', p, 1.7, M['ice-slab'], (1.2, 1.0, 0.8), lumpy=0.12))
        o.append(arch(f'{lid}-arch', p, (0, -1.2, 0.1), 0.8, 0.28, M['ice']))
        o.append(sph(f'{lid}-hole', p, (0, -1.15, 0.1), 0.62, M['dark'], (1, 0.3, 1)))
    elif lid == 'obsidian':      # a grove of black glass trees
        for i in range(6):
            a, d = i / 6 * 6.28 + rnd(), 0.4 + rnd() * 0.9
            c = cone(f'{lid}-t{i}', p, (math.cos(a) * d, math.sin(a) * d, 0), 0.3, 1.6 + rnd() * 1.2, M['obsidian'], 5)
            c.rotation_euler = ((rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.3, rnd())
            o.append(c)
    elif lid == 'forge':         # the old forge: a stone house, chimney, glowing mouth and anvil
        o.append(box(f'{lid}-house', p, (0, 0.2, 0.6), (1.6, 1.2, 1.2), M['basalt']))
        o.append(cone(f'{lid}-roof', p, (0, 0.2, 1.2), 1.25, 0.7, M['crypt-roof'], 4, rot=(0, 0, math.pi / 4)))
        o.append(cyl(f'{lid}-chimney', p, (0.5, 0.5, 1.0), 0.22, 1.4, M['basalt'], 8))
        o.append(box(f'{lid}-mouth', p, (0, -0.42, 0.4), (0.6, 0.05, 0.5), M['lava'], bevel=0))
        o.append(box(f'{lid}-anvil', p, (-0.9, -0.9, 0.25), (0.6, 0.3, 0.3), M['iron']))
    elif lid == 'vent':          # the Great Vent: a small volcano
        o += volcano('vent', p, 0.55)
    elif lid == 'bridges':       # a lava river with stone arches over it
        pts = [p + Vector((-2.0 + t * 4.0, math.sin(t * 5) * 0.4, 0.05)) for t in [j / 10 for j in range(11)]]
        o.append(curve_obj(f'{lid}-lava', pts, M['lava'], 0.3))
        for i, dx in enumerate((-0.8, 0.9)):
            o.append(arch(f'{lid}-arch{i}', p, (dx, 0, 0), 0.7, 0.2, M['stone'], math.pi / 2))
    return o


def grow(objs, p, k):
    """Scale a finished diorama about its base point (everything was modelled at 1×)."""
    for o in objs:
        o.location = p + (o.location - p) * k
        o.scale = o.scale * k
    return objs


def valley_features(rnd):
    """The valley's own marks: the rune shrines and the courtyard (the realms are reached over the bridges)."""
    M, o = MATS, []
    o.append(cyl('courtyard', world(VC[0], VC[1] + 12), (0, 0, 0.0), 2.3, 0.06, M['paving'], 40))
    for i, (x, z) in enumerate(SHRINES):
        p = world(*valley_px(x, z))
        o += grow([cyl(f'shrine{i}-base', p, (0, 0, 0), 0.55, 0.15, M['stone'], 16),
                   box(f'shrine{i}', p, (0, 0, 0.8), (0.5, 0.36, 1.3), M['stone']),
                   box(f'shrine{i}-rune', p, (0, -0.19, 0.95), (0.28, 0.02, 0.45), M['rune'], bevel=0)], p, 1.6)
    return o


# ---------------------------------------------------------------- towers (one layer per state)
TOWER_AT = {'arcane': (VC[0], VC[1] + 2), **{id: (P['x'], P['y'] + 12) for id, P in PLACE.items()}}


def tower(id, state):
    """The land's tower as a ruin, rising (scaffolded), or restored — the game shows the one
    that matches your progress."""
    M, p, o = MATS, world(*TOWER_AT[id]), []
    rnd = mulberry32(hash(id + state) & 0xffff)
    look = {'arcane': ('tower-stone', 'roof-arcane', 'star'), 'necromancy': ('bone', 'bone', 'ghostglow'),
            'geomancy': ('keep', 'crypt-roof', 'heart'), 'cryomancy': ('ice', 'ice', 'aurora'), 'pyromancy': ('basalt', 'basalt', 'lava')}[id]
    wall, roof, glow = M[look[0]], M[look[1]], M[look[2]]
    if state == 'ruin':
        o.append(cyl('ruin-stump', p, (0, 0, 0), 1.1, 0.7, wall, 10))
        for i in range(7):
            a = rnd() * 6.28
            o.append(pebble(f'ruin-{i}', p + Vector((math.cos(a) * (1.1 + rnd()), math.sin(a) * (1.1 + rnd()), 0.25)), 0.3 + rnd() * 0.3, wall, seed=i))
        return o
    tall = state == 'restored'
    if id == 'arcane':
        o += [cyl('t-base', p, (0, 0, 0), 1.3, 1.0, wall, 20), cyl('t-mid', p, (0, 0, 1.0), 1.05, 2.2 if tall else 1.2, wall, 20)]
        if tall:
            o += [cyl('t-upper', p, (0, 0, 3.2), 0.9, 1.4, wall, 20), arch('t-balcony', p, (0, 0, 3.2), 1.05, 0.1, M['gold']),
                  cone('t-roof', p, (0, 0, 4.6), 1.25, 2.4, roof, 20), sph('t-star', p, (0, 0, 7.2), 0.28, glow)]
            o[-3].rotation_euler = (0, 0, 0)  # the balcony ring lies flat
            for i in range(4):
                a = i / 4 * 6.28
                o.append(box(f't-win{i}', p, (math.cos(a) * 0.9, math.sin(a) * 0.9, 3.9), (0.22, 0.22, 0.4), M['window'], (0, 0, a), 0))
    elif id == 'necromancy':
        o.append(cyl('t-base', p, (0, 0, 0), 1.2, 1.2 if tall else 0.9, wall, 16))
        if tall:
            for i in range(6):   # ribs curling up round the tower
                a = i / 6 * 6.28
                r = arch(f't-rib{i}', p, (math.cos(a) * 0.6, math.sin(a) * 0.6, 1.4), 1.1, 0.1, wall, a + math.pi / 2)
                o.append(r)
            o += [cyl('t-spine', p, (0, 0, 1.2), 0.5, 2.8, wall, 12), sph('t-skull', p, (0, 0, 4.3), 0.75, wall, (1, 1, 0.95))]
            for e in (-1, 1):
                o.append(sph(f't-eye{e}', p, (0.25 * e, -0.62, 4.35), 0.16, glow))
    elif id == 'geomancy':
        o.append(box('t-keep', p, (0, 0, 0.8), (2.2, 2.0, 1.6), wall))
        for i in range(8):
            a = i / 8 * 6.28
            o.append(box(f't-merlon{i}', p, (math.cos(a) * 1.0, math.sin(a) * 0.9, 1.75), (0.35, 0.35, 0.35), wall))
        if tall:
            o += [cyl('t-tower', p, (0, 0, 1.6), 0.7, 2.0, wall, 12), cone('t-roof', p, (0, 0, 3.6), 0.9, 1.0, roof, 12),
                  prim('ico_sphere', 't-heart', p + Vector((0, 0, 4.95)), glow, radius=0.45, subdivisions=1)]
    elif id == 'cryomancy':
        n = 3 if tall else 2
        for i in range(n):
            a = i / 3 * 6.28
            o.append(cone(f't-spire{i}', p, (math.cos(a) * 0.5 * (i > 0), math.sin(a) * 0.5 * (i > 0), 0), 0.9 - i * 0.2, (5.5 if tall else 2.4) - i * 1.4, wall, 6))
        if tall:
            o.append(arch('t-halo', p, (0, 0, 3.5), 0.9, 0.08, glow))
            o[-1].rotation_euler = (0, 0, 0)
    elif id == 'pyromancy':
        o.append(cyl('t-base', p, (0, 0, 0), 1.2, 2.6 if tall else 1.3, wall, 10))
        if tall:
            o += [cyl('t-top', p, (0, 0, 2.6), 1.4, 0.5, wall, 10), arch('t-crown', p, (0, 0, 3.15), 1.05, 0.18, glow),
                  sph('t-core', p, (0, 0, 3.4), 0.5, glow)]
            o[-2].rotation_euler = (0, 0, 0)
    if not tall:   # scaffolding round the unfinished tower
        for i in range(4):
            a = i / 4 * 6.28 + 0.4
            o.append(cyl(f'scaf{i}', p, (math.cos(a) * 1.6, math.sin(a) * 1.6, 0), 0.07, 3.2, M['wood-a'], 6))
        for z in (1.4, 2.8):
            for i in range(4):
                a0, a1 = i / 4 * 6.28 + 0.4, (i + 1) / 4 * 6.28 + 0.4
                q0, q1 = Vector((math.cos(a0) * 1.6, math.sin(a0) * 1.6, z)), Vector((math.cos(a1) * 1.6, math.sin(a1) * 1.6, z))
                o.append(curve_obj(f'scafb{z}-{i}', [p + q0, p + q1], M['wood-a'], 0.06))
    return o


def island(id, L):
    k, rnd = blob_k(L['seed'], L['amp']), mulberry32(L['seed'] * 131 + 17)
    skin, N = SKIN[id], 144
    # Top: a flat fan to the rim.
    bm = bmesh.new()
    c = bm.verts.new(world(L['x'], L['y'], 0))
    ring = [bm.verts.new(world(*rim_px(L, k, i / N * 2 * math.pi, 1.0), 0)) for i in range(N)]
    for i in range(N):
        bm.faces.new((c, ring[i], ring[(i + 1) % N]))
    solid = [mesh_obj(f'top-{id}', bm, top_mat(id))]
    solid.append(band(f'cap-{id}', L, k, CAP, gradient(f'cap-{id}', skin['top'], skin['lip'], 0, -1.1), L['seed'], wob=0.006))
    solid.append(band(f'earth-{id}', L, k, EARTH, gradient(f'earth-{id}', shade(skin['earth'], 1.08), shade(skin['earth'], 0.78), -1.1, -3.3), L['seed'] + 1))
    solid.append(band(f'stone-{id}', L, k, STONE, MATS['stone-band'], L['seed'] + 2))
    solid.append(band(f'deep-{id}', L, k, DEEP, MATS['deep-band'], L['seed'] + 3))
    # Underneath: a tapering core hung with big round boulders.
    solid.append(band(f'core-{id}', L, k, [(-7.4, 0.72), (-9.0, 0.55), (-10.6, 0.34), (-12.0, 0.12), (-12.6, 0.02)], MATS['deep-band'], L['seed'] + 4))
    for j, (cnt, z, f, r) in enumerate([(9, -7.6, 0.66, 1.7), (7, -9.2, 0.5, 1.5), (5, -10.7, 0.32, 1.3), (2, -12.0, 0.14, 1.1)]):
        for q in range(cnt):
            a = q / cnt * 2 * math.pi + rnd() * 0.4
            solid.append(pebble(f'under-{id}-{j}-{q}', world(*rim_px(L, k, a, f), z + (rnd() - 0.5) * 0.6), r * (0.8 + rnd() * 0.4), MATS['under-rock'],
                                (1, 1, 0.8), (rnd(), rnd(), rnd()), seed=q + j * 10))
    # Round grey stones sitting on the rim.
    for q in range(18):
        a = rnd() * 2 * math.pi
        solid.append(pebble(f'rim-{id}-{q}', world(*rim_px(L, k, a, 1.0 + rnd() * 0.03), 0.1), 0.45 + rnd() * 0.55, MATS['rim-rock'],
                            (1.2, 1, 0.8), (0, 0, rnd() * 3), seed=q + 40))
    # A few chunks drifting free beside the island.
    for q in range(8):
        a = math.pi * (0.1 + rnd() * 0.8) if q < 5 else rnd() * 2 * math.pi
        solid.append(pebble(f'drift-{id}-{q}', world(*rim_px(L, k, a, 1.15 + rnd() * 0.2), -2 - rnd() * 6), 0.4 + rnd() * 0.6,
                            MATS['under-rock'], (1, 1, 0.8), (rnd(), rnd(), rnd()), seed=q + 70))
    solid += props(id, L, k, rnd)
    if id == 'arcane':
        solid += valley_features(rnd)
    else:
        for (lx, lz), lid in zip(REALM_LANDMARKS[id], LANDMARK_IDS[id]):
            q = world(*realm_px(id, lx, lz))
            solid += grow(landmark(lid, q, rnd), q, 1.8)  # big enough to read at map size
    # Rift cracks: jagged glowing seams down the face you can see, and along the lip's underside.
    veins = []
    for v in range(20):
        a = math.pi * (0.04 + rnd() * 0.92)
        pts, z = [], -0.9
        while z > -7.2:
            a += (rnd() - 0.5) * 0.08
            pts.append(world(*rim_px(L, k, a, face_f(z) + 0.012), z))
            z -= 0.45 + rnd() * 0.6
        veins.append(curve_obj(f'crack-{id}-{v}', pts, MATS['vein'], 0.13))
    for v in range(8):
        a0 = rnd() * 2 * math.pi
        pts = [world(*rim_px(L, k, a0 + j * 0.05, 1.052), -0.72 + (rnd() - 0.5) * 0.2) for j in range(10)]
        veins.append(curve_obj(f'lipcrack-{id}-{v}', pts, MATS['vein'], 0.12))
    return solid, veins


# ---------------------------------------------------------------- bridges
def ell_edge(L, ux, uy):
    return 1.1 / math.hypot(ux / (L['r'] * L['sx']), uy / (L['r'] * L['sy']))


def bridge(a, b, broken, seed):
    """A rope-and-plank bridge along the same curve the SVG uses."""
    A, B = LANDS[a], LANDS[b]
    rnd = mulberry32(seed)
    mx, my = (A['x'] + B['x']) / 2, (A['y'] + B['y']) / 2
    ox, oy = mx - VC[0], my - VC[1]
    ol = math.hypot(ox, oy) or 1
    bow = 70 if a != 'arcane' else 0
    cx, cy = mx + ox / ol * bow, my + oy / ol * bow
    S = 400
    P = [((1 - t) ** 2 * A['x'] + 2 * (1 - t) * t * cx + t * t * B['x'], (1 - t) ** 2 * A['y'] + 2 * (1 - t) * t * cy + t * t * B['y']) for t in [i / S for i in range(S + 1)]]
    arc = [0.0]
    for i in range(1, S + 1):
        arc.append(arc[-1] + math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]))
    ch = math.hypot(B['x'] - A['x'], B['y'] - A['y'])
    ux, uy = (B['x'] - A['x']) / ch, (B['y'] - A['y']) / ch
    ra, rb = ell_edge(A, ux, uy), ell_edge(B, ux, uy)
    vis = max(20, arc[-1] - ra - rb)
    g0, g1 = ra + vis * 0.35, ra + vis * 0.65
    # Only the stretch between the rims (plus a margin under each island) needs building.
    lo, hi = max(0, ra - 30), min(arc[-1], arc[-1] - rb + 30)

    def at(s):
        i = min(S, max(0, next((j for j in range(S + 1) if arc[j] >= s), S)))
        j0, j1 = max(0, i - 1), min(S, i + 1)
        tx, ty = P[j1][0] - P[j0][0], P[j1][1] - P[j0][1]
        tl = math.hypot(tx, ty) or 1
        return P[i], (tx / tl, ty / tl)

    # The deck sags a little toward the middle, like a real rope bridge.
    sag = lambda s: -0.45 - 0.9 * math.sin(math.pi * min(1, max(0, (s - ra) / vis)))
    objs, s, n = [], lo, 0
    posts = {1: [], -1: []}
    while s < hi:
        (px, py), (tx, ty) = at(s)
        nx, ny = -ty, tx
        gone = broken and g0 < s < g1
        if not gone:
            p = world(px, py, sag(s))
            plank = prim('cube', f'plank-{n}', p, MATS['wood-a'] if n % 3 else MATS['wood-b'], size=1)
            ang = math.atan2(world(px + nx, py + ny).y - p.y, world(px + nx, py + ny).x - p.x)
            plank.scale = (3.0 + (rnd() - 0.5) * 0.2, 0.42, 0.14)
            plank.rotation_euler = ((rnd() - 0.5) * 0.06, (rnd() - 0.5) * 0.06, ang)
            bev = plank.modifiers.new('b', 'BEVEL'); bev.width = 0.05; bev.segments = 2
            objs.append(plank)
            if n % 5 == 0:
                for sgn in (1, -1):
                    q = world(px + nx * 15.5 * sgn, py + ny * 15.5 * sgn, sag(s))
                    objs.append(prim('cylinder', f'post-{n}-{sgn}', q + Vector((0, 0, 0.45)), MATS['wood-b'], radius=0.1, depth=1.0, vertices=8))
                    posts[sgn].append((s, q + Vector((0, 0, 0.85))))
        elif broken and abs(s - g0) < 7 or broken and abs(s - g1) < 7:
            # A couple of planks hanging off the broken ends.
            p = world(px, py, sag(s) - 1.2 - rnd())
            plank = prim('cube', f'dangle-{n}', p, MATS['wood-b'], size=1)
            plank.scale = (0.42, 2.2, 0.14)
            plank.rotation_euler = (1.2 + rnd() * 0.3, rnd() * 0.4, math.atan2(ty, tx))
            objs.append(plank)
        s += 5.2
        n += 1
    # Rope rails through the post tops, sagging between posts; cut at the break.
    for sgn in (1, -1):
        pts = posts[sgn]
        runs, cur = [], [pts[0]] if pts else []
        for p0, p1 in zip(pts, pts[1:]):
            if broken and p0[0] < g0 < p1[0]:
                runs.append(cur); cur = [p1]
            else:
                cur.append(p1)
        if cur:
            runs.append(cur)
        for r_i, run in enumerate(runs):
            if len(run) < 2:
                continue
            line = []
            for (s0, q0), (s1, q1) in zip(run, run[1:]):
                for t in [j / 6 for j in range(6)]:
                    line.append(q0.lerp(q1, t) - Vector((0, 0, 0.25 * math.sin(math.pi * t))))
            line.append(run[-1][1])
            objs.append(curve_obj(f'rope-{sgn}-{r_i}', line, MATS['rope'], 0.06))
    return objs


# ---------------------------------------------------------------- render passes
def render(sc, path, show, holdout=()):
    for o in sc.objects:
        if o.type in ('CAMERA', 'LIGHT'):
            continue
        o.hide_render = o not in show and o not in holdout
        o.is_holdout = o in holdout
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('wrote', os.path.relpath(path, ROOT))


def materials():
    flat('trunk', '#8a5a34')
    flat('leaf', '#4fae3a', 0.7)
    flat('leaf-hi', '#7fd24e', 0.7)
    flat('grave', '#b8b6c8', 0.6)
    flat('deadwood', '#5e4b44', 0.9)
    flat('ghostglow', '#9dffc0', 0.5, '#7dffa8', 2.5)
    flat('mound', '#b98450', 0.85)
    flat('crystal-a', '#b77cff', 0.25, '#a060ff', 0.8)
    flat('crystal-b', '#78dcff', 0.25, '#50c8ff', 0.8)
    flat('pine', '#2f7a5a', 0.8)
    flat('snowcap', '#ffffff', 0.6)
    flat('ice', '#c8f2ff', 0.2, '#9fe6ff', 0.35)
    gradient('volcano', '#7a3e2c', '#4a2a22', 4.6, 0.0, 0.9)
    flat('lava', '#ff6a10', 0.4, '#ff5a00', 1.4)
    flat('lava-dim', '#d8480f', 0.5, '#ff4a00', 0.9)
    flat('basalt', '#3e3432', 0.8)
    flat('wood-a', '#b07a45', 0.8)
    flat('wood-b', '#8d5d33', 0.8)
    flat('rope', '#e0c690', 0.9)
    gradient('stone-band', '#a39a94', '#7c726c', -3.3, -5.7)
    gradient('deep-band', '#6f6460', '#433a38', -5.6, -12.0)
    gradient('under-rock', '#7c716c', '#3e3534', -6.0, -13.0, 0.85)
    flat('rim-rock', '#8f8c99', 0.7)
    flat('crypt', '#a9a4b8', 0.7)
    flat('crypt-roof', '#5b5670', 0.7)
    flat('dark', '#1d1622', 0.9)
    flat('water', '#2f5a78', 0.15)
    flat('bone', '#efe7d2', 0.55)
    flat('hill', '#6f8a6f', 0.85)
    flat('geode', '#6c5a70', 0.8)
    flat('iron', '#5d6068', 0.45)
    flat('stem', '#efe3cf', 0.7)
    flat('shroom-a', '#5fd8c0', 0.5, '#3fe8c8', 0.9)
    flat('shroom-b', '#c07cff', 0.5, '#a860ff', 0.9)
    flat('colossus', '#8f8a80', 0.85)
    flat('ember-eye', '#ffb040', 0.4, '#ff9a20', 5.0)
    flat('ice-slab', '#dff2ff', 0.35)
    flat('sail', '#f2ebdc', 0.8)
    flat('steel', '#c9d4e0', 0.25)
    flat('aurora', '#5fffd0', 0.4, '#3fffc0', 3.0)
    flat('stone', '#9a97a8', 0.75)
    flat('obsidian', '#231a2c', 0.08)
    flat('paving', '#d9ccb2', 0.8)
    flat('rune', '#8fe8ff', 0.3, '#6fd8ff', 4.0)
    flat('gate', '#8d7ac0', 0.6)
    flat('tower-stone', '#ece2cf', 0.7)
    flat('roof-arcane', '#7a55d8', 0.5)
    flat('star', '#ffd86b', 0.3, '#ffcf40', 6.0)
    flat('gold', '#e6b84a', 0.35)
    flat('window', '#ffe6a0', 0.4, '#ffd070', 3.0)
    flat('keep', '#a8886a', 0.8)
    flat('heart', '#ff8a3c', 0.3, '#ff6a20', 4.0)
    emit_mat()


def main():
    os.makedirs(OUT, exist_ok=True)
    sc = reset()
    materials()
    solids, veins = {}, {}
    for id, L in LANDS.items():
        solids[id], veins[id] = island(id, L)
    solid = set(sum(solids.values(), []))
    render(sc, os.path.join(OUT, 'base.webp'), solid)
    for id in LANDS:
        render(sc, os.path.join(OUT, f'energy-{id}.webp'), set(veins[id]), holdout=solid)
    for id in LANDS:
        for state in ('ruin', 'rising', 'restored'):
            objs = tower(id, state)
            render(sc, os.path.join(OUT, f'tower-{id}-{state}.webp'), set(objs))
            for o in objs:
                bpy.data.objects.remove(o, do_unlink=True)
    for n, (a, b) in enumerate(BRIDGES):
        for broken in (False, True):
            objs = bridge(a, b, broken, 500 + n)
            render(sc, os.path.join(OUT, f'bridge-{a}-{b}{"-broken" if broken else ""}.webp'), set(objs))
            for o in objs:
                bpy.data.objects.remove(o, do_unlink=True)


main()
