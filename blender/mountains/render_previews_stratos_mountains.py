"""
Stratos mountain environment — deterministic quality-control renders.

    blender --background --factory-startup \
        --python blender/mountains/render_previews_stratos_mountains.py

Renders the canonical camera states to blender/mountains/previews/. These are
*internal* validation images, not production assets — nothing on the site loads
them. They exist so the composition can be judged before the range is wired into
the web scene, and so a later change to the generator can be seen rather than
inferred from a triangle count.

Deliberately neutral: one key light, one fill, a mid-grey world and the scene's
own materials. The point is to read silhouette, framing, negative space and
layer separation. Dramatic lighting would flatter the range and hide exactly the
problems this is meant to surface, and the web renderer owns the real lighting
anyway.

The silhouette diagnostic is the important one. Every material goes pure black
against a white world with no lights, which strips colour, shading and depth
cueing and leaves only the outline — the thing the brief actually specifies
("strong ridgelines", "clear silhouettes", "deliberate negative space"). A range
that looks good lit and bad in silhouette is a range that is relying on shading
to do work the geometry should be doing.

The Meridian safe zone is drawn into every non-silhouette preview as a wire
overlay so the clearance can be seen, not just asserted by the validator.

MOBILE IS RENDERED AT ALL THREE TARGET VIEWPORTS
------------------------------------------------
430x932, 390x844 and 360x800, at every camera station plus its own silhouette
diagnostic — twelve frames rather than the two the first pass produced. Three
aspect ratios sounds like over-provisioning for a 2.6% spread, but the mobile
composition is built against the *narrowest* of them and the whole point of the
extra frames is to show that the other two inherit the clearance rather than
having been assumed to.

The mobile camera is not the desktop one with a longer lens. It has its own FOV
(matched to the web camera's 32 degrees vertical, via an explicit VERTICAL sensor
fit so portrait aspect cannot silently reinterpret it) and its own path, both
from stratos_terrain. The 46 mm guess the first pass used was 20.5 degrees
horizontal against the real camera's 14.7, so those previews were showing a
third more world than a phone ever will.
"""

import math
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stratos_terrain as st  # noqa: E402

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "source"
PREVIEWS = HERE / "previews"

def camera_at(t: float, variant: str):
    """
    Camera station at normalised journey progress `t`.

    Each variant follows its own guide — CAMERA_PATH_GUIDE on desktop,
    CAMERA_MOBILE_GUIDE on mobile — so the previews line up with the geometry
    that was actually composed against them.
    """
    return st.mobile_camera_at(t) if variant == "mobile" else st.desktop_camera_at(t)


STATIONS = [
    # slug,             t,     altitude label
    ("00000m-valley",   0.00, "0 m — valley baseline"),
    ("07000m-passage",  0.23, "7 000 m — mountain passage"),
    ("11000m-approach", 0.37, "11 000 m — cloud approach"),
]

DESKTOP_RES = (1440, 900)


def shots():
    """Every frame this script produces, as (name, variant, t, res, label)."""
    out = []
    for slug, t, label in STATIONS:
        out.append(("desktop-%s" % slug, "desktop", t, DESKTOP_RES, label))
    for w, h in st.MOBILE_VIEWPORTS:
        for slug, t, label in STATIONS:
            out.append(("mobile-%dx%d-%s" % (w, h, slug), "mobile", t, (w, h), label))
    return out


SILHOUETTES = [("desktop-silhouette", "desktop", 0.00, DESKTOP_RES)] + [
    ("mobile-%dx%d-silhouette" % (w, h), "mobile", 0.00, (w, h))
    for w, h in st.MOBILE_VIEWPORTS
]


def open_variant(variant: str) -> None:
    name = "stratos-mountains.blend" if variant == "desktop" else "stratos-mountains-mobile.blend"
    path = SOURCE / name
    if not path.exists():
        raise SystemExit("missing %s — run generate_stratos_mountains.py first" % path)
    bpy.ops.wm.open_mainfile(filepath=str(path))


def setup_render(res, samples: int = 24) -> None:
    scene = bpy.context.scene
    # Blender has renamed this enum twice (EEVEE -> EEVEE_NEXT -> EEVEE).
    # Pick whichever this build actually offers rather than pinning a name
    # that breaks on the next LTS.
    available = scene.render.bl_rna.properties["engine"].enum_items.keys()
    for candidate in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        if candidate in available:
            scene.render.engine = candidate
            break
    else:
        raise SystemExit("no EEVEE engine in this Blender: %s" % list(available))
    if hasattr(scene, "eevee"):
        scene.eevee.taa_render_samples = samples
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.view_settings.view_transform = "Standard"  # deterministic, no filmic curve


def place_camera(t: float, variant: str):
    cam_data = bpy.data.cameras.new("QC_CAM")
    if variant == "mobile":
        # Vertical sensor fit, explicitly. Blender's default AUTO fits the
        # sensor to whichever dimension is larger, which on a portrait render is
        # the height — so a lens value chosen for a landscape frame silently
        # becomes a different field of view. Pinning the fit and deriving the
        # focal length from the web camera's own vertical FOV removes the
        # ambiguity: what this renders is what the phone renders.
        cam_data.sensor_fit = "VERTICAL"
        cam_data.lens = (cam_data.sensor_height / 2.0) / st.MOBILE_TAN_V
    else:
        # 38 mm on full frame vertical-fits the valley on desktop. Left as it
        # was: it is 33.4 degrees vertical against the web camera's 32, and the
        # desktop composition is accepted at these framings.
        cam_data.lens = 38.0
    cam_data.clip_start = 1.0
    # Deep enough for the mobile floor, which reaches 9 km to close the band
    # under the horizon.
    cam_data.clip_end = 20_000.0
    cam = bpy.data.objects.new("QC_CAM", cam_data)
    bpy.context.scene.collection.objects.link(cam)

    cam.location = camera_at(t, variant)
    # Level, looking down +Y. Blender cameras look down their local -Z, so a
    # 90-degree X rotation points them at the horizon.
    cam.rotation_euler = (math.radians(90.0), 0.0, 0.0)
    bpy.context.scene.camera = cam
    return cam


def neutral_lighting() -> None:
    world = bpy.data.worlds.new("QC_WORLD")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.22, 0.25, 0.30, 1.0)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    bpy.context.scene.world = world

    key = bpy.data.lights.new("QC_KEY", type="SUN")
    key.energy = 3.2
    key.angle = math.radians(2.0)
    key_obj = bpy.data.objects.new("QC_KEY", key)
    key_obj.rotation_euler = (math.radians(58.0), 0.0, math.radians(38.0))
    bpy.context.scene.collection.objects.link(key_obj)

    fill = bpy.data.lights.new("QC_FILL", type="SUN")
    fill.energy = 0.9
    fill_obj = bpy.data.objects.new("QC_FILL", fill)
    fill_obj.rotation_euler = (math.radians(66.0), 0.0, math.radians(-125.0))
    bpy.context.scene.collection.objects.link(fill_obj)


def show_safe_zone(variant: str, t: float) -> None:
    """
    Render the guide cone as a translucent overlay rather than wire.

    Only at the valley station. The cone's apex is CAMERA_ANCHOR, so once the
    camera advances it is *inside* the volume, and a translucent solid seen from
    within is a full-frame wash — the approach preview came back as a yellow blob
    with the composition faintly behind it. At t = 0 the camera sits at the apex
    and the overlay reads as the disc it is meant to show.

    At the other stations the clearance is a number, not a picture:
    `safe_zone_clearance` in the composition report is measured at every station
    and every viewport, and it is the authority there.
    """
    if t > 0.0:
        return
    name = "MERIDIAN_SAFE_ZONE_MOBILE" if variant == "mobile" else "MERIDIAN_SAFE_ZONE"
    zone = bpy.data.objects.get(name)
    if zone is None:
        return
    zone.hide_render = False
    zone.display_type = "TEXTURED"
    mat = bpy.data.materials.new("QC_SAFE_ZONE")
    mat.use_nodes = True
    if hasattr(mat, "blend_method"):  # removed in some 5.x builds
        mat.blend_method = "BLEND"
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (1.0, 0.78, 0.12, 1.0)
    bsdf.inputs["Alpha"].default_value = 0.11
    zone.data.materials.clear()
    zone.data.materials.append(mat)


def silhouette_mode() -> None:
    """White world, black everything, no lights."""
    world = bpy.data.worlds.new("QC_SIL_WORLD")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (1.0, 1.0, 1.0, 1.0)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    bpy.context.scene.world = world

    black = bpy.data.materials.new("QC_SILHOUETTE")
    black.use_nodes = True
    bsdf = black.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    bsdf.inputs["Roughness"].default_value = 1.0

    for name in st.PRODUCTION_OBJECTS:
        obj = bpy.data.objects.get(name)
        if obj is None:
            continue
        obj.data.materials.clear()
        obj.data.materials.append(black)

    for light in [o for o in bpy.data.objects if o.type == "LIGHT"]:
        bpy.data.objects.remove(light, do_unlink=True)


def render_to(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    print("rendered %s" % path.name)


def main() -> int:
    PREVIEWS.mkdir(parents=True, exist_ok=True)

    for name, variant, t, res, label in shots():
        open_variant(variant)
        setup_render(res)
        place_camera(t, variant)
        neutral_lighting()
        show_safe_zone(variant, t)
        print("--- %s  (%s)" % (name, label))
        render_to(PREVIEWS / ("%s.png" % name))

    for name, variant, t, res in SILHOUETTES:
        open_variant(variant)
        setup_render(res, samples=32)
        place_camera(t, variant)
        silhouette_mode()
        print("--- %s  (flat silhouette diagnostic)" % name)
        render_to(PREVIEWS / ("%s.png" % name))

    return 0


if __name__ == "__main__":
    sys.exit(main())
