#!/usr/bin/env python3
"""
Stratos mountain environment — export validation.

    python3 blender/mountains/validate_stratos_mountains.py

Plain CPython, no Blender. That is the point: this validates the artefact that
actually ships, by reading the GLB container and its embedded glTF JSON, rather
than re-asking Blender what it thinks it wrote. A generator that is wrong in the
same way twice would pass a Blender-side check and fail here.

It reads the JSON chunk only. Draco-compressed primitives still declare their
accessors' `count`, `type`, `min` and `max` in the JSON — the extension supplies
the *data*, not the metadata — so triangle counts and bounding boxes are
readable without a Draco decoder. Vertex positions themselves are not inspected,
which is the one thing this check cannot see; the in-Blender audit in
generate_stratos_mountains.py covers per-vertex NaN and the safe zone, and this
one covers the container.

Writes reports/stratos-mountains-report.json and exits non-zero on any failure.
"""

import json
import math
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stratos_terrain as st  # noqa: E402

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
MODELS = REPO / "public" / "models"
REPORTS = HERE / "reports"

# Budgets from the brief. Deliberately asserted as a *range*: an export that
# collapses to 900 triangles has failed just as surely as one that blows the
# ceiling, and only checking the upper bound would let a broken generator pass.
BUDGETS = {
    "desktop": {"file": "stratos-mountains-desktop.glb", "tris": (80_000, 180_000),
                "max_bytes": 1_500_000},
    "mobile": {"file": "stratos-mountains-mobile.glb", "tris": (25_000, 65_000),
               "max_bytes": 600_000},
}

# Mobile drops the second midground layer by design — see stratos_terrain.
# mobile_masses(). Anything else missing is a failure.
OPTIONAL = {"mobile": {"MNT_MID_L_02", "MNT_MID_R_02"}}

MAX_MATERIALS = 4


def read_glb(path: Path) -> dict:
    """Pull the JSON chunk out of a binary glTF container."""
    raw = path.read_bytes()
    magic, version, _length = struct.unpack_from("<III", raw, 0)
    if magic != 0x46546C67:
        raise ValueError("%s is not a GLB (bad magic)" % path.name)
    if version != 2:
        raise ValueError("%s is glTF version %d, expected 2" % (path.name, version))

    offset = 12
    while offset < len(raw):
        clen, ctype = struct.unpack_from("<II", raw, offset)
        body = raw[offset + 8: offset + 8 + clen]
        if ctype == 0x4E4F534A:  # 'JSON'
            return json.loads(body.decode("utf-8"))
        offset += 8 + clen + (-clen % 4)
    raise ValueError("%s has no JSON chunk" % path.name)


def validate(variant: str) -> dict:
    spec = BUDGETS[variant]
    path = MODELS / spec["file"]
    failures, warnings = [], []

    result = {
        "variant": variant,
        "file": str(path.relative_to(REPO)),
        "exists": path.exists(),
        "bytes": None,
        "nodes": {},
        "total_triangles": 0,
        "mesh_count": 0,
        "material_count": 0,
        "materials": [],
        "bounds_min": None,
        "bounds_max": None,
        "bounds_size": None,
        "duplicate_names": [],
        "missing_objects": [],
        "unexpected_objects": [],
        "guide_objects_leaked": [],
        "empty_meshes": [],
        "invalid_bounds": [],
        "failures": failures,
        "warnings": warnings,
    }

    if not path.exists():
        failures.append("file does not exist: %s" % path)
        return result

    size = path.stat().st_size
    result["bytes"] = size
    if size > spec["max_bytes"]:
        failures.append("file is %d bytes, over the %d byte ceiling" % (size, spec["max_bytes"]))
    if size < 10_000:
        failures.append("file is only %d bytes — almost certainly an empty export" % size)

    g = read_glb(path)
    accessors = g.get("accessors", [])
    meshes = g.get("meshes", [])
    materials = g.get("materials", [])

    result["material_count"] = len(materials)
    result["materials"] = sorted(m.get("name", "<unnamed>") for m in materials)
    result["mesh_count"] = len(meshes)

    if len(materials) > MAX_MATERIALS:
        failures.append("%d materials, over the %d the art direction allows"
                        % (len(materials), MAX_MATERIALS))
    unknown_mats = [m for m in result["materials"] if m not in st.MATERIALS]
    if unknown_mats:
        failures.append("unexpected material names: %s" % unknown_mats)

    seen = {}
    total = 0

    for node in g.get("nodes", []):
        name = node.get("name", "<unnamed>")
        if "mesh" not in node:
            continue

        # Blender appends .001 when a name collides. A production node carrying
        # one means the web scene's lookup by name would miss it, so it is a
        # hard failure rather than cosmetic.
        if name.rsplit(".", 1)[-1].isdigit() and len(name.rsplit(".", 1)[-1]) == 3:
            failures.append("node '%s' carries a Blender duplicate suffix" % name)

        if name in seen:
            result["duplicate_names"].append(name)
        seen[name] = True

        if name in st.GUIDE_OBJECTS:
            result["guide_objects_leaked"].append(name)
            continue
        if name not in st.PRODUCTION_OBJECTS:
            result["unexpected_objects"].append(name)
            continue

        mesh = meshes[node["mesh"]]
        tris, verts = 0, 0
        lo = [math.inf] * 3
        hi = [-math.inf] * 3

        for prim in mesh.get("primitives", []):
            mode = prim.get("mode", 4)
            if mode != 4:
                failures.append("node '%s' uses primitive mode %d, expected triangles"
                                % (name, mode))
            if "indices" in prim:
                tris += accessors[prim["indices"]]["count"] // 3
            pos_idx = prim.get("attributes", {}).get("POSITION")
            if pos_idx is None:
                failures.append("node '%s' has a primitive with no POSITION" % name)
                continue
            acc = accessors[pos_idx]
            verts += acc["count"]

            amin, amax = acc.get("min"), acc.get("max")
            if not amin or not amax:
                failures.append("node '%s' POSITION accessor has no min/max" % name)
                continue
            for k in range(3):
                if not (math.isfinite(amin[k]) and math.isfinite(amax[k])):
                    result["invalid_bounds"].append(name)
                    failures.append("node '%s' has non-finite bounds" % name)
                    break
                lo[k] = min(lo[k], amin[k])
                hi[k] = max(hi[k], amax[k])

        if tris == 0:
            result["empty_meshes"].append(name)
            failures.append("node '%s' is an empty mesh" % name)

        # Node translation carries the origin offset the generator applied, so
        # world bounds are local bounds plus it. Rotation and scale are identity
        # by construction (export_apply resolves them), and a non-identity one
        # here would mean the export settings drifted — so it is checked.
        t = node.get("translation", [0.0, 0.0, 0.0])
        if node.get("scale") and any(abs(s - 1.0) > 1e-4 for s in node["scale"]):
            failures.append("node '%s' has a non-unit scale — transforms were not applied" % name)
        if node.get("rotation") and any(abs(r) > 1e-4 for r in node["rotation"][:3]):
            failures.append("node '%s' has a non-identity rotation" % name)

        world_lo = [lo[k] + t[k] for k in range(3)] if math.isfinite(lo[0]) else None
        world_hi = [hi[k] + t[k] for k in range(3)] if math.isfinite(hi[0]) else None

        if world_lo and any(world_hi[k] - world_lo[k] <= 0.0 for k in range(3)):
            # A zero-extent axis is legal for a flat plane, so this is a warning
            # for the route (which is flat by design) and a failure for a mass.
            msg = "node '%s' has zero extent on an axis" % name
            (warnings if name == "ASCENT_ROUTE" else failures).append(msg)

        result["nodes"][name] = {
            "triangles": tris,
            "vertices": verts,
            "material": (materials[mesh["primitives"][0]["material"]].get("name")
                         if mesh.get("primitives") and "material" in mesh["primitives"][0]
                         else None),
            "bounds_min": [round(c, 2) for c in world_lo] if world_lo else None,
            "bounds_max": [round(c, 2) for c in world_hi] if world_hi else None,
            "draco": any("KHR_draco_mesh_compression" in p.get("extensions", {})
                         for p in mesh.get("primitives", [])),
        }
        total += tris

    result["total_triangles"] = total

    # Whole-asset bounds, in the exported Y-up frame. The brief asks the report
    # to carry them, and they are the cheapest way for the web side to sanity
    # check that it has loaded the variant it thinks it has: the two
    # compositions are different shapes, not one shape at two densities, so
    # their bounds differ substantially.
    lo_all = [math.inf] * 3
    hi_all = [-math.inf] * 3
    for node in result["nodes"].values():
        if not node["bounds_min"]:
            continue
        for k in range(3):
            lo_all[k] = min(lo_all[k], node["bounds_min"][k])
            hi_all[k] = max(hi_all[k], node["bounds_max"][k])
    if math.isfinite(lo_all[0]):
        result["bounds_min"] = [round(c, 2) for c in lo_all]
        result["bounds_max"] = [round(c, 2) for c in hi_all]
        result["bounds_size"] = [round(hi_all[k] - lo_all[k], 2) for k in range(3)]

    optional = OPTIONAL.get(variant, set())
    for name in st.PRODUCTION_OBJECTS:
        if name not in result["nodes"]:
            result["missing_objects"].append(name)
            if name not in optional:
                failures.append("required node '%s' is missing from the export" % name)

    if result["guide_objects_leaked"]:
        failures.append("guide objects reached production: %s" % result["guide_objects_leaked"])
    if result["duplicate_names"]:
        failures.append("duplicate node names: %s" % result["duplicate_names"])
    if result["unexpected_objects"]:
        failures.append("nodes not in the manifest: %s" % result["unexpected_objects"])

    lo_t, hi_t = spec["tris"]
    if not (lo_t <= total <= hi_t):
        failures.append("%d triangles is outside the %d–%d budget" % (total, lo_t, hi_t))

    result["extensions_required"] = g.get("extensionsRequired", [])
    result["generator"] = g.get("asset", {}).get("generator")
    return result


def mobile_composition() -> dict:
    """
    The mobile pass's own findings, folded into this report.

    Written by generate_stratos_mountains.py, which is the only place that can
    produce them — the numbers come from rasterising the evaluated scene, and
    this validator deliberately never opens Blender. Summarised rather than
    copied wholesale: the per-frame detail stays in its own file, and what lands
    here is what the brief asks a validation report to answer — the mobile camera
    parameters, the safe zone's dimensions, and the worst projected clearance
    across every station and viewport.
    """
    path = REPORTS / "stratos-mountains-mobile-composition.json"
    if not path.exists():
        return {"present": False,
                "note": "run generate_stratos_mountains.py --variant mobile"}

    c = json.loads(path.read_text(encoding="utf-8"))
    frames = c.get("frames", [])
    clearances = [f["safe_zone_clearance"] for f in frames
                  if f.get("safe_zone_clearance") is not None]

    zone = dict(c.get("safe_zone", {}))
    # The safe zone's screen dimensions, which is the form the brief asks for and
    # the form the web side can check against a viewport. The protected disc is a
    # circle in angle, so it projects to an ellipse that is wide and short on a
    # portrait frame — the single fact the whole mobile layout is built around.
    zone["ellipse_by_viewport"] = {
        "%dx%d" % (w, h): {
            "half_width_fraction": round(st.MOBILE_SAFE_ZONE_FRACTION, 4),
            "half_height_fraction": round(st.MOBILE_SAFE_ZONE_FRACTION * (w / h), 4),
            "px": [round(st.MOBILE_SAFE_ZONE_FRACTION * w, 1),
                   round(st.MOBILE_SAFE_ZONE_FRACTION * (w / h) * h, 1)],
        }
        for w, h in st.MOBILE_VIEWPORTS
    }

    return {
        "present": True,
        "ok": c.get("ok"),
        "camera": c.get("camera"),
        "safe_zone": zone,
        "limits": c.get("limits"),
        "peak_visible_px": c.get("peak_visible_px"),
        "projected_safe_zone_clearance": {
            "min": min(clearances) if clearances else None,
            "max": max(clearances) if clearances else None,
            "by_frame": {"%s@%dx%d" % (f["station"], f["viewport"][0], f["viewport"][1]):
                         f["safe_zone_clearance"] for f in frames},
        },
        "worst_frame_metrics": {
            "max_flat_silhouette_run": max((f["max_flat_silhouette_run"] for f in frames),
                                           default=None),
            "min_skyline_asymmetry": min((f["skyline_asymmetry"] for f in frames),
                                         default=None),
            "max_pierced_px": max((f["pierced_px"] for f in frames), default=None),
            "max_safe_zone_violation_px": max((f["safe_zone_violation_px"] for f in frames),
                                              default=None),
            "max_sky_above_horizon": max((f["sky_fraction_above_horizon"] for f in frames),
                                         default=None),
        },
        "failures": c.get("failures", []),
    }


def main() -> int:
    REPORTS.mkdir(parents=True, exist_ok=True)
    report = {"variants": {}, "ok": True}

    for variant in BUDGETS:
        r = validate(variant)
        report["variants"][variant] = r
        ok = not r["failures"]
        report["ok"] &= ok

        print("\n=== %s :: %s ===" % (r["file"], "PASS" if ok else "FAIL"))
        print("  bytes            %s" % r["bytes"])
        print("  meshes           %d" % r["mesh_count"])
        print("  triangles        %d" % r["total_triangles"])
        print("  materials        %d  %s" % (r["material_count"], r["materials"]))
        print("  bounds min       %s" % r["bounds_min"])
        print("  bounds max       %s" % r["bounds_max"])
        print("  bounds size      %s" % r["bounds_size"])
        print("  draco            %s" % r.get("extensions_required"))
        print("  missing          %s" % (r["missing_objects"] or "none"))
        print("  guides leaked    %s" % (r["guide_objects_leaked"] or "none"))
        for w in r["warnings"]:
            print("  WARN  %s" % w)
        for f in r["failures"]:
            print("  FAIL  %s" % f)

    comp = mobile_composition()
    report["mobile_composition"] = comp
    print("\n=== mobile composition ===")
    if not comp["present"]:
        print("  MISSING  %s" % comp["note"])
        report["ok"] = False
    else:
        cam = comp["camera"]
        zone = comp["safe_zone"]
        clear = comp["projected_safe_zone_clearance"]
        print("  camera           vfov %.1f deg, advance %.0f m, rise %.0f m (power %.1f)"
              % (cam["vertical_fov_deg"], cam["advance_m"], cam["rise_m"],
                 cam["rise_power"]))
        for label, pos in cam["stations"].items():
            print("    %-9s      %s" % (label, pos))
        print("  safe zone        %.1f%% of half-width, %.3f deg half-angle, enforced to %.0f m"
              % (zone["protected_frame_fraction"] * 100, zone["half_angle_deg"],
                 zone["enforced_to_y"]))
        for vp, e in zone["ellipse_by_viewport"].items():
            print("    %-9s      %.3f x %.3f of frame  (%.0f x %.0f px)"
                  % (vp, e["half_width_fraction"], e["half_height_fraction"],
                     e["px"][0], e["px"][1]))
        print("  clearance        min %.4f, max %.4f of frame half-width"
              % (clear["min"], clear["max"]))
        print("  silhouette       %s" % comp["worst_frame_metrics"])
        if not comp["ok"]:
            report["ok"] = False
            for f in comp["failures"]:
                print("  FAIL  %s" % f)

    out = REPORTS / "stratos-mountains-report.json"
    out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("\nreport -> %s" % out.relative_to(REPO))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
