#!/usr/bin/env python3
"""OSM + SRTM -> компактные бинарные данные карты для игры.

usage: build_map.py <osm.pbf> <srtm.hgt> <out_dir>
Локальные координаты: метры, x -> восток, z -> юг, начало — Майдан Незалежности.
"""
import sys, json, math, struct
import numpy as np
import osmium

LON0, LAT0 = 30.5234, 50.4501
MX = 111320.0 * math.cos(math.radians(LAT0))
MZ = 110574.0
# границы мира в км (кратно 1 км), подобраны под выгрузку; расширяются здесь
X0, X1, Z0, Z1 = -17000, 24000, -19000, 17000
CELL = 62.5  # шаг сетки высот, 16 ячеек на км

BTYPE = {  # тип здания -> (код, высота по умолчанию, м)
    'house': (1, 6), 'detached': (1, 6), 'semidetached_house': (1, 6), 'terrace': (1, 6),
    'bungalow': (1, 4), 'cabin': (1, 4), 'hut': (1, 3), 'allotment_house': (1, 4), 'farm': (1, 6),
    'apartments': (2, 27), 'residential': (2, 15), 'dormitory': (2, 15), 'hotel': (2, 21),
    'industrial': (3, 10), 'warehouse': (3, 9), 'hangar': (3, 9), 'factory': (3, 12),
    'garage': (4, 3), 'garages': (4, 3), 'shed': (4, 3), 'service': (4, 4), 'kiosk': (4, 3),
    'roof': (4, 4), 'carport': (4, 3), 'greenhouse': (4, 3),
    'retail': (5, 8), 'commercial': (5, 14), 'office': (5, 24), 'supermarket': (5, 8),
    'school': (6, 11), 'kindergarten': (6, 7), 'university': (6, 16), 'hospital': (6, 16),
    'college': (6, 14), 'public': (6, 12), 'civic': (6, 12), 'government': (6, 18),
    'church': (7, 22), 'cathedral': (7, 35), 'chapel': (7, 10), 'monastery': (7, 18),
}
AREA = {'water': 0, 'forest': 1, 'park': 2, 'residential': 3, 'industrial': 4, 'farmland': 5, 'sand': 6, 'railway': 7}
ROAD = {'motorway': 0, 'trunk': 0, 'motorway_link': 1, 'trunk_link': 1, 'primary': 1, 'primary_link': 2,
        'secondary': 2, 'secondary_link': 3, 'tertiary': 3, 'tertiary_link': 4, 'residential': 4,
        'unclassified': 4, 'living_street': 4, 'service': 5, 'pedestrian': 5}


def num(s):
    try:
        return float(str(s).replace(',', '.').split()[0].rstrip('m'))
    except Exception:
        return None


def xz(lon, lat):
    return (lon - LON0) * MX, -(lat - LAT0) * MZ


def ring_pts(ring):
    out = []
    for n in ring:
        if n.location.valid():
            out.append(xz(n.location.lon, n.location.lat))
    if len(out) > 1 and out[0] == out[-1]:
        out.pop()
    return out


def poly_area(p):
    a = 0.0
    for i in range(len(p)):
        x1, z1 = p[i]; x2, z2 = p[(i + 1) % len(p)]
        a += x1 * z2 - x2 * z1
    return a / 2


def simplify(p, tol):
    """Douglas-Peucker для ломаной."""
    if len(p) < 3:
        return p
    keep = [False] * len(p); keep[0] = keep[-1] = True
    st = [(0, len(p) - 1)]
    while st:
        a, b = st.pop()
        ax, az = p[a]; bx, bz = p[b]; dx, dz = bx - ax, bz - az; L = math.hypot(dx, dz) or 1e-9
        md, mi = 0, -1
        for i in range(a + 1, b):
            d = abs((p[i][0] - ax) * dz - (p[i][1] - az) * dx) / L
            if d > md: md, mi = d, i
        if md > tol:
            keep[mi] = True; st.append((a, mi)); st.append((mi, b))
    return [q for q, k in zip(p, keep) if k]


def simplify_ring(p, tol):
    if len(p) < 5:
        return p
    far = max(range(len(p)), key=lambda i: (p[i][0] - p[0][0]) ** 2 + (p[i][1] - p[0][1]) ** 2)
    return simplify(p[:far + 1], tol)[:-1] + simplify(p[far:] + [p[0]], tol)[:-1]


class H(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.b = []      # (type, height, pts)
        self.areas = []  # (cls, [rings])
        self.lines = []  # (cls, pts)

    def way(self, w):
        t = w.tags
        cls = None
        if 'highway' in t:
            cls = ROAD.get(t['highway'])
            if cls is not None and t.get('tunnel') == 'yes': cls = None
        elif t.get('railway') in ('rail', 'light_rail') and t.get('tunnel') != 'yes' and 'service' not in t:
            cls = 8
        elif t.get('waterway') in ('river', 'canal'):
            cls = 9
        elif t.get('waterway') in ('stream', 'drain', 'ditch'):
            cls = 10
        if cls is None: return
        pts = [xz(n.lon, n.lat) for n in w.nodes if n.location.valid()]
        if len(pts) < 2: return
        pts = simplify(pts, 0.4)
        if t.get('bridge') and t.get('bridge') != 'no': cls |= 0x40
        self.lines.append((cls, pts))

    def area(self, a):
        t = a.tags
        if 'building' in t and t['building'] != 'no':
            bt, dh = BTYPE.get(t['building'], (0, None))
            for outer in a.outer_rings():
                p = ring_pts(outer)
                if len(p) < 3: continue
                ar = abs(poly_area(p))
                if ar < 12: continue
                if poly_area(p) < 0: p.reverse()
                h = num(t.get('height')) if 'height' in t else None
                if h is None and 'building:levels' in t:
                    lv = num(t['building:levels'])
                    if lv: h = lv * 3.0 + 1.0
                if h is None:
                    if dh is None:
                        dh = 5 if ar < 150 else 9 if ar < 600 else 14
                    # детерминированный разброс, чтобы застройка не была «под линейку»
                    hs = (int(abs(p[0][0]) * 7.3 + abs(p[0][1]) * 3.1) % 100) / 100.0
                    if bt == 2 and ar > 350:
                        h = (15, 27, 27, 27, 36, 48)[int(hs * 5.99)] + 1
                    else:
                        h = dh * (0.85 + 0.3 * hs)
                h = max(2.5, min(h, 400))
                self.b.append((bt, h, p))
            return
        cls = None
        nat, lu, le, ww = t.get('natural'), t.get('landuse'), t.get('leisure'), t.get('waterway')
        if nat == 'water' or ww == 'riverbank' or lu in ('reservoir', 'basin'): cls = 'water'
        elif lu == 'forest' or nat == 'wood': cls = 'forest'
        elif le in ('park', 'garden', 'golf_course', 'nature_reserve') or lu in ('grass', 'meadow', 'cemetery', 'recreation_ground', 'village_green', 'allotments') or nat in ('scrub', 'grassland', 'wetland', 'heath'): cls = 'park'
        elif lu == 'residential': cls = 'residential'
        elif lu in ('industrial', 'commercial', 'retail', 'construction', 'garages', 'military'): cls = 'industrial'
        elif lu in ('farmland', 'farmyard', 'orchard'): cls = 'farmland'
        elif nat in ('sand', 'beach'): cls = 'sand'
        elif lu == 'railway': cls = 'railway'
        if cls is None: return
        rings = []
        for outer in a.outer_rings():
            p = ring_pts(outer)
            if len(p) < 3 or abs(poly_area(p)) < 150: continue
            rings.append(simplify_ring(p, 1.0))
            for inner in a.inner_rings(outer):
                q = ring_pts(inner)
                if len(q) >= 3 and abs(poly_area(q)) > 100:
                    rings.append(simplify_ring(q, 1.0))
        rings = [r for r in rings if len(r) >= 3]
        if rings: self.areas.append((AREA[cls], rings))


def pad4(b):
    return b + b'\0' * (-len(b) % 4)


def main():
    pbf, hgt, out = sys.argv[1:4]
    h = H()
    h.apply_file(pbf, locations=True)
    inb = lambda p: X0 <= p[0][0] <= X1 and Z0 <= p[0][1] <= Z1
    B = [b for b in h.b if inb(b[2])]
    print('buildings', len(B), 'areas', len(h.areas), 'lines', len(h.lines))

    # buildings.bin: u32 nB, u32 nPts | f32 pts | u32 start[nB+1] | u16 h_dm[nB] | u8 type[nB]
    pts = np.array([q for b in B for q in b[2]], dtype='<f4')
    start = np.cumsum([0] + [len(b[2]) for b in B]).astype('<u4')
    hd = np.array([round(b[1] * 10) for b in B], dtype='<u2')
    ty = np.array([b[0] for b in B], dtype='u1')
    with open(out + '/buildings.bin', 'wb') as f:
        f.write(struct.pack('<II', len(B), len(pts)))
        f.write(pts.tobytes()); f.write(start.tobytes()); f.write(pad4(hd.tobytes())); f.write(pad4(ty.tobytes()))

    # areas.bin: u32 nA, nRings, nPts | f32 pts | u32 ringStart[nRings+1] | u32 areaRing[nA+1] | u8 cls[nA]
    A = sorted(h.areas, key=lambda a: {3: 0, 5: 1, 4: 2, 7: 3, 6: 4, 2: 5, 1: 6, 0: 7}[a[0]])  # порядок отрисовки
    apts = np.array([q for a in A for r in a[1] for q in r], dtype='<f4')
    rstart = np.cumsum([0] + [len(r) for a in A for r in a[1]]).astype('<u4')
    astart = np.cumsum([0] + [len(a[1]) for a in A]).astype('<u4')
    acls = np.array([a[0] for a in A], dtype='u1')
    with open(out + '/areas.bin', 'wb') as f:
        f.write(struct.pack('<III', len(A), len(rstart) - 1, len(apts)))
        f.write(apts.tobytes()); f.write(rstart.tobytes()); f.write(astart.tobytes()); f.write(pad4(acls.tobytes()))

    # lines.bin: u32 nL, nPts | f32 pts | u32 start[nL+1] | u8 cls[nL]
    L = sorted(h.lines, key=lambda l: -(l[0] & 0x3f) if (l[0] & 0x3f) < 8 else -100)
    lpts = np.array([q for l in L for q in l[1]], dtype='<f4')
    lstart = np.cumsum([0] + [len(l[1]) for l in L]).astype('<u4')
    lcls = np.array([l[0] for l in L], dtype='u1')
    with open(out + '/lines.bin', 'wb') as f:
        f.write(struct.pack('<II', len(L), len(lpts)))
        f.write(lpts.tobytes()); f.write(lstart.tobytes()); f.write(pad4(lcls.tobytes()))

    # рельеф: SRTM 1" -> локальная сетка, сглаживание (SRTM включает крыши и кроны)
    srtm = np.fromfile(hgt, dtype='>i2').reshape(3601, 3601).astype('f4')
    srtm[srtm < -100] = 90
    nx = int((X1 - X0) / CELL) + 1; nz = int((Z1 - Z0) / CELL) + 1
    gx = X0 + np.arange(nx) * CELL; gz = Z0 + np.arange(nz) * CELL
    lon = LON0 + gx / MX; lat = LAT0 - gz / MZ
    col = (lon - 30.0) * 3600; row = (51.0 - lat) * 3600
    c0 = np.clip(np.floor(col).astype(int), 0, 3599); r0 = np.clip(np.floor(row).astype(int), 0, 3599)
    fc = (col - c0)[None, :]; fr = (row - r0)[:, None]
    g = (srtm[np.ix_(r0, c0)] * (1 - fr) * (1 - fc) + srtm[np.ix_(r0, c0 + 1)] * (1 - fr) * fc +
         srtm[np.ix_(r0 + 1, c0)] * fr * (1 - fc) + srtm[np.ix_(r0 + 1, c0 + 1)] * fr * fc)
    k = np.array([1, 4, 6, 4, 1], dtype='f4'); k /= k.sum()
    for _ in range(2):
        g = np.apply_along_axis(lambda v: np.convolve(np.pad(v, 2, mode='edge'), k, mode='valid'), 0, g)
        g = np.apply_along_axis(lambda v: np.convolve(np.pad(v, 2, mode='edge'), k, mode='valid'), 1, g)
    with open(out + '/height.bin', 'wb') as f:
        f.write(struct.pack('<II', nx, nz))
        f.write(np.clip(np.round(g * 10), 0, 65535).astype('<u2').tobytes())

    json.dump({'x0': X0, 'x1': X1, 'z0': Z0, 'z1': Z1, 'cell': CELL, 'lon0': LON0, 'lat0': LAT0,
               'buildings': len(B), 'hmin': float(g.min()), 'hmax': float(g.max()),
               'attribution': '© OpenStreetMap contributors (ODbL); SRTM (NASA/USGS)'},
              open(out + '/meta.json', 'w'))
    print('height', nx, nz, g.min(), g.max())


main()
