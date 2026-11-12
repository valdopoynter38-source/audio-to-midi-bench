# -*- coding: utf-8 -*-
"""pYIN (the tracker inside Sonic Visualiser) on the same recording.

pYIN gives per-frame pitch, not notes. The note segmenter below is ours, written
as one fixed rule so anyone can reproduce it:
  round to nearest semitone -> merge adjacent equal values -> drop <50 ms
  fragments -> merge <60 ms gaps *only when the pitch is the same*.

Two environment notes, both deliberate:

1. librosa's abs2 / localmax / localmin are replaced with plain numpy versions
   *unconditionally*. They are mathematically the same operation; the numba
   builds only differ in how they walk the edges. Replacing them means the
   numbers here do not depend on whether your machine has a working numba.
   pYIN itself is pure numpy, so nothing else is affected.

2. If numba or soxr cannot be imported (broken DLLs on some Python 3.13
   builds), a pass-through stub is installed so librosa still imports. The
   stub is never called: this file is 44.1 kHz and is not resampled, and every
   numba-decorated helper we actually reach has already been replaced above.

Usage:  python run-pyin.py [melody.wav] [truth.json]
Writes: out-pyin.json, pyin-frames.json
"""
import json
import sys
import types

import numpy as np


def _install_import_stubs():
    """Only runs when the real module is missing/broken."""
    if "soxr" not in sys.modules:
        try:
            import soxr  # noqa: F401
        except Exception:
            _s = types.ModuleType("soxr")
            _s.resample = lambda x, in_rate, out_rate, **kw: x
            _s.__version__ = "0.0.0-stub"
            sys.modules["soxr"] = _s

    try:
        import numba  # noqa: F401
    except Exception:
        def _jit(*a, **k):
            if a and callable(a[0]) and not k:
                return a[0]
            return lambda f: f
        _nb = types.ModuleType("numba")
        for name in ("jit", "njit", "stencil", "guvectorize", "vectorize"):
            setattr(_nb, name, _jit)
        _nb.uint32 = np.uint32
        _nb.__version__ = "0.0.0-stub"
        _nb.__file__ = None
        sys.modules["numba"] = _nb


_install_import_stubs()
import librosa  # noqa: E402


def _abs2(x, dtype=None):
    a = np.asarray(x)
    out = (a.real ** 2 + a.imag ** 2) if np.iscomplexobj(a) else a ** 2
    return out if dtype is None else np.asarray(out, dtype=dtype)


def _localmax_np(x, *, axis=0):
    x = np.asarray(x)
    n = x.shape[axis]
    pad = [(1, 1) if i == axis else (0, 0) for i in range(x.ndim)]
    xp = np.pad(x, pad, mode="edge")
    prev = np.take(xp, np.arange(0, n), axis=axis)
    nxt = np.take(xp, np.arange(2, n + 2), axis=axis)
    return (x > prev) & (x >= nxt)


def _localmin_np(x, *, axis=0):
    x = np.asarray(x)
    n = x.shape[axis]
    pad = [(1, 1) if i == axis else (0, 0) for i in range(x.ndim)]
    xp = np.pad(x, pad, mode="edge")
    prev = np.take(xp, np.arange(0, n), axis=axis)
    nxt = np.take(xp, np.arange(2, n + 2), axis=axis)
    return (x < prev) & (x <= nxt)


import librosa.util.utils as _luu  # noqa: E402

_luu.abs2 = _abs2
_luu.localmax = _localmax_np
_luu.localmin = _localmin_np
for _mod in (librosa.util, librosa):
    for _name, _fn in (("abs2", _abs2), ("localmax", _localmax_np), ("localmin", _localmin_np)):
        if hasattr(_mod, _name):
            setattr(_mod, _name, _fn)

WAV = sys.argv[1] if len(sys.argv) > 1 else "melody.wav"
TRUTH = sys.argv[2] if len(sys.argv) > 2 else "truth.json"

SR = 44100
FRAME, HOP = 2048, 512

y, sr = librosa.load(WAV, sr=SR, mono=True)
f0, vflag, vprob = librosa.pyin(
    y,
    fmin=librosa.note_to_hz("C2"),
    fmax=librosa.note_to_hz("C7"),
    sr=SR,
    frame_length=FRAME,
    hop_length=HOP,
)
times = librosa.times_like(f0, sr=SR, hop_length=HOP)
midi = np.where(np.isnan(f0), np.nan, 69 + 12 * np.log2(np.maximum(f0, 1e-9) / 440.0))

truth = json.load(open(TRUTH, encoding="utf-8"))


def truth_pitch(t):
    for n in truth["notes"]:
        if n["start"] - 0.01 <= t <= n["end"] + 0.01:
            return n["pitch"]
    return None


# frame accuracy, glide excluded
good = tot = 0
for t, m in zip(times, midi):
    tp = truth_pitch(t)
    if tp is None or (6.55 <= t <= 7.25):
        continue
    tot += 1
    if not np.isnan(m) and round(m) == tp:
        good += 1
frame_acc = good / max(1, tot)

# ---- segmenter (ours, fixed rule) ----
segs = []
cur = None
for t, m in zip(times, midi):
    p = None if np.isnan(m) else int(round(m))
    if cur and p == cur["pitch"]:
        cur["end"] = float(t)
    else:
        if cur:
            segs.append(cur)
        cur = {"pitch": p, "start": float(t), "end": float(t)} if p is not None else None
if cur:
    segs.append(cur)

MIN_DUR, GAP = 0.050, 0.060
segs = [s for s in segs if s["end"] - s["start"] >= MIN_DUR]
merged = []
for s in segs:
    # same pitch only — merging across pitches collapses the whole melody into one note
    if merged and s["pitch"] == merged[-1]["pitch"] and s["start"] - merged[-1]["end"] < GAP:
        merged[-1]["end"] = s["end"]
    else:
        merged.append(dict(s))
notes = [{"pitch": s["pitch"], "start": round(s["start"], 3), "end": round(s["end"], 3)} for s in merged]

json.dump({"tool": "pyin", "notes": notes}, open("out-pyin.json", "w", encoding="utf-8"), indent=1)
print("frames", tot, "frame accuracy %.3f" % frame_acc)
print("notes", len(notes))
print(" ".join("%d@%.2f-%.2f" % (n["pitch"], n["start"], n["end"]) for n in notes))
json.dump({"frame_accuracy": round(frame_acc, 4), "frames_scored": tot},
          open("pyin-frames.json", "w", encoding="utf-8"), indent=1)
