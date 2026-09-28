"""Builds the Sundered Deep library (the Crag Golem, cavern set pieces and the valley story
pieces) and exports it as one glTF binary.

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/build_deep.py

Same conventions as build_sanctums.py: organic forms are blocked out from overlapping
primitives, fused with a voxel remesh, roughened with fractal noise so they read as sculpted
stone, carved with booleans and decimated to a game budget. Hard-surface pieces are lathed,
swept or bevelled. Front faces -Y (+Z in three.js); units are metres.

Every prop is one joined mesh named after the prop. Origins sit on the floor under the piece
except where the prop animates about a pivot (golem shoulder/hip/neck, owl shoulder, wheel
axle, stalactite ceiling root).
"""
import bpy, bmesh, math, os, random
import numpy as np
from mathutils import Vector, Matrix, noise
from mathutils.bvhtree import BVHTree

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'assets', 'models', 'deep.glb')
random.seed(23)

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


# Golem
G_ROCK = lambda: mat('golemRock', '#8a6a4a', 0.85)
G_MOSS = lambda: mat('golemMoss', '#5f7a3a', 0.9)
G_CORE = lambda: mat('golemCore', '#ffb347', 0.35, 0, '#ff8a1a', 4.0)
G_PLATE = lambda: mat('golemPlate', '#6d6a72', 0.8)
G_RUNE = lambda: mat('golemPlateRune', '#45424b', 0.9)
G_EYE = lambda: mat('golemEye', '#fff3b0', 0.3, 0, '#ffd36b', 5.0)
HEART = lambda: mat('heartstoneGlow', '#ffb347', 0.3, 0, '#ff8a1a', 3.0)
# Cavern
COLOSSUS = lambda: mat('colossusStone', '#9a8266', 0.9)
C_EYE = lambda: mat('colossusEye', '#ffe9a8', 0.3, 0, '#ffc23a', 6.0)
GEO_ROCK = lambda: mat('geodeRock', '#6a5a54', 0.9)
GEO_RIND = lambda: mat('geodeRind', '#7e6a8e', 0.75)
GEO_BAND = lambda: mat('geodeBand', '#ab9cb8', 0.6)
GEO_CRYS = lambda: mat('geodeCrystal', '#c9a8ff', 0.2, 0, '#8a5aff', 1.5)
GEO_PINK = lambda: mat('geodeCrystalPink', '#ffb8e8', 0.2, 0, '#e25ad0', 1.5)
F_STEM = lambda: mat('fungusStem', '#d8d0c0', 0.7)
F_CAP = lambda: mat('fungusCap', '#3a7a8a', 0.6)
F_SPOT = lambda: mat('fungusSpot', '#bff4ee', 0.5, 0, '#7ff5ff', 0.8)
F_GLOW = lambda: mat('fungusGlow', '#7ff5ff', 0.4, 0, '#2fd8e8', 2.5)
DRIP = lambda: mat('dripstone', '#b8a48a', 0.8)
STATUE = lambda: mat('statueStone', '#a89478', 0.85)
M_WOOD = lambda: mat('mineWood', '#7a5230', 0.75)
M_IRON = lambda: mat('mineIron', '#4a4650', 0.5, 0.6)
CHAR = lambda: mat('charredWood', '#2b1d16', 0.95)
VEIN = lambda: mat('veinRock', '#5a4a44', 0.9)
CROWN = lambda: mat('crownStone', '#7d7068', 0.8)
# Valley story
O_FEATH = lambda: mat('owlFeather', '#8a7a66', 0.85)
O_TIP = lambda: mat('owlFeatherTip', '#c9bca4', 0.85)
O_BELLY = lambda: mat('owlBelly', '#d8ccb4', 0.85)
O_EYE = lambda: mat('owlEye', '#ffd36b', 0.3, 0, '#ffb000', 1.2)
O_PUPIL = lambda: mat('owlPupil', '#1b1410', 0.3)
O_GLINT = lambda: mat('owlGlint', '#ffffff', 0.2, 0, '#ffffff', 1.0)
O_BEAK = lambda: mat('owlBeak', '#c9a24a', 0.5)
O_GLASS = lambda: mat('owlGlass', '#cfe8ff', 0.05, 0, None, 0, alpha=0.15)
BRASS = lambda: mat('brass', '#c9a24a', 0.35, 0.8)
S_WOOD = lambda: mat('staffWood', '#4a3222', 0.75)
S_CRYS = lambda: mat('staffCrystal', '#d8c8ff', 0.2, 0, '#9b7bff', 4.0)
RUIN = lambda: mat('ruinStone', '#cfc4b0', 0.8)
RUIN_D = lambda: mat('ruinStoneDark', '#a89c88', 0.85)


# ---------------------------------------------------------------- helpers (as build_sanctums.py)
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


def publish(objs, name, origin=(0, 0, 0)):
    objs = [o for o in objs if o is not None]
    o = join(objs, name) if len(objs) > 1 else objs[0]
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


def moss(o, amount=0.55, freq=3.0, up=0.55, seed=4):
    off = Vector((seed * 3.3, seed * 1.7, seed * 5.1))
    return paint(o, G_MOSS(), lambda c, n: n.z > up and noise.noise(c * freq + off) > 1 - amount * 2 + 0.1)


# ================================================================ Crag Golem
SHOULDER_R = Vector((0.66, -0.02, 1.24))  # torso-space centre of the right shoulder mass


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


def golem_torso():
    parts = [
        sphere(0.5, (0, 0.06, 0.44), (1.24, 1.06, 0.86)),         # belly / pelvis
        sphere(0.5, (0, 0.0, 0.98), (1.62, 1.24, 1.12)),         # barrel chest
        sphere(0.4, tuple(SHOULDER_R), (1.05, 1.1, 0.98)),       # shoulder boulders
        sphere(0.4, (-SHOULDER_R.x, SHOULDER_R.y, SHOULDER_R.z), (1.05, 1.1, 0.98)),
        sphere(0.46, (0, 0.34, 1.32), (1.3, 0.9, 0.76)),          # hunched back
        chunk((0.5, 0.4, 0.4), (0.34, -0.36, 0.55)),              # belly boulders
        chunk((0.46, 0.4, 0.38), (-0.36, -0.34, 0.5)),
        chunk((0.6, 0.4, 0.3), (0.0, -0.28, 0.26)),
        chunk((0.5, 0.5, 0.42), (0.55, 0.2, 0.75)),               # flank slabs
        chunk((0.5, 0.5, 0.42), (-0.55, 0.2, 0.78)),
    ]
    parts += chunks_on((0, 0.05, 0.95), (0.8, 0.6, 0.62), 16, 0.13, 0.22, zmin=-0.5)
    parts += chunks_on(tuple(SHOULDER_R), (0.36, 0.36, 0.36), 4, 0.12, 0.18, zmin=0.0)
    parts += chunks_on((-SHOULDER_R.x, SHOULDER_R.y, SHOULDER_R.z), (0.36, 0.36, 0.36), 4, 0.12, 0.18, zmin=0.0)
    cutters = [sphere(0.3, (0, -0.64, 1.0), (1.05, 1.0, 1.15), 20),     # core cavity
               sphere(0.26, (0, -0.2, 1.72), (1.0, 1.1, 0.8), 16)]       # neck seat between the shoulders
    rock = sculpt(parts, 0.03, G_ROCK(), 4200, amp=0.05, freq=2.5, seed=1, it=2, factor=0.5, floor=0.0, cutters=cutters, angle=36)
    moss(rock, 0.5, 2.6, 0.5)
    core = ico(0.2, (0, -0.37, 1.0), 2, (1.0, 0.8, 1.1), G_CORE())
    flat(core)
    out = [rock, core]
    out += crystal_cluster((-0.66, 0.26, 1.46), (-0.5, 0.6, 0.8), 3, 0.3, 0.07, HEART())
    out += crystal_cluster((0.45, 0.4, 0.72), (0.5, 0.8, 0.1), 3, 0.26, 0.06, HEART())
    publish(out, 'golem_torso')


def rune_cutters(lines, z, depth=0.04, w=0.028):
    """Lines given as ((x0, y0), (x1, y1)) on a slab's +Z face at height z."""
    out = []
    for (a, b) in lines:
        a, b = Vector((*a, 0)), Vector((*b, 0))
        mid = (a + b) / 2
        L = (b - a).length + w
        ang = math.atan2(b.y - a.y, b.x - a.x)
        out.append(box((L, w, depth * 2), (mid.x, mid.y, z), (0, 0, ang), G_RUNE(), 0))
    return out


def bend(o, R):
    """Curl a flat slab (lying in XY, facing +Z) over a cylinder of radius R about the Y axis."""
    for v in o.data.vertices:
        x, z = v.co.x, v.co.z
        th = x / R
        rr = R + z
        v.co.x = rr * math.sin(th)
        v.co.z = rr * math.cos(th)  # circle centre at the origin
    o.data.update()


def golem_plates():
    out = []
    # Chest plate: covers the core cavity, gently curved, carved with a geomancer's mountain glyph:
    # two stacked peaks over a jagged strata line, flanked by border grooves (no enclosing circle).
    cp = slab((0.86, 0.78, 0.17), (0, 0, 0), m=G_PLATE(), cuts=3, jit=0.05)
    t = 0.085
    runes = rune_cutters([((-0.24, -0.1), (0, 0.16)), ((0, 0.16), (0.24, -0.1)), ((-0.24, -0.1), (0.24, -0.1)),   # great peak
                          ((-0.12, 0.17), (0, 0.3)), ((0, 0.3), (0.12, 0.17)),                                    # stacked peak
                          ((-0.25, -0.24), (-0.12, -0.18)), ((-0.12, -0.18), (0, -0.26)), ((0, -0.26), (0.12, -0.18)),
                          ((0.12, -0.18), (0.25, -0.24)),                                                          # strata
                          ((-0.33, -0.3), (-0.33, 0.3)), ((0.33, -0.3), (0.33, 0.3))], t)
    carve(cp, runes, transfer=True)
    bend(cp, 1.1)
    cp.location = (0, 0, -1.1)
    apply_tf(cp)
    cp.rotation_euler = (math.radians(82), 0, 0)   # +Z face → front (-Y), top leaning back a touch
    cp.location = (0, -0.72, 1.0)
    apply_tf(cp)
    out.append(cp)
    # Pauldrons: bent slabs over each shoulder, rune chevrons on top.
    for sx in (1, -1):
        p = slab((0.9, 0.84, 0.17), (0, 0, 0), m=G_PLATE(), cuts=(4, 2, 1), jit=0.05)
        rc = rune_cutters([((-0.2, -0.26), (0.0, -0.14)), ((0.0, -0.14), (0.2, -0.26)),
                           ((-0.2, -0.06), (0.0, 0.06)), ((0.0, 0.06), (0.2, -0.06)),
                           ((-0.2, 0.14), (0.0, 0.26)), ((0.0, 0.26), (0.2, 0.14))], 0.085)
        carve(p, rc, transfer=True)
        R = 0.47
        bend(p, R)
        p.rotation_euler = (0, math.radians(26) * sx, 0)
        p.location = (SHOULDER_R.x * sx, SHOULDER_R.y, SHOULDER_R.z - 0.06)
        apply_tf(p)
        out.append(p)
    for o in out:
        smooth(o, 35)
    publish(out, 'golem_plates')


def golem_head():
    parts = [
        box((0.56, 0.5, 0.42), (0, 0.02, 0.33), bevel=0),               # cranium block
        box((0.7, 0.26, 0.15), (0, -0.17, 0.5), (0.2, 0, 0), bevel=0),   # heavy brow
        box((0.5, 0.4, 0.22), (0, -0.07, 0.13), bevel=0),               # jaw
        sphere(0.2, (0, 0.04, 0.04), (1.1, 1.0, 0.7)),                   # neck stub
        sphere(0.09, (0, -0.25, 0.33), (0.8, 1.0, 1.3)),                  # nose ridge
        sphere(0.12, (0.13, 0.05, 0.56), (1.2, 1.1, 0.7)),                # crown lumps
        sphere(0.1, (-0.12, 0.12, 0.55), (1.2, 1.1, 0.7)),
        sphere(0.11, (0.3, 0.0, 0.3), (0.6, 1.2, 1.3)),                  # cheek slabs
        sphere(0.11, (-0.3, 0.0, 0.3), (0.6, 1.2, 1.3)),
    ]
    cutters = [sphere(0.085, (0.15, -0.28, 0.38), (1.25, 1.0, 0.8), 14), sphere(0.085, (-0.15, -0.28, 0.38), (1.25, 1.0, 0.8), 14),
               box((0.26, 0.2, 0.025), (0, -0.3, 0.15), bevel=0)]
    h = sculpt(parts, 0.022, G_ROCK(), 1250, amp=0.025, freq=6, seed=3, it=3, cutters=cutters, angle=45)
    moss(h, 0.55, 6.0, 0.6, seed=7)
    out = [h]
    for sx in (1, -1):
        e = crystal((0, 0, 0), (0, 0, 1), 0.16, 0.05, G_EYE(), sides=4, tip=0.5, double=True, roll=math.pi / 4, jitter=0.0)
        e.scale = (0.8, 0.55, 1.0)
        e.rotation_euler = (0, math.radians(90) * sx, math.radians(-12) * sx)
        e.location = (0.07 * sx, -0.245, 0.385)
        apply_tf(e)
        out.append(e)
    publish(out, 'golem_head')


def golem_arm():
    parts = [ico(0.33, (0.05, 0, -0.02), 2, (1.0, 1.0, 0.92)),                          # shoulder
             chunk((0.44, 0.42, 0.5), (0.08, 0.0, -0.36)),                              # upper arm
             chunk((0.38, 0.38, 0.3), (0.1, 0.02, -0.62)),
             ico(0.25, (0.12, 0.07, -0.8), 1),                                          # elbow
             chunk((0.5, 0.48, 0.32), (0.1, -0.02, -0.96)),                             # forearm, flaring
             chunk((0.6, 0.56, 0.34), (0.1, -0.04, -1.22)),
             chunk((0.76, 0.7, 0.46), (0.1, -0.08, -1.58), (0.05, 0.0, 0.08)),         # fist
             chunk((0.2, 0.24, 0.32), (-0.24, -0.3, -1.5), (0.2, -0.3, 0.3))]          # thumb
    for i in range(4):                                                                   # knuckles
        x = 0.1 + (i - 1.5) * 0.18
        parts.append(chunk((0.17, 0.22, 0.18), (x, -0.38, -1.7 - abs(i - 1.5) * 0.015), (0.2, 0.0, random.uniform(-0.2, 0.2))))
    parts += chunks_on((0.09, 0.0, -0.45), (0.22, 0.22, 0.25), 5, 0.08, 0.13)
    parts += chunks_on((0.1, -0.03, -1.1), (0.28, 0.27, 0.2), 6, 0.09, 0.14)
    a = sculpt(parts, 0.032, G_ROCK(), 2200, amp=0.04, freq=3.0, seed=5, it=2, factor=0.5, angle=36)
    moss(a, 0.55, 3.0, 0.45, seed=9)
    out = [a] + crystal_cluster((0.38, 0.04, -1.1), (1, 0.3, 0.3), 3, 0.2, 0.05, HEART())
    publish(out, 'golem_arm', origin=(0, 0, 0))


def golem_leg():
    parts = [ico(0.27, (0, 0, 0), 2, (1.0, 1.0, 0.9)),
             chunk((0.46, 0.46, 0.34), (0, 0.0, -0.24)),                   # thigh
             ico(0.22, (0, -0.07, -0.45), 1),                              # knee
             chunk((0.48, 0.48, 0.3), (0, 0.0, -0.62)),                    # shin
             chunk((0.62, 0.8, 0.2), (0, -0.12, -0.8), (0, 0, random.uniform(-0.1, 0.1)))]  # broad foot
    for x in (-0.19, 0.0, 0.19):
        parts.append(chunk((0.17, 0.2, 0.15), (x, -0.52, -0.83), (0.15, 0, random.uniform(-0.3, 0.3))))  # toe stones
    parts += chunks_on((0, 0, -0.35), (0.24, 0.24, 0.3), 4, 0.07, 0.11)
    l = sculpt(parts, 0.028, G_ROCK(), 1100, amp=0.03, freq=4, seed=6, it=2, factor=0.5, floor=-0.9, angle=36)
    moss(l, 0.5, 4.0, 0.5, seed=2)
    publish([l], 'golem_leg', origin=(0, 0, 0))


# ================================================================ Colossus face
C_BACK = 3.8  # flat back plane (y); the relief reaches y≈-4.2 at the nose tip / rubble


def colossus_face():
    P = []
    # Cliff backing: an irregular field of flattened boulders the face emerges from.
    for gx in range(-4, 5):
        for gz in range(0, 7):
            x = gx * 2.55 + random.uniform(-0.5, 0.5)
            z = 2.2 + gz * 4.3 + random.uniform(-0.8, 0.8)
            if ((x / 12.0) ** 2 + ((z - 15.0) / 16.0) ** 2 > 1.0 and z > 5) or (abs(x) < 7 and z > 20):
                continue
            P.append(box((random.uniform(3.4, 4.6), random.uniform(2.4, 3.2), random.uniform(3.6, 5.0)), (x, 2.4, z),
                         (random.uniform(-0.12, 0.12), random.uniform(-0.18, 0.18), random.uniform(-0.12, 0.12)), bevel=0))
    P.append(sphere(1, (0, 2.3, 15.0), (12.0, 1.9, 15.5), 32))  # the cliff slab itself
    # Head masses.
    P += [sphere(1, (0, 0.5, 22.0), (8.6, 4.0, 7.2), 32),            # forehead dome
          sphere(1, (0, 0.6, 12.5), (8.2, 3.4, 7.0), 32),            # cheeks / midface
          sphere(1, (0, 0.2, 5.5), (6.4, 3.4, 4.4), 24),             # jaw
          sphere(1, (-8.4, 1.2, 17), (2.2, 2.6, 6.5), 20), sphere(1, (8.4, 1.2, 17), (2.2, 2.6, 6.5), 20),  # temples / hair
          sphere(1, (-9.6, 1.0, 13.5), (1.2, 1.8, 2.8), 16), sphere(1, (9.6, 1.0, 13.5), (1.2, 1.8, 2.8), 16),  # ears
          ]
    for sx in (1, -1):
        # Brow: a heavy, frowning ridge, inner ends low.
        P += chain([(sx * 0.9, -2.3, 17.5), (sx * 3.6, -2.35, 18.6), (sx * 6.6, -1.6, 19.5), (sx * 8.0, -0.6, 19.3)], 1.55, 1.2, step=0.35, segs=16)
        # Closed, heavy lids bulging under the brow.
        P.append(sphere(1, (sx * 3.9, -1.0, 16.3), (2.7, 1.25, 1.2), 20, rot=(0, math.radians(8) * sx, 0)))   # heavy closed lid, drooping outward
        P.append(sphere(1, (sx * 4.0, -0.5, 14.9), (2.6, 1.0, 0.8), 16))                     # lower lids / bags
        P.append(sphere(1, (sx * 6.3, -0.2, 12.8), (2.8, 1.5, 2.6), 20))                     # cheekbones
        P.append(sphere(1, (sx * 2.0, -2.2, 10.8), (1.25, 1.2, 1.0), 16))                     # nostril wings
        # Moustache sweeping out and down from under the nose.
        P += chain([(sx * 0.4, -3.0, 9.6), (sx * 2.6, -2.9, 9.0), (sx * 4.6, -2.3, 7.4), (sx * 5.6, -1.6, 5.4)], 1.05, 0.7, step=0.3, segs=14)
    P += chain([(0, -1.6, 17.8), (0, -2.3, 15.5), (0, -2.9, 13.0), (0, -2.9, 11.6)], 1.05, 1.55, step=0.3, segs=16)  # nose
    P += [sphere(1, (0, -1.6, 13.0), (2.0, 1.8, 3.2), 20),         # nose base
          sphere(1.3, (0, -2.4, 17.6), segs=16),                   # glabella knot
          sphere(1, (0, -2.6, 7.3), (2.6, 1.0, 0.75), 16)]         # lower lip
    # Beard: flowing stone strands falling to the floor, spilling into rubble.
    P.append(sphere(1, (0, -0.6, 3.6), (7.4, 2.1, 3.8), 24))  # beard mass
    for i in range(13):
        x0 = (i - 6) * 1.2
        k = 1 - abs(x0) / 9
        y0 = -1.3 - k * 1.3
        top = 7.2 - abs(x0) * 0.2 if abs(x0) > 2 else 6.4
        sway = 0.5 * (1 if i % 2 else -1) + random.uniform(-0.3, 0.3)
        P += chain([(x0, y0 + 0.4, top), (x0 * 1.02 + sway, y0 - 0.1, top - 2.0), (x0 * 1.04 - sway * 0.6, y0, 3.0), (x0 * 1.12 + sway, y0 + 0.3, 0.7)],
                   1.2 + k * 0.2, 0.9, step=0.4, segs=14)
    f = join(P)
    remesh(f, 0.17)
    rough(f, 0.35, 0.35, 4, seed=11)
    rough(f, 0.08, 1.6, 2, seed=12)
    laplace(f, 0.5, 3)
    cut_plane(f, (0, C_BACK, 0), (0, 1, 0))
    cut_plane(f, (0, 0, 0), (0, 0, -1))
    decimate(f, 60000)
    # Carved lines: lid creases, mouth line, frown furrows, forehead lines, beard channels.
    cuts = []
    for sx in (1, -1):
        cuts.append(surface_groove(f, [(sx * 1.4, 15.9), (sx * 2.8, 15.35), (sx * 4.6, 15.3), (sx * 6.4, 15.7)], 0.26))
        cuts.append(surface_groove(f, [(sx * 0.7, 16.8), (sx * 0.55, 18.2), (sx * 0.8, 19.6)], 0.22))       # frown furrows
        cuts.append(surface_groove(f, [(sx * 2.8, 11.0), (sx * 3.6, 9.6), (sx * 5.2, 8.6)], 0.2, depth=0.2))  # nasolabial fold
    cuts.append(surface_groove(f, [(-3.8, 7.6), (-2.0, 8.05), (0, 8.2), (2.0, 8.05), (3.8, 7.6)], 0.28))   # stern mouth
    cuts.append(surface_groove(f, [(-5.5, 22.2), (-2.5, 22.7), (0, 22.6), (2.5, 22.7), (5.5, 22.2)], 0.34, depth=-0.25))
    cuts.append(surface_groove(f, [(-4.5, 24.1), (-1.5, 24.5), (1.5, 24.5), (4.5, 24.1)], 0.3, depth=-0.3))
    carve(f, [c for c in cuts if c])
    decimate(f, 17600)
    assign(f, COLOSSUS())
    smooth(f, 50)
    # Rubble spilling from the beard: loose angular blocks (kept separate so they stay crisp).
    rub = []
    for i in range(18):
        x = random.uniform(-10.5, 10.5)
        y = random.uniform(-3.3, -1.2) if abs(x) > 3 else random.uniform(-3.8, -2.6)
        r = random.uniform(0.6, 1.4)
        c = ico(r, (x, y, r * 0.35), 1, (1.0, random.uniform(0.7, 1.1), random.uniform(0.6, 0.9)), COLOSSUS(), tuple(random.uniform(0, 3) for _ in range(3)))
        cut_plane(c, (0, 0, 0), (0, 0, -1))
        flat(c)
        rub.append(c)
    publish([f] + rub, 'colossus_face')
    return f


def colossus_eyes(face):
    """Glowing lenses shrink-wrapped over the closed lids (raycast onto the face)."""
    tree = bvh(face)
    eyes = []
    for sx in (1, -1):
        cx, cz, ax, az = sx * 3.9, 16.3, 2.3, 1.0
        bm = bmesh.new()
        segs, rings = 16, 4

        def surf(x, z, lift):
            # Lid surface: raycast, but ignore hits on the overhanging brow / cheeks in front of the lid.
            u = min(1.0, ((x - cx) / 2.7) ** 2 + ((z - cz) / 1.2) ** 2)
            ey = -1.0 - 1.25 * math.sqrt(1 - u)
            hit = tree.ray_cast(Vector((x, -100, z)), Vector((0, 1, 0)))
            y = hit[0].y if hit[0] is not None and abs(hit[0].y - ey) < 0.45 else ey
            return Vector((x, y - lift, z))

        centre = bm.verts.new(surf(cx, cz, 0.16))
        rs = []
        for k in range(1, rings + 1):
            f = k / rings
            lift = 0.16 if k < rings else -0.12
            rs.append([bm.verts.new(surf(cx + math.cos(i / segs * math.tau) * ax * f, cz + math.sin(i / segs * math.tau) * az * f, lift)) for i in range(segs)])
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new((centre, rs[0][i], rs[0][j]))
            for k in range(rings - 1):
                bm.faces.new((rs[k][i], rs[k + 1][i], rs[k + 1][j], rs[k][j]))
        o = mesh_obj(bm, 'eye', C_EYE())
        # make sure it faces the viewer (-Y)
        if sum(p.normal.y for p in o.data.polygons) > 0:
            o.data.flip_normals()
        smooth(o, 60)
        eyes.append(o)
    publish(eyes, 'colossus_eyes')


# ================================================================ Geode
def geode():
    C = Vector((0, 0, 3.8))
    parts = [sphere(1, tuple(C), (7.0, 6.8, 6.2), 40)]
    parts += chunks_on(C, (6.4, 6.2, 5.6), 26, 1.2, 2.2, zmin=-0.4)
    shell = join(parts)
    remesh(shell, 0.22)
    ci, ri = Vector((0, 0.3, 4.5)), Vector((5.5, 5.3, 4.4))
    inner = sphere(1, tuple(ci), tuple(ri), 48)
    cut = [inner, sphere(1, (0, -7.3, 2.4), (5.8, 3.7, 5.8), 40)]
    for i in range(11):  # jagged break around the opening
        a = -math.pi * 0.72 + i / 10 * math.pi * 1.44
        cut.append(box((random.uniform(1.3, 2.3),) * 3, (math.sin(a) * 4.6, -5.6, 2.4 + math.cos(a) * 5.0),
                       tuple(random.uniform(0, math.pi) for _ in range(3)), bevel=0))
    carve(shell, cut)
    remesh(shell, 0.13)
    rough(shell, 0.3, 0.45, 4, seed=21)
    laplace(shell, 0.4, 2)
    cut_plane(shell, (0, 0, 0), (0, 0, -1))
    decimate(shell, 7600)
    assign(shell, GEO_ROCK())
    smooth(shell, 36)

    def q(c):
        d = c - ci
        return Vector((d.x / ri.x, d.y / ri.y, d.z / ri.z)).length

    paint(shell, GEO_RIND(), lambda c, n: q(c) < 1.12 and n.dot(ci - c) > 0)
    paint(shell, GEO_BAND(), lambda c, n: 0.98 < q(c) < 1.3 and c.y < -3.5 and abs(n.dot((c - ci).normalized())) < 0.55)
    tree = bvh(shell)
    out = [shell]
    hits = 0
    tries = 0
    while hits < 100 and tries < 8000:
        tries += 1
        v = Vector([random.gauss(0, 1) for _ in range(3)]).normalized()
        if v.z < -0.8 or (v.y < -0.2 and random.random() < 0.6):
            continue
        loc, nrm, _, dist = tree.ray_cast(ci, v, 12.0)
        if loc is None or loc.y < -5.0:
            continue
        if loc.z < 1.6 and Vector((loc.x, loc.y - 0.3, 0)).length < 3.4:
            continue  # keep the walkable floor clear
        hits += 1
        inward = -nrm if nrm.dot(ci - loc) < 0 else nrm
        inward = (inward * 0.6 + (ci - loc).normalized() * 0.4).normalized()
        big = random.random() < 0.2
        m = GEO_PINK() if random.random() < 0.3 else GEO_CRYS()
        n = random.randint(2, 4)
        out += crystal_cluster(loc - inward * 0.3, inward, n, random.uniform(2.0, 3.0) if big else random.uniform(0.9, 1.7),
                               random.uniform(0.38, 0.55) if big else random.uniform(0.2, 0.34), m, spread=0.45, sides=5)
    # Broken shell shards lying in front of the opening, crystals still clinging to them.
    for (x, y, rz, s) in ((-3.6, -7.4, 0.4, 1.3), (2.8, -7.8, -0.7, 1.0), (0.4, -8.6, 1.6, 0.7)):
        sh = ico(s, (x, y, s * 0.3), 1, (1.4, 1.0, 0.45), rot=(0.2, 0.1, rz))
        remesh(sh, 0.12)
        rough(sh, 0.12, 1.0, 3, seed=int(x * 10))
        cut_plane(sh, (0, 0, 0), (0, 0, -1))
        decimate(sh, 220)
        assign(sh, GEO_ROCK())
        paint(sh, GEO_RIND(), lambda c, n, x=x, y=y: n.z > 0.5)
        flat(sh)
        out.append(sh)
        out += crystal_cluster((x, y, s * 0.4), (0.2, -0.3, 1), 3, 0.7 * s, 0.16 * s, GEO_CRYS(), 0.5)
    publish(out, 'geode')


# ================================================================ Giant mushroom
def cap_mesh(scale=1.0, segs=32, gills=28, spots=12):
    prof = [(0.001, 1.55), (0.9, 1.49), (1.7, 1.3), (2.5, 0.95), (3.1, 0.55), (3.55, 0.12), (3.82, -0.22), (3.84, -0.42), (3.66, -0.5),
            (3.2, -0.34), (2.3, -0.06), (1.3, 0.12), (0.001, 0.22)]
    prof = [(r * scale, z * scale) for r, z in prof]
    cap = lathe(prof, F_CAP(), segs, split=8, m2=F_GLOW(), shade=55)
    parts = [cap]

    def zu(r):
        pts = [(3.66, -0.5), (3.2, -0.34), (2.3, -0.06), (1.3, 0.12), (0.0, 0.22)]
        r /= scale
        for (r0, z0), (r1, z1) in zip(pts, pts[1:]):
            if r1 <= r <= r0:
                return (z0 + (z1 - z0) * (r0 - r) / (r0 - r1)) * scale
        return 0.22 * scale

    for i in range(gills):  # radial glowing gill fins
        a = (i + 0.5) / gills * math.tau
        ca, sa = math.cos(a), math.sin(a)
        bm = bmesh.new()
        r0, r1 = 0.6 * scale, 3.45 * scale
        th = 0.025 * scale
        vs = []
        for r in (r0, r1):
            for dz in (0.04 * scale, -0.2 * scale * (1.0 if r == r0 else 0.35)):
                for s in (-th, th):
                    vs.append(bm.verts.new((ca * r - sa * s, sa * r + ca * s, zu(r) + dz)))
        f = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 2, 6, 4), (1, 5, 7, 3), (0, 4, 5, 1), (2, 3, 7, 6)]
        for fi in f:
            bm.faces.new([vs[k] for k in fi])
        parts.append(mesh_obj(bm, 'gill', F_GLOW()))
    tree = bvh(cap)
    placed = 0
    while placed < spots:
        a = random.random() * math.tau
        r = random.uniform(0.5, 3.1) * scale
        hit = tree.ray_cast(Vector((math.cos(a) * r, math.sin(a) * r, 5 * scale)), Vector((0, 0, -1)))
        if hit[0] is None or hit[1].z < 0.2:
            continue
        rot = Vector((0, 0, 1)).rotation_difference(hit[1]).to_euler()
        s = random.uniform(0.25, 0.48) * scale
        parts.append(sphere(s, tuple(hit[0] - hit[1] * s * 0.05), (1, random.uniform(0.8, 1.1), 0.28), 8, F_SPOT(), rot))
        placed += 1
    return join(parts)


def giant_mushroom():
    path = [(0, 0, -0.2), (0.12, 0.0, 1.8), (0.42, 0.06, 3.8), (0.74, 0.12, 5.6), (0.92, 0.15, 7.6)]
    pts = spline(path, 28)
    rad = [0.86 + 0.8 * max(0, 1 - p.z / 1.6) ** 2 - 0.22 * (p.z / 7.6) for p in pts]
    stem_parts = [sweep(pts, rad, segs=20)]
    for i in range(6):  # root flare
        a = i / 6 * math.tau + 0.3
        stem_parts.append(sphere(0.5, (math.cos(a) * 1.25, math.sin(a) * 1.25, 0.1), (1.6, 0.9, 0.55), 12,
                                 rot=(0, 0, a)))
    stem = sculpt(stem_parts, 0.06, F_STEM(), 700, amp=0.035, freq=3, seed=31, it=4, floor=0.0, angle=60)
    cap = cap_mesh()
    cap.rotation_euler = (math.radians(-4), math.radians(9), 0)
    cap.location = (0.95, 0.16, 7.3)
    apply_tf(cap)
    # Two little ones at the foot.
    kids = []
    for (x, y, s, h) in ((2.1, -1.2, 0.2, 1.1), (-1.7, -1.1, 0.14, 0.75)):
        kst = cyl(0.3 * s * 3, h, (x, y, h / 2), verts=8, r2=0.22 * s * 3, m=F_STEM())
        smooth(kst, 60)
        kc = cap_mesh(s, 10, 0, 0)
        kc.location = (x, y, h - 0.05)
        apply_tf(kc)
        kids += [kst, kc]
    publish([stem, cap] + kids, 'giant_mushroom')


# ================================================================ Dripstone
def dripstone(length, r0, up, bands=8, seed=0, name='stalactite'):
    segs = 12
    rings = 25
    bm = bmesh.new()
    lean = Vector((random.uniform(-0.25, 0.25), random.uniform(-0.25, 0.25), 0)) * length / 5
    sgn = 1 if up else -1
    vs = []
    for k in range(rings):
        t = k / (rings - 1)
        if up:
            r = r0 * (1 - t ** 2.2) ** 0.6 * (1 - 0.55 * t) + 0.02
        else:
            r = r0 * 1.3 * (1 - t) ** 1.6 + 0.012 if t > 0.04 else r0 * (1.35 - t * 2.0)
        band = 0.12 * r0 * math.sin(t * bands * math.pi) ** 2
        r = r + band * (1 - t)
        c = lean * t * t + Vector((0, 0, sgn * t * length))
        ring = []
        for i in range(segs):
            a = i / segs * math.tau
            j = 1 + 0.12 * noise.noise(Vector((math.cos(a) * 1.5, math.sin(a) * 1.5, t * 4 + seed)))
            ring.append(bm.verts.new(c + Vector((math.cos(a) * r * j, math.sin(a) * r * j, 0))))
        vs.append(ring)
    for k in range(rings - 1):
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new((vs[k][i], vs[k][j], vs[k + 1][j], vs[k + 1][i]))
    bm.faces.new(vs[0][::-1])
    tip = bm.verts.new(lean + Vector((0, 0, sgn * (length + (0.08 if up else 0.12)))))
    for i in range(segs):
        j = (i + 1) % segs
        bm.faces.new((vs[-1][i], vs[-1][j], tip))
    o = mesh_obj(bm, name, DRIP())
    smooth(o, 70)
    publish([o], name)


# ================================================================ Ancestor statue
def ancestor_statue():
    Z = 0.9  # plinth top
    plinth = [slab((2.9, 2.9, 0.5), (0, 0, 0.25), m=STATUE(), cuts=2, jit=0.02, bevel=0.06),
              slab((2.45, 2.45, 0.42), (0, 0, 0.69), m=STATUE(), cuts=2, jit=0.02, bevel=0.05)]
    carve(plinth[0], [box((0.7, 0.7, 0.7), (1.45, -1.45, 0.5), (0.5, 0.3, 0.7), bevel=0),
                      box((0.5, 0.5, 0.5), (-1.45, 1.3, 0.55), (0.3, 0.6, 0.2), bevel=0)])
    carve(plinth[1], [box((0.45, 0.45, 0.45), (-1.22, -1.22, 0.9), (0.4, 0.5, 0.3), bevel=0)])
    P = [cyl(1.08, 3.3, (0, 0.05, Z + 1.65), verts=32, r2=0.7),               # robe skirt
         sphere(1, (0, 0.08, Z + 0.18), (1.2, 1.1, 0.3), 32),                  # hem pooling on the plinth
         sphere(1, (0, 0.06, Z + 3.6), (0.82, 0.62, 1.0), 32),                 # torso
         sphere(1, (0, 0.12, Z + 4.35), (0.9, 0.74, 0.45), 24),                # hood drape over shoulders
         sphere(1, (0, 0.08, Z + 4.95), (0.62, 0.68, 0.78), 28),               # hood
         cyl(0.36, 0.7, (0, 0.34, Z + 5.62), (-0.6, 0, 0), 16, r2=0.03)]       # hood peak, falling back
    for sx in (1, -1):
        P.append(sphere(0.46, (sx * 0.62, 0.06, Z + 4.12), (1.1, 1.0, 0.8), 20))                           # shoulders
        P += chain([(sx * 0.72, 0.05, Z + 4.0), (sx * 0.8, -0.2, Z + 3.25), (sx * 0.4, -0.72, Z + 3.45)], 0.24, 0.32, step=0.08)  # bell sleeves
        P.append(sphere(0.16, (sx * 0.12, -0.9, Z + 3.52 + (0.05 if sx > 0 else -0.12)), (1.1, 1.0, 0.9), 14))  # hands
    for i in range(11):  # robe folds
        a = i / 11 * math.tau + 0.15
        P.append(sweep([(math.cos(a) * 1.02, 0.05 + math.sin(a) * 1.02, Z + 0.15), (math.cos(a) * 0.8, 0.05 + math.sin(a) * 0.8, Z + 2.0),
                        (math.cos(a) * 0.66, 0.05 + math.sin(a) * 0.66, Z + 3.3)], [0.16, 0.12, 0.07], segs=10))
    P += chain([(0, -0.42, Z + 4.7), (0, -0.62, Z + 4.2), (0, -0.66, Z + 3.7)], 0.2, 0.1, step=0.04, scale=(1.3, 0.6, 1.0))  # beard
    cutters = [sphere(1, (0, -0.58, Z + 4.92), (0.36, 0.42, 0.46), 20)]         # the shadowed face under the hood
    fig = sculpt(P, 0.04, STATUE(), 5200, amp=0.035, freq=3.5, seed=41, it=3, cutters=cutters, angle=50)
    moss(fig, 0.4, 2.0, 0.75, seed=13)
    for o in plinth:
        smooth(o, 35)
        moss(o, 0.35, 2.5, 0.8, seed=14)
    nose = sphere(0.08, (0, -0.33, Z + 4.83), (0.8, 1.2, 1.2), 10, STATUE())
    eyes = [sphere(0.045, (sx * 0.12, -0.3, Z + 4.95), (1.3, 0.6, 0.8), 10, HEART()) for sx in (1, -1)]
    # The great staff-maul planted before them: shaft, bound head, heartstone set in its face.
    shaft = cyl(0.085, 3.7, (0, -0.95, Z + 1.85), verts=12, r2=0.075, m=STATUE())
    head = slab((0.78, 0.46, 0.46), (0, -0.95, Z + 4.02), m=STATUE(), cuts=1, jit=0.04, bevel=0.05)
    bands = [torus(0.1, 0.03, (0, -0.95, Z + z), m=STATUE(), seg=12, minor=6) for z in (3.35, 3.72, 1.2)]
    gem = crystal((0, -1.16, Z + 4.02), (0, -1, 0), 0.2, 0.13, HEART(), sides=6, tip=0.5, base_r=1.0, jitter=0.05)
    gem2 = [crystal((sx * 0.38, -0.95, Z + 4.02), (sx, 0, 0), 0.14, 0.09, HEART(), sides=4, tip=0.6, jitter=0.05) for sx in (1, -1)]
    publish(plinth + [fig, nose, shaft, head, gem] + gem2 + eyes + bands, 'ancestor_statue')


# ================================================================ Mine gear
def lift_wheel():
    R = 3.0
    rot = (math.radians(90), 0, 0)  # lathe about Z → axle along Y
    rim_prof = [(R - 0.2, -0.24), (R, -0.24), (R, -0.13), (R - 0.09, -0.07), (R - 0.11, 0), (R - 0.09, 0.07), (R, 0.13), (R, 0.24), (R - 0.2, 0.24), (R - 0.2, -0.24)]
    rim = lathe(rim_prof, M_IRON(), 40, rot=rot, shade=30)
    fel = lathe([(R - 0.52, -0.17), (R - 0.18, -0.17), (R - 0.18, 0.17), (R - 0.52, 0.17), (R - 0.52, -0.17)], M_WOOD(), 40, rot=rot, shade=30)
    parts = [rim, fel]
    n = 10
    for i in range(n):
        a = i / n * math.tau
        mid = (R - 0.5 + 0.45) / 2
        L = R - 0.5 - 0.45 + 0.1
        parts.append(box((0.17, 0.22, L), (math.sin(a) * mid, 0, math.cos(a) * mid), (0, a, 0), M_WOOD(), 0.025, 1))
        parts.append(box((0.24, 0.4, 0.12), (math.sin(a) * (R - 0.46), 0, math.cos(a) * (R - 0.46)), (0, a, 0), M_IRON(), 0.015, 1))  # spoke shoes
        # Cross-braces between neighbouring spokes (timber ring at mid radius).
        b = a + math.pi / n
        rb = 1.75
        parts.append(box((0.12, 0.14, 2 * rb * math.sin(math.pi / n) + 0.1), (math.sin(b) * rb * math.cos(math.pi / n), 0, math.cos(b) * rb * math.cos(math.pi / n)),
                         (0, b + math.pi / 2, 0), M_WOOD(), 0.02, 1))
    parts.append(cyl(0.52, 0.62, (0, 0, 0), (math.radians(90), 0, 0), 20, m=M_IRON()))           # hub
    for y in (-0.33, 0.33):
        parts.append(cyl(0.66, 0.07, (0, y, 0), (math.radians(90), 0, 0), 20, m=M_IRON()))        # flanges
        for i in range(8):
            a = i / 8 * math.tau
            parts.append(cyl(0.05, 0.08, (math.cos(a) * 0.52, y * 1.13, math.sin(a) * 0.52), (math.radians(90), 0, 0), 6, m=M_IRON()))
    parts.append(cyl(0.16, 1.3, (0, 0, 0), (math.radians(90), 0, 0), 14, m=M_IRON()))            # axle
    for p in parts[2:]:
        smooth(p, 35)
    publish(parts, 'lift_wheel', origin=(0, 0, 0))


def frustum(zb, zt, bx, by, tx, ty, m, bevel=0.02):
    bm = bmesh.new()
    sq = ((-1, -1), (1, -1), (1, 1), (-1, 1))
    b = [bm.verts.new((sx * bx / 2, sy * by / 2, zb)) for sx, sy in sq]
    t = [bm.verts.new((sx * tx / 2, sy * ty / 2, zt)) for sx, sy in sq]
    bm.faces.new(b[::-1])
    bm.faces.new(t)
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((b[i], b[j], t[j], t[i]))
    o = mesh_obj(bm, 'frustum', m)
    if bevel:
        mod = o.modifiers.new('bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = 2
        apply_mod(o, mod)
    return o


def minecart():
    zb, zt = 0.34, 0.92
    bx, by, tx, ty = 0.78, 1.28, 0.98, 1.58
    lerp = lambda a, b, t: a + (b - a) * t
    parts = [frustum(zb, zt, bx, by, tx, ty, M_WOOD(), 0.025)]
    # Plank seams: shallow grooves around the tub.
    for z in (0.53, 0.72):
        t = (z - zb) / (zt - zb)
        g = frustum(z - 0.012, z + 0.012, lerp(bx, tx, t) + 0.1, lerp(by, ty, t) + 0.1, lerp(bx, tx, t) + 0.1, lerp(by, ty, t) + 0.1, None, 0)
        inner = frustum(z - 0.02, z + 0.02, lerp(bx, tx, t) - 0.02, lerp(by, ty, t) - 0.02, lerp(bx, tx, t) - 0.02, lerp(by, ty, t) - 0.02, None, 0)
        carve(g, [inner])
        carve(parts[0], [g])
    # Iron bands + rivets.
    for z in (0.42, 0.63, 0.86):
        t = (z - zb) / (zt - zb)
        w, l = lerp(bx, tx, t), lerp(by, ty, t)
        dt = 0.035 / (zt - zb)
        parts.append(frustum(z - 0.035, z + 0.035, lerp(bx, tx, t - dt) + 0.03, lerp(by, ty, t - dt) + 0.03,
                             lerp(bx, tx, t + dt) + 0.03, lerp(by, ty, t + dt) + 0.03, M_IRON(), 0.008))
        if z != 0.63:
            for sx in (-1, 1):
                for yy in (-0.45, 0.45):
                    parts.append(sphere(0.022, (sx * (w / 2 + 0.02), yy * l / 1.6, z), segs=5, m=M_IRON()))
    for sy in (-1, 1):  # corner straps
        for sx in (-1, 1):
            p0 = Vector((sx * (bx / 2 + 0.01), sy * (by / 2 + 0.01), zb))
            p1 = Vector((sx * (tx / 2 + 0.01), sy * (ty / 2 + 0.01), zt))
            parts.append(sweep([p0, p1], 0.035, M_IRON(), segs=4, twist=0))
    parts.append(box((0.62, 1.44, 0.1), (0, 0, 0.3), m=M_IRON(), bevel=0.015, segs=1))        # chassis
    for sy in (-1, 1):
        parts.append(box((0.66, 0.12, 0.14), (0, sy * 0.86, 0.42), m=M_WOOD(), bevel=0.02, segs=1))  # bumpers
        parts.append(torus(0.05, 0.015, (0, sy * 0.95, 0.42), (math.radians(90), 0, 0), M_IRON(), 8, 4))
        parts.append(cyl(0.035, 0.96, (0, sy * 0.46, 0.2), (0, math.radians(90), 0), 8, m=M_IRON()))  # axles
        for sx in (-1, 1):
            parts.append(cyl(0.2, 0.07, (sx * 0.44, sy * 0.46, 0.2), (0, math.radians(90), 0), 14, m=M_IRON()))
            parts.append(cyl(0.23, 0.03, (sx * 0.39, sy * 0.46, 0.2), (0, math.radians(90), 0), 14, m=M_IRON()))  # flange
    for p in parts:
        smooth(p, 35)
    ore = []
    for i in range(14):
        ore.append(ico(random.uniform(0.15, 0.25), (random.uniform(-0.34, 0.34), random.uniform(-0.6, 0.6), random.uniform(0.9, 1.08)), 1,
                       (1, 1, random.uniform(0.7, 1.0))))
    ore.append(sphere(1, (0, 0, 0.98), (0.42, 0.7, 0.2), 16))
    heap = sculpt(ore, 0.04, VEIN(), 260, amp=0.03, freq=6, seed=51, it=2, flat_shade=True)
    parts.append(heap)
    for i in range(7):
        x, y = random.uniform(-0.3, 0.3), random.uniform(-0.55, 0.55)
        parts.append(crystal((x, y, 1.05), (x * 1.2, y * 0.6, 1), random.uniform(0.22, 0.36), random.uniform(0.05, 0.08), HEART(), sides=5))
    publish(parts, 'minecart')


def heartstone_cluster():
    P = [sphere(1, (0, 0, 0.2), (0.9, 0.7, 0.55), 20), sphere(0.45, (0.35, 0.1, 0.55), (1, 0.9, 1.2), 16),
         sphere(0.4, (-0.4, -0.05, 0.4), (1.1, 1, 0.9), 16), sphere(0.3, (0.1, -0.35, 0.3), segs=12)]
    P += on_ellipsoid((0, 0, 0.3), (0.75, 0.55, 0.4), 7, 0.15, 0.28, zmin=0.0)
    rock = sculpt(P, 0.035, VEIN(), 1250, amp=0.06, freq=3, seed=61, it=2, floor=0.0, angle=35)
    planes = [(Vector((0.8, 0.3, 0.5)).normalized(), 0.12), (Vector((-0.5, 0.7, 0.3)).normalized(), 0.02)]
    vs = rock.data.vertices
    hidx = len(rock.data.materials)
    rock.data.materials.append(HEART())
    for poly in rock.data.polygons:
        for pn, d in planes:
            ds = [vs[i].co.dot(pn) - d + 0.04 * noise.noise(vs[i].co * 5) for i in poly.vertices]
            if min(ds) < 0 < max(ds):
                poly.material_index = hidx
    out = [rock]
    out += crystal_cluster((0.25, 0.05, 0.75), (0.3, -0.1, 1), 5, 0.75, 0.13, HEART(), 0.5)
    out += crystal_cluster((-0.5, -0.2, 0.55), (-0.8, -0.4, 0.8), 4, 0.5, 0.1, HEART(), 0.5)
    out += crystal_cluster((0.55, -0.3, 0.35), (0.8, -0.6, 0.4), 3, 0.38, 0.08, HEART(), 0.5)
    publish(out, 'heartstone_cluster')


def boulder():
    b = ico(0.82, (0, 0, 0), 4)
    rough(b, 0.07, 1.2, 3, seed=71)
    for i in range(14):  # chipped facets
        v = Vector([random.gauss(0, 1) for _ in range(3)]).normalized()
        cut_plane(b, tuple(v * random.uniform(0.76, 0.8)), tuple(v))
    rough(b, 0.02, 4.0, 2, seed=72)
    decimate(b, 700)
    zmin = min(v.co.z for v in b.data.vertices)
    b.data.transform(Matrix.Translation((0, 0, -zmin)))  # rest on the floor
    assign(b, G_ROCK())
    smooth(b, 30)
    moss(b, 0.4, 2.5, 0.65, seed=15)
    publish([b], 'boulder')


def king_crown():
    band = lathe([(0.5, 0.0), (0.56, 0.0), (0.6, 0.04), (0.58, 0.1), (0.6, 0.18), (0.58, 0.24), (0.52, 0.25), (0.5, 0.24), (0.5, 0.0)], CROWN(), 36, shade=35)
    parts = [band]
    n = 10
    for i in range(n):
        a = i / n * math.tau - math.pi / 2  # i=0 at the front (-Y)
        c, s = math.cos(a), math.sin(a)
        tall = i % 2 == 0
        L = (0.62 if i == 0 else 0.46) if tall else 0.28
        out = Vector((c, s, 0))
        d = (out * (0.28 if tall else 0.42) + Vector((0, 0, 1))).normalized()
        sp = crystal((c * 0.55, s * 0.55, 0.16), d, L, 0.11 if tall else 0.08, CROWN(), sides=5, tip=0.55, base_r=1.1, jitter=0.3)
        parts.append(sp)
        if tall:  # jagged side shards
            for k in (-1, 1):
                b = a + k * 0.14
                parts.append(crystal((math.cos(b) * 0.56, math.sin(b) * 0.56, 0.18), (d + Vector((-s, c, 0)) * 0.35 * k).normalized(), L * 0.45, 0.05, CROWN(), sides=4, tip=0.6))
        gm = a + math.pi / n
        parts.append(crystal((math.cos(gm) * 0.585, math.sin(gm) * 0.585, 0.12), (math.cos(gm), math.sin(gm), 0), 0.07, 0.055 if i else 0.06, HEART(), sides=6, tip=0.5, base_r=1.0, jitter=0.05))
    parts.append(crystal((0, -0.64, 0.36), (0, -1, 0.15), 0.1, 0.1, HEART(), sides=6, tip=0.5, base_r=1.0, jitter=0.05))  # the great front gem
    publish(parts, 'king_crown')


# ================================================================ Quill the owl
OWL_SHOULDER = Vector((0.175, 0.03, 0.43))


def quill_body():
    P = [sphere(1, (0, 0.03, 0.27), (0.2, 0.19, 0.24), 32),        # body egg
         sphere(1, (0, -0.04, 0.25), (0.175, 0.16, 0.19), 24),     # round belly
         sphere(1, (0, 0.0, 0.52), (0.205, 0.185, 0.18), 32),      # big round head
         sphere(1, (0, 0.03, 0.4), (0.17, 0.15, 0.08), 20)]         # neck ruff
    for sx in (1, -1):
        P += chain([(sx * 0.12, 0.0, 0.64), (sx * 0.17, 0.02, 0.72), (sx * 0.2, 0.05, 0.78)], 0.045, 0.012, step=0.006, segs=10)  # ear tufts
        P.append(sphere(1, (sx * 0.085, -0.155, 0.6), (0.07, 0.03, 0.022), 12, rot=(0, math.radians(-18) * sx, 0)))       # brows
        P.append(sphere(1, (sx * 0.075, -0.01, 0.07), (0.06, 0.06, 0.06), 12))                                            # feathered legs
        P.append(sphere(1, (sx * 0.07, -0.12, 0.5), (0.085, 0.07, 0.09), 16))                                              # face disc cheeks
    P.append(sphere(1, (0, 0.2, 0.1), (0.1, 0.12, 0.03), 12, rot=(math.radians(-40), 0, 0)))                                 # tail
    body = sculpt(P, 0.0065, O_FEATH(), 2150, amp=0.0035, freq=40, seed=81, it=4, angle=65)
    eyes = [Vector((sx * 0.075, -0.158, 0.528)) for sx in (1, -1)]
    paint(body, O_BELLY(), lambda c, n: (n.y < -0.35 and c.z < 0.4 and abs(c.x) < 0.13 + 0.1 * max(0, 0.35 - c.z)))
    paint(body, O_BELLY(), lambda c, n: n.y < -0.2 and c.z > 0.42 and min((c - e).length for e in eyes) < 0.105)
    out = [body]
    tree = bvh(body)
    # Chevron marks on the belly.
    for (x, z) in ((-0.06, 0.3), (0.06, 0.3), (0.0, 0.25), (-0.07, 0.2), (0.07, 0.2), (0.0, 0.15), (-0.04, 0.1), (0.04, 0.1)):
        pts = []
        for dx, dz in ((-0.022, 0.012), (0, -0.004), (0.022, 0.012)):
            hit = tree.ray_cast(Vector((x + dx, -1, z + dz)), Vector((0, 1, 0)))
            if hit[0] is not None:
                pts.append(hit[0] + hit[1] * 0.001)
        if len(pts) == 3:
            out.append(sweep(spline(pts, 5), 0.0055, O_FEATH(), segs=5))
    for e in eyes:
        out.append(sphere(0.066, tuple(e), (1, 0.8, 1), 18, O_EYE()))
        out.append(sphere(0.034, tuple(e + Vector((0, -0.047, 0.004))), (1, 0.45, 1), 12, O_PUPIL()))
        out.append(sphere(0.011, tuple(e + Vector((0.016, -0.056, 0.02))), segs=6, m=O_GLINT()))
        # Spectacles: brass rim + pale glass.
        out.append(torus(0.071, 0.0065, tuple(e + Vector((0, -0.068, 0))), (math.radians(90), 0, 0), BRASS(), 24, 6))
        out.append(cyl(0.068, 0.004, tuple(e + Vector((0, -0.068, 0))), (math.radians(90), 0, 0), 24, m=O_GLASS()))
        sx = 1 if e.x > 0 else -1
        out.append(sweep(spline([e + Vector((sx * 0.07, -0.068, 0.01)), e + Vector((sx * 0.1, -0.03, 0.02)), e + Vector((sx * 0.11, 0.1, 0.02))], 6), 0.005, BRASS(), segs=5))
    out.append(sweep(spline([Vector((0.006, -0.23, 0.545)), Vector((0, -0.236, 0.556)), Vector((-0.006, -0.23, 0.545))], 5), 0.005, BRASS(), segs=5))
    # Beak: short hooked cone.
    beak = sweep(spline([(0, -0.17, 0.51), (0, -0.21, 0.485), (0, -0.215, 0.455)], 6), [0.028, 0.024, 0.019, 0.013, 0.007, 0.002], O_BEAK(), segs=8)
    smooth(beak, 60)
    out.append(beak)
    # Feet: three toes forward, one back, gripping down over the perch edge.
    for sx in (1, -1):
        base = Vector((sx * 0.075, -0.03, 0.035))
        for ang in (-0.45, 0.0, 0.45):
            d = Vector((math.sin(ang) * 0.6 + sx * 0.1, -1, 0)).normalized()
            p = [base, base + d * 0.04 + Vector((0, 0, -0.012)), base + d * 0.07 + Vector((0, 0, -0.022)), base + d * 0.085 + Vector((0, 0, -0.035))]
            out.append(sweep(spline(p, 6), [0.012, 0.011, 0.01, 0.008, 0.005, 0.002], O_BEAK(), segs=6))
        p = [base, base + Vector((0, 0.045, -0.02)), base + Vector((0, 0.06, -0.035))]
        out.append(sweep(spline(p, 5), [0.011, 0.009, 0.007, 0.004, 0.002], O_BEAK(), segs=6))
    for o in out[1:]:
        if o.data.materials and o.data.materials[0].name in ('owlEye', 'owlPupil', 'brass', 'owlGlint', 'owlBeak', 'owlFeather'):
            smooth(o, 60)
    publish(out, 'quill_body', origin=(0, 0, -0.0))


def quill_wing():
    # Right wing, folded against the flank; pivot at the shoulder.
    P = [sphere(1, (0.03, 0.015, -0.03), (0.04, 0.07, 0.06), 16)]                              # shoulder coverts
    P += chain([(0.035, 0.0, -0.02), (0.045, 0.03, -0.14), (0.035, 0.08, -0.25)], 0.075, 0.05, step=0.01, scale=(0.4, 1, 1))
    for i in range(4):  # primaries fanning to the tip, scalloped
        t = i / 3
        a = Vector((0.04 - t * 0.008, 0.015 + t * 0.03, -0.12 - t * 0.05))
        b = Vector((0.03 - t * 0.012, 0.08 + t * 0.05, -0.28 - t * 0.06))
        P += chain([a, b], 0.04 - t * 0.004, 0.018, step=0.008, scale=(0.35, 1, 1))
    w = sculpt(P, 0.005, O_FEATH(), 760, amp=0.0015, freq=60, seed=91, it=4, angle=60)
    paint(w, O_TIP(), lambda c, n: c.z < -0.22 or (c.z < -0.16 and c.y > 0.08))
    publish([w], 'quill_wing', origin=(0, 0, 0))


# ================================================================ Aldric's staff
def aldric_staff():
    H = 1.72
    P = []
    for k in range(3):
        pts = []
        rad = []
        for i in range(60):
            t = i / 59
            z = t * H
            a = t * 2.4 * math.tau + k * math.tau / 3
            wob = Vector((0.018 * math.sin(z * 2.1 + 1), 0.014 * math.sin(z * 1.7), 0))
            pts.append(Vector((math.cos(a) * 0.02, math.sin(a) * 0.02, z)) + wob)
            rad.append(0.03 - 0.008 * t + (0.006 if t < 0.05 else 0))
        # Splay out and curl up around the crystal, tips hooking inward.
        a0 = 2.4 * math.tau + k * math.tau / 3
        ca, sa = math.cos(a0 + 0.5), math.sin(a0 + 0.5)
        top = pts[-1]
        cage = spline([top, top + Vector((ca * 0.04, sa * 0.04, 0.08)), Vector((ca * 0.085, sa * 0.085, H + 0.2)),
                       Vector((ca * 0.075, sa * 0.075, H + 0.33)), Vector((ca * 0.03, sa * 0.03, H + 0.41))], 22)
        pts += cage[1:]
        rad += [0.022 - 0.014 * (j / 21) for j in range(1, 22)]
        P.append(sweep(pts, rad, segs=8))
    for z in (0.35, 0.8, 1.25):  # knots
        a = random.random() * math.tau
        P.append(sphere(0.035, (math.cos(a) * 0.03, math.sin(a) * 0.03, z), (1, 1, 1.4), 10))
    P.append(sphere(0.05, (0, 0, 0.02), (1.0, 1.0, 0.6), 12))  # worn foot
    wood = sculpt(P, 0.0055, S_WOOD(), 1650, amp=0.003, freq=40, seed=101, it=2, floor=0.0, angle=55)
    band = torus(0.052, 0.009, (0, 0, H - 0.02), m=BRASS(), seg=16, minor=5)
    gem = crystal((0, 0, H + 0.07), (0, 0, 1), 0.3, 0.055, S_CRYS(), sides=6, tip=0.3, double=True, jitter=0.08)
    publish([wood, band, gem], 'aldric_staff')


# ================================================================ Rubble of the fallen tower
def rubble_pile():
    def heap_h(x, y):
        r = math.sqrt((x / 3.3) ** 2 + (y / 3.0) ** 2)
        return 1.8 * max(0.0, 1 - r ** 1.6)

    M = [sphere(1, (0, 0, 0), (3.2, 2.9, 1.25), 32), sphere(1, (0.2, 0.1, 0.6), (1.8, 1.6, 1.3), 24)]
    M += chunks_on((0, 0, 0), (2.9, 2.6, 1.1), 16, 0.35, 0.7, zmin=0.1)
    mound = sculpt(M, 0.08, RUIN_D(), 900, amp=0.1, freq=1.5, seed=111, it=1, floor=0.0, flat_shade=True)
    parts = [mound]
    for i in range(30):
        r = 3.1 * math.sqrt(random.random())
        a = random.random() * math.tau
        x, y = math.cos(a) * r, math.sin(a) * r * 0.92
        s = random.uniform(0.45, 0.95) * (1.1 - 0.25 * r / 3.1)
        size = (s * random.uniform(1.3, 1.9), s * random.uniform(0.8, 1.05), s * random.uniform(0.6, 0.8))
        z = heap_h(x, y) - size[2] * random.uniform(0.1, 0.45)
        m = RUIN() if random.random() < 0.65 else RUIN_D()
        b = slab(size, (x, y, z), (random.uniform(-0.4, 0.4), random.uniform(-0.4, 0.4), random.random() * math.pi), m, cuts=0, jit=0.12, bevel=0.04)
        if random.random() < 0.35:  # broken corner
            c = box((s, s, s), tuple(Vector((x, y, z)) + Vector([random.choice((-1, 1)) * size[k] * 0.55 for k in range(3)])),
                    tuple(random.uniform(0, 1.5) for _ in range(3)), bevel=0)
            carve(b, [c])
        flat(b)
        parts.append(b)
    # Column drums (fluted): one lying on its side, one standing snapped.
    def drum(h, r):
        bm = bmesh.new()
        n = 24
        rings = []
        for z in (0, h):
            rings.append([bm.verts.new((math.cos(i / n * math.tau) * r * (1 if i % 2 == 0 else 0.9), math.sin(i / n * math.tau) * r * (1 if i % 2 == 0 else 0.9), z)) for i in range(n)])
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((rings[0][i], rings[0][j], rings[1][j], rings[1][i]))
        bm.faces.new(rings[0][::-1])
        bm.faces.new(rings[1])
        return mesh_obj(bm, 'drum', RUIN())

    d1 = drum(1.3, 0.48)
    d1.rotation_euler = (math.radians(90), 0, math.radians(35))
    d1.location = (2.0, -1.6, 0.42)
    apply_tf(d1)
    d2 = drum(1.9, 0.52)
    d2.location = (-2.2, 1.0, -0.2)
    apply_tf(d2)
    cut_plane(d2, (-2.2, 1.0, 1.35), (0.45, -0.2, 1))
    d3 = drum(0.7, 0.5)
    d3.rotation_euler = (math.radians(70), math.radians(20), math.radians(-60))
    d3.location = (-1.1, -2.1, 0.45)
    apply_tf(d3)
    for d in (d1, d2, d3):
        flat(d)
    parts += [d1, d2, d3]
    # Fallen arch segment: five voussoirs on a semicircle, lying tilted across the heap.
    arch = []
    Ri, Ro, th = 1.25, 1.8, 0.55
    for k in range(5):
        a0, a1 = k / 5 * math.pi * 0.62, (k + 1) / 5 * math.pi * 0.62
        bm = bmesh.new()
        g = 0.012
        vs = []
        for a in (a0 + g, a1 - g):
            for rr in (Ri, Ro):
                for y in (-th / 2, th / 2):
                    vs.append(bm.verts.new((math.cos(a) * rr, y, math.sin(a) * rr)))
        for f in [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]:
            bm.faces.new([vs[i] for i in f])
        o = mesh_obj(bm, 'voussoir', RUIN() if k != 2 else RUIN_D())
        mod = o.modifiers.new('bevel', 'BEVEL')
        mod.width = 0.035
        mod.segments = 1
        apply_mod(o, mod)
        arch.append(o)
    a = join(arch)
    a.rotation_euler = (math.radians(38), math.radians(-14), math.radians(15))
    a.location = (-0.9, 0.5, 0.95)
    apply_tf(a)
    flat(a)
    parts.append(a)
    # Scorched timber beams with charred, splintered ends.
    for (p0, p1) in (((-3.3, -1.2, 0.1), (0.3, 0.2, 2.1)), ((0.6, 1.5, 1.7), (3.4, 0.1, 0.1)), ((-1.2, -3.0, 0.1), (1.1, -0.5, 1.6))):
        A, B = Vector(p0), Vector(p1)
        L = (B - A).length
        d = (B - A).normalized()
        rot = Vector((0, 0, 1)).rotation_difference(d).to_euler()
        mid = A + d * L * 0.42
        beam = box((0.24, 0.24, L * 0.84), tuple(mid), tuple(rot), M_WOOD(), 0.02, 1)
        endp = A + d * L * 0.92
        burnt = cyl(0.17, L * 0.16, tuple(endp), tuple(rot), 4, r2=0.03, m=CHAR())
        burnt.rotation_euler = (0, 0, 0)
        parts += [beam, burnt]
        flat(beam)
        flat(burnt)
    for i in range(26):  # loose chips and gravel
        r = random.uniform(2.6, 3.7)
        a = random.random() * math.tau
        chip = ico(random.uniform(0.1, 0.22), (math.cos(a) * r, math.sin(a) * r * 0.92, 0.05), 1, (1, random.uniform(0.6, 1), 0.6),
                   RUIN() if i % 2 else RUIN_D())
        flat(chip)
        parts.append(chip)
    publish(parts, 'rubble_pile')


# ================================================================ build + export
BUILD = [golem_torso, golem_plates, golem_head, golem_arm, golem_leg, colossus_face, colossus_eyes, geode, giant_mushroom,
         lambda: dripstone(5.0, 0.62, False, 8, 1, 'stalactite'), lambda: dripstone(3.5, 0.72, True, 6, 2, 'stalagmite'),
         ancestor_statue, lift_wheel, minecart, heartstone_cluster, boulder, king_crown, quill_body, quill_wing, aldric_staff, rubble_pile]
ONLY = os.environ.get('DEEP_ONLY')  # dev aid: DEEP_ONLY=geode,boulder builds just those, no export
face = None
for fn in BUILD:
    nm = getattr(fn, '__name__', '')
    if ONLY and nm not in ONLY.split(',') and not (nm == '<lambda>' and 'drip' in ONLY):
        continue
    if fn is colossus_face:
        face = fn()
    elif fn is colossus_eyes:
        colossus_eyes(face)
    else:
        fn()
if ONLY:
    if os.environ.get('DEEP_OUT'):
        bpy.ops.export_scene.gltf(filepath=os.environ['DEEP_OUT'], export_format='GLB', export_apply=True, export_yup=True, export_materials='EXPORT')
    raise SystemExit

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True, export_yup=True, export_materials='EXPORT')
print('EXPORTED', OUT)
