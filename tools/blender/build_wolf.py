"""Build Warden (wolf) from Chip's rig. Rebuilds art/wolf/wolf.blend from scratch.

    blender -b art/chipmunk/chipmunk.blend --python tools/blender/build_wolf.py

Warden is a two-legged chibi wolf on a scaled copy of Chip's skeleton, so he reuses Chip's
Idle / Walk / Talk / Run / Yawn / Sleep / WakeUp / Greet. This script adds his own clips:
Sit, Block, Growl (required) and Guard, Proud (so the app never plays a cowering clip on him).
The mesh is simple rounded shapes, each bound to one bone. No shape keys, no textures.
"""
import math
from pathlib import Path
import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'art' / 'wolf' / 'wolf.blend'
S = 1.0 / 0.35                      # Chip is 0.35 m tall, Warden 1.0 m (ASSETS.md)
KEEP = ['Idle', 'Walk', 'Talk', 'Run', 'Yawn', 'Sleep', 'WakeUp', 'Greet']   # Chip clips that suit Warden

# ── 1. Start from Chip's file: keep the rig and the clips above, drop everything else ─────────
rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
for obj in [o for o in bpy.data.objects if o is not rig]:
    bpy.data.objects.remove(obj, do_unlink=True)
for block in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.texts):
    for item in list(block):
        block.remove(item)
rig.name, rig.data.name = 'Wolf.Rig', 'Wolf.Skeleton'
for collection in bpy.data.collections:
    if 'Chip' in collection.name:
        collection.name = 'Warden - mesh and armature'

anim = rig.animation_data
for track in list(anim.nla_tracks):
    if track.name not in KEEP:
        anim.nla_tracks.remove(track)
for action in list(bpy.data.actions):
    if action.name not in KEEP:
        bpy.data.actions.remove(action)


def rig_bag(action):
    """The channelbag that animates the armature (the only slot Warden uses)."""
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                if bag.slot and bag.slot.target_id_type == 'OBJECT':
                    return bag
    raise ValueError(action.name + ': no armature channels')


for action in bpy.data.actions:
    for slot in list(action.slots):
        if slot.target_id_type == 'KEY':            # Chip's face shape keys; Warden has none
            action.slots.remove(slot)
        else:
            slot.name_display = 'Wolf.Rig'

# ── 2. Scale the skeleton and every location key from Chip's size to Warden's ────────────────
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

# ── 3. Materials: flat glossy vinyl colours (linear RGB) ─────────────────────────────────────
def material(name, colour, roughness=0.35):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*colour, 1.0)
    bsdf.inputs['Roughness'].default_value = roughness
    return mat


MATERIALS = {
    'slate': material('Warden slate coat', (0.082, 0.094, 0.115)),
    'cream': material('Warden cream', (0.80, 0.70, 0.53)),
    'black': material('Warden eyes and nose', (0.008, 0.008, 0.010), 0.15),
    'white': material('Warden eye glints', (1.0, 1.0, 1.0), 0.3),
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


# Head (boxy, like the reference), cheek fur, face mask. D lowers the whole face so the big ears fit under 1.1 m.
D = -0.012
shape('slate', 'Head', (0, -0.012, 0.250 + D), (0.118, 0.095, 0.080), (32, 16), power=0.72)
for z in (0.264, 0.236, 0.208):
    for side in (-1, 1):
        shape('slate', 'Head', (side * 0.116, -0.020, z + D), (0.020, 0.020, 0.030), (10, 6), rot=(0, side * 112, 0), taper=1.0)
shape('cream', 'Head', (0, -0.084, 0.218 + D), (0.094, 0.030, 0.044), (16, 8))                 # lower face
for side in (-1, 1):
    shape('cream', 'Head', (side * 0.049, -0.090, 0.254 + D), (0.036, 0.024, 0.030), (12, 8))  # around the eye
    shape('slate', 'Head', (side * 0.046, -0.112, 0.281 + D), (0.036, 0.012, 0.009), (12, 6), rot=(0, -side * 24, 0))   # stern brow: inner end low
    shape('black', 'Head', (side * 0.048, -0.108, 0.251 + D), (0.019, 0.019, 0.020), (16, 8))  # eye
    shape('white', 'Head', (side * 0.048 + 0.006, -0.125, 0.258 + D), (0.005, 0.004, 0.005), (8, 6))
    # Ears: Chip's rig names the -X ear "L"
    ear = 'Ear.L' if side < 0 else 'Ear.R'
    shape('slate', ear, (side * 0.080, 0.002, 0.331), (0.046, 0.019, 0.044), (12, 8), rot=(0, side * 14, 0), taper=0.55)
    shape('cream', ear, (side * 0.080, -0.011, 0.326), (0.028, 0.012, 0.030), (10, 6), rot=(0, side * 14, 0), taper=0.55)
shape('cream', 'Head', (0, -0.108, 0.220 + D), (0.040, 0.026, 0.026), (12, 8))                 # muzzle
shape('black', 'Head', (0, -0.132, 0.233 + D), (0.017, 0.011, 0.011), (12, 6))                 # nose
shape('cream', 'Jaw', (0, -0.104, 0.201 + D), (0.030, 0.022, 0.012), (12, 6))                  # lower jaw
shape('black', 'Jaw', (0, -0.126, 0.205 + D), (0.012, 0.004, 0.003), (8, 6))                   # mouth line

# Body and chest patch
shape('slate', 'Spine', (0, 0.000, 0.116), (0.062, 0.052, 0.062), (24, 12))
shape('cream', 'Spine', (0, -0.034, 0.118), (0.038, 0.026, 0.046), (12, 8))

# Arms follow Chip's arm bones (paws held in front), legs, feet
ARM = {'shoulder': (0.064, -0.001, 0.155), 'elbow': (0.056, -0.025, 0.127), 'wrist': (0.028, -0.056, 0.126), 'tip': (0.017, -0.073, 0.126)}
for side, tag in ((-1, 'L'), (1, 'R')):
    pt = {k: Vector((side * v[0], v[1], v[2])) for k, v in ARM.items()}
    shape('slate', 'Arm.' + tag, (pt['shoulder'] + pt['elbow']) / 2, (0.021, 0.021, 0.027), (10, 6))
    shape('slate', 'Forearm.' + tag, (pt['elbow'] + pt['wrist']) / 2, (0.024, 0.024, 0.019), (10, 6))
    shape('cream', 'Paw.' + tag, (pt['wrist'] + pt['tip']) / 2, (0.020, 0.022, 0.019), (10, 6))
    shape('slate', 'Leg.' + tag, (side * 0.041, 0.002, 0.045), (0.026, 0.026, 0.034), (12, 6))
    shape('slate', 'Foot.' + tag, (side * 0.041, -0.016, 0.015), (0.028, 0.040, 0.015), (12, 6))

# Tail: five bushy segments along Chip's tail bones, each stretched along its bone so they merge; cream tip
TAIL = [(0.038, 0.069), (0.080, 0.056), (0.123, 0.085), (0.144, 0.129), (0.134, 0.179), (0.101, 0.233)]
for i, radius in enumerate((0.027, 0.036, 0.042, 0.040, 0.031)):
    (y0, z0), (y1, z1) = TAIL[i], TAIL[i + 1]
    length = math.hypot(y1 - y0, z1 - z0)
    shape('cream' if i == 4 else 'slate', 'Tail.0%d' % (i + 1), (0, (y0 + y1) / 2, (z0 + z1) / 2),
          (radius, length / 2 + radius * 0.75, radius), (12, 8), rot=(math.degrees(math.atan2(z1 - z0, y1 - y0)), 0, 0))

mesh = bpy.data.meshes.new('Wolf.Mesh')
mesh.from_pydata([tuple(v) for v in verts], [], faces)
mesh.polygons.foreach_set('material_index', face_mats)
mesh.polygons.foreach_set('use_smooth', [True] * len(mesh.polygons))
for mat in MATERIALS.values():
    mesh.materials.append(mat)
mesh.update()
body = bpy.data.objects.new('Wolf.Mesh', mesh)
rig.users_collection[0].objects.link(body)
body.parent = rig
groups = {}
for index, bone in enumerate(vert_bones):
    groups.setdefault(bone, body.vertex_groups.new(name=bone)).add([index], 1.0, 'REPLACE')
body.modifiers.new('Wolf skeletal deformation', 'ARMATURE').object = rig

# ── 5. Warden's own clips, written as offsets from Chip's neutral pose (Idle, frame 1) ───────
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
            if 'rot' in offset:
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
    slot = action.slots.new(id_type='OBJECT', name='Wolf.Rig')
    bag = action.layers.new('Layer').strips.new(type='KEYFRAME').channelbag(slot, ensure=True)
    for path, index, group, value in BASE:
        if 'constraints' in path:
            value = 0.0                                    # arms are posed directly in Warden's clips
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


def arms(out):
    """Both arms swung out to the sides by `out` degrees (0 = Chip's paws-in-front rest)."""
    return {'Arm.L': {'rot': (0, 0, out)}, 'Arm.R': {'rot': (0, 0, -out)},
            'Forearm.L': {'rot': (0, -out * 0.55, 0)}, 'Forearm.R': {'rot': (0, out * 0.55, 0)}}


def sit(t):                                     # loop, 2 s: sits upright, slow look around, ear flick
    w = 2 * math.pi * t / 2.0
    flick = max(0.0, math.sin(w)) ** 6 * 14
    return {'Hips': {'loc': (0, 0.010, -0.040)}, 'Leg.L': {'rot': (-82, 0, 8)}, 'Leg.R': {'rot': (-82, 0, -8)},
            'Spine': {'rot': (-4 + 1.2 * math.sin(w), 0, 0)}, 'Head': {'rot': (-3, 6 * math.sin(w), 0)},
            'Ear.R': {'rot': (flick, 0, 0)}, 'Tail.01': {'rot': (0, 7 * math.sin(w), 0)}, **arms(0)}


def block(t):                                   # one-shot, 1 s: leaps forward, lands planted, arms out, head low
    leap = math.sin(math.pi * smooth(t, 0.12, 0.50))
    land = smooth(t, 0.45, 0.60)
    crouch = -0.012 * smooth(t, 0.0, 0.12) * (1 - smooth(t, 0.12, 0.25)) - 0.020 * land + 0.008 * smooth(t, 0.65, 0.95)
    out = smooth(t, 0.15, 0.50)
    return {'Root': {'loc': (0, -0.014 * smooth(t, 0.12, 0.50), 0.036 * leap)}, 'Hips': {'loc': (0, 0, crouch)},
            'Leg.L': {'rot': (0, 0, 14 * out)}, 'Leg.R': {'rot': (0, 0, -14 * out)},
            'Spine': {'rot': (9 * land, 0, 0)}, 'Head': {'rot': (11 * land - 6 * leap, 0, 0)},
            'Ear.L': {'rot': (10 * out, 0, 0)}, 'Ear.R': {'rot': (10 * out, 0, 0)}, **arms(72 * out)}


def growl(t):                                   # one-shot, 1.2 s: head lowers, jaw opens, low shake, back to neutral
    e = smooth(t, 0.0, 0.25) * (1 - smooth(t, 0.95, 1.2))
    shake = math.sin(2 * math.pi * 9 * t) * 3 * e
    return {'Hips': {'loc': (0, 0, -0.008 * e)}, 'Spine': {'rot': (10 * e, 0, 0)}, 'Head': {'rot': (14 * e, shake, 0)},
            'Jaw': {'rot': (16 * e, 0, 0)}, 'Ear.L': {'rot': (12 * e, 0, 0)}, 'Ear.R': {'rot': (12 * e, 0, 0)}, **arms(18 * e)}


def guard(t):                                   # loop, 1.5 s: planted, arms out, steady (never trembling)
    w = 2 * math.pi * t / 1.5
    return {'Hips': {'loc': (0.004 * math.sin(w), 0, -0.012)}, 'Leg.L': {'rot': (0, 0, 14)}, 'Leg.R': {'rot': (0, 0, -14)},
            'Spine': {'rot': (8, 0, 0)}, 'Head': {'rot': (9, 2 * math.sin(w), 0)},
            'Ear.L': {'rot': (10, 0, 0)}, 'Ear.R': {'rot': (10, 0, 0)}, **arms(64)}


def proud(t):                                   # loop, 2 s: chest out, chin up, slow tail wag
    w = 2 * math.pi * t / 2.0
    return {'Hips': {'loc': (0, 0, 0.002 * math.sin(w))}, 'Spine': {'rot': (-7, 0, 0)}, 'Head': {'rot': (-9, 0, 0)},
            'Tail.01': {'rot': (0, 14 * math.sin(w), 0)}, 'Tail.03': {'rot': (0, 8 * math.sin(w - 0.6), 0)}, **arms(10)}


for clip_name, seconds, pose_fn in (('Sit', 2.0, sit), ('Block', 1.0, block), ('Growl', 1.2, growl), ('Guard', 1.5, guard), ('Proud', 2.0, proud)):
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
