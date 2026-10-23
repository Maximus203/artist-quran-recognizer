"""Verrou de fichier et pic mémoire du processus, identiques sous Linux, macOS et Windows.

Pas de dépendance : `fcntl` et `resource` sont propres à Unix, `msvcrt` et `ctypes.windll` à
Windows. Chaque import est fait dans la branche de sa plateforme, jamais à la racine du module.
"""

from __future__ import annotations

import errno
import os
import sys


class LockBusy(OSError):
    """Le verrou est déjà pris par un autre descripteur ou un autre processus."""


def lock_exclusive_nonblocking(fd: int) -> None:
    """Prend un verrou exclusif non bloquant sur le fichier ouvert `fd`.

    Libéré à la fermeture du descripteur. `LockBusy` si un autre le tient, `OSError` pour tout autre
    échec. Sous Windows, verrouille le premier octet (`msvcrt.locking`)."""
    if sys.platform == "win32":
        import msvcrt

        os.lseek(fd, 0, os.SEEK_SET)
        try:
            msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)  # type: ignore[attr-defined,unused-ignore]
        except OSError as exc:
            if exc.errno in (errno.EACCES, errno.EDEADLK):
                raise LockBusy(exc.errno, str(exc)) from exc
            raise
        return
    import fcntl

    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as exc:
        raise LockBusy(exc.errno, str(exc)) from exc


def peak_rss_mb() -> int:
    """Pic de mémoire résidente du processus, en Mio (0 si la plateforme ne le donne pas)."""
    if sys.platform == "win32":
        return _peak_working_set_bytes() // (1024 * 1024)
    import resource

    peak = int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    # Linux : en Kio ; macOS : en octets.
    return peak // (1024 * 1024) if sys.platform == "darwin" else peak // 1024


def _peak_working_set_bytes() -> int:
    import ctypes
    from ctypes import wintypes

    class Counters(ctypes.Structure):
        _fields_ = [
            ("cb", wintypes.DWORD),
            ("PageFaultCount", wintypes.DWORD),
            ("PeakWorkingSetSize", ctypes.c_size_t),
            ("WorkingSetSize", ctypes.c_size_t),
            ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
            ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
            ("PagefileUsage", ctypes.c_size_t),
            ("PeakPagefileUsage", ctypes.c_size_t),
        ]

    counters = Counters()
    counters.cb = ctypes.sizeof(Counters)
    kernel32 = ctypes.WinDLL("kernel32")  # type: ignore[attr-defined,unused-ignore]
    psapi = ctypes.WinDLL("psapi")  # type: ignore[attr-defined,unused-ignore]
    kernel32.GetCurrentProcess.restype = wintypes.HANDLE
    psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD]
    psapi.GetProcessMemoryInfo.restype = wintypes.BOOL
    ok = psapi.GetProcessMemoryInfo(
        kernel32.GetCurrentProcess(), ctypes.byref(counters), counters.cb
    )
    return int(counters.PeakWorkingSetSize) if ok else 0
