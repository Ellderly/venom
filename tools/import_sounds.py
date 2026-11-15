#!/usr/bin/env python3
"""Импорт звуков из репозитория warfront в public/sounds/ и запись манифеста.

usage: import_sounds.py <путь к warfront> [out_dir=public/sounds]

Слот -> шаблоны имён файлов (без расширения, * — любые символы). Новый юнит = новая строка в SLOTS
и ссылка на слот в src/units.ts.
"""
import sys, json, shutil, fnmatch
from pathlib import Path

SLOTS = {
    'geran_near':     ['drone_engine_loop'],
    'geran_far':      ['geran_far_loop'],
    'geran5_near':    ['geran5_cruise_loop'],   # ТРД вблизи: вой и гул
    'geran5_far':     ['geran5_cruise_far'],    # реактивный гул вдали
    'kh101_near':     ['tomahawk_cruise_loop'], # Х-101: её записи нет; берём петлю из записей настоящего турбовентиляторного двигателя (у Х-101 тоже ТРДД)
    'kh101_far':      ['tomahawk_cruise_far'],
    'explosion_near': ['explosion_near_*'],
    'explosion_far':  ['explosion_far_*'],
    'debris':         ['debris_impact*'],
    'siren':          ['siren_wail*'],
}
# Нарезка из исходных записей warfront (tools/sound_sources): слот -> (файл, [(начало, длительность), ...]). Нужен ffmpeg.
CLIPS = {
    # настоящий крупнокалиберный пулемёт Browning .50 (Sunset Sound Effects Library, CC0): три очереди по секунде
    'mg_burst': ('tools/sound_sources/sse/GUNAuto_50_cal_Browning_machine_gun_CS_USC.flac', [(3.62, 1.12), (5.4, 1.12), (10.9, 1.12)]),
}
EXT = {'.ogg', '.mp3', '.wav'}
CREDITS = ['credits.txt', 'SOURCES.md', 'CREDITS.md', 'CREDITS.txt', 'LICENSE', 'LICENSE.md']


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    src = Path(sys.argv[1])
    out = Path(sys.argv[2] if len(sys.argv) > 2 else 'public/sounds')
    out.mkdir(parents=True, exist_ok=True)
    skip = {'.git', 'node_modules', 'build', 'sound_sources'}  # исходные записи warfront не нужны — только готовые звуки мода
    files = sorted(p for p in src.rglob('*') if p.suffix.lower() in EXT and not skip & set(p.parts))
    manifest, total = {}, 0
    for slot, patterns in SLOTS.items():
        found = [p for p in files if any(fnmatch.fnmatch(p.stem.lower(), pat) for pat in patterns)]
        seen, names = set(), []
        for p in found:
            if p.name in seen:
                continue
            seen.add(p.name)
            shutil.copy2(p, out / p.name)
            names.append(p.name); total += p.stat().st_size
        if names:
            manifest[slot] = names
        print(f'{slot:16} {len(names)} файл(ов)' + ('' if names else '  — НЕ НАЙДЕНО, останется синтез'))
    import subprocess
    for slot, (rel, cuts) in CLIPS.items():
        srcf, names = src / rel, []
        if srcf.exists():
            for k, (ss, dur) in enumerate(cuts, 1):
                name = f'{slot}_{k}.ogg'
                r = subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(ss), '-t', str(dur), '-i', str(srcf), '-ac', '1', '-ar', '44100',
                                    '-af', f'afade=t=in:d=0.004,afade=t=out:st={dur - 0.09}:d=0.09,alimiter=limit=0.9', '-c:a', 'libvorbis', '-q:a', '5', str(out / name)])
                if r.returncode == 0:
                    names.append(name); total += (out / name).stat().st_size
        if names:
            manifest[slot] = names
        print(f'{slot:16} {len(names)} файл(ов)' + ('' if names else '  — НЕ НАЙДЕНО, останется синтез'))
    for name in CREDITS:  # авторы и лицензии едут вместе со звуками
        for p in src.rglob(name):
            if {'.git', 'node_modules', 'build'} & set(p.parts):
                continue
            shutil.copy2(p, out / ('WARFRONT_' + name)); print('лицензии:', p); break
    (out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n', encoding='utf8')
    print(f'Готово: {sum(len(v) for v in manifest.values())} файлов, {total / 1e6:.1f} МБ -> {out}')


if __name__ == '__main__':
    main()
