"""Build one Swarm ant from Chip's rig. Rebuilds art/ants/ant.blend from scratch.

    blender -b art/chipmunk/chipmunk.blend --python tools/blender/build_ant.py

The app copies this one ant into a swarm of twelve, so it is kept under 3,000 triangles.
It sits on a scaled copy of Chip's skeleton and keeps Chip's clips (Idle, Happy, Talk are required),
with Walk sped up to a scurry. This script adds Carry: the fast walk with a leaf held overhead.
The leaf rides Chip's Scroll bone and is shrunk to nothing in every other clip.
"""
import math
from pathlib import Path
import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'art' / 'ants' / 'ant.blend'
S = 0.08 / 0.35                     # Chip is 0.35 m tall, one ant 0.08 m (ASSETS.md)
KEEP = [a.name for a in bpy.data.actions]   # every Chip clip

# ── 1. Start from Chip's file: keep the rig and the clips above, drop everything else ─────────
rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
for obj in [o for o in bpy.data.objects if o is not rig]:
    bpy.data.objects.remove(obj, do_unlink=True)
for block in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.texts):
    for item in list(block):
        block.remove(item)
rig.name, rig.data.name = 'Ant.Rig', 'Ant.Skeleton'
for collection in bpy.data.collections:
    if 'Chip' in collection.name:
        collection.name = 'Swarm ant - mesh and armature'

anim = rig.animation_data
for track in list(anim.nla_tracks):
    if track.name not in KEEP:
        anim.nla_tracks.remove(track)
for action in list(bpy.data.actions):
    if action.name not in KEEP:
        bpy.data.actions.remove(action)


def rig_bag(action):
    """The channelbag that animates the armature (the only slot the ant uses)."""
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                if bag.slot and bag.slot.target_id_type == 'OBJECT':
                    return bag
    raise ValueError(action.name + ': no armature channels')


for action in bpy.data.actions:
    for slot in list(action.slots):
        if slot.target_id_type == 'KEY':            # Chip's face shape keys; the ant has none
            action.slots.remove(slot)
        else:
            slot.name_display = 'Ant.Rig'

# ── 2. Scale the skeleton and every location key from Chip's size to the ant's ────────────────
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

HIDDEN = 0.001                      # scale that hides the leaf

for action in bpy.data.actions:
    for curve in rig_bag(action).fcurves:
        if curve.data_path == 'pose.bones["Scroll"].scale':            # no leaf in Chip's clips
            for point in curve.keyframe_points:
                point.co.y = point.handle_left.y = point.handle_right.y = HIDDEN
            curve.update()


def retime(action, factor):
    """Play an action faster: frame 1 stays, every other key moves closer to it."""
    for curve in rig_bag(action).fcurves:
        for point in curve.keyframe_points:
            point.co.x = 1 + (point.co.x - 1) * factor
            point.handle_left.x = 1 + (point.handle_left.x - 1) * factor
            point.handle_right.x = 1 + (point.handle_right.x - 1) * factor
        curve.update()


retime(bpy.data.actions['Walk'], 0.6)        # 1.0 s -> 0.6 s: ants scurry

# ── 3. Materials: flat glossy vinyl colours (linear RGB) ─────────────────────────────────────
def material(name, colour, roughness=0.3):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*colour, 1.0)
    bsdf.inputs['Roughness'].default_value = roughness
    return mat


MATERIALS = {
    'orange': material('Ant orange body', (0.560, 0.130, 0.030)),
    'red': material('Ant red-brown limbs and stripes', (0.290, 0.045, 0.025)),      # #A23B2A, Swarm's colour
    'white': material('Ant eyes', (0.950, 0.940, 0.900)),
    'black': material('Ant pupils and smile', (0.010, 0.010, 0.015), 0.15),
    'green': material('Ant leaf', (0.080, 0.330, 0.050)),
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


# Head with big eyes; antennae ride Chip's ear bones (the -X one is "L")
shape('orange', 'Head', (0, -0.010, 0.236), (0.086, 0.078, 0.072), (16, 10))
shape('black', 'Jaw', (0, -0.084, 0.202), (0.020, 0.005, 0.004), (8, 4))                          # smile
for side in (-1, 1):
    shape('white', 'Head', (side * 0.040, -0.068, 0.246), (0.029, 0.020, 0.030), (10, 6))
    shape('black', 'Head', (side * 0.040, -0.084, 0.244), (0.014, 0.008, 0.015), (8, 6))
    ear = 'Ear.L' if side < 0 else 'Ear.R'
    shape('red', ear, (side * 0.046, 0.000, 0.318), (0.004, 0.004, 0.032), (6, 4), rot=(0, side * 20, 0))
    shape('red', ear, (side * 0.058, 0.000, 0.350), (0.010, 0.010, 0.010), (8, 4))

# Two small body segments, a middle pair of arms that never moves, and the big striped back end on the tail bone
shape('orange', 'Spine', (0, 0.000, 0.144), (0.040, 0.036, 0.030), (12, 6))
shape('orange', 'Spine', (0, 0.000, 0.106), (0.036, 0.033, 0.030), (12, 6))
shape('red', 'Tail.01', (0, 0.078, 0.086), (0.056, 0.072, 0.052), (12, 8), rot=(-20, 0, 0))
shape('orange', 'Tail.01', (0, 0.058, 0.094), (0.050, 0.030, 0.050), (12, 6), rot=(-20, 0, 0))

ARM = {'shoulder': (0.064, -0.001, 0.155), 'elbow': (0.056, -0.025, 0.127), 'wrist': (0.028, -0.056, 0.126), 'tip': (0.017, -0.073, 0.126)}
for side, tag in ((-1, 'L'), (1, 'R')):
    pt = {k: Vector((side * v[0], v[1], v[2])) for k, v in ARM.items()}
    shape('red', 'Arm.' + tag, (pt['shoulder'] + pt['elbow']) / 2, (0.009, 0.009, 0.024), (6, 4))
    shape('red', 'Forearm.' + tag, (pt['elbow'] + pt['wrist']) / 2, (0.022, 0.009, 0.009), (6, 4))
    shape('red', 'Paw.' + tag, (pt['wrist'] + pt['tip']) / 2, (0.016, 0.017, 0.015), (8, 4))
    shape('red', 'Spine', (side * 0.046, -0.008, 0.108), (0.007, 0.007, 0.022), (6, 4), rot=(0, side * 35, 0))   # middle arm
    shape('red', 'Leg.' + tag, (side * 0.040, 0.002, 0.050), (0.009, 0.009, 0.036), (6, 4))
    shape('red', 'Foot.' + tag, (side * 0.041, -0.016, 0.012), (0.022, 0.032, 0.012), (8, 4))

# The leaf for Carry, on Chip's Scroll bone
shape('green', 'Scroll', (0, -0.040, 0.312), (0.120, 0.085, 0.011), (12, 6), rot=(14, 0, 0))

mesh = bpy.data.meshes.new('Ant.Mesh')
mesh.from_pydata([tuple(v) for v in verts], [], faces)
mesh.polygons.foreach_set('material_index', face_mats)
mesh.polygons.foreach_set('use_smooth', [True] * len(mesh.polygons))
for mat in MATERIALS.values():
    mesh.materials.append(mat)
mesh.update()
body = bpy.data.objects.new('Ant.Mesh', mesh)
rig.users_collection[0].objects.link(body)
body.parent = rig
groups = {}
for index, bone in enumerate(vert_bones):
    groups.setdefault(bone, body.vertex_groups.new(name=bone)).add([index], 1.0, 'REPLACE')
body.modifiers.new('Ant skeletal deformation', 'ARMATURE').object = rig

# ── 5. Carry: the fast walk with both arms up and the leaf shown ──────────────────────────────
REST = {bone.name: bone.matrix_local.to_3x3() for bone in rig.data.bones}
walk = bpy.data.actions['Walk']
carry = walk.copy()
carry.name = 'Carry'
carry.use_fake_user = True
REACH = 2.1                                   # Chip's arms are short: stretch them so the hands reach the leaf


def aim(bone, target, parent_turn=None):
    """Euler that points a bone (rest direction = its Y axis) along `target` in armature axes.
    parent_turn is the turn already applied to the parent bone."""
    rest = REST[bone]
    goal = Vector(target).normalized()
    if parent_turn is not None:
        goal = parent_turn.inverted() @ goal
    world = rest.col[1].normalized().rotation_difference(goal).to_matrix()
    return (rest.inverted() @ world @ rest).to_euler('XYZ'), world


POSE = {}
for tag, side in (('L', -1), ('R', 1)):          # Chip's rig names the -X side "L"
    POSE['Arm.' + tag], upper = aim('Arm.' + tag, (side * 0.30, 0, 1))
    POSE['Forearm.' + tag], _ = aim('Forearm.' + tag, (-side * 0.10, 0, 1), upper)
    POSE['Paw.' + tag] = Euler((0, 0, 0), 'XYZ')

for curve in rig_bag(carry).fcurves:
    path = curve.data_path
    value = None
    if 'constraints' in path:
        value = 0.0                                          # arms are posed directly
    elif path == 'pose.bones["Scroll"].scale':
        value = 1.0                                          # show the leaf
    elif path in ('pose.bones["Scroll"].location', 'pose.bones["Scroll"].rotation_euler'):
        value = 0.0                                          # ...exactly where it was modelled, over the head
    else:
        for bone, euler in POSE.items():
            if path == 'pose.bones["%s"].rotation_euler' % bone:
                value = euler[curve.array_index]
            elif path == 'pose.bones["%s"].scale' % bone and bone.startswith('Arm.'):
                value = REACH
    if value is not None:
        for point in curve.keyframe_points:
            point.co.y = point.handle_left.y = point.handle_right.y = value
        curve.update()
anim = rig.animation_data
template = next(t for t in anim.nla_tracks if t.name == 'Walk').strips[0]
track = anim.nla_tracks.new()
track.name = 'Carry'
strip = track.strips.new('Carry', 1, carry)
strip.action_slot = rig_bag(carry).slot
strip.blend_type, strip.extrapolation, strip.influence = template.blend_type, template.extrapolation, template.influence
track.mute = True
idle = bpy.data.actions['Idle']

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
