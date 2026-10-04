"""Build Pixel (Google Workspace character) from Chip's rig. Rebuilds art/workspace/pixel.blend from scratch.

    blender -b art/chipmunk/chipmunk.blend --python tools/blender/build_pixel.py

Pixel is a small white firefly postmaster on a scaled copy of Chip's skeleton and keeps Chip's clips
(Idle, Walk, Talk, Happy, Handoff are required). This script adds Write, the letter-writing loop.
The mesh is simple rounded shapes, each bound to one bone. No shape keys, no textures.
"""
import math
from pathlib import Path
import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'art' / 'workspace' / 'pixel.blend'
S = 0.7 / 0.35                      # Chip is 0.35 m tall, Pixel 0.7 m (ASSETS.md)
KEEP = [a.name for a in bpy.data.actions]   # every Chip clip

# ── 1. Start from Chip's file: keep the rig and the clips above, drop everything else ─────────
rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
for obj in [o for o in bpy.data.objects if o is not rig]:
    bpy.data.objects.remove(obj, do_unlink=True)
for block in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.texts):
    for item in list(block):
        block.remove(item)
rig.name, rig.data.name = 'Pixel.Rig', 'Pixel.Skeleton'
for collection in bpy.data.collections:
    if 'Chip' in collection.name:
        collection.name = 'Pixel - mesh and armature'

anim = rig.animation_data
for track in list(anim.nla_tracks):
    if track.name not in KEEP:
        anim.nla_tracks.remove(track)
for action in list(bpy.data.actions):
    if action.name not in KEEP:
        bpy.data.actions.remove(action)


def rig_bag(action):
    """The channelbag that animates the armature (the only slot Pixel uses)."""
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                if bag.slot and bag.slot.target_id_type == 'OBJECT':
                    return bag
    raise ValueError(action.name + ': no armature channels')


for action in bpy.data.actions:
    for slot in list(action.slots):
        if slot.target_id_type == 'KEY':            # Chip's face shape keys; Pixel has none
            action.slots.remove(slot)
        else:
            slot.name_display = 'Pixel.Rig'

# ── 2. Scale the skeleton and every location key from Chip's size to Pixel's ────────────────
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

# ── 3. Materials: flat glossy colours (linear RGB). The four accents are Google's blue, red, yellow, green ──
def material(name, colour, roughness=0.35, glow=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*colour, 1.0)
    bsdf.inputs['Roughness'].default_value = roughness
    if glow:
        bsdf.inputs['Emission Color'].default_value = (*colour, 1.0)
        bsdf.inputs['Emission Strength'].default_value = glow
    return mat


MATERIALS = {
    'white': material('Pixel white body', (0.900, 0.880, 0.840)),
    'black': material('Pixel hands, feet, pupils', (0.015, 0.015, 0.020), 0.25),
    'blue': material('Pixel blue', (0.054, 0.235, 0.905)),
    'red': material('Pixel red', (0.820, 0.056, 0.036)),
    'yellow': material('Pixel yellow', (0.965, 0.500, 0.010)),
    'green': material('Pixel green', (0.034, 0.390, 0.086)),
    'wing': material('Pixel wings', (0.700, 0.840, 0.950), 0.2),
    'brown': material('Pixel satchel', (0.200, 0.090, 0.040), 0.5),
    'pink': material('Pixel blush', (0.900, 0.450, 0.420)),
    'glow': material('Pixel tail light', (1.000, 0.800, 0.250), 0.4, glow=2.0),
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


# Head: one big round white head with a small tuft
shape('white', 'Head', (0, -0.010, 0.215), (0.105, 0.095, 0.088), (32, 16))
shape('white', 'Head', (0, -0.030, 0.300), (0.022, 0.016, 0.020), (10, 6), rot=(-25, 0, 0), taper=0.9)
for side in (-1, 1):
    shape('black', 'Head', (side * 0.045, -0.089, 0.212), (0.027, 0.014, 0.032), (16, 8))      # eye
    shape('blue', 'Head', (side * 0.045, -0.097, 0.207), (0.019, 0.009, 0.021), (12, 8))       # iris
    shape('black', 'Head', (side * 0.045, -0.102, 0.208), (0.010, 0.006, 0.012), (10, 6))      # pupil
    shape('white', 'Head', (side * 0.045 + 0.009, -0.104, 0.224), (0.007, 0.004, 0.008), (8, 6))
    shape('pink', 'Head', (side * 0.070, -0.075, 0.183), (0.016, 0.008, 0.009), (10, 6))       # blush
    # Antennae ride Chip's ear bones (the -X one is "L"): blue ball on his right, red on his left
    ear = 'Ear.L' if side < 0 else 'Ear.R'
    shape('black', ear, (side * 0.055, 0.000, 0.318), (0.005, 0.005, 0.034), (8, 6), rot=(0, side * 28, 0))
    shape('blue' if side < 0 else 'red', ear, (side * 0.074, 0.000, 0.352), (0.020, 0.020, 0.020), (12, 8))
shape('red', 'Jaw', (0, -0.101, 0.181), (0.012, 0.006, 0.009), (10, 6))                         # open smile

# Body, arms (white with black hands), black legs and feet
shape('white', 'Spine', (0, 0.000, 0.105), (0.056, 0.049, 0.058), (24, 12))
ARM = {'shoulder': (0.064, -0.001, 0.155), 'elbow': (0.056, -0.025, 0.127), 'wrist': (0.028, -0.056, 0.126), 'tip': (0.017, -0.073, 0.126)}
for side, tag in ((-1, 'L'), (1, 'R')):
    pt = {k: Vector((side * v[0], v[1], v[2])) for k, v in ARM.items()}
    shape('white', 'Arm.' + tag, (pt['shoulder'] + pt['elbow']) / 2, (0.019, 0.019, 0.026), (10, 6))
    shape('white', 'Forearm.' + tag, (pt['elbow'] + pt['wrist']) / 2, (0.022, 0.022, 0.018), (10, 6))
    shape('black', 'Paw.' + tag, (pt['wrist'] + pt['tip']) / 2, (0.019, 0.021, 0.018), (10, 6))
    shape('black', 'Leg.' + tag, (side * 0.036, 0.002, 0.042), (0.020, 0.020, 0.034), (12, 6))
    shape('black', 'Foot.' + tag, (side * 0.037, -0.014, 0.013), (0.024, 0.034, 0.013), (12, 6))
    # Wings: a pale blade in front of a slightly larger coloured rim. Upper rims blue / red, lower rims green / yellow.
    shape('wing', 'Spine', (side * 0.118, 0.045, 0.172), (0.066, 0.004, 0.040), (16, 8), rot=(0, -side * 16, 0))
    shape('blue' if side < 0 else 'red', 'Spine', (side * 0.119, 0.050, 0.172), (0.074, 0.004, 0.048), (16, 8), rot=(0, -side * 16, 0))
    shape('wing', 'Spine', (side * 0.100, 0.045, 0.112), (0.044, 0.004, 0.026), (12, 8), rot=(0, side * 20, 0))
    shape('green' if side < 0 else 'yellow', 'Spine', (side * 0.101, 0.050, 0.112), (0.051, 0.004, 0.033), (12, 8), rot=(0, side * 20, 0))
    shape('wing', 'Spine', (side * 0.118, 0.055, 0.172), (0.066, 0.004, 0.040), (16, 8), rot=(0, -side * 16, 0))      # back faces, so the rim
    shape('wing', 'Spine', (side * 0.100, 0.055, 0.112), (0.044, 0.004, 0.026), (12, 8), rot=(0, side * 20, 0))       # shows as an edge from behind too

# Satchel with a letter, worn across the body
shape('brown', 'Spine', (-0.004, -0.047, 0.118), (0.006, 0.006, 0.062), (8, 6), rot=(0, 38, 0))      # strap
shape('brown', 'Spine', (0.046, -0.044, 0.072), (0.027, 0.016, 0.022), (12, 8), power=0.6)           # bag
shape('white', 'Spine', (0.046, -0.044, 0.098), (0.017, 0.004, 0.013), (8, 6), power=0.5)            # letter
shape('red', 'Spine', (0.046, -0.049, 0.101), (0.009, 0.002, 0.005), (8, 6))                         # its red flap
shape('yellow', 'Spine', (0.046, -0.060, 0.070), (0.005, 0.003, 0.005), (8, 6))                      # clasp

# Glowing tail light, on Chip's first tail bone so it sways
shape('glow', 'Tail.01', (0, 0.052, 0.058), (0.023, 0.020, 0.025), (12, 8), power=0.6)

mesh = bpy.data.meshes.new('Pixel.Mesh')
mesh.from_pydata([tuple(v) for v in verts], [], faces)
mesh.polygons.foreach_set('material_index', face_mats)
mesh.polygons.foreach_set('use_smooth', [True] * len(mesh.polygons))
for mat in MATERIALS.values():
    mesh.materials.append(mat)
mesh.update()
body = bpy.data.objects.new('Pixel.Mesh', mesh)
rig.users_collection[0].objects.link(body)
body.parent = rig
groups = {}
for index, bone in enumerate(vert_bones):
    groups.setdefault(bone, body.vertex_groups.new(name=bone)).add([index], 1.0, 'REPLACE')
body.modifiers.new('Pixel skeletal deformation', 'ARMATURE').object = rig

# ── 5. Pixel's own clip, written as offsets from Chip's neutral pose (Idle, frame 1) ─────────
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
    slot = action.slots.new(id_type='OBJECT', name='Pixel.Rig')
    bag = action.layers.new('Layer').strips.new(type='KEYFRAME').channelbag(slot, ensure=True)
    for path, index, group, value in BASE:
        if 'constraints' in path:
            value = 0.0                                    # arms are posed directly in Pixel's clip
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


def write(t):                                   # loop, 2 s: head down, one hand scribbling, antennae bobbing
    w = 2 * math.pi * t / 2.0
    return {'Spine': {'rot': (4, 0, 0)}, 'Head': {'rot': (9 + 1.5 * math.sin(w), 3 * math.sin(w), 0)},
            'Arm.L': {'rot': (0, 0, 0)}, 'Forearm.L': {'rot': (0, 0, 0)},
            'Arm.R': {'rot': (3 * math.sin(3 * w), 0, 0)}, 'Forearm.R': {'rot': (6 * math.sin(3 * w), 10 * math.sin(3 * w + 1.0), 0)},
            'Paw.R': {'rot': (9 * math.sin(6 * w), 0, 0)},
            'Ear.L': {'rot': (6 * math.sin(2 * w), 0, 0)}, 'Ear.R': {'rot': (6 * math.sin(2 * w + 0.8), 0, 0)}}


make_clip('Write', 2.0, write)

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
