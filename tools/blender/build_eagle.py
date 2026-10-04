"""Build Scout (eagle) from Chip's rig. Rebuilds art/eagle/eagle.blend from scratch.

    blender -b art/chipmunk/chipmunk.blend --python tools/blender/build_eagle.py

Scout is a chibi bald eagle on a scaled copy of Chip's skeleton. He keeps Chip's clips (Idle, Talk, Happy
are required) with the arms held still, because his wings ride the arm bones. This script adds Fly,
Takeoff, and Land. The mesh is simple rounded shapes, each bound to one bone. No shape keys, no textures.
"""
import math
from pathlib import Path
import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'art' / 'eagle' / 'eagle.blend'
S = 0.7 / 0.35                      # Chip is 0.35 m tall, Scout 0.7 m perched (ASSETS.md)
KEEP = [a.name for a in bpy.data.actions]   # every Chip clip

# ── 1. Start from Chip's file: keep the rig and the clips above, drop everything else ─────────
rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
for obj in [o for o in bpy.data.objects if o is not rig]:
    bpy.data.objects.remove(obj, do_unlink=True)
for block in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.texts):
    for item in list(block):
        block.remove(item)
rig.name, rig.data.name = 'Eagle.Rig', 'Eagle.Skeleton'
for collection in bpy.data.collections:
    if 'Chip' in collection.name:
        collection.name = 'Scout - mesh and armature'

anim = rig.animation_data
for track in list(anim.nla_tracks):
    if track.name not in KEEP:
        anim.nla_tracks.remove(track)
for action in list(bpy.data.actions):
    if action.name not in KEEP:
        bpy.data.actions.remove(action)


def rig_bag(action):
    """The channelbag that animates the armature (the only slot Scout uses)."""
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                if bag.slot and bag.slot.target_id_type == 'OBJECT':
                    return bag
    raise ValueError(action.name + ': no armature channels')


for action in bpy.data.actions:
    for slot in list(action.slots):
        if slot.target_id_type == 'KEY':            # Chip's face shape keys; Scout has none
            action.slots.remove(slot)
        else:
            slot.name_display = 'Eagle.Rig'

# ── 2. Scale the skeleton and every location key from Chip's size to Scout's ────────────────
bpy.context.view_layer.objects.active = rig
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
rig.scale = (S, S, S)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
for action in bpy.data.actions:
    for curve in rig_bag(action).fcurves:
        if curve.data_path.endswith('.location'):
            for point in curve.keyframe_points:
                point.co.y *= S
                point.handle_left.y *= S
                point.handle_right.y *= S
            curve.update()

# Scout's wings ride Chip's arm bones. Hold the arms at rest in every inherited clip so the wings stay folded.
ARM_BONES = ('Arm.L', 'Arm.R', 'Forearm.L', 'Forearm.R', 'Paw.L', 'Paw.R')
for action in bpy.data.actions:
    for curve in rig_bag(action).fcurves:
        still = 'constraints' in curve.data_path or any(curve.data_path == 'pose.bones["%s"].rotation_euler' % b for b in ARM_BONES)
        if still:
            for point in curve.keyframe_points:
                point.co.y = point.handle_left.y = point.handle_right.y = 0.0
            curve.update()

# ── 3. Materials: flat glossy vinyl colours (linear RGB) ─────────────────────────────────────
def material(name, colour, roughness=0.3):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*colour, 1.0)
    bsdf.inputs['Roughness'].default_value = roughness
    return mat


MATERIALS = {
    'white': material('Scout white head', (0.900, 0.880, 0.840)),
    'brown': material('Scout brown body', (0.150, 0.050, 0.030)),
    'gold': material('Scout gold beak and feet', (0.890, 0.440, 0.020)),
    'black': material('Scout eyes', (0.008, 0.008, 0.010), 0.15),
}
MAT_INDEX = {key: i for i, key in enumerate(MATERIALS)}

# ── 4. Mesh: rounded shapes in Chip units (0.35 m tall, facing -Y), scaled by S ──────────────
verts, faces, face_mats, vert_bones = [], [], [], []


def shape(mat, bone, center, radii, seg=(12, 6), rot=(0, 0, 0), power=1.0, taper=0.0):
    """One closed shape bound to one bone. power < 1 is boxier; taper > 0 pinches the +Z end to a point."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg[0], v_segments=seg[1], radius=1.0)
    turn = Euler([math.radians(a) for a in rot], 'XYZ').to_matrix()
    offset = len(verts)
    for v in bm.verts:
        p = Vector([math.copysign(abs(c) ** power, c) for c in v.co])
        if taper:
            pinch = ((1.0 - p.z) / 2.0) ** taper
            p.x *= pinch
            p.y *= pinch
        p = turn @ Vector((p.x * radii[0], p.y * radii[1], p.z * radii[2])) + Vector(center)
        verts.append(p * S)
        vert_bones.append(bone)
    for f in bm.faces:
        faces.append([offset + v.index for v in f.verts])
        face_mats.append(MAT_INDEX[mat])
    bm.free()


# Head: big white head with a feather tuft, stern brows, hooked gold beak
shape('white', 'Head', (0, -0.012, 0.236), (0.112, 0.098, 0.090), (32, 16), power=0.85)
for x, y, tilt in ((-0.022, -0.02, -18), (0.0, -0.01, 0), (0.022, -0.02, 18)):
    shape('white', 'Head', (x, y, 0.330), (0.016, 0.014, 0.030), (10, 6), rot=(-20, tilt, 0), taper=0.8)
shape('gold', 'Head', (0, -0.108, 0.218), (0.032, 0.024, 0.036), (12, 8), rot=(112, 0, 0), taper=0.7)      # upper beak, hooked down
shape('gold', 'Jaw', (0, -0.100, 0.196), (0.018, 0.020, 0.008), (10, 6))                                  # lower beak
for side in (-1, 1):
    shape('black', 'Head', (side * 0.052, -0.094, 0.238), (0.020, 0.018, 0.021), (16, 8))              # eye
    shape('white', 'Head', (side * 0.052 + 0.006, -0.110, 0.246), (0.005, 0.004, 0.005), (8, 6))
    shape('brown', 'Head', (side * 0.050, -0.104, 0.268), (0.034, 0.010, 0.008), (12, 6), rot=(0, -side * 24, 0))   # stern brow: inner end low

# Body: brown, with a white collar under the head and a pointed white chest bib
shape('brown', 'Spine', (0, 0.000, 0.105), (0.064, 0.054, 0.062), (24, 12))
shape('white', 'Spine', (0, 0.000, 0.160), (0.074, 0.064, 0.022), (16, 8))
shape('white', 'Spine', (0, -0.040, 0.128), (0.042, 0.020, 0.046), (12, 8), rot=(180, 0, 0), taper=0.8)

# Wings hang at his sides and ride the arm bones (Chip's rig names the -X side "L"). Brown blade, gold feather tips.
for side, tag in ((-1, 'L'), (1, 'R')):
    shape('brown', 'Arm.' + tag, (side * 0.082, 0.004, 0.118), (0.020, 0.042, 0.050), (12, 8))
    for y, drop in ((-0.022, 0.0), (0.004, -0.008), (0.030, 0.0)):
        shape('gold', 'Arm.' + tag, (side * 0.086, y, 0.072 + drop), (0.013, 0.016, 0.034), (10, 6), rot=(180, 0, 0), taper=0.6)
    shape('brown', 'Leg.' + tag, (side * 0.038, 0.002, 0.045), (0.023, 0.023, 0.032), (12, 6))
    shape('gold', 'Foot.' + tag, (side * 0.040, -0.016, 0.014), (0.030, 0.040, 0.014), (12, 6))
    for toe in (-0.016, 0.0, 0.016):
        shape('gold', 'Foot.' + tag, (side * 0.040 + toe, -0.048, 0.011), (0.010, 0.014, 0.011), (8, 6))

# White fan tail on Chip's first tail bone
shape('white', 'Tail.01', (0, 0.072, 0.066), (0.044, 0.046, 0.013), (12, 8), rot=(-32, 0, 0))

mesh = bpy.data.meshes.new('Eagle.Mesh')
mesh.from_pydata([tuple(v) for v in verts], [], faces)
mesh.polygons.foreach_set('material_index', face_mats)
mesh.polygons.foreach_set('use_smooth', [True] * len(mesh.polygons))
for mat in MATERIALS.values():
    mesh.materials.append(mat)
mesh.update()
body = bpy.data.objects.new('Eagle.Mesh', mesh)
rig.users_collection[0].objects.link(body)
body.parent = rig
groups = {}
for index, bone in enumerate(vert_bones):
    groups.setdefault(bone, body.vertex_groups.new(name=bone)).add([index], 1.0, 'REPLACE')
body.modifiers.new('Eagle skeletal deformation', 'ARMATURE').object = rig

# ── 5. Scout's own clips, written as offsets from Chip's neutral pose (Idle, frame 1) ────────
idle = bpy.data.actions['Idle']
BASE = [(c.data_path, c.array_index, c.group.name if c.group else '', c.evaluate(1)) for c in rig_bag(idle).fcurves]
REST = {bone.name: bone.matrix_local.to_3x3() for bone in rig.data.bones}
strip_template = next(t for t in anim.nla_tracks if t.name == 'Idle').strips[0]


def bone_of(path):
    return path.split('"')[1] if path.startswith('pose.bones["') else None


def base_vector(bone, prop):
    values = [0.0, 0.0, 0.0]
    for path, index, _group, value in BASE:
        if path == 'pose.bones["%s"].%s' % (bone, prop):
            values[index] = value
    return values


def smooth(t, start, end):
    """0 before start, 1 after end, eased in between."""
    x = min(1.0, max(0.0, (t - start) / (end - start)))
    return x * x * (3 - 2 * x)


def make_clip(name, seconds, pose):
    """pose(t) -> {bone: {'rot': (pitch, yaw, roll) degrees, 'loc': (x, y, z) Chip units}} in armature axes.
    Pitch + leans forward/down, yaw turns about up, roll tips sideways. Location: x right, y back, z up."""
    count = round(seconds * 30) + 1
    samples = {}
    previous = {}
    for frame in range(count):
        offsets = pose(frame / 30.0)
        for bone, offset in offsets.items():
            rest = REST[bone]
            if 'rot' in offset or 'mat' in offset:
                if 'mat' in offset:
                    world = offset['mat']                  # a ready-made rotation in armature axes
                else:
                    pitch, yaw, roll = (math.radians(a) for a in offset['rot'])
                    world = Matrix.Rotation(yaw, 3, 'Z') @ Matrix.Rotation(roll, 3, 'Y') @ Matrix.Rotation(pitch, 3, 'X')
                local = rest.inverted() @ world @ rest
                start = Euler(base_vector(bone, 'rotation_euler'), 'XYZ').to_matrix()
                value = (local @ start).to_euler('XYZ', previous[bone]) if bone in previous else (local @ start).to_euler('XYZ')
                previous[bone] = value
                for i in range(3):
                    samples.setdefault(('pose.bones["%s"].rotation_euler' % bone, i), {})[frame] = value[i]
            if 'loc' in offset:
                local = rest.inverted() @ (Vector(offset['loc']) * S)
                start = base_vector(bone, 'location')
                for i in range(3):
                    samples.setdefault(('pose.bones["%s"].location' % bone, i), {})[frame] = start[i] + local[i]
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    slot = action.slots.new(id_type='OBJECT', name='Eagle.Rig')
    bag = action.layers.new('Layer').strips.new(type='KEYFRAME').channelbag(slot, ensure=True)
    for path, index, group, value in BASE:
        if 'constraints' in path:
            value = 0.0                                    # wings are posed directly in Scout's clips
        curve = bag.fcurves.new(path, index=index, group_name=group) if group else bag.fcurves.new(path, index=index)
        keyed = samples.get((path, index), {})
        curve.keyframe_points.add(count)
        for frame, point in enumerate(curve.keyframe_points):
            point.co = (frame + 1, keyed.get(frame, value))
            point.interpolation = 'LINEAR'
        curve.update()
    track = anim.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, 1, action)
    strip.action_slot = slot
    strip.blend_type, strip.extrapolation, strip.influence = strip_template.blend_type, strip_template.extrapolation, strip_template.influence
    track.mute = True
    return action


def wings(out):
    """Both wings lifted `out` degrees from folded. They also turn flat-side-forward as they open."""
    turn = 90 * smooth(out, 0, 50)
    def one(sign):
        return Matrix.Rotation(math.radians(sign * out), 3, 'Y') @ Matrix.Rotation(math.radians(sign * turn), 3, 'Z')
    return {'Arm.L': {'mat': one(1)}, 'Arm.R': {'mat': one(-1)}}


def airborne(f, lift=0.0):
    """Flying posture blended in by f (0 standing, 1 flying): body tipped forward, head level, legs trailing."""
    return {'Root': {'loc': (0, 0, lift)}, 'Spine': {'rot': (30 * f, 0, 0)}, 'Head': {'rot': (-22 * f, 0, 0)},
            'Leg.L': {'rot': (55 * f, 0, 0)}, 'Leg.R': {'rot': (55 * f, 0, 0)}, 'Tail.01': {'rot': (-20 * f, 0, 0)}}


def fly(t):                                     # loop, 0.6 s: one full wing beat, body rising on the downstroke
    w = 2 * math.pi * t / 0.6
    return {**airborne(1.0), 'Hips': {'loc': (0, 0, -0.006 * math.sin(w))}, **wings(85 + 35 * math.sin(w))}


def takeoff(t):                                 # one-shot, 0.8 s: crouch, wings up, push off, into the flying posture
    crouch = smooth(t, 0.0, 0.22) * (1 - smooth(t, 0.25, 0.40))
    rise = smooth(t, 0.25, 0.60)
    out = 112 * smooth(t, 0.0, 0.22) - 62 * smooth(t, 0.25, 0.42) + 35 * smooth(t, 0.45, 0.80)
    return {**airborne(smooth(t, 0.35, 0.80), 0.040 * rise), 'Hips': {'loc': (0, 0, -0.016 * crouch)}, **wings(out)}


def land(t):                                    # one-shot, 0.8 s: flare the wings, touch down, fold them
    f = 1 - smooth(t, 0.10, 0.50)
    squash = smooth(t, 0.42, 0.55) * (1 - smooth(t, 0.55, 0.80))
    out = 85 + 30 * smooth(t, 0.0, 0.20) - 115 * smooth(t, 0.45, 0.80)
    return {**airborne(f, 0.040 * (1 - smooth(t, 0.0, 0.45))), 'Hips': {'loc': (0, 0, -0.014 * squash)}, **wings(out)}


for clip_name, seconds, pose_fn in (('Fly', 0.6, fly), ('Takeoff', 0.8, takeoff), ('Land', 0.8, land)):
    make_clip(clip_name, seconds, pose_fn)

# ── 6. Save ──────────────────────────────────────────────────────────────────────────────────
anim.action = idle
anim.action_slot = rig_bag(idle).slot
scene = bpy.context.scene
scene.frame_start, scene.frame_end = 1, 91
scene.frame_set(1)
OUT.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT))
mesh.calc_loop_triangles()
print('BUILT', OUT, '| triangles', len(mesh.loop_triangles), '| bones', len(rig.data.bones), '| clips', sorted(a.name for a in bpy.data.actions))
