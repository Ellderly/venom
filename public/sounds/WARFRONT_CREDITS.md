# Credits — звуки «Фламинго» (fp5), С-400 и THAAD

Файлы смонтированы `tools/import_sounds.py fp5` (нарезка, фильтры, петли, моно OGG). В игре к маршевому двигателю
добавляются громкость по расстоянию и эффект Доплера (`client/sound/MissileFlightSound`).

| Звук | Исходная запись (автор) | Ссылка | Лицензия |
|---|---|---|---|
| fp5_cruise_loop (ближний рёв) | «War plane loop» (Mixkit) + G08-20 Constant Jet Noise (GOLD TAPE) | https://mixkit.co/free-sound-effects/jet/ (id 1568), https://archive.org/details/GOLD_TAPE_08_09_10_11_Aircraft-Jets | Mixkit Sound Effects Free License; CC0 1.0 |
| fp5_cruise_far (гул вдали) | «Jet plane flying rumble» (Mixkit) | https://mixkit.co/free-sound-effects/jet/ (id 1587) | Mixkit Sound Effects Free License |
| fp5_boost_loop (ускоритель) | «Space rocket full power turbine» (Mixkit) | https://mixkit.co/free-sound-effects/rocket/ (id 1720) | Mixkit Sound Effects Free License |
| fp5_launch_1/2 (старт) | «Rocket ignition flames», «Rocket engine ignition rumble» (Mixkit) + G33-25 Bazooka (GOLD TAPE) | https://mixkit.co/free-sound-effects/rocket/ (id 1725, 1715), https://archive.org/details/GOLD_TAPE_33_Explosions_and_War | Mixkit Sound Effects Free License; CC0 1.0 |
| s400_coast_loop (48Н6 по инерции, 0.33.0) | «Space rocket traveling in distance» (Mixkit) | https://mixkit.co/free-sound-effects/rocket/ (id 1719) | Mixkit Sound Effects Free License |
| thaad_launch_1/2 (пуск THAAD, 0.34) | «Sci fi rocket afterburner» (Mixkit) + «Small rocket launch» (Sunset SFX, CC0) + G33-25 Bazooka (GOLD TAPE) | https://mixkit.co/free-sound-effects/rocket/ (id 1724), https://archive.org/details/SSE_Library_AIRCRAFT, https://archive.org/details/GOLD_TAPE_33_Explosions_and_War | Mixkit Sound Effects Free License; CC0 1.0 |
| thaad_boost_loop (ускоритель THAAD, 0.34) | «Space Shuttle rocket ignition start» (Mixkit) | https://mixkit.co/free-sound-effects/rocket/ (id 1717) | Mixkit Sound Effects Free License |
| fp5_impact_near_1..3 (подрыв вблизи) | G33-10 Missile Explosion, G33-18 Explosion with Debris (GOLD TAPE) | https://archive.org/details/GOLD_TAPE_33_Explosions_and_War | CC0 1.0 |
| fp5_impact_far_1..3 (подрыв вдали) | G33-32 Distant Bomb Explosion (GOLD TAPE) | https://archive.org/details/GOLD_TAPE_33_Explosions_and_War | CC0 1.0 |
| fpv_motor_loop, fpv_motor_far, fpv_wash_loop (FPV, 0.34.1) | «Резкий жужжащий пролёт скоростного дрона», «Скоростной квадрокоптер проносится через лес», «Проп-вош на полной мощности» (zvukogram) | https://zvukogram.com/category/zvuki-drona/ | не проверялась (мод для своего сервера, решение владельца) |
| lancet_motor_loop, lancet_far_loop, lancet_dive_loop, lancet_blast, lancet_launch («Ланцет», 0.34.1) | «Заход кружащего ударника на цель», «Далёкое жужжание в небе на патруле», «Свистящий разгон гонки в лесу» (zvukogram) | https://zvukogram.com/category/zvuki-drona/ | не проверялась (мод для своего сервера, решение владельца) |

Mixkit Sound Effects Free License: https://mixkit.co/license/#sfxFree — бесплатно, в том числе в играх, указание
авторства не требуется (указываем из уважения). Авторы GOLD TAPE (Internet Archive) не указаны.

Прочие звуки мода — см. `src/main/resources/assets/warfront/sounds/credits.txt` и `tools/sound_sources/SOURCES.md`.
