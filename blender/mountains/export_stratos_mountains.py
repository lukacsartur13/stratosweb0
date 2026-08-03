"""
Stratos mountain environment — GLB export.

    blender --background --factory-startup \
        --python blender/mountains/export_stratos_mountains.py -- --variant desktop

Reads the .blend that generate_stratos_mountains.py saved and writes the
production GLB into public/models/. Separate from generation so a change to
export settings — Draco on or off, say — can be measured without rebuilding the
terrain, and so both steps read the same single source of truth on disk.

WHAT IS EXCLUDED, AND WHY IT IS DONE BY SELECTION
-------------------------------------------------
The GUIDES collection must not reach production. The exporter offers
`use_visible` and `use_active_collection`, and neither is right here: hiding the
guides makes the export depend on viewport state saved in the .blend, and the
active collection depends on what was last clicked. Explicitly selecting the
manifest in stratos_terrain.PRODUCTION_OBJECTS makes the export depend on the
manifest and nothing else — if a name is added to the scene but not the
manifest, it silently does not ship, and the validator's node-name check is what
catches that.

Cameras, lights and animations are all off. The web renderer owns lighting,
atmosphere and every altitude-driven move; a light baked into the GLB would
fight it, and the brief is explicit that Blender is the authority on form while
the web is the authority on light.
"""

import argparse
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stratos_terrain as st  # noqa: E402

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
SOURCE_DIR = HERE / "source"
MODELS_DIR = REPO / "public" / "models"

VARIANTS = {
    "desktop": ("stratos-mountains.blend", "stratos-mountains-desktop.glb"),
    "mobile": ("stratos-mountains-mobile.blend", "stratos-mountains-mobile.glb"),
}


def draco_available() -> bool:
    """
    Whether this Blender ships the Draco encoder.

    Detected by locating the encoder bridge library inside the glTF add-on,
    not by importing a named module. An earlier version of this function
    imported `io_scene_gltf2.io.com.gltf2_io_draco_compression_extension`,
    which is where that module lived up to Blender 4.x — in 5.2 it has moved to
    `io.exp.draco` and the import raised, so the probe reported False on a
    Blender that compresses perfectly well. Globbing for the shared library is
    version-independent: the add-on cannot compress without it, and its presence
    is the actual precondition.
    """
    try:
        import io_scene_gltf2
        addon = Path(io_scene_gltf2.__file__).parent
        if any(addon.glob("*draco*")):
            return True
    except Exception:
        pass
    try:
        return any((Path(bpy.app.binary_path).parent.parent / "Resources").rglob("*draco*"))
    except Exception:
        return False


def select_production() -> int:
    """Select exactly the manifest. Returns how many objects were found."""
    bpy.ops.object.select_all(action="DESELECT")
    found = 0
    for name in st.PRODUCTION_OBJECTS:
        obj = bpy.data.objects.get(name)
        if obj is None:
            continue  # mobile drops MID_*_02 by design
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        found += 1
    return found


def main() -> int:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(prog="export_stratos_mountains")
    ap.add_argument("--variant", choices=tuple(VARIANTS), default="desktop")
    ap.add_argument("--draco", action="store_true",
                    help="Enable Draco mesh compression. Requires the web loader "
                         "to carry a DRACOLoader decoder — see README.md.")
    args = ap.parse_args(argv)

    blend_name, glb_name = VARIANTS[args.variant]
    blend = SOURCE_DIR / blend_name
    if not blend.exists():
        print("FAILED: %s missing — run generate_stratos_mountains.py first" % blend)
        return 1

    bpy.ops.wm.open_mainfile(filepath=str(blend))

    has_draco = draco_available()
    print("draco encoder available: %s" % has_draco)
    if args.draco and not has_draco:
        print("FAILED: --draco requested but this Blender has no encoder")
        return 1

    found = select_production()
    print("selected %d/%d production objects" % (found, len(st.PRODUCTION_OBJECTS)))
    if found == 0:
        print("FAILED: nothing to export")
        return 1

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    out = MODELS_DIR / glb_name

    kwargs = dict(
        filepath=str(out),
        export_format="GLB",
        use_selection=True,
        export_apply=True,          # modifiers and transforms resolved at export
        export_yup=True,            # Blender Z-up -> glTF/Three.js Y-up
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_extras=False,        # no Blender custom properties in production
        export_normals=True,
        export_texcoords=False,     # no textures, so UVs are dead weight
        export_tangents=False,
        export_vertex_color="MATERIAL",
    )
    if args.draco:
        kwargs.update(
            export_draco_mesh_compression_enable=True,
            export_draco_mesh_compression_level=6,
            export_draco_position_quantization=14,
            export_draco_normal_quantization=10,
            export_draco_color_quantization=8,
        )

    bpy.ops.export_scene.gltf(**kwargs)

    size = out.stat().st_size
    print("wrote %s  (%.2f MB, %d bytes)%s"
          % (out, size / 1_048_576, size, "  [draco]" if args.draco else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
