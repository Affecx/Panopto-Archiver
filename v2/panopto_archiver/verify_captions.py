"""Local independent ASR comparison. Disagreement is not ground-truth accuracy."""
import argparse
import hashlib
import json
import math
import re
import statistics
import subprocess
import time
import unicodedata
import wave
from pathlib import Path


def tokens(text):
    text = unicodedata.normalize('NFKC', text).casefold().replace('’', "'")
    return re.findall(r"[^\W_]+(?:'[^\W_]+)*", text, flags=re.UNICODE)


def stamp(value):
    parts = value.strip().split(':')
    if len(parts) not in (2, 3):
        raise ValueError('Evidence must contain observed caption timestamps')
    values = [float(part) for part in parts]
    if any(not math.isfinite(v) or v < 0 for v in values) or any(v >= 60 for v in values[1:]):
        raise ValueError('Invalid observed timestamp')
    return sum(v * 60 ** i for i, v in enumerate(reversed(values)))


def caption_words(evidence):
    words = []
    for item in evidence:
        start = stamp(item['source'].rsplit(' · ', 1)[-1])
        words.extend({'text': token, 'start': start, 'source_id': item['id']} for token in tokens(item['text']))
    if not words or any(b['start'] < a['start'] for a, b in zip(words, words[1:])):
        raise ValueError('Expected nonempty chronological caption evidence')
    return words


def asr_words(result):
    words = []
    for segment in result['segments']:
        for word in segment.get('words', []):
            start, end = float(word['start']), float(word['end'])
            if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end < start:
                raise ValueError('Invalid ASR timestamps')
            words.extend({'text': token, 'start': start, 'end': end} for token in tokens(word['word']))
    if not words:
        raise ValueError('No independently recognised words')
    return words


def alignment(reference, hypothesis):
    from rapidfuzz.distance import Levenshtein
    ops = Levenshtein.opcodes([w['text'] for w in reference], [w['text'] for w in hypothesis])
    counts = {'equal': 0, 'substitutions': 0, 'deletions': 0, 'insertions': 0}
    matches, differences = [], []
    for tag, a, b, c, d in ops:
        if tag == 'equal':
            counts['equal'] += b-a
            matches.extend((i, j) for i, j in zip(range(a, b), range(c, d)))
        else:
            n, m = b-a, d-c
            substitution = min(n, m)
            counts['substitutions'] += substitution
            counts['deletions'] += n-substitution
            counts['insertions'] += m-substitution
            if max(n, m) >= 3:
                differences.append({'asr_start': reference[a]['start'] if a < len(reference) else None,
                                    'caption_start': hypothesis[c]['start'] if c < len(hypothesis) else None,
                                    'asr': ' '.join(w['text'] for w in reference[a:b]),
                                    'captions': ' '.join(w['text'] for w in hypothesis[c:d]),
                                    'asr_word_count': n, 'caption_word_count': m})
    errors = counts['substitutions']+counts['deletions']+counts['insertions']
    return counts, errors, matches, differences


def compare(evidence, result, duration):
    reference, captions = asr_words(result), caption_words(evidence)
    counts, errors, matches, differences = alignment(reference, captions)
    offsets = [reference[i]['start']-captions[j]['start'] for i, j in matches]
    windows = []
    for start in range(0, math.ceil(duration), 60):
        end = min(start+60, duration)
        refs = [w for w in reference if start <= w['start'] < end]
        caps = [w for w in captions if start <= w['start'] < end]
        equal = sum(1 for i, j in matches if start <= reference[i]['start'] < end)
        caption_equal = sum(1 for i, j in matches if start <= captions[j]['start'] < end)
        windows.append({'start': start, 'end': end, 'asr_words': len(refs), 'caption_words': len(caps),
                        'globally_matched_asr_words': equal,
                        'asr_match_fraction': equal/len(refs) if refs else None,
                        'caption_match_fraction': caption_equal/len(caps) if caps else None,
                        'review': 'ASR speech without timestamped captions' if len(refs) >= 10 and not caps else
                                  'Low ASR word agreement' if len(refs) >= 10 and equal/len(refs) < .6 else
                                  'Low caption word agreement; ASR may have omitted speech' if len(caps) >= 10 and caption_equal/len(caps) < .6 else ''})
    return {'method': 'Minimum word-level Levenshtein alignment; Whisper reference, Panopto hypothesis. Case/punctuation normalized; fillers and numbers retained.',
            'warning': 'Agreement is not accuracy. Both transcripts may be wrong; no human reference exists. Cue times are starts, not word alignment. Tail beyond this audio track is not verified.',
            'audio_duration_seconds': duration, 'asr_words': len(reference), 'caption_words': len(captions),
            'counts': counts, 'word_disagreement_rate': errors/len(reference),
            'exact_asr_word_match_fraction': counts['equal']/len(reference),
            'exact_caption_word_match_fraction': counts['equal']/len(captions),
            'median_matched_asr_minus_caption_start_seconds': statistics.median(offsets) if offsets else None,
            'caption_first_start': captions[0]['start'], 'caption_last_start': captions[-1]['start'],
            'asr_first_start': reference[0]['start'], 'asr_last_end': reference[-1]['end'],
            'review_windows': [w for w in windows if w['review']], 'windows': windows,
            'differences': sorted(differences, key=lambda d: max(d['asr_word_count'], d['caption_word_count']), reverse=True)}


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as file:
        for block in iter(lambda: file.read(1024*1024), b''):
            h.update(block)
    return h.hexdigest()


def run(args):
    # Accept existing local files only, never URLs, auth headers or signed media sources.
    if not args.audio.is_file() or not args.evidence.is_file():
        raise ValueError('Existing local audio and evidence JSON are required')
    args.output.mkdir(parents=True, exist_ok=True)
    pcm = args.output/'audio-16khz.wav'
    subprocess.run([str(args.ffmpeg), '-nostdin', '-v', 'error', '-y', '-i', str(args.audio.resolve()),
                    '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', str(pcm.resolve())], check=True)
    with wave.open(str(pcm)) as audio:
        duration = audio.getnframes()/audio.getframerate()
    import mlx_whisper
    import importlib.metadata
    metadata = {'audio_sha256': digest(pcm), 'evidence_sha256': digest(args.evidence), 'model': args.model,
                'mlx_whisper_version': importlib.metadata.version('mlx-whisper'), 'language': 'en',
                'temperature': 0, 'condition_on_previous_text': False, 'word_timestamps': True,
                'caption_prompt_used': False}
    meta_path, result_path = args.output/'asr-metadata.json', args.output/'whisper.json'
    start = time.monotonic()
    if meta_path.exists() and result_path.exists() and json.loads(meta_path.read_text()).get('request') == metadata:
        result = json.loads(result_path.read_text())
        print('Reused matching local Whisper result', flush=True)
    else:
        print('Starting local Whisper transcription without caption hints', flush=True)
        import numpy as np
        with wave.open(str(pcm)) as audio:
            waveform = np.frombuffer(audio.readframes(audio.getnframes()), dtype=np.int16).astype(np.float32)/32768
        result = mlx_whisper.transcribe(waveform, path_or_hf_repo=args.model,
                                        language='en', temperature=0, word_timestamps=True,
                                        condition_on_previous_text=False, hallucination_silence_threshold=2,
                                        verbose=False)
        result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2))
        meta_path.write_text(json.dumps({'request': metadata, 'transcription_wall_seconds': time.monotonic()-start}, indent=2))
    report = compare(json.loads(args.evidence.read_text()), result, duration)
    report['asr_metadata'] = json.loads(meta_path.read_text())
    report['low_confidence_segments'] = [dict(start=s['start'], end=s['end'], avg_logprob=s.get('avg_logprob'),
                                             no_speech_prob=s.get('no_speech_prob')) for s in result['segments']
                                       if s.get('avg_logprob', 0) < -1 or s.get('no_speech_prob', 0) > .6]
    (args.output/'comparison.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    lines = ['# Caption versus local Whisper comparison', '', report['warning'], '',
             f"Audio duration: {duration:.2f} seconds. Whisper words: {report['asr_words']:,}; caption words: {report['caption_words']:,}.",
             f"Exact aligned Whisper-word agreement: {report['exact_asr_word_match_fraction']:.1%}. Caption-word agreement: {report['exact_caption_word_match_fraction']:.1%}.",
             f"Word disagreement rate (Whisper reference): {report['word_disagreement_rate']:.1%}. This is not caption error against a human reference.",
             f"Last caption starts at {report['caption_last_start']:.1f}s; last recognised word ends at {report['asr_last_end']:.1f}s.",
             f"Flagged one-minute windows: {len(report['review_windows'])}. Low-confidence ASR segments: {len(report['low_confidence_segments'])}.", '',
             'Normalization: lowercase and punctuation only; fillers and numbers retained. No caption text was supplied to Whisper. Timed bins use caption cue starts and may straddle speech boundaries.', '',
             '## Largest disagreements for listening review', '']
    for item in report['differences'][:20]:
        lines += [f"- ASR {item['asr_start']}s / captions {item['caption_start']}s", f"  - Whisper: {item['asr'] or '(none)'}", f"  - Captions: {item['captions'] or '(none)'}"]
    (args.output/'comparison.md').write_text('\n'.join(lines)+'\n')
    print(json.dumps({k: report[k] for k in ('audio_duration_seconds', 'asr_words', 'caption_words', 'exact_asr_word_match_fraction', 'word_disagreement_rate', 'caption_last_start', 'asr_last_end')}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audio', type=Path, required=True)
    parser.add_argument('--evidence', type=Path, required=True, help='Cleaned evidence JSON with observed source timestamps')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--ffmpeg', type=Path, required=True)
    parser.add_argument('--model', default='mlx-community/whisper-small.en-mlx')
    args = parser.parse_args()
    run(args)


if __name__ == '__main__':
    main()
