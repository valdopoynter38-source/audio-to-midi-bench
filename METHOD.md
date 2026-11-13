# Method, in full

Long form of what `README.md` summarises. Every number here is produced by
`verify.sh`; nothing is quoted from memory.

Two samples. **A** is 11 notes separated by silence, built to be answerable.
**B** is 27.89 s of 30 joined notes, built to be played. Sections 1–7 are sample A,
sections 8–11 are sample B, and the ruler in §2 applies to both.

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

**The time axis is aligned before either side is touched.** An engine's onsets can
carry a fixed offset — aubio's do, by 57 ms — and comparing raw timestamps measures
that offset instead of the engine. Every output start and end is therefore shifted
by `−align.json[engine]` on entry to `score()`, before any window is applied. The
constants are measured on sample A only, where silence makes "the note starts here"
unambiguous, and applied to every sample; the measurement and its three-file check
are §10. Nothing is aligned per file: a constant that changed with the sample would
be a fudge, not a ruler.

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
| not used, but starts inside a note's join window `[start, start + glide_in]` | `join_piece` |
| otherwise | `dangling` |

`used + spurious + glide + join_pieces + dangling = notes out`, exactly.

`join_piece` exists because `dangling` was doing two jobs. An output that starts
inside a join and answers nothing is a glide cut in two: it is on real notes, so it
is not `spurious`, and it is not a lost output, so treating it as a ruler defect
would have been the wrong alarm. aubio produces exactly one of these, and only on
the 90 ms version of sample B — the rule showed up because the accounting refused
to drop it.

`spurious` outranks `used`. aubio's `64@6.060–6.653` is the only candidate for
both short notes at 6.00 s and 6.15 s, so it answers two truth notes — and 0.35 s
of its 0.593 s lies outside any truth note, so it is also a blob. Counting it in
both columns is what made an earlier version of this table fail to add up (6 used
+ 2 spurious = 8, out of 7 notes). It is now counted once, in `spurious`, and the
two truth notes it answered are recorded separately as `answered_by_spurious`.

**A second axis: `merged`.** Which outputs cover at least half the duration of two
or more truth notes, and which truth notes they cover. This is not a bucket and it
does not enter any sum above: it says how the answer was *shaped*
(one output standing in for two notes) while `correct/wrong/missing` says whether
the pitch was *right*. A note can be both correct and merged, so the two cannot be
mutually exclusive — the axis that is closed is
`merged_notes + solo_notes = counted_notes`, and `merged_notes ≤ answered` is
asserted, because a merged note was answered by definition and can never be
missing. Merging and missing are different errors and are never added together.

**Vibrato notes are never averaged with steady ones.** A truth note with
`vibrato_cents > 0` swings 18–42 cents at 5–6 Hz. An engine that reports one pitch
per note is reporting a value sampled at an arbitrary phase of that swing, so its
"average error" on those notes is not a measurement of anything. The two groups are
reported separately (`pitch_error.steady_median_abs_cents` and
`.vibrato_median_abs_cents`), and each vibrato note's envelope peak-to-peak is
reported beside it, so the number that a single value had to represent is visible.
The envelope itself is `f0_cents` in the truth file.

`analyze.js` computes both sums and **throws** if either fails, rather than
writing a score file that doesn't balance. `dangling` being non-zero is treated as
a defect in the ruler, not as a result; the two cases that looked like defects were
`join_piece` (above) and are now named.

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

## 10. The time axis is measured, not assumed

Three engines, three onset behaviours, and one question that has to be settled
before any of the results mean anything: is the offset in their timestamps a
property of the tool or a reaction to the sample?

`measure-onset.js` answers it with one fixed rule — for each truth note, among the
outputs with the same pitch starting within ±150 ms, take the nearest; the delta is
`out.start − truth.start`; report the median. Run on three files: sample A (eleven
notes, silence between every pair), sample B at a fixed 90 ms (the version this
repository used before join length was derived from the interval), and B as shipped
(30–140 ms):

| engine | A (silence) | B at 90 ms | B 30–140 ms | time axis |
|---|---|---|---|---|
| pYIN | 0 ms — 11/11 | +82 ms — 29/30 | +48 ms — 29/30 | constant 0 ms |
| localmidi | −11 ms — 10/11 | +64 ms — 12/30 | +29 ms — 12/30 | constant −11 ms |
| aubio | +57 ms — **6/11** | +61 ms — 4/30 | +59 ms — 9/30 | **withheld** |

The number after the dash is the denominator: how many of the file's notes had any
output of the right pitch within ±150 ms to pair with. **That column decides, not
the millisecond.**

**A constant may only be read off a set the tool did not choose.** pYIN answered 11
of 11 notes on silence and 29 of 30 on the joined file; localmidi 10 of 11, and the
one it drops is the note it labels a semitone low — a documented error, not a
selection. Those denominators are the file. aubio answered 6 of 11 on the easiest
recording here and said nothing about the other five, then 4 of 30 and 9 of 30 on
the joined files. Its median is taken over the notes it decided to speak about.
Subtracting that from what the same engine does elsewhere calibrates the ruler on
its own choice of which notes to report — the same mistake as shortening the joins
until the offset disappeared, moved one step to the left. `align.json` therefore
carries pYIN and localmidi and a `withheld` entry for aubio; the score file says
`"align_status": "withheld"`, never `"align_ms": 0`, because 0 would read as "we
measured zero".

**57, 61, 59 are not the same number, and the ±10 ms test was not evidence.** The
three medians come from 6, 4 and 9 notes — three different subsets — so a 4 ms
spread is a spread between subsets. And "every matched note lies within 10 ms of
its own median" is arithmetic: the median is computed from those same n notes, so
with n = 4 it cannot fail. What survives is narrower and true: on the notes aubio
answers it reports them 52–61 ms late (per-file range 8, 3, 3 ms). That describes
those notes and says nothing about the 21 it does not answer. The earlier version of
this document claimed the opposite; the claim is withdrawn here and in the README.

The pairing rule above is the only one in the repository. `analyze.js` scores the
onset column of §11 with the identical rule, so the two tables give the same number
for the same engine and file (+29 / +48 / +59 on B). It is deliberately *not* the
output that answered the note: on a merged note that output carries the neighbour's
onset, and the same offset would then be reported twice, differently, in two places.

**pYIN's and localmidi's numbers are not the same on the three files.** 0 → 82 → 48
and −11 → 64 → 29. Whatever those are, they are not delays. They are how far each
engine's note boundary slips when the previous note is still sounding, and that is
a finding about the engine — the exact thing the joined sample exists to measure.
They are therefore *not* aligned away from the shifted record: `align.json` uses
their silence-file values only, and the residual on joined material (the "aligned"
column of §11) is the measurement.

This is why the order matters more than the numbers. If the sample had been tuned
until aubio's onsets looked right — and shortening the joins is exactly what a
tempted author would do — the 60 ms would have been absorbed into the sample, the
constant would never have been written down, and every join measurement afterwards
would have been a comparison between two time axes known to be 58 ms apart. A
ruler that bends to fit a tool cannot then be used to judge it.

The 90 ms column is kept for this check alone. `python make-truth2.py 0.090
melody2-90` rebuilds it byte for byte (the generator is seeded and the glide length
consumes no random numbers), and `verify.sh` re-runs all three engines on it and
diffs the onset report. It is not a sample to rank engines on — rankings belong to
the shipped file. It is also the instrument that withdrew aubio's constant: on that
file aubio answers 4 notes of 30, so the check has nothing to stand on, and what
looked like "the same number on three files" was three different subsets landing
4 ms apart. Its scores are committed only to show what the check cost:
aubio drops from 9/30 to 4/30 there, because every join in that file is 90 ms,
which is past the point where its lookback still lands nearer the target than the
previous note (§11).

## 11. Results, and the two mechanisms

Truth side, `correct + wrong + missing = 30`; output side,
`used + spurious + glide + join_pieces + dangling = notes out`:

| engine | correct | wrong | missing | notes out | used | onset raw → aligned | merged outputs / notes |
|---|---|---|---|---|---|---|---|
| localmidi | 14/30 | 16 | 0 | 22 | 22 | +29 → +40 ms | 7 / 15 |
| pYIN | 30/30 | 0 | 0 | 29 | 29 | +48 → +48 ms | 1 / 2 |
| aubio | 9/30 | 21 | 0 | 30 | 30 | +59 ms, not shifted | 0 / 0 |

**localmidi welds notes together.** 30 notes in, 22 out. All 30 truth notes get an
answer, but from only 22 outputs. The joins themselves are counted per output —
*which outputs cover at least half the duration of two or more truth notes* — and
**7 of the 22 outputs do, absorbing 15 of the 30 notes**; the other 15 notes get an
output to themselves. That balances: 15 + 7 = 22 outputs, 15 + 15 = 30 notes.

Do not confuse that with `notes_sharing_an_output = 8`, which is still reported in
the score file: it is `notes_with_an_answer − distinct_outputs_answering` = 30 − 22,
the number of *surplus notes*, not the number of joins. Both numbers are right and
they are different objects — 7 merged outputs, 8 surplus notes — which is why the
table above carries the pair `7 / 15` and not a single figure.

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

**aubio reports a pitch from a moment it is not looking at.** Its onsets are not
shifted — §10 withholds its constant — so its onset median is +59 ms on B, over the
9 notes of 30 it answers. The *pitch* is older than the onset: what it reports
matches the truth pitch curve about 30 ms **before its own onset**:

```
pitch_offset_ms: -30   pitch_offset_match: 29/30
```

That number is produced by `analyze.js`, not typed: it scans offsets from −200 to
+80 ms in 10 ms steps, measured from the engine's own (unshifted) onset, and keeps
the one whose pitch curve best reproduces what the engine reported. At −30 ms it
matches 29 of 30; its neighbours at −20 and −40 ms match 22 and 12. Because the
grid is 10 ms, read that as "about 30 ms", not as a calibration.

So the moment it reads is inside the join: it reports a point on the glide, not the
note. On sample A that same moment is silence or a steady tone and costs nothing;
here it costs the answer. No constant is needed to say that, and none is used —
the onset in question is the engine's own.

`score-aubio.json` carries the readings this predicts, bucketed by join length
(`join.join_by_glide_ms`):

| join | notes | read correctly | mean error |
|---|---|---|---|
| no join (3 detaches + the first note) | 4 | 4 | 0 |
| 40 ms | 6 | 5 | −0.17 st |
| 50 ms | 13 | 0 | +0.69 st |
| 60 ms | 1 | 0 | +2 st |
| 70 ms | 1 | 0 | +3 st |
| 80 ms | 3 | 0 | −4 st |
| 110 ms | 1 | 0 | −7 st |
| 140 ms | 1 | 0 | −11 st |

The error scales with the interval and flips sign with its direction — it overshoots
past the target on the way down, undershoots on the way up — which is what reading a
point on a glide looks like. Where the join is short enough, about 40 ms, the point
is already past halfway and rounds to the target: 5 of 6 right, and the boundary
sits near 45 ms. An earlier version of this document turned that observation into a
formula with `u = (27/G)^1.6` and claimed every join of 60 ms or more was predicted
to 0.2 of a semitone. The 27 came from subtracting the constant that §10 has since
withdrawn; the formula is gone with it. The measured table above stands on its own.

That is also the whole explanation of the 90 ms file: all of its joins are 90 ms, on
the wrong side of the cut-off, so aubio reads 4/30 there against 9/30 on the shipped
file — and answers only 4 notes of 30 at all, which is why that file withdrew the
constant instead of confirming it. Shortening joins makes this engine worse at pitch and leaves localmidi's merge
count unchanged at 7 outputs / 15 notes. One sample could not have shown both.

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
