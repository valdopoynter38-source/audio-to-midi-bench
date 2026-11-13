# Audio-to-MIDI: three engines, one performance, one ruler

Monophonic recordings whose pitches are known before any tool runs, pushed through
three pitch-to-MIDI engines. Every number below is reproduced by one command:

```bash
./verify.sh
```

28 byte-comparisons across the samples; a full run takes about twenty minutes on a
laptop, most of it pYIN (three runs) and the two 72-combination aubio sweeps. If
your run prints `0 differing`, you have the same tables we published.

**Sample A** — 7.60 s, 11 notes, every note separated by silence. Trap questions:
a repeated pitch, two 150 ms sixteenths, one glide. Engines can be ranked on it.

**Sample B** — 27.89 s, 30 notes, *played* rather than rendered: 26 joins whose
length is derived from the interval (40–140 ms), real vibrato, one octave
portamento. Sample A asks whether an engine can find a note. Sample B asks whether
it can find a note that never stops.

**Sample B at a fixed 90 ms** — the same performance with every join at 90 ms, the
version this repository used before the joins were derived from the interval. It is
not a third ranking; it exists to check one number, and it is rebuilt by the same
script.

## aubio says it about itself

`aubionotes` 0.4.6 prints this on stderr, every single run, with no flags added:

```
warning: onset threshold not supported yet
```

That is not our conclusion about aubio. That is aubio, on its own output stream,
telling you the knob is disconnected. It is the strongest piece of evidence in this
repository, and it is why aubio's 6/11 below cannot be answered with "you tuned it
badly" — there is nothing to tune.

`run-aubio.js` captures it rather than letting it scroll past:
[`results/aubio-stderr.txt`](results/aubio-stderr.txt) contains one distinct line,
printed by **72 of 72 runs**. `verify.sh` diffs that file too.

**If you upgrade aubio past 0.4.6 and it stops printing that line, this repository
will go red and that is the point.** `verify.sh` will report
`aubio-stderr DIFFERS` with `0/72 runs` — a version that rewires the onset knob has
fixed the thing this file documents, so the captured 72/72 no longer describes the
binary on your disk. That is a fix, not a regression. Re-run `run-aubio.js` and
commit the new stderr; the aubio column in the table will probably change too, and
it should.

We also swept 6 pitch methods × 4 thresholds × 3 intervals before we found that line.
All 72 combinations produce the same 7 notes. That sweep is ours; the line is theirs.
When you have a confession, you don't lead with the inference.

## Sample A — 11 notes, separated by silence

Two sides, and each one balances by itself. A note that is counted on one side is
counted on the other, so nothing falls between them:

**Truth side — the 11 notes.** `correct + wrong + missing = 11`

| engine | correct | wrong | missing |
|---|---|---|---|
| **pYIN** (librosa 1.0.1) | **11/11** | 0 | 0 |
| **localmidi** (this site) | **10/11** | 1 | 0 |
| **aubio notes** 0.4.6 | **6/11** | 5 | 0 |

**Output side — where each engine's notes went.** `used + spurious + glide + dangling = notes out`

| engine | notes out | used | spurious | glide window | dangling |
|---|---|---|---|---|---|
| pYIN | 14 | 11 | 0 | 3 (67/68/69) | 0 |
| localmidi | 13 | 11 | 0 | 2 (67/69) | 0 |
| aubio | 7 | 5 | 2 | 0 | 0 |

`used` is an output note the ruler picked as the answer for at least one truth
note. One output can answer several: **aubio's 5 used notes cover all 11 truth
notes**, because each of its notes is long enough to span more than one. That is
how 5 notes produce 6 correct and 5 wrong, and why aubio shows `missing 0` while
emitting only 7 notes. `glide window` is the 6.60–7.20 s region that is not
scored. `dangling` is an output with no home; it is 0 for all three, and
`analyze.js` refuses to write a score file if it ever isn't — the earlier version
of this table silently lost those notes, which is exactly the kind of hole a
reader finds before you do.

We are second. The one note we get wrong is explained to the sample in
[`METHOD.md`](METHOD.md) and in the video: it is a 23 ms analysis window landing on
a note boundary, not a tuning problem.

## Sample B — 30 notes, joined

Same ruler, and the input is no longer kind. `make-truth2.py` writes `melody2.wav`
and `truth2.json` in one pass, so the answer key still exists before any detector
runs. What changes is that the audio is a *performance*: one continuous pitch
track, 26 legato joins of 40–140 ms (scaled by the interval), per-note vibrato
(delayed onset, 4.6–6.4 Hz, 18–42 cents), three detaches, one octave portamento.
No note is separated from the next by silence except those three.

| engine | correct | wrong | missing |
|---|---|---|---|
| **pYIN** | **30/30** | 0 | 0 |
| **localmidi** | **14/30** | 16 | 0 |
| **aubio notes** 0.4.6 | **9/30** | 21 | 0 |

| engine | notes out | used | spurious | glide | join pieces | dangling | onset raw → aligned | merged outputs / notes |
|---|---|---|---|---|---|---|---|---|
| pYIN | 29 | 29 | 0 | 0 | 0 | 0 | +48 → +48 ms (29/30 paired) | 1 / 2 |
| localmidi | 22 | 22 | 0 | 0 | 0 | 0 | +29 → +40 ms (12/30 paired) | 7 / 15 |
| aubio | 30 | 30 | 0 | 0 | 0 | 0 | +59 ms, not shifted (9/30 paired) | 0 / 0 |

The same two-sided accounting holds; both sums balance in `results/b/score-*.json`.
Three things in that table need naming, because each one used to be something else:

- **onset raw → aligned.** The second number has the constant from
  [the ruler's time axis](#the-rulers-time-axis-before-the-sample-is-judged)
  removed, and only pYIN and localmidi have one. aubio's row has no second number
  on purpose: its constant was withdrawn, so its onsets are reported as they are.
  pYIN's constant is 0 so its number does not move, and localmidi's is −11 ms, so
  its number moves by exactly 11 — neither of them shrinks towards zero, which is
  how you can see their lag is not a delay. The pairing is the same rule as
  `measure-onset.js` (nearest same-pitch output inside ±150 ms, unmatched counted,
  never zero), so this column and the table below report the *same* number for the
  same engine; the count in brackets is how many of the 30 notes had anything to
  pair with. For localmidi 12 of 30: when it welds two notes into a note of the
  wrong pitch, there is nothing of the truth pitch near the boundary to pair with,
  and that is a reading too.
- **merged outputs / notes.** 7 of localmidi's 22 outputs each cover at least half
  of two neighbouring truth notes, and between them they swallow 15 of the 30. This
  is a **second axis, not a bucket**: it says how the answer was shaped, while
  correct/wrong/missing says whether the pitch was right. A note can be both
  correct and merged. `merged notes + solo notes = 30`, and a merged note can never
  be missing, because it was answered by definition.
- **join pieces.** An output that starts inside a join and answers nothing: one
  glide cut in two. It is not spurious (it is on real notes) and it is not a lost
  output, so it gets its own bucket instead of being pushed into either — aubio
  produces exactly one of these, on the 90 ms version of this file.

### The ruler's time axis, before the sample is judged

An engine that reports every note 60 ms late is not wrong about the notes, it is
offset. Comparing its timestamps to the truth as they arrive measures that offset
and calls it an error — and the error grows as the notes get shorter. On a 40 ms
join, a 60 ms delay is longer than the join itself, so a late onset lands in the
next note, and there is no longer any way to tell "misread the join" from "arrived
after it". That is the point at which a benchmark starts measuring its own ruler.

So the offset is measured on the recording where the question has an unambiguous
answer — sample A, eleven notes, every one separated by silence — and subtracted
from every onset before anything is compared, **but only for an engine that
answered that sample more or less in full**:

| engine | sample A (silence) | B at a fixed 90 ms | B as shipped (30–140 ms) | time axis |
|---|---|---|---|---|
| pYIN | 0 ms — 11/11 | +82 ms — 29/30 | +48 ms — 29/30 | constant **0 ms** subtracted |
| localmidi | −11 ms — 10/11 | +64 ms — 12/30 | +29 ms — 12/30 | constant **−11 ms** subtracted |
| aubio | +57 ms — **6/11** | +61 ms — 4/30 | +59 ms — 9/30 | **withheld — no shift** |

The column that decides is the fraction, not the millisecond.

**A constant may only be read off a set the tool did not choose.** pYIN answers 11
of 11 notes on silence and 29 of 30 on the joined file; localmidi 10 of 11, and the
one it drops is the note it labels a semitone low, which is a documented error and
not a selection. Those denominators are the file. aubio answers 6 of 11 notes on
the easiest recording in this repository — five notes it says nothing about — and 4
of 30 and 9 of 30 on the joined ones. Its median is taken over the notes it decided
to speak about. Subtracting that from what the same engine does elsewhere is
calibrating the ruler on aubio's own choice of which notes to report, which is the
same mistake as shortening the joins until the offset disappeared, moved one step
to the left. So `align.json` carries pYIN and localmidi, and a `withheld` entry for
aubio that says why. The score file says `"align_status": "withheld"`, not
`"align_ms": 0`, because 0 would read as "we measured zero".

**57, 61, 59 are not the same number.** An earlier version of this file called them
a constant, on two grounds that were both wrong. The medians come from 6, 4 and 9
notes respectively — three different subsets — so a 4 ms difference between them is
a difference between subsets, not evidence that anything is fixed. And the supporting
test, "100 % of matched notes lie within 10 ms of their own median", is arithmetic:
the median is computed from those same n notes, so with n = 4 it cannot fail. What
the numbers do say is small and true: on the notes it answers, aubio reports them
52–61 ms after the truth start (range 8, 3, 3 ms per file). That describes those
notes. It cannot speak for the ones it did not answer, and those are most of them.

**pYIN's and localmidi's numbers do move** — 0 → 82 → 48 and −11 → 64 → 29. Those
are not delays and must not be aligned away. They are how far each engine's note
boundary slips on joined material, which is a finding about the engine, not a
constant of the measurement. Subtracting them would delete the thing being measured
— and it does not even tidy the number: localmidi's residual on B goes from +29 to
+40, because the constant being removed is −11. A residual that grows when you
subtract a constant is not an offset.

The middle column is not a sample to rank engines on. It is the version of B this
repository used before the joins were derived from the interval, kept rebuildable
(`python make-truth2.py 0.090 melody2-90`) for exactly one purpose: to test the
constant on a file whose joins are different. It is also what withdrew aubio's: on
that file aubio answers 4 notes of 30, so the check has almost nothing to stand on,
and "the same number on three files" turned out to be three different subsets that
happened to land 4 ms apart. The instrument worked — it was the reading that was
wrong.

Rows are recomputed by `verify.sh` on every run and diffed against
`results/align.json`; the constants live in `align.json` and nowhere else, and a
tool that is not in it is not shifted.

### It is the join, and here is the control

Two different failures, one cause.

**localmidi welds notes together.** 30 truth notes come out as 22 outputs. Seven of
those outputs each cover at least half of two neighbouring notes, and between them
they swallow 15 of the 30 notes; the other 15 notes get an output of their own.
The pattern is exact, not statistical, and it comes in two forms:

*Two semitones apart* (three of the seven). The 23 ms window that straddles the join
reads the semitone *between* the two notes, and the rule `|Δpitch| <= 1` in
`detectNotes` treats that as "the same note" as *both* neighbours. 69→67 comes out
as one note at 68, `68@1.457–3.657`, within one semitone of both and correct for
neither; the same happens at the other 69→67 and at 81→79, which comes out as 80.

*One semitone apart* (the other four). Nothing so exotic is needed: every frame is
already within one semitone of both notes, so the boundary is never confirmed and
one note simply swallows the other — 72→71 becoming `72@5.596–7.761`, 77→76
becoming `76@20.196–21.368`, 72→71 again, and 64→65 inside a repeated note. A
benchmark made only of wide leaps would have shown the first three and none of
these.

**aubio reports a pitch from a moment it is not looking at.** No shift is applied to
its onsets — the constant was withdrawn, see above — so read them as they are: on
the 9 notes of 30 it answers, its median onset is +59 ms after the truth start. The
*pitch* it attaches is older than that: it matches the truth pitch curve about 30 ms
**before its own onset**, 29 of 30 notes on the 10 ms grid, and no other offset gets
close (`pitch_offset_ms` in `results/b/score-aubio.json`, scanned −200…+80 ms in
10 ms steps, neighbours at −20 and −40 ms match 22 and 12). So whatever moment it
reads, that moment is inside the join — and on sample A the same moment is silence
or a steady tone, which is why it costs nothing there.

That explains the shape of the failure without needing a constant. Bucketed by join
length, the notes it answers look like this (`join_by_glide_ms` in the same file):

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

The error grows in both directions and with the size of the interval, which is what
you expect if the reported pitch is just a point on the glide: which point depends
on how far into the join the engine looks, and how many semitones that point is
worth depends on the interval. Where the join is short enough — around 40 ms — the
point is already past halfway and rounds to the target, which is why 5 of those 6
are right and why the boundary sits near 45 ms.

This is also the reason the 90 ms version of the file scores 4/30 while the shipped
one scores 9/30: every join in that file is 90 ms, so every look lands nearer the
previous note than the next one. Shortening joins makes this engine *worse* at pitch
and makes localmidi *no* better at merging — one sample could not have shown both.

**The control.** `probe-steady.js` cuts each note's stable body out of the same
file, pads it with silence, and asks `aubionotes` about that alone — same binary,
same timbre, same vibrato, same `-p default`. Only the neighbours are gone:

```
probe: 26/26 isolated bodies read correctly (4 too short to ask)
```

Every single note is read correctly in isolation. So the 9/30 is not the timbre,
not the vibrato, and not a parameter anybody can turn: it is the join. That number
is also the reason this sample exists — an engine can be perfect on every note and
wrong on the line.

## Two videos use these numbers

- [Why one note came out a semitone low](https://youtu.be/ixl5BgC-FDo) — 1:02, only the 23 ms window
- [The most accurate audio-to-MIDI tool needs Python. The one you'll use doesn't.](https://youtu.be/6mU-EcX23oM) — 1:52, the three-engine comparison

The benchmark was built by [localmidi.com](https://localmidi.com/) (audio to MIDI in
the browser, nothing uploaded) because publishing a comparison you can't check is
worth nothing.

---

## 1. Why you can check this

The input is **synthesised**, not recorded. `make-truth.py` writes `melody.wav` and
`truth.json` together, so the answer key exists before any detector touches the
file. There is no "we listened and decided" step anywhere.

`melody.wav`: 7.60 s · 44.1 kHz · 16-bit · mono · 670,364 bytes.
Each note is a fundamental plus 6 harmonics, 5.5 Hz / ±12 cent vibrato on the long
notes, 18 ms attack, 70 ms release, noise floor −62 dBFS. Deterministic: same
script, same bytes.

Three deliberate traps:

| where | trap | what it stresses |
|---|---|---|
| 0.00 s and 4.80 s | the same C4, 4.2 s apart | note merging |
| 6.00 s and 6.15 s | two 0.15 s sixteenth notes | minimum-duration thresholds |
| 6.60–7.20 s | G4 gliding up to A4 | has two defensible answers, so it is **not scored** |

`melody2.wav`: 27.89 s · 44.1 kHz · 16-bit · mono · 2,459,942 bytes. Also
synthesised, and also with a key written in the same pass — but written the way a
player plays, not the way a score is read. One continuous pitch track, phase never
reset, so there is no click for a detector to lock onto; joins are exponential
glides in cents, 30 ms + 10 ms per semitone of interval, capped at 140 ms;
vibrato is per note with a delayed onset; the bow-level dip at each join is
−2.6 dB, which is what a bow change sounds like and not a re-attack.

**`truth2.json` also carries the pitch curve** the generator used, on a 10 ms grid,
in cents relative to A4. That makes "the truth is known" a statement about the
file on disk rather than about a script: `check-synth.py` estimates the pitch
independently with pYIN and compares,

```
body  median |err| 0.0 cents  p95 7.2  max 14.0
```

and `verify.sh` diffs that result. If the waveform ever stopped matching its key,
this repository would go red on the spot.

## 2. The ruler

**On the truth side**, for each truth note take the window
`[start + 0.03, end − 0.03]`:

- the pitch covering the most of that window is the engine's answer
- coverage < 50% → `missing`
- different pitch → `wrong`, with the interval in semitones recorded

**On the output side**, every emitted note goes into exactly one bucket, tested in
this order:

- inside 6.60–7.20 s → `glide window` (not scored)
- overlaps all truth notes for less than 50% of **its own** duration → `spurious`
- was picked as the answer for at least one truth note → `used`
- none of the above → `dangling` (must be 0)

`spurious` outranks `used` on purpose. aubio emits a 0.593 s blob at 6.060 s that
is the closest thing available for both of the 0.15 s notes at 6.00 s and 6.15 s,
so it answers two truth notes and is still mostly nothing — it is counted once, in
`spurious`, and the two notes it answered are recorded in `answered_by_spurious`
in `results/score-aubio.json`.

**Sample B adds two measurements, and only two.** Every engine reports one pitch
per note, so "score the note again without the join" is a different question that
returns the same answer for all three — it was measured, it moved by zero, and it
was dropped rather than shipped as a column. What does move:

- `onset_median_ms` — where the engine's note starts minus where the truth note
  starts. Positive means it reports the note late.
- `pitch_offset_ms` — the single offset (scanned −200…+80 ms in 10 ms steps, fixed
  in code) at which the truth pitch curve reproduces the pitch the engine
  reported. It says *when* the engine was looking, not that it was wrong.

One rule, applied identically to all three engines, in `analyze.js`.

## 3. How each engine was run

| engine | entry point | parameters |
|---|---|---|
| localmidi | `detectNotes` copied verbatim out of the shipped `converter.js`, driven by `run-localmidi.js`; cross-checked against the `.mid` exported by the real page (`out-localmidi.mid`) | default sensitivity 2 |
| pYIN | `librosa.pyin` | frame 2048 / hop 512 / fmin C2 / fmax C7 |
| aubio | `aubionotes` 0.4.6 | all 72 combinations swept, see §4 |

Two things we have to state plainly:

1. **pYIN does not output notes, only per-frame pitch.** The note segmenter is
   ours: round to nearest semitone → merge adjacent equal values → drop fragments
   under 50 ms → merge gaps under 60 ms *when the pitch is the same*. Part of
   pYIN's score is our segmenter's work. The rule is fixed in `run-pyin.py`; it is
   not tuned against the answer key.
2. **`aubionotes` 0.4.6 ignores its parameters — and says so.** The line it prints
   is quoted at the top of this file; the 72-run sweep that agrees with it is in §4.

## 4. The 72 combinations — and why they are the supporting evidence

The confession is at the top of this file; the number is here. `run-aubio.js`
sweeps 6 pitch methods × 4 onset thresholds × 3 minimum inter-onset intervals =
**72 runs**, and all 72 produce the identical 7 notes (`60,64,67,69,64,64,67`):

```
combos: 72
distinct outputs across all combos: 1
```

The same sweep is run on sample B as well, and also collapses to one distinct
output — on a 27.9 s joined signal instead of a 7.6 s detached one. Two signals is
not proof, but it removes the obvious objection that one pathological file agreed
with itself.

That sweep is an inference: 72 samples, all equal, therefore the parameters do
nothing. aubio's own stderr line is a statement. The two agree, so the sweep
costs nothing to include — but if you only read one of them, read the one aubio
wrote about itself.

The raw readings for all 72 runs are in
[`results/aubio-all.json`](results/aubio-all.json) and
[`results/aubio-sweep.tsv`](results/aubio-sweep.tsv); for sample B,
[`results/b/aubio-sweep.tsv`](results/b/aubio-sweep.tsv) carries every
combination's output and is diffed. The stderr capture, with its 72/72 count, is
in [`results/aubio-stderr.txt`](results/aubio-stderr.txt) and
[`results/b/aubio-stderr.txt`](results/b/aubio-stderr.txt).

## 5. Sample A: the one note localmidi gets wrong

`6.00 s`, truth `E4 (64)`, output `D♯4 (63)` — one semitone low.

The detector reads 1024 samples at a time (23.2 ms at 44.1 kHz) and hops 256
samples (5.8 ms). At 5.985 s that window still holds 15 ms of C4 and 8 ms of E4.
Autocorrelation over that mixed window peaks at lag 142 → 310.6 Hz → MIDI 63,
which is neither note.

The next frame is correct (lag 134 → 329.1 Hz → MIDI 64) and so is every frame
after it — 25 of them. But `|Δpitch| <= 1` counts as the same note, so 63 becomes
the label and the correct frames are absorbed into it. A 150 ms note comes out
wrong even though only one frame is wrong.

`frames.js` reproduces the whole frame table, including the 1024 real samples of
the boundary frame, into `frames.json`. That is the file the video's diagrams are
drawn from.

## 6. What is not here (either sample)

**Basic Pitch** (Spotify) was attempted and dropped: the web app accepted the file
via a real drag-and-drop event but never finished converting, and the pip package
has no Python 3.13 wheel. We did not estimate its score. An engine missing from
the table is missing on purpose.

## 7. Files

```
melody.wav          sample A, the input (deterministic, from make-truth.py)
truth.json          the 11 notes, written before any tool ran
make-truth.py       regenerates both
melody2.wav         sample B, the performed input (from make-truth2.py)
truth2.json         the 30 notes + the pitch curve on a 10 ms grid
melody2-90.wav      sample B with every join fixed at 90 ms (the pre-change version)
truth2-90.json      its key; `python make-truth2.py 0.090 melody2-90` rebuilds both
make-truth2.py      regenerates all of the above; joins, vibrato, envelope in one pass
librosa_shim.py     makes librosa importable and deterministic (both py scripts use it)
run-localmidi.js    shipped detectNotes + a WAV reader, no dependencies
out-localmidi.mid   the .mid the real page exported (144 bytes)
run-pyin.py         pYIN + our segmenter
run-aubio.js        72-combination sweep, captures aubio's stderr
measure-onset.js    how late each engine reports the notes it does report
align.json          the ruler's time constant, measured on sample A, one source
analyze.js          the ruler, writes score-*.json
frames.js           per-frame table + boundary frame samples
check-synth.py      does melody2.wav contain the curve truth2.json claims?
probe-steady.js     the control: each note's body alone, fed back to aubionotes
verify.sh           runs all of it and diffs against results/, results/b/, results/b90/
results/            sample A's expected outputs, committed
results/b/          sample B's expected outputs, committed
results/b90/        the 90 ms instrument's expected outputs, committed
METHOD.md           the long-form method
```

`verify.sh` needs `node`; pYIN needs `librosa` (import it through
`librosa_shim.py`, which is what the scripts do and what the skip test checks);
aubio needs `aubionotes` (on PATH, via `AUBIO=/path/to/aubionotes`, or unpacked at
`aubio/aubio-0.4.6-win64/bin/`). Missing engines are skipped and reported — never
silently filled in. A skipped engine is not a pass: its score file is not diffed
at all, and the final line tells you how many were skipped. That is the failure
mode these repositories usually die of — green because nothing ran — so it is
counted and printed last.

On Windows, run it from Git Bash (it is a POSIX shell script, LF endings, no CRLF).

## 8. License

Code MIT. `melody.wav`, `melody2.wav`, `truth.json` and `truth2.json` are
generated, released under CC0.
