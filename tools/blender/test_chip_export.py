"""Exercise all twenty exported Chip actions after importing the actual GLB."""
import json, math, sys
from pathlib import Path
import bpy
from io_scene_gltf2.blender.imp.animation_utils import restore_animation_on_object

ROOT = Path(__file__).resolve().parents[2]
path = ROOT/'src/renderer/public/characters/chipmunk/default/model.glb'
rules = json.loads(Path(__file__).with_name('required_clips.json').read_text())['chipmunk']['clips']

def test():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30
    bpy.ops.import_scene.gltf(filepath=str(path))
    objects = list(bpy.context.scene.objects)
    rigs = [o for o in objects if o.type == 'ARMATURE']
    assert len(rigs) == 1 and len(rigs[0].data.bones) <= 60
    rig = rigs[0]
    morph_meshes = [o for o in objects if o.type == 'MESH' and o.data.shape_keys]
    assert morph_meshes
    morphs = {k.name for o in morph_meshes for k in o.data.shape_keys.key_blocks}
    assert {'MouthOpen','Blink','Smile','Worried'} <= morphs
    assert not any(o.type in ('CAMERA','LIGHT') for o in objects)
    assert set(rules) == {t.name for t in rig.animation_data.nla_tracks}
    def snap(frame):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        values = [v for b in rig.pose.bones for row in b.matrix for v in row]
        values += [k.value for o in morph_meshes for k in o.data.shape_keys.key_blocks]
        assert all(math.isfinite(v) for v in values)
        return values
    report = {}
    for name, rule in rules.items():
        for obj in objects:
            restore_animation_on_object(obj, name)
            if obj.type == 'MESH' and obj.data.shape_keys:
                restore_animation_on_object(obj.data.shape_keys, name)
        assert rig.animation_data.action is not None
        frames = round(rule['duration'] * 30)
        first, last = snap(0), snap(frames)
        if rule['loop']:
            assert max(abs(a-b) for a,b in zip(first,last)) < 2e-4, ('loop seam', name)
        quarter, middle = snap(max(1,frames//4)), snap(max(1,frames//2))
        assert max(abs(a-b) for a,b in zip(first,quarter)) > 1e-6 or max(abs(a-b) for a,b in zip(first,middle)) > 1e-6, ('static clip', name)
        report[name] = 'PASS: imported rig, morphs, motion and loop/one-shot evaluation'
    result = {'glb_reimport': report, 'asset_lab': 'Pending: renderer/Asset Lab absent from checked main revision'}
    path.with_name('playback-tests.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print('PASS: all 20 exported Chip actions evaluated in Blender')

if __name__ == '__main__':
    try: test()
    except Exception as exc:
        print('FAIL:', repr(exc), file=sys.stderr)
        sys.exit(1)
