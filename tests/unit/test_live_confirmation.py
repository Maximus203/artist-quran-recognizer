"""Confirmation par le moteur du lot (ADR-0016) : découpe aux pauses et file de confirmation."""

from __future__ import annotations

import math
import threading
from array import array

import pytest

from aqr.domain.models import Detection, Status, TimeSpan, VerseRef, WordSpan
from aqr.domain.ports import AudioClip
from aqr.live.confirmation import (
    ConfirmationConfig,
    ConfirmationWorker,
    PauseCutter,
    SegmentConfirmer,
    merge_parts,
)
from aqr.pipeline.result import AbstentionReason, AbstentionSpan, EngineInfo, RecognitionResult

RATE = 16000
ENGINE = EngineInfo(asr="faux", segmenter="faux", matcher="faux", decoder="faux")


def voice(seconds: float, level: float = 0.2) -> array[float]:
    n = round(seconds * RATE)
    return array("f", (level * math.sin(2 * math.pi * 220 * i / RATE) for i in range(n)))


def silence(seconds: float) -> array[float]:
    return array("f", [0.0]) * round(seconds * RATE)


def detection(ref: str, start: float, end: float, status: Status = Status.RECOGNIZED) -> Detection:
    return Detection(
        span=WordSpan(VerseRef.parse(ref), 1, 5),
        time=TimeSpan(start, end),
        status=status,
        confidence=0.9,
        word_times=(TimeSpan(start, start + 0.5),),
    )


def result(*intervals: object) -> RecognitionResult:
    return RecognitionResult(
        source_file="x",
        duration_s=10.0,
        intervals=tuple(intervals),  # type: ignore[arg-type]
        engine=ENGINE,
        timing={},
        decoder_config={},
        windows=1,
    )


class TestPauseCutter:
    def test_coupe_a_la_pause_apres_la_duree_minimale(self) -> None:
        cutter = PauseCutter()
        segments = cutter.feed(voice(7.0)) + cutter.feed(silence(1.0)) + cutter.feed(voice(2.0))
        assert len(segments) == 1
        assert segments[0].start_s == 0.0
        assert 7.7 <= segments[0].end_s <= 8.1  # la pause fait partie du passage
        assert len(segments[0].samples) == round(segments[0].end_s * RATE)

    def test_pas_de_coupe_avant_la_duree_minimale(self) -> None:
        cutter = PauseCutter()
        assert cutter.feed(voice(3.0) + silence(1.5) + voice(2.0)) == []

    def test_coupe_forcee_sans_pause(self) -> None:
        cutter = PauseCutter()
        segments = cutter.feed(voice(26.0))
        assert len(segments) == 1
        assert segments[0].end_s == pytest.approx(25.0, abs=0.05)

    def test_les_passages_se_suivent_sans_trou_ni_recouvrement(self) -> None:
        cutter = PauseCutter()
        flow = voice(7.0) + silence(1.0) + voice(7.0) + silence(1.0)
        segments = cutter.feed(flow)
        assert len(segments) == 2
        assert segments[1].start_s == pytest.approx(segments[0].end_s)
        total = sum(len(s.samples) for s in segments)
        assert total + len(cutter._buffer) == len(flow)

    def test_decoupe_identique_quelle_que_soit_la_taille_des_blocs(self) -> None:
        flow = voice(7.0) + silence(1.0) + voice(7.0) + silence(1.0)
        whole = PauseCutter().feed(flow)
        cutter = PauseCutter()
        pieces = []
        for i in range(0, len(flow), 1600):
            pieces += cutter.feed(flow[i : i + 1600])
        assert [round(s.end_s, 2) for s in pieces] == [round(s.end_s, 2) for s in whole]

    def test_du_silence_n_est_jamais_un_passage(self) -> None:
        cutter = PauseCutter()
        assert cutter.feed(silence(30.0)) == []
        assert cutter.flush() is None

    def test_flush_rend_le_passage_en_cours(self) -> None:
        cutter = PauseCutter()
        assert cutter.feed(voice(3.0)) == []
        last = cutter.flush()
        assert last is not None
        assert last.end_s == pytest.approx(3.0, abs=0.05)
        assert cutter.flush() is None

    def test_voix_trop_courte_ignoree_a_la_fin(self) -> None:
        cutter = PauseCutter()
        cutter.feed(voice(0.4))
        assert cutter.flush() is None

    def test_une_voix_basse_se_coupe_comme_une_voix_forte(self) -> None:
        cutter = PauseCutter()
        segments = cutter.feed(voice(7.0, level=0.02) + silence(1.0))
        assert len(segments) == 1


def part(ref: str, first: int, last: int, start: float, end: float, **kw: object) -> Detection:
    return Detection(
        span=WordSpan(VerseRef.parse(ref), first, last),
        time=TimeSpan(start, end),
        status=kw.get("status", Status.RECOGNIZED),  # type: ignore[arg-type]
        confidence=0.9,
        is_repetition=bool(kw.get("repetition", False)),
    )


class TestMergeParts:
    def test_deux_moities_d_un_verset_deviennent_une_ligne(self) -> None:
        merged = merge_parts([part("2:210", 1, 6, 20.0, 25.0), part("2:210", 7, 14, 25.0, 31.0)])
        assert len(merged) == 1
        assert merged[0].span == WordSpan(VerseRef.parse("2:210"), 1, 14)
        assert merged[0].time == TimeSpan(20.0, 31.0)

    def test_des_versets_differents_restent_separes(self) -> None:
        merged = merge_parts([part("2:209", 1, 10, 13.0, 19.0), part("2:210", 1, 6, 20.0, 25.0)])
        assert len(merged) == 2

    def test_un_trou_dans_les_mots_ou_une_reprise_ne_fusionne_pas(self) -> None:
        assert len(merge_parts([part("2:210", 1, 4, 1, 3), part("2:210", 9, 12, 4, 6)])) == 2
        assert (
            len(
                merge_parts([part("2:210", 1, 6, 1, 3), part("2:210", 1, 6, 4, 6, repetition=True)])
            )
            == 2
        )

    def test_un_statut_different_ne_fusionne_pas(self) -> None:
        inferred = part("2:210", 7, 14, 25.0, 31.0, status=Status.INFERRED)
        assert len(merge_parts([part("2:210", 1, 6, 20.0, 25.0), inferred])) == 2


class TestConfig:
    def test_refuse_des_durees_incoherentes(self) -> None:
        with pytest.raises(ValueError):
            ConfirmationConfig(pause_s=0.01)
        with pytest.raises(ValueError):
            ConfirmationConfig(min_segment_s=30.0)
        with pytest.raises(ValueError):
            ConfirmationConfig(max_pending=0)


class TestSegmentConfirmer:
    def make(self, recognize, **config) -> tuple[SegmentConfirmer, ConfirmationWorker]:  # type: ignore[no-untyped-def]
        worker = ConfirmationWorker(recognize)
        return SegmentConfirmer(worker, "flux-test", ConfirmationConfig(**config)), worker

    def test_les_versets_reviennent_dans_le_temps_du_flux(self) -> None:
        seen: list[AudioClip] = []

        def recognize(clip: AudioClip, name: str, *, relisten: bool = True) -> RecognitionResult:
            seen.append(clip)
            return result(
                detection("112:1", 1.0, 3.0),
                AbstentionSpan(TimeSpan(4, 5), AbstentionReason.BELOW_THRESHOLD),
            )

        confirmer, worker = self.make(recognize)
        confirmer.feed(voice(7.0) + silence(1.0))  # premier passage 0 -> ~8 s
        confirmer.feed(voice(7.0) + silence(1.0))  # second passage ~8 -> ~16 s
        done = confirmer.finish()
        worker.close()
        assert len(done) == 2
        assert done[0].detections[0].time == TimeSpan(1.0, 3.0)
        assert done[1].detections[0].time.start_s == pytest.approx(done[1].start_s + 1.0)
        assert done[1].detections[0].word_times[0].start_s == pytest.approx(done[1].start_s + 1.0)
        assert all(c.sample_rate == RATE and c.source == "flux-test" for c in seen)

    def test_un_passage_ambigu_n_est_jamais_confirme(self) -> None:
        def recognize(clip: AudioClip, name: str, *, relisten: bool = True) -> RecognitionResult:
            return result(detection("2:1", 0.5, 2.0, Status.UNCERTAIN))

        confirmer, worker = self.make(recognize)
        confirmer.feed(voice(7.0) + silence(1.0))
        assert confirmer.finish() == []
        worker.close()

    def test_un_deduit_est_confirme_avec_son_statut(self) -> None:
        def recognize(clip: AudioClip, name: str, *, relisten: bool = True) -> RecognitionResult:
            return result(detection("2:1", 0.5, 2.0, Status.INFERRED))

        confirmer, worker = self.make(recognize)
        confirmer.feed(voice(7.0) + silence(1.0))
        done = confirmer.finish()
        worker.close()
        assert done[0].detections[0].status is Status.INFERRED

    def test_une_erreur_du_lot_ne_casse_pas_le_flux(self) -> None:
        def recognize(clip: AudioClip, name: str, *, relisten: bool = True) -> RecognitionResult:
            raise RuntimeError("modèle indisponible")

        confirmer, worker = self.make(recognize)
        confirmer.feed(voice(7.0) + silence(1.0))
        assert confirmer.finish() == []
        worker.close()

    def test_ready_ne_bloque_pas_et_garde_l_ordre(self) -> None:
        gate = threading.Event()
        calls = []

        def recognize(clip: AudioClip, name: str, *, relisten: bool = True) -> RecognitionResult:
            calls.append(len(clip.samples))
            gate.wait(5)
            return result(detection("1:1", 0.5, 2.0))

        confirmer, worker = self.make(recognize)
        confirmer.feed(voice(7.0) + silence(1.0))
        assert confirmer.ready() == []  # le lot n'a pas fini : on n'attend pas
        gate.set()
        assert len(confirmer.finish()) == 1
        worker.close()

    def test_trop_de_passages_en_attente_sont_ignores_et_comptes(self) -> None:
        gate = threading.Event()

        def recognize(clip: AudioClip, name: str, *, relisten: bool = True) -> RecognitionResult:
            gate.wait(5)
            return result(detection("1:1", 0.5, 2.0))

        confirmer, worker = self.make(recognize, max_pending=2)
        for _ in range(4):
            confirmer.feed(voice(7.0) + silence(1.0))
        assert confirmer.skipped == 2
        gate.set()
        assert len(confirmer.finish()) == 2
        worker.close()

    def test_a_la_fin_le_dernier_passage_est_confirme(self) -> None:
        def recognize(clip: AudioClip, name: str, *, relisten: bool = True) -> RecognitionResult:
            return result(detection("112:2", 0.2, 1.5))

        confirmer, worker = self.make(recognize)
        confirmer.feed(voice(3.0))
        done = confirmer.finish()
        worker.close()
        assert len(done) == 1 and done[0].detections[0].span.ref == VerseRef.parse("112:2")

    def test_attente_de_fin_bornee(self) -> None:
        gate = threading.Event()

        def recognize(clip: AudioClip, name: str, *, relisten: bool = True) -> RecognitionResult:
            gate.wait(5)
            return result(detection("1:1", 0.5, 2.0))

        confirmer, worker = self.make(recognize, wait_end_s=0.05)
        confirmer.feed(voice(7.0) + silence(1.0))
        assert confirmer.finish() == []
        gate.set()
        worker.close()

    def test_le_passage_qui_suit_une_file_chargee_est_traite_sans_reecoute(self) -> None:
        gate = threading.Event()
        modes: list[bool] = []

        def recognize(clip: AudioClip, name: str, *, relisten: bool = True) -> RecognitionResult:
            modes.append(relisten)
            gate.wait(5)
            return result(detection("1:1", 0.5, 2.0))

        confirmer, worker = self.make(recognize, fast_when_pending=2, max_pending=4)
        for _ in range(3):
            confirmer.feed(voice(7.0) + silence(1.0))
        gate.set()
        confirmer.finish()
        worker.close()
        assert modes == [True, True, False]  # les deux premiers avec réécoute, le troisième sans

    def test_refuse_un_seuil_de_mode_rapide_hors_file(self) -> None:
        with pytest.raises(ValueError):
            ConfirmationConfig(fast_when_pending=5, max_pending=4)
