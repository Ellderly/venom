// Параметры юнитов. Значения — по открытым источникам; баланс правится здесь, без изменения кода.
// Меню, арсенал, быстрая панель и карточки строятся из этого файла: новый юнит = новая запись в UNITS.
export type Side = 'attack' | 'defense';
export const SIDE_NAME: Record<Side, string> = { attack: 'Атака', defense: 'Оборона' };

export interface Category { id: string; side: Side; name: string; hint: string }
export const CATEGORIES: Category[] = [
  { id: 'drone', side: 'attack', name: 'Дроны', hint: 'Барражирующие боеприпасы' },
  { id: 'cruise', side: 'attack', name: 'Крылатые ракеты', hint: 'Низколетящие' },
  { id: 'ballistic', side: 'attack', name: 'Баллистика', hint: 'Быстрые, с большой высоты' },
  { id: 'special', side: 'attack', name: 'Особые', hint: 'Ложные цели, ядерные заряды' },
  { id: 'short', side: 'defense', name: 'Ближняя', hint: 'Огневые группы, зенитки' },
  { id: 'medium', side: 'defense', name: 'Средняя', hint: 'IRIS-T, NASAMS' },
  { id: 'long', side: 'defense', name: 'Дальняя', hint: 'Patriot, С-300' },
  { id: 'radar', side: 'defense', name: 'Радары', hint: 'Обнаружение целей' },
  { id: 'ew', side: 'defense', name: 'РЭБ', hint: 'Подавление наведения' },
];

export interface UnitDef {
  id: string; name: string; alt: string; kind: string; origin: string;
  side: Side; cat: string;
  cost: number;         // цена в очках (экономика — этап «Игра»; в песочнице не списывается)
  reload: number;       // перезарядка, с
  icon: string;         // содержимое <svg viewBox="0 0 64 40">
  speed: number;        // крейсерская скорость, м/с
  cruiseAgl: number;    // типовая высота полёта над землёй, м
  diveDeg: number;      // угол пикирования на цель
  warheadKg: number;    // масса боевой части
  tntKg: number;        // тротиловый эквивалент, используется для эффекта и урона
  engine: 'piston' | 'jet'; // тип двигателя: запасной синтез звука, свечение сопла
  sounds: { engineNear?: string; engineFar?: string; blastNear?: string; blastFar?: string; debris?: string }; // слоты из sounds/manifest.json
  card: [string, string][];
  about: string;
}

export const UNITS: Record<string, UnitDef> = {
  geran2: {
    id: 'geran2', name: 'Герань-2', alt: 'Shahed-136', kind: 'Барражирующий боеприпас (дрон-камикадзе)', origin: 'Иран / Россия',
    side: 'attack', cat: 'drone', cost: 20, reload: 2,
    icon: '<path d="M32 2 L35 9 L58 30 L58 35 L38 37 L26 37 L6 35 L6 30 L29 9 Z" fill="currentColor"/><rect x="29.5" y="36" width="5" height="3" fill="#8a6a44"/>',
    speed: 185 / 3.6, cruiseAgl: 300, diveDeg: 55, warheadKg: 50, tntKg: 60, engine: 'piston',
    sounds: { engineNear: 'geran_near', engineFar: 'geran_far', blastNear: 'explosion_near', blastFar: 'explosion_far', debris: 'debris' },
    card: [
      ['Длина', '3,5 м'], ['Размах крыла', '2,5 м'], ['Взлётная масса', '≈ 200 кг'],
      ['Боевая часть', '≈ 50 кг, осколочно-фугасная (у поздних версий до 90 кг)'],
      ['Двигатель', 'поршневой MD-550, ≈ 50 л. с., толкающий винт'],
      ['Крейсерская скорость', '≈ 185 км/ч'], ['Дальность', 'заявляется до 1000–2500 км'],
      ['Высота полёта', 'от 60 м до ≈ 4000 м'], ['Наведение', 'инерциальное + спутниковое, по заранее заданным координатам'],
      ['Схема', '«бесхвостка» с треугольным крылом и килями на законцовках'],
    ],
    about: 'Медленная, дешёвая и шумная цель: характерный звук двухтактного мотора слышен задолго до подлёта. Летит по заданным координатам, в конце маршрута пикирует на цель. Применяется роями, чтобы перегрузить оборону.',
  },
  geran5: {
    id: 'geran5', name: 'Герань-5', alt: 'реактивная', kind: 'Реактивный ударный дрон (по классу близок к малой крылатой ракете)', origin: 'Россия',
    side: 'attack', cat: 'drone', cost: 90, reload: 8,
    icon: '<path d="M32 1 C34 4 35 9 35 14 L35 16 L62 21 L62 25 L35 24 L34.5 32 L42 34 L42 37 L22 37 L22 34 L29.5 32 L29 24 L2 25 L2 21 L29 16 L29 14 C29 9 30 4 32 1 Z" fill="currentColor"/><rect x="30" y="26" width="4" height="12" rx="2" fill="#8a6a44"/>',
    speed: 500 / 3.6, cruiseAgl: 450, diveDeg: 40, warheadKg: 90, tntKg: 110, engine: 'jet',
    sounds: { engineNear: 'geran5_near', engineFar: 'geran5_far', blastNear: 'explosion_near', blastFar: 'explosion_far', debris: 'debris' },
    card: [
      ['Длина', '≈ 6 м'], ['Размах крыла', '≈ 5,5 м'],
      ['Боевая часть', '≈ 90 кг, осколочно-фугасная'],
      ['Двигатель', 'турбореактивный, тяга ≈ 200 кгс'],
      ['Крейсерская скорость', '≈ 450–600 км/ч (оценки расходятся)'], ['Дальность', '≈ 950–1000 км (по другим оценкам — от 600 км)'],
      ['Высота полёта', 'до ≈ 6000 м'], ['Наведение', 'инерциальное + спутниковое, по заранее заданным координатам'],
      ['Схема', 'обычная самолётная: прямое крыло, хвостовое оперение, двигатель в гондоле над хвостом'],
      ['Впервые применена', 'январь 2026 года'],
    ],
    about: 'Втрое быстрее «Герани-2» и почти вдвое тяжелее по боевой части: на реакцию остаётся намного меньше времени, а вместо треска мотора — свист и гул турбины. Ночью заметна по свечению сопла. Дороже и запускается реже.',
  },
};

export const unitsOf = (side: Side, cat?: string) => Object.values(UNITS).filter(u => u.side === side && (!cat || u.cat === cat));
