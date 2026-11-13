# -*- coding: utf-8 -*-
"""样本 C：第二条全静音样本，只为一个问题存在 —— 常数复现吗？

样本 A 量出的 pYIN 0 ms / localmidi −11 ms 各自只有一条样本。一条样本上的读数是
读数，不是常数；一个干净的子集和一个脏的子集，都是单点。「换个接缝还是同一个数」
才叫常数，所以要有第二条同条件、不同细节的样本。

条件不动：每个音前后都是静音，没有连奏。
细节全换：13 个音（A 是 11）、音高一个都不重复、音与音之间留 60–200 ms 真空隙
（A 是首尾相接）、颤音 6.2 Hz（A 是 5.5 Hz）、滑音 300 ms 下行小三度（A 是 600 ms 上行大二度）。

判据在跑之前就写死：同一条匹配规则、两边覆盖都 ≥ 0.9、两个中位数相差 ≤ 10 ms
（不到一个 23 ms 分析窗的一半），三样都满足才算复现。不满足就跟 aubio 一样 withheld。

输出：melody3.wav (44.1 kHz / 16-bit / mono)、truth3.json
"""
import json, math, wave, struct, random

SR = 44100
rng = random.Random(20261113)

def f_of(m):
    return 440.0 * 2 ** ((m - 69) / 12.0)

# (pitch, start, end, kind) —— 音高互不重复，避免匹配器把音配到别处
NOTES = [
    (57, 0.00, 0.62, "plain"),
    (59, 0.68, 1.30, "plain"),
    (61, 1.36, 1.96, "vibrato"),
    (64, 2.02, 2.90, "vibrato"),
    (62, 2.96, 3.55, "plain"),
    (60, 3.61, 4.40, "vibrato"),
    (67, 4.46, 5.10, "plain"),
    (65, 5.30, 5.95, "plain"),      # 200 ms 空隙
    (63, 6.01, 6.70, "vibrato"),
    (69, 6.76, 7.60, "plain"),
    (66, 7.66, 8.30, "plain"),
    (58, 8.50, 9.10, "plain"),      # 200 ms 空隙
    (56, 9.16, 9.80, "plain"),
]
# 滑音：10.20 → 10.50，A4 滑到 G4（下行小三度，300 ms），真值两解，不计分
GLIDE = (69, 67, 10.20, 10.50)
TOTAL = 10.70

n = int(SR * TOTAL)
buf = [0.0] * n
HARM = [(1, 1.00), (2, 0.42), (3, 0.24), (4, 0.12), (5, 0.07), (6, 0.04)]

def env(t, dur):
    a, r = 0.018, 0.070
    if t < a:
        return t / a
    if t > dur - r:
        return max(0.0, (dur - t) / r)
    return 1.0

for pitch, start, end, kind in NOTES:
    dur = end - start
    f0 = f_of(pitch)
    i0 = int(start * SR)
    i1 = min(n, int(end * SR))
    phase = [0.0] * len(HARM)
    for i in range(i0, i1):
        t = (i - i0) / SR
        cents = 10.0 * math.sin(2 * math.pi * 6.2 * t) if kind == "vibrato" else 0.0
        f = f0 * 2 ** (cents / 1200.0)
        s = 0.0
        for h, (mult, amp) in enumerate(HARM):
            phase[h] += 2 * math.pi * f * mult / SR
            s += amp * math.sin(phase[h])
        buf[i] += 0.16 * env(t, dur) * s

# 滑音
p0, p1, s0, s1 = GLIDE
i0, i1 = int(s0 * SR), int(s1 * SR)
phase = [0.0] * len(HARM)
for i in range(i0, min(n, i1)):
    u = (i - i0) / max(1, (i1 - i0))
    f = f_of(p0) * (f_of(p1) / f_of(p0)) ** u
    s = 0.0
    for h, (mult, amp) in enumerate(HARM):
        phase[h] += 2 * math.pi * f * mult / SR
        s += amp * math.sin(phase[h])
    buf[i] += 0.16 * env(i / SR - s0, s1 - s0) * s

# 底噪 -62 dBFS
for i in range(n):
    buf[i] += rng.gauss(0, 0.0008)

peak = max(abs(x) for x in buf)
scale = 0.72 / peak
frames = bytearray()
for x in buf:
    v = int(max(-1.0, min(1.0, x * scale)) * 32767)
    frames += struct.pack("<h", v)

with wave.open("melody3.wav", "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(bytes(frames))

truth = {
    "file": "melody3.wav",
    "sample_rate": SR,
    "duration": TOTAL,
    "notes": [{"pitch": p, "start": round(s, 3), "end": round(e, 3), "kind": k} for p, s, e, k in NOTES],
    "glide": {"from": GLIDE[0], "to": GLIDE[1], "start": GLIDE[2], "end": GLIDE[3],
              "note": "two defensible answers, excluded from error count"},
    "counted_notes": len(NOTES),
    "why": "second sample for the same question as A: does the onset offset reproduce "
           "when the notes, the gaps and the glide all change but silence stays between every note?",
}
with open("truth3.json", "w", encoding="utf-8", newline="\n") as f:
    json.dump(truth, f, indent=1, ensure_ascii=False)

print("wav bytes:", len(frames) + 44)
print("counted notes:", len(NOTES), "duration:", TOTAL)
