#!/usr/bin/env bash
# Recompute every number in the table and diff it against results/.
# Nothing here is hardcoded: if a file differs, this script says so.
#
#   ./verify.sh
#
# Requirements: node (for localmidi + scoring), python3 with librosa (pYIN),
# aubionotes on PATH or AUBIO=/path/to/aubionotes (aubio). Missing engines are
# skipped with a note, not silently ignored.
#
# The order is the point: run the engines, then measure the ruler's alignment
# constant, then score. Scoring before aligning would compare two time axes that
# are known to be offset by tens of milliseconds, and every join measurement
# downstream would inherit it.
#
# Nine samples, not one, and not two. A single sample cannot distinguish "this
# engine is 11 ms early" from "this engine is 11 ms early on this file", and
# running the same file twice — on one machine or on two — cannot distinguish
# them either: that is reproducibility, and it is not the question. Two samples
# give one comparison, and one comparison is not a band; pYIN puts two samples a
# whole hop apart, so "A and C differ by 2 ms" is a pair that happened to agree.
# Nine samples of different material (plain, three vibrato rates, three glide
# lengths, a low register, a high register) give a band, and the band is what the
# gate reads. An engine that answers a sample only in part is withheld
# regardless: a median taken over the notes a tool chose to speak about is that
# tool's selection.

set -u
cd "$(dirname "$0")" || exit 1

ok=0; bad=0; skipped=0
say() { printf '%-14s %s\n' "$1" "$2"; }
cmp_file() {  # cmp_file <label> <generated> <expected>
  if [ ! -f "$2" ]; then say "$1" "MISSING $2"; bad=$((bad+1)); return; fi
  if diff -q "$2" "$3" >/dev/null 2>&1; then
    say "$1" "identical to $3"; ok=$((ok+1))
  else
    say "$1" "DIFFERS from $3"; diff "$2" "$3" | head -12; bad=$((bad+1))
  fi
}

command -v node >/dev/null || { echo "node not found"; exit 1; }

if python -c "from librosa_shim import import_librosa; import_librosa()" >/dev/null 2>&1; then
  HAVE_PYIN=1
else
  HAVE_PYIN=0
fi
if command -v aubionotes >/dev/null 2>&1 || [ -n "${AUBIO:-}" ] || [ -x aubio/aubio-0.4.6-win64/bin/aubionotes.exe ]; then
  HAVE_AUBIO=1
else
  HAVE_AUBIO=0
fi

echo "== input =="
node -e '
const b=require("fs").readFileSync("melody.wav");
let off=12,fmt,data;
while(off+8<=b.length){const id=b.toString("ascii",off,off+4),sz=b.readUInt32LE(off+4);
 if(id==="fmt ")fmt={ch:b.readUInt16LE(off+10),sr:b.readUInt32LE(off+12),bits:b.readUInt16LE(off+22)};
 if(id==="data")data=sz; off+=8+sz+(sz%2);}
console.log(`melody.wav  ${data/fmt.ch/(fmt.bits/8)} samples  ${fmt.sr} Hz  ${fmt.bits}-bit  ${fmt.ch} ch  ${b.length} bytes`);
'
node -e 'const t=require("./truth.json");console.log(`truth.json  ${t.notes.length} notes  ${t.notes[0].start}s .. ${t.notes[t.notes.length-1].end}s`)'
node -e 'const t=require("./truth2.json");console.log(`truth2.json ${t.notes.length} notes  ${t.notes[0].start}s .. ${t.notes[t.notes.length-1].end}s  ${t.notes.filter(n=>n.glide_in>0).length} joins`)'
node -e 'const t=require("./truth3.json");console.log(`truth3.json ${t.notes.length} notes  ${t.notes[0].start}s .. ${t.notes[t.notes.length-1].end}s  ${new Set(t.notes.map(n=>n.pitch)).size} distinct pitches  gaps ${t.notes.slice(1).map((n,i)=>Math.round((n.start-t.notes[i].end)*1000)).join(",")} ms`)'

echo
echo "== sample A: engines =="
node run-localmidi.js melody.wav 2 | sed 's/^/  /'
if [ "$HAVE_PYIN" = 1 ]; then python run-pyin.py melody.wav truth.json | sed 's/^/  /'
else say "pYIN" "skipped — librosa not importable (pip install librosa)"; skipped=$((skipped+1)); fi
if [ "$HAVE_AUBIO" = 1 ]; then node run-aubio.js melody.wav 2>/dev/null | sed 's/^/  /'
else say "aubio" "skipped — aubionotes not on PATH and AUBIO is unset"; skipped=$((skipped+1)); fi

echo
echo "== sample C: the same condition, every detail different =="
# 13 notes instead of 11, no pitch repeated, 60-200 ms of silence between notes
# instead of butt-joined, vibrato at 6.2 Hz instead of 5.5, one 300 ms descending
# glide instead of a 600 ms rising one. The condition — silence between every
# note — is untouched, which is the only thing that has to stay fixed. This
# sample is one of the eleven the constant is read from, not a sample to rank
# engines on.
mkdir -p build-c
node run-localmidi.js melody3.wav 2 build-c | sed 's/^/  /'
if [ "$HAVE_PYIN" = 1 ]; then python run-pyin.py melody3.wav truth3.json build-c | sed 's/^/  /'
else say "c-pYIN" "skipped — librosa not importable through librosa_shim"; skipped=$((skipped+1)); fi
if [ "$HAVE_AUBIO" = 1 ]; then node run-aubio.js melody3.wav build-c 2>/dev/null | sed 's/^/  /'
else say "c-aubio" "skipped — aubionotes not found"; skipped=$((skipped+1)); fi

echo
echo "== sample set: one condition, nine materials =="
# Same condition as A and C (silence between every note). Only the material
# changes: s1 plain, s2-s4 vibrato at 5.5 / 6.2 / 7.0 Hz, s5-s7 glide at 200 /
# 300 / 400 ms, s8 low register 40-54, s9 high register 72-86. The three vibrato
# rates and the three glide lengths are the "three different parameter sets": if
# the constant were a function of the material, they would move it.
python make-truth-set.py | sed 's/^/  /'
for i in 1 2 3 4 5 6 7 8 9; do
  mkdir -p build-s/s$i
  node run-localmidi.js melody-s$i.wav 2 build-s/s$i >/dev/null 2>&1
  if [ "$HAVE_PYIN" = 1 ]; then
    python run-pyin.py melody-s$i.wav truth-s$i.json build-s/s$i >/dev/null 2>&1 || { say "s$i-pYIN" "failed"; skipped=$((skipped+1)); }
  fi
  if [ "$HAVE_AUBIO" = 1 ]; then
    node run-aubio.js melody-s$i.wav build-s/s$i --single >/dev/null 2>&1 || { say "s$i-aubio" "failed"; skipped=$((skipped+1)); }
  fi
  echo "  s$i done"
done

echo
echo "== probe: one note, five phases — what the number is made of =="
# Not a gate. This separates a lattice convention (discrete, one hop wide) from
# an analysis delay (continuous): one pitch, one envelope, five onsets a quarter
# of a hop apart. If the deltas swing with the phase, that part is the lattice;
# if they sit at one height, that part is the delay. Both are constants of the
# implementation, neither is a constant of the material, and they are not the
# same object.
python probe-frame.py | sed 's/^/  /'
mkdir -p build-probe
node run-localmidi.js probe.wav 2 build-probe >/dev/null 2>&1
if [ "$HAVE_PYIN" = 1 ]; then python run-pyin.py probe.wav probe-truth.json build-probe >/dev/null 2>&1; fi
if [ "$HAVE_AUBIO" = 1 ]; then node run-aubio.js probe.wav build-probe >/dev/null 2>&1; fi
node probe-report.js | sed 's/^/  /'
cmp_file "timebase" build-probe/timebase.json results/timebase.json

echo
echo "== sample B: 27.89 s performed, 30 notes, legato + vibrato =="
mkdir -p build-b
node run-localmidi.js melody2.wav 2 build-b | sed 's/^/  /'
if [ "$HAVE_PYIN" = 1 ]; then python run-pyin.py melody2.wav truth2.json build-b | sed 's/^/  /'
else say "b-pYIN" "skipped — librosa not importable through librosa_shim"; skipped=$((skipped+1)); fi
if [ "$HAVE_AUBIO" = 1 ]; then node run-aubio.js melody2.wav build-b 2>/dev/null | sed 's/^/  /'
else say "b-aubio" "skipped — aubionotes not found"; skipped=$((skipped+1)); fi

echo
echo "== sample B at a fixed 90 ms: the pre-change instrument =="
# Not a sample to rank engines on. This is the version of B this repository used
# before join length was derived from the interval, kept rebuildable (see
# make-truth2.py) so that the joins can be re-measured on a file whose joins are
# uniform. It used to double as the cross-sample check on the alignment constant;
# it no longer does, because two samples are not a band and this one only ever
# supplied a second pair.
mkdir -p build-b90
node run-localmidi.js melody2-90.wav 2 build-b90 | sed 's/^/  /'
if [ "$HAVE_PYIN" = 1 ]; then python run-pyin.py melody2-90.wav truth2-90.json build-b90 | sed 's/^/  /'
else say "b90-pYIN" "skipped — librosa not importable through librosa_shim"; skipped=$((skipped+1)); fi
if [ "$HAVE_AUBIO" = 1 ]; then node run-aubio.js melody2-90.wav build-b90 2>/dev/null | sed 's/^/  /'
else say "b90-aubio" "skipped — aubionotes not found"; skipped=$((skipped+1)); fi

echo
echo "== the ruler's time axis: eleven samples of one condition =="
# Gates are in align.js and were fixed before any number was read: coverage 0.9
# (spoken / notes, on EVERY sample) and a band of 10 ms over the per-sample
# medians, with at least 5 samples. A constant is then the pooled median over
# every matched note of every sample, not the average of the medians.
if [ "$HAVE_PYIN" = 1 ] && [ "$HAVE_AUBIO" = 1 ]; then
  node align.js --timebase build-probe/timebase.json \
    --sample truth.json   out-localmidi-s2.json out-pyin.json out-aubio.json \
    --sample truth3.json  build-c/out-localmidi-s2.json build-c/out-pyin.json build-c/out-aubio.json \
    --sample truth-s1.json build-s/s1/out-localmidi-s2.json build-s/s1/out-pyin.json build-s/s1/out-aubio.json \
    --sample truth-s2.json build-s/s2/out-localmidi-s2.json build-s/s2/out-pyin.json build-s/s2/out-aubio.json \
    --sample truth-s3.json build-s/s3/out-localmidi-s2.json build-s/s3/out-pyin.json build-s/s3/out-aubio.json \
    --sample truth-s4.json build-s/s4/out-localmidi-s2.json build-s/s4/out-pyin.json build-s/s4/out-aubio.json \
    --sample truth-s5.json build-s/s5/out-localmidi-s2.json build-s/s5/out-pyin.json build-s/s5/out-aubio.json \
    --sample truth-s6.json build-s/s6/out-localmidi-s2.json build-s/s6/out-pyin.json build-s/s6/out-aubio.json \
    --sample truth-s7.json build-s/s7/out-localmidi-s2.json build-s/s7/out-pyin.json build-s/s7/out-aubio.json \
    --sample truth-s8.json build-s/s8/out-localmidi-s2.json build-s/s8/out-pyin.json build-s/s8/out-aubio.json \
    --sample truth-s9.json build-s/s9/out-localmidi-s2.json build-s/s9/out-pyin.json build-s/s9/out-aubio.json \
    > align.json
else
  say "align" "kept — needs all three engines on every sample"
fi
node -e '
const a=require("./align.json");
console.log(`  gates: coverage ${a.gates.coverage} (spoken/notes, every sample) | band ${a.gates.band_ms} ms over >= ${a.gates.min_samples} samples`);
for (const r of a.rows) {
  const c=a.constants_ms[r.tool], w=a.withheld[r.tool];
  const verdict = c !== undefined ? `constant ${c.align_ms>=0?"+":""}${c.align_ms} ms (pooled)` : "withheld";
  const meds = r.per.map(p => `${String(p.median_ms).padStart(5)}`).join(" ");
  const spk = r.per.map(p => `${p.spoken}/${p.notes_total}`).join(" ");
  const mch = r.per.map(p => `${p.matched}/${p.notes_total}`).join(" ");
  console.log(`  ${r.tool.padEnd(10)} ${verdict.padEnd(26)} medians [${meds}]  band ${r.band_ms===null?"n/a":r.band_ms+" ms"}`);
  console.log(`  ${"".padEnd(10)} spoken [${spk}]  matched [${mch}]  (gate reads spoken)`);
}
'
cmp_file "align" align.json results/align.json

echo
echo "== scoring (aligned first, then compared) =="
node analyze.js localmidi-js out-localmidi-s2.json | sed 's/^/  /'
node analyze.js localmidi out-localmidi.mid | sed 's/^/  /'
cmp_file "localmidi" out-localmidi-s2.json results/out-localmidi-s2.json
cmp_file "score-js" score-localmidi-js.json results/score-localmidi-js.json
cmp_file "score-mid" score-localmidi.json results/score-localmidi.json

if [ "$HAVE_PYIN" = 1 ]; then
  node analyze.js pyin out-pyin.json | sed 's/^/  /'
  cmp_file "pyin" out-pyin.json results/out-pyin.json
  cmp_file "score-pyin" score-pyin.json results/score-pyin.json
fi

if [ "$HAVE_AUBIO" = 1 ]; then
  node analyze.js aubio out-aubio.json | sed 's/^/  /'
  cmp_file "aubio-stderr" aubio-stderr.txt results/aubio-stderr.txt
  cmp_file "aubio-sweep" aubio-sweep.tsv results/aubio-sweep.tsv
  cmp_file "aubio-out" out-aubio.json results/out-aubio.json
  cmp_file "score-aubio" score-aubio.json results/score-aubio.json
fi

echo
echo "== sample C, scored by the same ruler =="
node analyze.js localmidi build-c/out-localmidi-s2.json truth3.json build-c | sed 's/^/  /'
cmp_file "c-localmidi" build-c/out-localmidi-s2.json results/c/out-localmidi-s2.json
cmp_file "c-score-loc" build-c/score-localmidi.json results/c/score-localmidi.json

if [ "$HAVE_PYIN" = 1 ]; then
  node analyze.js pyin build-c/out-pyin.json truth3.json build-c | sed 's/^/  /'
  cmp_file "c-pyin" build-c/out-pyin.json results/c/out-pyin.json
  cmp_file "c-pyin-frames" build-c/pyin-frames.json results/c/pyin-frames.json
  cmp_file "c-score-pyin" build-c/score-pyin.json results/c/score-pyin.json
fi

if [ "$HAVE_AUBIO" = 1 ]; then
  node analyze.js aubio build-c/out-aubio.json truth3.json build-c | sed 's/^/  /'
  cmp_file "c-aubio-stder" build-c/aubio-stderr.txt results/c/aubio-stderr.txt
  cmp_file "c-aubio-sweep" build-c/aubio-sweep.tsv results/c/aubio-sweep.tsv
  cmp_file "c-aubio-out" build-c/out-aubio.json results/c/out-aubio.json
  cmp_file "c-score-aubio" build-c/score-aubio.json results/c/score-aubio.json
  # 11.61 ms is the whole hop that all three engines report onsets on. If pYIN's
  # two medians differ by exactly one hop, the number was never a fixed offset.
  node grid.js build-c | sed 's/^/  /'
  cmp_file "c-onset-grid" build-c/onset-grid.json results/c/onset-grid.json
fi

echo
echo "== the nine-sample set: onset readings only =="
# These nine exist to read the constant, not to rank engines: they are scored
# nowhere. What is checked is the engine output byte for byte, because that is
# what the band is computed from. (localmidi also reports every note below MIDI
# 42 as 89 on s8 — its lag search stops at frameSize/2 = 512 samples = 86 Hz —
# which is why s8 has only six same-pitch matches and its median is a reading
# off six notes, not thirteen.)
for i in 1 2 3 4 5 6 7 8 9; do
  cmp_file "s$i-localmidi" build-s/s$i/out-localmidi-s2.json results/s/s$i/out-localmidi-s2.json
  if [ "$HAVE_PYIN" = 1 ]; then
    cmp_file "s$i-pyin" build-s/s$i/out-pyin.json results/s/s$i/out-pyin.json
  fi
  if [ "$HAVE_AUBIO" = 1 ]; then
    cmp_file "s$i-aubio" build-s/s$i/out-aubio.json results/s/s$i/out-aubio.json
  fi
done

node analyze.js localmidi build-b/out-localmidi-s2.json truth2.json build-b | sed 's/^/  /'
cmp_file "b-localmidi" build-b/out-localmidi-s2.json results/b/out-localmidi-s2.json
cmp_file "b-score-loc" build-b/score-localmidi.json results/b/score-localmidi.json

if [ "$HAVE_PYIN" = 1 ]; then
  node analyze.js pyin build-b/out-pyin.json truth2.json build-b | sed 's/^/  /'
  cmp_file "b-pyin" build-b/out-pyin.json results/b/out-pyin.json
  cmp_file "b-score-pyin" build-b/score-pyin.json results/b/score-pyin.json
  # does the file on disk actually contain the pitch curve truth2.json claims?
  python check-synth.py build-b | sed 's/^/  /'
  cmp_file "b-synth-check" build-b/synth-check.json results/b/synth-check.json
fi

if [ "$HAVE_AUBIO" = 1 ]; then
  node analyze.js aubio build-b/out-aubio.json truth2.json build-b | sed 's/^/  /'
  cmp_file "b-aubio-stder" build-b/aubio-stderr.txt results/b/aubio-stderr.txt
  cmp_file "b-aubio-sweep" build-b/aubio-sweep.tsv results/b/aubio-sweep.tsv
  cmp_file "b-aubio-out" build-b/out-aubio.json results/b/out-aubio.json
  cmp_file "b-score-aubio" build-b/score-aubio.json results/b/score-aubio.json
  # control: can aubio read this timbre at all, when the neighbours are gone?
  node probe-steady.js melody2.wav truth2.json build-b | sed 's/^/  /'
  cmp_file "b-steady-probe" build-b/steady-probe.json results/b/steady-probe.json
fi

# the 90 ms instrument: onsets are the point, so the onset report is checked too
node analyze.js localmidi build-b90/out-localmidi-s2.json truth2-90.json build-b90 | sed 's/^/  /'
cmp_file "b90-localmidi" build-b90/out-localmidi-s2.json results/b90/out-localmidi-s2.json
cmp_file "b90-score-loc" build-b90/score-localmidi.json results/b90/score-localmidi.json
if [ "$HAVE_PYIN" = 1 ]; then
  node analyze.js pyin build-b90/out-pyin.json truth2-90.json build-b90 | sed 's/^/  /'
  cmp_file "b90-pyin" build-b90/out-pyin.json results/b90/out-pyin.json
  cmp_file "b90-score-pyin" build-b90/score-pyin.json results/b90/score-pyin.json
fi
if [ "$HAVE_AUBIO" = 1 ]; then
  node analyze.js aubio build-b90/out-aubio.json truth2-90.json build-b90 | sed 's/^/  /'
  cmp_file "b90-aubio-out" build-b90/out-aubio.json results/b90/out-aubio.json
  cmp_file "b90-score-aubio" build-b90/score-aubio.json results/b90/score-aubio.json
fi
if [ "$HAVE_PYIN" = 1 ] && [ "$HAVE_AUBIO" = 1 ]; then
  node measure-onset.js truth2-90.json build-b90/out-localmidi-s2.json build-b90/out-pyin.json build-b90/out-aubio.json \
    --json | sed -n '/^{/,$p' > build-b90/onset.json
  cmp_file "b90-onset" build-b90/onset.json results/b90/onset.json
fi

echo
echo "== frames (the 23 ms window) =="
node frames.js melody.wav | sed 's/^/  /'
cmp_file "frames" frames.json results/frames.json

echo
echo "---- $ok identical, $bad differing, $skipped engine(s) skipped ----"
[ "$bad" -eq 0 ] || exit 1
