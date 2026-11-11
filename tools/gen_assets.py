#!/usr/bin/env python3
"""Generates every model + texture of the mod procedurally.

    python3 tools/gen_assets.py [--preview DIR]

Outputs go straight into src/main/resources/assets/venom. Re-running is deterministic.
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from venomgen.core import (fbm, ridged, vnoise, smoothstep, lerp, blank, put, to_u8, normal_from_height, preview)
from venomgen.models import venom_model, player_model, symbiote_model

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'main', 'resources', 'assets', 'venom')
TEX = os.path.join(ROOT, 'textures')
FRAMES = 12  # transformation dissolve steps (frame 0 = nothing, frame FRAMES = full texture)


def save(img, *path):
    p = os.path.join(TEX, *path)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    Image.fromarray(to_u8(img), 'RGBA').save(p, optimize=True)


# --------------------------------------------------------------------------------------------
# Material shaders. Every one works on 3D positions so paint is seamless across cube faces.
# --------------------------------------------------------------------------------------------

def skin(pos, nrm, fu, fv, seed, fiber=0.55, flow=(1.0, 0.33, 1.0)):
    """Wet, sinewy symbiote hide. Returns rgb (N,3), height (N), smoothness (N)."""
    warp = fbm(pos * 0.11, 3, seed + 5)
    q = pos * np.array(flow) * fiber + (warp[:, None] - 0.5) * 3.2
    veins = smoothstep(0.70, 0.96, ridged(q, 3, seed + 1))
    fine = vnoise(pos * np.array([3.0, 0.28, 3.0]) + warp[:, None] * 2, seed + 2) - 0.5
    blot = fbm(pos * 0.16, 3, seed + 3)
    bulge = np.sqrt((1 - (2 * fu - 1) ** 4) * (1 - (2 * fv - 1) ** 4))
    col = np.array([16.0, 16.0, 22.0]) * (0.52 + 0.58 * bulge)[:, None]
    col = col + veins[:, None] * np.array([17.0, 19.0, 28.0])
    col = col + fine[:, None] * np.array([7.0, 7.5, 10.0])
    col = col + (blot[:, None] - 0.5) * np.array([7.0, 7.0, 10.0])
    # latex-like specular streak running down every side face + soft sheen on upward faces
    sidef = np.abs(nrm[:, 1]) < 0.5
    patch = 0.35 + 0.65 * smoothstep(0.35, 0.7, fbm(pos * 0.3, 2, seed + 8))
    band = np.exp(-(((fu - 0.30 + (warp - 0.5) * 0.3) / 0.085) ** 2)) * patch * sidef * smoothstep(0.0, 0.15, fv) * smoothstep(1.0, 0.85, fv)
    col = col + band[:, None] * np.array([40.0, 45.0, 62.0])
    sheen = (nrm[:, 1] < -0.5) * bulge
    col = col + sheen[:, None] * np.array([15.0, 17.0, 24.0])
    g = fbm(pos * 0.5 + nrm * 2.3, 3, seed + 9)
    glint = smoothstep(0.70, 0.84, g) * bulge
    col = col + glint[:, None] * np.array([34.0, 38.0, 52.0])
    height = 0.45 * bulge + 0.4 * veins + 0.1 * (fine + 0.5)
    smooth = 0.88 + 0.07 * glint - 0.08 * veins
    return np.clip(col, 0, 255), height, smooth


def eye_mask(s, t, origin, direction, length, width, seed):
    """Jagged almond eye in unwrapped head coordinates. Returns signed 'inside' amount (>0 inside)."""
    d = np.array(direction, dtype=np.float64)
    d = d / np.linalg.norm(d)
    rs, rt = s - origin[0], t - origin[1]
    a = rs * d[0] + rt * d[1]
    b = -rs * d[1] + rt * d[0]
    x = np.clip(a / length, 0, 1)
    w = width * np.sin(np.pi * x ** 0.72) ** 0.85
    jag = 0.22 * width * np.abs(((a * 1.9 + 0.3) % 1.0) * 2 - 1) * (b < 0)  # jagged upper lid
    noise = (vnoise(np.stack([s * 1.7, t * 1.7, np.zeros_like(s) + seed], 1)) - 0.5) * 0.35
    inside = w + jag + noise - np.abs(b)
    inside = np.where((a < 0) | (a > length), -1.0, inside)
    return inside


def paint_eye(col, height, smooth, inside, pos, seed):
    core = smoothstep(0.0, 0.5, inside)
    pearl = np.array([236.0, 240.0, 248.0]) - smoothstep(0.9, 0.0, inside)[:, None] * np.array([70.0, 62.0, 48.0])
    cracks = smoothstep(0.80, 0.95, ridged(pos * 1.3, 2, seed + 40)) * smoothstep(1.2, 0.1, inside)
    pearl = pearl - cracks[:, None] * np.array([120.0, 118.0, 105.0])
    rim = smoothstep(-0.45, 0.0, inside) * (1 - core)
    col = col * (1 - 0.6 * rim)[:, None]
    col = lerp(col, pearl, core[:, None])
    height = lerp(height, 0.75 + 0 * height, core)
    smooth = lerp(smooth, 0.93 + 0 * smooth, core)
    return col, height, smooth, core


def tooth_paint(fv_root_to_tip, pos, seed):
    t = fv_root_to_tip
    col = lerp(np.array([196.0, 178.0, 140.0]), np.array([250.0, 246.0, 232.0]), smoothstep(0.0, 0.75, t)[:, None])
    streak = (vnoise(pos * np.array([4.0, 0.6, 4.0]), seed) - 0.5) * 22
    col = col + streak[:, None]
    gum = smoothstep(0.22, 0.0, t)
    col = lerp(col, np.array([96.0, 20.0, 26.0]), gum[:, None] * 0.85)
    return np.clip(col, 0, 255)


def flesh(pos, seed, base, dark):
    n = fbm(pos * 0.6, 3, seed)
    wet = smoothstep(0.62, 0.8, fbm(pos * 1.6, 2, seed + 3))
    col = lerp(np.array(dark, dtype=float), np.array(base, dtype=float), n[:, None])
    col = col + wet[:, None] * np.array([70.0, 50.0, 50.0])
    return np.clip(col, 0, 255), n


# --------------------------------------------------------------------------------------------
# Shared output helpers
# --------------------------------------------------------------------------------------------

def spread_map(pos, core, seed):
    d = np.linalg.norm(pos - np.array(core), axis=1)
    s = d / d.max() + 0.30 * (fbm(pos * 0.28, 3, seed) - 0.5) + 0.16 * (ridged(pos * 0.55, 2, seed + 7) - 0.5)
    s = (s - s.min()) / (s.max() - s.min())
    return 0.03 + 0.94 * s


def write_set(model, tx, name, col, alpha, height, smooth, f0, emis, spread, eyes=None):
    """Writes albedo, labPBR normal/specular, optional emissive eye layer and the dissolve frames."""
    img = blank(model)
    put(img, tx, np.concatenate([col, alpha[:, None]], 1))
    save(img, 'entity', name + '.png')

    nimg = normal_from_height(tx, height, img.shape, strength=3.0)
    save(nimg, 'entity', name + '_n.png')

    simg = blank(model)
    spec = np.stack([smooth * 255, f0 * 255, np.zeros_like(smooth), np.where(emis > 0, emis * 254, 255)], 1)
    put(simg, tx, spec)
    simg[simg[..., 3] == 0] = (0, 0, 0, 255)
    save(simg, 'entity', name + '_s.png')

    if eyes is not None:
        eimg = blank(model)
        glow = np.concatenate([np.array([74.0, 78.0, 92.0]) * eyes[:, None], (eyes > 0.5)[:, None] * 255.0], 1)
        put(eimg, tx, glow)
        save(eimg, 'entity', name + '_eyes.png')

    if spread is not None:
        for k in range(1, FRAMES):
            thr = k / FRAMES
            band = smoothstep(thr - 0.08, thr, spread)
            c = np.clip(col * (1 - 0.35 * band[:, None]) + band[:, None] * np.array([48.0, 54.0, 76.0]), 0, 255)
            a = np.where(spread < thr, alpha, 0.0)
            f = blank(model)
            put(f, tx, np.concatenate([c, a[:, None]], 1))
            save(f, 'entity', 'transition', '%s_%02d.png' % (name, k))


# --------------------------------------------------------------------------------------------
# Venom
# --------------------------------------------------------------------------------------------

def gen_venom(preview_dir=None):
    m = venom_model()
    with open(os.path.join(ROOT, 'geo', 'venom.json'), 'w') as f:
        json.dump(m.to_json(), f, separators=(',', ':'))
    tx = m.texels()
    pos, nrm = m.world(tx)
    N = len(tx['px'])
    mats = tx['mats']
    mat = np.array([mats[i] for i in tx['mat']])
    part = np.array([tx['parts'][i] for i in tx['part']])

    col, height, smooth = skin(pos, nrm, tx['fu'], tx['fv'], seed=11)
    alpha = np.full(N, 255.0)
    f0 = np.full(N, 0.09)
    emis = np.zeros(N)
    eyes = np.zeros(N)

    # ---- eyes on the cranium ----
    head = (part == 'head') & (mat == 'skin') & (pos[:, 1] <= -3.0) & (pos[:, 1] >= -9.0)
    front = head & (nrm[:, 2] < -0.5) & (np.abs(pos[:, 2] + 4.5) < 0.05)
    side = head & (np.abs(nrm[:, 0]) > 0.5) & (np.abs(np.abs(pos[:, 0]) - 4.5) < 0.05)
    s = np.where(front, np.abs(pos[:, 0]), 4.5 + (pos[:, 2] + 4.5))
    sel = front | side
    inside = np.full(N, -1.0)
    inside[sel] = eye_mask(s[sel], pos[sel, 1], (0.85, -4.05), (0.86, -0.52), 7.9, 1.75, 3)
    c2, h2, s2, core = paint_eye(col[sel], height[sel], smooth[sel], inside[sel], pos[sel], 11)
    col[sel], height[sel], smooth[sel] = c2, h2, s2
    eyes[sel] = core
    emis[sel] = core * 0.14

    # brow shadow + nose slits
    browd = front & (pos[:, 1] > -4.2)
    col[browd] *= 0.85
    slit = front & (np.abs(np.abs(pos[:, 0]) - 0.55) < 0.22) & (pos[:, 1] > -3.9) & (pos[:, 1] < -3.15)
    col[slit] = (4, 4, 6)

    # ---- gums along the lips ----
    snout = (part == 'head') & (mat == 'skin') & (pos[:, 1] > -3.0) & (pos[:, 1] <= -1.0) & (pos[:, 2] < 0.4)
    gum = snout & (np.abs(nrm[:, 1]) < 0.5)
    g = smoothstep(-1.9, -1.05, pos[:, 1]) * gum
    gcol, _ = flesh(pos, 21, (120, 26, 34), (58, 8, 14))
    col = lerp(col, gcol, (g * 0.92)[:, None])
    jawskin = (part == 'jaw') & (mat == 'skin') & (np.abs(nrm[:, 1]) < 0.5)
    lp = m.parts['jaw'].pivot
    ly = pos[:, 1] - lp[1]
    g = smoothstep(0.75, 0.05, ly) * jawskin
    col = lerp(col, gcol, (g * 0.92)[:, None])

    # ---- mouth interior ----
    sel = mat == 'mouth'
    mc, mn = flesh(pos[sel], 31, (112, 18, 28), (36, 4, 9))
    depth = smoothstep(-5.0, 3.5, pos[sel, 2])
    col[sel] = mc * (1.0 - 0.6 * depth)[:, None]
    height[sel] = 0.3 + 0.2 * mn
    smooth[sel] = 0.9
    f0[sel] = 0.05

    # ---- teeth ----
    for name, t in (('tooth', tx['fv']), ('tooth_up', 1 - tx['fv'])):
        sel = mat == name
        horiz = np.abs(nrm[:, 1]) > 0.5     # cap faces
        tt = np.where(horiz, np.where((nrm[:, 1] > 0) == (name == 'tooth'), 1.0, 0.0), t)
        col[sel] = tooth_paint(tt[sel], pos[sel], 51)
        height[sel] = 0.6
        smooth[sel] = 0.72
        f0[sel] = 0.05

    # ---- tongue ----
    for name in ('tongue', 'tongue_tip'):
        sel = mat == name
        tc, tn = flesh(pos[sel], 41, (188, 52, 66), (120, 22, 36))
        groove = smoothstep(0.35, 0.0, np.abs(pos[sel, 0])) * (nrm[sel, 1] < -0.5)
        tc = tc * (1 - 0.45 * groove)[:, None]
        if name == 'tongue_tip':
            tc = lerp(tc, np.array([214.0, 96.0, 110.0]), 0.35)
        col[sel] = tc
        height[sel] = 0.4 + 0.3 * tn
        smooth[sel] = 0.94
        f0[sel] = 0.04

    # ---- claws ----
    sel = mat == 'claw'
    t = tx['fv'][sel]
    t = np.where(np.abs(nrm[sel, 1]) > 0.5, (nrm[sel, 1] > 0) * 1.0, t)
    col[sel] = lerp(np.array([20.0, 20.0, 26.0]), np.array([150.0, 152.0, 160.0]), (smoothstep(0.1, 1.0, t) ** 1.6)[:, None])
    smooth[sel] = 0.95
    sel = mat == 'claw_fwd'
    t = 1 - tx['fu'][sel]
    t = np.where(np.abs(nrm[sel, 2]) > 0.5, (nrm[sel, 2] < 0) * 1.0, np.where(np.abs(nrm[sel, 1]) > 0.5, 1 - tx['fv'][sel], t))
    col[sel] = lerp(np.array([20.0, 20.0, 26.0]), np.array([140.0, 142.0, 150.0]), (smoothstep(0.1, 1.0, t) ** 1.6)[:, None])
    smooth[sel] = 0.95

    spread = spread_map(pos, (0, 3, -3.5), 5)
    write_set(m, tx, 'venom', col, alpha, height, smooth, f0, emis, spread, eyes)

    if preview_dir:
        rgba = np.concatenate([col, alpha[:, None]], 1)
        Image.fromarray(preview(tx, pos, nrm, rgba, yaw=0.55, pitch=0.12, scale=14, size=(560, 700), center=(0, 7, 0))).save(
            os.path.join(preview_dir, 'venom_front.png'))
        pose = {'jaw': {'rot': (0.75, 0, 0)}, 'tongue0': {'rot': (0.25, 0.1, 0)}, 'tongue2': {'rot': (0.35, -0.3, 0)},
                'tongue3': {'rot': (-0.3, -0.4, 0)}, 'head': {'rot': (-0.1, 0, 0)}}
        p2, n2 = m.world(tx, pose)
        Image.fromarray(preview(tx, p2, n2, rgba, yaw=0.5, pitch=0.05, scale=30, size=(700, 620), center=(0, -3, -2))).save(
            os.path.join(preview_dir, 'venom_head_open.png'))
        Image.fromarray(preview(tx, pos, nrm, rgba, yaw=0.0, pitch=0.0, scale=30, size=(700, 620), center=(0, -3, -2))).save(
            os.path.join(preview_dir, 'venom_head_front.png'))
        Image.fromarray(preview(tx, pos, nrm, rgba, yaw=2.6, pitch=0.2, scale=14, size=(560, 700), center=(0, 7, 0))).save(
            os.path.join(preview_dir, 'venom_back.png'))
        a6 = np.where(spread < 0.5, 255.0, 0.0)
        Image.fromarray(preview(tx, pos, nrm, np.concatenate([col, a6[:, None]], 1), yaw=0.55, pitch=0.12, scale=14,
                                size=(560, 700), center=(0, 7, 0))).save(os.path.join(preview_dir, 'venom_half.png'))


# --------------------------------------------------------------------------------------------
# Suit + vein overlay (vanilla player layout)
# --------------------------------------------------------------------------------------------

def gen_suit(preview_dir=None):
    m = player_model()
    tx = m.texels()
    pos, nrm = m.world(tx)
    N = len(tx['px'])
    part = np.array([tx['parts'][i] for i in tx['part']])

    col, height, smooth = skin(pos, nrm, tx['fu'], tx['fv'], seed=23, fiber=0.75)
    col = col * 0.96
    alpha = np.full(N, 255.0)
    f0 = np.full(N, 0.08)
    emis = np.zeros(N)
    eyes = np.zeros(N)

    head = part == 'head'
    front = head & (nrm[:, 2] < -0.5)
    side = head & (np.abs(nrm[:, 0]) > 0.5)
    s = np.where(front, np.abs(pos[:, 0]), 4.0 + (pos[:, 2] + 4.0))
    sel = front | side
    inside = eye_mask(s[sel], pos[sel, 1], (0.75, -3.0), (0.88, -0.47), 5.9, 1.3, 9)
    c2, h2, s2, core = paint_eye(col[sel], height[sel], smooth[sel], inside, pos[sel], 23)
    col[sel], height[sel], smooth[sel] = c2, h2, s2
    eyes[sel] = core
    emis[sel] = core * 0.12

    # faint jaw crease so the face does not read as a blank block
    crease = front & (np.abs(pos[:, 1] + 1.35 + 0.35 * np.cos(pos[:, 0] * 0.75)) < 0.16) & (np.abs(pos[:, 0]) < 3.2)
    col[crease] *= 0.45

    spread = spread_map(pos, (0, 4, -2), 15)
    write_set(m, tx, 'suit', col, alpha, height, smooth, f0, emis, spread, eyes)

    # ---- black veins crawling under the host's skin (EMPOWERED form) ----
    warp = fbm(pos * 0.17, 3, 71)
    d = np.linalg.norm((pos - np.array([0, 1.5, 0])) * np.array([1.0, 0.72, 1.0]), axis=1)
    reach = smoothstep(22.0, 3.0, d)                       # densest around the neck / chest
    q = pos * np.array([0.30, 0.20, 0.30]) + (warp[:, None] - 0.5) * 2.6
    big = 1.0 - np.abs(2.0 * vnoise(q, 73) - 1.0)
    thick = smoothstep(0.955 - 0.05 * reach, 0.985, big)
    q2 = pos * np.array([0.85, 0.6, 0.85]) + (warp[:, None] - 0.5) * 5.0
    small = 1.0 - np.abs(2.0 * vnoise(q2, 79) - 1.0)
    cap = smoothstep(0.955, 0.99, small) * smoothstep(0.25, 0.8, reach)
    a = np.clip(thick * (0.35 + 0.65 * reach) + cap * 0.75, 0, 1)
    img = blank(m)
    vc = np.tile(np.array([16.0, 10.0, 24.0]), (N, 1))
    put(img, tx, np.concatenate([vc, (a * 235)[:, None]], 1))
    save(img, 'entity', 'veins.png')

    if preview_dir:
        rgba = np.concatenate([col, alpha[:, None]], 1)
        Image.fromarray(preview(tx, pos, nrm, rgba, yaw=0.5, pitch=0.1, scale=16, size=(420, 640), center=(0, 8, 0))).save(
            os.path.join(preview_dir, 'suit_front.png'))
        skin_c = np.tile(np.array([200.0, 160.0, 130.0]), (N, 1))
        vv = lerp(skin_c, vc, a[:, None])
        Image.fromarray(preview(tx, pos, nrm, np.concatenate([vv, alpha[:, None]], 1), yaw=0.5, pitch=0.1, scale=16,
                                size=(420, 640), center=(0, 8, 0))).save(os.path.join(preview_dir, 'veins_front.png'))


# --------------------------------------------------------------------------------------------
# Wild symbiote
# --------------------------------------------------------------------------------------------

def gen_symbiote(preview_dir=None):
    m = symbiote_model()
    with open(os.path.join(ROOT, 'geo', 'symbiote.json'), 'w') as f:
        json.dump(m.to_json(), f, separators=(',', ':'))
    tx = m.texels()
    pos, nrm = m.world(tx)
    N = len(tx['px'])
    mat = np.array([tx['mats'][i] for i in tx['mat']])
    col, height, smooth = skin(pos, nrm, tx['fu'], tx['fv'], seed=37, fiber=0.9, flow=(1, 1, 0.4))
    alpha = np.full(N, 255.0)
    f0 = np.full(N, 0.1)
    emis = np.zeros(N)
    eyes = np.zeros(N)
    hp = m.part_matrix('head')[:3, 3]
    lp = pos - hp
    sel = (mat == 'symb_head') & (nrm[:, 2] < -0.5)
    inside = eye_mask(np.abs(lp[sel, 0]), lp[sel, 1], (0.35, 0.55), (0.8, -0.6), 2.9, 0.62, 5)
    c2, h2, s2, core = paint_eye(col[sel], height[sel], smooth[sel], inside * 2.2, pos[sel], 37)
    col[sel], height[sel], smooth[sel] = c2, h2, s2
    eyes[sel] = core
    emis[sel] = core * 0.2
    write_set(m, tx, 'symbiote', col, alpha, height, smooth, f0, emis, None, eyes)
    if preview_dir:
        rgba = np.concatenate([col, alpha[:, None]], 1)
        Image.fromarray(preview(tx, pos, nrm, rgba, yaw=0.6, pitch=0.45, scale=22, size=(640, 480), center=(0, 20, 0))).save(
            os.path.join(preview_dir, 'symbiote.png'))


# --------------------------------------------------------------------------------------------
# Tendrils, membrane
# --------------------------------------------------------------------------------------------

def gen_tendril():
    W, H = 64, 256
    u, v = np.meshgrid((np.arange(W) + 0.5) / W, (np.arange(H) + 0.5) / H)
    th, ph = u * 2 * np.pi, v * 2 * np.pi
    R, r = 9.0, 1.6
    pos = np.stack([(R + r * np.cos(th)) * np.cos(ph), (R + r * np.cos(th)) * np.sin(ph), r * np.sin(th)], -1).reshape(-1, 3)
    strand = smoothstep(0.5, 0.95, ridged(np.stack([np.cos(th) * 2.2, np.sin(th) * 2.2, v * 3 + 0.25 * np.sin(th * 2)], -1).reshape(-1, 3) , 2, 91))
    n = fbm(pos * 0.9, 3, 93)
    col = np.array([15.0, 15.0, 21.0]) + strand[:, None] * np.array([34.0, 38.0, 52.0]) + (n[:, None] - 0.5) * 12
    g = smoothstep(0.68, 0.82, fbm(pos * 1.7, 2, 95))
    col = col + g[:, None] * np.array([60.0, 66.0, 86.0])
    img = np.concatenate([np.clip(col, 0, 255), np.full((W * H, 1), 255.0)], 1).reshape(H, W, 4)
    save(img, 'entity', 'tendril.png')
    hmap = (0.5 * strand + 0.2 * n).reshape(H, W)
    dx = (np.roll(hmap, -1, 1) - np.roll(hmap, 1, 1)) * 3
    dy = (np.roll(hmap, -1, 0) - np.roll(hmap, 1, 0)) * 3
    ln = np.sqrt(dx * dx + dy * dy + 1)
    nimg = np.stack([(-dx / ln * 0.5 + 0.5) * 255, (-dy / ln * 0.5 + 0.5) * 255, np.full_like(dx, 255), np.full_like(dx, 255)], -1)
    save(nimg, 'entity', 'tendril_n.png')
    simg = np.zeros((H, W, 4))
    simg[..., 0] = 228
    simg[..., 1] = 24
    simg[..., 3] = 255
    save(simg, 'entity', 'tendril_s.png')


def gen_membrane():
    S = 256
    u, v = np.meshgrid((np.arange(S) + 0.5) / S, (np.arange(S) + 0.5) / S)
    p = np.stack([u * 9, v * 9, np.zeros_like(u)], -1).reshape(-1, 3)
    # veins fan out from the shoulder corner (u=0,v=0)
    ang = np.arctan2(v, u + 0.02).reshape(-1)
    rad = np.sqrt(u * u + v * v).reshape(-1)
    spokes = smoothstep(0.75, 0.97, np.abs(np.sin(ang * 9 + 0.6 * np.sin(rad * 7))))
    web = smoothstep(0.7, 0.95, ridged(p * 0.9, 3, 101))
    n = fbm(p * 0.6, 3, 103)
    col = np.array([19.0, 18.0, 25.0]) + (n[:, None] - 0.5) * 12 + web[:, None] * np.array([22.0, 24.0, 34.0]) \
        + spokes[:, None] * np.array([30.0, 32.0, 46.0])
    thin = (1 - spokes) * (1 - web)
    alpha = 205 + 50 * (1 - thin)
    # scalloped trailing edge
    edge = 0.86 + 0.11 * np.abs(np.sin(u * np.pi * 3.5)).reshape(-1)
    alpha = np.where(v.reshape(-1) > edge, 0, alpha)
    img = np.concatenate([np.clip(col, 0, 255), alpha[:, None]], 1).reshape(S, S, 4)
    save(img, 'entity', 'membrane.png')


# --------------------------------------------------------------------------------------------
# Particles
# --------------------------------------------------------------------------------------------

def gen_particles():
    S = 32
    y, x = np.mgrid[0:S, 0:S]
    x = (x + 0.5) / S * 2 - 1
    y = (y + 0.5) / S * 2 - 1
    for i in range(4):
        ang = np.arctan2(y, x)
        rad = np.sqrt(x * x + (y * (1.0 - 0.12 * i)) ** 2)
        wob = 0.62 + 0.13 * np.sin(ang * (3 + i) + i * 1.7) + 0.07 * np.sin(ang * 7 + i)
        inside = smoothstep(wob, wob - 0.12, rad)
        hl = smoothstep(0.34, 0.0, np.sqrt((x + 0.22) ** 2 + (y + 0.26) ** 2))
        col = np.zeros((S, S, 4))
        col[..., 0] = 14 + hl * 110
        col[..., 1] = 14 + hl * 120
        col[..., 2] = 20 + hl * 150
        col[..., 3] = inside * 255
        save(col, 'particle', 'goo_%d.png' % i)
    # strand: a thin wriggling wisp
    for i in range(4):
        col = np.zeros((S, S, 4))
        cx = 0.35 * np.sin(y * 3.0 + i * 1.5) * (1 - np.abs(y))
        w = 0.16 * (1 - np.abs(y)) ** 0.6
        inside = smoothstep(w, w * 0.4, np.abs(x - cx)) * (np.abs(y) < 0.95)
        col[..., 0] = 16
        col[..., 1] = 16
        col[..., 2] = 24
        col[..., 3] = inside * 255
        save(col, 'particle', 'strand_%d.png' % i)
    # roar shockwave ring
    S2 = 64
    y, x = np.mgrid[0:S2, 0:S2]
    r = np.sqrt(((x + 0.5) / S2 * 2 - 1) ** 2 + ((y + 0.5) / S2 * 2 - 1) ** 2)
    ring = smoothstep(0.62, 0.84, r) * smoothstep(0.98, 0.88, r)
    col = np.zeros((S2, S2, 4))
    col[..., :3] = (225, 232, 255)
    col[..., 3] = ring * 150
    save(col, 'particle', 'shockwave.png')


# --------------------------------------------------------------------------------------------
# GUI + items (drawn supersampled, then reduced)
# --------------------------------------------------------------------------------------------

def _canvas(S):
    y, x = np.mgrid[0:S, 0:S]
    return (x + 0.5) / S * 2 - 1, (y + 0.5) / S * 2 - 1


def _down(img, out):
    im = Image.fromarray(to_u8(img), 'RGBA').resize((out, out), Image.LANCZOS)
    return np.asarray(im).astype(np.float64)


def _head_shape(x, y):
    return smoothstep(0.0, 0.05, 0.72 - np.sqrt((x * 1.05) ** 2 + ((y + 0.05) * 0.95) ** 2))


def _eyes2d(x, y, size=1.0, seed=3):
    s = np.abs(x).reshape(-1) * 6
    t = y.reshape(-1) * 6
    ins = eye_mask(s, t, (0.55, 0.9), (0.86, -0.52), 4.0 * size, 0.95 * size, seed)
    return smoothstep(0.0, 0.3, ins).reshape(x.shape)


def gen_gui():
    S = 256
    x, y = _canvas(S)
    icons = []
    # 0 host
    img = np.zeros((S, S, 4))
    h = _head_shape(x, y * 1.15 + 0.2)
    sh = smoothstep(0.0, 0.05, 0.95 - np.sqrt((x * 0.95) ** 2 + ((y - 1.25) * 1.25) ** 2))
    a = np.maximum(h, sh)
    img[..., :3] = (196, 170, 150)
    img[..., 3] = a * 255
    icons.append(img)
    # 1 empowered: host + veins + dark eyes
    img = icons[0].copy()
    p = np.stack([x * 3.5, y * 2.6, np.zeros_like(x)], -1).reshape(-1, 3)
    v = smoothstep(0.86, 0.96, ridged(p + 3, 3, 201)).reshape(S, S) * smoothstep(-0.9, 0.6, y)
    img[..., :3] = lerp(img[..., :3], np.array([18.0, 10.0, 28.0]), v[..., None])
    e = _eyes2d(x, y * 1.15 + 0.2, 0.55)
    img[..., :3] = lerp(img[..., :3], np.array([10.0, 8.0, 14.0]), e[..., None])
    icons.append(img)
    # 2 suit
    img = np.zeros((S, S, 4))
    img[..., :3] = (22, 22, 30)
    img[..., 3] = a * 255
    gl = smoothstep(0.5, 0.0, np.sqrt((x + 0.3) ** 2 + (y + 0.45) ** 2))
    img[..., :3] += gl[..., None] * np.array([50.0, 54.0, 72.0])
    e = _eyes2d(x, y * 1.15 + 0.2, 0.8)
    img[..., :3] = lerp(img[..., :3], np.array([240.0, 243.0, 250.0]), e[..., None])
    icons.append(img)
    # 3 venom: bigger head, huge eyes, grin
    img = np.zeros((S, S, 4))
    hv = smoothstep(0.0, 0.05, 0.9 - np.sqrt((x * 0.98) ** 2 + ((y + 0.02) * 1.0) ** 2))
    img[..., :3] = (18, 18, 26)
    img[..., 3] = hv * 255
    img[..., :3] += gl[..., None] * np.array([46.0, 50.0, 70.0])
    e = _eyes2d(x * 0.8, y * 0.9 + 0.12, 1.15)
    img[..., :3] = lerp(img[..., :3], np.array([240.0, 243.0, 250.0]), e[..., None])
    curve = 0.42 + 0.16 * (x * x)
    mouth = (np.abs(y - curve) < 0.2 - 0.12 * np.abs(x)) & (np.abs(x) < 0.72)
    img[..., :3] = np.where(mouth[..., None], np.array([70.0, 8.0, 16.0]), img[..., :3])
    saw = np.abs(((x * 5.2) % 1.0) * 2 - 1)
    up = mouth & (y - curve < -0.02 - 0.0 * x + (saw - 0.75) * 0.26)
    dn = mouth & (y - curve > 0.03 - (np.abs((((x + 0.096) * 5.2) % 1.0) * 2 - 1) - 0.75) * 0.26)
    img[..., :3] = np.where((up | dn)[..., None], np.array([245.0, 240.0, 226.0]), img[..., :3])
    icons.append(img)
    sheet = np.zeros((32, 128, 4))
    for i, ic in enumerate(icons):
        sheet[:, i * 32:(i + 1) * 32] = _down(ic, 32)
    save(sheet, 'gui', 'forms.png')

    # ability glyphs: swing, lash, crawl, glide, roar, devour (white, tinted in code)
    gl = []
    S = 192
    x, y = _canvas(S)

    def stroke(d, w=0.09):
        return smoothstep(w, w * 0.55, np.abs(d))

    g = np.zeros((S, S))  # swing: anchor + arc line
    g = np.maximum(g, smoothstep(0.16, 0.1, np.sqrt((x - 0.55) ** 2 + (y + 0.6) ** 2)))
    g = np.maximum(g, stroke((y + 0.6) - (-(x - 0.55)) * 1.15, 0.07) * (x < 0.55) * (x > -0.45))
    g = np.maximum(g, smoothstep(0.24, 0.16, np.sqrt((x + 0.5) ** 2 + (y - 0.52) ** 2)))
    gl.append(g)
    g = np.zeros((S, S))  # lash: whipping S curve
    g = np.maximum(g, stroke(y - 0.45 * np.sin(x * 3.6), 0.11 * (1.1 - (x + 1) / 2)) * (np.abs(x) < 0.85))
    gl.append(g)
    g = np.zeros((S, S))  # crawl: claw marks
    for k in (-0.45, 0.0, 0.45):
        g = np.maximum(g, stroke(x - k - 0.25 * y, 0.1 * (1 - np.abs(y) * 0.8)) * (np.abs(y) < 0.8))
    gl.append(g)
    g = np.zeros((S, S))  # glide: wing chevron
    g = np.maximum(g, smoothstep(0.0, 0.06, (0.55 - np.abs(y + 0.1 - 0.55 * np.abs(x)) - 0.0)) * (np.abs(x) < 0.9)
                   * smoothstep(0.0, 0.06, 0.2 + 0.25 * np.abs(np.sin(x * 9)) - (y - 0.5 * np.abs(x) + 0.05)))
    gl.append(g)
    g = np.zeros((S, S))  # roar: sound arcs
    r = np.sqrt((x + 0.75) ** 2 + y ** 2)
    for k in (0.5, 0.95, 1.4):
        g = np.maximum(g, stroke(r - k, 0.08) * (np.abs(y) < (x + 0.75) * 0.9))
    g = np.maximum(g, smoothstep(0.2, 0.13, r))
    gl.append(g)
    g = np.zeros((S, S))  # devour: jaws
    saw = np.abs(((x * 2.6 + 0.5) % 1.0) * 2 - 1)
    g = np.maximum(g, ((y < -0.12 - (1 - saw) * 0.0 + (saw - 1) * 0.42 + 0.3) & (y > -0.75) & (np.abs(x) < 0.82)) * 1.0)
    saw2 = np.abs(((x * 2.6) % 1.0) * 2 - 1)
    g = np.maximum(g, ((y > 0.12 + (1 - saw2) * 0.42 - 0.3) & (y < 0.75) & (np.abs(x) < 0.82)) * 1.0)
    gl.append(g)
    sheet = np.zeros((24, 24 * len(gl), 4))
    for i, g in enumerate(gl):
        im = np.zeros((S, S, 4))
        im[..., :3] = 255
        im[..., 3] = np.clip(g, 0, 1) * 255
        sheet[:, i * 24:(i + 1) * 24] = _down(im, 24)
    save(sheet, 'gui', 'abilities.png')

    # screen-edge goo vignette (stretched over the whole screen)
    S = 256
    x, y = _canvas(S)
    p = np.stack([x * 2.2, y * 2.2, np.zeros_like(x)], -1).reshape(-1, 3)
    edge = np.maximum(np.abs(x), np.abs(y)) ** 2.2 * 0.75 + (x * x + y * y) * 0.32
    tend = (ridged(p * 1.4, 3, 301).reshape(S, S) - 0.5) * 0.5 + (fbm(p, 3, 303).reshape(S, S) - 0.5) * 0.4
    a = smoothstep(0.62, 1.0, edge + tend)
    img = np.zeros((S, S, 4))
    img[..., :3] = (6, 6, 10)
    img[..., 3] = a * 255
    save(img, 'gui', 'vignette.png')
    # veiny frame used while transforming / weakened
    a2 = smoothstep(0.45, 0.85, edge * 0.9 + smoothstep(0.6, 0.95, ridged(p * 2.4 + 9, 3, 305).reshape(S, S)) * 0.55 - 0.1)
    img = np.zeros((S, S, 4))
    img[..., :3] = (10, 8, 16)
    img[..., 3] = a2 * 255
    save(img, 'gui', 'veins_overlay.png')


PAL = {
    '.': (0, 0, 0, 0),
    'o': (20, 22, 30, 255), 'O': (42, 46, 60, 255), 'h': (96, 104, 130, 255),          # goo
    'm': (86, 92, 104, 255), 'M': (146, 154, 168, 255), 'W': (212, 218, 228, 255), 'd': (52, 56, 66, 255),  # metal
    'g': (150, 205, 222, 150), 'G': (206, 238, 246, 190), 's': (112, 168, 190, 120),     # glass
    'r': (190, 48, 52, 255), 'R': (240, 96, 90, 255), 'c': (72, 220, 232, 255), 'C': (188, 250, 255, 255),
    'b': (88, 50, 26, 255), 'B': (124, 74, 40, 255), 'k': (58, 32, 16, 255), 'l': (158, 104, 62, 255),
    'p': (176, 60, 180, 255), 'w': (238, 238, 244, 255),
}

ITEMS = {
    'symbiote_canister': [
        "................",
        ".....dmmmmd.....",
        ".....mMWWMm.....",
        "....dmmmmmmd....",
        "....gGgssssg....",
        "....gGoOoosg....",
        "....gooOOoog....",
        "....goOhOoog....",
        "....gooOOoog....",
        "....goohOOog....",
        "....gOoooOog....",
        "....gooOooog....",
        "....dmmmmmmd....",
        ".....mMWWMm.....",
        ".....dmmmmd.....",
        "................",
    ],
    'empty_canister': [
        "................",
        ".....dmmmmd.....",
        ".....mMWWMm.....",
        "....dmmmmmmd....",
        "....gGgssssg....",
        "....gG.....g....",
        "....gG.....g....",
        "....g......g....",
        "....g......g....",
        "....g......g....",
        "....g.....sg....",
        "....gs...ssg....",
        "....dmmmmmmd....",
        ".....mMWWMm.....",
        ".....dmmmmd.....",
        "................",
    ],
    'sonic_emitter': [
        "................",
        "..........c.....",
        ".......c...c....",
        "....c...c...c...",
        ".....c...c..c...",
        "..dmm.c..c..c...",
        ".dmMMm.c.c..c...",
        ".mMWcMm..c..c...",
        ".mMccMm..c..c...",
        ".dmMMm.c.c..c...",
        "..dmm.c..c..c...",
        "..dm.c...c..c...",
        "..dmc...c...c...",
        "..dm...c...c....",
        "..dd......c.....",
        "................",
    ],
    'chocolate_bar': [
        "................",
        "................",
        "..........kkk...",
        ".........kBlBk..",
        "........kBlBBk..",
        ".......kBlBkBk..",
        "......kBlBkBbk..",
        ".....wwwBkBbk...",
        "....wrRwwBbk....",
        "...wrRrrwwk.....",
        "..wrRrrrrw......",
        "..wrrrrrw.......",
        "..wrrrrw........",
        "...wwww.........",
        "................",
        "................",
    ],
}


def gen_items():
    for name, rows in ITEMS.items():
        img = np.zeros((16, 16, 4))
        for yy, row in enumerate(rows):
            assert len(row) == 16, (name, yy, len(row))
            for xx, ch in enumerate(row):
                img[yy, xx] = PAL[ch]
        save(img, 'item', name + '.png')


def main():
    prev = None
    if '--preview' in sys.argv:
        prev = sys.argv[sys.argv.index('--preview') + 1]
        os.makedirs(prev, exist_ok=True)
    os.makedirs(os.path.join(ROOT, 'geo'), exist_ok=True)
    only = [a for a in sys.argv[1:] if not a.startswith('--') and a != prev]
    steps = {
        'venom': lambda: gen_venom(prev), 'suit': lambda: gen_suit(prev), 'symbiote': lambda: gen_symbiote(prev),
        'tendril': gen_tendril, 'membrane': gen_membrane, 'particles': gen_particles, 'gui': gen_gui, 'items': gen_items,
    }
    for k, fn in steps.items():
        if not only or k in only:
            fn()
            print('generated', k)


if __name__ == '__main__':
    main()
