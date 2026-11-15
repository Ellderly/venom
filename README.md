# VENOM — Оборона Киева

3D-игра: реальный Киев по данным OpenStreetMap, запуск воздушных целей и разрушения. План и этапы — в [PLAN.md](PLAN.md).

## Запуск

Нужен [Node.js 22+](https://nodejs.org).

```
npm install
npm run build
npm run server
```

Откройте `http://localhost:8080`, введите ник и выберите мир в «Играть». Друзья в одной сети (или в общей VPN-сети) открывают `http://АДРЕС_ХОСТА:8080`, нажимают «Подключиться» и после входа выбирают сторону — атаку или оборону. Адрес для друзей сервер печатает при запуске и показывает в списке миров.

Миры сервер хранит в папке `venom-worlds/` (программа под Windows — в `%APPDATA%\VENOM\worlds`).

Для разработки: `npm run dev`.

Программа под Windows (.exe) собирается автоматически на GitHub: вкладка Actions → последний запуск `build` → артефакт `VENOM-windows`.

## Звуки

Записи кладутся в `public/sounds/` и перечисляются в `manifest.json`; чего там нет, игра синтезирует. Импорт из репозитория warfront:

```
python3 tools/import_sounds.py ПУТЬ_К_warfront
```

## Пересборка карты

```
pip install osmium numpy
python3 tools/build_map.py Kiew.osm.pbf N50E030.hgt public/data
```

Исходные данные: выгрузка OSM (download.bbbike.org/osm/bbbike/Kiew) и рельеф SRTM (тайл N50E030). Границы карты задаются константами в начале `tools/build_map.py`.

## Данные

© Участники OpenStreetMap (ODbL). Рельеф: SRTM (NASA/USGS).
