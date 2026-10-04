# Character art: which folder is which animal

Folders are named by the animal's **id in the code**, not its name. The app needs these exact ids, so don't rename them.

| Folder | Animal | Job | Preview video |
|---|---|---|---|
| `chipmunk/` | **Chip** | Orchestrator, the one you talk to | (none; modeled by Zarin) |
| `beaver/` | **Archie** | Files | `beaver/archie-preview.mp4` |
| `wolf/` | **Warden** | Security | `wolf/warden-preview.mp4` |
| `workspace/` | **Pixel** | Google Workspace | `workspace/pixel-preview.mp4` |
| `eagle/` | **Scout** | Web research | `eagle/scout-preview.mp4` |

## What is in each folder
- `<name>.blend`: the Blender source (stored with Git LFS).
- `<name>-preview.mp4` / `.png`: a short render of the clips, for review. Rendered in Blender, not captured from the app.

## Where the rest of each character lives
| What | Path |
|---|---|
| The model the app loads | `src/renderer/public/characters/<id>/default/model.glb` |
| Exporter report | `src/renderer/public/characters/<id>/default/validation.json` |
| Tuning + clip aliases | `src/renderer/public/characters/<id>/default/character.json` (the app reads this one) and a copy one level up (where `docs/ASSETS.md` puts it) |
| Script that rebuilds the model | `tools/blender/build_<animal>.py` (wolf, beaver, pixel, eagle) |
| Voice sample | `voices/previews/<id>-<n>.mp3` |
| Sound effects | `resources/sfx/<id>/` |

## Rebuild a model
```
blender -b art/chipmunk/chipmunk.blend --python tools/blender/build_eagle.py
blender -b art/eagle/eagle.blend --python tools/blender/check_character.py -- eagle
blender -b art/eagle/eagle.blend --python tools/blender/export_character.py -- eagle
```
Warden, Archie, Pixel, and Scout are simple shapes on a scaled copy of Chip's skeleton, so they share Chip's clips and add their own (Warden: Sit, Block, Growl, Guard, Proud; Pixel: Write; Scout: Fly, Takeoff, Land).
