<div align="center">

# artist-quran-recognizer

**Drop in an audio or video file: the workshop finds every Quran verse that is recited, shows it at the right moment with its translation, and lets you correct what is wrong.**

[Français](README.md) · [Quick start](#quick-start) · [Contributing](#contributing) · [Technical details](#technical-details)

<img src="docs/assets/demo-atelier.webp" alt="The web workshop while listening: the recited word and its matching translation fragment are highlighted live" width="900">

<sub>[Watch the demo as MP4](docs/assets/demo-atelier.mp4) (no sound)</sub>

</div>

---

## The workshop

A **local** web app: import a recording, listen, and see live which verse is being recited.

- **The recited word lights up**, with the matching translation fragment. The Arabic text always comes from the Mushaf, never from a model.
- **Everything that is not Quran is ignored** (lessons, hadiths, supplications, other languages).
- **You correct by ear**: draw the faulty range on the waveform, pick a chip ("wrong verse", "starts too late"…), confirm. Your corrections become test cases for the engine.
- **Several files at once**, or a microphone recording, with an analysis queue and a remaining-time estimate.
- **Built for long audio**, light and dark themes, mobile, accounts and private or shared sessions.

<table>
<tr>
<td width="50%"><img src="docs/assets/revue-sombre.jpg" alt="Review workshop, dark theme"></td>
<td width="50%"><img src="docs/assets/revue-claire.jpg" alt="Review workshop, light theme"></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/sessions.jpg" alt="Sessions list and analysis queue"></td>
<td width="50%"><img src="docs/assets/documentation.jpg" alt="Documentation tab"></td>
</tr>
</table>

> **Work in progress.** Results must be checked by ear: no human-validated ground truth exists yet. [Help us build one](https://github.com/Maximus203/artist-quran-recognizer/issues/87). Most in-depth documentation is in French; issues and PRs in English are welcome.

## Quick start

Requires Python 3.11+, Node 24, [ffmpeg](https://ffmpeg.org) and, preferably, an NVIDIA GPU.

```bash
git clone https://github.com/Maximus203/artist-quran-recognizer.git
cd artist-quran-recognizer
python -m venv .venv && . .venv/bin/activate         # Windows: .venv\Scripts\activate
pip install -e ".[dev,asr,data]" && pip install --no-deps -e ".[segmenter]"
python scripts/fetch_corpus.py && python scripts/fetch_models.py

cd web && npm ci && npm run build
export AQR_PYTHON="$(pwd)/../.venv/bin/python" AQR_MODELS_DIR=/path/to/models \
       AQR_CORPUS_DIR="$(pwd)/../data/corpus" AQR_REVIEW_DIR=/path/to/data
npm run start -- -p 3100
```

Open `http://127.0.0.1:3100`, create an account (the first one is admin) and drop in an audio file. Settings and security: [web/README.md](web/README.md) (French).

> Only import audio you have the rights to. No audio file or model is ever versioned in this repository.

## Contributing

There is work for everyone: **listening and validating passages (no code)**, accessibility testing, Windows portability, improving the engine. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and the [`good first issue`](https://github.com/Maximus203/artist-quran-recognizer/labels/good%20first%20issue) tickets.

## License

Code under [MIT](LICENSE) for now. The maintainer plans non-commercial use; some models already are. Details and attributions: [CREDITS.md](CREDITS.md).

---

## Technical details

<details>
<summary><b>How the engine works</b></summary>

```
  audio or video file
        │
  1. EXTRACT     ffmpeg → mono 16 kHz
  2. SEGMENT     into speech chunks (recitation segmenter)
  3. LISTEN      an ASR model (FastConformer) transcribes each chunk; Whisper and a streaming
                 model re-listen ONLY to doubtful chunks                              (ADR-0009)
  4. SEARCH      transcript matched against the Quran text, tolerant to ASR errors   (ADR-0003/4)
  5. CONFIRM     chain proof: short consecutive verses confirm each other             (ADR-0007)
                 acoustic proof: the CORPUS text is force-aligned on the audio;
                 if the sound does not support it, nothing is named                  (ADR-0006/8)
  6. FILL        gaps between recognized verses, missing starts and ends              (ADR-0010/13)
  7. DECIDE      recognized / inferred / uncertain / abstention
  8. RENDER      corpus Arabic + QuranEnc translation + timings (start, end, per word)
        │
  JSON `aqr.recognition/1` (+ SRT / VTT)  →  web workshop
```

The ASR model only *locates*: the system searches the corpus for what resembles what was heard, then **checks on the audio** that the corpus text matches. Without proof, it abstains. CLI: `aqr recognize lesson.mp3 --out-dir out`. More: [system overview](docs/SYSTEME-EN-BREF.md) (French), [architecture](docs/ARCHITECTURE.md), [ADRs](docs/adr), [docs map](docs/README.md).

</details>

<details>
<summary><b>Invariants (non-negotiable)</b></summary>

| # | Rule |
|---|---|
| I1 | Displayed Arabic **always comes from the corpus**, never from a model. No generative LLM in the Quranic chain. |
| I2 | Translations are QuranEnc's, **unmodified**, with id, version and attribution. |
| I3 | **A wrong verse is worse than none.** |
| I4 | Non-Quranic speech produces **no verse**. |
| I5 | Every detection carries a **proof status**. |
| I6 | The **riwaya** is a parameter (Hafs only today). |
| I7 | Every brick is **replaceable** behind a tested interface. |

</details>

<details>
<summary><b>What is measured, and its limits</b></summary>

On EveryAyah (216 verses), recognized verses went 71.8 % → **97.7 %** as decision bricks were added, with **0 false verse**; the models are unchanged. On 12 real audios (8.7 h), 618 → **740** verses *named* (not "correct"). These are **not accuracy rates**: there is no human ground truth on real audio, and EveryAyah is an optimistic ceiling. No fine-tuning has been done. Read [the limits](docs/SYSTEME-EN-BREF.md#ce-que-ces-chiffres-ne-disent-pas) before quoting a number.

</details>

<details>
<summary><b>Roadmap</b></summary>

| Topic | Status | Tracking |
|---|---|---|
| **Live detection** over a stream, no declared range | Design ([ADR-0011](docs/adr/0011-detection-en-direct-sans-plage.md)) | [#84](https://github.com/Maximus203/artist-quran-recognizer/issues/84) |
| **Subtitle export** with an ambiguity check | Design done, implementation next | [#86](https://github.com/Maximus203/artist-quran-recognizer/issues/86) |
| Human **ground truth** (2–3 h validated by ear) | Tooling ready, reviewers wanted | [#87](https://github.com/Maximus203/artist-quran-recognizer/issues/87) |
| **Fine-tuning** | Not done; conditions and data | [#88](https://github.com/Maximus203/artist-quran-recognizer/issues/88) |
| **Non-Quranic parts** (Wolof, English… → French) | Idea tracked | [#85](https://github.com/Maximus203/artist-quran-recognizer/issues/85) |

</details>

<details>
<summary><b>Repository layout and attributions</b></summary>

```
src/aqr/    domain · corpus · matching · decoding · alignment · adapters · models · pipeline
            rendering · translation_align · eval · data
web/        Next.js workshop (accounts, queue, review)
docs/       architecture, decisions (ADR), evaluations, design, release notes
```

Before pushing: `pytest && ruff check src tests scripts && ruff format --check src tests scripts && mypy`.

Quran text: [Tanzil Project](https://tanzil.net) (CC-BY-3.0), downloaded on demand, unmodified. Translations: [QuranEnc.com](https://quranenc.com), unmodified. Models and fonts: [CREDITS.md](CREDITS.md). Hafs only. This software is an aid, not an authority: reading and verifying the Quran remain human.

</details>
