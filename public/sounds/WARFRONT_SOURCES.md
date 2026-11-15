# Исходники звуков Warfront

Из этих записей `tools/import_sounds.py` собирает звуки мода (монтаж, фильтры, слои, петли, компрессия). Сами
исходники в мод не попадают — только готовые OGG в `src/main/resources/assets/warfront/sounds/`.

Все записи — **CC0 / общественное достояние**: можно использовать и изменять в любых проектах, в том числе
распространяемых, без разрешения и оплаты. Указываем авторов из уважения (не обязательно по лицензии).

## Sunset Sound Effects Library (USC Cinema / Sunset Editorial) — CC0 1.0

Архив на Internet Archive (оцифровка плёнок USC, передал Craig Smith, выложил Jason Scott), лицензия CC0 1.0:
https://archive.org/details/SSE_Library_EXPLOSIONS и https://archive.org/details/SSE_Library_GUNS (папки ARTILLERY,
AUTOMATIC), https://archive.org/details/SSE_Library_AIRCRAFT.
Файлы — в `sse/`.

| Файл | Где используется |
|---|---|
| EXPLReal_Large_explosion_with_debris, Single_heavy_explosions_1/2, Violent_explosion_and_debris_2_takes, Explosion_good | близкие прилёты (4 варианта), подрыв в воздухе, разрыв гранаты FPV-дрона |
| EXPLReal_Heavy_sharp_explosion_with_reverb | подрыв зенитной ракеты |
| EXPLReal_Medium_distant_explosions_cluster, Heavy_explosion_with_reverberation, Land_explosion | далёкие прилёты |
| EXPLReal_Atomic_bomb_explosion_then_rumble, Atom_bomb_explosion | ядерный взрыв и его раскат |
| GUNArtl_Large_shells_flies_overhead, EXPLReal_Incoming_shells_explosions | свист подлетающего снаряда «Града» (3 варианта) |
| GUNArtl_PT_boat_fires | рёв очереди «Шилки» (петля) и эхо после очереди |
| GUNAuto_50_cal_Browning_machine_gun | отдельные выстрелы — частый «стук» четырёх стволов «Шилки» |
| AERORckt_V2_rocket_fires (SSE_Library_AIRCRAFT, ROCKET) | пуск С-400 — запуск двигателя после выброса и рёв, уходящий вверх (`s400_launch`), рёв в полёте (`s400_boost_loop`) |
| AERORckt_Small_rocket_launch (SSE_Library_AIRCRAFT, ROCKET) | «вжух» схода ракеты «Стрелы» и снарядов «Града» (0.28.2) |
| остальные в `sse/` (в т.ч. пулемёты, 37-мм пушки) | скачаны для будущих звуков (обстрел вдали, базука, корабельное орудие) |

## BigSoundBank.com — CC0 1.0 (Joseph SARDIN)

Лицензия: https://bigsoundbank.com/licenses.html · «Additional sounds: Joseph SARDIN — BigSoundBank.com»

| Файл | Запись | Страница | Где используется |
|---|---|---|---|
| bsb_1808.ogg | Explosion #2 — пропановая пушка в ~10 м | https://bigsoundbank.com/explosion-2-s1808.html | хлопок стартового заряда ПЗРК, хлёсткий разрыв гранаты FPV-дрона, хлопок выброса С-400 (ниже тоном), треск ударной волны прилёта и сбития |
| bsb_1807.ogg | Explosion #1 — в ~150 м | https://bigsoundbank.com/explosion-1-s1807.html | треск пуска «Града» и зенитки |
| bsb_1806.ogg | Explosion far away #2 — в ~250 м | https://bigsoundbank.com/explosion-far-away-2-s1806.html | — (запас) |
| bsb_1023.ogg | Explosion far away #1 | https://bigsoundbank.com/explosion-far-away-s1023.html | — (запас) |
| bsb_3113.ogg | Thunder #2 | https://bigsoundbank.com/thunder-2-s3113.html | — (запас) |
| bsb_2718.ogg | Thunder #1 | https://bigsoundbank.com/thunder-s2718.html | раскат далёкого прилёта |
| bsb_3181.ogg | Thunder #8 | https://bigsoundbank.com/thunder-8-s3181.html | — (запас) |
| bsb_2148.ogg | Excavator, use — Volvo EC55B | https://bigsoundbank.com/excavator-use-s2148.html | гидравлика опор, стрелы, крышки шахты |
| bsb_1022.ogg | Fall of Stone | https://bigsoundbank.com/fall-of-stone-s1022.html | обломки |
| bsb_1137.ogg | Firecracker with wick #1 | https://bigsoundbank.com/firecracker-with-wick-1-s1137.html | отстрел ускорителя, воспламенение |
| bsb_3551.ogg | Drone #7 — небольшой квадрокоптер DJI | https://bigsoundbank.com/drone-7-s3551.html | основа воя моторов FPV-дрона (`fpv_motor_loop`) |
| bsb_1524.ogg | Car door #3 — дверь Peugeot 107, открывание и закрывание | https://bigsoundbank.com/car-door-3-s1524.html | дверь кабины открывается (`cab_door_open`, 0.30) |
| bsb_0655.ogg | Car door — хлопок двери, изнутри машины | https://bigsoundbank.com/car-door-s0655.html | дверь кабины захлопывается (`cab_door_close`) |
| bsb_0053.ogg | Metal box lid — крышка металлического ящика | https://bigsoundbank.com/metal-box-lid-s0053.html | лязг люка гусеничной машины (`cab_hatch`) |
| bsb_1490.ogg | Pneumatic brake released — сброс пневмотормоза | https://bigsoundbank.com/pneumatic-brake-released-s1490.html | шипение тормозов при остановке (`vehicle_air_brake`) |
| bsb_1298.ogg | Truck reverse beep — зуммер заднего хода | https://bigsoundbank.com/truck-reverse-beep-s1298.html | писк заднего хода (`vehicle_reverse`) |
| bsb_3545–3550, bsb_3552 | Drone #1–#6, #8 — тот же квадрокоптер: взлёт, висение, пролёты | https://bigsoundbank.com/search?q=drone | — (запас: взлёт, пролёт) |

## NASA — общественное достояние

Материалы NASA, как правило, не охраняются авторским правом — правила использования:
https://www.nasa.gov/multimedia/guidelines/index.html (ссылка со страницы https://www.nasa.gov/historical-sounds/).
NASA не одобряет и не рекламирует этот мод.

| Файл | Запись | Где используется |
|---|---|---|
| nasa_663784main_SLS_Audio_D.mp3 | SLS Test Fire (огневое испытание двигателя) | рёв ускорителей, пуски «Фламинго», «Герани», зенитных ракет, «Града», запуск двигателя ракеты ПЗРК |
| nasa_590189main_ringtone_131_launchNats.mp3 | Discovery STS-131: Sound of Launch | старт и разгон «Искандера», «Сатана» |
| nasa_590329main_ringtone_SDO_launchNats.mp3 | Atlas V: Launch | низкий гул старта «Искандера» и «Сатаны» |

## Настоящие записи «Шахеда» (0.28.3)

Лицензия не проверялась — решение владельца: мод только для своего сервера (см. AGENTS.md).

| Файл | Откуда | Где используется |
|---|---|---|
| zvukogram/zvuk-shaheda-136-v-nebe-nad-gorodom.mp3 | https://zvukogram.com/category/zvuki-drona/ — «Звук Шахеда-136 в небе над городом» | мотор «Герани» (`drone_engine_loop`): ровный кусок 6.5–10.85 с, петля |

## FPV и «Ланцет» (0.34.1)

zvukogram.com, раздел «Звуки дрона» (https://zvukogram.com/category/zvuki-drona/). Лицензия не проверялась — решение
владельца: мод только для своего сервера (см. AGENTS.md). Монтаж — `import_sounds.py fpv`.

| Файл | Название на сайте | Где используется |
|---|---|---|
| zvukogram/rezkiy-jujjaschiy-prolt-skorostnogo-drona.mp3 | «Резкий жужжащий пролёт скоростного дрона» | вой FPV вблизи (`fpv_motor_loop`, 8.0–14.6 с) и издалека (`fpv_motor_far`) |
| zvukogram/skorostnoy-kvadrokopter-pronositsya-cherez-les.mp3 | «Скоростной квадрокоптер проносится через лес» | FPV издалека (`fpv_motor_far`) |
| zvukogram/propvosh-na-polnoy-moschnosti.mp3 | «Проп-вош на полной мощности» | проп-вош FPV на снижении (`fpv_wash_loop`) |
| zvukogram/zahod-krujaschego-udarnika-na-tsel.mp3 | «Заход кружащего ударника на цель» | мотор «Ланцета» (`lancet_motor_loop`), свист пикирования (`lancet_dive_loop`), удар (`lancet_blast`) |
| zvukogram/dalkoe-jujjanie-v-nebe-na-patrule.mp3 | «Далёкое жужжание в небе на патруле» | «Ланцет» издалека (`lancet_far_loop`) |
| zvukogram/svistyaschiy-razgon-gonki-v-lesu.mp3 | «Свистящий разгон гонки в лесу» | «вжух» схода с катапульты (`lancet_launch`) |

## Синтез (свои)

Писк включения моторов FPV (`fpv_arm`), сигнал FPV-очков (`fpv_goggles`) и электронные сигналы (`beep`, `air_defense_lock`, тоны головки ПЗРК
`manpads_growl`, `manpads_lock`, импульс лазерного дальномера `rangefinder_laser`, доклад по радио `radio_report`),
вой сирены (`siren_wail`), привод антенны РЛС (`radar_drive`) — `tools/gen_sounds.py`;
свист лопаток турбины в `cruise_loop`, удары низа взрывов и выстрелов «Шилки», звон металла в `shilka_hit` — синтез
в `tools/import_sounds.py`. Звуки «Шилки» отдельно: `.tools/audio-venv/bin/python tools/import_sounds.py shilka`.

## Internet Archive «GOLD TAPE» — CC0 1.0 и Mixkit — звуки «Фламинго» (0.32.2–0.32.4)

Файлы — в `gold/` и `mixkit/` (номер — id звука на mixkit.co, лицензия Mixkit Sound Effects Free License,
https://mixkit.co/license/#sfxFree); монтаж — `import_sounds.py fp5`. Полная таблица — `CREDITS.md` в корне.

| Файл | Где используется |
|---|---|
| mixkit_1568 «War plane loop» + G08-20 Constant Jet Noise (https://archive.org/details/GOLD_TAPE_08_09_10_11_Aircraft-Jets) | `fp5_cruise_loop` — ближний рёв маршевого |
| mixkit_1587 «Jet plane flying rumble» | `fp5_cruise_far` — гул вдали |
| mixkit_1720 «Space rocket full power turbine» | `fp5_boost_loop` — ускоритель |
| mixkit_1725 «Rocket ignition flames», mixkit_1715 «Rocket engine ignition rumble», G33-25 Bazooka | `fp5_launch_*` |
| mixkit_1719 «Space rocket traveling in distance» | `s400_coast_loop` — 48Н6 по инерции (0.33.0) |
| mixkit_1724 «Sci fi rocket afterburner» + SSE «Small rocket launch» + G33-25 Bazooka | `thaad_launch_*` — пуск THAAD (0.34) |
| mixkit_1717 «Space Shuttle rocket ignition start» | `thaad_boost_loop` — ускоритель THAAD (0.34) |
| G33-10 Missile Explosion, G33-18 Explosion with Debris (https://archive.org/details/GOLD_TAPE_33_Explosions_and_War) | `fp5_impact_near_*` |
| G33-32 Distant Bomb Explosion (там же) | `fp5_impact_far_*` |

## «Орешник» и С-500 (0.35)

zvukogram.com (разделы «Ракета», «Взрыв»). Лицензия не проверялась — решение владельца: мод только для своего сервера
(см. AGENTS.md). Монтаж — `import_sounds.py oreshnik`.

| Файл | Название на сайте | Где используется |
|---|---|---|
| zvukogram/howitzer-hit-and-fell-a-strong-explosion-of-rubble-and-gravel.mp3 | «Попадание гаубицы, сильный взрыв, падают обломки и гравий» | шесть ударов серии прилёта «Орешника» (`oreshnik_impact`; по видео из Днепра 21.11.2024 — удары очередью) |
| zvukogram/powerful-bomb-explosion-with-destruction-and-echo.mp3 | «Мощный взрыв бомбы с разрушениями и эхом» | общий раскат под серией (`oreshnik_impact`) |
| zvukogram/a-fast-moving-rocket.mp3 | «Быстро летящая ракета» | свист раскрывшихся блоков «Орешника» (`oreshnik_streak`) |
| zvukogram/interceptor-missile-sound.mp3 | «Звук ракеты-перехватчика» | запуск двигателя 77Н6 после выброса (`s500_launch_*`) |
| zvukogram/space-rocket-rocket-launch.mp3 | «Космическая ракета, запуск» | рёв 77Н6, уходящий вверх (`s500_launch_*`), рёв в полёте (`s500_boost_loop`) |

## Пуски ПВО — настоящие записи BBC Sound Effects (0.35.4)

BBC Sound Effects archive, https://sound-effects.bbcrewind.co.uk/ (лицензия RemArc — только для личного/учебного
использования; решение владельца: мод только для своего сервера, см. AGENTS.md). Файлы — в `bbc/` (номер — id записи
на сайте), монтаж — `import_sounds.py pvo`. Ближний и дальний звук пуска — разные файлы (`*_launch` / `*_launch_far`):
вдали — без высоких, с эхом местности и с задержкой на скорость звука (`LaunchSounds`).

| Файл | Название в архиве | Где используется |
|---|---|---|
| bbc/bbc_00008097.ogg | «Rocket launcher» (BBC News Sound Effects Tape) — три настоящих пуска | `air_defense_launch_*` («Стрела»), `manpads_launch*`, основа дальних `*_launch_far*` |
| bbc/bbc_07041216.ogg | «Solid fuel rocket motor.» (7.3 с) | рёв твердотопливного двигателя: `s400_launch_*`, `thaad_launch_*`, `s500_launch_*` |
| bbc/bbc_07041215.ogg | «Solid fuel rocket motor.» (4.0 с) | короткий запуск двигателя: `strela`, `manpads`, второй вариант пусков |
| bbc/bbc_07043196.ogg | «84mm medium anti tank weapon, two rounds of high explosive fired. (Close perspective.)» | хлопок вышибного заряда вблизи: С-400, С-500 (холодный старт), ПЗРК |
| bbc/bbc_07043197.ogg | «84mm medium anti tank weapon fired. (Distant perpective.)» | тот же хлопок издалека: `*_launch_far*` |
| bbc/bbc_07043220.ogg | «RAF Hawker Siddeley Harrier, three fly overhead firing rockets» | раскат ракет, уходящих вверх: `thaad_launch_*`, дальние пуски |

## «Арсенал» (0.36)

zvukogram.com (разделы «Звуки ракет», «Звук артиллерии», «Звук военной техники»). Лицензия не проверялась — решение
владельца: мод только для своего сервера (см. AGENTS.md). Монтаж — `import_sounds.py arsenal`.

| Файл | Название на сайте | Где используется |
|---|---|---|
| zvukogram/launching-a-projectile-from-a-rocket-launcher.mp3 | «Запуск снаряда из ракетной установки» | хлопок схода GMLRS (`himars_launch_*`) |
| zvukogram/rocket-launch-sound.mp3, zvukogram/rocket-2.mp3 | «Звук запуска ракеты», «Ракета — короткий вылет» | рёв GMLRS, уходящий вверх (`himars_launch_*`) |
| zvukogram/cobra-battle-sound-rocket-launches-attack.mp3 | «Боевой залп ракеты „Кобра“» | одиночные пуски из залпа (2.0, 4.1, 5.4 с) — ракета ТОС-1А (`tos_launch_*`) |
| zvukogram/deafening-noise-when-the-rocket-was-launched.mp3 | «Оглушительный шум запуска ракеты» | ускоритель крылатой ракеты при старте из ячейки (`cell_launch_1`) |
| zvukogram/long-sound-of-rocket-launch-and-flight.mp3 | «Долгий запуск и полёт ракеты» | то же, второй вариант (`cell_launch_2`) |
| zvukogram/anti-aircraft-missile-system-quotstingerquot.mp3 | «Зенитный комплекс Стингер» | пуск ПЗРК «Стингер» (0.36.1) |
| zvukogram/release-of-a-combat-missile.mp3, short-rocket-launch-sound.mp3, projectile-launch.mp3, rocket-strike-with-a-number-of-exploding-projectiles.mp3 | «Выпуск боевой ракеты», «Короткий звук запуска ракеты», «Запуск снаряда», «Ракетный удар с серией взрывов» | пуски «Бука» (`buk_launch_*`), NASAMS (`nasams_launch_*`), IRIS-T SLM (`iris_launch_*`) (0.36.1); очереди 30 мм «Панциря» — петля «Шилки» ниже тоном |

## Настоящие пуски военных ракет (0.37.15)

Натурный звук роликов на Internet Archive (лицензия не проверялась — решение владельца: мод только для своего сервера,
см. AGENTS.md). Звук вынут ffmpeg, моно OGG, только отрезки с пуском; по спектрограммам проверено — без музыки и
диктора. Монтаж — `import_sounds.py launch`.

| Файл | Откуда | Где используется |
|---|---|---|
| archive/tor_m2_launch.ogg | https://archive.org/details/tor-m-2-january-15th-2024 («Tor M2 January 15th 2024», 25–41 с) | рёв РДТТ в полёте: зенитные ракеты, «Град», ускорители (`boost_loop`); старт «Герани» (`drone_launch_*`) — до 0.37.19, теперь снова прежний |
| archive/smerch_grad_night.ogg | https://archive.org/details/ArtilleryLaunchInUkraine.BM30SmerchAndBM21GradRocketLaunchAtNight (0–50 с) | сход снаряда «Града» (`grad_launch_*`), общий пуск (`launch_*`) |

| archive/s400_triumf_launch.ogg | https://archive.org/details/youtube-NE-jW5Hg-pw («Russian S-400 missile system in action: Triumf missile launch. No comment», 104–142 с) | пуск С-400 вблизи и издалека (`s400_launch_*`, `s400_launch_far_*`; пониже тоном — `s500_launch_*`), 0.41.3.2 |

Гул марша прочих крылатых (`cruise_loop`) — вместо синтеза запись GOLD TAPE «G08-20 Constant Jet Noise» (20–28 с).

## Полёт крылатых ракет (0.37.1)

Настоящие записи реактивных самолётов и ракет — у каждой крылатой свой звук полёта (петля вблизи, гул вдали, пролёт).
Монтаж — `import_sounds.py cruise`, подробно (что, откуда, как обработано) — `docs/plans/0.37.1-look/sound.md`.

Internet Archive «GOLD TAPE» (CC0 1.0), https://archive.org/details/GOLD_TAPE_08_09_10_11_Aircraft-Jets — файлы в `gold/`:

| Файл | Запись | Где используется |
|---|---|---|
| G11-24_B-52 Jet Fly By.mp3 | пролёт B-52 (ТРДД TF33): свист вентилятора на подлёте, рёв | «Томагавк»: свист ТРДД вблизи (`tomahawk_cruise_loop`), пролёт (`tomahawk_pass`) |
| G08-19-Constant Overhead Jet Noise.mp3 | ровный шум реактивного над головой | «Томагавк»: гул под свистом (`tomahawk_cruise_loop`) |
| G08-24-Jet High Overhead.mp3 | реактивный высоко в небе | «Томагавк» вдали (`tomahawk_cruise_far`) |
| G09-18-Constant Jet Noise.mp3 | ровный резкий шум ТРД | «Калибр» вблизи (`kalibr_cruise_loop`) |
| G10-04_F-105 Jet Constant Whine.mp3 | F-105 (ТРД J75): вой лопаток ~2.9 кГц | «Калибр»: вой поверх рёва (`kalibr_cruise_loop`) |
| G10-02-Constant Jet Noise.mp3 | ровный низкий рёв ТРД | «Калибр»: низ вблизи и гул вдали (`kalibr_cruise_far`); «Фламинго»: низ петли (`fp5_cruise_loop`) |
| G09-14_F-86 Fast Fly By.mp3 | быстрый пролёт F-86 (ТРД J47) | «Калибр»: пролёт (`kalibr_pass`) |
| G08-15_F-86 Jet Fast Fly By.mp3 | пролёт F-86: свист подлёта, тяжёлый рёв | «Фламинго»: пролёт, ниже тоном (`fp5_pass`) |
| G09-13-Distant Jet Fly By.mp3 | далёкий пролёт, низкий рокот | «Фламинго» вдали (`fp5_cruise_far`), «Буревестник» вдали (`burevestnik_cruise_far`) |
| G10-06-Constant Jet Noise - Interior.mp3 | двигатель изнутри: ровный глухой гул | «Буревестник» вблизи (`burevestnik_cruise_loop`) |
| G08-21-Constant Jet Noise.mp3 | ровный шум ТРД (середина) | «Буревестник» вблизи, ниже тоном (`burevestnik_cruise_loop`) |
| G09-23-Jet By Super Fast.mp3 | очень быстрый пролёт | «Циркон»: рвущийся всплеск пролёта (`zircon_boom`) |
| G08-18-Aircraft-Sonic Boom.mp3 | звуковой удар самолёта | «Циркон»: звуковой удар (`zircon_boom`) |

Sunset Sound Effects Library (CC0 1.0), https://archive.org/details/SSE_Library_AIRCRAFT (папка ROCKET) — в `sse/`:

| Файл | Где используется |
|---|---|
| AERORckt_Atlas missile launch_CS_USC.flac | «Циркон»: рёв ускорителя (`zircon_boost_loop`), рёв на марше и вдали (`zircon_cruise_*`) |
| AERORckt_Multiple rocket takeoffs; amazing distortion;_CS_USC.flac | «Циркон»: треск — «рвущийся» рёв (`zircon_cruise_loop`, `zircon_boost_loop`) |

Пуск «Томагавков» — съёмка ВМС США (общественное достояние как работа федерального правительства США), 07.04.2017,
эсминцы USS Porter и USS Ross; ролик NBC News на Internet Archive: https://archive.org/details/NBCNews-f_missile_launch_170406
(звук вынут ffmpeg, моно OGG).

| Файл | Где используется |
|---|---|
| nbc/tomahawk_launch_2017.ogg | «Томагавк»: рёв стартового ускорителя (`tomahawk_boost_loop`, 9.4–14.2 с) |


## Техника, «Томагавк», «Герань» вдали — настоящие записи BBC Sound Effects (0.37.23)

BBC Sound Effects archive, https://sound-effects.bbcrewind.co.uk/ (RemArc — личное использование; решение владельца:
мод только для своего сервера). Файлы — в `bbc/`, монтаж — `import_sounds.py vehicles`.

| Файл | Название в архиве | Где используется |
|---|---|---|
| bbc/bbc_07024141.ogg | «Articulated Lorry: Diesel, tickover, exterior» | дизель колёсных на холостых (`truck_idle`) |
| bbc/bbc_07001014.ogg | «Heavy lorry climbing hill» | дизель под нагрузкой (`truck_drive`) |
| bbc/bbc_07024135.ogg | «Articulated Lorry: 1976 Diesel, Steady run, interior» | низ дизеля на ходу (`truck_drive`) |
| bbc/bbc_07024136.ogg | «Articulated Lorry: Diesel, start and depart, exterior» | запуск (`truck_start`) |
| bbc/bbc_07024143.ogg | «Articulated Lorry: Diesel, approach, stop, switch off, exterior» | глушение (`truck_stop`) |
| bbc/bbc_07058094.ogg | «1 lorry passing slowly» | запас |
| bbc/bbc_07043225.ogg | «Armoured Personnel Carrier, exterior, approaches, engine idles, departs» | гусеничные на холостых (`tracked_idle`) |
| bbc/bbc_07043226.ogg | «Armoured Personnel Carrier, interior, start, engine idles, continuous run, stop» | запас |
| bbc/bbc_07014075.ogg | «Chieftain Main Battle Tank, exterior, start, run, stop» | ход, запуск, глушение гусеничных (`tracked_drive/start/stop`) |
| bbc/bbc_07014078.ogg | «Chieftain Main Battle Tank, exterior, pass on hard surface» | лязг гусениц (`vehicle_tracks`) |
| bbc/bbc_07014080.ogg | «Chieftain Main Battle Tank, exterior, turning» | запас |
| bbc/bbc_07033030.ogg | «Gasworks, crane moving on caterpillar tracks» | лязг траков (`vehicle_tracks`) |
| bbc/bbc_07032345.ogg | «25-ton Mobile Crane operating» | гидравлика развёртывания (`hydraulics`, `hydraulics_2`) |
| bbc/bbc_07070013.ogg | «Hydraulic bed raised» | удар упора в конце хода (`hydraulics*`) |
| bbc/bbc_07054066.ogg | «Winch operated quickly, start, stop» | вой привода башни (`turret_drive`) |
| bbc/bbc_07024190.ogg | «Electrical: Train Motor» | гул электромотора привода (`turret_drive`) |
| bbc/bbc_07032346.ogg | «Old-type Electric Crane operating» | запас |
| bbc/bbc_07000116–118.ogg | «Aircraft passing overhead. (Jet Fighter)» | «Томагавк»: пролёт (`tomahawk_pass`), свист (`tomahawk_cruise_loop`) |
| bbc/bbc_07036154.ogg | «Hawker Harrier, exterior, passing over» | «Томагавк» вблизи и вдали (`tomahawk_cruise_loop/far`) |

«Герань» вдали (`geran_far_loop`) — та же запись «Шахеда» (zvukogram), глухо (без верхов).

## Вертолёт Ми-8 — Sea King, BBC Sound Effects (0.38.1)

BBC Sound Effects archive, https://sound-effects.bbcrewind.co.uk/ (RemArc — личное использование; решение владельца:
мод только для своего сервера). Sea King — двухдвигательный, с пятилопастным несущим винтом: по звуку близок к Ми-8
(частота хлопков лопастей ~17,6 Гц у Sea King, ~16 Гц у Ми-8). Монтаж — `import_sounds.py heli`.

| Файл | Название в архиве | Где используется |
|---|---|---|
| bbc/bbc_07025031.ogg | «Sea King Helicopter, exterior, start up» | ВСУ (`heli_apu`, 8–23 с), вой турбин (`heli_turbine`, 56–71 с) |
| bbc/bbc_07025032.ogg | «Sea King Helicopter, exterior, taxi, take off into distance» | несущий винт на номинале (`heli_rotor`, 82–96,5 с) |

## Разведдроны «Орлан-10» и MQ-9 Reaper — BBC Sound Effects (0.39.2)

Тот же архив BBC (RemArc, решение владельца). У «Орлана» — двухтактный бензиновый мотор, у MQ-9 — турбовинтовой: взяты
записи двухтактных моторов и турбовинтовых самолётов. Раскрытие парашюта — синтез (`recon_chute`). Монтаж —
`import_sounds.py recon`.

| Файл | Название в архиве | Где используется |
|---|---|---|
| bbc/bbc_07076051.ogg | «Two-stroke petrol engine driving small elevator, start, run, stop» | мотор «Орлана» вблизи (`orlan_motor_loop`, 40–47 с), уходящий мотор в `recon_catapult` |
| bbc/bbc_07002291.ogg | «A two-stroke band saw … start, run, stop» | вой мотора «Орлана» издалека (`orlan_far_loop`, 33–43 с) |
| bbc/bbc_07051138.ogg | «Embraer Bandeirante, exterior, fly overhead after take-off» | гул MQ-9 в небе (`reaper_far_loop`, 20–34 с) |
| bbc/bbc_07019185.ogg | «Bristol Britannia, exterior, taxi-ing to take off» | MQ-9 на земле (`reaper_taxi_loop`, 46–62 с) |
| bbc/bbc_07019182.ogg | «Bristol Britannia, exterior, take off» | взлёт MQ-9 (`reaper_takeoff`, 12–34 с) |
| bbc/bbc_07066044.ogg | «Compressed air line» | выпуск воздуха пневмокатапульты (`recon_catapult`, 26,85–27,45 с) |

## «Арсенал III»: FP-1 и «Герань-5» — настоящие записи BBC Sound Effects (0.40)

BBC Sound Effects archive, https://sound-effects.bbcrewind.co.uk/ (RemArc — личное использование; решение владельца:
мод только для своего сервера). Скачаны оригиналы WAV (`https://sound-effects-media.bbcrewind.co.uk/wav/<id>.wav`),
сведены в моно OGG; монтаж — `import_sounds.py arsenal3` (0.40.2: петли марша — `arsenal3_loops`, 20–24 с из
случайных отрезков ровных участков, `_splice`; в игре обороты ещё медленно плавают — повтора не слышно). Мотор FP-1 (двухцилиндровый оппозитный с толкающим винтом)
собран из поршневого самолёта (выше тоном — мотор меньше, обороты выше) и двухтактного мотора — грубее и ниже
«моторчика» «Шахеда» (у «Герани-2» — своя запись), на слух отличаются. «Герань-5» — малый ТРД (турбина вертолёта
Fairey Ultralite — того же класса, что TELEFLY TF-TJ2000A), не похож на ТРД «Калибра» и ТРДД «Томагавка».

| Файл | Название в архиве | Где используется |
|---|---|---|
| bbc/bbc_07066131.ogg | «Passing low overhead - exterior (single piston, open cockpit aircraft)» | мотор FP-1 вблизи (`fp1_engine_loop`, подлёт 1.2–6.2 с ×1.45), запуск на рельсе (`fp1_start`), под рёвом схода (`fp1_launch`) |
| bbc/bbc_07001071.ogg | «Exterior, passing overhead. (Piper private light aircraft, 1 piston engine)» | FP-1 вдали (`fp1_far_loop`, уход 15–22 с, без верхов) |
| bbc/bbc_07076051.ogg | «Two-stroke petrol engine driving small elevator, start, run, stop» (уже был) | треск двухтактного поверх мотора FP-1, рывок стартера (`fp1_start`) |
| bbc/bbc_07041215.ogg | «Solid fuel rocket motor.» (уже был) | подвесной РДТТ FP-1 (`fp1_launch`) |
| bbc/bbc_07035117.ogg | «Fairey Ultralite, exterior, start jet engine, rotor tip motor, switch off» | ТРД «Герани-5» вблизи (`geran5_cruise_loop`: вой 30–38 с, гул 40–48 с), вой под стартом (`geran5_launch`) |
| bbc/bbc_07009052.ogg | «BAC 1-11, exterior, start and run up auxiliary power unit» | раскрутка ТРД на рельсе (`geran5_spool`, 15.5–22.5 с ×1.25) |
| bbc/bbc_07066142.ogg | «Passing overhead - exterior (single engine jet fighter)» | «Герань-5» вдали (`geran5_cruise_far`, подлёт 3–10 с) и пролёт (`geran5_pass`, 12.5–21.5 с ×1.22) |
| bbc/bbc_07041216.ogg | «Solid fuel rocket motor.» (уже был) | РДТТ ракетной тележки (`geran5_launch`) |

## «Арсенал III»: пуски «Нептуна», «Торнадо-С», PrSM — настоящие записи (0.40.1)

BBC Sound Effects archive, https://sound-effects.bbcrewind.co.uk/ (RemArc — личное использование; решение владельца:
мод только для своего сервера), оригинал WAV сведён в моно OGG; ночной залп «Смерча» — та же запись Internet Archive,
что у «Града». Монтаж — `import_sounds.py arsenal3_missiles`. «Нептун» — треск розжига малого РДТТ и рёв старта, выше
тоном; PrSM — тот же старт в натуральном тоне, густой и долгий; «Торнадо-С» — сход 300-мм ракеты, ниже тоном, чем
«Град» из той же записи.

| Файл | Название в архиве | Где используется |
|---|---|---|
| bbc/bbc_07046198.ogg | «V2 Rocket launching - 1975» (BBC 500B) | рёв старта «Нептуна» (`neptun_launch_N`, 2.0–9.5 с ×1.32–1.37), пуск PrSM (`prsm_launch`, 1.5–9.5 с) |
| bbc/bbc_07041215.ogg | «Solid fuel rocket motor.» (уже был) | треск розжига стартового РДТТ «Нептуна» (`neptun_launch_N`) |
| archive/smerch_grad_night.ogg | ночной залп «Смерча»/«Града» (уже был) | сход ракеты «Торнадо-С» (`tornado_launch_N`, сходы 13.9 / 17.9 / 21.9 с ×0.9–0.98) |

## «Железный купол» и Iron Beam — настоящие записи BBC Sound Effects (0.40.2)

BBC Sound Effects archive, https://sound-effects.bbcrewind.co.uk/ (RemArc — личное использование; решение владельца:
мод только для своего сервера), оригиналы WAV сведены в моно OGG; монтаж — `import_sounds.py dome_beam`. Сам луч
лазера беззвучен — слышны генератор и силовая электроника.

| Файл | Название в архиве | Где используется |
|---|---|---|
| bbc/bbc_07041215.ogg | «Solid fuel rocket motor.» (уже был) | пуск «Тамира» (`tamir_launch_N`, ×1.3–1.37) |
| bbc/bbc_07017052.ogg | «Generator running on airport apron. (Unknown airport.)» | гул генератора Iron Beam (`iron_beam_hum`, склейка 40–100 с) |
| bbc/bbc_07024188.ogg | «Electrical: Buzzing.» | жужжание электроники поверх гула (`iron_beam_hum`, 8–40 с ×1.5), включение луча (`iron_beam_fire`) |

## Противодроновое — «Ёлка», Gepard (0.40.3)

BBC Sound Effects archive, https://sound-effects.bbcrewind.co.uk/ (RemArc — личное использование), оригинал WAV сведён
в моно OGG; монтаж — `import_sounds.py counter_drone`. Очередь Gepard — записи «Шилки» ниже тоном (крупнее калибр), мотор
«Ёлки» в полёте — запись FPV-дрона выше тоном.

| Файл | Название в архиве | Где используется |
|---|---|---|
| bbc/bbc_07043284.ogg | «Compressed gas gun, single burst. (Futuristic Spot Effect.)» | хлопок пневмостарта «Ёлки» (`yolka_launch`, первый импульс 0.4–0.62 с) |
| bsb_3551.ogg | квадрокоптер DJI (BigSoundBank, CC0; уже был) | раскрутка моторов «Ёлки» (`yolka_launch`, ×1.6) |

## Зенитные пушки по настоящим записям, «Праща» (0.41.0.2)

Файлы — в `guns/` (отрывки, сведены в моно OGG 44.1 кГц); монтаж — `import_sounds.py guns`. У каждой пушки своя очередь:
удары — настоящие выстрелы, темп — как у настоящей машины (`_train`), эхо поля — свёртка.

| Файл | Источник | Где используется |
|---|---|---|
| guns/bbc_07034230_bofors_shots.ogg | BBC Sound Effects, 07034230 «Bofors Guns, shells fired, cases falling.» (RemArc — личное использование), https://sound-effects.bbcrewind.co.uk/ | выстрелы 40 мм — удары очередей Gepard (×1.1), Skyranger (×1.32), «Шилки» (×1.65), «Панциря» (×1.45); эхо после очереди (`cannon_tail`); гул вдали |
| guns/bbc_07034231_bofors_barrage.ogg | BBC, 07034231 «Bofors Guns, barrage fired, cases falling.» (0–40 с) | гул очереди вдали (`cannon_far_loop`) |
| guns/bbc_07034187_bofors_bursts.ogg | BBC, 07034187 «40mm Bofors Gun shells bursting.» (0–55 с) | подрывы снарядов AHEAD перед целью (`cannon_ahead`) |
| guns/bbc_07034188_shells_overhead.ogg | BBC, 07034188 «Shells passing overhead.» (0–30 с) | шелест снаряда, пролетевшего рядом (`cannon_crack` 1, 3) |
| guns/ia_gepard_1992.ogg | Internet Archive, youtube-KkFcvIfI6QA «Flugabwehrkanonenpanzer Gepard bekämpft Bodenziel» (учения «Prankenhieb» 1992, Берген), https://archive.org/details/youtube-KkFcvIfI6QA | настоящая очередь Gepard (38.35–39.15 и 42.3–43.35 с, шум плёнки вычтен) под ударами в `gepard_fire_loop` |
| guns/ia_phalanx_burst.ogg | Internet Archive, youtube-T4hA8IqSC58 «Mk 15 Phalanx CIWS» (ВМС США), 17.5–26 с, https://archive.org/details/youtube-T4hA8IqSC58 | рвущийся рёв очереди «Панциря» (×0.84 — калибр крупнее) |
| guns/ia_supersonic_crack.ogg | Internet Archive, «Supersonic Crack» (.30-06 в 40 ярдах, Public Domain Mark 1.0), https://archive.org/details/SupersonicCrack | щелчок ударной волны снаряда (`cannon_crack`, ниже тоном) |
| guns/soundbible_bullet_whizzing_by.ogg | Internet Archive, сборник «VA - SoundBible (Sound Effects)» — «Bullet whizzing by», https://archive.org/details/va-sound-bible-sound-effects-opus-48 | свист снаряда мимо (`cannon_crack` 2, 4) |
| bbc/bbc_07041216.ogg, bbc/bbc_07041215.ogg | BBC, твердотопливный двигатель (уже были) | пуск «Станнера» — два импульса двухрежимного РДТТ (`stunner_launch`) |

Записи современных ЗСУ (Skyranger, «Шилка», «Панцирь» без музыки) в открытых архивах не нашлись: на Wikimedia Commons
есть ролики DVIDS и Минобороны (Gepard, «Панцирь-С1», Oerlikon 35 мм), но сервер отказал в скачивании (429) — при
следующей переделке звуков попробовать снова.
