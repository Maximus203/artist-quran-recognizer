"""Un smoke e2e entièrement sauté n'est pas un succès : le résumé le dit en toutes lettres."""

from __future__ import annotations

from typing import Any


def pytest_terminal_summary(terminalreporter: Any) -> None:
    skipped = terminalreporter.stats.get("skipped", [])
    if not skipped:
        return
    terminalreporter.write_sep("=", "smoke e2e : NON EXÉCUTÉ", red=True, bold=True)
    for report in skipped:
        reason = report.longrepr[2] if isinstance(report.longrepr, tuple) else report.longrepr
        terminalreporter.write_line(
            f"  {report.nodeid} : {str(reason).removeprefix('Skipped: ')}", red=True
        )
    terminalreporter.write_line(
        f"{len(skipped)} test(s) sauté(s) : RIEN n'a été vérifié, ce n'est pas un succès. "
        "AQR_SMOKE_STRICT=1 (défaut de scripts/smoke_e2e.sh) en fait un échec.",
        red=True,
    )
