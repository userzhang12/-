"""Offline Mandarin synthesis and the optional managed voice adapter."""
import ctypes as C
import io
import os
import threading
import wave
from pathlib import Path

import espeakng_loader
import httpx

_lock = threading.Lock()
_callback_type = C.CFUNCTYPE(C.c_int, C.POINTER(C.c_short), C.c_int, C.c_void_p)
_MAX_AUDIO = 8 * 1024 * 1024


def local_wav(dialogue):
    text = dialogue.encode("utf-8")
    fragments = []
    processing_failed = False

    @_callback_type
    def receive(samples, count, _events):
        nonlocal processing_failed
        try:
            if samples and count:
                fragments.append(C.string_at(samples, count * C.sizeof(C.c_short)))
            return 0
        except Exception:
            processing_failed = True
            return 1

    with _lock:
        lib = espeakng_loader.load_library()
        lib.espeak_Initialize.argtypes = [C.c_int, C.c_int, C.c_char_p, C.c_int]
        lib.espeak_SetSynthCallback.argtypes = [_callback_type]
        lib.espeak_SetVoiceByName.argtypes = [C.c_char_p]
        lib.espeak_Synth.argtypes = [C.c_void_p, C.c_size_t, C.c_uint, C.c_int,
                                     C.c_uint, C.c_uint, C.c_void_p, C.c_void_p]
        data_dir = str(Path(espeakng_loader.get_data_path()).parent).encode()
        # Synchronous output keeps the callback alive until all samples are collected.
        rate = lib.espeak_Initialize(2, 0, data_dir, 0x8000)
        if rate <= 0:
            raise ValueError("本地配音引擎未能启动")
        try:
            lib.espeak_SetSynthCallback(receive)
            if lib.espeak_SetVoiceByName(b"cmn") != 0 or lib.espeak_SetParameter(1, 185, 0) != 0:
                raise ValueError("普通话音色初始化失败")
            if lib.espeak_Synth(text, len(text) + 1, 0, 1, 0, 1, None, None) != 0:
                raise ValueError("普通话语音合成失败")
        finally:
            lib.espeak_Terminate()

    if processing_failed or not fragments:
        raise ValueError("配音引擎返回了空音频")
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(b"".join(fragments))
    return output.getvalue()


def render(dialogue, target):
    endpoint = os.getenv("JINGXU_TTS_URL")
    if not endpoint:
        target.write_bytes(local_wav(dialogue))
        return
    token = os.getenv("JINGXU_TTS_KEY")
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    with httpx.stream("POST", endpoint, headers=headers, json={"text": dialogue, "language": "zh-CN"},
                      timeout=30, follow_redirects=False) as response:
        response.raise_for_status()
        written = 0
        with target.open("wb") as output:
            for chunk in response.iter_bytes():
                written += len(chunk)
                if written > _MAX_AUDIO:
                    raise ValueError("配音供应商返回的音频文件过大")
                output.write(chunk)
        if written == 0:
            raise ValueError("配音供应商返回了空音频")
