"""Fictional word timelines; no real university text or authentication."""
import pytest
from panopto_archiver.verify_captions import tokens, stamp, compare, caption_words


def evidence(text, at='0:00', ident='E1'):
    return {'text': text, 'source': 'fictional.txt · '+at, 'id': ident}


def asr(texts):
    return {'segments': [{'words': [{'word': text, 'start': start, 'end': start+1}
                                  for start, text in texts]}]}


def test_normalized_exact_and_substitution_insertion_deletion():
    assert tokens('PRINTF, Hello! Don’t 123.') == ['printf', 'hello', "don't", '123']
    exact = compare([evidence('Hello, WORLD!')], asr([(0, 'hello'), (1, 'world')]), 10)
    assert exact['exact_asr_word_match_fraction'] == 1
    assert exact['word_disagreement_rate'] == 0
    substitution = compare([evidence('one three')], asr([(0, 'one'), (1, 'two')]), 10)
    assert substitution['counts']['substitutions'] == 1
    assert substitution['word_disagreement_rate'] == .5
    deletion = compare([evidence('one')], asr([(0, 'one'), (1, 'two')]), 10)
    assert deletion['counts']['deletions'] == 1
    insertion = compare([evidence('one two three')], asr([(0, 'one'), (1, 'two')]), 10)
    assert insertion['counts']['insertions'] == 1


def test_missing_minute_flag_and_repeated_words_retained():
    result = compare([evidence('hello')], asr([(0, 'hello')]+[(65+i, f'word{i}') for i in range(12)]), 120)
    assert result['review_windows'][0]['start'] == 60
    assert result['review_windows'][0]['review'] == 'ASR speech without timestamped captions'
    assert result['asr_last_end'] == 77
    reverse = compare([evidence('hello'), evidence(' '.join(f'word{i}' for i in range(12)), '1:05', 'E2')], asr([(0, 'hello')]), 120)
    assert reverse['review_windows'][0]['review'] == 'Low caption word agreement; ASR may have omitted speech'
    assert len(caption_words([evidence('hello'), evidence('hello', '1:00', 'E2')])) == 2


def test_timestamp_failure_and_no_speech_are_not_success():
    assert stamp('1:02:03') == 3723
    for bad in ('bad', '1:99', '-1:00', 'nan:00'):
        with pytest.raises(ValueError):
            stamp(bad)
    with pytest.raises(ValueError):
        compare([evidence('hello')], asr([]), 10)
    with pytest.raises(ValueError):
        caption_words([evidence('late', '1:00'), evidence('early')])


def test_local_pcm_input_and_cached_asr_without_network(tmp_path, monkeypatch):
    import argparse
    import json
    import sys
    import types
    import wave
    import importlib.metadata
    from panopto_archiver import verify_captions as verifier
    source, data = tmp_path/'fictional.mp4', tmp_path/'evidence.json'
    source.write_bytes(b'fictional media; conversion mocked')
    data.write_text(json.dumps([evidence('Hello')]))
    calls = []

    class Waveform:
        def astype(self, _):
            return self

        def __truediv__(self, _):
            return self

    def convert(command, check):
        assert '-map' in command and '0:a:0' in command
        with wave.open(command[-1], 'wb') as file:
            file.setnchannels(1)
            file.setsampwidth(2)
            file.setframerate(16000)
            file.writeframes(b'\0\0'*32000)

    def transcribe(audio, **options):
        assert isinstance(audio, Waveform)  # No hidden FFmpeg PATH lookup inside MLX.
        assert 'initial_prompt' not in options
        assert options['condition_on_previous_text'] is False
        assert options['word_timestamps'] is True
        calls.append(1)
        return asr([(0, 'Hello')])

    monkeypatch.setattr(verifier.subprocess, 'run', convert)
    monkeypatch.setattr(importlib.metadata, 'version', lambda _: 'fictional-test-version')
    monkeypatch.setitem(sys.modules, 'mlx_whisper', types.SimpleNamespace(transcribe=transcribe))
    monkeypatch.setitem(sys.modules, 'numpy', types.SimpleNamespace(frombuffer=lambda *a, **k: Waveform(), int16='int16', float32='float32'))
    options = argparse.Namespace(audio=source, evidence=data, output=tmp_path/'result', ffmpeg=tmp_path/'ffmpeg', model='fictional-test-model')
    verifier.run(options)
    verifier.run(options)
    assert len(calls) == 1
    report = json.loads((options.output/'comparison.json').read_text())
    assert report['exact_asr_word_match_fraction'] == 1
    assert report['asr_metadata']['request']['caption_prompt_used'] is False
    # Changed evidence invalidates the cached comparison request.
    data.write_text(json.dumps([evidence('Hello world')]))
    verifier.run(options)
    assert len(calls) == 2
