# Audio-to-MIDI: three engines, one recording, one ruler

A 7.60-second monophonic melody with **11 notes whose pitches are known before any
tool runs**, pushed through three pitch-to-MIDI engines. Every number below is
reproduced by one command:

```bash
./verify.sh
```

If your run prints `0 differing`, you have the same table we published.

| engine | notes out | correct | wrong | missing | spurious |
|---|---|---|---|---|---|
| **pYIN** (librosa 1.0.1) | 14 | **11/11** | 0 | 0 | 0 |
| **localmidi** (this site) | 13 | **10/11** | 1 | 0 | 0 |
| **aubio notes** 0.4.6 | 7 | **6/11** | 5 | 0 | 2 |

We are second. The one note we get wrong is explained to the sample in
[`METHOD.md`](METHOD.md) and in the video: it is a 23 ms analysis window landing on
a note boundary, not a tuning problem.

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

For each of the 11 truth notes, take the window `[start + 0.03, end − 0.03]`:

- the pitch that covers the most of that window is the engine's answer
- coverage < 50% → `missing`
- different pitch → `wrong` (the interval is recorded)
- any output note overlapping a truth note for less than 50% of **its own** duration → `spurious`
- the glide is excluded from scoring and reported separately

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
2. **`aubionotes` 0.4.6 ignores its parameters.** See below — this turned out to be
   the most useful result in the whole exercise.

## 4. The 72 combinations

`run-aubio.js` sweeps 6 pitch methods × 4 onset thresholds × 3 minimum inter-onset
intervals = **72 runs**. All 72 produce the identical 7 notes
(`60,64,67,69,64,64,67`). `run-aubio.js` prints:

```
combos: 72
distinct outputs across all combos: 1
```

aubio says why itself, on stderr, once per run:

```
warning: onset threshold not supported yet
```

So "you didn't tune it properly" is not an available explanation for aubio's
result — the tuning knobs are not connected. The raw readings for all 72 runs are
in [`results/aubio-all.json`](results/aubio-all.json) and
[`results/aubio-sweep.tsv`](results/aubio-sweep.tsv); you can diff them without
installing anything.

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
run-aubio.js        72-combination sweep
analyze.js          the ruler, writes score-*.json
frames.js           per-frame table + boundary frame samples
verify.sh           runs all of it and diffs against results/
results/            the expected outputs, committed
METHOD.md           the long-form method, including the two caveats above
```

`verify.sh` needs `node`; pYIN needs `librosa`; aubio needs `aubionotes`
(on PATH, or `AUBIO=/path/to/aubionotes`). Missing engines are skipped and
reported — never silently filled in.

## 8. License

Code MIT. `melody.wav` and `truth.json` are generated, released under CC0.
