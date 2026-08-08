"""
Stratos mountain environment — shared geometry, noise and material library.

Imported by generate_stratos_mountains.py, export_stratos_mountains.py and
validate_stratos_mountains.py. Nothing in here touches bpy at import time so the
pure-maths half (noise, masks, the safe-zone test) can be exercised outside
Blender if it ever needs to be.

WHY A HAND-ROLLED NOISE FUNCTION
--------------------------------
Blender's own noise textures are not a stable contract across versions, and the
brief requires the scene to be reproducible across runs. `value_noise` below is
a seeded integer-hash value noise with quintic interpolation: same seed, same
floats, on any machine and any Blender build. That matters more than the last
few percent of visual quality, because everything downstream — triangle counts,
the safe-zone report, the preview renders — is only meaningful if the mesh is
the same one every time.

COORDINATE SYSTEM
-----------------
Blender is Z-up. The glTF exporter converts to the Y-up, -Z-forward convention
that Three.js expects, so the scene is authored here as:

    +X   right
    +Y   away from the viewer, down the valley
    +Z   up

    camera sits near (0, -150, 200) looking down +Y

After export that becomes +X right, +Y up, -Z forward — the camera in the web
scene looks down -Z at the same composition, with no rotation fix-up needed.

Unit is one metre. The environment spans roughly 3 km of depth and rises to
about 1.3 km, which keeps the near/far planes in the web renderer comfortable.

THE MERIDIAN SAFE ZONE
----------------------
The Meridian is screen-anchored and centred, so the volume it must not compete
with is a *cone* opening away from the camera, not a box: a disc of fixed
angular size sweeps out a cone as it recedes. `safe_zone_radius` defines it.

The cone is truncated at SAFE_ZONE_MAX_Y (1200 m) and this is a deliberate
design decision rather than an oversight. Enforcing an untruncated cone would
require the central solid angle to be empty at *every* depth, which is not a
composition — at 3 km the protected disc is 1 km across and the background range
could never close behind the instrument. Past 1200 m the terrain is distant,
low-contrast and largely occluded by the instrument itself, so it is allowed to
pass behind. Inside 1200 m, where a ridgeline would actually tangle with the
dial, nothing but sky is permitted.

VALLEY_FLOOR and ASCENT_ROUTE are exempt from the test: they are the ground the
camera flies over, they sit below the cone's axis through the near field, and a
ground plane receding to the horizon is not a silhouette conflict. Every
mountain mass is enforced.

DESKTOP AND MOBILE ARE TWO COMPOSITIONS, NOT ONE AT TWO RESOLUTIONS
-------------------------------------------------------------------
The first mobile pass was the desktop range at 52% grid resolution with the
second midground layer dropped. That is a geometry budget, not a composition,
and against a portrait frame it fails completely — see MOBILE FRAME MODEL below
for the arithmetic. `desktop_masses` and `mobile_masses` are now independent
layouts that share only this module's noise, materials and manifest.

Everything variant-dependent in here takes a `variant` argument defaulting to
"desktop", so every desktop call site is byte-identical to what produced the
accepted desktop GLB.
"""

import math

# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------

SEED = 20260802
"""Master seed. Every derived layer offsets from this, so one number moves the
whole range and each object still gets its own uncorrelated field."""

_MASK32 = 0xFFFFFFFF


def _hash2(ix: int, iy: int, seed: int) -> float:
    """Integer hash -> float in [-1, 1]. Deterministic on every platform."""
    n = (ix * 374761393 + iy * 668265263 + seed * 1442695041) & _MASK32
    n = ((n ^ (n >> 13)) * 1274126177) & _MASK32
    n = (n ^ (n >> 16)) & _MASK32
    return (n / _MASK32) * 2.0 - 1.0


def _quintic(t: float) -> float:
    """Perlin's C2-continuous fade. Smoother ridges than smoothstep."""
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)


def value_noise(x: float, y: float, seed: int) -> float:
    """Seeded 2D value noise in [-1, 1]."""
    ix, iy = math.floor(x), math.floor(y)
    fx, fy = x - ix, y - iy
    u, v = _quintic(fx), _quintic(fy)

    n00 = _hash2(ix, iy, seed)
    n10 = _hash2(ix + 1, iy, seed)
    n01 = _hash2(ix, iy + 1, seed)
    n11 = _hash2(ix + 1, iy + 1, seed)

    a = n00 + u * (n10 - n00)
    b = n01 + u * (n11 - n01)
    return a + v * (b - a)


def fbm(x: float, y: float, seed: int, octaves: int = 5,
        lacunarity: float = 2.0, gain: float = 0.5) -> float:
    """Fractal Brownian motion. Broad, rounded masses."""
    total, amp, freq, norm = 0.0, 1.0, 1.0, 0.0
    for i in range(octaves):
        total += amp * value_noise(x * freq, y * freq, seed + i * 101)
        norm += amp
        amp *= gain
        freq *= lacunarity
    return total / norm


def ridged(x: float, y: float, seed: int, octaves: int = 5,
           lacunarity: float = 2.0, gain: float = 0.5) -> float:
    """
    Ridged multifractal in [0, 1].

    `1 - |noise|` creates creases where the noise crosses zero, and squaring
    sharpens them into ridgelines. This is what gives the range its strong
    silhouettes instead of the lumpy blobs plain fBm produces — the brief is
    explicit that untouched noise displacement is not an acceptable result, and
    the ridge function is the difference between geology and porridge.
    """
    total, amp, freq, norm = 0.0, 1.0, 1.0, 0.0
    for i in range(octaves):
        n = value_noise(x * freq, y * freq, seed + i * 71)
        r = 1.0 - abs(n)
        total += amp * (r * r)
        norm += amp
        amp *= gain
        freq *= lacunarity
    return total / norm


def smoothstep(edge0: float, edge1: float, x: float) -> float:
    if edge0 == edge1:
        return 0.0 if x < edge0 else 1.0
    t = (x - edge0) / (edge1 - edge0)
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


# ---------------------------------------------------------------------------
# Composition constants
# ---------------------------------------------------------------------------

CAMERA_ANCHOR = (0.0, -150.0, 200.0)
"""Apex of the safe-zone cone, and where the preview camera sits. Matches the
web scene's canonical valley-baseline camera."""

SAFE_ZONE_SLOPE = 0.13
"""
Half-angle of the protected cone, as a radius-per-metre gradient.

Sized from the Meridian's actual screen footprint, which is the only thing that
makes it meaningful. 0.13 is a 7.4-degree half-angle; against the preview
camera's 33-degree vertical field of view that reserves roughly 45% of frame
height for the instrument.

This was 0.34 in the first pass, chosen by feel. That is an 18.8-degree
half-angle — a 37-degree protected cone against a 50-degree horizontal field of
view, so three quarters of the frame width was declared off-limits. Every mass
got pushed outside it, which put the framing mountains at 55 degrees off-axis
where the lens could not see them, and the range vanished from its own preview.
A safe zone wider than the subject it protects is not a safe zone, it is a
crop.
"""

SAFE_ZONE_MAX_Y = 1200.0
"""Depth past which the cone is no longer enforced — see the module docstring."""

SAFE_ZONE_MARGIN = 90.0
"""Extra clearance the valley walls hold beyond the cone, so a ridge never grazes
the instrument's edge. Tangency reads as a mistake even when it is legal."""

VALLEY_FLOOR_Z = -160.0
VALLEY_NEAR_Y = -900.0
VALLEY_FAR_Y = 4400.0
VALLEY_HALF_WIDTH = 2400.0
"""
The floor runs the whole depth of the scene, not just the near valley.

It was originally cut off at 1500 m, which left a hole in the middle of the
frame: past the floor's far edge and below the distant peaks there was nothing,
and the silhouette diagnostic showed the world's background straight through it.
A ground plane that reaches the horizon costs one more ring of quads and removes
the entire class of problem.
"""

BURIED_BASE = -420.0
"""
Where every mountain mass's footprint falls away to.

Well below VALLEY_FLOOR_Z, so the flat apron each mass ends in is underground
and the floor draws over it. See Mass.height for what happened when this sat at
floor level instead.
"""

EYE_Z = CAMERA_ANCHOR[2]
"""
Camera height, and therefore the screen-space horizon.

Load-bearing for the composition: anything in the central column that rises
above this appears *above* the horizon, in the open sky the Meridian occupies.
CLOUD_PASS and MNT_BACKGROUND_C are the two masses that sit on the centreline,
and both are capped below it on purpose — they read as distant ridges closing
the valley floor, not as masses crossing the instrument.
"""

EXEMPT_FROM_SAFE_ZONE = ("VALLEY_FLOOR", "ASCENT_ROUTE")
"""Ground, not silhouette. Documented in the module docstring."""


# ---------------------------------------------------------------------------
# Mobile frame model
# ---------------------------------------------------------------------------
# WHY THE DESKTOP COMPOSITION CANNOT BE REUSED ON A PHONE
# -------------------------------------------------------
# The web camera (experiments/src/full/components/JourneyScene.tsx) is a 32-degree
# *vertical* field of view, and JourneyCamera.tsx dollies it to whatever distance
# makes a 2.2 x 1.24 unit frame fit — width-limited on every viewport this site
# targets. Two consequences, and the whole mobile problem is in them:
#
#   1. Because the dolly fits a fixed *width*, the Meridian's projected radius is
#      a constant 0.530 of the frame half-width on every viewport, phone or
#      desktop. It is not smaller on a phone; it is exactly as wide.
#   2. The horizontal field of view is not constant. At 1440x900 the half-angle
#      has tan 0.4588. At 360x800 it has tan 0.1290 — three and a half times
#      narrower, because portrait aspect multiplies the vertical FOV down.
#
# So the *same* instrument sits in a frame that shows three and a half times less
# world per metre of depth. SAFE_ZONE_SLOPE = 0.13 is 0.283 of the half-width in
# landscape and 1.008 of it in portrait: on a phone the desktop cone is the entire
# frame width. Every desktop mass is placed outside that cone, which is why the
# accepted mobile GLB renders as two dark corner wedges and 60% empty sky.
#
# Nothing about that is fixed by removing triangles, and it is not fixed by a
# longer lens either — a longer lens narrows the frame further and pushes the
# masses further out. The masses have to move.

MOBILE_VIEWPORTS = ((430, 932), (390, 844), (360, 800))
"""The three target portrait viewports, as CSS pixels."""

MOBILE_VFOV_DEG = 32.0
"""Vertical field of view, matched to the web camera so the previews mean
something. The desktop QC camera's 38 mm is 33.4 degrees vertical, within 1.4 of
this, so the accepted desktop previews stay representative and are left alone."""

MOBILE_TAN_V = math.tan(math.radians(MOBILE_VFOV_DEG) / 2.0)

MOBILE_DESIGN_ASPECT = min(w / h for w, h in MOBILE_VIEWPORTS)
"""360x800 is the narrowest of the three. Compose for the tightest frame and the
other two inherit the clearance rather than needing their own layout."""

MOBILE_TAN_H = MOBILE_TAN_V * MOBILE_DESIGN_ASPECT

# --- The Meridian's actual screen footprint --------------------------------
# Read off the web components rather than chosen by feel, because "sized from the
# instrument's screen footprint" is only a defensible sentence if the numbers
# come from the instrument.
MERIDIAN_FIT_HALF_WIDTH = 1.1
"""FRAME_WIDTH / 2 from JourneyCamera.tsx — what the dolly fits to the frame."""

MERIDIAN_HOUSING_RADIUS = 0.517
"""ALT_Housing_Flange, the widest part of the instrument itself (meridianParts.ts)."""

MERIDIAN_RING_RADIUS = 0.805
"""Ring 3 fully expanded: radius 0.5 at finalScale 1.5, plus its 0.019 half-width.
The largest the assembly ever gets — 'future ring expansion' in the brief."""

MERIDIAN_DOLLY_NEAR = 0.94
MERIDIAN_DOLLY_FAR = 1.38
"""Extremes of `k` in JourneyCamera's four-leg dolly, as multiples of the fit
distance. The instrument is angularly largest at the near end, the expanded rings
at the far end, and both cases have to clear."""

MERIDIAN_FRAME_FRACTION = max(
    MERIDIAN_HOUSING_RADIUS / (MERIDIAN_FIT_HALF_WIDTH * MERIDIAN_DOLLY_NEAR),
    MERIDIAN_RING_RADIUS / (MERIDIAN_FIT_HALF_WIDTH * MERIDIAN_DOLLY_FAR),
)
"""
0.530 — the Meridian's largest projected radius, as a fraction of the frame
half-width, on any viewport at any point in the journey.

The two terms are the instrument at its closest (0.500) and the fully expanded
armillary at its most distant (0.530). They land within 6% of each other, which
is not a coincidence: the dolly pulls back as the rings grow precisely so the
assembly holds its place in frame.
"""

MOBILE_SAFE_ZONE_FRACTION = 0.605
"""
Protected radius as a fraction of the frame half-width.

MERIDIAN_FRAME_FRACTION (0.530) is the geometry that must not be touched; the
remaining 0.075 is clearance, so a ridge never grazes the outermost ring. On a
360 px phone the protected disc is 60.5% of the screen width and 27.2% of its
height — wide and short, the opposite of the desktop cone's tall and narrow
projection, which is the single fact that reshapes the whole composition.
"""

MOBILE_SAFE_ZONE_SLOPE = MOBILE_SAFE_ZONE_FRACTION * MOBILE_TAN_H
"""0.0781. Compare SAFE_ZONE_SLOPE = 0.13 — the mobile cone is *narrower* in world
space than the desktop one while being *twice as wide* on screen."""

MOBILE_SAFE_ZONE_MAX_Y = 2600.0
"""
Truncation depth, against the desktop's 1200.

Deliberately more than twice as deep. The mobile layout is front-biased, so the
masses that would tangle with the instrument all sit inside 3 km; enforcing only
to 1200 m would leave the midground and the cloud peaks — which on mobile are the
masses nearest the centreline in screen terms — unchecked. Past 2600 m only
MNT_BACKGROUND_C and CLOUD_PASS remain, and both are capped below EYE_Z, so the
background can still close behind the instrument the way the desktop cone's
truncation exists to allow.
"""

MOBILE_CORRIDOR_FRACTION = 0.72
"""
Inner lip of the valley walls, as a fraction of the frame half-width.

Between MOBILE_SAFE_ZONE_FRACTION (0.605) and the frame edge, so the walls hold
the outer 28% of each side and leave a 0.115 half-width band of clear sky between
the protected disc and the rock. Framing, not a tunnel: 72% of the frame width
stays open between the lips.
"""

MOBILE_CORRIDOR_WANDER = 0.07
"""Amplitude of the corridor lip's depth wander, in half-width fractions. Keeps
the lip in [0.65, 0.79] — outside the protected disc at 0.605 at every depth."""

MOBILE_CORRIDOR_FLOOR = 60.0
"""
Absolute floor on the corridor half-width, in metres.

Purely proportional would take the corridor to 13 m at the camera plane, which
would close the walls over ASCENT_ROUTE's own 14 m width. The desktop's floor is
190 m; a phone frame needs a much smaller one or the near walls never enter the
picture at all.
"""

MOBILE_VALLEY_HALF_WIDTH = 1000.0
"""
Against the desktop's 2400.

At the floor's far edge a 360 px frame shows +/-587 m, so anything past 1000 m is
geometry nobody can see on a phone — it is also the brief's "reduce lateral valley
width", done where it is actually free.
"""

MOBILE_WALL_OUTER_FRACTION = 1.34
"""
Outer edge of the valley walls, as a fraction of the frame half-width — not an
absolute metre value the way the desktop's 1600 is.

This is the same mistake as the one `mobile_masses` had to be rebuilt around, and
it is worth naming because it is invisible in world space. The wall gains its
height across a `smoothstep(0, 0.34, t)` ramp in `t`, the normalised run from the
inner lip to the outer edge. With the outer edge at an absolute 760 m, that run
is 653 m wide at 1 km of depth — 5.1 frame half-widths on a portrait phone. The
frame edge falls at t = 0.06, so the only part of the wall a phone ever showed
was the first 6% of the ramp: a 119 m rise, still below the sightline. The walls
were in the file, passed every world-space check, and contributed four pixels in
the corner of the frame.

Anchored to the frame instead, the inner lip sits at 0.72 and the outer edge at
1.34, so the ramp completes at 0.93 of the half-width — just inside the frame
edge. The wall now reads as the cut side of a valley across the outer 28% of the
picture, which is the job it was always meant to do.
"""

MOBILE_VALLEY_FAR_Y = 9000.0
"""
Far edge of the mobile valley floor, against the desktop's 4400.

Deeper, not shallower, and for the opposite reason to the width reduction. A
ground plane approaches the horizon asymptotically, so how close the floor's far
edge gets to the horizon is set by its distance: at 4.4 km it stops 0.27 of the
half-height below the horizon on a portrait frame, at 9 km it stops 0.13 below.
It costs nothing — the grid resolution is unchanged, the quads are simply longer
— and it is what stops the band under the horizon reading as a hole rather than
as haze.
"""

MOBILE_CAMERA_ADVANCE = 900.0
MOBILE_CAMERA_RISE = 780.0
MOBILE_CAMERA_RISE_POWER = 1.5
"""
The dedicated mobile camera move, exported as CAMERA_MOBILE_GUIDE.

The desktop path runs 2050 m forward and 980 m up. On a portrait frame that
forward travel is the enemy: advancing the camera brings the flanking masses
closer, which *widens* their screen fraction and drives them off the sides — at
the desktop path's 11 000 m station the mobile cloud peaks would have to sit
simultaneously outside the safe cone and inside a frame narrower than the cone,
which has no solution at any depth under 1 770 m.

So mobile travels 900 m forward and 980 m up. A portrait frame has vertical room
and no horizontal room, so the ascent is told by climbing rather than by
advancing. Same apex at t = 0, so the Meridian's projected centre does not move.

The rise was 1250 m and is 980 m for a measured reason: at 1250 m the camera
finishes above everything in the scene, and the cloud-approach station rendered
at 97.4% sky above the horizon — the range had left the picture at exactly the
beat it is there to carry. Compensating by making the cloud peaks taller put the
*most distant* masses highest in frame, which is backwards. Lowering the rise
instead keeps the peaks 0.5 of the half-height above the horizon at the approach,
and `max_sky_above_horizon` now fails the build if that regresses.
"""


MOBILE_STATION_PATH = (
    (0.0, 220.0, -50.0),
    (2600.0, -340.0, 30.0),
    (7000.0, -140.0, 240.0),
    (12000.0, 480.0, 600.0),
)
"""
The web renderer's art-directed portrait station offset, keyed on altitude in
metres as (altitude, forward, rise).

THIS IS A MIRROR, NOT A SOURCE
------------------------------
The authority is `PORTRAIT_PATH` in `experiments/src/full/mountainLook.ts`, and
the two must be kept in step by hand. It is duplicated here rather than left out
because the alternative is worse: every check in this file — the safe-zone cone,
the silhouette gates, the per-mass visibility census, the preview renders — is
made through `mobile_camera_at`, and if that camera is not the camera the
browser uses then all of them are measuring a picture nobody sees. That is
precisely the failure the previous pass shipped: the source validated a
composition at the authored station while the web renderer drew it from 280 m
further back, and the curtain defect lived entirely in the difference.

The offsets are in the same model metres as everything else here, and the sign
convention matches `cameraStation` in mountains.ts: positive `forward` moves the
station along +Y, toward the range.
"""


def mobile_station_offset(altitude: float):
    """Smoothstep-joined offset at an altitude. Mirrors `portraitStation`."""
    keys = MOBILE_STATION_PATH
    if altitude <= keys[0][0]:
        return keys[0][1], keys[0][2]
    for i in range(1, len(keys)):
        a0, af, ar = keys[i - 1]
        b0, bf, br = keys[i]
        if altitude > b0:
            continue
        k = smoothstep(a0, b0, altitude)
        return af + (bf - af) * k, ar + (br - ar) * k
    return keys[-1][1], keys[-1][2]


def mobile_camera_at(t: float):
    """
    Mobile camera station at normalised journey progress `t`.

    The authored linear advance plus the art-directed station offset, so this is
    the station the browser actually renders from. `t` is altitude / 30 000 — see
    the note above `cameraStation` in mountains.ts.
    """
    forward, rise = mobile_station_offset(t * 30000.0)
    return (0.0,
            CAMERA_ANCHOR[1] + MOBILE_CAMERA_ADVANCE * t + forward,
            CAMERA_ANCHOR[2] + MOBILE_CAMERA_RISE * (t ** MOBILE_CAMERA_RISE_POWER) + rise)


def desktop_camera_at(t: float):
    """Desktop camera station. Matches CAMERA_PATH_GUIDE."""
    return (0.0, CAMERA_ANCHOR[1] + 2050.0 * t, CAMERA_ANCHOR[2] + 980.0 * (t ** 1.6))


def mobile_x(fraction: float, y: float) -> float:
    """
    World X that projects to `fraction` of the mobile frame's half-width at depth
    `y`, seen from the safe-zone apex.

    Every mobile footprint edge is authored through this, so a layout number in
    `mobile_masses` reads as the screen position it holds rather than as a metre
    value whose framing has to be worked out. Signed: negative is frame-left.
    """
    return fraction * MOBILE_TAN_H * (y - CAMERA_ANCHOR[1])


def safe_zone_radius(y: float, variant: str = "desktop") -> float:
    """Protected radius at depth `y`. Zero once past the truncation plane."""
    if variant == "mobile":
        if y > MOBILE_SAFE_ZONE_MAX_Y:
            return 0.0
        return max(0.0, (y - CAMERA_ANCHOR[1]) * MOBILE_SAFE_ZONE_SLOPE)
    if y > SAFE_ZONE_MAX_Y:
        return 0.0
    return max(0.0, (y - CAMERA_ANCHOR[1]) * SAFE_ZONE_SLOPE)


def inside_safe_zone(x: float, y: float, z: float, variant: str = "desktop") -> bool:
    """
    True if a point falls inside the Meridian's protected cone.

    Circular cross-section about the cone axis, which runs along +Y at the
    camera's eye height — the same disc the instrument occupies on screen.
    """
    r = safe_zone_radius(y, variant)
    if r <= 0.0:
        return False
    dz = z - CAMERA_ANCHOR[2]
    return math.hypot(x, dz) < r


def corridor_half_width(y: float, variant: str = "desktop") -> float:
    """
    Inner edge of the valley walls at depth `y`.

    Tracks the safe-zone cone plus a margin, with a floor value so the near
    field does not pinch shut in front of the camera. Because it follows the
    cone, the walls hold a *constant* screen-space framing as they recede, which
    is what makes the valley read as one deliberate corridor rather than a
    tunnel that happens to widen.

    Mobile expresses the same idea as a frame fraction rather than as the cone
    plus an absolute margin: at portrait FOV a fixed 90 m margin is 0.09 of the
    half-width at 800 m and 0.02 of it at 3 km, so the walls would visibly splay
    open with depth instead of holding their framing.
    """
    if variant == "mobile":
        d = max(0.0, y - CAMERA_ANCHOR[1])
        # The lip wanders with depth rather than holding one fraction exactly.
        #
        # A lip pinned to a constant screen fraction projects to a dead-straight
        # vertical line, and since the wall is the outermost thing in frame on
        # both sides, that line is the composition's longest edge — the ruled
        # cliff the brief rules out, standing on end where the flat-run test
        # cannot see it. `max_vertical_edge_run` measures it now.
        #
        # The wander is one octave at a 620 m wavelength, which is long enough to
        # read as the valley opening and closing rather than as noise on an edge.
        # Amplitude is bounded so the lip stays in [0.65, 0.79] of the half-width
        # — never inside MOBILE_SAFE_ZONE_FRACTION (0.605), so the framing
        # guarantee survives the irregularity.
        f = MOBILE_CORRIDOR_FRACTION + MOBILE_CORRIDOR_WANDER * value_noise(
            0.0, y / 620.0, SEED + 733)
        return max(MOBILE_CORRIDOR_FLOOR, f * MOBILE_TAN_H * d)
    return max(190.0, safe_zone_radius(min(y, SAFE_ZONE_MAX_Y)) + SAFE_ZONE_MARGIN)


# ---------------------------------------------------------------------------
# Object manifest
# ---------------------------------------------------------------------------
# Every production node the web scene is allowed to look up by name, grouped by
# the collection it belongs to. validate_stratos_mountains.py asserts the
# exported GLB contains exactly these, with no Blender `.001` suffixes.

COLLECTIONS = {
    "VALLEY": ("VALLEY_FLOOR", "VALLEY_WALL_L", "VALLEY_WALL_R"),
    "FOREGROUND": ("MNT_FOREGROUND_L", "MNT_FOREGROUND_R"),
    "MIDGROUND": ("MNT_MID_L_01", "MNT_MID_R_01", "MNT_MID_L_02", "MNT_MID_R_02"),
    "BACKGROUND": ("MNT_BACKGROUND_L", "MNT_BACKGROUND_C", "MNT_BACKGROUND_R"),
    "ROUTE": ("ASCENT_ROUTE",),
    "CLOUD_BREAK": ("CLOUD_PEAK_L", "CLOUD_PEAK_R", "CLOUD_PASS"),
    "GUIDES": ("MERIDIAN_SAFE_ZONE", "CAMERA_PATH_GUIDE", "CLOUD_LAYER_GUIDE",
               "MERIDIAN_SAFE_ZONE_MOBILE", "CAMERA_MOBILE_GUIDE",
               "CLOUD_LAYER_GUIDE_MOBILE"),
}

ROOT_COLLECTION = "STRATOS_MOUNTAIN_ENVIRONMENT"

GUIDE_OBJECTS = COLLECTIONS["GUIDES"]

PRODUCTION_OBJECTS = tuple(
    name for key, names in COLLECTIONS.items() if key != "GUIDES" for name in names
)

MATERIALS = ("MAT_ROCK_GRAPHITE", "MAT_ROCK_TITANIUM", "MAT_VALLEY_DARK", "MAT_ROUTE_ACCENT")


# ---------------------------------------------------------------------------
# Mountain definitions
# ---------------------------------------------------------------------------
# Each mass is an independent grid over its own footprint, placed outside the
# central corridor. Independent grids rather than one displaced terrain because
# the web scene needs to fade, fog and hide the depth layers separately, and
# because it guarantees by construction that no mountain occupies the corridor:
# the geometry is never generated there in the first place.

class Mass:
    """One art-directed mountain mass."""

    def __init__(self, name, collection, material, x0, x1, y0, y1,
                 peak, base_z, seed_offset, res, octaves=5, ridge_scale=900.0,
                 erosion=0.22, shoulder=0.22, ridge_power=1.7, ridge_aniso=1.7,
                 plateau=0.68, shoulder_in=None, x0_far=None, x1_far=None,
                 warp_u=0.085, warp_v=0.075):
        self.name = name
        self.collection = collection
        self.material = material
        self.x0, self.x1 = x0, x1
        self.y0, self.y1 = y0, y1

        # Footprint width at the far edge. Defaults to the near edge, which makes
        # the footprint the axis-aligned rectangle every desktop mass is — the
        # arithmetic below then multiplies the splay term by exactly zero, so the
        # desktop range is bit-for-bit what it was before this existed.
        #
        # Mobile needs the general case. A rectangle holds a *constant world*
        # inner edge, so against a 14.7-degree horizontal frame its screen
        # position sweeps inward as it recedes: a mass legal at its near edge is
        # inside the instrument at its far one. A splayed footprint holds a
        # constant *screen* fraction instead, which is the same trick
        # `corridor_half_width` already plays with the valley walls, and it is
        # what lets a mobile mass be 1.2 km deep instead of the ~370 m a
        # rectangle would allow between the cone and the frame edge.
        self.x0_far = x0 if x0_far is None else x0_far
        self.x1_far = x1 if x1_far is None else x1_far

        # Amplitude of the footprint domain warp, in units of u and v. Lower on
        # mobile: the warp has to stay small against `shoulder_in` or the inner
        # face stops being a face, and on a phone frame it also has to stay well
        # inside the 0.115 half-width band between the cone and the wall lip.
        self.warp_u = warp_u
        self.warp_v = warp_v
        self.peak = peak
        self.base_z = base_z
        self.seed = SEED + seed_offset
        self.res = res
        self.octaves = octaves
        self.ridge_scale = ridge_scale
        self.erosion = erosion
        self.shoulder = shoulder
        self.ridge_power = ridge_power
        self.ridge_aniso = ridge_aniso
        self.plateau = plateau

        # Valley-facing shoulder. Defaults to a third of the outer one, because
        # the two sides of a mass are not the same landform: the face over the
        # valley is the cut one and it should fall steeply, while the outward
        # side runs away into the range. Symmetric shoulders were what made the
        # first pass read as a row of tents, and they also wasted the frame —
        # the mass only reached full height deep inside its own footprint, so
        # the near side of every mountain was a long shallow ramp occupying the
        # space the composition needed for open sky.
        self.shoulder_in = shoulder * 0.72 if shoulder_in is None else shoulder_in

        # Which edge faces the valley. Inferred rather than declared so a mass
        # cannot be moved across the centreline and keep a stale flag. Tested
        # across the whole splayed footprint, not just its near edge.
        lo = min(x0, self.x0_far)
        hi = max(x1, self.x1_far)
        self.side = "left" if hi <= 0 else ("right" if lo >= 0 else "centre")

    def x_range(self, v: float):
        """Footprint X span at normalised depth `v`."""
        return (self.x0 + (self.x0_far - self.x0) * v,
                self.x1 + (self.x1_far - self.x1) * v)

    def height(self, x: float, y: float) -> float:
        """
        Height field for this mass.

        Four terms, in the order they matter:

          footprint   takes the mass to its buried base at its own edges, so
                      neighbouring masses meet underground instead of ending in
                      a visible cliff;
          ridge       the ridged multifractal that supplies the silhouette,
                      raised to `ridge_power` to sharpen crests;
          anisotropy  the noise domain is stretched along Y so ridgelines run
                      down the valley as spurs pointing at the camera, which is
                      how a real range frames a corridor — isotropic noise gives
                      a field of unrelated bumps;
          erosion     a low-amplitude fBm that stops the crests reading as a
                      repeating pattern.

        WHY THE BASE IS BURIED
        ----------------------
        `base_z` sits far below the valley floor, not at it. The first version
        of this put the base at floor level, and the footprint falloff then
        produced a flat plateau at exactly floor height around every mass —
        which rendered as hard horizontal steps across the silhouette, the most
        obviously artificial thing in the frame. Burying the base means the
        falloff descends into a trench that VALLEY_FLOOR and the walls draw over,
        so what remains visible is only the part of the mass that rises out of
        the ground.

        `plateau` raises the footprint to a power below 1, which holds the mass
        near full height further out before it drops. Without it the profile is
        a tent; with it the flanks stay steep and the ridge does the shaping.

        Small detail is deliberately absent. The brief asks for large geological
        masses with limited small detail, and at the distances this scene is
        viewed from, high-frequency displacement costs triangles and returns
        aliasing.
        """
        v = (y - self.y0) / (self.y1 - self.y0)
        x0v, x1v = self.x_range(v)
        u = (x - x0v) / (x1v - x0v)

        # Domain-warp the footprint before evaluating the falloff.
        #
        # Without this, the edge of a mass is the edge of its rectangle: the
        # falloff depends only on u, so the boundary is a perfectly straight
        # line in world space and renders as a ruled cliff face. Two octaves of
        # low-frequency noise pushing u and v around by a few percent is enough
        # to make the boundary wander, and it costs one noise lookup — the
        # silhouette stops announcing that the mass is a grid.
        w = self.ridge_scale * 2.6
        u += value_noise(x / w, y / w, self.seed + 313) * self.warp_u
        v += value_noise(x / w + 11.3, y / w - 7.1, self.seed + 457) * self.warp_v

        if self.side == "left":      # inner edge is u = 1
            fu = (smoothstep(0.0, self.shoulder, u)
                  * smoothstep(1.0, 1.0 - self.shoulder_in, u))
        elif self.side == "right":   # inner edge is u = 0
            fu = (smoothstep(0.0, self.shoulder_in, u)
                  * smoothstep(1.0, 1.0 - self.shoulder, u))
        else:
            fu = smoothstep(0.0, self.shoulder, u) * smoothstep(1.0, 1.0 - self.shoulder, u)
        fv = smoothstep(0.0, self.shoulder, v) * smoothstep(1.0, 1.0 - self.shoulder, v)
        footprint = fu * fv
        if footprint <= 0.0:
            return self.base_z

        nx = x / self.ridge_scale
        ny = y / (self.ridge_scale * self.ridge_aniso)

        r = ridged(nx, ny, self.seed, self.octaves) ** self.ridge_power
        e = fbm(nx * 2.4, ny * 2.4, self.seed + 977, 3)

        h = r * (1.0 - self.erosion) + (e * 0.5 + 0.5) * self.erosion
        return self.base_z + self.peak * (footprint ** self.plateau) * h


ROUTE_PROUD = 3.0
"""
How far ASCENT_ROUTE sits above the valley floor, in metres.

Was 0.7. The floor is a grid — 55 m between rows on desktop, 190 m on mobile —
so its rendered surface is the linear interpolation between vertices, while the
route samples the height function exactly. Where the floor is convex between two
rows the interpolated surface sits above the true one by up to about 2 m at
mobile spacing, which is enough to swallow a 0.7 m offset. 3 m clears that with
margin and is 0.2% of the valley's width: it reads as an incision, not a kerb.
"""


def valley_floor_z(x: float, y: float) -> float:
    """
    Height of the valley floor at a point.

    Shared, because ASCENT_ROUTE has to sit on the floor and the only reliable
    way to guarantee that is for both to call one function.

    THE DEFECT THIS EXISTS TO FIX
    -----------------------------
    The route used to re-derive the floor independently, and the two derivations
    had drifted apart: a different channel depth (-34 against -38), a different
    drift field (three octaves at 640 m and 16 m of amplitude, against two at
    900 m and 9 m), and a `fall` term taking 46 m off the far end that the floor
    itself had already had removed — the floor's own docstring records dropping
    it because it reopened the hole in the middle of the frame.

    The result was that the route, nominally 0.7 m proud of the floor, was
    *underneath* it from about 1 km outward, by as much as 10.5 m at the far end
    — the last third of the ascent line buried in the ground it is drawn on.

    This is a shared defect and it was in the accepted desktop GLB too. It was
    found by the mobile pass only because the mobile composition census counts
    visible pixels per object and the route scored zero at every station.
    """
    channel = -38.0 * (1.0 - min(1.0, abs(x) / 460.0) ** 2)
    # The walls own the rise out of the valley; when the floor also lifted 120 m
    # from 320 m out, the two effects compounded into a dome that closed over the
    # frame and hid the range behind it.
    flanks = 55.0 * smoothstep(700.0, 2400.0, abs(x))
    drift = fbm(x / 900.0, y / 900.0, SEED + 401, 2) * 9.0
    return VALLEY_FLOOR_Z + channel + flanks + drift


def desktop_masses():
    """
    The full range.

    Placement rule: every footprint's inner edge clears `corridor_half_width`
    at its nearest depth. The numbers below are art direction, not a formula —
    they were chosen so the foreground reads as two closing shoulders, the
    midground supplies the scale jump, and the background closes the horizon
    without competing.
    """
    B = BURIED_BASE

    return [
        # --- Foreground: strongest form, closest, frames the composition ------
        # Inner edges sit outside corridor_half_width at their deepest point, so
        # the pair reads as two closing shoulders with open sky between them.
        # Asymmetric on purpose: matched left and right masses read as a stage
        # set, and the brief asks for geology.
        Mass("MNT_FOREGROUND_L", "FOREGROUND", "MAT_ROCK_GRAPHITE",
             x0=-1500, x1=-360, y0=150, y1=1050, peak=1560, base_z=B,
             seed_offset=11, res=96, octaves=4, ridge_scale=1050, erosion=0.15,
             ridge_power=1.25, ridge_aniso=2.1),
        Mass("MNT_FOREGROUND_R", "FOREGROUND", "MAT_ROCK_GRAPHITE",
             x0=360, x1=1580, y0=210, y1=1180, peak=1660, base_z=B,
             seed_offset=23, res=96, octaves=4, ridge_scale=1120, erosion=0.15,
             ridge_power=1.25, ridge_aniso=1.9),

        # --- Midground: the scale jump, two layers a side ---------------------
        Mass("MNT_MID_L_01", "MIDGROUND", "MAT_ROCK_TITANIUM",
             x0=-1950, x1=-480, y0=950, y1=1900, peak=1640, base_z=B,
             seed_offset=37, res=64, octaves=4, ridge_scale=1280, erosion=0.20,
             ridge_power=1.2, ridge_aniso=1.8),
        Mass("MNT_MID_R_01", "MIDGROUND", "MAT_ROCK_TITANIUM",
             x0=480, x1=2050, y0=1010, y1=1990, peak=1710, base_z=B,
             seed_offset=53, res=64, octaves=4, ridge_scale=1320, erosion=0.20,
             ridge_power=1.2, ridge_aniso=1.8),
        Mass("MNT_MID_L_02", "MIDGROUND", "MAT_ROCK_TITANIUM",
             x0=-2600, x1=-820, y0=1700, y1=2750, peak=1760, base_z=B,
             seed_offset=67, res=64, octaves=4, ridge_scale=1450, erosion=0.24,
             ridge_power=1.15, ridge_aniso=1.7),
        Mass("MNT_MID_R_02", "MIDGROUND", "MAT_ROCK_TITANIUM",
             x0=820, x1=2700, y0=1790, y1=2840, peak=1810, base_z=B,
             seed_offset=79, res=64, octaves=4, ridge_scale=1500, erosion=0.24,
             ridge_power=1.15, ridge_aniso=1.7),

        # --- Background: broad, simple, closes the horizon --------------------
        Mass("MNT_BACKGROUND_L", "BACKGROUND", "MAT_ROCK_TITANIUM",
             x0=-3400, x1=-1100, y0=2700, y1=3950, peak=1840, base_z=B,
             seed_offset=97, res=48, ridge_scale=1500, erosion=0.30,
             octaves=3, ridge_power=1.1, ridge_aniso=1.5, shoulder=0.30),
        # Capped below EYE_Z. This is the mass that sits on the centreline, and
        # keeping its summit under the horizon is what leaves the sky behind the
        # Meridian empty. It closes the far end of the valley floor and does
        # nothing else.
        Mass("MNT_BACKGROUND_C", "BACKGROUND", "MAT_ROCK_TITANIUM",
             x0=-1400, x1=1400, y0=3250, y1=4350, peak=505, base_z=B,
             seed_offset=113, res=48, ridge_scale=1250, erosion=0.34,
             octaves=3, ridge_power=1.05, ridge_aniso=1.3, shoulder=0.34),
        Mass("MNT_BACKGROUND_R", "BACKGROUND", "MAT_ROCK_TITANIUM",
             x0=1100, x1=3500, y0=2780, y1=4030, peak=1890, base_z=B,
             seed_offset=131, res=48, ridge_scale=1500, erosion=0.30,
             octaves=3, ridge_power=1.1, ridge_aniso=1.5, shoulder=0.30),

        # --- Cloud-break peaks -----------------------------------------------
        # The summits the ascent passes at 12 000 m: tall enough to stand well
        # clear of CLOUD_LAYER_GUIDE at z = 620, and held off the centreline so
        # they frame the breakthrough rather than block it.
        Mass("CLOUD_PEAK_L", "CLOUD_BREAK", "MAT_ROCK_GRAPHITE",
             x0=-1700, x1=-520, y0=1500, y1=2450, peak=1980, base_z=B,
             seed_offset=149, res=56, octaves=4, ridge_scale=1000, erosion=0.13,
             ridge_power=1.3, ridge_aniso=2.0),
        Mass("CLOUD_PEAK_R", "CLOUD_BREAK", "MAT_ROCK_GRAPHITE",
             x0=520, x1=1750, y0=1580, y1=2540, peak=2050, base_z=B,
             seed_offset=163, res=56, octaves=4, ridge_scale=1040, erosion=0.13,
             ridge_power=1.3, ridge_aniso=2.0),
        # The notch the route aims at. Also capped below EYE_Z — an earlier
        # version put this at 560 m of relief on the centreline at 1.4 km, and
        # it filled the exact middle of the frame with the one mass that had to
        # stay out of it. Low and far is what makes it read as a pass.
        Mass("CLOUD_PASS", "CLOUD_BREAK", "MAT_ROCK_GRAPHITE",
             x0=-1050, x1=1050, y0=2050, y1=3000, peak=395, base_z=B,
             seed_offset=181, res=48, octaves=3, ridge_scale=900, erosion=0.18,
             ridge_power=1.1, ridge_aniso=1.4),
    ]


def _mobile_mass(name, collection, material, f_inner, f_outer, y0, y1, peak,
                 seed_offset, res, f_inner_far=None, f_outer_far=None, **kw):
    """
    One mobile mass, authored in frame fractions rather than metres.

    `f_inner` and `f_outer` are signed fractions of the frame half-width, held
    constant down the mass's whole depth so its inner face keeps its place in the
    picture as it recedes. Negative is frame-left. The Mass constructor still
    wants a world-space footprint, so this converts once and the layout table
    below stays readable as composition.

    THE FRAME EDGE IS AT 1.0, AND THAT IS THE WHOLE BUDGET
    -----------------------------------------------------
    `f_outer` values of 2.6 to 3.3 are what the first mobile pass used, carried
    over from the desktop layout's habit of describing a mass by its full extent.
    On a landscape frame that is harmless. On a portrait one it is fatal, and not
    for the obvious reason that geometry outside the frame is wasted: it is fatal
    because `Mass.height` normalises everything to `u`, the position across the
    *footprint*. A mass spanning 0.70 to 3.30 puts its shoulders, its plateau and
    therefore its crest at 2.0-2.6 half-widths out — a full frame width past the
    edge of the picture. What reaches the screen is the inner 12% of the mass:
    the near-vertical inner face and nothing else, at whatever height the ridge
    happens to be, clipped top and bottom by the frame.

    That is what the accepted mobile GLB actually rendered — two full-height
    slabs at the frame edges with no crest, no skyline and no silhouette, which
    the world-space safe-zone audit could not see because every one of those
    slabs cleared the cone perfectly. Four masses (MNT_FOREGROUND_R,
    MNT_BACKGROUND_L, MNT_BACKGROUND_R and, at every station but one,
    MNT_MID_L_01) contributed zero pixels at zero stations.

    So mobile footprints are now 0.8-1.0 half-widths wide, placed to put the
    crest between 0.72 and 0.98 where the frame can hold it, with the outer
    shoulder falling away just past the edge. `analyse_mobile_composition` now
    asserts that every mass is visible somewhere, so this cannot regress
    silently.

    WHY THE INNER EDGE SWEEPS
    ------------------------
    `f_inner_far` and `f_outer_far` let a footprint hold a *different* screen
    fraction at its far end than at its near end, and every framing mass now
    uses them. Holding one fraction down the whole depth is what guarantees the
    cone is cleared at every depth — but it also projects the inner edge to an
    exactly vertical line, and a mass tall enough to matter on a portrait frame
    is 1.2 km of rise over ~30 m of run. The first version of this layout
    rendered as two grey pillars with razor-straight sides for precisely that
    reason: correct by every world-space measure and a ruled cliff in the
    picture.

    Sweeping the inner edge outward with depth turns that vertical into a
    diagonal — a wall receding up-valley rather than a shard standing on end —
    and the cone is still cleared, because the sweep only ever moves the edge
    *away* from the centre. `max_vertical_edge_run` measures what is left.
    """
    near = sorted((mobile_x(f_inner, y0), mobile_x(f_outer, y0)))
    far = sorted((mobile_x(f_inner if f_inner_far is None else f_inner_far, y1),
                  mobile_x(f_outer if f_outer_far is None else f_outer_far, y1)))

    kw.setdefault("shoulder_in", 0.20)
    # Stronger warp than the first mobile pass's 0.052/0.062, which was tuned
    # against a 0.055 inner shoulder and had to stay tiny to avoid eating it.
    # The inner shoulders are 0.26-0.30 now, so the footprint boundary can
    # wander properly — and on a frame where each flank is only 0.4 of a
    # half-width wide, an unwarped boundary is the difference between a mountain
    # and a flat panel with a straight edge.
    kw.setdefault("warp_u", 0.105)
    kw.setdefault("warp_v", 0.115)
    return Mass(name, collection, material,
                x0=near[0], x1=near[1], x0_far=far[0], x1_far=far[1],
                y0=y0, y1=y1, peak=peak, base_z=BURIED_BASE,
                seed_offset=seed_offset, res=res, **kw)


def mobile_masses():
    """
    The phone range — a separate composition, not the desktop one decimated.

    WHAT A PORTRAIT FRAME ACTUALLY GIVES YOU
    ----------------------------------------
    A 360x800 frame at the web camera's 32-degree vertical FOV is 14.7 degrees
    wide and 32 degrees tall. Horizontal room is the scarce resource and vertical
    room is abundant, which inverts every placement instinct the desktop layout
    was built on:

      * every framing mass has to live in the narrow band between the safe cone
        (0.605 of the half-width) and the frame edge, so depth cannot be read
        from lateral spread the way it is on desktop. It is read from silhouette
        height and overlap instead, and the layers therefore step *outward* with
        distance so each one clears the crest of the one in front;
      * the masses sit far closer to the centreline in world terms — inner faces
        at 60-350 m where desktop's are at 360-1400 — and correspondingly closer
        to the camera. That is the "front-biased" the brief asks for, and it is a
        placement change, not a scale change: heights, depths, count and layer
        order all move independently;
      * `shoulder_in` drops from the desktop default (0.72 x shoulder, ~0.16) to
        0.055. On desktop a soft valley-facing shoulder is a virtue; here it
        would put the first 16% of every mass's width below the skyline, which on
        a frame this narrow means the visible rock starts outside the frame edge
        and the mass is simply not in the picture.

    WHAT IS DELIBERATELY ASYMMETRIC
    -------------------------------
    Left and right are built from different logic rather than mirrored numbers.
    On the left the foreground is the innermost mass and the midground steps
    outside it; on the right that order is reversed, so MNT_MID_R_01 reads inside
    MNT_FOREGROUND_R and becomes the dominant right-hand form. The two sides also
    differ in depth onset, crest height and width, so no horizontal flip of the
    frame maps one onto the other.

    WHAT IS GONE
    ------------
    MNT_MID_L_02 / MNT_MID_R_02 stay dropped, now for a compositional reason
    rather than a triangle one: with every mass confined to the same narrow
    lateral band, a second midground layer sits directly behind the first and is
    entirely occluded. The names remain in the manifest so the web scene needs no
    per-device branch.
    """
    G, T = "MAT_ROCK_GRAPHITE", "MAT_ROCK_TITANIUM"

    return [
        # --- Near frame -------------------------------------------------------
        # The left mass is the anchor of the whole picture: closest, innermost,
        # steepest, and the only mass whose crest leaves the top of the frame at
        # the valley station. That is what makes the valley read as monumental
        # rather than as cropped scenery. It leaves the top over the outer part
        # of its span only — its inner face descends across a fifth of the
        # half-width and crosses the horizon well outside the protected disc, so
        # it frames the instrument instead of becoming a lid over it.
        _mobile_mass("MNT_FOREGROUND_L", "FOREGROUND", G,
                     f_inner=-0.61, f_inner_far=-0.73, f_outer=-1.46,
                     f_outer_far=-1.60, y0=430, y1=1320,
                     peak=1180, seed_offset=11, res=56, octaves=4,
                     ridge_scale=620, erosion=0.13, ridge_power=1.30,
                     ridge_aniso=2.2, shoulder=0.26, shoulder_in=0.30),
        # Right: later, lower, and with its crest *inside* the frame. The two
        # sides are built from different logic rather than mirrored numbers — a
        # wall that exits the picture on the left, a summit with sky over it on
        # the right — and that difference is what the silhouette-asymmetry
        # measurement is actually reading.
        _mobile_mass("MNT_FOREGROUND_R", "FOREGROUND", G,
                     f_inner=0.64, f_inner_far=0.77, f_outer=1.44,
                     f_outer_far=1.58, y0=760, y1=1720,
                     peak=1120, seed_offset=23, res=50, octaves=4,
                     ridge_scale=700, erosion=0.15, ridge_power=1.26,
                     ridge_aniso=2.0, shoulder=0.28, shoulder_in=0.28),

        # --- Midground: the scale jump, one layer a side ----------------------
        # Brought forward from the desktop layout's 950-1900 m, and on the right
        # placed *inside* MNT_FOREGROUND_R rather than outside it. That reversal
        # of layer order between the two sides is deliberate: on the left the
        # foreground is the innermost mass and the midground steps out behind it,
        # on the right the midground is the innermost and becomes the dominant
        # right-hand form. No horizontal flip maps one side onto the other.
        _mobile_mass("MNT_MID_R_01", "MIDGROUND", T,
                     f_inner=0.66, f_inner_far=0.78, f_outer=1.42,
                     f_outer_far=1.56, y0=1520, y1=2560,
                     peak=1560, seed_offset=53, res=46, octaves=4,
                     ridge_scale=860, erosion=0.18, ridge_power=1.24,
                     ridge_aniso=1.9, shoulder=0.26, shoulder_in=0.26),
        _mobile_mass("MNT_MID_L_01", "MIDGROUND", T,
                     f_inner=-0.69, f_inner_far=-0.82, f_outer=-1.58,
                     f_outer_far=-1.72, y0=1560, y1=2620,
                     peak=1290, seed_offset=37, res=44, octaves=4,
                     ridge_scale=900, erosion=0.19, ridge_power=1.22,
                     ridge_aniso=1.9, shoulder=0.26, shoulder_in=0.26),

        # --- Cloud-break peaks ------------------------------------------------
        # The summits the ascent passes at 12 000 m. Deep enough that the mobile
        # camera's 900 m of advance does not drive them off the sides, and the
        # tallest things in the scene at the approach station once the near
        # masses have dropped below the rising camera.
        _mobile_mass("CLOUD_PEAK_L", "CLOUD_BREAK", G,
                     f_inner=-0.62, f_inner_far=-0.74, f_outer=-1.28,
                     f_outer_far=-1.42, y0=2200, y1=3300,
                     peak=1680, seed_offset=149, res=44, octaves=4,
                     ridge_scale=780, erosion=0.12, ridge_power=1.34,
                     ridge_aniso=2.1, shoulder=0.26, shoulder_in=0.26),
        _mobile_mass("CLOUD_PEAK_R", "CLOUD_BREAK", G,
                     f_inner=0.65, f_inner_far=0.77, f_outer=1.34,
                     f_outer_far=1.48, y0=2000, y1=3150,
                     peak=1450, seed_offset=163, res=44, octaves=4,
                     ridge_scale=810, erosion=0.12, ridge_power=1.32,
                     ridge_aniso=2.1, shoulder=0.26, shoulder_in=0.26),

        # --- Background: the ridges that close the valley floor ----------------
        # Repositioned, not merely resized, and this is the clearest case of the
        # brief's "remove or reposition masses that only work in a wide landscape
        # viewport". As flanking masses they were unbuildable on a phone: the
        # usable band between the protected disc and the frame edge is 0.4 of a
        # half-width, the foreground, midground and cloud-break layers already
        # occupy it, and a fourth layer behind those three is occluded by all of
        # them. Making them tall enough to clear the cloud peaks would have put
        # the *most distant* masses highest in frame, which is backwards.
        #
        # So they stop being flanking masses. They are now the two ridges that
        # close the valley floor either side of CLOUD_PASS — rectangular, wide,
        # capped below EYE_Z, and past MOBILE_SAFE_ZONE_MAX_Y where the cone is
        # deliberately not enforced. They give the band under the horizon a third
        # depth layer between the pass and MNT_BACKGROUND_C instead of a flat
        # wash, and three octaves with a wide shoulder keeps them broad rather
        # than the thin distant ridges the brief rules out.
        Mass("MNT_BACKGROUND_L", "BACKGROUND", T,
             x0=-1500, x1=-90, y0=3700, y1=4900, peak=690, base_z=BURIED_BASE,
             seed_offset=97, res=34, octaves=3, ridge_scale=1150, erosion=0.28,
             ridge_power=1.10, ridge_aniso=1.5, shoulder=0.30,
             warp_u=0.052, warp_v=0.062),
        Mass("MNT_BACKGROUND_R", "BACKGROUND", T,
             x0=110, x1=1560, y0=3850, y1=5050, peak=740, base_z=BURIED_BASE,
             seed_offset=131, res=34, octaves=3, ridge_scale=1150, erosion=0.28,
             ridge_power=1.10, ridge_aniso=1.5, shoulder=0.30,
             warp_u=0.052, warp_v=0.062),

        # --- The two masses on the centreline ---------------------------------
        # Rectangular footprints, not splayed: these are not framing masses, they
        # are the things that close the middle of the picture, and they have to
        # span the whole frame width rather than hold a fraction of it. Both are
        # capped below EYE_Z so they read as ridges closing the valley floor
        # under the instrument, and both sit past MOBILE_SAFE_ZONE_MAX_Y where
        # the cone is deliberately not enforced. Without them the silhouette
        # diagnostic shows the world background straight through the middle of
        # the frame.
        Mass("CLOUD_PASS", "CLOUD_BREAK", G,
             x0=-560, x1=560, y0=2600, y1=3600, peak=400, base_z=BURIED_BASE,
             seed_offset=181, res=40, octaves=3, ridge_scale=760, erosion=0.18,
             ridge_power=1.08, ridge_aniso=1.4, shoulder=0.30,
             warp_u=0.052, warp_v=0.062),
        # Far deeper than the desktop's equivalent, and that depth is doing
        # specific work. A ground plane meets the horizon asymptotically, so the
        # band immediately under the horizon can only be closed by geometry, not
        # by a longer floor. This mass has to be tall enough to reach that band
        # and still finish below EYE_Z at the valley station — and the further
        # away it is, the smaller the angle its crest subtends below the horizon,
        # so distance is what buys the closure. At 5.2 km its 190 m of headroom
        # under EYE_Z is 0.012 of the half-height at the valley station; at the
        # desktop's 3.5 km the same cap would leave eight times that gap.
        Mass("MNT_BACKGROUND_C", "BACKGROUND", T,
             x0=-900, x1=900, y0=5200, y1=6600, peak=1110, base_z=BURIED_BASE,
             seed_offset=113, res=40, octaves=3, ridge_scale=1000, erosion=0.32,
             ridge_power=1.05, ridge_aniso=1.3, shoulder=0.34,
             warp_u=0.052, warp_v=0.062),
    ]


# ---------------------------------------------------------------------------
# Screen-space composition analysis
# ---------------------------------------------------------------------------
# WHY THERE IS A RASTERISER IN HERE
# ---------------------------------
# Every claim the brief asks the mobile pass to demonstrate — no geometry across
# the safe zone, no hole through the central frame, no hard horizontal steps, the
# two sides not artificially symmetrical, the pass still visible — is a statement
# about the *picture*, not about the mesh. A world-space vertex test cannot see
# any of them: a mass can clear the cone in world space and still be occluded, or
# be legal and still leave the frame empty.
#
# So the composition is checked by rendering it. This is a deterministic z-buffer
# over the same evaluated triangles the exporter writes, at every target aspect
# ratio and every camera station, and the numbers it produces are what the report
# quotes. It is pure Python and imports nothing, so it runs identically inside
# Blender and outside it.
#
# The camera model is exact rather than approximate: the QC camera is level and
# looks straight down +Y with no roll, so the projection is two divides and the
# horizon is exactly the middle row of the buffer. Nothing here needs a matrix.

RASTER_NEAR = 1.0
"""Near clip, in metres. Triangles with any vertex closer are skipped whole —
this costs a sliver of VALLEY_FLOOR at the camera plane, which is below the
bottom of the frame at every station anyway."""


def project(point, cam, tan_h: float, tan_v: float):
    """
    World point -> (f_x, f_y, depth).

    `f_x` and `f_y` are fractions of the frame's half-width and half-height, so
    the frame is exactly [-1, 1] on both axes and the numbers are readable as
    composition without knowing the resolution. None if behind the near plane.
    """
    d = point[1] - cam[1]
    if d <= RASTER_NEAR:
        return None
    return ((point[0] - cam[0]) / (tan_h * d),
            (point[2] - cam[2]) / (tan_v * d),
            d)


def rasterise(objects, cam, tan_h: float, tan_v: float, width: int, height: int):
    """
    Z-buffer the scene. `objects` is [(name, [(v0, v1, v2), ...])] in world space.

    Returns (ids, depth, names): `ids` holds the index into `names` of the
    front-most object at each pixel and -1 for sky; `depth` holds its distance.
    Row 0 is the top of the frame, and row `height // 2` straddles the horizon.

    Depth is interpolated as 1/d, which is linear in screen space for a planar
    triangle, so the visibility this produces is exact rather than approximate.
    """
    names = [n for n, _ in objects]
    n_px = width * height
    ids = [-1] * n_px
    inv_depth = [0.0] * n_px

    hw, hh = width * 0.5, height * 0.5

    for oid, (_, tris) in enumerate(objects):
        for tri in tris:
            p0 = project(tri[0], cam, tan_h, tan_v)
            if p0 is None:
                continue
            p1 = project(tri[1], cam, tan_h, tan_v)
            if p1 is None:
                continue
            p2 = project(tri[2], cam, tan_h, tan_v)
            if p2 is None:
                continue

            # Frame fractions -> pixel centres.
            x0 = (p0[0] + 1.0) * hw - 0.5
            y0 = (1.0 - p0[1]) * hh - 0.5
            x1 = (p1[0] + 1.0) * hw - 0.5
            y1 = (1.0 - p1[1]) * hh - 0.5
            x2 = (p2[0] + 1.0) * hw - 0.5
            y2 = (1.0 - p2[1]) * hh - 0.5

            area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
            if area == 0.0:
                continue
            inv_area = 1.0 / area

            lo_x = int(math.floor(min(x0, x1, x2)))
            hi_x = int(math.ceil(max(x0, x1, x2)))
            lo_y = int(math.floor(min(y0, y1, y2)))
            hi_y = int(math.ceil(max(y0, y1, y2)))
            if hi_x < 0 or lo_x >= width or hi_y < 0 or lo_y >= height:
                continue
            lo_x = max(lo_x, 0)
            hi_x = min(hi_x, width - 1)
            lo_y = max(lo_y, 0)
            hi_y = min(hi_y, height - 1)

            w0, w1, w2 = 1.0 / p0[2], 1.0 / p1[2], 1.0 / p2[2]

            for py in range(lo_y, hi_y + 1):
                row = py * width
                fy = float(py)
                for px in range(lo_x, hi_x + 1):
                    fx = float(px)
                    b0 = ((x1 - fx) * (y2 - fy) - (x2 - fx) * (y1 - fy)) * inv_area
                    if b0 < 0.0:
                        continue
                    b1 = ((x2 - fx) * (y0 - fy) - (x0 - fx) * (y2 - fy)) * inv_area
                    if b1 < 0.0:
                        continue
                    b2 = 1.0 - b0 - b1
                    if b2 < 0.0:
                        continue
                    w = b0 * w0 + b1 * w1 + b2 * w2
                    i = row + px
                    if w > inv_depth[i]:
                        inv_depth[i] = w
                        ids[i] = oid

    depth = [(1.0 / w if w > 0.0 else math.inf) for w in inv_depth]
    return ids, depth, names


def _frame_xy(px: int, py: int, width: int, height: int):
    """Pixel centre -> frame fractions."""
    return (2.0 * (px + 0.5) / width - 1.0, 1.0 - 2.0 * (py + 0.5) / height)


def analyse_frame(objects, cam, aspect: float, width: int = 336,
                  variant: str = "mobile") -> dict:
    """
    Rasterise one camera station at one aspect ratio and measure the composition.

    Every number returned answers one of the brief's silhouette-validation
    bullets, and each is expressed as a fraction of the frame so the three target
    viewports are directly comparable.
    """
    tan_v = MOBILE_TAN_V
    tan_h = tan_v * aspect
    height = int(round(width / aspect))

    ids, depth, names = rasterise(objects, cam, tan_h, tan_v, width, height)

    ground = {names.index(n) for n in EXEMPT_FROM_SAFE_ZONE if n in names}
    enforced_y = MOBILE_SAFE_ZONE_MAX_Y if variant == "mobile" else SAFE_ZONE_MAX_Y

    # The safe cone, projected. It is a circle in angle, so on a frame measured
    # in half-width and half-height fractions it is an ellipse — wide and short
    # in portrait, which is the whole reason the desktop layout does not survive
    # the rotation.
    fraction = MOBILE_SAFE_ZONE_FRACTION if variant == "mobile" else (
        SAFE_ZONE_SLOPE / (tan_v * aspect))
    ell_x = fraction
    ell_y = fraction * (tan_h / tan_v)

    violations = 0
    far_fill = 0
    ellipse_px = 0
    ellipse_sky = 0
    clearance = math.inf

    sky_above = 0
    above_total = 0

    # "No hole appears through the central frame."
    #
    # A hole is background with geometry *above* it in the same column — you are
    # seeing through the composition. That is a different thing from the pale
    # band that always sits between a distant ridge and the horizon, which has
    # only sky above it and reads as haze. The distinction matters: measured as
    # "any background below the horizon", the accepted desktop range scores 0.29
    # of the half-height at the valley station and 0.53 at the cloud approach, so
    # a threshold on that number would fail the composition this one is being
    # held to.
    #
    # `pierced_px` is the honest metric and it should be zero. `haze_band` is
    # reported next to it as context, unbudgeted, because it is a legitimate
    # feature of both compositions rather than a defect in either.
    pierced_px = 0
    central_below_px = 0
    haze_band = 0.0

    per_object = {}
    top_row = [None] * width
    mass_columns = 0

    for py in range(height):
        row = py * width
        for px in range(width):
            i = row + px
            fx, fy = _frame_xy(px, py, width, height)
            oid = ids[i]
            is_mass = oid >= 0 and oid not in ground

            if fy > 0.0:
                above_total += 1
                if oid < 0:
                    sky_above += 1
            elif abs(fx) <= ell_x:
                central_below_px += 1
                if oid < 0:
                    haze_band = max(haze_band, -fy)

            # Scanning top-down, so `top_row[px]` is already set if this column
            # has mountain above the current row.
            if oid < 0 and top_row[px] is not None:
                pierced_px += 1

            r = math.hypot(fx / ell_x, fy / ell_y)
            if r <= 1.0:
                ellipse_px += 1
                if oid < 0:
                    ellipse_sky += 1
                elif is_mass:
                    if depth[i] <= enforced_y - cam[1]:
                        violations += 1
                    else:
                        far_fill += 1

            if oid >= 0:
                # Every visible object, ground included. `top_row`, the flat-run
                # test and the symmetry test all stay mass-only — but the
                # visibility census has to count the floor and the route or it
                # reports the two objects that fill the bottom of every frame as
                # absent from the composition.
                per_object[names[oid]] = per_object.get(names[oid], 0) + 1

            if is_mass:
                # Radial clearance outside the ellipse, converted back to
                # half-width fractions so it reads as a distance on screen.
                #
                # Only geometry inside the enforced depth counts. Past the
                # truncation the background is *supposed* to fill the disc —
                # that is what closes the valley behind the instrument, and it is
                # measured separately as `safe_zone_far_fill_px`. Folding it into
                # the clearance would report the composition's most deliberate
                # feature as its worst violation.
                if depth[i] <= enforced_y - cam[1]:
                    clearance = min(clearance, (r - 1.0) * ell_x)
                if top_row[px] is None:
                    top_row[px] = py

    top_touch = 0
    for px in range(width):
        if top_row[px] is not None:
            mass_columns += 1
            if top_row[px] == 0:
                top_touch += 1

    # "Stronger, simpler mountain silhouettes", made measurable.
    #
    # A mass whose crest leaves the top of the frame has no silhouette in the
    # picture at all — it is a panel with two vertical sides, and on a portrait
    # frame where each flank is only 0.4 of a half-width wide that is exactly
    # what the eye reads. One mass running off the top is a deliberate anchor;
    # every flank doing it at every station is the composition failing to
    # resolve. Measured against the columns that have mountain, not against the
    # whole frame, because the frame is mostly sky by design.
    top_touch_fraction = (top_touch / mass_columns) if mass_columns else 0.0

    # --- hard horizontal steps --------------------------------------------
    # A run of columns whose silhouette sits at exactly the same row. Columns
    # where the mass leaves the top of the frame are excluded: that is a crest
    # exiting the picture, not a step across it.
    max_flat = 0
    run = 0
    prev = None
    for px in range(width):
        t = top_row[px]
        if t is None or t == 0:
            run, prev = 0, None
            continue
        if t == prev:
            run += 1
            max_flat = max(max_flat, run + 1)
        else:
            run = 0
        prev = t

    # --- ruled vertical edges ----------------------------------------------
    # The transpose of the flat-run test above, and it exists because the flat
    # run cannot see the failure that actually shipped.
    #
    # A mobile footprint holds a constant *screen* fraction as it recedes — that
    # is the trick that lets a mass be 1.2 km deep and still clear the protected
    # cone at every depth. Its side effect is that the mass's inner edge projects
    # to a perfectly straight vertical line, and because a portrait frame at 1 km
    # is only 270 m wide against 600 m tall, a mass tall enough to matter is
    # geometrically a shard: 1.2 km of rise over 30 m of run. Rendered, that is
    # not a mountain, it is a ruled cliff standing on end — the brief's
    # "mountain footprints do not resemble ruled cliffs", failing in the axis
    # nobody thought to measure.
    #
    # Measured as the longest run of consecutive rows whose frame-edge rock
    # boundary sits in exactly the same column, as a fraction of frame height.
    def _edge_run(from_left: bool) -> int:
        worst = run = 0
        prev = None
        for py in range(height):
            row = py * width
            col = 0
            rng = range(width) if from_left else range(width - 1, -1, -1)
            for px in rng:
                oid = ids[row + px]
                if oid < 0 or oid in ground:
                    break
                col += 1
            if col == 0 or col >= width:
                run, prev = 0, None
                continue
            if col == prev:
                run += 1
                worst = max(worst, run + 1)
            else:
                run = 0
            prev = col
        return worst

    max_vertical_edge = max(_edge_run(True), _edge_run(False))

    # --- left / right symmetry ---------------------------------------------
    # Compare the skyline against its own mirror. "The left and right masses are
    # not artificially symmetrical" is a statement about the framing masses, so
    # the comparison is restricted to the skyline *above the horizon*: a column
    # whose only mountain is the far range closing the valley floor contributes
    # the horizon itself rather than a number that dilutes the measurement
    # towards zero. Everything below the horizon is the valley, and the valley is
    # symmetrical on purpose.
    #
    # TWO NUMBERS, BECAUSE THE FIRST ONE MEASURES TWO THINGS AT ONCE
    # --------------------------------------------------------------
    # `silhouette_asymmetry` averages the mirrored difference over the whole
    # half-width, so it falls when the two sides differ *less* and also when
    # there is simply less skyline to differ — at the cloud-approach station only
    # about a tenth of the columns carry anything above the horizon, so a frame
    # where one side is a mountain and the other is open sky, which is as
    # asymmetric as a composition can get, still scores near zero. That conflates
    # asymmetry with skyline coverage, and coverage is already reported
    # separately as `mountain_column_fraction`.
    #
    # `skyline_asymmetry` averages over only the mirrored column pairs where at
    # least one side has skyline above the horizon, which is the quantity the
    # brief's "the left and right masses are not artificially symmetrical"
    # actually names. A mirrored layout scores ~0 on it by construction at every
    # station, whatever its coverage. Both are reported; the threshold is on the
    # second.
    horizon = height * 0.5
    skyline = [(t if (t is not None and t < horizon) else horizon) for t in top_row]
    half = width // 2
    diffs = [abs(skyline[px] - skyline[width - 1 - px]) / horizon for px in range(half)]
    asymmetry = sum(diffs) / len(diffs) if diffs else 0.0

    carried = [px for px in range(half)
               if skyline[px] < horizon or skyline[width - 1 - px] < horizon]
    skyline_asymmetry = (sum(diffs[px] for px in carried) / len(carried)) if carried else 0.0

    return {
        "aspect": round(aspect, 4),
        "resolution": [width, height],
        "camera": [round(c, 1) for c in cam],
        "safe_zone_ellipse": [round(ell_x, 4), round(ell_y, 4)],
        "safe_zone_violation_px": violations,
        "safe_zone_far_fill_px": far_fill,
        "safe_zone_sky_fraction": round(ellipse_sky / ellipse_px, 4) if ellipse_px else 0.0,
        "safe_zone_clearance": (round(clearance, 4) if math.isfinite(clearance) else None),
        "pierced_px": pierced_px,
        "haze_band": round(haze_band, 4),
        "sky_fraction_above_horizon": round(sky_above / above_total, 4) if above_total else 0.0,
        "mountain_column_fraction": round(mass_columns / width, 4),
        "frame_top_touch_fraction": round(top_touch_fraction, 4),
        "max_flat_silhouette_run": round(max_flat / width, 4),
        "max_vertical_edge_run": round(max_vertical_edge / height, 4),
        "silhouette_asymmetry": round(asymmetry, 4),
        "skyline_asymmetry": round(skyline_asymmetry, 4),
        "skyline_column_fraction": round(len(carried) / half, 4) if half else 0.0,
        "visible_objects": dict(sorted(per_object.items())),
    }
