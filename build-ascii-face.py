# /// script
# requires-python = ">=3.10,<3.12"
# dependencies = [
#   "mediapipe>=0.10,<0.11",
#   "numpy<2",
#   "pillow",
#   "imageio",
#   "imageio-ffmpeg",
# ]
# ///
"""ASCII face pipeline.

Turns a head-turn video into js/ascii-face-data.js: ~33 frames of ASCII art
selected evenly by head yaw, plus per-frame eye boxes so the runtime can
composite cursor-tracking pupils. Run with uv (it installs everything):

    uv run build-ascii-face.py ~/Downloads/head-turn.MOV

Extras:
    uv run build-ascii-face.py --still ~/Downloads/Regularface.JPG   # tune likeness on one photo
    uv run build-ascii-face.py --calibrate                           # print ink-sorted glyph ramp
    uv run build-ascii-face.py --encode-intro IN.mp4 OUT.mp4         # splash video re-encode

Outputs: js/ascii-face-data.js (committed), ~/Downloads/ascii-preview.html
(tuning page, throwaway), ~/Downloads/ascii-contact-sheet.png (crop check).
"""

import argparse
import json
import math
import os
import subprocess
import sys
from pathlib import Path

# ---------------------------------------------------------------- constants

COLS = 100                 # the one big likeness lever; everything derives from it
CROP_ASPECT = 0.8          # head crop width / height
CHAR_ASPECT = 0.5          # monospace cell width / height at font 8px / line 9.6px
ROWS = round(COLS / CROP_ASPECT * CHAR_ASPECT)   # 62 at the defaults

# The head orients toward the cursor on BOTH axes: cursor X picks a yaw
# column, cursor Y picks a pitch row. Frames form a yaw × pitch grid.
# Grid cells may SHARE a source frame where the clip's coverage is thin
# (the emitted `cells` array maps grid position → unique frame) — reusing
# the nearest real frame beats glitching to a wrong pose.
YAW_COLS = 25
PITCH_ROWS = 13            # auto-collapses to 1 when the clip has no tilt sweep
TARGET_GAMMA = 1.2         # >1 → grid targets denser near the anchors (center
                           # of screen), coarser at the extremes the cursor
                           # rarely visits
PITCH_WEIGHT = 2.5         # pitch accuracy matters more than yaw accuracy in
                           # cell picks: an off-tilt frame reads as the head
                           # glancing up/down mid-row; an off-turn frame at
                           # the extremes is invisible
ROW_PITCH_CAP = 0.12       # max in-row pitch deviation from the row target,
                           # as a fraction of the pitch range — beyond it the
                           # cell is re-picked within the band (or held)
SCALE_TOL = 0.15           # drop detections whose face size deviates by more
                           # than this from the median of frames at SIMILAR
                           # TILT — pitch-banded, so tilt compression (~15%)
                           # doesn't register, but genuine distance drift
                           # (head renders smaller in the fixed window) does
EDGE_TRIM = 0.02           # fraction of the clip dropped at each end — where
                           # walking to/from the camera lives
MIN_PITCH_SPAN = 0.12      # observed pitch range needed to keep multiple rows
                           # (chin↔forehead units): incidental head-bob is
                           # ~0.07, a deliberate tilt sweep is ~0.2+
YAW_PCT = (5, 95)          # usable slice of observed yaw/pitch
READ_MAX_H = 960           # downscale frames on read; ASCII sampling needs far less

# Dark → bright. Ink-sorted for Menlo via --calibrate. Never < > & (raw HTML fallback).
RAMP = " `'.-~ri*1IZUO8MB"
GAMMA = 0.92
NECK_DAMP = 0.65           # brightness compression for skin OUTSIDE the face
                           # box (neck, ears): in overhead light the neck can
                           # out-glow the face — a portrait wants the face
                           # brightest, so everything else gets dodged down
NORM_PCT = (5, 90)         # pooled FACE-luminance percentiles → the main tone band.
                           # Upper bound deliberately low: tilted-head frames catch
                           # the ceiling light and would otherwise own the bright
                           # end, leaving the level-gaze face dim.
# The face gets [LOW_TOP..1] of the ramp; everything on the person darker than
# the face floor (hair, dark clothing) gets [LOW_BOTTOM..LOW_TOP] so it stays
# visible as a faint textured mass instead of vanishing into the background.
LOW_BOTTOM, LOW_TOP = 0.06, 0.18
HYSTERESIS = 0.6           # quantization steps; kills glyph shimmer between frames
DITHER = 0.3               # 0..~0.5 quantization steps of ordered Bayer 4x4 dither.
                           # Deterministic per cell → frame-stable. Adds tonal depth
                           # if 17 ramp levels band; try 0.35 in the preview loop.
BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]
EDGE_PCT = 88              # pooled Sobel magnitude percentile → edge threshold
EDGE_LUM = (0.08, 0.75)    # edges only matter in dim/flat zones, not highlights

EYE_MIN_W = 3              # cells; narrower → eye marked invisible (profile views)
EYE_MIN_RATIO = 0.20       # eye width / inter-ocular distance; frontal ≈ 0.30,
                           # drops as the far eye foreshortens at strong yaw

# FaceMesh landmark ids (refine_landmarks=True → 478 points incl. iris)
LM_NOSE, LM_CHIN, LM_FOREHEAD = 1, 152, 10
RIGHT_EYE = dict(outer=33, inner=133, top=159, bottom=145, iris=468)   # subject's right
LEFT_EYE = dict(outer=263, inner=362, top=386, bottom=374, iris=473)   # subject's left

HERE = Path(__file__).resolve().parent
DOWNLOADS = Path.home() / "Downloads"
DATA_OUT = HERE / "js" / "ascii-face-data.js"
PREVIEW_OUT = DOWNLOADS / "ascii-preview.html"
SHEET_OUT = DOWNLOADS / "ascii-contact-sheet.png"
SIZE_BUDGET = 1_500_000    # bytes, raw ascii-face-data.js (gzip is what ships)
GZIP_BUDGET = 340_000      # bytes gzipped — what actually crosses the wire

# mediapipe ≥0.10.20 dropped the bundled legacy "solutions" API, so the task
# model files are fetched once into this gitignored cache.
MODEL_DIR = HERE / ".ascii-models"
MODELS = {
    "face_landmarker.task":
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
        "face_landmarker/float16/1/face_landmarker.task",
    "selfie_segmenter.tflite":
        "https://storage.googleapis.com/mediapipe-models/image_segmenter/"
        "selfie_segmenter/float16/latest/selfie_segmenter.tflite",
}


def model_path(name):
    import urllib.request

    MODEL_DIR.mkdir(exist_ok=True)
    path = MODEL_DIR / name
    if not path.exists():
        print(f"downloading {name} ...")
        urllib.request.urlretrieve(MODELS[name], path)
    return path


_LANDMARKER = None
_SEGMENTER = None


def get_landmarker():
    global _LANDMARKER
    if _LANDMARKER is None:
        from mediapipe.tasks import python as mp_tasks
        from mediapipe.tasks.python import vision

        _LANDMARKER = vision.FaceLandmarker.create_from_options(
            vision.FaceLandmarkerOptions(
                base_options=mp_tasks.BaseOptions(
                    model_asset_path=str(model_path("face_landmarker.task"))),
                num_faces=1,
                min_face_detection_confidence=0.5,
            )
        )
    return _LANDMARKER


def get_segmenter():
    global _SEGMENTER
    if _SEGMENTER is None:
        from mediapipe.tasks import python as mp_tasks
        from mediapipe.tasks.python import vision

        _SEGMENTER = vision.ImageSegmenter.create_from_options(
            vision.ImageSegmenterOptions(
                base_options=mp_tasks.BaseOptions(
                    model_asset_path=str(model_path("selfie_segmenter.tflite"))),
                output_confidence_masks=True,
            )
        )
    return _SEGMENTER


def to_mp_image(frame):
    import mediapipe as mp
    import numpy as np

    return mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(frame))

# ---------------------------------------------------------------- video + detection


def iter_video(path):
    """Yield RGB numpy frames downscaled to READ_MAX_H."""
    import imageio
    import numpy as np
    from PIL import Image

    reader = imageio.get_reader(str(path))
    for frame in reader:
        h, w = frame.shape[:2]
        if h > READ_MAX_H:
            nw = round(w * READ_MAX_H / h)
            frame = np.asarray(Image.fromarray(frame).resize((nw, READ_MAX_H), Image.LANCZOS))
        yield frame
    reader.close()


def detect_landmarks(frame):
    """Landmarks in pixel coords, or None. The landmarker's built-in detector
    is short-range (selfie framing); when the face is small in a wide shot we
    find the person with the segmenter, crop the head region, and retry."""
    res = get_landmarker().detect(to_mp_image(frame))
    if res.face_landmarks:
        h, w = frame.shape[:2]
        return landmarks_to_px(res.face_landmarks[0], w, h)
    return detect_via_person_crop(frame)


def detect_via_person_crop(frame):
    import numpy as np

    h, w = frame.shape[:2]
    mask = np.squeeze(
        get_segmenter().segment(to_mp_image(frame)).confidence_masks[-1].numpy_view()
    ).astype(np.float64)
    # Polarity: the person almost never covers all four corners.
    corners = np.mean([mask[:20, :20].mean(), mask[:20, -20:].mean(),
                       mask[-20:, :20].mean(), mask[-20:, -20:].mean()])
    if corners > 0.5:
        mask = 1.0 - mask
    ys, xs = np.nonzero(mask > 0.5)
    if len(ys) < 500:
        return None
    by0, by1, bx0, bx1 = ys.min(), ys.max(), xs.min(), xs.max()
    bh = by1 - by0
    # Head x-center: mean x of person pixels in the top 15% of the person blob.
    top = ys < by0 + max(1, int(0.15 * bh))
    cx = int(xs[top].mean()) if top.any() else (bx0 + bx1) // 2
    side = max(64, int(0.55 * bh))
    x0 = max(0, cx - side // 2)
    y0 = max(0, by0 - int(0.08 * bh))
    crop = frame[y0:y0 + side, x0:x0 + side]
    if crop.size == 0:
        return None
    res = get_landmarker().detect(to_mp_image(crop))
    if not res.face_landmarks:
        return None
    pts = landmarks_to_px(res.face_landmarks[0], crop.shape[1], crop.shape[0])
    pts[:, 0] += x0
    pts[:, 1] += y0
    return pts


def detect_all(path):
    """Pass 1: landmarks for every frame (pixel coords). Frames are not kept.
    Detection dominates runtime (~minutes on a long 4K clip), so results are
    cached per (video path, mtime) — tone-mapping retunes then skip pass 1."""
    import numpy as np

    src = Path(path)
    MODEL_DIR.mkdir(exist_ok=True)
    cache = MODEL_DIR / f"detections-{src.name}-{int(src.stat().st_mtime)}-s3000.npz"
    if cache.exists():
        z = np.load(cache)
        results = [(int(i), p) for i, p in zip(z["idx"], z["pts"])]
        print(f"  (landmarks loaded from cache: {cache.name})")
        return results, int(z["total"])

    # Long clips: sample every Nth frame — ~2000 pose samples is far more
    # than the grid needs, and detection dominates runtime.
    import imageio
    r = imageio.get_reader(str(path))
    meta = r.get_meta_data()
    r.close()
    est = int(meta.get("fps", 30) * meta.get("duration", 0)) or 1
    stride = max(1, -(-est // 3000))
    if stride > 1:
        print(f"  ~{est} frames — detecting every {stride}. frame")

    results = []   # (frame_index, ndarray (478, 2))
    total = 0
    for i, frame in enumerate(iter_video(path)):
        total += 1
        if i % stride:
            continue
        pts = detect_landmarks(frame)
        if pts is not None:
            results.append((i, pts))
    np.savez_compressed(cache, idx=np.array([i for i, _ in results]),
                        pts=np.array([p for _, p in results]), total=total)
    return results, total


def landmarks_to_px(landmark_list, w, h):
    import numpy as np
    return np.array([(lm.x * w, lm.y * h) for lm in landmark_list])


def yaw_score(pts):
    """Monotonic yaw proxy: nose offset from the eye midpoint, in inter-ocular units.
    Negative → head facing viewer-left. We only need ordering, not degrees."""
    l_outer, r_outer = pts[LEFT_EYE["outer"]], pts[RIGHT_EYE["outer"]]
    iod = math.hypot(*(l_outer - r_outer))
    mid_x = (l_outer[0] + r_outer[0]) / 2
    return (pts[LM_NOSE][0] - mid_x) / max(iod, 1e-6)


def pitch_score(pts):
    """Same idea vertically: nose drop below the eye line. Smaller → chin up;
    larger → looking down. Image y grows down, so ascending pitch rows read
    top-of-screen → bottom-of-screen. Normalized by the chin↔forehead length,
    NOT the inter-ocular distance: eye spacing foreshortens as the head
    TURNS, which would make measured pitch depend on yaw (turned-down poses
    then measure differently than frontal-down poses at the same tilt and
    the bottom grid rows grab turned frames for their center columns)."""
    l_outer, r_outer = pts[LEFT_EYE["outer"]], pts[RIGHT_EYE["outer"]]
    mid_y = (l_outer[1] + r_outer[1]) / 2
    face_len = math.hypot(*(pts[LM_CHIN] - pts[LM_FOREHEAD]))
    return (pts[LM_NOSE][1] - mid_y) / max(face_len, 1e-6)


def drop_pose_outliers(detections, tol=0.15):
    """Two filters. (1) Scale: frames where the face is notably smaller or
    larger than the clip median are him walking to/from the camera — with a
    fixed crop window they'd render as a shrunken head. (2) Continuity: the
    motion is smooth in time, so a detection that jumps away from its
    time-neighbors' median pose is a bad landmark fit."""
    import numpy as np

    if len(detections) < 7:
        return detections

    face_lens = np.array([math.hypot(*(p[LM_CHIN] - p[LM_FOREHEAD]))
                          for _, p in detections])
    pitches0 = np.array([pitch_score(p) for _, p in detections])
    # Compare each frame's face size against frames at SIMILAR TILT (quantile
    # bands), so tilt compression doesn't register but distance drift does.
    order = np.argsort(pitches0)
    residual = np.empty(len(detections))
    for band in np.array_split(order, 9):
        if len(band):
            residual[band] = face_lens[band] / np.median(face_lens[band])
    scaled = [d for d, res in zip(detections, residual)
              if abs(res - 1) <= SCALE_TOL]
    if len(scaled) < len(detections):
        print(f"  dropped {len(detections) - len(scaled)} off-scale detections "
              f"(distance drift within their tilt band)")
    detections = scaled

    yaws = np.array([yaw_score(p) for _, p in detections])
    pitches = np.array([pitch_score(p) for _, p in detections])
    keep = []
    for k in range(len(yaws)):
        s, e = max(0, k - 2), min(len(yaws), k + 3)
        if (abs(yaws[k] - np.median(yaws[s:e])) <= tol
                and abs(pitches[k] - np.median(pitches[s:e])) <= tol):
            keep.append(detections[k])
    if len(keep) < len(detections):
        print(f"  dropped {len(detections) - len(keep)} pose-outlier detections")
    return keep


def detrended_pitches(detections):
    """Measured pitch couples slightly with yaw at the turn extremes (the
    nose swings sideways, changing its projected drop below the eye line) —
    on the page it read as the gaze drifting UP at the far left/right of a
    level row. The clip's sweep structure lets us estimate the coupling:
    a rolling median over time tracks each constant-tilt band, the residual
    against it isolates within-band deviation, and its trend against yaw²
    is the coupling — which we subtract."""
    import numpy as np

    yaws = np.array([yaw_score(p) for _, p in detections])
    pitches = np.array([pitch_score(p) for _, p in detections])
    if len(pitches) < 60:
        return pitches
    b = yaw_coupling(yaws, pitches)
    print(f"  pitch–yaw coupling removed (b={b:+.4f})")
    x = yaws ** 2
    return pitches - b * (x - np.median(x))


def yaw_coupling(yaws, values):
    """Slope of `values` against yaw², measured on residuals from a rolling
    median over time (which tracks the clip's constant-tilt sweep bands)."""
    import numpy as np

    k = 51
    pad = k // 2
    padded = np.pad(values, pad, mode="edge")
    roll = np.array([np.median(padded[i:i + k]) for i in range(len(values))])
    return float(np.polyfit(yaws ** 2, values - roll, 1)[0])


def yaw_curve(yaws, values, bins=7):
    """Non-parametric version of yaw_coupling: binned median residual as a
    piecewise-linear function of yaw². A fitted parabola is dominated by the
    mid-range mass and under-corrects the tails — which read as the window
    zooming in at the extreme turn angles."""
    import numpy as np

    k = 51
    pad = k // 2
    padded = np.pad(values, pad, mode="edge")
    roll = np.array([np.median(padded[i:i + k]) for i in range(len(values))])
    resid = values - roll
    x = yaws ** 2
    xs, ys = [], []
    for band in np.array_split(np.argsort(x), bins):
        if len(band):
            xs.append(float(np.median(x[band])))
            ys.append(float(np.median(resid[band])))
    return xs, ys


def level_pitch(pitches):
    """The 'looking straight at the camera' tilt. The lawnmower clip has
    three sweep bands (up / level / down), so a 1-D 3-means lands its middle
    centroid on the level band. Falls back gracefully on unimodal clips."""
    import numpy as np

    p = np.sort(np.asarray(pitches, dtype=float))
    c = np.percentile(p, [10, 50, 90]).astype(float)
    for _ in range(25):
        assign = np.abs(p[:, None] - c[None, :]).argmin(axis=1)
        for j in range(3):
            if (assign == j).any():
                c[j] = p[assign == j].mean()
    return float(c[1])


def select_frames(detections):
    """Fill a yaw × pitch grid: for each cell pick the nearest detection in
    normalized pose space. Cells may share frames (thin coverage → reuse the
    nearest real pose). Pitch rows are anchored so the MIDDLE row is the
    level 'looking at the camera' tilt — a linear cursor-Y mapping then aims
    true instead of at the mere midpoint of the clip's pitch range.
    Returns rows of (frame_index, pts, yaw, pitch), pitch ascending."""
    import numpy as np

    detections = drop_pose_outliers(detections)
    yaws = np.array([yaw_score(p) for _, p in detections])
    pitches = detrended_pitches(detections)

    ylo, yhi = np.percentile(yaws, YAW_PCT)
    plo, phi = np.percentile(pitches, YAW_PCT)
    rows = PITCH_ROWS if (phi - plo) >= MIN_PITCH_SPAN else 1
    # A single-row (yaw-only) clip can afford a much finer turn.
    cols = YAW_COLS if rows > 1 else 33
    if rows == 1:
        print(f"  pitch span {phi - plo:.3f} < {MIN_PITCH_SPAN} — single-row grid")
        pitch_targets = [np.median(pitches)]
    else:
        level = level_pitch(pitches)
        level = min(max(level, plo + 0.05 * (phi - plo)), phi - 0.05 * (phi - plo))
        print(f"  level pitch anchor: {level:+.3f} (range {plo:+.3f} … {phi:+.3f})")
        pitch_targets = anchored_targets(plo, level, phi, rows)
    # Yaw 0 = nose dead-center = facing the camera. Anchor it to the CENTER
    # column. Each row's turn range compresses to what ITS OWN tilt band
    # actually covers in the clip — at the deepest tilt the sweeps don't
    # reach the far turns, and stretching those rows to the global range
    # borrowed shallower-tilt frames at the edges (the head visibly gazed
    # UP while the cursor moved along the bottom). Wrong tilt is worse
    # than saturated turn.
    ylo, yhi = min(ylo, -0.02), max(yhi, 0.02)
    yspan = max(yhi - ylo, 1e-6)
    pspan = max(phi - plo, 1e-6)
    band_w = 1.5 * (pspan / max(rows - 1, 1))
    yaw_targets_rows = []
    for tp in pitch_targets:
        band = np.abs(pitches - tp) <= band_w
        if rows > 1 and band.sum() >= 30:
            ylo_r, yhi_r = np.percentile(yaws[band], (2, 98))
            ylo_r, yhi_r = min(ylo_r, -0.02), max(yhi_r, 0.02)
        else:
            ylo_r, yhi_r = ylo, yhi
        yaw_targets_rows.append(anchored_targets(ylo_r, 0.0, yhi_r, cols))

    grid = []
    for r_i, tp in enumerate(pitch_targets):
        row = []
        for ty in yaw_targets_rows[r_i]:
            d = ((yaws - ty) / yspan) ** 2
            if rows > 1:
                d = d + (PITCH_WEIGHT * (pitches - tp) / pspan) ** 2
            k = int(np.argmin(d))
            row.append((detections[k][0], detections[k][1],
                        float(yaws[k]), float(pitches[k])))
        grid.append(row)

    # In-row tilt discipline: walking outward from the anchored center
    # column, every cell must stay within the row's tilt band AND keep the
    # turn progressing. A violating cell is RE-PICKED from frames satisfying
    # both constraints (nearest yaw to target); only if none exist does it
    # hold its inner neighbor — a plain hold created dead steps followed by
    # jumps ("cursor moves right, face doesn't turn, then snaps").
    if rows > 1:
        cap = ROW_PITCH_CAP * pspan
        mid = cols // 2

        def repick(tp, ty, cap_val, lo_yaw=None, hi_yaw=None):
            elig = np.abs(pitches - tp) <= cap_val
            if lo_yaw is not None:
                elig &= yaws >= lo_yaw - 1e-9
            if hi_yaw is not None:
                elig &= yaws <= hi_yaw + 1e-9
            if not elig.any():
                return None
            k = int(np.argmin(np.where(elig, np.abs(yaws - ty), np.inf)))
            return (detections[k][0], detections[k][1],
                    float(yaws[k]), float(pitches[k]))

        # The tilt band per cell is GRADED: tight near the center columns
        # (coverage is rich there, and any wobble reads as the face bobbing
        # while the cursor moves horizontally), looser toward the edges.
        def cap_at(c):
            return cap * (0.5 + abs(c - mid) / mid)

        STEP = 0.04   # minimum visible yaw progression per cell

        def row_discipline():
            for r_i, tp in enumerate(pitch_targets):
                row = grid[r_i]
                for c in range(mid + 1, cols):
                    cc = cap_at(c)
                    if abs(row[c][3] - tp) > cc or row[c][2] < row[c - 1][2]:
                        row[c] = repick(tp, yaw_targets_rows[r_i][c], cc, lo_yaw=row[c - 1][2]) \
                            or row[c - 1]
                    if row[c][2] - row[c - 1][2] < STEP:
                        # dead step: trade tilt honesty for a visible turn
                        alt = repick(tp, yaw_targets_rows[r_i][c], cc * 1.6,
                                     lo_yaw=row[c - 1][2] + STEP)
                        if alt and abs(alt[2] - yaw_targets_rows[r_i][c]) < abs(row[c][2] - yaw_targets_rows[r_i][c]):
                            row[c] = alt
                for c in range(mid - 1, -1, -1):
                    cc = cap_at(c)
                    if abs(row[c][3] - tp) > cc or row[c][2] > row[c + 1][2]:
                        row[c] = repick(tp, yaw_targets_rows[r_i][c], cc, hi_yaw=row[c + 1][2]) \
                            or row[c + 1]
                    if row[c + 1][2] - row[c][2] < STEP:
                        alt = repick(tp, yaw_targets_rows[r_i][c], cc * 1.6,
                                     hi_yaw=row[c + 1][2] - STEP)
                        if alt and abs(alt[2] - yaw_targets_rows[r_i][c]) < abs(row[c][2] - yaw_targets_rows[r_i][c]):
                            row[c] = alt
    else:
        def row_discipline():
            pass

    # Cells FOLLOW TARGET ORDER (cursor position maps to intended pose) —
    # never re-sorted by measured pose. The two disciplines interact (the
    # column-pitch pass can push a cell off its row's tilt band), so they
    # run INTERLEAVED over two rounds, ending with the ordering passes that
    # the assertions guarantee. Duplicates are fine — the cells indirection
    # dedupes them in the payload.
    def ordering_passes():
        for _ in range(6):
            changed = False
            for r in range(len(grid)):
                for c in range(1, cols):
                    if grid[r][c][2] < grid[r][c - 1][2]:
                        grid[r][c] = grid[r][c - 1]
                        changed = True
            for c in range(cols):
                for r in range(1, len(grid)):
                    if grid[r][c][3] < grid[r - 1][c][3]:
                        grid[r][c] = grid[r - 1][c]
                        changed = True
            if not changed:
                break

    for _ in range(2):
        row_discipline()
        ordering_passes()
    return grid, yaw_targets_rows, pitch_targets


def anchored_targets(lo, anchor, hi, n, gamma=TARGET_GAMMA):
    """n odd. The anchor sits at the middle index; steps are denser near the
    anchor (screen center, where the cursor lives) and coarser at extremes."""
    import numpy as np

    half = n // 2
    t = np.linspace(0.0, 1.0, half + 1) ** gamma
    left = anchor - t[::-1] * (anchor - lo)
    right = anchor + t[1:] * (hi - anchor)
    return np.concatenate([left, right])


def global_head_box(items):
    """ONE fixed crop window that contains the entire head — hair, ears,
    chin — in every frame. The camera is static, so the head simply moves
    inside a still portrait window instead of being re-framed per frame
    (and nothing ever gets cut off at the edges).

    items: list of (mask, pts). Head bounds come from the person mask above
    chin level (the mask sees hair, which face landmarks don't), with
    percentile bounds so segmentation speckle can't inflate the box."""
    import numpy as np

    x0s, x1s, y0s, y1s = [], [], [], []
    for mask, pts in items:
        chin, forehead = pts[LM_CHIN], pts[LM_FOREHEAD]
        seg = math.hypot(chin[0] - forehead[0], chin[1] - forehead[1])
        bottom = int(min(mask.shape[0], chin[1] + 0.10 * seg))
        ys, xs = np.nonzero(mask[:bottom, :] > 0.5)
        if len(xs) < 100:
            continue
        x0s.append(np.percentile(xs, 0.5))
        x1s.append(np.percentile(xs, 99.5))
        y0s.append(np.percentile(ys, 0.5))
        y1s.append(bottom)
    if not x0s:
        sys.exit("could not establish head bounds from segmentation masks")
    x0, x1 = min(x0s), max(x1s)
    y0, y1 = min(y0s), max(y1s)
    w, h = x1 - x0, y1 - y0
    # breathing room so hair never touches the window edge
    x0, x1 = x0 - 0.04 * w, x1 + 0.04 * w
    y0, y1 = y0 - 0.05 * h, y1 + 0.02 * h
    return [x0, y0, x1 - x0, y1 - y0]


def set_grid_for_box(box):
    """The window keeps its natural shape; the text grid adapts to it."""
    global ROWS
    aspect = box[2] / box[3]
    ROWS = max(40, min(90, round(COLS / aspect * CHAR_ASPECT)))
    return ROWS


def crop_image(frame, box):
    """Crop with black padding when the box leaves the frame."""
    import numpy as np
    x, y, w, h = box
    x0, y0, x1, y1 = int(round(x)), int(round(y)), int(round(x + w)), int(round(y + h))
    out = np.zeros((y1 - y0, x1 - x0, 3), dtype=frame.dtype)
    sx0, sy0 = max(0, x0), max(0, y0)
    sx1, sy1 = min(frame.shape[1], x1), min(frame.shape[0], y1)
    if sx1 > sx0 and sy1 > sy0:
        out[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = frame[sy0:sy1, sx0:sx1]
    return out


# ---------------------------------------------------------------- ascii conversion


def segment_person(frame_rgb, pts):
    """Person mask (float 0..1, h×w). Polarity is self-corrected against the
    face-landmark region, so segmenter channel conventions can't flip it.
    Low-confidence regions are cut and thin bridges broken (morphological
    opening) so background misclassifications can't stay attached to the
    person and sneak past the largest-component filter."""
    import numpy as np
    from PIL import Image, ImageFilter

    res = get_segmenter().segment(to_mp_image(frame_rgb))
    mask = np.squeeze(res.confidence_masks[-1].numpy_view()).astype(np.float64)

    x0, y0 = pts.min(axis=0)
    x1, y1 = pts.max(axis=0)
    h, w = mask.shape
    fx0, fy0 = max(0, int(x0)), max(0, int(y0))
    fx1, fy1 = min(w, int(x1)), min(h, int(y1))
    if fx1 > fx0 and fy1 > fy0 and mask[fy0:fy1, fx0:fx1].mean() < 0.5:
        mask = 1.0 - mask

    m8 = Image.fromarray((np.clip(mask, 0, 1) * 255).astype(np.uint8))
    m8 = m8.point(lambda v: v if v >= 153 else 0)          # confidence < 0.6 → out
    m8 = m8.filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(5))
    return np.asarray(m8).astype(np.float64) / 255.0


def face_cell_bbox(pts, box):
    """Face-landmark bounding box in cell coords (r0, r1, c0, c1), clamped."""
    x0, y0, cw, ch = box
    xs, ys = pts[:, 0], pts[:, 1]
    c0 = int((xs.min() - x0) / cw * COLS)
    c1 = int(math.ceil((xs.max() - x0) / cw * COLS))
    r0 = int((ys.min() - y0) / ch * ROWS)
    r1 = int(math.ceil((ys.max() - y0) / ch * ROWS))
    return max(0, r0), min(ROWS, r1), max(0, c0), min(COLS, c1)


def to_cells(crop_rgb, mask_crop):
    """Crop → per-cell luminance, mask, and Sobel magnitude/direction (rows×cols)."""
    import numpy as np
    from PIL import Image

    from PIL import ImageFilter

    w2, h2 = COLS * 2, ROWS * 2
    im2 = Image.fromarray(crop_rgb).convert("RGB").resize((w2, h2), Image.LANCZOS)
    # Slight blur before quantization: kills skin-texture speckle (adjacent
    # cells flip-flopping across glyph boundaries) without losing features.
    im2 = im2.filter(ImageFilter.GaussianBlur(radius=1.1))
    gray = np.asarray(im2).astype(np.float64)
    lum = gray @ [0.2126, 0.7152, 0.0722] / 255.0

    m = np.asarray(
        Image.fromarray((np.clip(mask_crop, 0, 1) * 255).astype(np.uint8)).resize(
            (w2, h2), Image.BILINEAR
        )
    ).astype(np.float64) / 255.0
    lum = lum * m

    # Sobel on the 2x grid
    gx = np.zeros_like(lum)
    gy = np.zeros_like(lum)
    gx[1:-1, 1:-1] = (
        lum[:-2, 2:] + 2 * lum[1:-1, 2:] + lum[2:, 2:]
        - lum[:-2, :-2] - 2 * lum[1:-1, :-2] - lum[2:, :-2]
    )
    gy[1:-1, 1:-1] = (
        lum[2:, :-2] + 2 * lum[2:, 1:-1] + lum[2:, 2:]
        - lum[:-2, :-2] - 2 * lum[:-2, 1:-1] - lum[:-2, 2:]
    )

    def cell_avg(a):
        return a.reshape(ROWS, 2, COLS, 2).mean(axis=(1, 3))

    cm = cell_avg(m)
    cm[~largest_component(cm > 0.5)] = 0.0   # stray mask blobs → background
    return cell_avg(lum), cm, cell_avg(gx), cell_avg(gy)


def largest_component(mask_bool):
    """Boolean cell mask → only its largest 4-connected region. The segmenter
    occasionally claims a wall fixture as 'person'; the head is always the
    biggest blob, so everything else becomes background."""
    import numpy as np
    from collections import deque

    seen = np.zeros_like(mask_bool)
    best = np.zeros_like(mask_bool)
    best_n = 0
    rows, cols = mask_bool.shape
    for sr in range(rows):
        for sc in range(cols):
            if not mask_bool[sr, sc] or seen[sr, sc]:
                continue
            comp = []
            q = deque([(sr, sc)])
            seen[sr, sc] = True
            while q:
                r, c = q.popleft()
                comp.append((r, c))
                for nr, nc in ((r-1, c), (r+1, c), (r, c-1), (r, c+1)):
                    if 0 <= nr < rows and 0 <= nc < cols \
                            and mask_bool[nr, nc] and not seen[nr, nc]:
                        seen[nr, nc] = True
                        q.append((nr, nc))
            if len(comp) > best_n:
                best_n = len(comp)
                best[:] = False
                for r, c in comp:
                    best[r, c] = True
    return best


def edge_glyph(gx, gy):
    """Pick a stroke glyph from the gradient direction (edge ⟂ gradient)."""
    ex, ey = -gy, gx                       # edge direction, image coords (y down)
    ang = math.degrees(math.atan2(-ey, ex)) % 180.0   # math coords, mod 180
    if ang < 22.5 or ang >= 157.5:
        return "_" if gy < 0 else "-"      # bright side above → sit stroke on baseline
    if ang < 67.5:
        return "/"
    if ang < 112.5:
        return "|"
    return "\\"


def render_frames(cell_data, face_bboxes, row_ids=None):
    """cell_data: list of (lum, mask, gx, gy); face_bboxes: cell-space face regions.
    row_ids: pitch-row id per frame — normalization pools PER ROW, because head
    tilt genuinely changes how much light the face catches (up-tilt rows catch
    the ceiling light); one global window would leave the level rows dim.
    Within a row (the yaw sweep) the window is shared, so no shimmer.
    Returns list of char grids (list of strings)."""
    import numpy as np

    n = len(cell_data)
    row_ids = row_ids if row_ids is not None else [0] * n

    def face_pool(idx):
        parts = []
        for k in idx:
            l, m, _, _ = cell_data[k]
            r0, r1, c0, c1 = face_bboxes[k]
            vals = l[r0:r1, c0:c1][m[r0:r1, c0:c1] > 0.5]
            if vals.size:
                parts.append(vals)
        return np.concatenate(parts)

    p_lo_f = np.empty(n)
    p_hi_f = np.empty(n)
    for r in sorted(set(row_ids)):
        idx = [k for k in range(n) if row_ids[k] == r]
        lo, hi = np.percentile(face_pool(idx), NORM_PCT)
        for k in idx:
            p_lo_f[k], p_hi_f[k] = lo, hi

    if os.environ.get("ASCII_DEBUG_TONES"):
        k = n // 2
        l, m, _, _ = cell_data[k]
        r0, r1, c0, c1 = face_bboxes[k]
        fv = l[r0:r1, c0:c1][m[r0:r1, c0:c1] > 0.5]
        print(f"DEBUG frame {k}: bbox rows {r0}-{r1} cols {c0}-{c1}, "
              f"{fv.size} face cells")
        print("  face lum percentiles 5/25/50/75/90/95:",
              np.round(np.percentile(fv, [5, 25, 50, 75, 90, 95]), 3))
        print("  row window p_lo/p_hi:", round(p_lo_f[k], 3), round(p_hi_f[k], 3))
        av = l[m > 0.5]
        print("  whole-person lum percentiles 50/90/99:",
              np.round(np.percentile(av, [50, 90, 99]), 3))

    # Hair floor: darkest person-wide luminance, global (hair is hair).
    all_masked = np.concatenate([l[m > 0.5] for l, m, _, _ in cell_data if (m > 0.5).any()])
    p_hair = np.percentile(all_masked, 0.5)

    mags = np.concatenate([np.hypot(gx, gy)[m > 0.5] for _, m, gx, gy in cell_data])
    edge_thresh = np.percentile(mags, EDGE_PCT)

    nlevels = len(RAMP)
    grids = []
    prev_idx = np.full((ROWS, COLS), -999, dtype=np.int32)   # hysteresis anchor

    for k, (lum, mask, gx, gy) in enumerate(cell_data):
        p_lo, p_hi = p_lo_f[k], p_hi_f[k]
        span = max(p_hi - p_lo, 1e-6)
        low_span = max(p_lo - p_hair, 1e-6)
        face_band = LOW_TOP + (1 - LOW_TOP) * np.clip((lum - p_lo) / span, 0, 1) ** GAMMA
        low_band = LOW_BOTTOM + (LOW_TOP - LOW_BOTTOM) * np.clip((lum - p_hair) / low_span, 0, 1)
        norm = np.where(lum >= p_lo, face_band, low_band)

        # Dodge everything outside the face box (neck, ears, clothing) so the
        # face is always the brightest element of the portrait.
        fr0, fr1, fc0, fc1 = face_bboxes[k]
        outside = np.ones_like(norm, dtype=bool)
        outside[fr0:fr1, fc0:fc1] = False
        damp = outside & (norm > LOW_TOP)
        norm[damp] = LOW_TOP + (norm[damp] - LOW_TOP) * NECK_DAMP
        mag = np.hypot(gx, gy)
        rows = []
        new_prev = np.full((ROWS, COLS), -999, dtype=np.int32)
        for r in range(ROWS):
            chars = []
            for c in range(COLS):
                if mask[r, c] < 0.5:
                    chars.append(" ")
                    continue
                if mag[r, c] >= edge_thresh and EDGE_LUM[0] <= norm[r, c] <= EDGE_LUM[1]:
                    chars.append(edge_glyph(gx[r, c], gy[r, c]))
                    continue
                raw = norm[r, c] * (nlevels - 1)
                if DITHER:
                    raw += (BAYER4[r % 4][c % 4] / 15.0 - 0.5) * DITHER
                    raw = min(max(raw, 0.0), nlevels - 1)
                idx = int(round(raw))
                if prev_idx[r, c] > -999 and abs(raw - prev_idx[r, c]) < HYSTERESIS:
                    idx = int(prev_idx[r, c])
                new_prev[r, c] = idx
                chars.append(RAMP[idx])
            rows.append("".join(chars).rstrip())
        prev_idx = new_prev
        grids.append(rows)
    return grids


# ---------------------------------------------------------------- eyes


def eye_record(pts, box, grid, which):
    """One eye's grid-space record for the runtime, or vis:0 when foreshortened."""
    ids = RIGHT_EYE if which == "right" else LEFT_EYE
    x0, y0, cw, ch = box
    px_per_col, px_per_row = cw / COLS, ch / ROWS

    corner_pts = [pts[ids["outer"]], pts[ids["inner"]], pts[ids["top"]], pts[ids["bottom"]]]
    xs = [p[0] for p in corner_pts]
    ys = [p[1] for p in corner_pts]

    c0 = int((min(xs) - x0) / px_per_col) - 1
    c1 = int(math.ceil((max(xs) - x0) / px_per_col)) + 1
    r0 = int((min(ys) - y0) / px_per_row)
    r1 = int(math.ceil((max(ys) - y0) / px_per_row))
    c0, r0 = max(0, c0), max(0, r0)
    c1, r1 = min(COLS, c1), min(ROWS, r1)
    w, h = c1 - c0, r1 - r0
    if h < 2:
        r1 = min(ROWS, r0 + 2)
        h = r1 - r0

    iod = math.hypot(*(pts[LEFT_EYE["outer"]] - pts[RIGHT_EYE["outer"]]))
    extent = max(xs) - min(xs)
    vis = 1
    if w < EYE_MIN_W or extent / max(iod, 1e-6) < EYE_MIN_RATIO:
        vis = 0

    iris = pts[ids["iris"]]
    pc = int((iris[0] - x0) / px_per_col)
    pr = int((iris[1] - y0) / px_per_row)
    pc = min(max(pc, c0 + 1), c1 - 2) if w >= 3 else c0
    pr = min(max(pr, r0), r1 - 1)

    return dict(r=r0, c=c0, w=w, h=h, pr=pr, pc=pc, vis=vis, lid=lid_glyph(grid, r0, c0, w, h))


def lid_glyph(grid, r0, c0, w, h):
    """Median-density glyph of the 1-cell ring around the eye box (blink fill)."""
    ring = []
    for r in range(max(0, r0 - 1), min(ROWS, r0 + h + 1)):
        for c in range(max(0, c0 - 1), min(COLS, c0 + w + 1)):
            if r0 <= r < r0 + h and c0 <= c < c0 + w:
                continue
            row = grid[r]
            ch = row[c] if c < len(row) else " "
            if ch in RAMP and ch != " ":
                ring.append(RAMP.index(ch))
    if not ring:
        return "+"
    ring.sort()
    return RAMP[ring[len(ring) // 2]]


# ---------------------------------------------------------------- outputs


def payload_dict(frames_out, cells, center, grid_rows, grid_cols):
    return dict(v=2, cols=COLS, rows=ROWS,
                gridCols=grid_cols, gridRows=grid_rows,
                center=center, cells=cells, ramp=RAMP, frames=frames_out)


def emit_data_js(frames_out, cells, center, grid_rows, grid_cols):
    import gzip

    js = ("window.ASCII_FACE = "
          + json.dumps(payload_dict(frames_out, cells, center, grid_rows, grid_cols),
                       separators=(",", ":"))
          + ";\n")
    DATA_OUT.write_text(js)
    raw = js.encode()
    return len(raw), len(gzip.compress(raw, 9))


def emit_preview(frames_out, cells, center, grid_rows, grid_cols, path=PREVIEW_OUT):
    data = json.dumps(payload_dict(frames_out, cells, center, grid_rows, grid_cols))
    html = PREVIEW_TEMPLATE.replace("__DATA__", data)
    path.write_text(html)


def inject_fallback(frames_out, center):
    """Refresh the no-JS fallback frame in index.html, and stamp the data +
    runtime script URLs with a content hash — browsers otherwise serve the
    previous build's frames for up to the CDN cache lifetime (or until the
    tab reloads), which reads as 'the fix didn't work'."""
    import hashlib
    import re

    idx = HERE / "index.html"
    start, end = "<!-- ASCII_FACE_FALLBACK_START -->", "<!-- ASCII_FACE_FALLBACK_END -->"
    if not idx.exists():
        return
    html = idx.read_text()
    if start not in html or end not in html:
        return
    block = "\n".join(r.rstrip() for r in frames_out[center]["grid"])
    html = html.split(start)[0] + start + block + end + html.split(end)[1]

    tag = hashlib.sha1(DATA_OUT.read_bytes()
                       + (HERE / "js" / "ascii-face.js").read_bytes()
                       + (HERE / "js" / "splash.js").read_bytes()
                       + (HERE / "css" / "site.css").read_bytes()).hexdigest()[:8]
    for name in ("js/ascii-face-data.js", "js/ascii-face.js", "js/splash.js",
                 "css/site.css"):
        html = re.sub(rf"{re.escape(name)}(\?v=[0-9a-f]+)?",
                      f"{name}?v={tag}", html)

    idx.write_text(html)
    print(f"no-JS fallback frame refreshed; scripts stamped ?v={tag}")


def emit_contact_sheet(crops, poses, per_row=YAW_COLS):
    from PIL import Image, ImageDraw

    thumb_w = 160
    thumb_h = round(thumb_w * crops[0].shape[0] / crops[0].shape[1])
    rows_n = math.ceil(len(crops) / per_row)
    sheet = Image.new("RGB", (per_row * thumb_w, rows_n * (thumb_h + 18)), "#0d0d12")
    draw = ImageDraw.Draw(sheet)
    for i, (crop, (yaw, pitch)) in enumerate(zip(crops, poses)):
        im = Image.fromarray(crop).resize((thumb_w, thumb_h), Image.LANCZOS)
        x, y = (i % per_row) * thumb_w, (i // per_row) * (thumb_h + 18)
        sheet.paste(im, (x, y))
        draw.text((x + 4, y + thumb_h + 2), f"{i}: y{yaw:+.2f} p{pitch:+.2f}", fill="#f2f2f5")
    sheet.save(SHEET_OUT)


def run_assertions(frames_out, cells, grid_rows, grid_cols, size_bytes, gz_bytes):
    for i, f in enumerate(frames_out):
        assert len(f["grid"]) == ROWS, f"frame {i}: {len(f['grid'])} rows, want {ROWS}"
        for row in f["grid"]:
            assert len(row) <= COLS, f"frame {i}: row wider than {COLS}"
            assert "<" not in row and ">" not in row and "&" not in row, f"frame {i}: unsafe char"
        for e in f["eyes"]:
            assert 0 <= e["r"] and e["r"] + e["h"] <= ROWS, f"frame {i}: eye row out of grid"
            assert 0 <= e["c"] and e["c"] + e["w"] <= COLS, f"frame {i}: eye col out of grid"
            assert e["r"] <= e["pr"] < e["r"] + e["h"], f"frame {i}: pupil row outside box"
            assert e["c"] <= e["pc"] < e["c"] + e["w"], f"frame {i}: pupil col outside box"
    assert len(cells) == grid_rows * grid_cols, "cells/grid size mismatch"
    assert all(0 <= u < len(frames_out) for u in cells), "cell index out of range"
    for r in range(grid_rows):
        row_yaws = [frames_out[cells[ci]]["yaw"]
                    for ci in range(r * grid_cols, (r + 1) * grid_cols)]
        assert row_yaws == sorted(row_yaws), f"grid row {r} not sorted by yaw"
    if grid_rows > 1:
        med = [sorted(frames_out[cells[ci]]["pitch"]
                      for ci in range(r * grid_cols, (r + 1) * grid_cols))[grid_cols // 2]
               for r in range(grid_rows)]
        assert med == sorted(med), "grid rows not ordered by pitch"
        for c in range(grid_cols):
            col_p = [frames_out[cells[r * grid_cols + c]]["pitch"]
                     for r in range(grid_rows)]
            assert col_p == sorted(col_p), f"grid column {c} not ordered by pitch"
    assert size_bytes <= SIZE_BUDGET, f"data file {size_bytes}B over {SIZE_BUDGET}B budget"
    assert gz_bytes <= GZIP_BUDGET, f"data file {gz_bytes}B gzipped over {GZIP_BUDGET}B budget"


def stats_table(frames_out):
    lines = ["frame  yaw     pitch    ink%  eyes (w×h, vis)"]
    for i, f in enumerate(frames_out):
        ink = sum(len(r.replace(" ", "")) for r in f["grid"])
        pct = 100 * ink / (ROWS * COLS)
        eyes = "  ".join(f"{e['w']}x{e['h']} v{e['vis']}" for e in f["eyes"])
        lines.append(f"{i:>5}  {f['yaw']:+.3f}  {f.get('pitch', 0):+.3f}  {pct:4.1f}  {eyes}")
    return "\n".join(lines)


# ---------------------------------------------------------------- pipelines


def frame_to_record(frame, mask, box):
    """One selected frame + its mask + the fixed window → crop and cell data."""
    crop = crop_image(frame, box)
    mask_crop = crop_image(
        (mask[..., None].repeat(3, axis=2) * 255).astype("uint8"), box
    )[..., 0].astype("float64") / 255.0
    cells = to_cells(crop, mask_crop)
    return crop, cells


def run_video(path):
    print(f"pass 1: detecting faces in {path} ...")
    detections, total = detect_all(path)
    print(f"  {len(detections)}/{total} frames had a face")
    n0 = len(detections)
    detections = [d for d in detections
                  if EDGE_TRIM * total <= d[0] <= (1 - EDGE_TRIM) * total]
    if len(detections) < n0:
        print(f"  trimmed {n0 - len(detections)} clip-edge detections")
    if len(detections) < YAW_COLS:
        sys.exit(f"only {len(detections)} usable frames — need at least {YAW_COLS}")

    grid_sel, yaw_targets_rows, pitch_targets = select_frames(detections)
    grid_rows = len(grid_sel)
    grid_cols = len(grid_sel[0])
    flat_cells = [item for row in grid_sel for item in row]   # per-cell, fi may repeat

    # Aim audit: how far each cell's measured pose sits from its target.
    yspan = max(max(t[-1] for t in yaw_targets_rows) - min(t[0] for t in yaw_targets_rows), 1e-6)
    pspan = max((pitch_targets[-1] - pitch_targets[0]) or 1, 1e-6)
    devs = []
    for ci, (_, _, yaw, pitch) in enumerate(flat_cells):
        r, c = divmod(ci, grid_cols)
        dy = abs(yaw - yaw_targets_rows[r][c]) / yspan
        dp = abs(pitch - pitch_targets[r]) / pspan if grid_rows > 1 else 0.0
        devs.append((max(dy, dp), r, c, dy, dp))
    devs.sort(reverse=True)
    n_off = sum(1 for d in devs if d[0] > 0.10)
    print(f"  aim audit: {n_off}/{len(devs)} cells deviate >10% of range from target")
    for d, r, c, dy, dp in devs[:6]:
        if d > 0.10:
            print(f"    row {r} col {c}: yaw off {dy:.0%}, pitch off {dp:.0%}")
    if grid_rows > 1:
        drifts = []
        for r in range(grid_rows):
            ps = [flat_cells[r * grid_cols + c][3] for c in range(grid_cols)]
            drifts.append(max(ps) - min(ps))
        print(f"  in-row pitch drift: worst {max(drifts):.3f} "
              f"({max(drifts) / pspan:.0%} of range), mean {sum(drifts) / len(drifts):.3f}")

    # Unique frames in first-appearance (row-major) order; cells index into them.
    uniq = []
    fi_to_u = {}
    for fi, pts, yaw, pitch in flat_cells:
        if fi not in fi_to_u:
            fi_to_u[fi] = len(uniq)
            uniq.append((fi, pts, yaw, pitch))
    cells = [fi_to_u[fi] for fi, _, _, _ in flat_cells]
    row_ids = [None] * len(uniq)
    for ci, u in enumerate(cells):
        if row_ids[u] is None:
            row_ids[u] = ci // grid_cols
    print(f"  grid {grid_cols}x{grid_rows} ({len(uniq)} unique frames): "
          f"yaw {flat_cells[0][2]:+.3f} → {flat_cells[-1][2]:+.3f}, "
          f"pitch {min(t[3] for t in flat_cells):+.3f} → {max(t[3] for t in flat_cells):+.3f}")

    print("pass 2: extracting selected frames ...")
    sel_ids = {fi for fi, _, _, _ in uniq}
    wanted = {}
    for i, frame in enumerate(iter_video(path)):
        if i in sel_ids:
            wanted[i] = frame

    print("  segmenting + establishing the fixed head window ...")
    masks = {fi: segment_person(wanted[fi], pts) for fi, pts, _, _ in uniq}
    box = global_head_box([(masks[fi], pts) for fi, pts, _, _ in uniq])
    set_grid_for_box(box)
    print(f"  window {box[2]:.0f}x{box[3]:.0f}px at ({box[0]:.0f},{box[1]:.0f}) → grid {COLS}x{ROWS}")

    # Zoom normalization: cancel ONLY the camera-distance component of the
    # measured face size. The measure couples with BOTH tilt and turn
    # (projection), so the size target is a 2-D pose-conditioned table:
    # the median measure within each (tilt-bin × |turn|-bin) of the whole
    # clip. Dividing by the target for the frame's own pose region leaves
    # pure distance residual — pose can no longer masquerade as distance
    # (1-D corrections kept under-correcting the turn extremes, which read
    # as zooming in at the far left/right).
    import numpy as np
    y_all = np.abs(np.array([yaw_score(p) for _, p in detections]))
    fl_all = np.array([math.hypot(*(p[LM_CHIN] - p[LM_FOREHEAD]))
                       for _, p in detections])
    p_all = np.array([pitch_score(p) for _, p in detections])

    NP, NY = 7, 5
    p_edges = np.quantile(p_all, np.linspace(0, 1, NP + 1))[1:-1]
    y_edges = np.quantile(y_all, np.linspace(0, 1, NY + 1))[1:-1]
    pb_all = np.digitize(p_all, p_edges)
    yb_all = np.digitize(y_all, y_edges)
    target = np.full((NP, NY), np.nan)
    for pb in range(NP):
        for yb in range(NY):
            sel = (pb_all == pb) & (yb_all == yb)
            if sel.sum() >= 5:
                target[pb, yb] = np.median(fl_all[sel])
    for pb in range(NP):                      # fill sparse bins from the tilt row
        row_med = np.nanmedian(target[pb])
        target[pb, np.isnan(target[pb])] = row_med if not np.isnan(row_med) \
            else np.median(fl_all)

    zooms = np.empty(len(uniq))
    for u, (_, pts, yaw, pitch) in enumerate(uniq):
        fl = math.hypot(*(pts[LM_CHIN] - pts[LM_FOREHEAD]))
        pb = int(np.digitize(pitch, p_edges))
        yb = int(np.digitize(abs(yaw), y_edges))
        zooms[u] = fl / target[pb, yb]
    zooms = np.clip(zooms, 0.85, 1.18)
    u_yaws = np.array([yaw for _, _, yaw, _ in uniq])
    z_mid = float(np.median(zooms[np.abs(u_yaws) < 0.2])) if (np.abs(u_yaws) < 0.2).any() else 1.0
    z_ext = float(np.median(zooms[np.abs(u_yaws) > 0.55])) if (np.abs(u_yaws) > 0.55).any() else 1.0
    print(f"  zoom normalization: {zooms.min():.3f} … {zooms.max():.3f} "
          f"(median mid-turn {z_mid:.3f} vs extreme-turn {z_ext:.3f})")

    def scaled_box(base, k):
        x, y, w, h = base
        cx, cy = x + w / 2, y + h / 2
        return [cx - w * k / 2, cy - h * k / 2, w * k, h * k]

    print("  converting ...")
    crops, cell_data, all_pts, poses, bboxes = [], [], [], [], []
    for u, (fi, pts, yaw, pitch) in enumerate(uniq):
        box_f = scaled_box(box, float(zooms[u]))
        crop, cdata = frame_to_record(wanted[fi], masks[fi], box_f)
        crops.append(crop)
        cell_data.append(cdata)
        all_pts.append((pts, box_f))
        poses.append((yaw, pitch))
        bboxes.append(face_cell_bbox(pts, box_f))

    # Mask-area audit: a background leak inflates a frame's person-mask well
    # beyond its pose neighbors. Flag anything >22% over the median.
    import numpy as np
    areas = np.array([(m > 0.5).sum() for _, m, _, _ in cell_data])
    med_area = np.median(areas)
    leaks = [(u, a / med_area - 1) for u, a in enumerate(areas)
             if a > 1.22 * med_area]
    if leaks:
        print(f"  MASK-AREA WARNING: {len(leaks)} frames well above median person area:")
        for u, frac in sorted(leaks, key=lambda t: -t[1])[:8]:
            yaw, pitch = poses[u]
            print(f"    frame {u} (yaw {yaw:+.2f}, pitch {pitch:+.2f}): +{frac:.0%}")
    else:
        print("  mask-area audit clean (no background leaks)")

    grids = render_frames(cell_data, bboxes, row_ids)

    frames_out = []
    for grid, (pts, box), (yaw, pitch) in zip(grids, all_pts, poses):
        eyes = [eye_record(pts, box, grid, "right"), eye_record(pts, box, grid, "left")]
        eyes.sort(key=lambda e: e["c"])
        frames_out.append(dict(yaw=round(yaw, 3), pitch=round(pitch, 3),
                               grid=grid, eyes=eyes))

    # Front-facing CELL: min |yaw| within the middle (level-anchored) pitch row.
    mid = grid_rows // 2
    row_slice = range(mid * grid_cols, (mid + 1) * grid_cols)
    center = min(row_slice, key=lambda ci: abs(frames_out[cells[ci]]["yaw"]))

    size, gz = emit_data_js(frames_out, cells, center, grid_rows, grid_cols)
    emit_preview(frames_out, cells, center, grid_rows, grid_cols)
    emit_contact_sheet([crops[u] for u in cells],
                       [poses[u] for u in cells], grid_cols)
    run_assertions(frames_out, cells, grid_rows, grid_cols, size, gz)

    inject_fallback(frames_out, cells[center])
    print(stats_table(frames_out))
    print(f"\ncenter cell: {center} (yaw {frames_out[cells[center]]['yaw']:+.3f}, "
          f"pitch {frames_out[cells[center]]['pitch']:+.3f})")
    print(f"data:    {DATA_OUT}  ({size:,} bytes raw, {gz:,} gzipped)")
    print(f"preview: {PREVIEW_OUT}")
    print(f"sheet:   {SHEET_OUT}")


def run_still(path):
    """Single-photo mode: same conversion on one image, preview only. For tuning."""
    import numpy as np
    from PIL import Image, ImageOps

    im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    if im.height > READ_MAX_H:
        im = im.resize((round(im.width * READ_MAX_H / im.height), READ_MAX_H), Image.LANCZOS)
    frame = np.asarray(im)

    res = get_landmarker().detect(to_mp_image(frame))
    if not res.face_landmarks:
        sys.exit("no face found in still image")
    pts = landmarks_to_px(res.face_landmarks[0], frame.shape[1], frame.shape[0])

    yaw = yaw_score(pts)
    mask = segment_person(frame, pts)
    box = global_head_box([(mask, pts)])
    set_grid_for_box(box)
    crop, cells = frame_to_record(frame, mask, box)
    grid = render_frames([cells], [face_cell_bbox(pts, box)])[0]
    eyes = [eye_record(pts, box, grid, "right"), eye_record(pts, box, grid, "left")]
    eyes.sort(key=lambda e: e["c"])
    frames_out = [dict(yaw=round(yaw, 3), pitch=round(pitch_score(pts), 3),
                       grid=grid, eyes=eyes)]

    out = DOWNLOADS / "ascii-still-preview.html"
    emit_preview(frames_out, [0], 0, 1, 1, path=out)
    txt = DOWNLOADS / "ascii-still.txt"
    txt.write_text("\n".join(r.ljust(COLS) for r in grid) + "\n")
    print(stats_table(frames_out))
    print(f"preview: {out}\ntext:    {txt}")


def run_calibrate():
    """Rasterize candidate glyphs in Menlo, sort by ink, propose a ramp."""
    from PIL import Image, ImageDraw, ImageFont

    # Edge strokes (/ \ | _) and brackets are excluded: edges have reserved
    # meaning in the renderer, and brackets read as structural noise in a face.
    candidates = (
        " .`'^\",:;Il!i~+-?1tfjrxnuvczsXYUJCLQ0OZmwqpdbkhaoe*#MW8%B@$"
    )
    font = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 32)
    inks = []
    for ch in candidates:
        im = Image.new("L", (20, 40), 0)
        ImageDraw.Draw(im).text((0, 0), ch, fill=255, font=font)
        inks.append((sum(im.getdata()) / (20 * 40 * 255), ch))
    inks.sort()
    print("glyphs by ink fraction:")
    for ink, ch in inks:
        print(f"  {ink:.4f}  {ch!r}")
    # propose: 17 glyphs evenly spaced across the ink range
    lo, hi = inks[0][0], inks[-1][0]
    ramp = []
    for i in range(17):
        target = lo + (hi - lo) * i / 16
        best = min(inks, key=lambda t: abs(t[0] - target))
        if not ramp or best[1] != ramp[-1]:
            ramp.append(best[1])
    print("\nproposed RAMP =", repr("".join(ramp)))


def run_encode_intro(src, dst):
    import imageio_ffmpeg

    exe = imageio_ffmpeg.get_ffmpeg_exe()
    cmd = [
        exe, "-y", "-i", str(src),
        "-vf", "scale=960:540",
        "-c:v", "libx264", "-crf", "26", "-preset", "medium",
        "-an", "-movflags", "+faststart", "-pix_fmt", "yuv420p",
        str(dst),
    ]
    subprocess.run(cmd, check=True)
    print(f"{dst}: {os.path.getsize(dst):,} bytes")


# ---------------------------------------------------------------- preview page

PREVIEW_TEMPLATE = """<!doctype html>
<meta charset="utf-8">
<title>ascii face preview</title>
<style>
  body { background:#0d0d12; color:#f2f2f5; font-family:ui-sans-serif,system-ui;
         display:grid; place-items:center; gap:14px; padding:24px; }
  #wrap { position:relative; }
  pre { font:8px/9.6px ui-monospace,"SF Mono",Menlo,monospace; margin:0; white-space:pre; }
  .eyebox { position:absolute; border:1px solid #ff6b35; pointer-events:none; display:none; }
  .pupil { position:absolute; border:1px solid #4fc3f7; pointer-events:none; display:none; }
  #wrap.show-eyes .eyebox, #wrap.show-eyes .pupil { display:block; }
  label { margin-right:16px; user-select:none; }
  input[type=range] { width:420px; vertical-align:middle; }
  #meta { color:#9a9aab; font-size:13px; }
</style>
<div>
  <label>frame <input type="range" id="slider" min="0" value="0"> <span id="fno"></span></label>
  <label><input type="checkbox" id="eyes"> eye boxes</label>
  <label><input type="checkbox" id="sweep"> auto sweep</label>
  <label><input type="checkbox" id="follow"> follow mouse</label>
</div>
<div id="wrap"><pre id="face"></pre></div>
<div id="meta"></div>
<script>
const DATA = __DATA__;
const CW = 4.8, CH = 9.6;
const face = document.getElementById('face');
const wrap = document.getElementById('wrap');
const slider = document.getElementById('slider');
slider.max = (DATA.cells ? DATA.cells.length : DATA.frames.length) - 1;
slider.value = DATA.center;

function show(i) {
  const f = DATA.frames[DATA.cells ? DATA.cells[i] : i];
  face.textContent = f.grid.map(r => r.padEnd(DATA.cols)).join('\\n');
  document.getElementById('fno').textContent =
    i + ' (yaw ' + f.yaw + (f.pitch !== undefined ? ', pitch ' + f.pitch : '') + ')';
  const ink = f.grid.reduce((a, r) => a + r.replaceAll(' ', '').length, 0);
  document.getElementById('meta').textContent =
    DATA.cols + 'x' + DATA.rows + ' — ink ' + (100 * ink / (DATA.cols * DATA.rows)).toFixed(1) + '%';
  wrap.querySelectorAll('.eyebox,.pupil').forEach(el => el.remove());
  for (const e of f.eyes) {
    const b = document.createElement('div');
    b.className = 'eyebox';
    b.style.cssText = `left:${e.c * CW}px;top:${e.r * CH}px;width:${e.w * CW}px;height:${e.h * CH}px;` +
      (e.vis ? '' : 'border-style:dashed;opacity:.4;');
    wrap.appendChild(b);
    const p = document.createElement('div');
    p.className = 'pupil';
    p.style.cssText = `left:${e.pc * CW}px;top:${e.pr * CH}px;width:${2 * CW}px;height:${CH}px;`;
    wrap.appendChild(p);
  }
}
slider.addEventListener('input', () => show(+slider.value));
document.getElementById('eyes').addEventListener('change', ev =>
  wrap.classList.toggle('show-eyes', ev.target.checked));
let sweepTimer = null;
document.getElementById('sweep').addEventListener('change', ev => {
  if (ev.target.checked) {
    let t = 0;
    sweepTimer = setInterval(() => {
      t += 0.03;
      const nCells = DATA.cells ? DATA.cells.length : DATA.frames.length;
      const i = Math.round((Math.sin(t) * 0.5 + 0.5) * (nCells - 1));
      slider.value = i; show(i);
    }, 40);
  } else { clearInterval(sweepTimer); }
});
const gCols = DATA.gridCols || DATA.frames.length;
const gRows = DATA.gridRows || 1;
window.addEventListener('mousemove', ev => {
  if (!document.getElementById('follow').checked) return;
  const col = Math.round((ev.clientX / innerWidth) * (gCols - 1));
  const row = Math.round((ev.clientY / innerHeight) * (gRows - 1));
  const i = row * gCols + col;
  slider.value = i; show(i);
});
show(DATA.center);
</script>
"""

# ---------------------------------------------------------------- cli


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video", nargs="?", help="head-turn video file")
    ap.add_argument("--still", metavar="IMG", help="single-photo tuning mode (preview only)")
    ap.add_argument("--calibrate", action="store_true", help="print ink-sorted Menlo ramp")
    ap.add_argument("--encode-intro", nargs=2, metavar=("IN", "OUT"), help="re-encode splash video")
    args = ap.parse_args()

    if args.calibrate:
        run_calibrate()
    elif args.encode_intro:
        run_encode_intro(*args.encode_intro)
    elif args.still:
        run_still(args.still)
    elif args.video:
        run_video(args.video)
    else:
        ap.print_help()


if __name__ == "__main__":
    main()
