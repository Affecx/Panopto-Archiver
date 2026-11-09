import re
import math


def seconds(value):
    parts = value.replace(',', '.').split(':')
    if len(parts) not in (2, 3):
        raise ValueError('Invalid timestamp')
    numbers = [float(x) for x in parts]
    if any(not math.isfinite(n) or n < 0 for n in numbers) or any(n >= 60 for n in numbers[-2:]):
        raise ValueError('Invalid timestamp')
    result = 0.0
    for n in numbers:
        result = result * 60 + n
    return result


def stamp(value, comma=False):
    ms = round(value * 1000)
    return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02}{"," if comma else "."}{ms%1000:03}'


def parse(raw):
    cues = []
    for block in re.split(r'\n\s*\n', raw.lstrip('\ufeff').replace('\r', '')):
        lines = block.splitlines()
        for i, line in enumerate(lines):
            if '-->' not in line:
                continue
            a, b = line.split('-->', 1)
            start, end = seconds(a.strip()), seconds(b.strip().split()[0])
            if end < start:
                raise ValueError('Reversed caption timing')
            cues.append(dict(start=start, end=end, text=re.sub(r'<[^>]*>', '', '\n'.join(lines[i+1:])).strip()))
            break
    return cues


def vtt(cues):
    return 'WEBVTT\n\n' + '\n\n'.join(f'{stamp(c["start"])} --> {stamp(c["end"])}\n{c["text"]}' for c in cues)


def srt(cues):
    return '\n\n'.join(f'{i+1}\n{stamp(c["start"], True)} --> {stamp(c["end"], True)}\n{c["text"]}' for i, c in enumerate(cues))
