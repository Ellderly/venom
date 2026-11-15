// Фоновый поток: рисует текстуры тайлов земли, чтобы основной поток не подвисал, пока камера движется.
import { Painter, PaintMap, Ctx } from './groundpaint';

let painter: Painter | null = null;
self.onmessage = e => {
  const m = e.data;
  if (m.type === 'init') { painter = new Painter(m.map as PaintMap); return; }
  if (!painter) return;
  const cv = new OffscreenCanvas(m.res, m.res), g = cv.getContext('2d') as Ctx;
  painter.paintTile(g, m.x0, m.z0, m.size, m.res, m.A, m.L, m.B);
  const bitmap = cv.transferToImageBitmap();
  (self as unknown as Worker).postMessage({ key: m.key, bitmap }, [bitmap]);
};
