"""Shared Blender modelling kit for the character/creature build (build_characters.py).

The helpers are the ones build_bosses.py / build_deep.py use (copied verbatim from
build_bosses.py so those scripts stay untouched): primitives, voxel-remesh sculpting, sweeps,
lathed garments, publish(). Added here: fuse_paint(), which fuses primitives into one smooth
surface and colours each face after the primitive it came from.

Conventions: Z up, front faces -Y (+Z in three.js after the Y-up glTF export); metres.
"""
import bpy, bmesh, math, os, random
import numpy as np
from mathutils import Vector, Matrix, noise
from mathutils.bvhtree import BVHTree

scene = bpy.context.scene

def srgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return (*lin, 1.0)


MATS = {}


def mat(name, color, rough=0.6, metal=0.0, emit=None, strength=0.0, alpha=1.0):
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
    if alpha < 1.0:
        b.inputs['Alpha'].default_value = alpha
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            m.blend_method = 'BLEND'
    MATS[name] = m
    return m



# ---------------------------------------------------------------- helpers (as build_deep.py)
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


def flat(o):
    select_only(o)
    bpy.ops.object.shade_flat()


def assign(o, m):
    o.data.materials.clear()
    o.data.materials.append(m)
    return o


def apply_tf(o):
    select_only(o)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return o


def sphere(r, loc, scale=(1, 1, 1), segs=24, m=None, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=segs, ring_count=max(3, segs // 2), rotation=rot)
    o = active()
    o.scale = scale
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if m:
        assign(o, m)
    return o


def ico(r, loc, subdiv=2, scale=(1, 1, 1), m=None, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_ico_sphere_add(radius=r, location=loc, subdivisions=subdiv, rotation=rot)
    o = active()
    o.scale = scale
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if m:
        assign(o, m)
    return o


def cyl(r, depth, loc, rot=(0, 0, 0), verts=24, r2=None, m=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, vertices=verts, location=loc, rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=depth, vertices=verts, location=loc, rotation=rot)
    o = active()
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if m:
        assign(o, m)
    return o


def box(size, loc, rot=(0, 0, 0), m=None, bevel=0.03, segs=3):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = active()
    o.scale = size
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if bevel:
        mod = o.modifiers.new('bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = segs
        apply_mod(o, mod)
    if m:
        assign(o, m)
    return o


def torus(R, r, loc, rot=(0, 0, 0), m=None, seg=32, minor=10):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, location=loc, rotation=rot, major_segments=seg, minor_segments=minor)
    o = active()
    if m:
        assign(o, m)
    return o


def mesh_obj(bm, name='mesh', m=None):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    if m:
        assign(o, m)
    return o


def lathe(profile, m, segs=32, loc=(0, 0, 0), split=None, m2=None, shade=50, rot=(0, 0, 0)):
    """Revolve (r, z) profile about Z. Bands from profile index `split` on get material m2."""
    me = bpy.data.meshes.new('lathe')
    bm = bmesh.new()
    rings = []
    for (r, z) in profile:
        rings.append([bm.verts.new((math.cos(i / segs * math.tau) * r, math.sin(i / segs * math.tau) * r, z)) for i in range(segs)])
    for k in range(len(rings) - 1):
        for i in range(segs):
            j = (i + 1) % segs
            f = bm.faces.new((rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]))
            f.material_index = 1 if (split is not None and k >= split) else 0
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new('lathe', me)
    scene.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = rot
    apply_tf(o)
    me.materials.append(m)
    if m2:
        me.materials.append(m2)
    if shade:
        smooth(o, shade)
    return o


def join(objs, name=None):
    # Joining keeps only the UV maps the first object has, so give every piece one: strips that
    # carry real UVs (patterned trims) then survive into the joined mesh.
    for o in objs:
        if o.type == 'MESH' and not o.data.uv_layers:
            o.data.uv_layers.new(name='UVMap')
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = active()
    apply_tf(o)  # mesh coordinates == world coordinates from here on
    if name:
        o.name = name
        o.data.name = name
    return o


def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def decimate(o, target):
    t = tris(o)
    if t > target:
        dec = o.modifiers.new('dec', 'DECIMATE')
        dec.ratio = target / t
        apply_mod(o, dec)
    return o


def remesh(o, voxel):
    mod = o.modifiers.new('remesh', 'REMESH')
    mod.mode = 'VOXEL'
    mod.voxel_size = voxel
    mod.adaptivity = 0.0
    apply_mod(o, mod)


def laplace(o, factor=0.6, iterations=4):
    lap = o.modifiers.new('smooth', 'SMOOTH')
    lap.factor = factor
    lap.iterations = iterations
    apply_mod(o, lap)


def rough(o, amp, freq=1.0, octaves=3, seed=0):
    """Push every vertex along its normal by fractal Perlin noise (weathered stone)."""
    me = o.data
    n = len(me.vertices)
    co = np.empty(n * 3)
    nr = np.empty(n * 3)
    me.vertices.foreach_get('co', co)
    me.vertices.foreach_get('normal', nr)
    co = co.reshape(-1, 3)
    nr = nr.reshape(-1, 3)
    off = Vector((seed * 17.3 + 3.1, seed * 5.9 + 1.7, seed * 11.1 + 7.3))
    d = np.empty(n)
    for i in range(n):
        p = Vector(co[i]) * freq + off
        s, a, f, tot = 0.0, 1.0, 1.0, 0.0
        for _ in range(octaves):
            s += noise.noise(p * f) * a
            tot += a
            a *= 0.5
            f *= 2.03
        d[i] = s / tot
    co += nr * (d[:, None] * amp)
    me.vertices.foreach_set('co', co.ravel())
    me.update()


def carve(o, cutters, transfer=False):
    """Boolean-subtract each cutter from o, then delete the cutters."""
    for c in cutters:
        mod = o.modifiers.new('cut', 'BOOLEAN')
        mod.operation = 'DIFFERENCE'
        mod.object = c
        if transfer:
            mod.material_mode = 'TRANSFER'
        apply_mod(o, mod)
        bpy.data.objects.remove(c, do_unlink=True)
    return o


def cut_plane(o, co, no):
    """Slice away everything on the +no side of the plane and cap the hole."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co, plane_no=no, clear_outer=True)
    edges = [e for e in bm.edges if e.is_boundary]
    if edges:
        bmesh.ops.holes_fill(bm, edges=edges, sides=0)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(o.data)
    bm.free()
    o.data.update()
    return o


def sculpt(objs, voxel, m, target=None, amp=0.0, freq=1.0, octaves=3, seed=0, it=4, factor=0.6,
           angle=60, cutters=None, floor=None, flat_shade=False):
    """fuse(): voxel-remesh overlapping primitives into one surface, weather it, carve, decimate."""
    o = join(objs)
    remesh(o, voxel)
    if amp:
        rough(o, amp, freq, octaves, seed)
    if it:
        laplace(o, factor, it)
    if floor is not None:
        cut_plane(o, (0, 0, floor), (0, 0, -1))
    if cutters:
        carve(o, cutters)
    if target:
        decimate(o, target)
    assign(o, m)
    if flat_shade:
        flat(o)
    else:
        smooth(o, angle)
    return o


def fuse(objs, voxel, m, target_tris=None, flat=False):
    return sculpt(objs, voxel, m, target_tris, flat_shade=flat)


def paint(o, m, fn):
    """Assign material m to every face whose (centre, normal) passes fn."""
    me = o.data
    names = [x.name if x else '' for x in me.materials]
    if m.name not in names:
        me.materials.append(m)
        names.append(m.name)
    idx = names.index(m.name)
    n = 0
    for p in me.polygons:
        if fn(p.center, p.normal):
            p.material_index = idx
            n += 1
    return n


def bvh(o):
    bm = bmesh.new()
    bm.from_mesh(o.data)
    t = BVHTree.FromBMesh(bm)
    bm.free()
    return t


def spline(ctrl, n):
    """Catmull-Rom through control points, n samples."""
    P = [Vector(c) for c in ctrl]
    P = [P[0] * 2 - P[1]] + P + [P[-1] * 2 - P[-2]]
    out = []
    segs = len(P) - 3
    for s in range(n):
        u = s / (n - 1) * segs
        k = min(int(u), segs - 1)
        t = u - k
        p0, p1, p2, p3 = P[k], P[k + 1], P[k + 2], P[k + 3]
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t))
    return out


def sweep(pts, radii, m=None, segs=8, cap=True, squash=1.0, twist=0.0):
    """Tube along a point path (parallel-transport frames). radii: float or per-point list."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    rad = radii if isinstance(radii, (list, tuple)) else [radii] * n
    bm = bmesh.new()
    tans = [(pts[min(n - 1, i + 1)] - pts[max(0, i - 1)]).normalized() for i in range(n)]
    up = Vector((0, 0, 1)) if abs(tans[0].z) < 0.9 else Vector((1, 0, 0))
    nrm = tans[0].cross(up).normalized()
    prev = tans[0]
    rings = []
    for i in range(n):
        t = tans[i]
        nrm = prev.rotation_difference(t) @ nrm
        prev = t
        bi = t.cross(nrm).normalized()
        ring = []
        for k in range(segs):
            a = k / segs * math.tau + twist * i
            ring.append(bm.verts.new(pts[i] + (nrm * math.cos(a) + bi * math.sin(a) * squash) * rad[i]))
        rings.append(ring)
    for i in range(n - 1):
        for k in range(segs):
            j = (k + 1) % segs
            bm.faces.new((rings[i][k], rings[i][j], rings[i + 1][j], rings[i + 1][k]))
    if cap:
        bm.faces.new(rings[0][::-1])
        bm.faces.new(rings[-1])
    o = mesh_obj(bm, 'sweep', m)
    return o


def crystal(base, d, L, r, m, sides=6, tip=0.3, base_r=0.8, double=False, jitter=0.18, roll=None):
    """A cut crystal point: faceted prism with a pyramid tip, flat shaded, aimed along d."""
    d = Vector(d).normalized()
    roll = random.random() * math.tau if roll is None else roll
    rs = [r * (1 + random.uniform(-jitter, jitter)) for _ in range(sides)]
    bm = bmesh.new()

    def ring(z, s):
        return [bm.verts.new((math.cos(roll + i / sides * math.tau) * rs[i] * s, math.sin(roll + i / sides * math.tau) * rs[i] * s, z)) for i in range(sides)]

    off = Vector((random.uniform(-0.15, 0.15) * r, random.uniform(-0.15, 0.15) * r, 0))
    if double:
        a0 = bm.verts.new((0, 0, 0))
        r0 = ring(L * tip, 1.0)
        r1 = ring(L * (1 - tip), 1.0)
        a1 = bm.verts.new(Vector((0, 0, L)) + off)
        for i in range(sides):
            j = (i + 1) % sides
            bm.faces.new((a0, r0[j], r0[i]))
            bm.faces.new((r0[i], r0[j], r1[j], r1[i]))
            bm.faces.new((r1[i], r1[j], a1))
    else:
        r0 = ring(0, base_r)
        r1 = ring(L * (1 - tip), 1.0)
        a1 = bm.verts.new(Vector((0, 0, L)) + off)
        bm.faces.new(r0[::-1])
        for i in range(sides):
            j = (i + 1) % sides
            bm.faces.new((r0[i], r0[j], r1[j], r1[i]))
            bm.faces.new((r1[i], r1[j], a1))
    o = mesh_obj(bm, 'crystal', m)
    o.matrix_world = Matrix.Translation(Vector(base)) @ Vector((0, 0, 1)).rotation_difference(d).to_matrix().to_4x4()
    apply_tf(o)
    flat(o)
    return o


def on_ellipsoid(c, rad, n, rmin, rmax, zmin=-1.0, segs=12, squash=(0.8, 1.2)):
    out = []
    while len(out) < n:
        v = Vector([random.gauss(0, 1) for _ in range(3)]).normalized()
        if v.z < zmin:
            continue
        p = Vector(c) + Vector((v.x * rad[0], v.y * rad[1], v.z * rad[2]))
        s = tuple(random.uniform(*squash) for _ in range(3))
        out.append(sphere(random.uniform(rmin, rmax), tuple(p), s, segs))
    return out


def chain(pts, r0, r1, step=None, segs=12, scale=(1, 1, 1)):
    """Spheres along a smooth path, radius r0 → r1 (fused later into a limb/strand)."""
    path = spline(pts, 40)
    L = sum((path[i + 1] - path[i]).length for i in range(len(path) - 1))
    step = step or min(r0, r1) * 0.5
    n = max(2, int(L / step))
    dense = spline(pts, n)
    return [sphere(r0 + (r1 - r0) * i / (n - 1), tuple(p), scale, segs) for i, p in enumerate(dense)]


def surface_groove(target, pts2d, r, front=-1, depth=0.35):
    """Cutter tube that follows a (x, z) polyline projected onto the target's front surface."""
    tree = bvh(target)
    path = spline([(x, 0, z) for x, z in pts2d], max(8, int(sum(math.dist(pts2d[i], pts2d[i + 1]) for i in range(len(pts2d) - 1)) / (r * 0.6))))
    balls = []
    for p in path:
        hit = tree.ray_cast(Vector((p.x, front * 100, p.z)), Vector((0, -front, 0)))
        if hit[0] is None:
            continue
        loc, nrm = hit[0], hit[1]
        balls.append(sphere(r, tuple(loc - nrm * r * depth), segs=10))
    if not balls:
        return None
    c = join(balls)
    remesh(c, r / 2.5)
    return c


def slab(size, loc, rot=(0, 0, 0), m=None, cuts=3, jit=0.03, bevel=0.025):
    """A hewn stone slab: subdivided box with jittered corners and chamfered edges."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    if isinstance(cuts, tuple):
        for axis, n in enumerate(cuts):  # subdivide only edges running along each axis
            if n:
                es = [e for e in bm.edges if abs((e.verts[0].co - e.verts[1].co)[axis]) > 1e-6]
                bmesh.ops.subdivide_edges(bm, edges=es, cuts=n, use_grid_fill=True)
    elif cuts:
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
    for v in bm.verts:
        v.co.x *= size[0]
        v.co.y *= size[1]
        v.co.z *= size[2]
        v.co += Vector([random.uniform(-jit, jit) * s for s in size]) * 0.5
    o = mesh_obj(bm, 'slab', m)
    if bevel:
        mod = o.modifiers.new('bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = 1
        mod.limit_method = 'ANGLE'
        apply_mod(o, mod)
    o.rotation_euler = rot
    o.location = loc
    apply_tf(o)
    return o


LAYOUT = {'x': 0.0}


def publish(objs, name, origin=(0, 0, 0), ground=False):
    """Join, tidy material slots and set the origin. ground=True puts the origin under the
    piece at its lowest point (floating pieces: robe tatters, ribbons, ghost tails)."""
    objs = [o for o in objs if o is not None]
    o = join(objs, name) if len(objs) > 1 else objs[0]
    if ground:
        zmin = min(v.co.z for v in o.data.vertices)
        origin = (origin[0], origin[1], zmin)
    o.name = name
    o.data.name = name
    # Boolean cutters without a material leave empty slots, and joins can duplicate slots:
    # remap every face to the first slot holding its material, then drop the rest.
    mats = list(o.data.materials)
    valid = [m for m in mats if m]
    first = {}
    remap = []
    for i, m in enumerate(mats):
        m = m or valid[0]
        first.setdefault(m.name, (len(first), m))
        remap.append(first[m.name][0])
    idx = [0] * len(o.data.polygons)
    o.data.polygons.foreach_get('material_index', idx)
    o.data.materials.clear()
    for k, m in sorted(first.values(), key=lambda t: t[0]):
        o.data.materials.append(m)
    o.data.polygons.foreach_set('material_index', [remap[i] if i < len(remap) else 0 for i in idx])
    bpy.context.scene.cursor.location = origin
    select_only(o)
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    w = o.dimensions.x
    LAYOUT['x'] += w / 2 + 1.0
    o.location = (LAYOUT['x'], 0, 0)
    LAYOUT['x'] += w / 2 + 1.0
    print('PROP', name, tris(o), 'tris', tuple(round(d, 2) for d in o.dimensions))
    return o



def bend(o, R):
    """Curl a flat slab (lying in XY, facing +Z) over a cylinder of radius R about the Y axis."""
    for v in o.data.vertices:
        x, z = v.co.x, v.co.z
        th = x / R
        rr = R + z
        v.co.x = rr * math.sin(th)
        v.co.z = rr * math.cos(th) - R
    o.data.update()


# ---------------------------------------------------------------- materials
# Emission strengths stay at 2-3: stronger values wash out to white under the game's ACES mapping.
L_ROBE = lambda: mat('lichRobe', '#1e2a24', 0.9)
SOUL = lambda: mat('soulGlow', '#b8ffcc', 0.4, 0, '#5dff8a', 2.5)
BONE = lambda: mat('lichBone', '#e9e0c8', 0.7)
L_CROWN = lambda: mat('lichCrown', '#3a3444', 0.55, 0.2)
PHYL = lambda: mat('phylGlass', '#b8ffcc', 0.05, 0, '#5dff8a', 2.0, alpha=0.45)
Q_SKIN = lambda: mat('queenSkin', '#cfe6ff', 0.55)
Q_HAIR = lambda: mat('queenHair', '#f2f6ff', 0.6)
ICE = lambda: mat('iceGown', '#bfe9ff', 0.12, 0, '#3fa8e8', 0.5)
ICE_SHARD = lambda: mat('iceShard', '#86cdf5', 0.1, 0, '#3fa8e8', 0.6)
ICE_GLOW = lambda: mat('iceGlow', '#e8faff', 0.2, 0, '#8fe3ff', 2.5)
T_ROCK = lambda: mat('tyrantRock', '#2e2624', 0.9)
LAVA = lambda: mat('lavaCrack', '#ffb347', 0.4, 0, '#ff6a1c', 2.8)
OBSID = lambda: mat('obsidian', '#1a1022', 0.15, 0.1)
RIFT = lambda: mat('riftGlow', '#ff9ae8', 0.4, 0, '#ff4ad8', 2.5)
V_ROBE = lambda: mat('veyraRobe', '#2a1840', 0.75)
V_GOLD = lambda: mat('veyraGold', '#d6a84a', 0.35, 0.8)
V_SKIN = lambda: mat('veyraSkin', '#d8c6dc', 0.6)
V_HAIR = lambda: mat('veyraHair', '#cfc3e6', 0.6)
V_SOCKET = lambda: mat('veyraSocket', '#120a1c', 0.4)
IRON = lambda: mat('wroughtIron', '#2e2a30', 0.5, 0.6)
FLAME = lambda: mat('lanternFlame', '#ffe9a8', 0.4, 0, '#9dffb8', 2.5)
L_GLASS = lambda: mat('lanternGlass', '#dff5e8', 0.05, 0, None, 0, alpha=0.25)
W_STONE = lambda: mat('wardStone', '#8f8a98', 0.85)
W_RUNE = lambda: mat('wardRune', '#d8c8ff', 0.4, 0, '#9b7bff', 2.0)
GHOST = lambda: mat('ghostBody', '#b8ffe8', 0.5)
M_LAMP = lambda: mat('minerLamp', '#ffe0a0', 0.3, 0, '#ffc46a', 2.5)
RUST = lambda: mat('rustIron', '#6a4a3a', 0.8, 0.35)


# ---------------------------------------------------------------- boss helpers
def tatters(n, depth, seed, lo=0.45, sharp=0.8):
    """Hem offset function: n ragged points hanging below the hem, random lengths."""
    rnd = random.Random(seed)
    d = [depth * rnd.uniform(lo, 1.0) for _ in range(n)]
    ph = rnd.random()

    def f(a):
        u = a / math.tau * n + ph
        i = int(math.floor(u)) % n
        fr = u - math.floor(u)
        return -d[i] * (1 - abs(fr - 0.5) * 2) ** sharp
    return f


def garment(prof, m, segs=40, sub=2, hem=None, hem_h=0.5, folds=None, sx=1.0, sy=1.0, thick=0.03,
            arc=None, wob=0.0, seed=0, shade=50, twist=0.0, fold_fall=1.5):
    """Cloth shell lathed about Z from an (r, z) profile listed hem-first. hem(a) drops the bottom
    edge per angle (tatters), fading out over hem_h; folds=(amp, n) ripples the radius (strongest
    at the hem); arc=(a0, a1) leaves the shell open. Solidified inward to `thick`."""
    rows = []
    for k in range(len(prof) - 1):
        for s in range(sub):
            t = s / sub
            rows.append((prof[k][0] + (prof[k + 1][0] - prof[k][0]) * t, prof[k][1] + (prof[k + 1][1] - prof[k][1]) * t))
    rows.append(tuple(prof[-1]))
    z0, z1 = rows[0][1], rows[-1][1]
    closed = arc is None
    angs = [i / segs * math.tau for i in range(segs)] if closed else [arc[0] + (arc[1] - arc[0]) * i / (segs - 1) for i in range(segs)]
    off = Vector((seed * 7.1, seed * 3.3, seed * 1.9))
    bm = bmesh.new()
    grid = []
    for (r, z) in rows:
        t = (z - z0) / max(1e-6, z1 - z0)
        ring = []
        for a in angs:
            rr = r
            if folds:
                amp, n = folds
                rr *= 1 + amp * (1 - t) ** fold_fall * (0.6 * math.sin(n * a + 1.3 * noise.noise(Vector((math.cos(a), math.sin(a), 0)) * 2 + off)) + 0.4 * math.sin(n * 1.7 * a + 0.7))
            if wob:
                rr *= 1 + wob * noise.noise(Vector((math.cos(a) * 1.5, math.sin(a) * 1.5, z * 1.5)) + off)
            dz = hem(a) * max(0.0, 1 - (z - z0) / hem_h) if hem else 0.0
            aa = a + twist * (1 - t)
            ring.append(bm.verts.new((math.cos(aa) * rr * sx, math.sin(aa) * rr * sy, z + dz)))
        grid.append(ring)
    n = len(angs)
    for k in range(len(grid) - 1):
        for i in range(n if closed else n - 1):
            j = (i + 1) % n
            bm.faces.new((grid[k][i], grid[k][j], grid[k + 1][j], grid[k + 1][i]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    me = bpy.data.meshes.new('garment')
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new('garment', me)
    scene.collection.objects.link(o)
    if thick:
        sol = o.modifiers.new('sol', 'SOLIDIFY')
        sol.thickness = thick
        sol.offset = -1
        sol.use_even_offset = True
        apply_mod(o, sol)
    assign(o, m)
    smooth(o, shade)
    return o


def xform(o, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    o.scale = scale
    o.rotation_euler = rot
    o.location = loc
    return apply_tf(o)


def ragged(loc, scale, seed, amp=0.25):
    """A torn-hole cutter: a noisy ellipsoid."""
    c = ico(1.0, (0, 0, 0), 3)
    rough(c, amp, 2.2, 2, seed)
    return xform(c, loc, (0, 0, 0), scale)



def digit(base, d, curl_axis, lengths, r, curl=0.35, knuckle=1.35):
    """A bony finger: phalanges as sphere chains with knuckle knobs, curling about curl_axis."""
    p = Vector(base)
    d = Vector(d).normalized()
    ax = Vector(curl_axis).normalized()
    out = []
    rr = r
    for k, L in enumerate(lengths):
        q = p + d * L
        out += chain([tuple(p), tuple(q)], rr, rr * 0.8, step=rr * 0.6, segs=8)
        out.append(sphere(rr * knuckle, tuple(p), segs=10))
        p = q
        rr *= 0.82
        d = Matrix.Rotation(curl, 3, ax) @ d
    out.append(sphere(rr * 0.9, tuple(p), (1, 1, 1.3), 8))
    return out




def reset():
    """Empty the scene (call once at the start of a build)."""
    global scene
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    MATS.clear()
    LAYOUT['x'] = 0.0


def fuse_paint(parts, voxel, it=6, factor=0.5, target=None, angle=80, bias=None):
    """Fuse overlapping primitives into ONE smooth, seamless surface (voxel remesh + relax), then
    colour every face with the material of the primitive nearest to it.

    parts: [(obj, material)] — each obj is a mesh already in place. bias: {material name: metres}
    shrinks that material's distance so small features (eyes, teeth, trims) win ties at seams.
    Gives the sculpted-toy look: no seams between limbs and body, crisp colour blocking."""
    bias = bias or {}
    trees = []
    for o, m in parts:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.transform(o.matrix_world)
        trees.append((BVHTree.FromBMesh(bm), m, bias.get(m.name, 0.0)))
        bm.free()
    o = join([p[0] for p in parts])
    remesh(o, voxel)
    if it:
        laplace(o, factor, it)
    if target:
        decimate(o, target)
    me = o.data
    me.materials.clear()
    order = []
    for _, m, _ in trees:
        if m.name not in [x.name for x in order]:
            order.append(m)
    for m in order:
        me.materials.append(m)
    slot = {m.name: i for i, m in enumerate(order)}
    idx = []
    for p in me.polygons:
        c = p.center
        best, bd = 0, 1e9
        for tree, m, b in trees:
            hit = tree.find_nearest(c)
            if hit[0] is None:
                continue
            d = hit[3] - b
            if d < bd:
                bd, best = d, slot[m.name]
        idx.append(best)
    me.polygons.foreach_set('material_index', idx)
    me.update()
    smooth(o, angle)
    return o


def mirror_x(objs):
    """Duplicates of objs mirrored across X (for symmetric limbs, ears, eyes...)."""
    out = []
    for o in objs:
        n = o.copy()
        n.data = o.data.copy()
        scene.collection.objects.link(n)
        n.scale = (-1, 1, 1)
        apply_tf(n)
        bm = bmesh.new()
        bm.from_mesh(n.data)
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
        bm.to_mesh(n.data)
        bm.free()
        out.append(n)
    return out


def export(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True, export_materials='EXPORT')
    print('EXPORTED', path)
