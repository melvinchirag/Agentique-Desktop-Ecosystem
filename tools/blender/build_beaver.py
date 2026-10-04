"""Build Archie (beaver) from Chip's rig. Rebuilds art/beaver/beaver.blend from scratch.

    blender -b art/chipmunk/chipmunk.blend --python tools/blender/build_beaver.py

Archie is a chibi beaver on a scaled copy of Chip's skeleton and keeps all of Chip's clips
(the final graphics plan allows Chip's clip names for Archie). Required: Idle, Walk, Talk, Happy.
The mesh is simple rounded shapes, each bound to one bone. No shape keys, no textures.
"""
import math
from pathlib import Path
import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'art' / 'beaver' / 'beaver.blend'
S = 0.6 / 0.35                      # Chip is 0.35 m tall, Archie 0.6 m (ASSETS.md)
KEEP = [a.name for a in bpy.data.actions]   # every Chip clip

# ── 1. Start from Chip's file: keep the rig and the clips above, drop everything else ─────────
rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
for obj in [o for o in bpy.data.objects if o is not rig]:
    bpy.data.objects.remove(obj, do_unlink=True)
for block in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.texts):
    for item in list(block):
        block.remove(item)
rig.name, rig.data.name = 'Beaver.Rig', 'Beaver.Skeleton'
for collection in bpy.data.collections:
    if 'Chip' in collection.name:
        collection.name = 'Archie - mesh and armature'

anim = rig.animation_data
for track in list(anim.nla_tracks):
    if track.name not in KEEP:
        anim.nla_tracks.remove(track)
for action in list(bpy.data.actions):
    if action.name not in KEEP:
        bpy.data.actions.remove(action)


def rig_bag(action):
    """The channelbag that animates the armature (the only slot Archie uses)."""
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                if bag.slot and bag.slot.target_id_type == 'OBJECT':
                    return bag
    raise ValueError(action.name + ': no armature channels')


for action in bpy.data.actions:
    for slot in list(action.slots):
        if slot.target_id_type == 'KEY':            # Chip's face shape keys; Archie has none
            action.slots.remove(slot)
        else:
            slot.name_display = 'Beaver.Rig'

# ── 2. Scale the skeleton and every location key from Chip's size to Archie's ────────────────
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
def material(name, colour, roughness=0.3):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*colour, 1.0)
    bsdf.inputs['Roughness'].default_value = roughness
    return mat


MATERIALS = {
    'brown': material('Archie chocolate coat', (0.200, 0.075, 0.050)),
    'dark': material('Archie tail and nose', (0.085, 0.030, 0.020)),
    'tan': material('Archie tan muzzle and belly', (0.560, 0.350, 0.230)),
    'pink': material('Archie cheeks', (0.800, 0.380, 0.350)),
    'black': material('Archie eyes', (0.008, 0.008, 0.010), 0.15),
    'white': material('Archie teeth and glints', (0.950, 0.930, 0.880)),
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


# Head: wide and boxy, small round ears on the top corners
shape('brown', 'Head', (0, -0.012, 0.252), (0.128, 0.095, 0.080), (32, 16), power=0.6)
for side in (-1, 1):
    ear = 'Ear.L' if side < 0 else 'Ear.R'            # Chip's rig names the -X ear "L"
    shape('brown', ear, (side * 0.100, 0.004, 0.328), (0.024, 0.016, 0.022), (12, 8))
    shape('tan', ear, (side * 0.100, -0.008, 0.328), (0.014, 0.008, 0.013), (10, 6))
    shape('black', 'Head', (side * 0.052, -0.107, 0.266), (0.016, 0.014, 0.019), (16, 8))      # eye
    shape('white', 'Head', (side * 0.052 + 0.005, -0.120, 0.273), (0.005, 0.004, 0.005), (8, 6))
    shape('pink', 'Head', (side * 0.074, -0.106, 0.232), (0.014, 0.010, 0.009), (10, 6))       # cheek
    shape('white', 'Head', (side * 0.0125, -0.112, 0.183), (0.011, 0.008, 0.017), (10, 6), power=0.5)   # front tooth
shape('tan', 'Head', (0, -0.094, 0.220), (0.072, 0.030, 0.030), (16, 8), power=0.6)              # muzzle block
shape('dark', 'Head', (0, -0.124, 0.240), (0.020, 0.012, 0.012), (12, 6))                        # nose
shape('tan', 'Jaw', (0, -0.090, 0.188), (0.040, 0.022, 0.011), (12, 6))                          # lower jaw

# Body and belly
shape('brown', 'Spine', (0, 0.000, 0.114), (0.060, 0.052, 0.064), (24, 12))
shape('tan', 'Spine', (0, -0.034, 0.112), (0.037, 0.026, 0.049), (12, 8))

# Arms follow Chip's arm bones (paws held in front), legs, big flat feet
ARM = {'shoulder': (0.064, -0.001, 0.155), 'elbow': (0.056, -0.025, 0.127), 'wrist': (0.028, -0.056, 0.126), 'tip': (0.017, -0.073, 0.126)}
for side, tag in ((-1, 'L'), (1, 'R')):
    pt = {k: Vector((side * v[0], v[1], v[2])) for k, v in ARM.items()}
    shape('brown', 'Arm.' + tag, (pt['shoulder'] + pt['elbow']) / 2, (0.021, 0.021, 0.027), (10, 6))
    shape('brown', 'Forearm.' + tag, (pt['elbow'] + pt['wrist']) / 2, (0.024, 0.024, 0.019), (10, 6))
    shape('brown', 'Paw.' + tag, (pt['wrist'] + pt['tip']) / 2, (0.019, 0.021, 0.018), (10, 6))
    shape('brown', 'Leg.' + tag, (side * 0.041, 0.002, 0.045), (0.026, 0.026, 0.034), (12, 6))
    shape('brown', 'Foot.' + tag, (side * 0.043, -0.018, 0.014), (0.032, 0.044, 0.014), (12, 6))

# Tail: one flat paddle lying behind him, with raised ridges for the cross-hatch
shape('brown', 'Tail.01', (0, 0.050, 0.040), (0.030, 0.034, 0.024), (12, 6))                 # joins the paddle to the body
shape('dark', 'Tail.01', (0, 0.118, 0.020), (0.052, 0.088, 0.010), (16, 8))
for y in (0.085, 0.120, 0.155):
    shape('brown', 'Tail.01', (0, y, 0.029), (0.040 if y != 0.155 else 0.030, 0.004, 0.003), (8, 6))

mesh = bpy.data.meshes.new('Beaver.Mesh')
mesh.from_pydata([tuple(v) for v in verts], [], faces)
mesh.polygons.foreach_set('material_index', face_mats)
mesh.polygons.foreach_set('use_smooth', [True] * len(mesh.polygons))
for mat in MATERIALS.values():
    mesh.materials.append(mat)
mesh.update()
body = bpy.data.objects.new('Beaver.Mesh', mesh)
rig.users_collection[0].objects.link(body)
body.parent = rig
groups = {}
for index, bone in enumerate(vert_bones):
    groups.setdefault(bone, body.vertex_groups.new(name=bone)).add([index], 1.0, 'REPLACE')
body.modifiers.new('Beaver skeletal deformation', 'ARMATURE').object = rig

# ── 5. Save ──────────────────────────────────────────────────────────────────────────────────
idle = bpy.data.actions['Idle']
anim.action = idle
anim.action_slot = rig_bag(idle).slot
scene = bpy.context.scene
scene.frame_start, scene.frame_end = 1, 91
scene.frame_set(1)
OUT.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT))
mesh.calc_loop_triangles()
print('BUILT', OUT, '| triangles', len(mesh.loop_triangles), '| bones', len(rig.data.bones), '| clips', sorted(a.name for a in bpy.data.actions))
