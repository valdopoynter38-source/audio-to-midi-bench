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

**The time axis is measured before either side is touched.** An engine's onsets can
carry a fixed offset, and comparing raw timestamps would measure that offset instead
of the engine. Every output start and end is shifted by `−align.json[engine]` on
entry to `score()`, before any window is applied — but only when `align.json`
actually carries a constant. This round it carries none: all three engines are
`withheld`, so nothing is shifted and every number here is raw. Measurement and
gates are §10. Nothing is aligned per file: a constant that changed with the sample
would be a fudge, not a ruler.

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

`match.js` answers it with one fixed rule — for each truth note, among the outputs
with the same pitch starting within ±150 ms, take the nearest; the delta is
`out.start − truth.start`; report the median. `measure-onset.js` applies it to a
file and reports readings; it never writes a constant. `align.js` applies it to
eleven files of the same condition and decides.

Two gates, both fixed before any number was read:

1. **coverage** — the engine spoke about at least 0.9 of the notes on *every*
   sample used to read the constant. "Spoke" means an output starting within
   ±150 ms, **pitch ignored**. One denominator, on every sample.
2. **band** — at least five samples, and the band of the per-sample medians
   (max − min) is at most 10 ms. Not a pairwise difference.

The condition is silence between every note. The material was fixed in advance:
plain (`s1`), three vibrato rates (`s2`–`s4`), three glide lengths (`s5`–`s7`), a
low register (`s8`), a high register (`s9`), plus A and C. Eleven samples.

| engine | A | C | s1 | s2 | s3 | s4 | s5 | s6 | s7 | s8 | s9 | band |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| pYIN | +3 | −11 | −7 | −3 | −6 | −8 | −8 | −1 | −5 | 0 | −6 | **14 ms** |
| localmidi | −12 | −13 | −14 | −14 | −12 | −15 | −12 | −15 | −12 | **+1** | **−17** | **18 ms** |
| aubio | +57 | +55 | +51 | +52 | +55 | +53 | +55 | +53 | +52 | — | +53 | 6 ms |

**Nothing passes, so nothing is subtracted.** `align.json` carries an empty
`constants_ms` and three `withheld` entries. Every onset in every table is raw.

**One denominator, and it is `spoken`.** The two failures are different. localmidi
labels one note on A a semitone low; that is an error to record, and it is still an
answer to "something starts here". aubio says nothing at all about four notes on A
and twelve on `s8`; that is a refusal, and it makes its median a description of its
own selection. A gate that read `matched` would punish the first as if it had
stayed silent, so the gate reads `spoken` on every sample and `matched` is printed
beside it and used for nothing.

That choice has a consequence worth stating, because it is where a ruler quietly
grows a second scale. On sample B localmidi is `spoken 30/30` but `matched
14/30 = 0.47`. If the gate read `matched`, B would fail it. B is not a sample the
constant is read from — it is the legato sample, and its low `matched` count is the
merged-note finding of §11, not a selection — but the rule has to be the same
everywhere. An earlier draft read `spoken` on A and quoted `matched` on B; that is
two scales, and this section now has one.

**Nine samples, because two give one comparison.** pYIN is the standing proof: on
A and C alone it moves +3 → −11, 14 ms, which is 1.21 of its own 11.61 ms hop. A
2 ms difference between two samples is a pair that happened to agree — any two
samples can be picked to agree. A band over eleven samples of material fixed in
advance cannot be picked. If the constant were a function of the material, the
three vibrato rates and the three glide lengths would move it; they do not.

**localmidi's 18 ms is the register, not the material.** Its nine mid-register
samples (MIDI 55–69) sit at −12 to −15, a band of 3 ms. The register moves it by
18: +1 at MIDI 49–54, −17 at MIDI 72–86. That is not a constant asking for a wider
bar; it is a function of pitch, and a per-register constant would need its own
reproduction test with samples inside each register, which this repository does
not have. Hence `withheld`, with the band and the three levels in the reason.

A caveat that belongs in the text rather than a footnote: on `s8` localmidi
reports every note below MIDI 42 as 89. Its lag search stops at
`frameSize/2 = 512` samples, which is 86 Hz, so 82 Hz has no lag to lock onto and
the detector returns the top of its range. Only 6 of the 12 notes have a
same-pitch match, and `+1` is a median off those six. `spoken` is 12/12, so the
coverage gate passes on that; the number is labelled in `align.json` as a reading
off six notes.

**What the number is made of.** A constant can be a lattice convention (discrete,
one hop wide) or an analysis delay (continuous). They are two objects and must be
named separately. `probe.wav` puts one pitch, one envelope, five onsets at five
phases of a 512-sample hop; `probe-report.js` writes `results/timebase.json`:

| engine | hop | timestamp is | frame-centre part | probe median | probe band |
|---|---|---|---|---|---|
| pYIN | 11.61 ms | frame **centre** | 0 ms | −7.6 ms | 13.7 ms |
| localmidi | 5.81 ms | frame **first** sample | −11.61 ms | −12.0 ms | 4.9 ms |
| aubio | 5.81 ms | frame **last** sample | +2.9 ms | +57.0 ms | 3.9 ms |

localmidi's probe band is smaller than a hop — the five deltas swing 4.9 ms
because where the onset falls inside the 23 ms frame is quantised — and its median
sits at its frame-centre convention (−11.61) plus half a millisecond of threshold
crossing. pYIN's band is larger than a hop, because a note can start on frame k or
k+1. aubio's +57 is 2.9 ms of frame convention and about 54 ms of its own onset
smoothing; the first part is measured, the second is bounded as "the rest" because
this repository does not run `aubionotes` with its filter disabled.

**pYIN's 14 ms is one hop and a bit.** `grid.js` finds the finest hop that explains
every reported start: 512 samples (11.61 ms) for pYIN, 256 (5.81 ms) for the other
two. The three share the fine grid; pYIN uses every second point. Its mean moves as
well (+1.3 → −9.8), so the shift is in the whole distribution, not in the choice of
statistic: which lattice point a truth onset snaps to depends on where it falls
inside the hop, and that is a property of the file. There was never a sub-hop
number to write down; the 10 ms bar and the 14 ms band only say so. Widening the
bar to 15 to let a 1.2-hop number through would be the same move as shortening the
joins until aubio looked right, performed on the ruler instead of on the sample.

**The first note of every sample is excluded, on the condition.** It starts at
t = 0 with no silence in front of it, so every engine fires on the first frame and
its delta is 0 by construction. That is a different measurement from the other
notes, and mixing it in pulls each median towards zero. The exclusion is
`LEAD_IN = 0.05` in `align.js`, it is counted as `notes_dropped_no_lead_in`, and
it is not applied to the scoring tables.

**57, 61, 59 are not the same number, and the ±10 ms test was not evidence.** The
three medians come from 6, 4 and 9 notes — three different subsets — so a 4 ms
spread is a spread between subsets. And "every matched note lies within 10 ms of
its own median" is arithmetic: the median is computed from those same n notes, so
with n = 4 it cannot fail. What survives is narrower and true: on the notes aubio
answers it reports them 52–61 ms late. That describes those notes and says nothing
about the ones it does not answer. aubio's 6 ms band across eleven samples is the
tightest of the three and changes nothing: the medians are over a subset it chose,
which is what gate 1 refuses, and on `s8` the subset is empty.

`"align_status": "withheld"` is never written as `"align_ms": 0`, because 0 would
read as "we measured zero" — a different object. `analyze.js` prints the reason out
of `align.json` instead.

The pairing rule above is the only one in the repository. `analyze.js` scores the
onset column of §11 with the identical rule, so the two tables give the same number
for the same engine and file (+29 / +48 / +59 on B). It is deliberately *not* the
output that answered the note: on a merged note that output carries the neighbour's
onset, and the same offset would then be reported twice, differently, in two places.

**pYIN's and localmidi's numbers are not the same on the joined files.** +3 → 82 →
48 and −12 → 64 → 29. Whatever those are, they are not delays. They are how far each
engine's note boundary slips when the previous note is still sounding, and that is
a finding about the engine — the exact thing the joined sample exists to measure.
With no constant passing the gates, nothing is subtracted anywhere, so the onset
column of §11 is raw for all three.

This is why the order matters more than the numbers. If the sample had been tuned
until aubio's onsets looked right — and shortening the joins is exactly what a
tempted author would do — the 60 ms would have been absorbed into the sample, the
constant would never have been written down, and every join measurement afterwards
would have been a comparison between two time axes known to be 58 ms apart. A
ruler that bends to fit a tool cannot then be used to judge it. The same sentence
applies to the bar: 10 ms was fixed before these numbers existed, pYIN's band came
out at 14, and widening the bar to 15 to let a one-hop number through would be that
same move performed on the ruler instead of on the sample.

The 90 ms file is kept for a different job now. `python make-truth2.py 0.090
melody2-90` rebuilds it byte for byte (the generator is seeded and the glide length
consumes no random numbers), and `verify.sh` re-runs all three engines on it and
diffs the onset report. It is not a sample to rank engines on — rankings belong to
the shipped file — and it no longer carries any cross-check on the constant,
because two samples are not a band. What it still shows is what aubio costs there:
it drops from 9/30 to 4/30, because every join in that file is 90 ms, which is past
the point where its lookback still lands nearer the target than the previous note
(§11).


## 11. Results, and the two mechanisms

Truth side, `correct + wrong + missing = 30`; output side,
`used + spurious + glide + join_pieces + dangling = notes out`:

| engine | correct | wrong | missing | notes out | used | onset raw → aligned | merged outputs / notes |
|---|---|---|---|---|---|---|---|
| localmidi | 14/30 | 16 | 0 | 22 | 22 | +29 ms raw | 7 / 15 |
| pYIN | 30/30 | 0 | 0 | 29 | 29 | +48 ms raw | 1 / 2 |
| aubio | 9/30 | 21 | 0 | 30 | 30 | +59 ms raw | 0 / 0 |

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
file — and answers only 4 notes of 30 at all, which is why that file is no longer
used to confirm any constant. Shortening joins makes this engine worse at pitch and
leaves localmidi's merge count unchanged at 7 outputs / 15 notes. One sample could
not have shown both.

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
