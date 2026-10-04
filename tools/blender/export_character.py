"""Validate, export to a temporary GLB, then replace the runtime file on success."""
import importlib.util, json, os, struct, sys, tempfile
from pathlib import Path
import bpy

path = Path(__file__).with_name('check_character.py')
spec = importlib.util.spec_from_file_location('character_check', path)
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)

def export(animal):
    report = check.validate(animal)
    rig, meshes = check.assets()
    bpy.ops.object.select_all(action='DESELECT')
    for obj in [rig, *meshes]: obj.select_set(True)
    bpy.context.view_layer.objects.active = rig
    dest = check.ROOT/'src/renderer/public/characters'/animal/'default/model.glb'
    dest.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(suffix='.glb', dir=dest.parent)
    os.close(handle)
    try:
        # ACTIONS + ACTION merging preserves matching armature and shape-key slots.
        result = bpy.ops.export_scene.gltf(filepath=temporary, export_format='GLB',
            use_selection=True, export_yup=True, export_animations=True,
            export_animation_mode='ACTIONS', export_merge_animation='ACTION',
            export_force_sampling=True, export_anim_slide_to_zero=True,
            export_morph=True, export_skins=True, export_all_influences=False)
        if result != {'FINISHED'}: raise ValueError('Blender export did not finish')
        raw = Path(temporary).read_bytes()
        if len(raw) > 5_000_000: raise ValueError('Export exceeds 5 MB')
        magic, version, length = struct.unpack_from('<4sII', raw)
        if (magic,version,length) != (b'glTF',2,len(raw)): raise ValueError('Invalid GLB header')
        json_length, chunk_type = struct.unpack_from('<II', raw, 12)
        if chunk_type != 0x4e4f534a: raise ValueError('Missing GLB JSON chunk')
        doc = json.loads(raw[20:20+json_length])
        exported = [a['name'] for a in doc.get('animations', [])]
        missing = set(report['clips']) - set(exported)
        if missing or len(exported) != len(set(exported)):
            raise ValueError('Missing or duplicate exported action names: ' + str(sorted(missing)))
        if doc.get('cameras') or any('KHR_lights_punctual' in n.get('extensions', {}) for n in doc.get('nodes', [])):
            raise ValueError('Unexpected camera/light in export')
        if any(len(s['joints']) > 60 for s in doc.get('skins', [])):
            raise ValueError('Exported skin exceeds bone budget')
        for action in doc.get('animations', []):
            if report['morphs'] and not any(c['target']['path'] == 'weights' for c in action['channels']):
                raise ValueError(action['name'] + ': missing facial animation channel')
        os.replace(temporary, dest)
        report.update(glb_bytes=len(raw), exported_clips=exported)
        report_path = dest.with_name('validation.json')
        report_path.write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
        print('PASS: exported', dest, len(raw), 'bytes')
    finally:
        if Path(temporary).exists(): Path(temporary).unlink()

if __name__ == '__main__':
    try: export(check.character_id())
    except Exception as exc:
        print('FAIL:', exc, file=sys.stderr)
        sys.exit(1)
