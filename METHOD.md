# Method, in full

Long form of what `README.md` summarises. Every number here is produced by
`verify.sh`; nothing is quoted from memory.

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

For each truth note, window `[start + 0.03, end − 0.03]`:

- the output pitch covering the largest share of that window is the answer
- coverage < 50% → `missing`
- pitch differs → `wrong`, with the interval in semitones recorded
- an output note overlapping any truth note for < 50% of **its own** duration → `spurious`
- the glide is reported but not scored

`analyze.js` implements exactly this and nothing else. It parses `.mid` directly
(running status, meta events, sysex skipped) so the page's own export can be
scored without a converter in between.

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

`aubionotes` 0.4.6. Sweep: 6 pitch methods × 4 onset thresholds × 3 minimum
inter-onset intervals = 72 runs.

All 72 produce the same 7 notes: `60,64,67,69,64,64,67`.
`run-aubio.js` reports `distinct outputs across all combos: 1`.

aubio prints the reason itself, on stderr, on every run:

```
warning: onset threshold not supported yet
```

The parameters are accepted and ignored. There is no "you tuned it badly"
explanation available for this result.

## 4. Results

| engine | notes out | correct | wrong | missing | spurious |
|---|---|---|---|---|---|
| localmidi | 13 | 10/11 | 1 | 0 | 0 |
| pYIN | 14 | 11/11 | 0 | 0 | 0 |
| aubio | 7 | 6/11 | 5 | 0 | 2 |

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
