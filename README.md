# Audio-to-MIDI: three engines, one recording, one ruler

A 7.60-second monophonic melody with **11 notes whose pitches are known before any
tool runs**, pushed through three pitch-to-MIDI engines. Every number below is
reproduced by one command:

```bash
./verify.sh
```

If your run prints `0 differing`, you have the same table we published.

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

Two videos use these numbers:

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

## 2. The ruler

**On the truth side**, for each of the 11 truth notes take the window
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

That sweep is an inference: 72 samples, all equal, therefore the parameters do
nothing. aubio's own stderr line is a statement. The two agree, so the sweep
costs nothing to include — but if you only read one of them, read the one aubio
wrote about itself.

The raw readings for all 72 runs are in
[`results/aubio-all.json`](results/aubio-all.json) and
[`results/aubio-sweep.tsv`](results/aubio-sweep.tsv); you can diff them without
installing anything. The stderr capture, with its 72/72 count, is in
[`results/aubio-stderr.txt`](results/aubio-stderr.txt).

## 5. The one note localmidi gets wrong

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

## 6. What is not here

**Basic Pitch** (Spotify) was attempted and dropped: the web app accepted the file
via a real drag-and-drop event but never finished converting, and the pip package
has no Python 3.13 wheel. We did not estimate its score. An engine missing from
the table is missing on purpose.

## 7. Files

```
melody.wav          the input (deterministic, from make-truth.py)
truth.json          the 11 notes, written before any tool ran
make-truth.py       regenerates both
run-localmidi.js    shipped detectNotes + a WAV reader, no dependencies
out-localmidi.mid   the .mid the real page exported (144 bytes)
run-pyin.py         pYIN + our segmenter
run-aubio.js        72-combination sweep, captures aubio's stderr
analyze.js          the ruler, writes score-*.json
frames.js           per-frame table + boundary frame samples
verify.sh           runs all of it and diffs against results/
results/            the expected outputs, committed
METHOD.md           the long-form method, including the two caveats above
```

`verify.sh` needs `node`; pYIN needs `librosa`; aubio needs `aubionotes` (on PATH,
via `AUBIO=/path/to/aubionotes`, or unpacked at `aubio/aubio-0.4.6-win64/bin/`).
Missing engines are skipped and reported — never silently filled in. A skipped
engine is not a pass: the score file for it is not diffed at all, and the final
line tells you how many were skipped.

On Windows, run it from Git Bash (it is a POSIX shell script, LF endings, no CRLF).

## 8. License

Code MIT. `melody.wav` and `truth.json` are generated, released under CC0.
