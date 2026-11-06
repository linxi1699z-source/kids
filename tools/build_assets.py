#!/usr/bin/env python3
"""Build the local audio library and app-data.js for the pinyin/English site."""

from __future__ import annotations

import asyncio
import hashlib
import json
import ssl
import subprocess
import sys
import urllib.request
from pathlib import Path

import certifi
import edge_tts
import imageio_ffmpeg
import librosa
import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache"
TTS_CACHE = CACHE / "tts"
CMN_CACHE = CACHE / "audio-cmn"
OUT_PINYIN = ROOT / "assets" / "audio" / "pinyin"
OUT_ENGLISH = ROOT / "assets" / "audio" / "english"
TMP = CACHE / "processed"

SAMPLE_RATE = 44_100
BITRATE = "64k"
ZH_VOICE = "zh-CN-XiaoxiaoNeural"
EN_VOICE = "en-US-JennyNeural"
CMN_BASE = "https://raw.githubusercontent.com/hugolpz/audio-cmn/master/64k/syllabs"

for folder in (TTS_CACHE, CMN_CACHE, OUT_PINYIN, OUT_ENGLISH, TMP):
    folder.mkdir(parents=True, exist_ok=True)

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

# 非 ASCII 的拼音文件名映射为安全 ASCII，避免 GitHub Pages / 微信对 URL 编码不一致。
PYINYIN_FILENAME = {"ü": "v", "üe": "ve"}


def pinyin_filename(item_id: str) -> str:
    return PYINYIN_FILENAME.get(item_id, item_id)


def run(cmd: list[str]) -> None:
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode:
        raise RuntimeError(
            f"Command failed ({proc.returncode}): {' '.join(cmd)}\n"
            f"{proc.stderr.decode('utf-8', 'replace')[-2000:]}"
        )


def download(url: str, dest: Path) -> None:
    if dest.exists() and dest.stat().st_size > 0:
        return
    tmp = dest.with_suffix(dest.suffix + ".part")
    print(f"download {dest.name}", flush=True)
    context = ssl.create_default_context(cafile=certifi.where())
    with urllib.request.urlopen(url, timeout=60, context=context) as response, tmp.open("wb") as fh:
        fh.write(response.read())
    tmp.replace(dest)


def decode_to_wav(src: Path, dest: Path, *, atempo: float | None = None) -> None:
    filters = []
    if atempo is not None:
        filters.append(f"atempo={atempo}")
    cmd = [FFMPEG, "-y", "-i", str(src)]
    if filters:
        cmd += ["-filter:a", ",".join(filters)]
    cmd += ["-ar", str(SAMPLE_RATE), "-ac", "1", "-c:a", "pcm_s16le", str(dest)]
    run(cmd)


def trim_normalize(y: np.ndarray, sr: int) -> np.ndarray:
    if y.ndim > 1:
        y = y.mean(axis=1)
    y = np.asarray(y, dtype=np.float32)
    y = y - float(np.mean(y))
    y, _ = librosa.effects.trim(y, top_db=38, frame_length=1024, hop_length=256)
    if y.size == 0:
        return y
    # A tiny pad keeps soft consonants from being clipped.
    pad = int(0.045 * sr)
    y = np.pad(y, (pad, pad), mode="constant")
    rms = float(np.sqrt(np.mean(np.square(y))))
    if rms > 1e-6:
        target_rms = 10 ** (-19.0 / 20.0)
        gain = target_rms / rms
        gain = float(np.clip(gain, 0.6, 4.5))
        y = y * gain
    peak = float(np.max(np.abs(y)))
    if peak > 0.95:
        y = y * (0.95 / peak)
    # 12 ms fades avoid clicks at clip boundaries.
    fade = min(int(0.012 * sr), len(y) // 2)
    if fade > 0:
        y[:fade] *= np.linspace(0, 1, fade, dtype=np.float32)
        y[-fade:] *= np.linspace(1, 0, fade, dtype=np.float32)
    return y.astype(np.float32)


def load_clip(wav: Path, *, atempo: float | None = None) -> np.ndarray:
    tmp = wav.with_name(wav.stem + "-tempo.wav")
    if atempo is not None:
        decode_to_wav(wav, tmp, atempo=atempo)
        wav = tmp
    y, sr = sf.read(wav, dtype="float32", always_2d=False)
    if sr != SAMPLE_RATE:
        y = librosa.resample(y, orig_sr=sr, target_sr=SAMPLE_RATE)
    return trim_normalize(y, SAMPLE_RATE)


def silence(seconds: float) -> np.ndarray:
    return np.zeros(int(round(seconds * SAMPLE_RATE)), dtype=np.float32)


def concat(parts: list[np.ndarray]) -> np.ndarray:
    return np.concatenate(parts).astype(np.float32)


def write_mp3(y: np.ndarray, dest: Path) -> None:
    wav = TMP / (dest.stem + "-final.wav")
    sf.write(wav, y, SAMPLE_RATE, subtype="PCM_16")
    tmp = dest.with_suffix(".part.mp3")
    run(
        [
            FFMPEG,
            "-y",
            "-i",
            str(wav),
            "-ar",
            str(SAMPLE_RATE),
            "-ac",
            "1",
            "-c:a",
            "libmp3lame",
            "-b:a",
            BITRATE,
            str(tmp),
        ]
    )
    tmp.replace(dest)


def tts_cache_path(kind: str, key: str, text: str, voice: str, rate: str) -> Path:
    digest = hashlib.sha1(f"{voice}|{rate}|{text}".encode("utf-8")).hexdigest()[:10]
    return TTS_CACHE / f"{kind}-{key}-{digest}.mp3"


async def generate_tts_job(job: dict, semaphore: asyncio.Semaphore) -> None:
    dest: Path = job["dest"]
    if dest.exists() and dest.stat().st_size > 0:
        return
    async with semaphore:
        for attempt in range(1, 4):
            try:
                communicate = edge_tts.Communicate(
                    job["text"], job["voice"], rate="-10%", volume="+0%", pitch="+0Hz"
                )
                tmp = dest.with_suffix(".part.mp3")
                await communicate.save(str(tmp))
                if not tmp.exists() or tmp.stat().st_size == 0:
                    raise RuntimeError("empty audio")
                tmp.replace(dest)
                print(f"tts {dest.name}", flush=True)
                return
            except Exception as exc:  # noqa: BLE001 - retry all network/TTS errors
                if attempt == 3:
                    raise RuntimeError(f"TTS failed for {job['key']}: {exc}") from exc
                await asyncio.sleep(1.2 * attempt)


async def generate_tts(jobs: list[dict]) -> None:
    semaphore = asyncio.Semaphore(4)
    await asyncio.gather(*(generate_tts_job(job, semaphore) for job in jobs))


def build_pinyin(content: dict) -> list[dict]:
    items = content["pinyin"]["items"]
    cache: dict[str, np.ndarray] = {}
    output_items = []

    for item in items:
        if item.get("tts"):
            # 用 Edge TTS 朗读汉字（保证声母呼读音准确，如「吃」= chī）。
            item_mp3 = tts_cache_path("pinyin-item", item["id"], item["tts"], ZH_VOICE, "-10%")
            item_wav = TMP / f"pinyin-item-{item['id']}.wav"
            decode_to_wav(item_mp3, item_wav)
            item_audio = load_clip(item_wav)
        else:
            source = item["source"]
            source_mp3 = CMN_CACHE / f"cmn-{source}.mp3"
            download(f"{CMN_BASE}/cmn-{source}.mp3", source_mp3)
            source_wav = TMP / f"cmn-{source}.wav"
            decode_to_wav(source_mp3, source_wav)
            if source not in cache:
                cache[source] = load_clip(source_wav, atempo=0.9)
            item_audio = cache[source]

        case_mp3 = tts_cache_path("pinyin-case", item["id"], item["sentence"], ZH_VOICE, "-10%")
        case_wav = TMP / f"pinyin-case-{item['id']}.wav"
        decode_to_wav(case_mp3, case_wav)
        case_audio = load_clip(case_wav)

        parts = []
        for index in range(3):
            parts.append(item_audio)
            parts.append(silence(1.0 if index < 2 else 1.1))
        for index in range(2):
            parts.append(case_audio)
            parts.append(silence(1.0 if index == 0 else 0.35))
        combined = concat(parts)

        out = OUT_PINYIN / f"{pinyin_filename(item['id'])}.mp3"
        write_mp3(combined, out)
        print(f"built pinyin {item['id']} ({len(combined) / SAMPLE_RATE:.1f}s)", flush=True)

        output_items.append(
            {
                **item,
                "audio": f"assets/audio/pinyin/{pinyin_filename(item['id'])}.mp3?v=1",
            }
        )
    return output_items


def build_english(content: dict) -> list[dict]:
    output_items = []
    for entry in content["english"]:
        letter = entry["letter"]
        lower = letter.lower()
        letter_mp3 = tts_cache_path("en-letter", letter, f"{letter}.", EN_VOICE, "-10%")
        word_mp3 = tts_cache_path("en-word", letter, entry["word"], EN_VOICE, "-10%")
        sentence_mp3 = tts_cache_path("en-sentence", letter, entry["sentence"], EN_VOICE, "-10%")
        zh_mp3 = tts_cache_path("en-zh", letter, entry["sentenceZh"], ZH_VOICE, "-10%")

        letter_wav = TMP / f"en-letter-{letter}.wav"
        word_wav = TMP / f"en-word-{letter}.wav"
        sentence_wav = TMP / f"en-sentence-{letter}.wav"
        zh_wav = TMP / f"en-zh-{letter}.wav"
        decode_to_wav(letter_mp3, letter_wav)
        decode_to_wav(word_mp3, word_wav)
        decode_to_wav(sentence_mp3, sentence_wav)
        decode_to_wav(zh_mp3, zh_wav)

        letter_audio = load_clip(letter_wav)
        word_audio = load_clip(word_wav)
        sentence_audio = load_clip(sentence_wav)
        zh_audio = load_clip(zh_wav)

        parts = []
        for index in range(3):
            parts.append(letter_audio)
            parts.append(silence(1.0 if index < 2 else 1.1))
        for index in range(2):
            parts.append(word_audio)
            parts.append(silence(0.6))
            parts.append(sentence_audio)
            parts.append(silence(0.7))
            parts.append(zh_audio)
            parts.append(silence(1.0 if index == 0 else 0.35))
        combined = concat(parts)

        out = OUT_ENGLISH / f"{letter}.mp3"
        write_mp3(combined, out)
        print(f"built english {letter} ({len(combined) / SAMPLE_RATE:.1f}s)", flush=True)

        shared = {
            "letter": letter,
            "word": entry["word"],
            "zh": entry["zh"],
            "sentence": entry["sentence"],
            "sentenceZh": entry["sentenceZh"],
            "emoji": entry["emoji"],
            "audio": f"assets/audio/english/{letter}.mp3?v=1",
        }
        output_items.append(
            {
                **shared,
                "id": f"{letter}-upper",
                "display": letter,
                "caseType": "upper",
                "category": "uppercase",
                "group": "大写字母",
            }
        )
        output_items.append(
            {
                **shared,
                "id": f"{lower}-lower",
                "display": lower,
                "caseType": "lower",
                "category": "lowercase",
                "group": "小写字母",
            }
        )
    return output_items


def main() -> None:
    content = json.loads((ROOT / "content.json").read_text(encoding="utf-8"))

    jobs = []
    for item in content["pinyin"]["items"]:
        if item.get("tts"):
            jobs.append(
                {
                    "kind": "pinyin-item",
                    "key": item["id"],
                    "text": item["tts"],
                    "voice": ZH_VOICE,
                    "dest": tts_cache_path("pinyin-item", item["id"], item["tts"], ZH_VOICE, "-10%"),
                }
            )
        jobs.append(
            {
                "kind": "pinyin-case",
                "key": item["id"],
                "text": item["sentence"],
                "voice": ZH_VOICE,
                "dest": tts_cache_path("pinyin-case", item["id"], item["sentence"], ZH_VOICE, "-10%"),
            }
        )
    for entry in content["english"]:
        letter = entry["letter"]
        jobs.extend(
            [
                {
                    "kind": "en-letter",
                    "key": letter,
                    "text": f"{letter}.",
                    "voice": EN_VOICE,
                    "dest": tts_cache_path("en-letter", letter, f"{letter}.", EN_VOICE, "-10%"),
                },
                {
                    "kind": "en-word",
                    "key": letter,
                    "text": entry["word"],
                    "voice": EN_VOICE,
                    "dest": tts_cache_path("en-word", letter, entry["word"], EN_VOICE, "-10%"),
                },
                {
                    "kind": "en-sentence",
                    "key": letter,
                    "text": entry["sentence"],
                    "voice": EN_VOICE,
                    "dest": tts_cache_path("en-sentence", letter, entry["sentence"], EN_VOICE, "-10%"),
                },
                {
                    "kind": "en-zh",
                    "key": letter,
                    "text": entry["sentenceZh"],
                    "voice": ZH_VOICE,
                    "dest": tts_cache_path("en-zh", letter, entry["sentenceZh"], ZH_VOICE, "-10%"),
                },
            ]
        )

    print(f"preparing {len(jobs)} TTS clips", flush=True)
    asyncio.run(generate_tts(jobs))

    pinyin_items = build_pinyin(content)
    english_items = build_english(content)

    pinyin_order = [
        item_id
        for category in content["pinyin"]["categories"]
        for item_id in category["items"]
    ]
    # 大写 A-Z 全部排在前，小写 a-z 全部排在后（详情页上一个/下一个按此顺序）。
    english_order = [f"{chr(65 + i)}-upper" for i in range(26)] + [
        f"{chr(97 + i)}-lower" for i in range(26)
    ]

    app_data = {
        "pinyin": {
            "categories": content["pinyin"]["categories"],
            "items": pinyin_items,
            "order": pinyin_order,
        },
        "english": {
            "categories": [
                {
                    "id": "uppercase",
                    "title": "大写字母",
                    "desc": "A 到 Z，按顺序认一认。",
                    "items": [f"{chr(65 + i)}-upper" for i in range(26)],
                },
                {
                    "id": "lowercase",
                    "title": "小写字母",
                    "desc": "a 到 z，和大写字母做朋友。",
                    "items": [f"{chr(97 + i)}-lower" for i in range(26)],
                },
            ],
            "items": english_items,
            "order": english_order,
        },
    }

    js = "/* Generated by tools/build_assets.py. Edit content.json and rebuild instead. */\n"
    js += "window.APP_DATA = " + json.dumps(app_data, ensure_ascii=False, indent=2) + ";\n"
    (ROOT / "app-data.js").write_text(js, encoding="utf-8")
    print("wrote app-data.js", flush=True)

    total = sum(p.stat().st_size for p in OUT_PINYIN.glob("*.mp3")) + sum(
        p.stat().st_size for p in OUT_ENGLISH.glob("*.mp3")
    )
    print(f"audio total: {total / 1024 / 1024:.1f} MB", flush=True)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
