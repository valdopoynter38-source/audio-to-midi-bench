# -*- coding: utf-8 -*-
"""一个音，放在五个不同的帧内相位上 —— 用来分开「帧中心约定」和「分析延迟」。

第三处要问的不是「拦不拦」，是 −13 ms 落在哪：帧中心的约定，还是分析延迟。

这两件事必须分开，因为它们的性质不同：

  * 帧中心约定是**离散**的。引擎报的是「第 k 帧」的时间，而第 k 帧的时间戳
    可能是帧起点、帧中心或帧末尾。它和真值起音的差会随起音落在帧内的位置
    在 0..hop 之间摆动，摆动的**幅度**就是 hop，中位数在 hop 的一半附近。
    这是实现的常数，换任何材料都一样。

  * 分析延迟是**连续**的。平滑窗、median filter、onset 检测的回看，都让报出
    来的时间比真实起音晚（或早）一个固定量，不随相位摆动。它也是实现的常数，
    但它和帧中心是两笔账，混成一句 offset 就再也拆不开。

五个音，同一个音高、同一条包络，起音落在帧内的五个不同位置（0, 1/4, 1/2,
3/4, 1 个 512 样本 hop = 0, 2.90, 5.81, 8.71, 11.61 ms）。如果偏差随相位走，
那部分是栅格；如果五条偏差一起平移，那部分是延迟。

输出：probe.wav、probe-truth.json
"""
import json, math, wave, struct

SR = 44100
HARM = [(1, 1.00), (2, 0.42), (3, 0.24), (4, 0.12), (5, 0.07), (6, 0.04)]

PITCH = 60
DUR = 0.25
STARTS = [0.5000 + k * 0.3500 + k * (128 / SR) for k in range(5)]  # +1/4 hop each time
TOTAL = 2.40


def env(t, dur):
    a, r = 0.018, 0.070
    if t < a:
        return t / a
    if t > dur - r:
        return max(0.0, (dur - t) / r)
    return 1.0


n = int(SR * TOTAL)
buf = [0.0] * n
f0 = 440.0 * 2 ** ((PITCH - 69) / 12.0)

for s in STARTS:
    i0, i1 = int(round(s * SR)), min(n, int(round((s + DUR) * SR)))
    phase = [0.0] * len(HARM)
    for i in range(i0, i1):
        t = (i - i0) / SR
        x = 0.0
        for h, (mult, amp) in enumerate(HARM):
            phase[h] += 2 * math.pi * f0 * mult / SR
            x += amp * math.sin(phase[h])
        buf[i] += 0.16 * env(t, DUR) * x

peak = max(abs(x) for x in buf)
frames = bytearray()
for x in buf:
    v = int(max(-1.0, min(1.0, x * 0.72 / peak)) * 32767)
    frames += struct.pack("<h", v)

with wave.open("probe.wav", "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(bytes(frames))

truth = {
    "file": "probe.wav",
    "sample_rate": SR,
    "duration": TOTAL,
    "notes": [{"pitch": PITCH, "start": round(s, 6), "end": round(s + DUR, 6)} for s in STARTS],
    "glide": None,
    "counted_notes": len(STARTS),
    "why": "one pitch, one envelope, five onsets a quarter of a 512-sample hop apart. Used only to "
           "separate a lattice convention from an analysis delay; not a sample for scoring.",
}
with open("probe-truth.json", "w", encoding="utf-8", newline="\n") as f:
    json.dump(truth, f, indent=1, ensure_ascii=False)

print("probe.wav", len(frames) + 44, "B")
for k, s in enumerate(STARTS):
    print(f"  n{k+1} start {s:.6f} s   phase {(s*SR) % 512:6.1f} samples of a 512 hop")
