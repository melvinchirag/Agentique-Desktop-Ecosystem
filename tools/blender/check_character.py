"""Read-only source validation. blender -b source.blend --python THIS -- chipmunk"""
import json, math, sys
from pathlib import Path
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
SPEC = json.loads(Path(__file__).with_name('required_clips.json').read_text())

def character_id():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if len(args) != 1 or args[0] not in SPEC:
        raise ValueError('Expected one animal ID: ' + ', '.join(SPEC))
    return args[0]

def assets():
    rigs = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
    if len(rigs) != 1:
        raise ValueError('Expected exactly one character armature')
    rig = rigs[0]
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH' and
              (o.parent == rig or any(m.type == 'ARMATURE' and m.object == rig for m in o.modifiers))]
    if not meshes:
        raise ValueError('No character meshes attached to rig')
    return rig, meshes

def activate(action, targets):
    for target in targets:
        ad = target.animation_data_create()
        for track in ad.nla_tracks:
            track.mute = True
        ad.action = None
        slots = [s for s in action.slots if s.target_id_type == target.id_type]
        if slots:
            ad.action = action
            ad.action_slot = slots[0]

def snapshot(rig, meshes, frame):
    integer_frame = math.floor(frame)
    bpy.context.scene.frame_set(integer_frame, subframe=frame-integer_frame)
    bpy.context.view_layer.update()
    values = [v for bone in rig.pose.bones for row in bone.matrix for v in row]
    values += [k.value for o in meshes if o.data.shape_keys for k in o.data.shape_keys.key_blocks]
    if not all(math.isfinite(v) for v in values):
        raise ValueError('Non-finite animated transform or morph')
    return values

def validate(animal):
    spec = SPEC[animal]
    errors = []
    def check(ok, message):
        if not ok: errors.append(message)
    rig, meshes = assets()
    scene = bpy.context.scene
    check(abs(scene.render.fps / scene.render.fps_base - 30) < 1e-6, 'FPS must be 30')
    check(len(rig.data.bones) <= 60, 'Bone budget exceeds 60')
    triangles = 0
    for obj in meshes:
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
        bone_groups = {g.index for g in obj.vertex_groups if g.name in rig.data.bones}
        check(all(sum(g.group in bone_groups and g.weight > 1e-6 for g in v.groups) <= 4
                  for v in obj.data.vertices), obj.name + ': more than four bone influences')
    check(triangles <= 15000, 'Triangle budget exceeds 15000')
    for obj in [rig, *meshes]:
        check(max(abs(v - 1) for v in obj.scale) < 1e-5, obj.name + ': unapplied scale')
        check(max(abs(v) for v in obj.rotation_euler) < 1e-5, obj.name + ': unapplied rotation')
    check(rig.location.length < 1e-4, 'Rig origin must be at world zero')
    for image in bpy.data.images:
        check(max(image.size) <= 1024, image.name + ': image exceeds 1024 pixels')
    for mat in {m for o in meshes for m in o.data.materials if m}:
        check(mat.use_nodes and any(n.type == 'BSDF_PRINCIPLED' for n in mat.node_tree.nodes),
              mat.name + ': expected Principled BSDF')
        if mat.use_nodes:
            check(not any(n.type.startswith('TEX_') and n.type != 'TEX_IMAGE'
                          for n in mat.node_tree.nodes), mat.name + ': procedural texture')
    targets = [rig] + [o.data.shape_keys for o in meshes if o.data.shape_keys]
    clips = {}
    for name, rule in spec['clips'].items():
        action = bpy.data.actions.get(name)
        check(action is not None, 'Missing action: ' + name)
        if action is None: continue
        check(action.use_fake_user, name + ': enable Fake User')
        activate(action, targets)
        start, end = action.frame_range
        first = snapshot(rig, meshes, start)
        last = snapshot(rig, meshes, end)
        if rule['loop']:
            check(max(abs(a-b) for a,b in zip(first,last)) < 2e-4, name + ': loop seam')
        for frame in (start, start+(end-start)/4, start+(end-start)/2, end):
            snapshot(rig, meshes, frame)
        duration = (end-start)/30
        if 'duration' in rule:
            check(abs(duration-rule['duration']) < 1/30, name + ': incorrect duration')
        clips[name] = {'loop': rule['loop'], 'duration': duration}
    idle = bpy.data.actions.get('Idle')
    if idle:
        activate(idle, targets); snapshot(rig, meshes, idle.frame_range[0])
        depsgraph = bpy.context.evaluated_depsgraph_get()
        points = [o.matrix_world @ Vector(corner) for obj in meshes
                  for o in [obj.evaluated_get(depsgraph)] for corner in o.bound_box]
        height = max(p.z for p in points) - min(p.z for p in points)
        ground = min(p.z for p in points)
        check(abs(ground) < .01, 'Ground contact differs from zero by more than 1 cm')
        if spec['height']:
            check(abs(height-spec['height']) <= spec['height']*.1, 'Height outside 10% target tolerance')
    else: height = None
    morphs = sorted({k.name for o in meshes if o.data.shape_keys for k in o.data.shape_keys.key_blocks if k.name != 'Basis'})
    report = {'animal': animal, 'triangles': triangles, 'bones': len(rig.data.bones),
              'height': height, 'clips': clips, 'morphs': morphs, 'errors': errors,
              'manual_checks': ['Facing -Y', 'Visual quality of every clip', 'Playback in ADE Asset Lab']}
    print(json.dumps(report, indent=2))
    if errors: raise ValueError('Character validation failed: ' + '; '.join(errors))
    print('PASS: source checks; source file was not saved or modified')
    return report

if __name__ == '__main__':
    try: validate(character_id())
    except Exception as exc:
        print('FAIL:', exc, file=sys.stderr)
        sys.exit(1)
