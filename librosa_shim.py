# -*- coding: utf-8 -*-
"""Make librosa importable and deterministic on every machine we touched.

Two things, both deliberate, both needed by more than one script:

1. librosa's `abs2` / `localmax` / `localmin` are replaced with plain-numpy
   versions *unconditionally*. They are mathematically the same operation; the
   numba builds only differ in how they walk the edges. Replacing them means the
   numbers do not depend on whether a machine has a working numba.
   pYIN itself is pure numpy, so nothing else is affected.

2. If numba or soxr cannot be imported (broken DLLs on some Python 3.13 builds),
   a pass-through stub is installed so `import librosa` still works. The stub is
   never called: every file here is 44.1 kHz and is never resampled, and every
   numba-decorated helper we actually reach has already been replaced by (1).

Import this module before `import librosa`. It exists in one place because two
scripts now need it, and two copies of an environment shim drift.
"""
import sys
import types

import numpy as np


def _install_import_stubs():
    if "soxr" not in sys.modules:
        try:
            import soxr  # noqa: F401
        except Exception:
            _s = types.ModuleType("soxr")
            _s.resample = lambda x, in_rate, out_rate, **kw: x
            _s.__version__ = "0.0.0-stub"
            sys.modules["soxr"] = _s

    try:
        import numba  # noqa: F401
    except Exception:
        def _jit(*a, **k):
            if a and callable(a[0]) and not k:
                return a[0]
            return lambda f: f
        _nb = types.ModuleType("numba")
        for name in ("jit", "njit", "stencil", "guvectorize", "vectorize"):
            setattr(_nb, name, _jit)
        _nb.uint32 = np.uint32
        _nb.__version__ = "0.0.0-stub"
        _nb.__file__ = None
        sys.modules["numba"] = _nb


def _abs2(x, dtype=None):
    a = np.asarray(x)
    out = (a.real ** 2 + a.imag ** 2) if np.iscomplexobj(a) else a ** 2
    return out if dtype is None else np.asarray(out, dtype=dtype)


def _localmax_np(x, *, axis=0):
    x = np.asarray(x)
    n = x.shape[axis]
    pad = [(1, 1) if i == axis else (0, 0) for i in range(x.ndim)]
    xp = np.pad(x, pad, mode="edge")
    prev = np.take(xp, np.arange(0, n), axis=axis)
    nxt = np.take(xp, np.arange(2, n + 2), axis=axis)
    return (x > prev) & (x >= nxt)


def _localmin_np(x, *, axis=0):
    x = np.asarray(x)
    n = x.shape[axis]
    pad = [(1, 1) if i == axis else (0, 0) for i in range(x.ndim)]
    xp = np.pad(x, pad, mode="edge")
    prev = np.take(xp, np.arange(0, n), axis=axis)
    nxt = np.take(xp, np.arange(2, n + 2), axis=axis)
    return (x < prev) & (x <= nxt)


def patch(librosa):
    """Replace the three numba-backed utils in place, unconditionally."""
    import librosa.util.utils as _luu

    _luu.abs2 = _abs2
    _luu.localmax = _localmax_np
    _luu.localmin = _localmin_np
    for _mod in (librosa.util, librosa):
        for _name, _fn in (("abs2", _abs2), ("localmax", _localmax_np), ("localmin", _localmin_np)):
            if hasattr(_mod, _name):
                setattr(_mod, _name, _fn)
    return librosa


def import_librosa():
    """Stubs if needed, import, patch, return the module."""
    _install_import_stubs()
    import librosa
    return patch(librosa)
