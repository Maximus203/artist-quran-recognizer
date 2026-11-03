"""`aqr live-serve` : lance le service du direct ; les réglages viennent de l'environnement."""

from __future__ import annotations

import io
from pathlib import Path

from aqr.app.live_service import ServiceOptions
from aqr.cli import main
from aqr.live.service_config import LiveServiceConfig


class Recorder:
    def __init__(self, code: int = 0) -> None:
        self.code = code
        self.calls: list[tuple[LiveServiceConfig, ServiceOptions]] = []

    def __call__(self, config, options, env, out, err) -> int:  # type: ignore[no-untyped-def]
        self.calls.append((config, options))
        return self.code


def run(argv: list[str], env: dict[str, str] | None = None, runner: Recorder | None = None):  # type: ignore[no-untyped-def]
    out, err = io.StringIO(), io.StringIO()
    runner = runner or Recorder()
    code = main(argv, env=env or {}, out=out, err=err, live_runner=runner)
    return code, runner, out.getvalue(), err.getvalue()


def test_the_defaults_listen_on_the_loopback() -> None:
    code, runner, _out, _err = run(["live-serve"])
    config, options = runner.calls[0]
    assert code == 0
    assert (config.host, config.port) == ("127.0.0.1", 8765)
    assert options.asr_threads == 1
    assert options.warm_up is True


def test_the_environment_sets_the_limits_and_the_flags_override_the_address() -> None:
    env = {"AQR_LIVE_MAX_STREAMS": "9", "AQR_LIVE_PORT": "9000", "AQR_MODELS_DIR": "/m"}
    _code, runner, _out, _err = run(["live-serve", "--port", "9100", "--asr-threads", "2"], env)
    config, options = runner.calls[0]
    assert config.max_streams == 9
    assert config.port == 9100
    assert options.asr_threads == 2
    assert options.models_dir == Path("/m")


def test_translations_to_prefetch_are_a_list() -> None:
    _code, runner, _o, _e = run(["live-serve", "--warm-translations", "french_hameedullah"])
    assert runner.calls[0][1].warm_translations == ("french_hameedullah",)


def test_a_wrong_setting_is_a_clear_usage_error_not_a_trace() -> None:
    code, runner, _out, err = run(["live-serve"], {"AQR_LIVE_PORT": "abc"})
    assert code == 2
    assert "AQR_LIVE_PORT" in err
    assert runner.calls == []


def test_the_exit_code_of_the_service_is_returned() -> None:
    code, _runner, _o, _e = run(["live-serve"], runner=Recorder(code=2))
    assert code == 2
