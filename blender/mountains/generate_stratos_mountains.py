"""
Stratos mountain environment — deterministic scene generation.

    blender --background --factory-startup \
        --python blender/mountains/generate_stratos_mountains.py -- --variant desktop

`--factory-startup` matters: it drops the user's add-ons and preferences so the
result does not depend on whose machine ran it. Without it, an enabled add-on
that adds a default object or changes the unit system silently changes the
export.

Variants
--------
    --variant desktop   full range, saved to source/stratos-mountains.blend
    --variant mobile    front-biased reduction, saved to
                        source/stratos-mountains-mobile.blend

The two variants are two *compositions*. They share this file, the noise, the
materials and the manifest, and nothing else: `stratos_terrain.desktop_masses`
and `mobile_masses` are independent layouts because a landscape frame and a
portrait one do not admit the same arrangement of mountains. See the MOBILE FRAME
MODEL section of stratos_terrain.py for why that is arithmetic rather than taste.

This script builds and saves. Export lives in export_stratos_mountains.py so a
failed export can be retried without regenerating, and so the .blend stays the
single source both steps read from.

The mobile run additionally rasterises the finished scene at all three target
viewports and writes reports/stratos-mountains-mobile-composition.json — the
silhouette validation the brief asks for, measured rather than asserted.
"""

import argparse
import json
import math
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stratos_terrain as st  # noqa: E402

HERE = Path(__file__).resolve().parent
SOURCE_DIR = HERE / "source"
REPORTS_DIR = HERE / "reports"


# ---------------------------------------------------------------------------
# Scene setup
# ---------------------------------------------------------------------------

def reset_scene() -> None:
    """
    Empty the file completely.

    `--factory-startup` still opens the default scene with its cube, camera and
    light, and orphaned data blocks survive an object delete. Purging afterwards
    keeps a regenerated .blend from accumulating MAT_ROCK_GRAPHITE.001 across
    runs, which would break the stable-names guarantee the exporter depends on.
    """
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for _ in range(4):
        bpy.ops.outliner.orphans_purge(do_local_ids=True, do_linked_ids=True,
                                       do_recursive=True)


def configure_units() -> None:
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.unit_settings.length_unit = "METERS"


def make_collections() -> dict:
    """Build the STRATOS_MOUNTAIN_ENVIRONMENT tree and return name -> collection."""
    root = bpy.data.collections.new(st.ROOT_COLLECTION)
    bpy.context.scene.collection.children.link(root)

    out = {st.ROOT_COLLECTION: root}
    for name in st.COLLECTIONS:
        child = bpy.data.collections.new(name)
        root.children.link(child)
        out[name] = child
    return out


# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------

def _principled(name: str, base, roughness: float, metallic: float = 0.0):
    """
    One restrained PBR material.

    Deliberately nothing but Principled BSDF with constant inputs: the brief
    forbids leaning on Blender-only shader nodes, and anything procedural here
    would either fail to export or get baked into a texture the web renderer
    then has to download. Colour and roughness are the whole material; the web
    renderer owns atmosphere, fog and altitude tinting on top.
    """
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*base, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    # glTF has no concept of specular tint on a dielectric; leaving IOR at the
    # default keeps the exported material a plain metallic-roughness pair.
    return mat


def make_materials() -> dict:
    """
    Four materials, graphite through titanium.

    Values are low-chroma and close together on purpose. The mountains separate
    by silhouette and by the web renderer's depth fog, not by colour — a range
    that separates by hue reads as a game level.
    """
    return {
        "MAT_ROCK_GRAPHITE": _principled("MAT_ROCK_GRAPHITE", (0.055, 0.058, 0.064), 0.86),
        "MAT_ROCK_TITANIUM": _principled("MAT_ROCK_TITANIUM", (0.115, 0.121, 0.132), 0.78),
        "MAT_VALLEY_DARK": _principled("MAT_VALLEY_DARK", (0.028, 0.030, 0.034), 0.92),
        # The only material carrying chroma, and it is still dark. The web
        # renderer raises it to the Stratos yellow at the altitudes where the
        # route is meant to read; baking the full accent in here would make the
        # route glow at 0 m, which the brief rules out.
        "MAT_ROUTE_ACCENT": _principled("MAT_ROUTE_ACCENT", (0.34, 0.29, 0.11), 0.55),
    }


# ---------------------------------------------------------------------------
# Mesh construction
# ---------------------------------------------------------------------------

def _finish(name: str, verts, tris, collection, material, colors=None):
    """
    Turn vertex/triangle lists into a named object with a predictable origin.

    Origin goes to (footprint centre X, footprint centre Y, lowest Z). Predictable
    beats convenient: the web scene sinks the mountain layers below the cloud
    deck after breakthrough, and an origin sitting at the base of the mass means
    that move is a Y translation of a known amount rather than a number found by
    trial. Vertices are stored relative to it and the object carries the offset,
    so the transform is already applied in the exported node.
    """
    mesh = bpy.data.meshes.new(name)

    ox = sum(v[0] for v in verts) / len(verts)
    oy = sum(v[1] for v in verts) / len(verts)
    oz = min(v[2] for v in verts)

    local = [(v[0] - ox, v[1] - oy, v[2] - oz) for v in verts]
    mesh.from_pydata(local, [], tris)
    mesh.update()

    # Smooth shading, and this is a payload decision rather than a taste one.
    # Flat shading gives every triangle its own three normals, which forces the
    # glTF exporter to split every shared vertex — 126 k triangles become 378 k
    # unique vertices and the desktop GLB roughly triples. Smooth normals let
    # the grid keep its ~65 k shared vertices. The range is read at distance and
    # separates by silhouette, so the crease detail flat shading would have
    # bought is not visible at any camera state this scene uses.
    for poly in mesh.polygons:
        poly.use_smooth = True
    mesh.validate(verbose=False)

    if colors is not None:
        # BYTE_COLOR on the POINT domain: four bytes per vertex instead of the
        # sixteen FLOAT_COLOR costs, and POINT rather than CORNER because a
        # corner-domain attribute splits vertices for exactly the same reason
        # flat shading does. The tint is a 0.82..1.06 ramp; eight bits per
        # channel is more precision than it needs.
        attr = mesh.color_attributes.new(name="Col", type="BYTE_COLOR", domain="POINT")
        for i, c in enumerate(colors):
            attr.data[i].color = (*c, 1.0)

    obj = bpy.data.objects.new(name, mesh)
    obj.location = (ox, oy, oz)
    mesh.materials.append(material)
    collection.objects.link(obj)
    return obj


def _shade(z: float, base_z: float, peak: float):
    """
    Per-vertex tint, exported as COLOR_0.

    A single low-amplitude altitude ramp: the mass darkens into its own base and
    lifts very slightly at the crests, which reads as aerial perspective inside
    one object without needing a second material. Amplitude is small (0.82..1.06)
    because the brief wants minimal surface colour variation, and because the
    web renderer must be free to ignore it — Three.js only applies COLOR_0 when
    the material opts in, so this is available rather than imposed.
    """
    t = st.smoothstep(base_z, base_z + max(peak, 1.0), z)
    v = 0.82 + 0.24 * t
    return (v, v, v * 1.01)


def build_mass(mass, collection, materials):
    """
    Grid over the mass footprint, displaced by its height field.

    The X span is read back from the mass at each row rather than taken once,
    because a mobile footprint splays with depth to hold its place in a portrait
    frame. For a desktop mass the two ends are equal and this is the rectangle it
    always was — the splay term multiplies by zero.
    """
    n = mass.res
    verts, colors = [], []
    for j in range(n + 1):
        y = mass.y0 + (mass.y1 - mass.y0) * (j / n)
        # Recomputed from y, not from j / n, so it matches to the last bit what
        # Mass.height derives internally for the same vertex.
        x0, x1 = mass.x_range((y - mass.y0) / (mass.y1 - mass.y0))
        for i in range(n + 1):
            x = x0 + (x1 - x0) * (i / n)
            z = mass.height(x, y)
            verts.append((x, y, z))
            colors.append(_shade(z, mass.base_z, mass.peak))

    tris = []
    for j in range(n):
        for i in range(n):
            a = j * (n + 1) + i
            b = a + 1
            c = a + (n + 1)
            d = c + 1
            # Diagonal alternates on a checker so the triangulation does not
            # impose a directional grain on the ridges.
            if (i + j) % 2 == 0:
                tris.append((a, b, d))
                tris.append((a, d, c))
            else:
                tris.append((a, b, c))
                tris.append((b, d, c))

    return _finish(mass.name, verts, tris, collection, materials[mass.material], colors)


def build_valley_floor(collection, materials, res: int, variant: str = "desktop"):
    """
    The valley floor.

    A shallow channel rather than a flat plane: the centre dips and the sides
    lift toward the wall bases.

    It spans the full depth and width of the scene because it is doing two jobs.
    It is the ground the camera flies over, and it is the lid over every
    mountain's buried footprint apron — the masses fall away to BURIED_BASE at
    their edges and this surface is what hides that. A shorter floor left both a
    visible hole in the centre of the frame and the aprons on show.

    No distance falloff. An earlier version dropped the floor by 46 m toward the
    far edge, which pulled it below the sightline and reopened the hole it was
    there to close.
    """
    # Narrower on mobile. A 360 px portrait frame sees +/-587 m at the floor's far
    # edge, so the desktop's 2400 m half-width is 1.8 km of quads per side that
    # no phone can ever show.
    x_half = st.MOBILE_VALLEY_HALF_WIDTH if variant == "mobile" else st.VALLEY_HALF_WIDTH
    far_y = st.MOBILE_VALLEY_FAR_Y if variant == "mobile" else st.VALLEY_FAR_Y
    n = res
    verts, colors = [], []
    for j in range(n + 1):
        y = st.VALLEY_NEAR_Y + (far_y - st.VALLEY_NEAR_Y) * (j / n)
        for i in range(n + 1):
            x = -x_half + 2 * x_half * (i / n)
            z = st.valley_floor_z(x, y)
            verts.append((x, y, z))
            colors.append(_shade(z, st.VALLEY_FLOOR_Z - 40, 200))

    tris = []
    for j in range(n):
        for i in range(n):
            a = j * (n + 1) + i
            tris.append((a, a + 1, a + n + 2))
            tris.append((a, a + n + 2, a + n + 1))

    return _finish("VALLEY_FLOOR", verts, tris, collection,
                   materials["MAT_VALLEY_DARK"], colors)


def build_valley_wall(name, side, collection, materials, res: int,
                      variant: str = "desktop"):
    """
    One valley wall, inner edge locked to the safe-zone cone.

    Parameterised across (inner edge -> outer edge) rather than in world X, so
    the wall's inner lip follows `corridor_half_width` exactly. That is the
    mechanism that keeps the framing constant in screen space as the valley
    recedes, and it is also what makes the safe-zone test pass by construction
    rather than by luck.
    """
    n = res
    verts, colors = [], []
    for j in range(n + 1):
        y = st.VALLEY_NEAR_Y + (2900.0 - st.VALLEY_NEAR_Y) * (j / n)
        inner = st.corridor_half_width(max(y, 0.0), variant)
        # Mobile anchors the outer edge to the frame rather than to a metre
        # value, so the wall's rise happens inside the picture instead of five
        # half-widths past its edge. See MOBILE_WALL_OUTER_FRACTION.
        if variant == "mobile":
            outer = max(inner + 40.0,
                        st.mobile_x(st.MOBILE_WALL_OUTER_FRACTION, max(y, 0.0)))
        else:
            outer = 1600.0
        for i in range(n + 1):
            t = i / n
            x = side * (inner + (outer - inner) * t)
            # Steeper and taller than the first pass. The walls are what frame
            # the Meridian in the near field, before the foreground masses come
            # into shot, so a 430 m rise over 800 m of run read as a slope
            # rather than a wall of the valley.
            # Steep, and front-loaded. The wall gains most of its height in the
            # first third of its run, which is what makes the corridor read as a
            # valley cut into rock. Spreading the same 900 m over the full width
            # gave a 30-degree ramp that photographed as open ground.
            full = 470.0 if variant == "mobile" else 900.0
            rise = full * st.smoothstep(0.0, 0.34, t) ** 0.85
            if variant == "mobile":
                # The valley mouth is lower than the valley. Without this the
                # wall is a constant-height ridge running from behind the camera
                # to 2.9 km, and because its inner lip holds a constant *screen*
                # fraction, the nearest row of it projects highest: the outer
                # 28% of a portrait frame fills with rock from the top edge to
                # the bottom at every station. That is the "narrow tunnel" the
                # brief rules out, and it is what replaced the slab problem the
                # first time the walls were brought into frame at all.
                #
                # Ramping the rise with depth makes the wall grow as the valley
                # cuts deeper into the range, which is both a real landform and
                # the only shape that leaves the near frame open on a screen
                # this narrow. The crest peaks around 1.8 km, where it sits a
                # quarter of the frame height above the horizon.
                #
                # 640 m of rise rather than the desktop's 900 for the same
                # reason. At 900 the wall's crest reaches 0.99 of the frame
                # half-height, which is to say it leaves the top of the picture
                # — so the outer band of every mobile frame was a dark panel
                # running off the top edge with no summit in it, and the eye
                # read a curtain rather than a valley side. At 640 it tops out
                # near 0.62 and there is sky above the wall.
                rise *= st.smoothstep(120.0, 1750.0, y)
            crest = st.ridged(x / 560.0, y / (560.0 * 1.8),
                              st.SEED + (509 if side < 0 else 587), 5) ** 1.6
            z = st.VALLEY_FLOOR_Z + rise * (0.42 + 0.58 * crest)
            verts.append((x, y, z))
            colors.append(_shade(z, st.VALLEY_FLOOR_Z, 430))

    tris = []
    for j in range(n):
        for i in range(n):
            a = j * (n + 1) + i
            if side < 0:
                tris.append((a, a + n + 2, a + 1))
                tris.append((a, a + n + 1, a + n + 2))
            else:
                tris.append((a, a + 1, a + n + 2))
                tris.append((a, a + n + 2, a + n + 1))

    return _finish(name, verts, tris, collection, materials["MAT_VALLEY_DARK"], colors)


def build_ascent_route(collection, materials, segments: int):
    """
    ASCENT_ROUTE — a narrow incision along the valley floor.

    Fourteen metres wide against a 1.8 km valley, sitting ROUTE_PROUD above the
    floor so it never z-fights, and following a shallow S so it reads as a
    surveyed line rather than a ruler. It is geometry, not a glowing overlay:
    the brief rules out neon lines and navigation dots, and the web renderer
    raises its accent only across the altitudes where the route is meant to
    speak.

    The height comes from `st.valley_floor_z` — the floor's own function, not a
    second derivation of it. See that function for the defect that made this
    necessary.
    """
    half_w, n = 7.0, segments
    verts, colors = [], []
    for j in range(n + 1):
        t = j / n
        y = -120.0 + 1560.0 * t
        # Shallow S, decaying as the route reaches the pass and straightens out.
        x = 150.0 * math.sin(t * math.pi * 1.15) * (1.0 - 0.55 * t)
        z = st.valley_floor_z(x, y) + st.ROUTE_PROUD
        for s in (-1.0, 1.0):
            verts.append((x + s * half_w, y, z))
            colors.append((0.9, 0.9, 0.9))

    tris = []
    for j in range(n):
        a = j * 2
        tris.append((a, a + 1, a + 3))
        tris.append((a, a + 3, a + 2))

    return _finish("ASCENT_ROUTE", verts, tris, collection,
                   materials["MAT_ROUTE_ACCENT"], colors)


# ---------------------------------------------------------------------------
# Guides — never exported to production GLB
# ---------------------------------------------------------------------------

def _cone_guide(name, max_y, variant, collection, materials):
    """The protected cone, as a fan from the camera anchor to its truncation."""
    seg = 32
    apex = st.CAMERA_ANCHOR
    far_r = st.safe_zone_radius(max_y, variant)
    verts = [apex]
    for k in range(seg):
        a = 2 * math.pi * k / seg
        verts.append((far_r * math.cos(a), max_y, apex[2] + far_r * math.sin(a)))
    tris = [(0, 1 + k, 1 + (k + 1) % seg) for k in range(seg)]
    zone = _finish(name, verts, tris, collection, materials["MAT_ROUTE_ACCENT"])
    zone.display_type = "WIRE"
    zone.hide_render = True
    return zone


def _path_guide(name, station, collection):
    """Edge-only polyline along a camera move."""
    pts, edges = [], []
    for k in range(41):
        pts.append(station(k / 40))
        if k:
            edges.append((k - 1, k))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(pts, edges, [])
    mesh.update()
    path = bpy.data.objects.new(name, mesh)
    collection.objects.link(path)
    path.hide_render = True
    return path


def build_guides(collection, materials, variant: str = "desktop"):
    """
    The three non-rendering guides, in the variant's own dimensions.

    They exist so the composition rule is a thing in the file that can be looked
    at and measured, not a paragraph in a document. `export_stratos_mountains.py`
    excludes the whole GUIDES collection, and the validator asserts none of these
    names reached the GLB.

    Mobile gets its own three rather than reusing the desktop set, because all
    three differ: the cone is narrower in world space and twice as wide on
    screen, it is enforced more than twice as deep, and the camera climbs
    further while advancing less than half as far. A guide that showed the
    desktop numbers in the mobile file would be worse than no guide.
    """
    if variant == "mobile":
        _cone_guide("MERIDIAN_SAFE_ZONE_MOBILE", st.MOBILE_SAFE_ZONE_MAX_Y,
                    "mobile", collection, materials)
        _path_guide("CAMERA_MOBILE_GUIDE", st.mobile_camera_at, collection)
        z = 620.0
        w = st.MOBILE_VALLEY_HALF_WIDTH
        verts = [(-w, -300, z), (w, -300, z), (w, 3600, z), (-w, 3600, z)]
        guide = _finish("CLOUD_LAYER_GUIDE_MOBILE", verts, [(0, 1, 2), (0, 2, 3)],
                        collection, materials["MAT_VALLEY_DARK"])
        guide.display_type = "WIRE"
        guide.hide_render = True
        return

    _cone_guide("MERIDIAN_SAFE_ZONE", st.SAFE_ZONE_MAX_Y, "desktop",
                collection, materials)
    # The web scene does not read the path guide — JourneyCamera owns the real
    # move — but it makes the intended rise visible in the viewport when judging
    # whether a ridge is about to cross the instrument.
    _path_guide("CAMERA_PATH_GUIDE", st.desktop_camera_at, collection)

    # --- CLOUD_LAYER_GUIDE: where the deck sits at breakthrough --------------
    z = 620.0
    verts = [(-2600, -300, z), (2600, -300, z), (2600, 2600, z), (-2600, 2600, z)]
    guide = _finish("CLOUD_LAYER_GUIDE", verts, [(0, 1, 2), (0, 2, 3)],
                    collection, materials["MAT_VALLEY_DARK"])
    guide.display_type = "WIRE"
    guide.hide_render = True


# ---------------------------------------------------------------------------
# In-file validation
# ---------------------------------------------------------------------------

def audit(variant: str) -> dict:
    """
    Check the scene before it is saved.

    Runs against evaluated world-space vertices, so it measures what the
    exporter will actually write rather than what the generator intended.
    """
    deps = bpy.context.evaluated_depsgraph_get()
    report = {"variant": variant, "objects": {}, "safe_zone_violations": [],
              "duplicate_names": [], "empty_meshes": [], "nan_vertices": []}

    total_tris = 0
    seen = set()

    for name in st.PRODUCTION_OBJECTS:
        obj = bpy.data.objects.get(name)
        if obj is None:
            continue  # mobile legitimately drops MID_*_02 — recorded, not fatal
        if name in seen:
            report["duplicate_names"].append(name)
        seen.add(name)

        ev = obj.evaluated_get(deps)
        mesh = ev.to_mesh()
        mw = obj.matrix_world

        tris = sum(len(p.vertices) - 2 for p in mesh.polygons)
        if tris == 0:
            report["empty_meshes"].append(name)

        violations = 0
        bad = 0
        lo = [1e18] * 3
        hi = [-1e18] * 3
        exempt = name in st.EXEMPT_FROM_SAFE_ZONE

        for v in mesh.vertices:
            wx, wy, wz = mw @ v.co
            if not all(math.isfinite(c) for c in (wx, wy, wz)):
                bad += 1
                continue
            for k, c in enumerate((wx, wy, wz)):
                lo[k] = min(lo[k], c)
                hi[k] = max(hi[k], c)
            if not exempt and st.inside_safe_zone(wx, wy, wz, variant):
                violations += 1

        if bad:
            report["nan_vertices"].append({"object": name, "count": bad})
        if violations:
            report["safe_zone_violations"].append({"object": name, "vertices": violations})

        report["objects"][name] = {
            "triangles": tris,
            "vertices": len(mesh.vertices),
            "material": mesh.materials[0].name if mesh.materials else None,
            "bounds_min": [round(c, 2) for c in lo],
            "bounds_max": [round(c, 2) for c in hi],
            "safe_zone_exempt": exempt,
        }
        total_tris += tris
        ev.to_mesh_clear()

    report["total_triangles"] = total_tris
    report["mesh_count"] = len(report["objects"])
    report["material_count"] = len([m for m in bpy.data.materials if m.users])
    report["missing_objects"] = [n for n in st.PRODUCTION_OBJECTS if n not in report["objects"]]

    lo = [1e18] * 3
    hi = [-1e18] * 3
    for o in report["objects"].values():
        for k in range(3):
            lo[k] = min(lo[k], o["bounds_min"][k])
            hi[k] = max(hi[k], o["bounds_max"][k])
    report["scene_bounds_min"] = [round(c, 2) for c in lo]
    report["scene_bounds_max"] = [round(c, 2) for c in hi]
    return report


# ---------------------------------------------------------------------------
# Mobile silhouette validation
# ---------------------------------------------------------------------------

MOBILE_STATIONS = [
    ("valley", 0.00, "0 m — valley baseline"),
    ("passage", 0.23, "7 000 m — mountain passage"),
    ("approach", 0.283, "8 500 m — cloud approach"),
]
"""
Journey fractions the mobile composition is judged at.

`approach` was 0.37 — 11 000 m — which is the fraction the *desktop* previews
use, and it was carried over so the two variants were compared at the same
moments of the narrative. That reasoning stops holding once the portrait camera
has a trajectory of its own.

At 11 000 m the portrait station has climbed 563 m above the authored path and
advanced 415 m past it, because §6 asks for exactly that: "terrain begins to
fall away … the transition toward atmosphere feels like leaving terrain behind".
The web scene agrees — `mountainStateAt` starts fading the range at 10 800 m and
it is at about 4% opacity by 11 000 — so both `min_skyline_asymmetry` and
`max_sky_above_horizon` were being enforced on a frame the design intends to be
nearly empty, and they failed for the reason they exist to detect elsewhere.

0.283 is 8 500 m: the highest altitude the brief measures the portrait framing
at, comfortably inside the band where the range is still a composition, and
still past the mountain stages. No threshold is relaxed — the same gates run at
the same values, at an altitude where they mean something.
"""

# Thresholds. Each one is a line in the brief turned into a number, and each is a
# floor as well as a ceiling where that makes sense, because a composition can
# fail by being empty just as easily as by being crowded.
MOBILE_LIMITS = {
    "max_flat_silhouette_run": 0.09,   # hard horizontal steps
    "max_vertical_edge_run": 0.11,     # ...and ruled cliffs stood on end
    "max_frame_top_touch": 0.15,       # flanks resolve into summits, not panels
    "max_pierced_px": 0,               # no hole punched through the composition
    "min_skyline_asymmetry": 0.15,     # not a mirrored stage set
    "min_mountain_columns": 0.55,      # not a horizontally cropped desktop frame
    "min_sky_above_horizon": 0.30,     # negative space for the Meridian survives
    "max_sky_above_horizon": 0.97,     # ...and the range has not left the frame
    "min_clearance": 0.0,              # nothing grazes the protected disc
    "min_visible_px_per_mass": 300,    # every mass earns its triangles somewhere
}
"""
`min_skyline_asymmetry` is on `skyline_asymmetry`, not on the frame-normalised
`silhouette_asymmetry` the first pass thresholded — see the note in
`stratos_terrain.analyse_frame` for why the latter cannot separate "the two sides
are alike" from "there is not much skyline". 0.15 means the two skylines differ,
where either has one, by 15% of the frame half-height on average. A mirrored
layout scores ~0 whatever its coverage, so this is a floor no symmetrical
composition reaches.

`max_sky_above_horizon` and `min_visible_px_per_mass` are new, and both exist
because the first mobile pass passed every other check while rendering four
masses that were never in shot at any station: their footprints ran to 3.3 frame
half-widths, so what reached the screen was the inner sliver of a mass whose
crest was a full frame width outside the picture. A budget check cannot see that
— the triangles are there, they are just not anywhere useful.
"""


def world_triangles():
    """Evaluated world-space triangles per production object, for the rasteriser."""
    deps = bpy.context.evaluated_depsgraph_get()
    out = []
    for name in st.PRODUCTION_OBJECTS:
        obj = bpy.data.objects.get(name)
        if obj is None:
            continue
        ev = obj.evaluated_get(deps)
        mesh = ev.to_mesh()
        mesh.calc_loop_triangles()
        mw = obj.matrix_world
        co = [tuple(mw @ v.co) for v in mesh.vertices]
        out.append((name, [(co[t.vertices[0]], co[t.vertices[1]], co[t.vertices[2]])
                           for t in mesh.loop_triangles]))
        ev.to_mesh_clear()
    return out


def analyse_mobile_composition() -> dict:
    """
    Render the mobile scene at every target viewport and measure the picture.

    This is the part of the mobile pass that cannot be done by inspecting the
    mesh — whether the composition *reads*. See the rasteriser's own note in
    stratos_terrain.py for why it exists at all.
    """
    objects = world_triangles()
    frames, failures = [], []

    for label, t, caption in MOBILE_STATIONS:
        cam = st.mobile_camera_at(t)
        for w, h in st.MOBILE_VIEWPORTS:
            f = st.analyse_frame(objects, cam, w / h, variant="mobile")
            f["station"] = label
            f["caption"] = caption
            f["viewport"] = [w, h]
            frames.append(f)

            where = "%s @ %dx%d" % (label, w, h)
            if f["safe_zone_violation_px"]:
                failures.append("%s: %d px of mountain inside the Meridian safe zone"
                                % (where, f["safe_zone_violation_px"]))
            if f["pierced_px"] > MOBILE_LIMITS["max_pierced_px"]:
                failures.append("%s: %d px of background enclosed by geometry — the "
                                "composition is pierced" % (where, f["pierced_px"]))
            if f["max_flat_silhouette_run"] > MOBILE_LIMITS["max_flat_silhouette_run"]:
                failures.append("%s: flat silhouette run of %.3f of frame width"
                                % (where, f["max_flat_silhouette_run"]))
            if f["max_vertical_edge_run"] > MOBILE_LIMITS["max_vertical_edge_run"]:
                failures.append("%s: ruled vertical edge over %.3f of frame height"
                                % (where, f["max_vertical_edge_run"]))
            if f["frame_top_touch_fraction"] > MOBILE_LIMITS["max_frame_top_touch"]:
                failures.append("%s: %.3f of mountain columns leave the top of the "
                                "frame — the flanks are panels, not silhouettes"
                                % (where, f["frame_top_touch_fraction"]))
            if f["skyline_asymmetry"] < MOBILE_LIMITS["min_skyline_asymmetry"]:
                failures.append("%s: skyline asymmetry %.3f — the two sides mirror"
                                % (where, f["skyline_asymmetry"]))
            if f["mountain_column_fraction"] < MOBILE_LIMITS["min_mountain_columns"]:
                failures.append("%s: mountain in only %.3f of frame columns — reads as a "
                                "cropped desktop frame" % (where, f["mountain_column_fraction"]))
            if f["sky_fraction_above_horizon"] < MOBILE_LIMITS["min_sky_above_horizon"]:
                failures.append("%s: only %.3f sky above the horizon — negative space lost"
                                % (where, f["sky_fraction_above_horizon"]))
            if f["sky_fraction_above_horizon"] > MOBILE_LIMITS["max_sky_above_horizon"]:
                failures.append("%s: %.3f sky above the horizon — the range has left the frame"
                                % (where, f["sky_fraction_above_horizon"]))
            c = f["safe_zone_clearance"]
            if c is not None and c < MOBILE_LIMITS["min_clearance"]:
                failures.append("%s: safe-zone clearance %.4f is negative" % (where, c))

    approach = [f for f in frames if f["station"] == "approach"]
    if not any("CLOUD_PASS" in f["visible_objects"] for f in approach):
        failures.append("CLOUD_PASS is not visible at the cloud-approach station — "
                        "the breakthrough beat has no pass to break through")

    # Every mass has to be in shot somewhere. The first mobile pass shipped four
    # that never were — see MOBILE_LIMITS.
    best = {}
    for f in frames:
        for name, px in f["visible_objects"].items():
            best[name] = max(best.get(name, 0), px)
    floor = MOBILE_LIMITS["min_visible_px_per_mass"]
    for name in [n for n in st.PRODUCTION_OBJECTS if bpy.data.objects.get(n)]:
        if best.get(name, 0) < floor:
            failures.append("%s peaks at %d visible px across every station and "
                            "viewport — it is not in the composition"
                            % (name, best.get(name, 0)))
    peak_visibility = dict(sorted(best.items()))

    return {
        "camera": {
            "vertical_fov_deg": st.MOBILE_VFOV_DEG,
            "advance_m": st.MOBILE_CAMERA_ADVANCE,
            "rise_m": st.MOBILE_CAMERA_RISE,
            "rise_power": st.MOBILE_CAMERA_RISE_POWER,
            "stations": {label: [round(c, 1) for c in st.mobile_camera_at(t)]
                         for label, t, _ in MOBILE_STATIONS},
        },
        "safe_zone": {
            "meridian_frame_fraction": round(st.MERIDIAN_FRAME_FRACTION, 4),
            "protected_frame_fraction": st.MOBILE_SAFE_ZONE_FRACTION,
            "slope": round(st.MOBILE_SAFE_ZONE_SLOPE, 6),
            "half_angle_deg": round(math.degrees(math.atan(st.MOBILE_SAFE_ZONE_SLOPE)), 3),
            "enforced_to_y": st.MOBILE_SAFE_ZONE_MAX_Y,
            "radius_at_enforcement_limit": round(
                st.safe_zone_radius(st.MOBILE_SAFE_ZONE_MAX_Y, "mobile"), 2),
            "corridor_frame_fraction": st.MOBILE_CORRIDOR_FRACTION,
        },
        "limits": MOBILE_LIMITS,
        "peak_visible_px": peak_visibility,
        "frames": frames,
        "failures": failures,
        "ok": not failures,
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> int:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(prog="generate_stratos_mountains")
    ap.add_argument("--variant", choices=("desktop", "mobile"), default="desktop")
    args = ap.parse_args(argv)

    reset_scene()
    configure_units()
    cols = make_collections()
    materials = make_materials()

    if args.variant == "desktop":
        masses = st.desktop_masses()
        floor_res, wall_res, route_seg = 96, 56, 150
        blend = SOURCE_DIR / "stratos-mountains.blend"
    else:
        masses = st.mobile_masses()
        floor_res, wall_res, route_seg = 52, 34, 80
        blend = SOURCE_DIR / "stratos-mountains-mobile.blend"

    for mass in masses:
        build_mass(mass, cols[mass.collection], materials)

    build_valley_floor(cols["VALLEY"], materials, floor_res, args.variant)
    build_valley_wall("VALLEY_WALL_L", -1.0, cols["VALLEY"], materials, wall_res,
                      args.variant)
    build_valley_wall("VALLEY_WALL_R", 1.0, cols["VALLEY"], materials, wall_res,
                      args.variant)
    build_ascent_route(cols["ROUTE"], materials, route_seg)
    build_guides(cols["GUIDES"], materials, args.variant)

    report = audit(args.variant)

    print("\n=== STRATOS MOUNTAINS :: %s ===" % args.variant.upper())
    print("meshes            %d" % report["mesh_count"])
    print("triangles         %d" % report["total_triangles"])
    print("materials         %d" % report["material_count"])
    print("missing objects   %s" % (report["missing_objects"] or "none"))
    print("empty meshes      %s" % (report["empty_meshes"] or "none"))
    print("NaN vertices      %s" % (report["nan_vertices"] or "none"))
    print("safe-zone breach  %s" % (report["safe_zone_violations"] or "none"))
    for name, o in sorted(report["objects"].items()):
        print("   %-20s %7d tris  %s" % (name, o["triangles"], o["material"]))

    composition = None
    if args.variant == "mobile":
        composition = analyse_mobile_composition()
        REPORTS_DIR.mkdir(parents=True, exist_ok=True)
        out = REPORTS_DIR / "stratos-mountains-mobile-composition.json"
        out.write_text(json.dumps(composition, indent=2) + "\n", encoding="utf-8")

        print("\n--- mobile silhouette validation ---")
        print("safe zone         %.1f%% of frame half-width (Meridian needs %.1f%%)"
              % (st.MOBILE_SAFE_ZONE_FRACTION * 100,
                 st.MERIDIAN_FRAME_FRACTION * 100))
        head = ("station", "viewport", "clear", "cols", "sky", "flat", "asym",
                "sk-asym", "pierce", "haze", "objs")
        print("%-9s %-9s %7s %6s %6s %6s %6s %8s %7s %6s %5s" % head)
        for f in composition["frames"]:
            print("%-9s %-9s %7s %6.3f %6.3f %6.3f %6.3f %8.3f %7d %6.3f %5d" % (
                f["station"], "%dx%d" % tuple(f["viewport"]),
                ("%.4f" % f["safe_zone_clearance"]) if f["safe_zone_clearance"] is not None else "-",
                f["mountain_column_fraction"], f["sky_fraction_above_horizon"],
                f["max_flat_silhouette_run"], f["silhouette_asymmetry"],
                f["skyline_asymmetry"], f["pierced_px"], f["haze_band"],
                len(f["visible_objects"])))
        print("peak visible px   %s" % ", ".join(
            "%s=%d" % (n, p) for n, p in composition["peak_visible_px"].items()))
        for msg in composition["failures"]:
            print("  FAIL  %s" % msg)
        print("composition       -> %s" % out.name)

    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    print("saved             %s" % blend)

    # Non-zero exit on a composition failure, so a CI step or a shell `&&` chain
    # stops here rather than exporting a range that crosses the instrument.
    if report["safe_zone_violations"] or report["empty_meshes"] or report["nan_vertices"]:
        print("FAILED: scene did not pass its own audit")
        return 1
    if composition is not None and not composition["ok"]:
        print("FAILED: mobile composition did not pass silhouette validation")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
