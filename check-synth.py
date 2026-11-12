# -*- coding: utf-8 -*-
"""Does melody2.wav actually contain the pitch track that truth2.json claims?

This is the check that makes "the answer key is known before any detector runs"
mean something for sample B. The truth file says where every note is and how the
joins move between them; the generator says it wrote that curve into the
waveform. Either that is true of the file on disk, or every number downstream is
a statement about a script rather than about audio.

So: estimate the pitch independently (pYIN, no note segmentation, no knowledge of
the truth), then compare it to `f0_cents` from truth2.json.

Two populations, because they are not the same measurement:

  body  — samples where truth says the pitch is steady and the note is at least
          60 ms old. Here the two should agree to a few cents. If they do not,
          the waveform does not contain the curve.
  join  — samples inside a legato glide. Here truth says the pitch is *moving*
          by design, so a large difference from the note's nominal pitch is the
          point, not an error. We report it separately and never as an error.

Output: <outDir>/synth-check.json
Needs librosa. Missing librosa is reported as skipped by verify.sh, never faked.
"""
import json
import os
import sys

import numpy as np

from librosa_shim import import_librosa

GRID_TOL = 0.008   # how far a pYIN frame may be from a truth grid point


def main():
    librosa = import_librosa()

    truth = json.load(open("truth2.json", encoding="utf-8"))
    y, sr = librosa.load("melody2.wav", sr=None, mono=True)

    f0, _, _ = librosa.pyin(
        y, fmin=librosa.note_to_hz("C2"), fmax=librosa.note_to_hz("C7"),
        sr=sr, frame_length=2048, hop_length=512,
    )
    times = librosa.times_like(f0, sr=sr, hop_length=512)

    grid = truth["f0_grid"]
    cents = np.array(truth["f0_cents"], dtype=float)
    gt = np.arange(1, len(cents) + 1) * grid          # grid midpoints

    notes = truth["notes"]

    def in_join(t):
        for n in notes:
            if n["glide_in"] > 0 and n["start"] <= t < n["start"] + n["glide_in"]:
                return True
        return False

    def in_body(t):
        for n in notes:
            a = n["start"] + n["glide_in"] + 0.06
            b = n["end"] - 0.06
            if a <= t <= b:
                return True
        return False

    body_err, join_err, hits, total = [], [], 0, 0
    for t, c in zip(gt, cents):
        j = int(np.argmin(np.abs(times - t)))
        if abs(times[j] - t) > GRID_TOL or not np.isfinite(f0[j]):
            continue
        est = 1200.0 * np.log2(f0[j] / 440.0)
        d = est - c
        total += 1
        if round(69 + est / 100.0) == round(69 + c / 100.0):
            hits += 1
        if in_body(t):
            body_err.append(d)
        elif in_join(t):
            join_err.append(d)

    body_err = np.array(body_err)
    join_err = np.array(join_err)
    out = {
        "checked_against": "truth2.json f0_cents",
        "estimator": "librosa.pyin frame_length=2048 hop_length=512",
        "grid_points": int(total),
        "midi_match_rate": round(hits / total, 4) if total else None,
        "body_points": int(body_err.size),
        "body_median_abs_cents": round(float(np.median(np.abs(body_err))), 2) if body_err.size else None,
        "body_p95_abs_cents": round(float(np.percentile(np.abs(body_err), 95)), 2) if body_err.size else None,
        "body_max_abs_cents": round(float(np.max(np.abs(body_err))), 2) if body_err.size else None,
        "join_points": int(join_err.size),
        "join_median_signed_cents": round(float(np.median(join_err)), 2) if join_err.size else None,
        "join_note": "pitch is moving here by design; a large value is the sample working, not failing",
    }
    out_dir = sys.argv[1] if len(sys.argv) > 1 else "."
    with open(os.path.join(out_dir, "synth-check.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)

    print("grid points:", out["grid_points"], "| midi match:", out["midi_match_rate"])
    print("body  median |err|", out["body_median_abs_cents"], "cents  p95",
          out["body_p95_abs_cents"], " max", out["body_max_abs_cents"])
    print("join  points", out["join_points"], "median signed",
          out["join_median_signed_cents"], "cents")


if __name__ == "__main__":
    try:
        main()
    except ImportError:
        print("librosa not importable", file=sys.stderr)
        sys.exit(2)
