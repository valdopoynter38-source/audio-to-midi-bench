# Method, in full

Long form of what `README.md` summarises. Every number here is produced by
`verify.sh`; nothing is quoted from memory.

Two samples. **A** is 11 notes separated by silence, built to be answerable.
**B** is 27.89 s of 30 joined notes, built to be played. Sections 1–7 are sample A,
sections 8–10 are sample B, and the ruler in §2 applies to both.

## 1. Input

`melody.wav` — 7.60 s · 44.1 kHz · 16-bit · mono · 670,364 bytes.

`make-truth.py` writes the audio and `truth.json` in the same pass, so the answer
key cannot be influenced by any detector. Each note is a fundamental plus 6
harmonics; long notes carry 5.5 Hz / ±12 cent vibrato; attack 18 ms, release
70 ms; noise floor −62 dBFS; peak normalised to 0.72.

The 11 truth notes (all single-pitch):

| # | pitch | MIDI | start | end | dur |
|---|---|---|---|---|---|
| 1 | C4 | 60 | 0.000 | 0.586 | 0.586 |
| 2 | D4 | 62 | 0.586 | 1.190 | 0.604 |
| 3 | E4 | 64 | 1.190 | 1.788 | 0.598 |
| 4 | G4 | 67 | 1.788 | 2.386 | 0.598 |
| 5 | A4 | 69 | 2.386 | 2.990 | 0.604 |
| 6 | G4 | 67 | 2.990 | 3.587 | 0.597 |
| 7 | E4 | 64 | 3.587 | 4.191 | 0.604 |
| 8 | D4 | 62 | 4.191 | 4.789 | 0.598 |
| 9 | C4 | 60 | 4.789 | 5.985 | 1.196 |
| 10 | E4 | 64 | 6.000 | 6.150 | 0.150 |
| 11 | F4 | 65 | 6.150 | 6.300 | 0.150 |
| — | G4→A4 glide | 67→69 | 6.600 | 7.200 | 0.600 (not scored) |

Three traps, chosen on purpose:

| where | trap | what it stresses |
|---|---|---|
| 0.000 s / 4.789 s | the same C4 twice, 4.2 s apart | merging policy |
| 6.000 s / 6.150 s | two 0.15 s sixteenth notes | minimum-duration threshold |
| 6.600–7.200 s | glide, two defensible answers | excluded from scoring |

## 2. Scoring

The ruler measures two different populations and keeps them apart, because mixing
them is how a table ends up with a column nobody can reconcile.

**Truth side — 11 notes.** For each truth note, window `[start + 0.03, end − 0.03]`:

- the output pitch covering the largest share of that window is the engine's answer
- coverage < 50% → `missing`
- pitch differs → `wrong`, with the interval in semitones recorded

`correct + wrong + missing = 11`, exactly.

**Output side — every note the engine emitted.** One bucket each, tested in order:

| test | bucket |
|---|---|
| starts at or after 6.58 s, ends at or before 7.25 s | `glide` — not scored, two defensible answers exist |
| overlaps all truth notes for < 50% of its own duration | `spurious` |
| chosen as the answer for ≥ 1 truth note | `used` |
| otherwise | `dangling` |

`used + spurious + glide + dangling = notes out`, exactly.

`spurious` outranks `used`. aubio's `64@6.060–6.653` is the only candidate for
both short notes at 6.00 s and 6.15 s, so it answers two truth notes — and 0.35 s
of its 0.593 s lies outside any truth note, so it is also a blob. Counting it in
both columns is what made an earlier version of this table fail to add up (6 used
+ 2 spurious = 8, out of 7 notes). It is now counted once, in `spurious`, and the
two truth notes it answered are recorded separately as `answered_by_spurious`.

`analyze.js` computes both sums and **throws** if either fails, rather than
writing a score file that doesn't balance. `dangling` being non-zero is treated as
a defect in the ruler, not as a result.

It parses `.mid` directly (running status, meta events, sysex skipped) so the
page's own export can be scored without a converter in between.

## 3. Engines

### localmidi

`run-localmidi.js` contains `detectNotes` copied verbatim from the shipped
`converter.js` — not reimplemented, not "equivalent". Only the browser
`AudioBuffer` is replaced by a `Float32Array` read from the WAV.

Two independent paths to the same table:

- `out-localmidi.mid` — the 144-byte file the real page exported after clicking
  Convert on the real site
- `out-localmidi-s2.json` — the same detector run in Node

Both give 13 notes and 10/11. `verify.sh` checks both.

### pYIN

`librosa.pyin`, frame 2048, hop 512, fmin C2, fmax C7, sr 44100.

pYIN outputs per-frame pitch, not notes. The segmenter is ours:

1. round to the nearest semitone
2. merge adjacent frames of equal pitch
3. drop segments shorter than 50 ms
4. merge gaps shorter than 60 ms **only when the pitch is the same**

Step 4's condition matters: without the pitch check the whole melody collapses
into one note. The rule is fixed before scoring and was not tuned against the
answer key.

Frame accuracy over the scored region: **0.965** (544 frames).

librosa's `abs2`, `localmax`, `localmin` are replaced with plain-numpy versions
*unconditionally*, so the result does not depend on whether the machine has a
working numba. pYIN itself is pure numpy. Where numba or soxr cannot be imported
at all (broken DLLs on some Python 3.13 builds), a pass-through stub keeps
`import librosa` working; the stub is never called.

### aubio

`aubionotes` 0.4.6 prints this on stderr on every run, no flags required:

```
warning: onset threshold not supported yet
```

That is aubio's own admission that the onset-threshold parameter is not wired up.
It is the primary evidence here; everything below is corroboration. Captured in
`results/aubio-stderr.txt`: one distinct line, printed by 72 of 72 runs.

Corroboration: a sweep of 6 pitch methods × 4 onset thresholds × 3 minimum
inter-onset intervals = 72 runs. All 72 produce the same 7 notes
(`60,64,67,69,64,64,67`). `run-aubio.js` reports
`distinct outputs across all combos: 1`.

Order matters. 72 identical outputs is an inference — 72 samples, all equal,
therefore the knobs do nothing. The stderr line is a statement from the tool
itself. The two agree, so the sweep is included as a check, not as the argument.
There is no "you tuned it badly" explanation available for this result.

## 4. Results

Truth side, `correct + wrong + missing = 11`:

| engine | correct | wrong | missing |
|---|---|---|---|
| localmidi | 10/11 | 1 | 0 |
| pYIN | 11/11 | 0 | 0 |
| aubio | 6/11 | 5 | 0 |

Output side, `used + spurious + glide + dangling = notes out`:

| engine | notes out | used | spurious | glide | dangling |
|---|---|---|---|---|---|
| localmidi | 13 | 11 | 0 | 2 | 0 |
| pYIN | 14 | 11 | 0 | 3 | 0 |
| aubio | 7 | 5 | 2 | 0 | 0 |

**The aubio row is the one that needs a sentence, because it looks impossible.**
6 correct + 5 wrong + 0 missing means all 11 truth notes were claimed — but aubio
only emitted 7 notes. Both numbers are right. Five of aubio's notes are long
enough to span more than one truth note, so **5 estimated notes claim all 11 truth
notes**: `60@0.052–1.254` answers the C4 at 0.000 s correctly and the D4 at
0.586 s wrongly; `69@2.456–3.657` does the same to two notes; `64@3.657–6.060`
answers three. Six of those eleven claims are right, five are wrong by 1–4
semitones, and no truth note goes unclaimed. The 7 outputs split as 5 used + 2
spurious — aubio's two wasted notes are at the end, one of them the 0.593 s blob
over the two sixteenths.

Note by note:

- **localmidi** — the only error is 6.000 s: truth E4 (64), output D♯4 (63), −1
  semitone. Boundary errors on the other 10 notes are ≤ 15 ms.
- **pYIN** — all 11 correct, including both 0.15 s notes. It splits the glide
  into 67 / 68 / 69; the truth has two defensible answers there, so it is not
  scored.
- **aubio** — all 5 errors are "kept the previous pitch" (−2, +2, +2, +4, −1
  semitones). It only switches when the new pitch is far enough away, so the
  stepwise run loses four notes.

## 5. Duration histogram (supporting, not evidence)

| duration | truth | localmidi | pYIN | aubio |
|---|---|---|---|---|
| <0.2 s | 2 | 2 | 4 | 0 |
| 0.2–0.5 s | 0 | 2 | 1 | 0 |
| 0.5–1.0 s | 8 | 8 | 8 | 4 |
| >1.0 s | 1 | 1 | 1 | 3 |

The histogram shows aubio swallowing short notes, but not *which* note is wrong
or by *how many semitones*. That is why the error positions are the primary
evidence and this table is not.

## 6. The 23 ms frame

`frames.js` reproduces the frame table around 6.000 s and writes `frames.json`,
including the 1024 real samples of the boundary frame.

```
frameSize = min(8192, 2 ** floor(log2(sr / 27)))   -> 1024 samples = 23.2 ms at 44.1 kHz
hop       = frameSize / 4                          -> 256 samples  = 5.8 ms
lag search: 31 .. min(floor(sr/55), frameSize/2)   -> capped at 401
midi range: 28 .. 96
```

At 5.985 s the frame holds 15 ms of C4 and 8 ms of E4. The best lag is 142
(310.6 Hz → MIDI 63). The next frame and all 25 after it give lag 134
(329.1 Hz → MIDI 64), which is correct. But

```js
if (Math.abs(frame.pitch - active.pitch) <= 1)
  active.end = frame.time;
```

treats one semitone as the same note, so 63 becomes the label and the correct
frames are absorbed into it. One wrong frame, one wrong note.

## 7. Not included

**Basic Pitch** (Spotify) was attempted and dropped. The web app accepted the
file through a real drag-and-drop event (`Input.dispatchDragEvent` with
`data.files`) and showed `Converting notes to MIDI`, but never finished;
`DOM.setFileInputFiles` was cleared immediately by the page. The pip package has
no Python 3.13 wheel. No score was estimated for it. An engine missing from the
table is missing on purpose.

---

# Sample B — 27.89 s, 30 notes, joined

## 8. How the performance was generated

`make-truth2.py` writes `melody2.wav` and `truth2.json` in one pass. The answer key
still exists before any detector runs; that is not the thing that changed. What
changed is that the audio is not a sequence of rendered notes.

There is **one continuous pitch track** `f0(t)` over the whole file, and the
waveform is synthesised from it with accumulated phase, so phase never resets at a
note boundary and there is no click for a detector to lock onto. Every note
contributes an interval of that track:

| element | how it is set | why |
|---|---|---|
| join length | `0.030 + 0.010 × \|Δsemitones\|`, capped at 0.140 s | a step is connected (40–50 ms), a fifth is 80 ms, an octave is a slide (140 ms). A constant 90 ms everywhere would have been a portamento study, not a performance |
| join shape | exponential in cents, eased as `u^1.6` | pitch leaves slowly and arrives, which is what a player does |
| vibrato | per note: onset delay 100–220 ms, ramp 180 ms, rate 4.6–6.4 Hz with ±4 % drift, depth 18–42 cents | one global LFO is the thing a tracker can average away |
| attack / release | 20 / 45 ms on joined notes, 30 / 60 ms on detached ones | bowed, not plucked |
| bow change | −2.6 dB dip, 45 ms wide, at each join | a bow change is a level event as well as a pitch event. Deeper would be a re-attack and a different sample |
| detaches | 3 of them, with real silence | so not every boundary is a join |
| noise | −62 dBFS | same floor as sample A |

`truth2.json` records, per note: `start`, `end`, `glide_in`, `kind`,
`vibrato_cents`, `vibrato_hz`. And once more at the file level: **`f0_cents`, the
pitch track on a 10 ms grid**, in cents relative to A4.

`start` is where the previous pitch begins moving away, not where this note's pitch
arrives. `[start + glide_in, end]` is the stable body. Both are in the file so a
reader can recompute either window.

## 9. Does the file contain the curve it claims?

`check-synth.py` estimates the pitch independently — pYIN, no note segmentation, no
knowledge of the truth — and compares it to `f0_cents` on the same grid.

```
grid points: 2716 | midi match: 0.9801
body  median |err| 0.0 cents  p95 7.2  max 14.0
join  points 153 median signed -6.9 cents
```

`body` is samples where truth says the pitch is steady and the note is at least
60 ms old. Median error 0.0 cents, 95th percentile 7.2. The waveform on disk is the
curve in the key file, and this is checked on every run of `verify.sh` rather than
asserted once in a commit message.

`grid points: 2716` is not the length of `f0_cents` — that is 2788. The other 72 are
grid points where pYIN's nearest frame is further than the grid tolerance away or is
unvoiced, so the matcher skips them. Both numbers are in the report
(`grid_points`, and `f0_cents` in `truth2.json`) so the gap is visible rather than
implied, and `verify.sh` diffs the whole report: if that gap ever grew, the diff
would say so.

`join` is samples inside a glide, where the pitch is moving by design. It is
reported and never counted as an error; the median −6.9 cents says the glide leans
slightly flat of the straight line, which is a property of the easing, not a defect.

## 10. Results, and the two mechanisms

Truth side, `correct + wrong + missing = 30`; output side,
`used + spurious + glide + dangling = notes out`:

| engine | correct | wrong | missing | notes out | used | onset median | truth notes sharing one output |
|---|---|---|---|---|---|---|---|
| localmidi | 14/30 | 16 | 0 | 22 | 22 | +12 ms | 8 |
| pYIN | 30/30 | 0 | 0 | 29 | 29 | +48 ms | 1 |
| aubio | 9/30 | 21 | 0 | 30 | 30 | +58 ms | 0 |

**localmidi welds notes together.** 30 notes in, 22 out. All 30 truth notes get an
answer, but from only 22 outputs, so `notes_sharing_an_output = 8` — and that 8 is
arithmetic, not a count of joins: it is `notes_with_an_answer −
distinct_outputs_answering` = 30 − 22, the number of truth notes that have to
double up. The joins themselves are a different number. Counted per output —
*which outputs cover at least half the duration of two or more truth notes* — **7
of the 22 outputs do, and those 7 absorb 15 of the 30 notes**; the other 15 notes
get an output to themselves. That balances: 15 + 7 = 22 outputs, 15 + 15 = 30
notes. So there are two counts here of two different objects — **7 merged
outputs**, and **8 surplus notes** inside them (fifteen notes crammed into seven
outputs) — and the column in the table below is the second one.

The rule in `detectNotes` is

```js
if (active && Math.abs(frame.pitch - active.pitch) <= 1) { active.end = frame.time; ... }
```

and it fails on a join in two distinct ways, depending on the interval:

| join | interval | output | reports |
|---|---|---|---|
| 69→67 | 2 st | `68@1.457–3.657` | the semitone in between |
| 69→67 | 2 st | `68@12.161–13.642` | the semitone in between |
| 81→79 | 2 st | `80@16.260–17.943` | the semitone in between |
| 72→71 | 1 st | `72@5.596–7.761` | the first note's pitch |
| 64→64→65 | 0, then 1 st | `64@9.839–11.558` | the first note's pitch |
| 77→76 | 1 st | `76@20.196–21.368` | the second note's pitch |
| 72→71 | 1 st | `72@21.972–24.004` | the first note's pitch |

(*all seven are in `results/b/out-localmidi-s2.json`*)

On a **two-semitone** join the 23 ms frame that straddles it reads the semitone
*between* them — 68 for 69→67 — and 68 is within one semitone of both, so it
extends the first note, then the second, and the two collapse into a single note at
a pitch neither of them has. That is the first three rows, and the first of them is
2.2 s of one note standing in for two.

A **one-semitone** join needs nothing that exotic. Every frame is already within
one semitone of both plateaus, so no frame ever contradicts `active`, the boundary
is never confirmed, and one note simply swallows the other. Which pitch survives is
just whichever plateau the detector had locked onto — the first note's in three of
these four rows, the second's in `77→76`; that is a detail of the trace, not a
separate mechanism. Had the truth file only used two-semitone joins, this half of
the bug would have been invisible.

This is the same mechanism as sample A's single wrong note (§5), one step further:
there the transitional frame made a note *wrong*, here it makes two notes *one*.
Same 23 ms window, same one-semitone tolerance, larger consequence.

**aubio reports a pitch from a moment it is not looking at.** Its notes are 58 ms
late, and the pitch it attaches to each is the pitch of the audio about 30 ms
*before* that onset:

```
pitch_offset_ms: -30   pitch_offset_match: 29/30
```

That number is produced by `analyze.js`, not typed: it scans offsets from −200 to
+80 ms in 10 ms steps and keeps the one whose pitch curve best reproduces what the
engine reported. At −30 ms it matches 29 of 30; its neighbours at −20 and −40 ms
match 22 and 12. Because the grid is 10 ms, read that as "about 30 ms", not as a
calibration.

On sample A the 30 ms of lookback lands in silence or in a steady tone and costs
nothing. Here it lands inside a join, so the pitch is whatever the glide was doing
at that instant — which is why aubio's errors are ±1–2 semitones on steps and up to
7 on the octave portamento.

**The control.** "Your sample is weird" is the obvious reply to 9/30, and it is
worth answering with an experiment rather than a paragraph. `probe-steady.js` cuts
each note's stable body out of the same file, pads it with 0.25 s of silence at each
end, and runs the same `aubionotes` with the same `-p default` on that alone. Only
the neighbours are gone.

```
probe: 26/26 isolated bodies read correctly (4 too short to ask)
```

26 of 26. Every note that has a body long enough to ask about is read correctly
when nothing is next to it. The timbre is not the problem, the vibrato is not the
problem, and no parameter would fix it — aubio's own stderr already says the
parameters are not wired up (§3). The join is the problem, and the join is what a
real performance is made of.

Four notes are skipped by the probe because their bodies are under 300 ms. A 130 ms
fragment is not a fair question for a note-level tool and we would rather skip it
than dress it up.
