"""Builds the Guardians library (the four elemental bosses, the final boss and the haunt
encounter props) and exports it as one glTF binary.

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/build_bosses.py

Same conventions as build_deep.py / build_sanctums.py: organic forms are blocked out from
overlapping primitives and fused with a voxel remesh (fuse / sculpt), carved with booleans and
decimated to a game budget. Cloth (robes, gowns, sleeves) is generated as a lathed shell with
folds and a ragged hem, then solidified. Hard-surface pieces are lathed, swept or bevelled.
Front faces -Y (+Z in three.js); units are metres.

Every prop is one joined mesh named after the prop. Origins sit on the floor under the piece,
except floating pieces (origin at their lowest point), arms (origin at the shoulder pivot,
hanging down -Z, right side +X) and the element orb (origin at its centre).
"""
import bpy, bmesh, math, os, random
import numpy as np
from mathutils import Vector, Matrix, noise
from mathutils.bvhtree import BVHTree

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'assets', 'models', 'bosses.glb')
random.seed(31)

bpy.ops.wm.read_factory_settings(use_empty=True)
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


def crystal_cluster(base, d, n, L, r, m, spread=0.5, sides=6):
    d = Vector(d).normalized()
    out = []
    for i in range(n):
        j = Vector([random.uniform(-spread, spread) for _ in range(3)])
        s = 1.0 if i == 0 else random.uniform(0.45, 0.8)
        out.append(crystal(Vector(base) + j * r * 1.2, (d + j).normalized(), L * s, r * s, m, sides=sides))
    return out



def chunk(size, loc, rot=None):
    """An angular rock block (fused later), randomly canted."""
    rot = rot or tuple(random.uniform(-0.3, 0.3) for _ in range(3))
    return box(size, loc, rot, bevel=0)


def chunks_on(c, rad, n, smin, smax, zmin=-1.0):
    out = []
    while len(out) < n:
        v = Vector([random.gauss(0, 1) for _ in range(3)]).normalized()
        if v.z < zmin:
            continue
        p = Vector(c) + Vector((v.x * rad[0], v.y * rad[1], v.z * rad[2]))
        out.append(ico(random.uniform(smin, smax), tuple(p), 1, tuple(random.uniform(0.7, 1.2) for _ in range(3)),
                       rot=tuple(random.uniform(0, 3) for _ in range(3))))
    return out


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


def skull_parts(s=1.0, loc=(0, 0, 0), jaw_open=0.0):
    """Blocked-out skull (chin at z=0, crown at ~0.25*s, facing -Y) + socket/nose/mouth cutters + eye centres."""
    L = Vector(loc)

    def P(x, y, z):
        return tuple(L + Vector((x, y, z)) * s)

    def S(*v):
        return tuple(x * s for x in v)
    parts = [sphere(0.105 * s, P(0, 0.015, 0.145), (0.92, 1.08, 1.0), 20),     # cranium
             sphere(0.06 * s, P(0, -0.058, 0.075), (1.05, 0.9, 0.95), 16),     # maxilla
             sphere(0.05 * s, P(0, -0.05, 0.022 - jaw_open), (1.05, 1.0, 0.6), 16),   # mandible
             sphere(0.024 * s, P(0, -0.098, 0.014 - jaw_open), (1.1, 0.8, 0.7), 10)]  # chin
    for sx in (1, -1):
        parts.append(sphere(0.03 * s, P(sx * 0.04, -0.086, 0.128), (1.3, 0.9, 0.62), 12))   # brow ridge
        parts.append(sphere(0.028 * s, P(sx * 0.063, -0.06, 0.082), (1.15, 1.35, 0.85), 12))  # cheekbone
        parts.append(box(S(0.022, 0.05, 0.075), P(sx * 0.058, -0.012, 0.045 - jaw_open * 0.5), bevel=0))  # jaw ramus
    cut = []
    eyes = []
    for sx in (1, -1):
        cut.append(sphere(0.03 * s, P(sx * 0.04, -0.108, 0.098), (1.1, 1.0, 0.95), 14))
        eyes.append(Vector(P(sx * 0.04, -0.092, 0.097)))
    cut.append(sphere(0.014 * s, P(0, -0.118, 0.066), (0.8, 1.2, 1.5), 10))
    cut.append(box(S(0.085, 0.06, 0.007 + jaw_open), P(0, -0.108, 0.043 - jaw_open * 0.5), bevel=0))   # mouth line
    for i in range(-3, 4):                                                                              # tooth gaps
        cut.append(box(S(0.0035, 0.03, 0.03), P(i * 0.012, -0.112, 0.043), bevel=0))
    for sx in (1, -1):
        cut.append(sphere(0.03 * s, P(sx * 0.1, -0.02, 0.1), (0.5, 1.0, 1.0), 10))                       # temple hollows
    return parts, cut, eyes


def ribcage(c, rx, ry, h, r, n=6, spine=True):
    """Curved rib sweeps from the spine round to the sternum, plus spine and sternum (fuse later)."""
    c = Vector(c)
    out = []
    for i in range(n):
        u = i / (n - 1)
        z = c.z + h / 2 - u * h
        w = rx * (0.62 + 0.38 * math.sin(math.pi * (0.25 + 0.75 * u)))
        d = ry * (0.7 + 0.3 * math.sin(math.pi * (0.2 + 0.8 * u)))
        tmax = 2.55 if u < 0.7 else 2.2 - (u - 0.7)
        for sx in (1, -1):
            pts = []
            for k in range(9):
                t = 0.1 + (tmax - 0.1) * k / 8
                pts.append((c.x + sx * w * math.sin(t), c.y + d * math.cos(t), z - 0.35 * h / n * (t / tmax) - 0.02 * math.sin(t)))
            out += chain(pts, r, r * 0.8, step=r * 0.7, segs=8)
    if spine:
        out += chain([(c.x, c.y + ry * 0.95, c.z + h / 2 + 0.1), (c.x, c.y + ry * 1.05, c.z), (c.x, c.y + ry * 0.9, c.z - h / 2 - 0.15)], r * 1.5, r * 1.6, step=r, segs=8)
        for k in range(8):
            z = c.z + h / 2 + 0.08 - k * (h + 0.2) / 7
            out.append(sphere(r * 1.9, (c.x, c.y + ry * 1.05, z), (1.2, 1.0, 0.55), 10))
    out += chain([(c.x, c.y - ry * 0.98, c.z + h / 2 - 0.02), (c.x, c.y - ry * 1.0, c.z - h * 0.2)], r * 1.3, r * 1.0, step=r * 0.6, segs=8, scale=(1.5, 0.7, 1))
    return out


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


def crackle(o, freq, width, depth, seed=0, mask=None):
    """Carve a network of cracks into a dense mesh: vertices near the zero set of Perlin noise are
    pushed inward (a V groove). mask(co, n) -> 0..1 weights where cracks may appear."""
    me = o.data
    off = Vector((seed * 13.1 + 2.3, seed * 7.7 + 5.1, seed * 3.9 + 9.7))
    for v in me.vertices:
        p = v.co * freq + off
        f = abs(noise.noise(p) + 0.15 * noise.noise(p * 2.3 + Vector((4, 4, 4))))
        w = width * (mask(v.co, v.normal) if mask else 1.0)
        if f < w:
            k = 1 - f / w
            v.co -= v.normal * depth * k * k * (3 - 2 * k)
    me.update()


def shell(o, inset, m, target):
    """An inward-offset copy of o (the glowing core that shows through carved cracks)."""
    s = o.copy()
    s.data = o.data.copy()
    scene.collection.objects.link(s)
    for v in s.data.vertices:
        v.co -= v.normal * inset
    s.data.update()
    decimate(s, target)
    assign(s, m)
    smooth(s, 60)
    return s


def magma(o, target, core_target, freq, width, depth, inset, seed=0, mask=None, core_m=None):
    """Cracked-rock finish for a remeshed, smoothed mass o: cracks are carved as grooves, then a
    glowing core (an inset copy of the uncarved surface) shows through them. Returns (rock, core)."""
    core_src = dup(o)
    crackle(o, freq, width, depth, seed, mask)
    laplace(o, 0.35, 1)
    decimate(o, target)
    assign(o, T_ROCK())
    smooth(o, 40)
    core = shell(core_src, inset, core_m or LAVA(), core_target)
    bpy.data.objects.remove(core_src, do_unlink=True)
    return o, core


def dup(o):
    c = o.copy()
    c.data = o.data.copy()
    scene.collection.objects.link(c)
    return c


# ================================================================ The Lich King
LICH_SHOULDER = Vector((0.62, -0.02, 2.34))  # where the game mounts lich_arm (mirror for the left)


def lich_body():
    # Robe: tall gaunt column, narrow waist, broad shoulders, ragged floating hem.
    prof = [(0.66, 0.5), (0.58, 0.85), (0.47, 1.25), (0.38, 1.6), (0.4, 1.9), (0.44, 2.15), (0.43, 2.34), (0.3, 2.5), (0.14, 2.62)]
    robe = garment(prof, L_ROBE(), segs=42, sub=2, hem=tatters(12, 0.55, 3), hem_h=0.7, folds=(0.15, 8), sx=1.18, sy=0.82,
                   thick=0.035, wob=0.05, seed=1, fold_fall=0.8)
    # Torn front: a ragged hole over the ribs.
    carve(robe, [ragged((0.02, -0.34, 1.98), (0.25, 0.3, 0.36), 5, 0.3),
                 ragged((-0.1, -0.33, 1.72), (0.12, 0.2, 0.14), 6, 0.3)])
    smooth(robe, 50)
    # Tattered mantle over the shoulders, open at the front.
    mprof = [(0.6, 2.02), (0.58, 2.22), (0.5, 2.42), (0.34, 2.56), (0.18, 2.64)]
    mantle = garment(mprof, L_ROBE(), segs=34, sub=2, hem=tatters(9, 0.28, 8), hem_h=0.35, folds=(0.12, 6), sx=1.08, sy=0.95,
                     thick=0.03, arc=(-math.pi / 2 + 0.75, 3 * math.pi / 2 - 0.75), seed=2)
    # Ribcage, spine and the heart-light.
    rib = sculpt(ribcage((0, -0.02, 1.98), 0.29, 0.22, 0.5, 0.024, n=6), 0.012, BONE(), 1100, it=2, angle=60)
    H = [sphere(0.075, (0.05, -0.05, 2.02), segs=12), sphere(0.075, (-0.05, -0.05, 2.02), segs=12),
         cyl(0.095, 0.15, (0, -0.05, 1.92), (math.pi, 0, 0), 12, r2=0.01)]
    heart = sculpt(H, 0.012, SOUL(), 220, it=2, angle=70)
    # Neck vertebrae up into the hood.
    neck = sculpt(chain([(0, 0.02, 2.4), (0, -0.01, 2.56), (0, -0.05, 2.68)], 0.04, 0.035, step=0.02), 0.012, BONE(), 150, it=1)
    # Skull, pushed forward in the hood.
    sp, sc, eyes = skull_parts(1.55, (0, -0.1, 2.62), jaw_open=0.008)
    skull = sculpt(sp, 0.009, BONE(), 1000, it=2, cutters=sc, angle=55)
    glow = [ico(0.02, tuple(e), 1, m=SOUL()) for e in eyes]
    # Hood: a deep cowl with a face opening.
    hood_parts = [sphere(0.3, (0, 0.0, 2.84), (1.08, 1.15, 1.12), 24),
                  sphere(0.3, (0, 0.08, 2.62), (1.25, 1.1, 0.7), 20),
                  sphere(0.18, (0, 0.2, 3.0), (1.0, 1.1, 1.0), 16)]
    hood = sculpt(hood_parts, 0.02, L_ROBE(), 650, amp=0.02, freq=5, seed=4, it=2, angle=45,
                  cutters=[sphere(0.25, (0, -0.02, 2.84), (1.0, 1.0, 1.04), 20),
                           sphere(0.2, (0, -0.36, 2.8), (1.0, 1.0, 1.4), 20),
                           box((1.0, 1.0, 0.5), (0, 0, 2.3), bevel=0)])
    # Crown of blackened bone spikes around the hood.
    band = lathe([(0.245, 3.0), (0.275, 3.0), (0.285, 3.05), (0.27, 3.1), (0.245, 3.1)], L_CROWN(), 28, shade=35)
    parts = [band]
    n = 9
    for i in range(n):
        a = -math.pi / 2 + i / n * math.tau               # i=0 at the front (-Y)
        c, s = math.cos(a), math.sin(a)
        back = (1 - math.cos(a + math.pi / 2)) / 2        # 0 at the front, 1 at the back
        L = 0.42 - 0.18 * back
        base = Vector((c * 0.26, s * 0.26, 3.06))
        tip = base + Vector((c * 0.11, s * 0.11, L))
        mid = base + Vector((c * 0.02, s * 0.02, L * 0.55))
        parts.append(sweep(spline([base, mid, tip], 7), [0.04, 0.036, 0.03, 0.022, 0.014, 0.007, 0.002], L_CROWN(), segs=6))
        parts.append(sphere(0.03, tuple(base + Vector((0, 0, L * 0.3))), segs=8, m=L_CROWN()))
    gem = crystal((0, -0.29, 3.05), (0, -1, 0.1), 0.06, 0.035, SOUL(), sides=6, tip=0.5, double=True, jitter=0.05)
    for p in parts[1:]:
        smooth(p, 60)
    publish([robe, mantle, rib, heart, neck, skull, hood] + glow + parts + [gem], 'lich_body', ground=True)


def lich_arm():
    # Draped bell sleeve from the shoulder, ragged at the cuff.
    prof = [(0.32, -0.86), (0.25, -0.72), (0.17, -0.48), (0.13, -0.22), (0.15, -0.02), (0.13, 0.1), (0.04, 0.15)]
    sleeve = garment(prof, L_ROBE(), segs=16, sub=2, hem=tatters(6, 0.22, 12), hem_h=0.3, folds=(0.16, 4), sx=0.9, sy=1.0, thick=0.025, seed=3,
                     fold_fall=0.7)
    xform(sleeve, (0.03, 0, 0))
    # Blackened bone spikes jutting from the shoulder.
    spikes = []
    for (d, L) in (((0.5, 0.1, 1), 0.3), ((0.8, 0.45, 0.6), 0.22), ((0.8, -0.45, 0.6), 0.2)):
        d = Vector(d).normalized()
        b = Vector((0.05, 0, 0.06))
        spikes.append(sweep(spline([b, b + d * L * 0.5 + Vector((0, 0, 0.02)), b + d * L], 6), [0.045, 0.038, 0.03, 0.02, 0.01, 0.002], L_CROWN(), segs=6))
        smooth(spikes[-1], 60)
    # Forearm bones, wrist and a long clawed hand, reaching slightly forward.
    P = chain([(0.03, 0.0, -0.5), (0.035, -0.02, -0.8), (0.04, -0.04, -1.02)], 0.03, 0.024, step=0.012)
    P += chain([(0.065, 0.02, -0.52), (0.07, 0.0, -0.8), (0.07, -0.02, -1.01)], 0.022, 0.02, step=0.01)
    # Hand, 1.45x life size: built at unit scale around the wrist then scaled.
    W = Vector((0.05, -0.03, -1.04))
    H = [sphere(0.042, (0, 0, 0), (1.0, 1.2, 0.8), 12), sphere(0.05, (0.005, -0.005, -0.08), (0.6, 1.25, 1.1), 12)]
    for k, yy in enumerate((-0.055, -0.015, 0.025, 0.065)):
        base = Vector((0.005, yy, -0.14))
        L = (0.085, 0.075, 0.065) if k in (1, 2) else (0.07, 0.065, 0.055)
        H += chain([(0.005, (yy + 0.005) * 0.3, -0.02), tuple(base)], 0.014, 0.012, step=0.007)
        H += digit(base, (0.0, (yy - 0.005) * 0.8, -1), (1, 0, 0), L, 0.013, curl=-0.3)
    H += digit((-0.03, -0.04, -0.05), (-0.5, -0.6, -0.6), (0, 0, 1), (0.055, 0.05), 0.015, curl=0.3)  # thumb
    for h in H:
        xform(h, tuple(W), (0, 0, 0), (1.45, 1.45, 1.45))
    hand = sculpt(P + H, 0.0085, BONE(), 940, it=2, angle=55)
    publish([sleeve, hand] + spikes, 'lich_arm', origin=(0, 0, 0))


def phylactery():
    # Bone stand: four claw toes, a stack of vertebrae, a cupped mount.
    P = [sphere(0.1, (0, 0, 0.05), (1.3, 1.3, 0.5), 16)]
    for i in range(4):
        a = i / 4 * math.tau + math.pi / 4
        c, s = math.cos(a), math.sin(a)
        P += chain([(c * 0.05, s * 0.05, 0.06), (c * 0.17, s * 0.17, 0.05), (c * 0.25, s * 0.25, 0.02)], 0.04, 0.02, step=0.012)
    for k in range(5):
        z = 0.14 + k * 0.075
        P.append(sphere(0.055, (0, 0, z), (1.0, 1.0, 0.45), 14))
        P.append(sphere(0.02, (0, 0.06, z), (0.6, 1.5, 0.8), 8))
    P.append(cyl(0.035, 0.4, (0, 0, 0.3), verts=10))
    P.append(sphere(0.12, (0, 0, 0.5), (1.3, 1.3, 0.45), 16))
    stand = sculpt(P, 0.011, BONE(), 380, it=2, cutters=[sphere(0.13, (0, 0, 0.6), (1.2, 1.2, 0.6), 16)], angle=55)
    # Glass bulb, the heart inside, bone cage ribs, blackened rings and finial.
    glass = lathe([(0.0, 0.52), (0.12, 0.53), (0.2, 0.6), (0.225, 0.72), (0.215, 0.86), (0.16, 0.97), (0.07, 1.01), (0.0, 1.02)], PHYL(), 14, shade=60)
    H = [sphere(0.06, (0.038, 0, 0.81), segs=12), sphere(0.06, (-0.038, 0, 0.81), segs=12),
         cyl(0.077, 0.12, (0, 0, 0.73), (math.pi, 0, 0), 12, r2=0.008)]
    heart = sculpt(H, 0.009, SOUL(), 140, it=2, angle=70)
    out = [stand, glass, heart]
    for i in range(6):
        a = i / 6 * math.tau + math.pi / 6
        c, s = math.cos(a), math.sin(a)
        path = spline([(c * 0.17, s * 0.17, 0.52), (c * 0.25, s * 0.25, 0.62), (c * 0.265, s * 0.265, 0.78),
                       (c * 0.22, s * 0.22, 0.93), (c * 0.1, s * 0.1, 1.04)], 9)
        out.append(sweep(path, [0.018, 0.02, 0.021, 0.02, 0.019, 0.017, 0.015, 0.014, 0.013], BONE(), segs=5))
        out.append(sphere(0.025, (c * 0.265, s * 0.265, 0.78), (1, 1, 1.3), 8, BONE()))
    out.append(torus(0.18, 0.022, (0, 0, 0.525), m=L_CROWN(), seg=20, minor=5))
    out.append(torus(0.1, 0.02, (0, 0, 1.04), m=L_CROWN(), seg=16, minor=5))
    out.append(lathe([(0.1, 1.04), (0.075, 1.08), (0.03, 1.1), (0.025, 1.14), (0.0, 1.2)], L_CROWN(), 10, shade=40))
    out.append(torus(0.035, 0.009, (0, 0, 1.16), (math.pi / 2, 0, 0), L_CROWN(), 12, 4))
    for o in out[3:]:
        smooth(o, 60)
    publish(out, 'phylactery')


# ================================================================ The Winter Queen
QUEEN_SHOULDER = Vector((0.32, 0.0, 2.42))  # where the game mounts queen_arm (mirror for the left)
Q_UP, Q_ALL = 1.25, 0.94   # the upper body is built at life proportions, then enlarged (stylised) and the whole fitted to 3.6 m


def scale_about(objs, pivot, k):
    pv = Vector(pivot)
    for o in objs:
        for v in o.data.vertices:
            v.co = pv + (v.co - pv) * k
        o.data.update()


def queen_body():
    # Faceted crystalline gown: low-segment pleated shell, jagged icicle hem, flat shaded.
    prof = [(0.98, 0.14), (0.78, 0.36), (0.56, 0.74), (0.41, 1.18), (0.3, 1.62), (0.3, 1.9), (0.35, 2.16), (0.33, 2.36), (0.27, 2.42)]
    gown = garment(prof, ICE(), segs=26, sub=1, hem=tatters(13, 0.16, 21, lo=0.5, sharp=1.0), hem_h=0.4, folds=(0.1, 13), sx=1.0, sy=0.86,
                   thick=0.04, seed=5, fold_fall=0.6, twist=0.25)
    flat(gown)
    out = [gown, wrap_ring(bvh(gown), 1.66, 26, 1.2, ICE_GLOW(), 0.022, lift=0.012)]   # glowing band under the bodice
    # Icicle shards bursting out around the hem and a spine of crystals up the skirt.
    for i in range(16):
        a = i / 16 * math.tau + 0.2
        c, s = math.cos(a), math.sin(a) * 0.86
        out.append(crystal((c * 0.88, s * 0.88, 0.2), (c, s, random.uniform(-0.1, 0.5)), random.uniform(0.28, 0.5), 0.09, ICE_SHARD(), sides=5, tip=0.5))
    for sx in (1, -1):
        for k in range(4):
            t = k / 3
            r = 0.86 - 0.5 * t
            z = 0.3 + 1.2 * t
            out.append(crystal((sx * r * 0.97, 0.12, z), (sx * 0.9, 0.3, 0.6), 0.34 - 0.16 * t, 0.07 - 0.03 * t, ICE_SHARD(), sides=5, tip=0.5))
    # Bare shoulders, collarbones, neck and head.
    P = [sphere(1, (0, 0.0, 2.33), (0.27, 0.19, 0.17), 20),
         sphere(0.085, (0.26, 0.0, 2.52), (1.1, 1.0, 0.9), 14), sphere(0.085, (-0.26, 0.0, 2.52), (1.1, 1.0, 0.9), 14),
         sphere(1, (0, 0.0, 2.46), (0.28, 0.14, 0.08), 16)]
    P += chain([(0, 0.02, 2.4), (0, 0.0, 2.62), (0, -0.01, 2.78)], 0.058, 0.052, step=0.02)
    P += [sphere(1, (0, 0.0, 2.93), (0.108, 0.125, 0.145), 20),          # cranium
          sphere(1, (0, -0.05, 2.86), (0.085, 0.085, 0.1), 16),           # face / jaw
          sphere(0.03, (0, -0.1, 2.8), (1.2, 0.9, 0.8), 10),              # chin
          sphere(0.018, (0, -0.128, 2.9), (0.7, 1.0, 1.4), 8)]            # nose
    for sx in (1, -1):
        P.append(sphere(0.028, (sx * 0.055, -0.095, 2.9), (1.2, 0.8, 0.8), 10))   # cheekbones
    cut = [sphere(0.022, (sx * 0.042, -0.118, 2.935), (1.4, 0.8, 0.6), 10) for sx in (1, -1)]
    skin = sculpt(P, 0.009, Q_SKIN(), 1500, it=3, cutters=cut, angle=60)
    upper = [skin]
    for sx in (1, -1):   # glowing eyes: almond lenses in the sockets
        e = sphere(0.02, (sx * 0.042, -0.108, 2.935), (1.35, 0.5, 0.55), 10, ICE_GLOW(), rot=(0, math.radians(-10) * sx, 0))
        upper.append(e)
    # Long white hair: a sleek cap and a curtain down the back to the waist, locks framing the face.
    H = [sphere(1, (0, 0.02, 2.955), (0.125, 0.14, 0.15), 18)]
    for k in range(7):
        x = (k - 3) * 0.05
        H += chain([(x, 0.08, 2.98), (x * 1.5, 0.15, 2.75), (x * 2.0, 0.19, 2.4), (x * 2.3, 0.2, 2.05), (x * 2.5, 0.2, 1.72)],
                   0.06, 0.028, step=0.015, scale=(1.0, 0.6, 1.0))
    for sx in (1, -1):
        H += chain([(sx * 0.1, -0.04, 2.98), (sx * 0.13, -0.06, 2.8), (sx * 0.14, -0.06, 2.55), (sx * 0.13, -0.08, 2.3)], 0.04, 0.02, step=0.012,
                   scale=(0.8, 0.7, 1.0))
    hair = sculpt(H, 0.012, Q_HAIR(), 1500, amp=0.004, freq=30, seed=9, it=2, angle=55,
                  cutters=[sphere(1, (0, -0.2, 2.9), (0.105, 0.14, 0.13), 20)])
    upper.append(hair)
    top = []
    # Crown of tall ice spikes, the centre one tallest, with a glowing heart gem.
    n = 9
    for i in range(n):
        a = -math.pi / 2 + (i - n // 2) * 0.33
        c, s = math.cos(a), math.sin(a)
        k = abs(i - n // 2)
        L = 0.5 - 0.08 * k
        top.append(crystal((c * 0.11, s * 0.12 + 0.03, 3.04), (c * (0.12 + 0.12 * k), s * 0.1, 1), L, 0.035 - 0.003 * k, ICE_SHARD(), sides=4, tip=0.45))
    top.append(torus(0.12, 0.014, (0, 0.02, 3.04), (math.radians(-12), 0, 0), ICE(), 20, 5))
    top.append(crystal((0, -0.11, 3.08), (0, -1, 0.3), 0.07, 0.03, ICE_GLOW(), sides=4, tip=0.5, double=True, jitter=0))
    # High fan collar of crystal behind the head.
    for i in range(11):
        u = (i - 5) / 5
        base = Vector((u * 0.26, 0.15 - 0.05 * abs(u), 2.44))
        d = Vector((u * 1.1, 0.3, 1.0))
        top.append(crystal(tuple(base), tuple(d), 0.64 - 0.26 * abs(u), 0.055, ICE_SHARD(), sides=4, tip=0.4))
    # Ice pauldrons where the arms mount.
    for sx in (1, -1):
        top += crystal_cluster((sx * 0.27, 0.02, 2.56), (sx * 0.5, 0.1, 1), 3, 0.22, 0.045, ICE_SHARD(), spread=0.4, sides=5)
    scale_about(upper + top, (0, 0, 2.36), Q_UP)
    out += upper + top
    scale_about(out, (0, 0, 0), Q_ALL)
    publish(out, 'queen_body', ground=True)


def queen_arm():
    P = chain([(0.0, 0.0, 0.0), (0.03, 0.01, -0.28), (0.045, 0.02, -0.5)], 0.06, 0.047, step=0.018)
    P += chain([(0.045, 0.02, -0.5), (0.05, -0.02, -0.75), (0.05, -0.05, -0.95)], 0.046, 0.032, step=0.014)
    P.append(sphere(1, (0.05, -0.06, -1.02), (0.022, 0.05, 0.065), 12))               # hand
    for k in range(4):
        y = -0.09 + k * 0.02
        L = 0.1 if k in (1, 2) else 0.085
        P += chain([(0.05, y + 0.02, -1.05), (0.045, y + 0.005 - 0.01 * (k == 0), -1.05 - L * 0.6), (0.035, y - 0.01, -1.05 - L)], 0.011, 0.007, step=0.005)
    P += chain([(0.035, -0.09, -0.99), (0.02, -0.12, -1.05), (0.015, -0.125, -1.1)], 0.012, 0.008, step=0.005)  # thumb
    arm = sculpt(P, 0.008, Q_SKIN(), 650, it=2, angle=60)
    # Icy sleeve: faceted, flaring to a jagged icicle cuff below the elbow.
    prof = [(0.17, -0.72), (0.12, -0.5), (0.08, -0.25), (0.085, 0.0), (0.07, 0.07), (0.02, 0.1)]
    sleeve = garment(prof, ICE(), segs=10, sub=1, hem=tatters(5, 0.16, 31, lo=0.5, sharp=1.0), hem_h=0.25, folds=(0.12, 5), thick=0.02, seed=6, twist=0.3)
    xform(sleeve, (0.035, 0.0, 0.0))
    flat(sleeve)
    out = [arm, sleeve]
    out += crystal_cluster((0.04, 0.0, 0.06), (0.5, 0.0, 1), 2, 0.2, 0.04, ICE_SHARD(), spread=0.35, sides=4)
    scale_about(out, (0, 0, 0), Q_UP * Q_ALL)
    publish(out, 'queen_arm', origin=(0, 0, 0))


# ================================================================ The Molten Tyrant
TYRANT_SHOULDER = Vector((1.0, -0.05, 2.62))
_TYRANT = {}


def tyrant_mass():
    """The Tyrant's fused basalt mass (remeshed and smoothed, not yet cracked)."""
    sh = TYRANT_SHOULDER
    P = [sphere(1, (0, 0.05, 1.05), (0.78, 0.66, 0.56), 24),         # gut / pelvis
         sphere(1, (0, 0.1, 1.8), (0.95, 0.76, 0.66), 28),          # barrel chest
         sphere(1, (0, 0.4, 2.52), (0.95, 0.74, 0.62), 24),         # hunched back / trapezius mass
         sphere(1, (0, 0.28, 2.8), (0.6, 0.5, 0.4), 20),
         sphere(1, (0, -0.52, 2.42), (0.33, 0.3, 0.3), 20),         # head, sunk forward between the shoulders
         sphere(1, (0, -0.6, 2.22), (0.37, 0.3, 0.19), 20),         # heavy underslung jaw
         sphere(1, (0, -0.74, 2.55), (0.3, 0.1, 0.08), 16)]         # brow shelf
    for sx in (1, -1):
        P.append(ico(0.44, (sx * (sh.x - 0.12), 0.08, 2.6), 2, (1.0, 1.1, 0.9)))                  # shoulder boulders
        P.append(ico(0.34, (sx * 0.62, 0.12, 2.0), 2, (0.9, 1.0, 1.1)))                            # flanks
        P += [ico(0.36, (sx * 0.46, 0.05, 0.62), 2, (1.0, 1.0, 1.05)),                             # thighs
              sphere(1, (sx * 0.52, -0.14, 0.16), (0.33, 0.42, 0.2), 16)]                          # feet
        for k in range(3):
            P.append(sphere(0.11, (sx * 0.52 + (k - 1) * 0.16, -0.52, 0.09), (1.0, 1.1, 0.8), 10))  # toes
        P.append(sphere(0.12, (sx * 0.24, -0.7, 2.2), (1.0, 1.0, 0.9), 12))                        # jaw corners
    P += chunks_on((0, 0.1, 1.75), (0.9, 0.7, 0.62), 20, 0.14, 0.26, zmin=-0.5)
    P += chunks_on((0, 0.42, 2.5), (0.88, 0.66, 0.56), 12, 0.14, 0.24, zmin=0.0)
    for sx in (1, -1):
        P += chunks_on((sx * (sh.x - 0.12), 0.08, 2.6), (0.4, 0.44, 0.36), 5, 0.12, 0.2, zmin=-0.2)
    P += chunks_on((0, 0.05, 1.0), (0.72, 0.6, 0.45), 8, 0.12, 0.22)
    o = join(P)
    remesh(o, 0.035)
    rough(o, 0.04, 1.3, 2, seed=41)
    laplace(o, 0.6, 4)
    cut_plane(o, (0, 0, 0), (0, 0, -1))
    return o


def tyrant_body():
    base = tyrant_mass()
    _TYRANT['smooth'] = dup(base)
    cut = [sphere(1, (0, -0.86, 2.3), (0.24, 0.24, 0.085), 18)]                     # molten maw
    for sx in (1, -1):
        cut.append(box((0.15, 0.3, 0.035), (sx * 0.13, -0.74, 2.5), (0, math.radians(-18) * sx, 0), bevel=0))  # eye slits
    carve(base, cut)
    rock, core = magma(base, 5400, 1300, 2.1, 0.05, 0.09, 0.045, seed=3,
                       mask=lambda c, n: 0.6 + 0.4 * max(0.0, -n.y) + (0.25 if c.z < 1.4 else 0.0))
    out = [rock, core]
    out.append(sphere(1, (0, -0.64, 2.3), (0.22, 0.14, 0.09), 14, LAVA()))          # maw glow
    for sx in (1, -1):
        out.append(box((0.13, 0.05, 0.024), (sx * 0.13, -0.66, 2.5), (0, math.radians(-18) * sx, 0), LAVA(), bevel=0))
    for i in range(5):                                                                  # teeth
        x = (i - 2) * 0.1
        out.append(crystal((x, -0.84 + abs(x) * 0.25, 2.38), (0, -0.2, -1), 0.1 - abs(x) * 0.12, 0.03, T_ROCK(), sides=4, tip=0.6))
        out.append(crystal((x * 0.9, -0.83 + abs(x) * 0.25, 2.2), (0, -0.3, 1), 0.08 - abs(x) * 0.1, 0.028, T_ROCK(), sides=4, tip=0.6))
    for sx in (1, -1):                                                                  # great curling horns
        path = spline([(sx * 0.24, -0.5, 2.66), (sx * 0.5, -0.42, 2.95), (sx * 0.66, -0.5, 3.35), (sx * 0.6, -0.72, 3.66), (sx * 0.46, -0.9, 3.8)], 16)
        h = sweep(path, [0.15 - 0.145 * (k / 15) ** 0.9 for k in range(16)], T_ROCK(), segs=9)
        smooth(h, 50)
        out.append(h)
    for k in range(5):                                                                  # basalt spines down the hump
        z = 3.08 - k * 0.2
        y = 0.55 + k * 0.1
        out.append(crystal((random.uniform(-0.05, 0.05), y, z), (0, 0.5 + k * 0.15, 1), 0.42 - k * 0.05, 0.1, T_ROCK(), sides=5, tip=0.55))
    publish(out, 'tyrant_body')


def plate(tree, centre, d, U, V, n=(4, 3), lift=0.03, thick=0.08, taper=0.0, jit=0.04, seed=0):
    """An obsidian armour slab conforming to the body: a grid of rays cast along d onto the body
    surface (centred on `centre`, spanning U x V), lifted off it, thickened, edge-bevelled."""
    rnd = random.Random(seed)
    d = Vector(d).normalized()
    U, V, C = Vector(U), Vector(V), Vector(centre)
    bm = bmesh.new()
    grid = []
    for j in range(n[1] + 1):
        v = j / n[1] - 0.5
        row = []
        for i in range(n[0] + 1):
            u = (i / n[0] - 0.5) * (1 - taper * (v + 0.5))
            p = C + U * u + V * v + (U * rnd.uniform(-jit, jit) + V * rnd.uniform(-jit, jit))
            hit = tree.ray_cast(p - d * 1.2, d, 1.8)
            if hit[0] is None or (hit[0] - p).length > 0.6:
                hit = tree.find_nearest(p)
            row.append(bm.verts.new(hit[0] + hit[1] * lift))
        grid.append(row)
    for j in range(n[1]):
        for i in range(n[0]):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if sum(f.normal.dot(d) for f in bm.faces) > 0:   # face outward (against the ray direction)
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    me = bpy.data.meshes.new('plate')
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new('plate', me)
    scene.collection.objects.link(o)
    sol = o.modifiers.new('sol', 'SOLIDIFY')
    sol.thickness = thick
    sol.offset = 1
    apply_mod(o, sol)
    bev = o.modifiers.new('bev', 'BEVEL')
    bev.width = 0.022
    bev.segments = 1
    bev.limit_method = 'ANGLE'
    bev.angle_limit = math.radians(40)
    apply_mod(o, bev)
    assign(o, OBSID())
    flat(o)
    return o


def tyrant_plates():
    src = _TYRANT.get('smooth') or tyrant_mass()
    tree = bvh(src)
    sh = TYRANT_SHOULDER
    P = []
    for sx in (1, -1):
        # chest: two pectoral slabs split at the sternum, a belly slab below each
        P.append(plate(tree, (sx * 0.36, -0.6, 1.98), (0, 1, 0.15), (0.56, 0, 0), (0, 0.05, 0.46), (4, 3), taper=0.25 * 0, seed=1 + sx))
        P.append(plate(tree, (sx * 0.27, -0.55, 1.5), (0, 1, 0), (0.42, 0, 0), (0, 0, 0.3), (3, 2), thick=0.07, seed=3 + sx))
        # pauldrons: a top cap and a lower tier over each shoulder
        c = Vector((sx * (sh.x - 0.05), 0.02, 2.62))
        P.append(plate(tree, c + Vector((0, 0, 0.25)), (-sx * 0.35, 0, -1), (0, 0.78, 0), (sx * 0.56, 0, -0.2), (4, 3), lift=0.04, thick=0.1, seed=5 + sx))
        P.append(plate(tree, c + Vector((sx * 0.3, 0, -0.18)), (-sx, 0, -0.25), (0, 0.72, 0), (0, 0, 0.28), (4, 2), lift=0.05, thick=0.08, seed=7 + sx))
        # back: two tiers of slabs down each side of the spine ridge
        P.append(plate(tree, (sx * 0.34, 0.95, 2.85), (0, -1, -0.5), (0.5, 0, 0), (0, -0.2, 0.36), (3, 3), seed=9 + sx))
        P.append(plate(tree, (sx * 0.38, 1.0, 2.38), (0, -1, -0.15), (0.56, 0, 0), (0, -0.1, 0.4), (3, 3), seed=11 + sx))
    if 'smooth' in _TYRANT:
        bpy.data.objects.remove(_TYRANT.pop('smooth'), do_unlink=True)
    else:
        bpy.data.objects.remove(src, do_unlink=True)
    publish(P, 'tyrant_plates')


def tyrant_arm():
    P = [ico(0.42, (0.06, 0.0, -0.02), 2, (1.0, 1.05, 0.95))]                        # shoulder boulder
    P += chain([(0.08, 0.02, -0.2), (0.12, 0.06, -0.5), (0.15, 0.08, -0.78)], 0.27, 0.22, step=0.05)   # upper arm
    P.append(ico(0.24, (0.16, 0.12, -0.82), 2))                                       # elbow
    P += chain([(0.15, 0.05, -0.85), (0.16, 0.0, -1.15), (0.17, -0.05, -1.42)], 0.25, 0.33, step=0.05)  # forearm, swelling
    P.append(sphere(1, (0.17, -0.1, -1.8), (0.42, 0.44, 0.36), 20))                  # the fist
    for i in range(4):                                                                  # knuckles and curled fingers
        x = 0.17 + (i - 1.5) * 0.19
        P.append(sphere(0.12, (x, -0.42, -1.86 - abs(i - 1.5) * 0.02), (0.9, 1.0, 1.0), 12))
        P.append(sphere(1, (x, -0.36, -2.04), (0.1, 0.12, 0.09), 12))
    P += chain([(-0.14, -0.2, -1.62), (-0.2, -0.35, -1.78), (-0.1, -0.44, -1.92)], 0.12, 0.09, step=0.03)  # thumb
    P += chunks_on((0.1, 0.03, -0.45), (0.25, 0.25, 0.28), 5, 0.1, 0.14)
    P += chunks_on((0.16, -0.02, -1.15), (0.3, 0.28, 0.24), 6, 0.1, 0.15)
    P += chunks_on((0.06, 0.0, 0.0), (0.4, 0.42, 0.38), 5, 0.1, 0.16, zmin=0.0)
    a = join(P)
    remesh(a, 0.03)
    rough(a, 0.035, 1.6, 2, seed=51)
    laplace(a, 0.6, 4)
    rock, core = magma(a, 1900, 500, 2.6, 0.055, 0.08, 0.04, seed=7)
    publish([rock, core], 'tyrant_arm', origin=(0, 0, 0))

# ================================================================ Veyra, the Unraveller
def ribbon(pts, widths, thick, m, twist=0.0, axis_out=True):
    """A flat cloth strip along pts: broad side faces away from the Z axis, optional twist."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    bm = bmesh.new()
    rings = []
    for i in range(n):
        T = (pts[min(n - 1, i + 1)] - pts[max(0, i - 1)]).normalized()
        R = Vector((pts[i].x, pts[i].y, 0))
        R = R.normalized() if R.length > 1e-4 else Vector((0, -1, 0))
        W = T.cross(R)
        if W.length < 1e-4:
            W = T.cross(Vector((1, 0, 0)))
        W.normalize()
        W = Matrix.Rotation(twist * i / max(1, n - 1), 3, T) @ W
        N = W.cross(T).normalized()
        w = widths[i] / 2
        rings.append([bm.verts.new(pts[i] + W * sw * w + N * sn * thick / 2) for (sw, sn) in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
    for i in range(n - 1):
        for k in range(4):
            j = (k + 1) % 4
            bm.faces.new((rings[i][k], rings[i][j], rings[i + 1][j], rings[i + 1][k]))
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])
    o = mesh_obj(bm, 'ribbon', m)
    smooth(o, 70)
    return o


def surface_cracks(target, n, m, r, seed, where, steps=(5, 9), step=0.035, branch=0.5):
    """Glowing crack seams walked across a surface: random-walk polylines snapped to the mesh,
    sunk halfway in, with the odd side branch."""
    rnd = random.Random(seed)
    tree = bvh(target)
    verts = [v.co.copy() for v in target.data.vertices if where(v.co, v.normal)]
    out = []

    def walk(p, d, k, rr):
        pts = []
        for _ in range(k):
            loc, nrm, _, _ = tree.find_nearest(p)
            pts.append(loc - nrm * rr * 0.35)
            d = (d - nrm * d.dot(nrm)).normalized()
            d = Matrix.Rotation(rnd.uniform(-0.7, 0.7), 3, nrm) @ d
            p = loc + d * step
        return pts
    for _ in range(n):
        p = rnd.choice(verts)
        d = Vector([rnd.uniform(-1, 1) for _ in range(3)]).normalized()
        pts = walk(p, d, rnd.randint(*steps), r)
        if len(pts) > 2:
            out.append(sweep(pts, [r * (1 - 0.6 * i / (len(pts) - 1)) for i in range(len(pts))], m, segs=3))
            if rnd.random() < branch:
                q = pts[len(pts) // 2]
                bp = walk(q, Vector([rnd.uniform(-1, 1) for _ in range(3)]).normalized(), rnd.randint(3, 5), r * 0.7)
                if len(bp) > 2:
                    out.append(sweep(bp, [r * 0.7 * (1 - 0.6 * i / (len(bp) - 1)) for i in range(len(bp))], m, segs=3))
    for o in out:
        smooth(o, 80)
    return out


def wrap_ring(tree, z, n, rmax, m, r, lift=0.006, zf=None):
    """A trim band hugging a lathed surface at height z (rays cast inward towards the axis)."""
    pts = []
    for i in range(n + 1):
        a = i / n * math.tau
        zz = z + (zf(a) if zf else 0.0)
        o = Vector((math.cos(a) * rmax, math.sin(a) * rmax, zz))
        hit = tree.ray_cast(o, Vector((-math.cos(a), -math.sin(a), 0)), rmax)
        if hit[0] is not None:
            pts.append(hit[0] + hit[1] * lift)
    o = sweep(pts, r, m, segs=5, squash=0.5)
    smooth(o, 60)
    return o


VEYRA_ARM = [(0.25, 0.0, 2.38), (0.5, 0.03, 2.13), (0.78, -0.1, 2.05)]   # shoulder, elbow, wrist (right; mirrored)


def unraveller_body():
    rnd = random.Random(77)
    HEM = 1.0
    # Robe: fitted bodice, flaring skirt, ragged hem, V neckline.
    prof = [(0.52, HEM), (0.45, 1.28), (0.34, 1.62), (0.26, 1.84), (0.29, 2.04), (0.31, 2.2), (0.28, 2.36), (0.2, 2.44), (0.12, 2.48)]
    robe = garment(prof, V_ROBE(), segs=32, sub=2, hem=tatters(14, 0.3, 41, lo=0.4), hem_h=0.4, folds=(0.12, 7), sx=1.1, sy=0.82,
                   thick=0.03, seed=8, fold_fall=0.8, twist=0.35)
    vcut = cyl(0.5, 0.6, (0, -0.3, 2.62), (math.radians(90), 0, 0), 3)   # triangular prism → V neckline
    vcut.rotation_euler = (0, 0, 0)
    xform(vcut, (0, 0, 0), (0, 0, math.pi), (0.34, 1, 0.9))
    xform(vcut, (0, 0, 0.0))
    carve(robe, [vcut])
    smooth(robe, 50)
    tree = bvh(robe)
    trims = [wrap_ring(tree, 1.84, 32, 1.0, V_GOLD(), 0.022), wrap_ring(tree, 1.25, 36, 1.2, V_GOLD(), 0.018)]
    for sx in (1, -1):   # gold edging down the V
        pts = []
        for k in range(8):
            t = k / 7
            p = Vector((sx * (0.2 - 0.19 * t), -1.0, 2.44 - 0.3 * t))
            hit = tree.ray_cast(p, Vector((0, 1, 0)), 2)
            if hit[0] is not None:
                pts.append(hit[0] + Vector((0, -0.008, 0)))
        if len(pts) > 2:
            trims.append(sweep(pts, 0.016, V_GOLD(), segs=5))
    # Skin: chest in the V, neck, head, and bare forearms raised outward with open hands.
    P = [sphere(1, (0, -0.02, 2.27), (0.23, 0.16, 0.19), 20)]
    P += chain([(0, 0.01, 2.36), (0, 0.0, 2.52), (0, -0.01, 2.62)], 0.05, 0.045, step=0.015)
    P += [sphere(1, (0, 0.0, 2.73), (0.098, 0.113, 0.128), 20), sphere(1, (0, -0.045, 2.665), (0.078, 0.08, 0.092), 16),
          sphere(0.027, (0, -0.088, 2.605), (1.2, 0.9, 0.8), 10), sphere(0.016, (0, -0.113, 2.69), (0.7, 1.0, 1.4), 8)]
    for sx in (1, -1):
        P.append(sphere(0.026, (sx * 0.05, -0.09, 2.695), (1.2, 0.8, 0.8), 10))
        S, E, W = [Vector((sx * v[0], v[1], v[2])) for v in VEYRA_ARM]
        P += chain([tuple(S), tuple(E)], 0.052, 0.042, step=0.016)
        P += chain([tuple(E), tuple(W)], 0.042, 0.03, step=0.012)
        h = W + Vector((sx * 0.07, -0.03, 0.02))
        P.append(sphere(1, tuple(h), (0.06, 0.028, 0.05), 12))                     # palm, facing forward
        for k in range(4):                                                            # spread fingers
            ang = math.radians(-35 + k * 25)
            d = Vector((sx * math.cos(ang), -0.25, math.sin(ang))).normalized()
            P += chain([tuple(h + d * 0.04), tuple(h + d * 0.1), tuple(h + d * 0.14 + Vector((0, -0.02, 0)))], 0.012, 0.008, step=0.006)
        P += chain([tuple(h + Vector((-sx * 0.02, -0.02, -0.04))), tuple(h + Vector((-sx * 0.0, -0.07, -0.08)))], 0.013, 0.009, step=0.006)
    cut = [sphere(0.02, (sx * 0.038, -0.108, 2.705), (1.4, 0.8, 0.6), 10) for sx in (1, -1)]
    skin = sculpt(P, 0.008, V_SKIN(), 1450, it=3, cutters=cut, angle=60)
    eyes = [sphere(0.017, (sx * 0.038, -0.1, 2.705), (1.3, 0.55, 0.6), 8, RIFT()) for sx in (1, -1)]
    cracks = surface_cracks(skin, 20, RIFT(), 0.011, 5, lambda c, n: c.z > 2.1 and (n.y < -0.1 or abs(c.x) > 0.5), steps=(5, 8), step=0.032)
    # Sleeves to the elbow, gold cuffs, trailing threads.
    sleeves = []
    for sx in (1, -1):
        S, E, W = [Vector((sx * v[0], v[1], v[2])) for v in VEYRA_ARM]
        sprof = [(0.16, -0.42), (0.12, -0.3), (0.085, -0.1), (0.09, 0.02), (0.05, 0.08)]
        sl = garment(sprof, V_ROBE(), segs=14, sub=2, hem=tatters(5, 0.12, 50 + sx), hem_h=0.2, folds=(0.12, 4), thick=0.02, seed=9)
        d = (E - S).normalized()
        R = Vector((0, 0, -1)).rotation_difference(d).to_matrix().to_4x4()
        sl.matrix_world = Matrix.Translation(S) @ R
        apply_tf(sl)
        cuff = torus(0.125, 0.014, (0, 0, 0), m=V_GOLD(), seg=16, minor=4)
        cuff.matrix_world = Matrix.Translation(S + d * 0.3) @ R
        apply_tf(cuff)
        sleeves += [sl, cuff]
    # The circlet: gold band with five empty gem sockets across the brow.
    circ = torus(0.112, 0.011, (0, 0, 0), m=V_GOLD(), seg=24, minor=4)
    xform(circ, (0, 0.006, 2.78), (math.radians(-12), 0, 0), (1.0, 1.12, 1.0))
    crown = [circ]
    for k in range(-2, 3):
        a = -math.pi / 2 + k * 0.42
        rad = Vector((math.cos(a) * 1.0, math.sin(a) * 1.12, 0)).normalized()
        c = Vector((math.cos(a) * 0.117, math.sin(a) * 0.13 + 0.006, 2.78 + 0.02 - 0.012 * abs(k)))
        rim = torus(0.02 - 0.003 * abs(k), 0.0055, (0, 0, 0), m=V_GOLD(), seg=10, minor=4)
        rim.matrix_world = Matrix.Translation(c) @ Vector((0, 0, 1)).rotation_difference(rad).to_matrix().to_4x4()
        apply_tf(rim)
        disc = cyl(0.017 - 0.003 * abs(k), 0.008, (0, 0, 0), verts=10, m=V_SOCKET())
        disc.matrix_world = Matrix.Translation(c - rad * 0.002) @ Vector((0, 0, 1)).rotation_difference(rad).to_matrix().to_4x4()
        apply_tf(disc)
        crown += [rim, disc]
    crown.append(crystal((0, -0.14, 2.82), (0, -0.25, 1), 0.07, 0.014, V_GOLD(), sides=4, tip=0.6))
    # Hair lifting as if underwater: a cap and locks drifting up and out.
    H = [sphere(1, (0, 0.012, 2.74), (0.108, 0.122, 0.13), 18),
         sphere(1, (0, 0.1, 2.9), (0.16, 0.12, 0.14), 18)]                 # the rising mass behind the crown
    for k in range(9):
        u = (k - 4) / 4
        a = u * 1.1
        root = Vector((math.sin(a) * 0.085, 0.07 + math.cos(a) * 0.03, 2.8))
        out_d = Vector((math.sin(a) * 0.75, 0.45, 0))
        L = 0.36 + 0.1 * (1 - abs(u)) - 0.04 * (k % 2)
        wv = 0.04 * (1 if k % 2 else -1)
        pts = [root, root + out_d * 0.12 + Vector((0, 0, L * 0.3)), root + out_d * 0.26 + Vector((wv, 0, L * 0.6)),
               root + out_d * 0.4 + Vector((-wv, 0, L * 0.85)), root + out_d * 0.55 + Vector((0, 0.02, L))]
        H += chain([tuple(p) for p in pts], 0.085, 0.035, step=0.014, scale=(1.0, 0.8, 1.0))
    for sx in (1, -1):   # locks drifting out behind the shoulders
        H += chain([(sx * 0.07, 0.08, 2.7), (sx * 0.2, 0.17, 2.68), (sx * 0.31, 0.22, 2.78), (sx * 0.38, 0.25, 2.92)], 0.075, 0.035, step=0.012)
    hair = sculpt(H, 0.013, V_HAIR(), 950, amp=0.004, freq=30, seed=12, it=3, angle=55,
                  cutters=[sphere(1, (0, -0.18, 2.69), (0.1, 0.13, 0.12), 20)])
    # The fraying: ribbons unravel from the hem, drifting out and down, each ending in loose threads.
    rib = []
    NR = 20
    for i in range(NR):
        a = i / NR * math.tau + rnd.uniform(-0.1, 0.1)
        z0 = HEM + rnd.uniform(0.0, 0.12)
        r0 = 0.47
        spread = rnd.uniform(0.35, 1.05)
        swirl = rnd.uniform(0.5, 1.0) * (1 if i % 2 else -1)
        zend = rnd.uniform(0.02, 0.35)
        ph = rnd.random() * math.tau
        pts = []
        K = 11
        for k in range(K):
            t = k / (K - 1)
            R = r0 + spread * t ** 1.25
            ang = a + swirl * t ** 1.5
            z = z0 - (z0 - zend) * t ** 0.85 + 0.07 * math.sin(t * math.pi * 2.2 + ph) * t
            pts.append(Vector((math.cos(ang) * R * 1.1, math.sin(ang) * R * 0.85, z)))
        m = V_GOLD() if i % 4 == 1 else V_ROBE()
        rib.append(ribbon(pts, [0.16 - 0.11 * (k / (K - 1)) for k in range(K)], 0.012, m, twist=rnd.uniform(-1.5, 1.5)))
        tip, dtip = pts[-1], (pts[-1] - pts[-2]).normalized()
        for j in range(2):   # frayed threads off the end
            side = Vector((-dtip.y, dtip.x, 0)) * (j - 0.5) * 0.9
            q = [tip, tip + (dtip + side) * 0.12 + Vector((0, 0, rnd.uniform(-0.03, 0.04))), tip + (dtip + side * 1.5) * 0.24 + Vector((0, 0, rnd.uniform(-0.05, 0.08)))]
            rib.append(sweep(spline(q, 6), [0.008, 0.007, 0.006, 0.005, 0.004, 0.002], RIFT() if (i + j) % 3 == 0 else m, segs=3))
    for i in range(10):   # loose glowing threads pulled from the skirt
        a = i / 10 * math.tau + 0.3
        z0 = rnd.uniform(1.2, 1.7)
        r0 = 0.35 + (1.7 - z0) * 0.3
        q = []
        for k in range(10):
            t = k / 9
            ang = a + 0.8 * t
            R = r0 + 0.8 * t
            q.append((math.cos(ang) * R * 1.1, math.sin(ang) * R * 0.85, z0 - 0.6 * t * t + 0.05 * math.sin(t * 7)))
        rib.append(sweep(q, [0.009 - 0.006 * k / 9 for k in range(10)], RIFT(), segs=3))
    for o in rib:
        smooth(o, 70)
    allp = [robe, skin, hair] + trims + eyes + cracks + sleeves + crown + rib
    zs = [v.co.z for o in allp for v in o.data.vertices]
    scale_about(allp, (0, 0, min(zs)), 3.2 / (max(zs) - min(zs)))   # fit to 3.2 m, ribbon tips to crown
    publish(allp, 'unraveller_body', ground=True)


def element_orb():
    R = 0.27
    parts = []
    for rot in ((0, 0, 0), (math.pi / 2, 0, 0), (math.pi / 2, 0, math.pi / 3), (math.pi / 2, 0, 2 * math.pi / 3)):
        parts.append(torus(R, 0.018 if rot == (0, 0, 0) else 0.013, (0, 0, 0), rot, V_GOLD(), 18, 4))
    for zz in (0.15, -0.15):   # latitude rings
        parts.append(torus(math.sqrt(R * R - zz * zz), 0.008, (0, 0, zz), (0, 0, 0), V_GOLD(), 14, 3))
    for i in range(6):   # filigree scrolls between the meridians
        a = (i + 0.5) / 6 * math.tau
        pts = []
        for k in range(8):
            t = k / 7
            th = t * 1.6 * math.pi
            rr = 0.055 * (1 - 0.7 * t)
            u, v = math.cos(th) * rr, math.sin(th) * rr + 0.02
            p = Vector((math.cos(a + u / R) * R, math.sin(a + u / R) * R, v))
            pts.append(p * (R + 0.004) / p.length)
        if i % 2:
            pts = [Vector((q.x, q.y, -q.z)) for q in pts]
        parts.append(sweep(pts, 0.0075, V_GOLD(), segs=3))
    parts.append(lathe([(0.0, R + 0.1), (0.018, R + 0.06), (0.03, R + 0.03), (0.045, R + 0.005), (0.05, R - 0.01)], V_GOLD(), 8, shade=45))
    parts.append(lathe([(0.05, -R + 0.01), (0.045, -R - 0.005), (0.03, -R - 0.03), (0.018, -R - 0.05), (0.0, -R - 0.08)], V_GOLD(), 8, shade=45))
    for o in parts:
        smooth(o, 60)
    publish(parts, 'element_orb', origin=(0, 0, 0))


# ================================================================ Haunt props
def scroll(c, a0, r0, turns, n, plane_u, plane_v, shrink=0.75):
    """A flat iron spiral curl centred at c in the (u, v) plane."""
    c, U, V = Vector(c), Vector(plane_u), Vector(plane_v)
    pts = []
    for k in range(n):
        t = k / (n - 1)
        th = a0 + t * turns * math.tau
        r = r0 * (1 - shrink * t)
        pts.append(c + U * math.cos(th) * r + V * math.sin(th) * r)
    return pts


def soul_lantern():
    parts = [lathe([(0.2, 0.0), (0.2, 0.05), (0.15, 0.08), (0.12, 0.16), (0.07, 0.2), (0.05, 0.3), (0.0, 0.3)], IRON(), 8, shade=0)]
    parts.append(cyl(0.035, 2.0, (0, 0, 1.28), verts=8, m=IRON()))
    for z in (0.95, 2.1):
        parts.append(lathe([(0.0, z - 0.05), (0.05, z - 0.05), (0.065, z - 0.02), (0.065, z + 0.02), (0.05, z + 0.05), (0.0, z + 0.05)], IRON(), 8, shade=0))
    for i in range(4):   # curled feet
        a = i / 4 * math.tau + math.pi / 4
        U = Vector((math.cos(a), math.sin(a), 0))
        pts = [Vector((0, 0, 0.26)) + U * 0.05] + scroll(U * 0.2 + Vector((0, 0, 0.12)), math.pi, 0.1, 0.9, 10, U, (0, 0, 1))
        parts.append(sweep(spline([tuple(p) for p in pts], 12), 0.016, IRON(), segs=5))
    # Shepherd's crook arm to hang the lantern from, with an iron curl beneath.
    crook = spline([(0, 0, 2.2), (0, 0, 2.42), (0.1, 0, 2.56), (0.28, 0, 2.58), (0.42, 0, 2.5), (0.46, 0, 2.38)], 16)
    parts.append(sweep(crook, [0.034 - 0.012 * k / 15 for k in range(16)], IRON(), segs=6))
    parts.append(sweep(spline([tuple(p) for p in [Vector((0.02, 0, 2.02))] + scroll((0.2, 0, 2.3), math.pi * 1.1, 0.12, 1.1, 12, (1, 0, 0), (0, 0, 1))], 16),
                       0.014, IRON(), segs=5))
    parts.append(sweep(spline([tuple(p) for p in scroll((-0.1, 0, 2.28), 0.0, 0.08, 1.0, 10, (-1, 0, 0), (0, 0, 1))], 12), 0.012, IRON(), segs=5))
    parts.append(sphere(0.04, (0, 0, 2.3), (1, 1, 1.3), 8, IRON()))
    # Hanging lantern: hook, ring, pyramid cap, four-post cage, glass, tray, ghost flame.
    X, top = 0.46, 2.3
    parts.append(torus(0.03, 0.008, (X, 0, top + 0.03), (math.pi / 2, 0, 0), IRON(), 10, 4))
    cap = cyl(0.17, 0.12, (X, 0, top - 0.06), (0, 0, math.pi / 4), 4, r2=0.02, m=IRON())
    parts.append(cap)
    parts.append(box((0.24, 0.24, 0.03), (X, 0, top - 0.13), m=IRON(), bevel=0.008, segs=1))
    parts.append(box((0.26, 0.26, 0.04), (X, 0, top - 0.55), m=IRON(), bevel=0.01, segs=1))
    parts.append(cyl(0.06, 0.07, (X, 0, top - 0.6), verts=8, r2=0.01, m=IRON()))
    for sx in (1, -1):
        for sy in (1, -1):
            parts.append(box((0.024, 0.024, 0.42), (X + sx * 0.11, sy * 0.11, top - 0.34), m=IRON(), bevel=0.005, segs=1))
    parts.append(box((0.2, 0.2, 0.38), (X, 0, top - 0.34), m=L_GLASS(), bevel=0))
    fl = [sphere(0.055, (X, 0, top - 0.44), (1, 1, 1.1), 12), cyl(0.05, 0.14, (X, 0, top - 0.37), verts=12, r2=0.004)]
    parts.append(sculpt(fl, 0.006, FLAME(), 160, it=2, angle=80))
    for o in parts:
        if o.data.materials[0].name == 'wroughtIron' and o is not parts[0]:
            smooth(o, 50)
    flat(cap)
    publish(parts, 'soul_lantern')


def ward_totem():
    stone = []
    stone.append(slab((1.0, 1.0, 0.24), (0, 0, 0.12), m=W_STONE(), cuts=0, jit=0.03, bevel=0.03))
    stone.append(slab((0.8, 0.8, 0.18), (0, 0, 0.33), m=W_STONE(), cuts=0, jit=0.03, bevel=0.03))
    # Tapered square shaft rising into a pyramidion (a 4-segment lathe turned 45 degrees).
    def half(z):
        return (0.58 - 0.16 * (z - 0.42) / 2.3) / 2
    k = math.sqrt(2)
    shaft = lathe([(0.0, 0.42), (half(0.42) * k, 0.42), (half(1.5) * k, 1.5), (half(2.72) * k, 2.72), (half(2.72) * k * 1.06, 2.74),
                   (half(2.72) * k * 1.06, 2.78), (0.012, 3.04), (0.0, 3.04)], W_STONE(), 4, shade=0, rot=(0, 0, math.pi / 4))
    bev = shaft.modifiers.new('bev', 'BEVEL')
    bev.width = 0.03
    bev.segments = 2
    bev.limit_method = 'ANGLE'
    bev.angle_limit = math.radians(30)
    apply_mod(shaft, bev)
    cut = []
    zs = (0.85, 1.22, 1.59, 1.96, 2.33)
    for z in zs:   # five empty round sockets up the front face
        wf = (0.58 - 0.16 * (z - 0.42) / 2.3) / 2
        cut.append(cyl(0.085, 0.14, (0, -wf, z), (math.pi / 2, 0, 0), 12))
    # Rune band: glowing glyph strokes inlaid round all four faces.
    zb = 2.56
    strokes = []
    for g in range(3):
        x0 = (g - 1) * 0.12
        strokes += [((x0, -0.05), (x0, 0.05)), ((x0, 0.05), (x0 + 0.04, 0.0)) if g != 1 else ((x0 - 0.04, 0.03), (x0 + 0.04, -0.03)),
                    ((x0, -0.01), (x0 - 0.035, -0.045))]
    runes = []
    wf = half(zb)
    for f in range(4):
        rot = f * math.pi / 2
        for (a, b) in strokes:
            a, b = Vector((a[0], 0, a[1])), Vector((b[0], 0, b[1]))
            mid = (a + b) / 2
            L = (b - a).length + 0.022
            ang = math.atan2(b.z - a.z, b.x - a.x)
            c = box((L, 0.02, 0.022), (mid.x, -wf - 0.002, zb + mid.z), (0, -ang, 0), W_RUNE(), 0)
            runes.append(xform(c, (0, 0, 0), (0, 0, rot)))
    runes += [box((wf * 2 + 0.012, wf * 2 + 0.012, 0.018), (0, 0, zb + dz), (0, 0, 0), W_RUNE(), 0) for dz in (-0.085, 0.085)]   # band borders
    carve(shaft, cut, transfer=True)
    dis = shaft.modifiers.new('dis', 'DECIMATE')   # merge the boolean fan-triangles back into clean faces
    dis.decimate_type = 'DISSOLVE'
    dis.angle_limit = math.radians(1.0)
    dis.delimit = {'MATERIAL'}
    apply_mod(shaft, dis)
    flat(shaft)
    stone += [shaft] + runes
    for z in zs:   # raised rims round the sockets
        wf = (0.58 - 0.16 * (z - 0.42) / 2.3) / 2
        stone.append(torus(0.095, 0.018, (0, -wf - 0.005, z), (math.pi / 2, 0, 0), W_STONE(), 10, 3))
    # Two chains spiralling round the shaft, crossing between the sockets.
    links = []
    for k, (z0, ph, dz) in enumerate(((0.62, -math.pi / 2 - 0.9, 1.3), (1.05, -math.pi / 2 + 0.9, 1.3))):
        path = []
        for i in range(120):
            t = i / 119
            th = ph + t * 1.0 * math.tau * (1 if k == 0 else -1)
            z = z0 + t * dz
            w = (0.58 - 0.16 * (z - 0.42) / 2.3) / 2 + 0.035
            c, s_ = math.cos(th), math.sin(th)
            e = 1 / max(abs(c), abs(s_)) ** 0.85
            path.append(Vector((c * w * e * 1.0, s_ * w * e, z + 0.05 * math.sin(th * 2))))
        # resample by arc length into links
        acc, L = [0.0], 0.0
        for i in range(1, len(path)):
            L += (path[i] - path[i - 1]).length
            acc.append(L)
        step = 0.125
        n = int(L / step)
        j = 0
        for q in range(n):
            d = q * step
            while acc[j + 1] < d:
                j += 1
            f = (d - acc[j]) / (acc[j + 1] - acc[j])
            p = path[j].lerp(path[j + 1], f)
            T = (path[j + 1] - path[j]).normalized()
            lk = torus(0.064, 0.016, (0, 0, 0), m=RUST(), seg=6, minor=3)
            lk.scale = (1.0, 0.62, 1.0)
            apply_tf(lk)
            R = Vector((1, 0, 0)).rotation_difference(T).to_matrix().to_4x4() @ Matrix.Rotation(math.pi / 2 * (q % 2), 4, 'X')
            lk.matrix_world = Matrix.Translation(p) @ R
            apply_tf(lk)
            links.append(lk)
    ch = join(links)
    smooth(ch, 60)
    publish(stone + [ch], 'ward_totem')


def miner_spirit():
    # Ghost body: burly torso, beard, arms; the body thins into a curling wisp instead of legs.
    P = [sphere(1, (0, 0.02, 1.2), (0.25, 0.2, 0.28), 20), sphere(1, (0, 0.0, 1.36), (0.29, 0.21, 0.18), 20),
         sphere(0.13, (0, -0.02, 1.6), (1.0, 1.05, 1.08), 18),                       # head
         sphere(1, (0, -0.1, 1.5), (0.12, 0.08, 0.12), 14),                          # big beard
         sphere(1, (0, -0.13, 1.44), (0.08, 0.06, 0.08), 12),
         sphere(0.03, (0, -0.14, 1.6), (1.0, 1.0, 1.0), 10)]                         # nose
    for sx in (1, -1):
        P.append(sphere(1, (sx * 0.05, -0.13, 1.55), (0.06, 0.035, 0.028), 10))       # moustache
    P += chain([(0, 0.02, 1.05), (0.02, 0.06, 0.8), (0.1, 0.12, 0.55), (0.22, 0.2, 0.32), (0.2, 0.34, 0.14), (0.05, 0.36, 0.04)],
               0.2, 0.012, step=0.02)
    # right arm up, hand at the shoulder gripping the pick handle; left arm hanging, holding nothing
    P += chain([(0.25, 0.0, 1.4), (0.32, -0.08, 1.22), (0.2, -0.17, 1.36)], 0.07, 0.05, step=0.02)
    P.append(sphere(0.055, (0.19, -0.19, 1.39), segs=12))
    P += chain([(-0.25, 0.0, 1.4), (-0.3, 0.0, 1.18), (-0.28, -0.05, 0.95)], 0.07, 0.05, step=0.02)
    P.append(sphere(0.055, (-0.28, -0.06, 0.9), segs=12))
    cut = [sphere(0.03, (sx * 0.045, -0.12, 1.635), (1.2, 1.0, 0.8), 10) for sx in (1, -1)]
    body = sculpt(P, 0.012, GHOST(), 2300, it=3, cutters=cut, angle=60)
    out = [body]
    for sx in (1, -1):
        out.append(sphere(0.016, (sx * 0.045, -0.115, 1.635), segs=8, m=M_LAMP()))
    # Wisps curling off the tail.
    for (p0, d, L) in (((0.18, 0.2, 0.4), (1, 0.3, -0.2), 0.3), ((-0.02, 0.1, 0.62), (-1, 0.4, -0.3), 0.32), ((0.12, 0.33, 0.12), (0.2, 1, 0.2), 0.25)):
        p0, d = Vector(p0), Vector(d).normalized()
        q = spline([p0, p0 + d * L * 0.5 + Vector((0, 0, 0.05)), p0 + d * L + Vector((0, 0, 0.12))], 8)
        out.append(sweep(q, [0.04 - 0.035 * k / 7 for k in range(8)], GHOST(), segs=6))
    # Miner's helmet with a lamp.
    out.append(lathe([(0.0, 1.68), (0.2, 1.68), (0.2, 1.7), (0.15, 1.72), (0.145, 1.78), (0.12, 1.84), (0.07, 1.87), (0.0, 1.875)], GHOST(), 20, shade=40))
    out.append(cyl(0.045, 0.05, (0, -0.15, 1.77), (math.radians(80), 0, 0), 12, m=GHOST()))
    out.append(cyl(0.036, 0.012, (0, -0.178, 1.765), (math.radians(80), 0, 0), 12, m=M_LAMP()))
    # Pickaxe over the right shoulder.
    A, B = Vector((0.16, -0.26, 1.33)), Vector((0.3, 0.42, 1.8))
    out.append(cyl(0.022, (B - A).length, tuple((A + B) / 2), tuple(Vector((0, 0, 1)).rotation_difference(B - A).to_euler()), 8, m=GHOST()))
    h = (B - A).normalized()
    k = h.cross(Vector((1, 0, 0))).normalized()
    C = B - h * 0.03
    pick = spline([C + k * 0.3 - h * 0.08, C + k * 0.15 - h * 0.01, C, C - k * 0.15 - h * 0.01, C - k * 0.3 - h * 0.08], 11)
    out.append(sweep(pick, [0.006, 0.018, 0.028, 0.034, 0.038, 0.04, 0.038, 0.034, 0.028, 0.018, 0.006], GHOST(), segs=6, squash=0.6))
    for o in out[3:]:
        smooth(o, 60)
    publish(out, 'miner_spirit', ground=True)


def bone_soldier():
    sp, sc, eyes = skull_parts(1.15, (0, -0.02, 1.57), jaw_open=0.012)
    skull = sculpt(sp, 0.006, BONE(), 750, it=2, cutters=sc, angle=55)
    P = ribcage((0, 0.0, 1.26), 0.15, 0.11, 0.28, 0.013, n=6)
    P += chain([(0, 0.02, 1.44), (0, 0.0, 1.6)], 0.022, 0.02, step=0.012)
    P += chain([(0, 0.12, 1.1), (0, 0.1, 1.02), (0, 0.06, 0.96)], 0.025, 0.025, step=0.014)          # lumbar spine
    for sx in (1, -1):
        P.append(sphere(1, (sx * 0.1, 0.03, 0.98), (0.075, 0.04, 0.07), 12, rot=(0, 0, 0.4 * sx)))   # iliac wings
        P += chain([(sx * 0.03, 0.0, 1.43), (sx * 0.19, 0.02, 1.43)], 0.014, 0.013, step=0.008)       # clavicles
        P.append(sphere(1, (sx * 0.13, 0.07, 1.36), (0.05, 0.02, 0.07), 10))                          # shoulder blades
        # legs: femur, knee, tibia, foot
        hip, knee, ank = Vector((sx * 0.1, 0.0, 0.9)), Vector((sx * 0.11, -0.03, 0.5)), Vector((sx * 0.11, 0.0, 0.09))
        P.append(sphere(0.035, tuple(hip), segs=10))
        P += chain([tuple(hip), tuple(knee)], 0.026, 0.024, step=0.013)
        P.append(sphere(0.038, tuple(knee), (1.1, 1.0, 0.9), 10))
        P += chain([tuple(knee), tuple(ank)], 0.024, 0.02, step=0.012)
        P += chain([tuple(knee + Vector((sx * 0.03, 0.01, 0))), tuple(ank + Vector((sx * 0.03, 0.01, 0.02)))], 0.012, 0.011, step=0.01)
        P.append(sphere(0.03, tuple(ank), segs=10))
        P.append(sphere(1, (sx * 0.11, 0.02, 0.035), (0.03, 0.035, 0.03), 10))                       # heel
        for t in range(3):
            P += chain([(sx * (0.11 + (t - 1) * 0.025), -0.02, 0.05), (sx * (0.11 + (t - 1) * 0.03), -0.15, 0.015)], 0.011, 0.009, step=0.007)
    P.append(sphere(1, (0, 0.06, 0.93), (0.05, 0.03, 0.06), 10))                                       # sacrum
    # right arm: sword forward; left arm: shield across the body
    for (S, E, W) in (((0.19, 0.02, 1.41), (0.24, 0.0, 1.14), (0.25, -0.22, 1.02)), ((-0.19, 0.02, 1.41), (-0.26, -0.05, 1.15), (-0.22, -0.28, 1.13))):
        S, E, W = Vector(S), Vector(E), Vector(W)
        P.append(sphere(0.032, tuple(S), segs=10))
        P += chain([tuple(S), tuple(E)], 0.022, 0.02, step=0.011)
        P.append(sphere(0.03, tuple(E), segs=10))
        P += chain([tuple(E), tuple(W)], 0.017, 0.015, step=0.009)
        P += chain([tuple(E + Vector((0, 0.02, 0.0))), tuple(W + Vector((0, 0.015, 0.01)))], 0.012, 0.011, step=0.008)
        P.append(sphere(1, tuple(W + (W - E).normalized() * 0.05), (0.035, 0.045, 0.035), 10))       # clenched hand
    body = sculpt(P, 0.009, BONE(), 2600, it=2, angle=55)
    for v in body.data.vertices:   # chunkier bones for the stylised look
        v.co += v.normal * 0.006
    out = [skull, body]
    # Rusty helmet: kettle hat with a nasal bar and a crest spike.
    top = 1.57 + 0.145 * 1.15 + 0.06
    out.append(lathe([(0.0, top + 0.13), (0.06, top + 0.125), (0.11, top + 0.09), (0.14, top + 0.03), (0.145, top - 0.02), (0.2, top - 0.05),
                      (0.205, top - 0.07), (0.17, top - 0.06), (0.13, top - 0.02), (0.125, top + 0.03), (0.1, top + 0.08), (0.0, top + 0.11)], RUST(), 18, shade=40))
    out.append(box((0.03, 0.02, 0.12), (0, -0.18, top - 0.08), (0.15, 0, 0), RUST(), 0.006, 1))
    out.append(crystal((0, 0.0, top + 0.12), (0, 0.2, 1), 0.1, 0.025, RUST(), sides=4, tip=0.6))
    # Belt and a rusty pauldron on the shield shoulder.
    out.append(torus(0.13, 0.018, (0, 0.02, 0.99), m=RUST(), seg=16, minor=4))
    p = slab((0.18, 0.2, 0.025), (0, 0, 0), m=RUST(), cuts=(2, 2, 0), jit=0.0, bevel=0.006)
    bend(p, 0.12)
    xform(p, (-0.2, 0.02, 1.34), (0, math.radians(-30), 0))
    out.append(p)
    # Notched sword held forward.
    hand = Vector((0.25, -0.22, 1.02)) + (Vector((0.25, -0.22, 1.02)) - Vector((0.24, 0.0, 1.14))).normalized() * 0.05
    d = Vector((0.12, -0.38, 0.92)).normalized()
    blade = box((0.06, 0.012, 0.72), (0, 0, 0.36), m=RUST(), bevel=0.004, segs=1)
    tip = cyl(0.043, 0.1, (0, 0, 0.77), (0, 0, math.pi / 4), 4, r2=0.0, m=RUST())
    tip.scale = (1.0, 0.2, 1.0)
    apply_tf(tip)
    notches = [box((0.04, 0.05, 0.03), (0.03, 0, z), (0, 0.6, 0), bevel=0) for z in (0.3, 0.52)] + [box((0.04, 0.05, 0.025), (-0.03, 0, 0.42), (0, -0.6, 0), bevel=0)]
    blade = join([blade, tip])
    carve(blade, notches)
    guard = box((0.2, 0.035, 0.03), (0, 0, 0.0), m=RUST(), bevel=0.008, segs=1)
    grip = cyl(0.017, 0.14, (0, 0, -0.08), verts=8, m=BONE())
    pommel = sphere(0.03, (0, 0, -0.16), segs=10, m=RUST())
    sword = join([blade, guard, grip, pommel])
    sword.matrix_world = Matrix.Translation(hand) @ Vector((0, 0, 1)).rotation_difference(d).to_matrix().to_4x4()
    apply_tf(sword)
    flat(sword)
    out.append(sword)
    # Round shield strapped to the left forearm, dented rim, rivets and boss.
    sh = lathe([(0.0, 0.065), (0.07, 0.06), (0.08, 0.035), (0.1, 0.03), (0.28, 0.018), (0.3, 0.02), (0.31, 0.0), (0.3, -0.015), (0.0, -0.015)], RUST(), 24, shade=35)
    for i in range(10):
        a = i / 10 * math.tau
        sh = join([sh, sphere(0.012, (math.cos(a) * 0.265, math.sin(a) * 0.265, 0.024), segs=6, m=RUST())])
    n = Vector((-0.45, -1, 0.05)).normalized()
    sh.matrix_world = Matrix.Translation(Vector((-0.3, -0.3, 1.1))) @ Vector((0, 0, 1)).rotation_difference(n).to_matrix().to_4x4()
    apply_tf(sh)
    out.append(sh)
    out += [ico(0.015, tuple(e), 1, m=SOUL()) for e in eyes]
    publish(out, 'bone_soldier')


# ================================================================ build + export
BUILD = [lich_body, lich_arm, phylactery, queen_body, queen_arm, tyrant_body, tyrant_plates, tyrant_arm,
         unraveller_body, element_orb, soul_lantern, ward_totem, miner_spirit, bone_soldier]
ONLY = os.environ.get('BOSS_ONLY')  # dev aid: BOSS_ONLY=lich_body,phylactery builds just those
for fn in BUILD:
    if ONLY and fn.__name__ not in ONLY.split(','):
        continue
    fn()
if ONLY:
    if os.environ.get('BOSS_OUT'):
        bpy.ops.export_scene.gltf(filepath=os.environ['BOSS_OUT'], export_format='GLB', export_apply=True, export_yup=True, export_materials='EXPORT')
    raise SystemExit

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True, export_yup=True, export_materials='EXPORT')
print('EXPORTED', OUT)
