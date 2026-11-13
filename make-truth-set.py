# -*- coding: utf-8 -*-
"""九条全静音样本，用来回答两个问题：常数复现吗，复现的带宽多宽。

为什么不是两条。

样本 A 和 C 只给出一次比较。一次比较叫不出「复现」——上一轮已经吃过这个亏：
aubio 的 61/59/57 看起来像同一个数，其实是三个不同的子集；撤掉它之后，pYIN 的 0
和 localmidi 的 −11 各自只剩一条样本。这一轮补上 C，仍然只有两条，两个数的差是
2 ms，而 pYIN 在同样两条样本上差了一个 hop（11.61 ms）。两条样本能给出一个差，
给不出一个带宽：你不知道 2 ms 是「稳定」还是「这次碰巧」。

所以九条，材料各不相同，条件完全相同（每个计分音前后都是静音，没有连奏）：

  s1  纯音，中音区          —— 基准
  s2  颤音 5.5 Hz           —— 颤音
  s3  颤音 6.2 Hz           —— 颤音，参数组不同
  s4  颤音 7.0 Hz           —— 颤音，参数组不同
  s5  滑音 200 ms           —— 滑音，参数组不同
  s6  滑音 300 ms           —— 滑音，参数组不同
  s7  滑音 400 ms           —— 滑音，参数组不同
  s8  纯音，低音区 40–54    —— 低音
  s9  纯音，高音区 72–86    —— 高音

s2/s3/s4 和 s5/s6/s7 是 owner 要的「三条不同参数组」：同一种材料，参数各不同。
如果常数是材料的函数，这三条的中位数会跟着参数走；如果是实现的常数，它们不动。

判据不是两两差值，是九条中位数的带宽（max − min）。两两差值可以被挑选——报
「A 和 C 只差 2 ms」永远挑得到一对好看的；带宽不给你挑的机会。

输出：melody-s1.wav / truth-s1.json … melody-s9.wav / truth-s9.json
"""
import json, math, wave, struct, random

SR = 44100
HARM = [(1, 1.00), (2, 0.42), (3, 0.24), (4, 0.12), (5, 0.07), (6, 0.04)]

POOL = {
    "low":  list(range(40, 55)),
    "mid":  list(range(55, 70)),
    "high": list(range(72, 87)),
}

# 13 个计分音；间隙在 60 和 200 ms 之间轮换（与 A/C 同一个条件，不同细节）
GAPS = [60, 60, 60, 60, 60, 60, 200, 60, 60, 60, 200, 60]

SPECS = [
    ("s1", dict(kind="plain",   register="mid",  glide_ms=300, seed=20261114)),
    ("s2", dict(kind="vibrato", register="mid",  glide_ms=300, seed=20261115, rate=5.5)),
    ("s3", dict(kind="vibrato", register="mid",  glide_ms=300, seed=20261116, rate=6.2)),
    ("s4", dict(kind="vibrato", register="mid",  glide_ms=300, seed=20261117, rate=7.0)),
    ("s5", dict(kind="plain",   register="mid",  glide_ms=200, seed=20261118)),
    ("s6", dict(kind="plain",   register="mid",  glide_ms=300, seed=20261119)),
    ("s7", dict(kind="plain",   register="mid",  glide_ms=400, seed=20261120)),
    ("s8", dict(kind="plain",   register="low",  glide_ms=300, seed=20261121)),
    ("s9", dict(kind="plain",   register="high", glide_ms=300, seed=20261122)),
]


def f_of(m):
    return 440.0 * 2 ** ((m - 69) / 12.0)


def env(t, dur):
    a, r = 0.018, 0.070
    if t < a:
        return t / a
    if t > dur - r:
        return max(0.0, (dur - t) / r)
    return 1.0


def build(sid, sp):
    rng = random.Random(sp["seed"])
    pool = POOL[sp["register"]][:]
    rng.shuffle(pool)
    pitches = pool[:13]

    # 布局：音长 0.55–0.80 s，间隙按 GAPS 轮换，最后接一段滑音
    notes, t = [], 0.0
    for i, p in enumerate(pitches):
        dur = round(0.55 + rng.random() * 0.25, 3)
        notes.append((p, round(t, 3), round(t + dur, 3)))
        t += dur
        if i < len(GAPS):
            t += GAPS[i] / 1000.0
    t = round(t, 3)

    g_from, g_to = pitches[0], pitches[1]
    g_start, g_end = t, round(t + sp["glide_ms"] / 1000.0, 3)
    total = round(g_end + 0.20, 3)

    n = int(SR * total)
    buf = [0.0] * n

    for pitch, start, end in notes:
        dur = end - start
        f0 = f_of(pitch)
        i0, i1 = int(start * SR), min(n, int(end * SR))
        phase = [0.0] * len(HARM)
        for i in range(i0, i1):
            tt = (i - i0) / SR
            cents = 0.0
            if sp["kind"] == "vibrato":
                cents = 10.0 * math.sin(2 * math.pi * sp["rate"] * tt)
            f = f0 * 2 ** (cents / 1200.0)
            s = 0.0
            for h, (mult, amp) in enumerate(HARM):
                phase[h] += 2 * math.pi * f * mult / SR
                s += amp * math.sin(phase[h])
            buf[i] += 0.16 * env(tt, dur) * s

    i0, i1 = int(g_start * SR), min(n, int(g_end * SR))
    phase = [0.0] * len(HARM)
    span = max(1, i1 - i0)
    for i in range(i0, i1):
        u = (i - i0) / span
        f = f_of(g_from) * (f_of(g_to) / f_of(g_from)) ** u
        s = 0.0
        for h, (mult, amp) in enumerate(HARM):
            phase[h] += 2 * math.pi * f * mult / SR
            s += amp * math.sin(phase[h])
        buf[i] += 0.16 * env(i / SR - g_start, g_end - g_start) * s

    for i in range(n):
        buf[i] += rng.gauss(0, 0.0008)

    peak = max(abs(x) for x in buf)
    scale = 0.72 / peak
    frames = bytearray()
    for x in buf:
        v = int(max(-1.0, min(1.0, x * scale)) * 32767)
        frames += struct.pack("<h", v)

    wav = f"melody-{sid}.wav"
    with wave.open(wav, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(bytes(frames))

    truth = {
        "file": wav,
        "sample_rate": SR,
        "duration": total,
        "notes": [{"pitch": p, "start": s, "end": e, "kind": sp["kind"]} for p, s, e in notes],
        "glide": {"from": g_from, "to": g_to, "start": g_start, "end": g_end,
                  "note": "two defensible answers, excluded from error count"},
        "counted_notes": len(notes),
        "kind": sp["kind"],
        "params": {k: v for k, v in sp.items() if k != "seed"},
        "why": "one of nine samples of one condition (silence between every note). This one varies "
               "only the material: " + sp["kind"] + (" " + str(sp.get("rate")) + " Hz" if "rate" in sp else "")
               + ", register " + sp["register"] + ", glide " + str(sp["glide_ms"]) + " ms.",
    }
    with open(f"truth-{sid}.json", "w", encoding="utf-8", newline="\n") as f:
        json.dump(truth, f, indent=1, ensure_ascii=False)
    return wav, len(frames) + 44, len(notes), total, pitches


if __name__ == "__main__":
    for sid, sp in SPECS:
        wav, size, cnt, total, pitches = build(sid, sp)
        print(f"{wav:16s} {size:8d} B  {cnt} notes  {total:6.2f} s  {sp['kind']:7s}"
              + (f" {sp['rate']} Hz" if 'rate' in sp else "")
              + f"  glide {sp['glide_ms']} ms  pitch {min(pitches)}..{max(pitches)}")
