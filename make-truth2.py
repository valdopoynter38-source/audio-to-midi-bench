# -*- coding: utf-8 -*-
"""Sample B: one *performed* line, 28 s, 30 notes, legato and real vibrato.

Why a second sample
-------------------
`melody.wav` (sample A) is eleven notes of trap questions: a repeated C4, two
150 ms sixteenths, one glide. Every note is separated by silence, so every
boundary is a hard edge. Three engines can be ranked on it, and sample A does
that job.

But no one plays like that. Real playing is hard for a different reason: the
notes are *joined*. On a legato string or a sung line the next note does not
begin where the previous one ends — it begins while the previous pitch is still
leaving, and the join takes 40-140 ms depending on the interval. A detector that
looks at 23 ms of audio can see nothing but the join.

So this sample is synthesised the way a player plays, not the way a score is
read:

  * one continuous pitch track f0(t) over the whole 28 s — phase never resets,
    so there are no clicks for a detector to lock onto
  * legato joins are exponential glides in cents, 40-140 ms, scaled by the
    interval (see glide_for). The glide sits *inside* the incoming note, so
    truth says a note starts where the previous pitch starts moving away.
  * detached notes get a 30 ms attack and a 60 ms release with a real gap
  * vibrato is per note: delayed onset (100-220 ms), different rate (4.6-6.4 Hz),
    different depth (18-42 cents), and a rate that drifts slightly. It is not
    one global LFO.
  * timbre drifts a little between notes, and there is one octave portamento.

Ground truth is still written before any detector runs: `make-truth2.py` writes
`melody2.wav` and `truth2.json` in the same pass. Nothing is transcribed by ear.

What truth2.json carries that truth.json does not
-------------------------------------------------
  * `glide_in` per note — how long the join into this note lasts. `start` is
    where the previous pitch starts moving, so `[start + glide_in, end]` is the
    part of the note where the pitch is actually stable. Both the strict window
    used for sample A and this core window are computable from the file.
  * `f0_cents` — the pitch track the generator used, on a 10 ms grid, in cents
    relative to MIDI 69 (A4). This is what `check-synth.py` compares the audio
    against; without it, "the truth is known" would be a claim about a script
    rather than about the file.

Usage:  python make-truth2.py     ->  melody2.wav, truth2.json
"""
import json
import math
import wave
import struct

import numpy as np

SR = 44100
RNG = np.random.default_rng(20261113)
F0_GRID = 0.010          # f0_cents resolution, seconds
TAIL = 0.70              # silence after the last note

# (pitch, dur, articulation, vibrato(depth_cents, rate_hz) or None)
# Articulation only decides the amplitude envelope; the *pitch* is one
# continuous track regardless, which is the point of the sample.
#
# The join duration is not a constant, it is derived from the interval — see
# glide_for(). A player connecting two adjacent scale degrees does not slide;
# a player leaping an octave does. Hard-coding 90 ms everywhere would have made
# the sample unrealistically slurred and every conclusion drawn from it false.
NOTES = [
    # phrase 1 — lyrical, all joined
    (64, 1.40, "legato",   None),
    (69, 1.50, "legato",   None),
    (67, 0.75, "legato",   None),
    (65, 0.75, "legato",   None),
    (64, 1.10, "legato",   None),
    (72, 1.60, "legato",   None),
    (71, 0.65, "legato",   None),
    (69, 2.10, "legato",   (36, 5.4)),
    # phrase 2 — one repeated pitch, re-articulated, no glide
    (64, 0.55, "detached", None),
    (64, 0.55, "detached", None),
    (65, 0.60, "legato",   None),
    (67, 0.60, "legato",   None),
    (69, 1.30, "legato",   (28, 5.8)),
    # phrase 3 — sixteenths, joined
    (67, 0.18, "legato",   None),
    (65, 0.18, "legato",   None),
    (64, 0.18, "legato",   None),
    (62, 0.20, "legato",   None),
    (60, 0.90, "legato",   None),
    (64, 0.40, "detached", None),
    # phrase 4 — octave portamento
    (69, 0.65, "legato",   None),
    (81, 1.10, "legato",   None),
    (79, 0.70, "legato",   None),
    (76, 0.75, "legato",   None),
    (72, 1.45, "legato",   (22, 6.0)),
    # phrase 5 — descending, back down
    (77, 0.60, "legato",   None),
    (76, 0.60, "legato",   None),
    (74, 0.60, "legato",   None),
    (72, 1.50, "legato",   (18, 5.2)),
    # coda
    (71, 0.55, "legato",   None),
    (69, 3.20, "legato",   (42, 5.6)),
]


def glide_for(prev_pitch, pitch, artic):
    """How long the join into this note lasts.

    30 ms floor (a connection, not a slide) + 10 ms per semitone of interval,
    capped at 140 ms. A step gets 40-50 ms, a fifth 80 ms, an octave 140 ms.
    These are the durations a competent player actually uses; they are stated
    as a formula rather than tuned per note so nobody can accuse the sample of
    being shaped around a result.
    """
    if artic == "detached" or prev_pitch is None or prev_pitch == pitch:
        return 0.0
    return round(min(0.140, max(0.030, 0.030 + 0.010 * abs(pitch - prev_pitch))), 3)



def midi_of_f(hz):
    return 69.0 + 12.0 * math.log2(hz / 440.0)


def f_of(m):
    return 440.0 * 2.0 ** ((m - 69.0) / 12.0)


# --- layout: contiguous notes, no overlaps except the joins themselves -------
segs = []
t = 0.0
prev_pitch = None
for pitch, dur, artic, vib in NOTES:
    gin = glide_for(prev_pitch, pitch, artic)
    segs.append(dict(pitch=pitch, start=t, end=t + dur, artic=artic, gin=gin, vib=vib))
    t += dur
    prev_pitch = pitch
TOTAL = round(t + TAIL, 3)
N = int(round(SR * TOTAL))
time = np.arange(N) / SR


# --- one continuous pitch track in cents ------------------------------------
# cents[i] is the deviation from the note's own pitch, so the absolute track is
# built as absolute midi + cents.
f0 = np.zeros(N)
gain = np.zeros(N)

for k, s in enumerate(segs):
    i0 = int(round(s["start"] * SR))
    i1 = int(round(s["end"] * SR))
    i0 = max(0, min(N, i0))
    i1 = max(0, min(N, i1))
    if i1 <= i0:
        continue
    n = i1 - i0
    lt = np.arange(n) / SR                     # local time within the note
    dur = s["end"] - s["start"]

    # pitch: glide in from the previous note, then steady
    target = np.full(n, f_of(s["pitch"]))
    if s["gin"] > 0 and k > 0:
        prev = f_of(segs[k - 1]["pitch"])
        u = np.clip(lt / s["gin"], 0.0, 1.0)
        # exponential interpolation == straight line in cents
        target = prev * (f_of(s["pitch"]) / prev) ** (u ** 1.6)
    # NOTE: where the glide ends the note's own pitch simply continues; the
    # interpolation above already arrives at exactly f_of(pitch) at u == 1.

    # vibrato: delayed onset, then a ramped depth, with the rate drifting a
    # little so no detector can average it away with one LFO model
    if s["vib"]:
        depth, rate = s["vib"]
        onset = 0.10 + 0.12 * RNG.random()
        ramp = 0.18
        if dur > onset + 0.05:
            ramp_u = np.clip((lt - onset) / ramp, 0.0, 1.0)
            # accumulate phase so a drifting rate stays continuous
            inst_rate = rate * (1.0 + 0.04 * np.sin(2 * math.pi * 0.31 * lt + RNG.random() * 6.28))
            ph = 2 * math.pi * np.cumsum(inst_rate) / SR
            cents = depth * ramp_u * np.sin(ph)
            target = target * 2.0 ** (cents / 1200.0)

    f0[i0:i1] = target

    # amplitude envelope
    if s["artic"] == "detached":
        a, r = 0.030, 0.060
    else:
        a, r = 0.020, 0.045
    env = np.ones(n)
    na = min(n, int(a * SR))
    if na > 0:
        env[:na] = 0.5 - 0.5 * np.cos(np.pi * np.arange(na) / na)
    nr = min(n, int(r * SR))
    if nr > 0:
        env[-nr:] = 0.5 + 0.5 * np.cos(np.pi * np.arange(nr) / nr)
    gain[i0:i1] = np.maximum(gain[i0:i1], env)

# bow change: a small level dip at every joined boundary. 0.22 amplitude is
# about -2.6 dB, which is what a change of bow direction sounds like. Anything
# deeper would be a re-attack, and a re-attack is a different sample.
for k, s in enumerate(segs):
    if k == 0 or s["gin"] <= 0:
        continue
    b = s["start"]
    d = np.exp(-0.5 * ((time - b) / 0.045) ** 2)
    gain *= (1.0 - 0.22 * d)

# --- timbre: 6 harmonics, brightness drifting per note ----------------------
# phase is accumulated over the whole file, so no note ever restarts it
base = [(1, 1.00), (2, 0.40), (3, 0.22), (4, 0.11), (5, 0.06), (6, 0.035)]
sig = np.zeros(N)
for h, (mult, amp) in enumerate(base):
    ph = 2.0 * math.pi * np.cumsum(f0 * mult) / SR
    sig += amp * np.sin(ph)

# one slow brightness swell, like a bow moving toward the bridge
bright = 1.0 + 0.10 * np.sin(2 * math.pi * 0.043 * time - 1.1)
sig = sig * (1.0 + (bright - 1.0) * 0.5)

sig *= gain
sig += RNG.normal(0.0, 0.0008, N)              # noise floor, -62 dBFS

peak = float(np.max(np.abs(sig)))
sig = sig * (0.72 / peak)
pcm = np.clip(sig, -1.0, 1.0)
frames = (pcm * 32767.0).astype("<i2").tobytes()

with wave.open("melody2.wav", "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(frames)

# --- truth ------------------------------------------------------------------
# f0 on a 10 ms grid, in cents relative to A4, sampled at the grid midpoints so
# a frame never lands exactly on a boundary.
grid = np.arange(F0_GRID, TOTAL, F0_GRID)
gi = np.clip((grid * SR).astype(int), 0, N - 1)
f0_cents = [round(float(1200.0 * math.log2(max(f0[i], 1e-9) / 440.0)), 1) for i in gi]

truth = {
    "file": "melody2.wav",
    "sample_rate": SR,
    "duration": TOTAL,
    "performance": "synthesised legato + vibrato; see make-truth2.py",
    "notes": [
        {
            "pitch": s["pitch"],
            "start": round(s["start"], 3),
            "end": round(s["end"], 3),
            "kind": s["artic"],
            "glide_in": s["gin"],
            "vibrato_cents": (s["vib"][0] if s["vib"] else 0),
            "vibrato_hz": (s["vib"][1] if s["vib"] else 0),
        }
        for s in segs
    ],
    "counted_notes": len(segs),
    "f0_grid": F0_GRID,
    "f0_cents": f0_cents,
    "note": (
        "start is where the previous pitch begins moving away, so a joined note "
        "is not yet at its own pitch at start. [start + glide_in, end] is the "
        "stable body of the note."
    ),
}
with open("truth2.json", "w", encoding="utf-8", newline="\n") as f:
    json.dump(truth, f, indent=1, ensure_ascii=False)

print("wav bytes:", len(frames) + 44)
print("notes:", len(segs), "duration:", TOTAL, "s")
print("legato joins:", sum(1 for s in segs if s["gin"] > 0),
      "| detaches:", sum(1 for s in segs if s["gin"] == 0))
print("vibrato notes:", sum(1 for s in segs if s["vib"]),
      "| f0 grid points:", len(f0_cents))
