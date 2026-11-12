#!/usr/bin/env bash
# Recompute every number in the table and diff it against results/.
# Nothing here is hardcoded: if a file differs, this script says so.
#
#   ./verify.sh
#
# Requirements: node (for localmidi + scoring), python3 with librosa (pYIN),
# aubionotes on PATH or AUBIO=/path/to/aubionotes (aubio). Missing engines are
# skipped with a note, not silently ignored.

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

echo
echo "== localmidi (source, no dependencies) =="
node run-localmidi.js melody.wav 2 | sed 's/^/  /'
node analyze.js localmidi-js out-localmidi-s2.json | sed 's/^/  /'
cmp_file "localmidi" out-localmidi-s2.json results/out-localmidi-s2.json
cmp_file "score-js" score-localmidi-js.json results/score-localmidi-js.json

echo
echo "== localmidi (shipped page export, out-localmidi.mid) =="
node analyze.js localmidi out-localmidi.mid | sed 's/^/  /'
cmp_file "score-mid" score-localmidi.json results/score-localmidi.json

echo
echo "== pYIN =="
if python -c "from librosa_shim import import_librosa; import_librosa()" >/dev/null 2>&1; then
  python run-pyin.py melody.wav truth.json | sed 's/^/  /'
  node analyze.js pyin out-pyin.json | sed 's/^/  /'
  cmp_file "pyin" out-pyin.json results/out-pyin.json
  cmp_file "score-pyin" score-pyin.json results/score-pyin.json
else
  say "pYIN" "skipped — librosa not importable (pip install librosa)"
  skipped=$((skipped+1))
fi

echo
echo "== aubio (72 parameter combinations) =="
if command -v aubionotes >/dev/null 2>&1 || [ -n "${AUBIO:-}" ] || [ -x aubio/aubio-0.4.6-win64/bin/aubionotes.exe ]; then
  node run-aubio.js melody.wav 2>/dev/null | sed 's/^/  /'
  node analyze.js aubio out-aubio.json | sed 's/^/  /'
  cmp_file "aubio-stderr" aubio-stderr.txt results/aubio-stderr.txt
  cmp_file "aubio-sweep" aubio-sweep.tsv results/aubio-sweep.tsv
  cmp_file "aubio-out" out-aubio.json results/out-aubio.json
  cmp_file "score-aubio" score-aubio.json results/score-aubio.json
else
  say "aubio" "skipped — aubionotes not on PATH and AUBIO is unset"
  skipped=$((skipped+1))
fi

echo
echo "== sample B: 27.89 s performed, 30 notes, legato + vibrato =="
mkdir -p build-b
node run-localmidi.js melody2.wav 2 build-b | sed 's/^/  /'
node analyze.js localmidi build-b/out-localmidi-s2.json truth2.json build-b | sed 's/^/  /'
cmp_file "b-localmidi" build-b/out-localmidi-s2.json results/b/out-localmidi-s2.json
cmp_file "b-score-loc" build-b/score-localmidi.json results/b/score-localmidi.json

if python -c "from librosa_shim import import_librosa; import_librosa()" >/dev/null 2>&1; then
  python run-pyin.py melody2.wav truth2.json build-b | sed 's/^/  /'
  node analyze.js pyin build-b/out-pyin.json truth2.json build-b | sed 's/^/  /'
  cmp_file "b-pyin" build-b/out-pyin.json results/b/out-pyin.json
  cmp_file "b-score-pyin" build-b/score-pyin.json results/b/score-pyin.json
  # does the file on disk actually contain the pitch curve truth2.json claims?
  python check-synth.py build-b | sed 's/^/  /'
  cmp_file "b-synth-check" build-b/synth-check.json results/b/synth-check.json
else
  say "b-pYIN" "skipped — librosa not importable through librosa_shim"
  skipped=$((skipped+1))
fi

if command -v aubionotes >/dev/null 2>&1 || [ -n "${AUBIO:-}" ] || [ -x aubio/aubio-0.4.6-win64/bin/aubionotes.exe ]; then
  node run-aubio.js melody2.wav build-b 2>/dev/null | sed 's/^/  /'
  node analyze.js aubio build-b/out-aubio.json truth2.json build-b | sed 's/^/  /'
  cmp_file "b-aubio-stder" build-b/aubio-stderr.txt results/b/aubio-stderr.txt
  cmp_file "b-aubio-sweep" build-b/aubio-sweep.tsv results/b/aubio-sweep.tsv
  cmp_file "b-aubio-out" build-b/out-aubio.json results/b/out-aubio.json
  cmp_file "b-score-aubio" build-b/score-aubio.json results/b/score-aubio.json
  # control: can aubio read this timbre at all, when the neighbours are gone?
  node probe-steady.js melody2.wav truth2.json build-b | sed 's/^/  /'
  cmp_file "b-steady-probe" build-b/steady-probe.json results/b/steady-probe.json
else
  say "b-aubio" "skipped — aubionotes not found"
  skipped=$((skipped+1))
fi

echo
echo "== frames (the 23 ms window) =="
node frames.js melody.wav | sed 's/^/  /'
cmp_file "frames" frames.json results/frames.json

echo
echo "---- $ok identical, $bad differing, $skipped engine(s) skipped ----"
[ "$bad" -eq 0 ] || exit 1
