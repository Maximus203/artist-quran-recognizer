"""Un smoke e2e sauté n'est pas un succès : le résumé le dit en toutes lettres.

Le mode strict est le défaut : on n'arrive ici que si `AQR_SMOKE_STRICT=0` a été posé explicitement.
Seuls les tests de `tests/e2e/` sont listés : une session ordinaire contient d'autres tests sautés
(contrat, corpus absent...) qui ne sont pas des smokes."""

from __future__ import annotations

from typing import Any

E2E_PREFIX = "tests/e2e/"


def pytest_terminal_summary(terminalreporter: Any) -> None:
    skipped = [
        report
        for report in terminalreporter.stats.get("skipped", [])
        if report.nodeid.replace("\\", "/").startswith(E2E_PREFIX)
    ]
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
        "Le mode strict (défaut, scripts/smoke_e2e.sh) en fait un échec ; ici AQR_SMOKE_STRICT=0 "
        "l'a autorisé explicitement.",
        red=True,
    )
