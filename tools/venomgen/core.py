"""Shared helpers for the procedural asset pipeline: noise, model geometry, UV packing, texel mapping.

Everything the mod renders is generated from code so that the model geometry, the textures painted
on it, the PBR maps and the transformation "spread" masks always stay in sync.
"""
import math
import numpy as np

# --------------------------------------------------------------------------------------------
# Noise
# --------------------------------------------------------------------------------------------

def _hash3(ix, iy, iz, seed):
    h = (ix.astype(np.int64) * 374761393 + iy.astype(np.int64) * 668265263
         + iz.astype(np.int64) * 1274126177 + seed * 974711) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1103515245) & 0xFFFFFFFF
    h = (h ^ (h >> 16)) & 0xFFFFFFFF
    return h.astype(np.float64) / 4294967296.0


def vnoise(p, seed=0):
    """3D value noise in [0,1]. p: (...,3) array."""
    p = np.asarray(p, dtype=np.float64)
    i = np.floor(p).astype(np.int64)
    f = p - i
    f = f * f * f * (f * (f * 6 - 15) + 10)
    out = 0
    for dx in (0, 1):
        wx = f[..., 0] if dx else 1 - f[..., 0]
        for dy in (0, 1):
            wy = f[..., 1] if dy else 1 - f[..., 1]
            for dz in (0, 1):
                wz = f[..., 2] if dz else 1 - f[..., 2]
                out = out + wx * wy * wz * _hash3(i[..., 0] + dx, i[..., 1] + dy, i[..., 2] + dz, seed)
    return out


def fbm(p, octaves=4, seed=0, lac=2.0, gain=0.5):
    p = np.asarray(p, dtype=np.float64)
    amp, tot, out = 1.0, 0.0, 0
    for o in range(octaves):
        out = out + amp * vnoise(p, seed + o * 17)
        tot += amp
        amp *= gain
        p = p * lac
    return out / tot


def ridged(p, octaves=3, seed=0, lac=2.0, gain=0.55):
    """Ridged multifractal in [0,1]; 1 on thin ridges (veins / fibres)."""
    p = np.asarray(p, dtype=np.float64)
    amp, tot, out = 1.0, 0.0, 0
    for o in range(octaves):
        n = 1.0 - np.abs(2.0 * vnoise(p, seed + o * 31) - 1.0)
        out = out + amp * n * n
        tot += amp
        amp *= gain
        p = p * lac
    return out / tot


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a + 1e-12), 0, 1)
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


# --------------------------------------------------------------------------------------------
# Model description
# --------------------------------------------------------------------------------------------

class Cube:
    def __init__(self, origin, size, mat='skin', inflate=(0, 0, 0), mirror=False, faces=None, uvkey=None):
        self.origin = tuple(float(v) for v in origin)
        self.size = tuple(float(v) for v in size)
        if isinstance(inflate, (int, float)):
            inflate = (inflate, inflate, inflate)
        self.inflate = tuple(float(v) for v in inflate)
        self.mirror = mirror
        self.mat = mat
        self.faces = faces or {}   # face name -> material override
        self.uvkey = uvkey         # cubes with the same key share one UV island
        self.uv = None


class Part:
    def __init__(self, name, parent=None, pivot=(0, 0, 0), rot=(0, 0, 0)):
        self.name = name
        self.parent = parent
        self.pivot = tuple(float(v) for v in pivot)
        self.rot = tuple(float(v) for v in rot)
        self.cubes = []

    def box(self, origin, size, **kw):
        c = Cube(origin, size, **kw)
        self.cubes.append(c)
        return c


class Model:
    def __init__(self, tex_w, tex_h, px=4):
        self.tex_w, self.tex_h, self.px = tex_w, tex_h, px
        self.parts = {}
        self.order = []

    def part(self, name, parent=None, pivot=(0, 0, 0), rot=(0, 0, 0)):
        p = Part(name, parent, pivot, rot)
        self.parts[name] = p
        self.order.append(name)
        return p

    # ---- UV packing (simple shelf packer over the logical texture) ----
    def pack(self):
        items = {}
        for name in self.order:
            for c in self.parts[name].cubes:
                if c.uv is not None:
                    continue
                w = int(math.ceil(2 * (c.size[0] + c.size[2])))
                h = int(math.ceil(c.size[1] + c.size[2]))
                key = c.uvkey or id(c)
                if key in items:
                    assert items[key][0] == (w, h), 'uvkey %s size mismatch' % key
                    items[key][1].append(c)
                else:
                    items[key] = [(w, h), [c]]
        entries = sorted(items.values(), key=lambda e: (-e[0][1], -e[0][0]))
        x = y = shelf = 0
        for (w, h), cubes in entries:
            if x + w > self.tex_w:
                x = 0
                y += shelf + 1
                shelf = 0
            if y + h > self.tex_h:
                raise RuntimeError('texture too small for model')
            for c in cubes:
                c.uv = (x, y)
            x += w + 1
            shelf = max(shelf, h)
        return y + shelf

    def to_json(self):
        out = {'texture': [self.tex_w, self.tex_h], 'parts': []}
        for name in self.order:
            p = self.parts[name]
            out['parts'].append({
                'name': p.name, 'parent': p.parent, 'pivot': list(p.pivot), 'rot': list(p.rot),
                'cubes': [{'o': list(c.origin), 's': list(c.size), 'uv': list(c.uv), 'inf': list(c.inflate),
                           'mirror': bool(c.mirror)} for c in p.cubes]})
        return out

    # ---- transforms ----
    def part_matrix(self, name, pose=None):
        """4x4 bind (or posed) matrix of a part, in model pixel units."""
        p = self.parts[name]
        rot = p.rot
        piv = p.pivot
        scale = (1, 1, 1)
        if pose and name in pose:
            ov = pose[name]
            rot = ov.get('rot', rot)
            piv = ov.get('pivot', piv)
            scale = ov.get('scale', scale)
        rx, ry, rz = rot
        cx, sx = math.cos(rx), math.sin(rx)
        cy, sy = math.cos(ry), math.sin(ry)
        cz, sz = math.cos(rz), math.sin(rz)
        Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
        Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
        Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
        m = np.eye(4)
        m[:3, :3] = (Rz @ Ry @ Rx) @ np.diag(scale)
        m[:3, 3] = piv
        if p.parent:
            m = self.part_matrix(p.parent, pose) @ m
        return m

    # ---- texel enumeration ----
    def texels(self):
        """Enumerate every texel of every cube face.

        Returns dict of arrays: px,py (pixel coords), local (N,3) position in part space, nrm (N,3) local normal,
        fu,fv (0..1 coordinates inside the face), part index, material index, face id, plus lists.
        """
        S = self.px
        mats, mat_index = [], {}
        rows = []
        face_id = 0
        part_names = list(self.order)
        for pi, name in enumerate(part_names):
            for c in self.parts[name].cubes:
                ox, oy, oz = c.origin
                w, h, d = c.size
                gx, gy, gz = c.inflate
                x0, x1 = ox - gx, ox + w + gx
                y0, y1 = oy - gy, oy + h + gy
                z0, z1 = oz - gz, oz + d + gz
                if c.mirror:
                    x0, x1 = x1, x0
                u, v = c.uv
                f4, f5, f6, f7 = u, u + d, u + d + w, u + d + w + w
                f8, f9 = u + d + w + d, u + d + w + d + w
                f10, f11, f12 = v, v + d, v + d + h
                sgn = -1.0 if c.mirror else 1.0
                # name: (u_start, u_end, v_start, v_end, fn(a,b)->(x,y,z), normal)
                faces = {
                    'top':    (f5, f6, f10, f11, lambda a, b: (lerp(x0, x1, a), y0 + 0 * a, lerp(z1, z0, b)), (0, -1, 0)),
                    'bottom': (f6, f7, f10, f11, lambda a, b: (lerp(x0, x1, a), y1 + 0 * a, lerp(z1, z0, b)), (0, 1, 0)),
                    'west':   (f4, f5, f11, f12, lambda a, b: (x0 + 0 * a, lerp(y0, y1, b), lerp(z1, z0, a)), (-sgn, 0, 0)),
                    'north':  (f5, f6, f11, f12, lambda a, b: (lerp(x0, x1, a), lerp(y0, y1, b), z0 + 0 * a), (0, 0, -1)),
                    'east':   (f6, f8, f11, f12, lambda a, b: (x1 + 0 * a, lerp(y0, y1, b), lerp(z0, z1, a)), (sgn, 0, 0)),
                    'south':  (f8, f9, f11, f12, lambda a, b: (lerp(x1, x0, a), lerp(y0, y1, b), z1 + 0 * a), (0, 0, 1)),
                }
                for fname, (ua, ub, va, vb, fn, nrm) in faces.items():
                    pu0, pu1 = int(round(ua * S)), int(round(ub * S))
                    pv0, pv1 = int(round(va * S)), int(round(vb * S))
                    if pu1 <= pu0 or pv1 <= pv0:
                        continue
                    us = np.arange(pu0, pu1)
                    vs = np.arange(pv0, pv1)
                    uu, vv = np.meshgrid(us, vs)
                    a = (uu - pu0 + 0.5) / (pu1 - pu0)
                    b = (vv - pv0 + 0.5) / (pv1 - pv0)
                    X, Y, Z = fn(a, b)
                    mat = c.faces.get(fname, c.mat)
                    if mat not in mat_index:
                        mat_index[mat] = len(mats)
                        mats.append(mat)
                    n = uu.size
                    rows.append((uu.ravel(), vv.ravel(),
                                 np.stack([X.ravel(), Y.ravel(), Z.ravel()], 1),
                                 np.tile(np.array(nrm, dtype=np.float64), (n, 1)),
                                 a.ravel(), b.ravel(),
                                 np.full(n, pi), np.full(n, mat_index[mat]), np.full(n, face_id),
                                 np.full(n, (pu1 - pu0) / S), np.full(n, (pv1 - pv0) / S)))
                    face_id += 1
        cat = lambda i: np.concatenate([r[i] for r in rows])
        return {
            'px': cat(0), 'py': cat(1), 'local': cat(2), 'nrm': cat(3), 'fu': cat(4), 'fv': cat(5),
            'part': cat(6), 'mat': cat(7), 'face': cat(8), 'fw': cat(9), 'fh': cat(10),
            'mats': mats, 'parts': part_names,
        }

    def world(self, tx, pose=None):
        """World-space (model px) positions and normals of texels for a pose."""
        pos = np.zeros_like(tx['local'])
        nrm = np.zeros_like(tx['nrm'])
        for pi, name in enumerate(tx['parts']):
            sel = tx['part'] == pi
            if not sel.any():
                continue
            m = self.part_matrix(name, pose)
            pos[sel] = tx['local'][sel] @ m[:3, :3].T + m[:3, 3]
            n = tx['nrm'][sel] @ m[:3, :3].T
            nrm[sel] = n / (np.linalg.norm(n, axis=1, keepdims=True) + 1e-9)
        return pos, nrm


# --------------------------------------------------------------------------------------------
# Image helpers
# --------------------------------------------------------------------------------------------

def blank(model):
    return np.zeros((model.tex_h * model.px, model.tex_w * model.px, 4), dtype=np.float64)


def put(img, tx, rgba, sel=None):
    if sel is None:
        img[tx['py'], tx['px']] = rgba
    else:
        img[tx['py'][sel], tx['px'][sel]] = rgba


def to_u8(img):
    return np.clip(np.round(img), 0, 255).astype(np.uint8)


def normal_from_height(tx, height, shape, strength=2.0):
    """Tangent-space normal map from a per-texel height value. Gradients never cross face borders."""
    H = np.zeros(shape[:2])
    F = np.full(shape[:2], -1, dtype=np.int64)
    H[tx['py'], tx['px']] = height
    F[tx['py'], tx['px']] = tx['face']

    def diff(axis):
        fwd = np.roll(H, -1, axis) - H
        bwd = H - np.roll(H, 1, axis)
        okf = np.roll(F, -1, axis) == F
        okb = np.roll(F, 1, axis) == F
        g = np.where(okf & okb, (fwd + bwd) * 0.5, np.where(okf, fwd, np.where(okb, bwd, 0.0)))
        return g

    dx, dy = diff(1) * strength, diff(0) * strength
    nz = np.ones_like(dx)
    ln = np.sqrt(dx * dx + dy * dy + nz * nz)
    nx, ny, nz = -dx / ln, -dy / ln, nz / ln
    out = np.zeros(shape[:2] + (4,))
    out[..., 0] = (nx * 0.5 + 0.5) * 255
    out[..., 1] = (ny * 0.5 + 0.5) * 255
    out[..., 2] = 255          # labPBR: blue = ambient occlusion
    out[..., 3] = 255          # labPBR: alpha = height (255 = no displacement)
    out[F < 0] = (127.5, 127.5, 255, 255)
    return out


def preview(tx, pos, nrm, rgba, yaw=0.5, pitch=0.15, scale=10, size=(520, 640), center=(0, 6, 0), bg=(60, 66, 80)):
    """Tiny software 'renderer': splats every texel as a lit point. Good enough to judge shape + paint."""
    cy, sy = math.cos(yaw), math.sin(yaw)
    cp, sp = math.cos(pitch), math.sin(pitch)
    p = pos - np.array(center)
    x = p[:, 0] * cy + p[:, 2] * sy
    z = -p[:, 0] * sy + p[:, 2] * cy
    y = p[:, 1] * cp - z * sp
    z = p[:, 1] * sp + z * cp
    n = nrm
    nxr = n[:, 0] * cy + n[:, 2] * sy
    nzr = -n[:, 0] * sy + n[:, 2] * cy
    nyr = n[:, 1] * cp - nzr * sp
    nzr = n[:, 1] * sp + nzr * cp
    vis = (rgba[:, 3] > 127) & (nzr < 0.05)
    L = np.array([-0.45, -0.7, -0.55])
    L = L / np.linalg.norm(L)
    lam = np.clip(nxr * L[0] + nyr * L[1] + nzr * L[2], 0, 1)
    shade = 0.45 + 0.75 * lam
    W, Hh = size
    img = np.zeros((Hh, W, 3)) + np.array(bg)
    sx = (x * scale + W / 2)
    syy = (y * scale + Hh / 2)
    r = max(1, int(math.ceil(scale / 4 / 2 + 0.5)))
    idx = np.where(vis)[0]
    offs = [(dx, dy) for dx in range(-r, r + 1) for dy in range(-r, r + 1)]
    PX = np.concatenate([np.clip((sx[idx] + dx).astype(int), 0, W - 1) for dx, dy in offs])
    PY = np.concatenate([np.clip((syy[idx] + dy).astype(int), 0, Hh - 1) for dx, dy in offs])
    ZZ = np.tile(z[idx], len(offs))
    CC = np.tile(np.clip(rgba[idx, :3] * shade[idx, None], 0, 255), (len(offs), 1))
    order = np.argsort(-ZZ, kind='stable')   # painter's order: far first, near last overwrites
    img[PY[order], PX[order]] = CC[order]
    return to_u8(img)
