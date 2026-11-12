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
if python -c "import librosa" >/dev/null 2>&1; then
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
echo "== frames (the 23 ms window) =="
node frames.js melody.wav | sed 's/^/  /'
cmp_file "frames" frames.json results/frames.json

echo
echo "---- $ok identical, $bad differing, $skipped engine(s) skipped ----"
[ "$bad" -eq 0 ] || exit 1
