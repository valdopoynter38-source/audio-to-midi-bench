# -*- coding: utf-8 -*-
"""生成一段真值已知的录音，并写出 truth.json。

设计目标：让三种转换器在同样的输入上分开档次。
- 长音带颤音（5.5 Hz, ±12 cents）——跟踪器若不做平滑会把颤音切成碎片
- 同一音高出现两次，中间隔静音——合并策略不同的工具会并成一个音
- 两个 16 分音符（0.15 s）——最短音判定阈值卡在这里
- 一段上滑音——真值本身有两解，单独列出，不计入错音数

输出：melody.wav (44.1 kHz / 16-bit / mono)、truth.json
"""
import json, math, wave, struct, random

SR = 44100
rng = random.Random(20261112)

def f_of(m):
    return 440.0 * 2 ** ((m - 69) / 12.0)

# (pitch, start, end, kind)
NOTES = [
    (60, 0.00, 0.60, "plain"),
    (62, 0.60, 1.20, "plain"),
    (64, 1.20, 1.80, "vibrato"),
    (67, 1.80, 2.40, "vibrato"),
    (69, 2.40, 3.00, "vibrato"),
    (67, 3.00, 3.60, "plain"),
    (64, 3.60, 4.20, "vibrato"),
    (62, 4.20, 4.80, "plain"),
    (60, 4.80, 6.00, "vibrato"),   # 长音，和第一个 C4 同高，中间隔着 4.2 s
    (64, 6.00, 6.15, "short"),     # 16 分
    (65, 6.15, 6.30, "short"),     # 16 分
]
# 滑音：6.60 → 7.20，G4 滑到 A4，真值两解，不计入错音
GLIDE = (67, 69, 6.60, 7.20)
TOTAL = 7.60

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
        cents = 12.0 * math.sin(2 * math.pi * 5.5 * t) if kind == "vibrato" else 0.0
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

with wave.open("melody.wav", "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(bytes(frames))

truth = {
    "file": "melody.wav",
    "sample_rate": SR,
    "duration": TOTAL,
    "notes": [{"pitch": p, "start": round(s, 3), "end": round(e, 3), "kind": k} for p, s, e, k in NOTES],
    "glide": {"from": GLIDE[0], "to": GLIDE[1], "start": GLIDE[2], "end": GLIDE[3],
              "note": "two defensible answers, excluded from error count"},
    "counted_notes": len(NOTES),
}
with open("truth.json", "w", encoding="utf-8") as f:
    json.dump(truth, f, indent=2, ensure_ascii=False)

print("wav bytes:", len(frames) + 44)
print("counted notes:", len(NOTES), "duration:", TOTAL)
