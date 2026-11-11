"""Geometry of every custom model in the mod (units: Minecraft model pixels, Y down, front = -Z)."""
import random
from .core import Model


def venom_model():
    """The full lethal-protector form. Uses the humanoid pivots so vanilla animation can drive it."""
    m = Model(128, 128, px=4)
    rnd = random.Random(7)

    # ---------------- head ----------------
    head = m.part('head')
    head.box((-4.5, -9, -4.5), (9, 6, 9))                                    # cranium
    head.box((-4.5, -3, -5.5), (9, 2, 10), faces={'bottom': 'mouth'})        # upper jaw / snout
    head.box((-3.5, -1, 0.5), (7, 2, 4), faces={'north': 'mouth'})           # throat / neck
    head.box((-3.5, -9.6, -3.5), (7, 1, 7), inflate=(0, -0.2, 0))            # skull crest
    head.box((-4.9, -7.2, -1.5), (1, 4, 5), inflate=(-0.3, 0, 0), uvkey='temple')
    head.box((3.9, -7.2, -1.5), (1, 4, 5), inflate=(-0.3, 0, 0), mirror=True, uvkey='temple')

    def tooth(part, x, y, z, length, up, key):
        # thin spike; all teeth of one length share a UV island
        oy = y - length if up else y
        part.box((x - 0.5, oy, z - 0.5), (1, length, 1), mat='tooth_up' if up else 'tooth',
                 inflate=(-0.3, 0, -0.32), uvkey='%s%d%s' % (key, length, 'u' if up else 'd'))

    # upper teeth: front arc + sides
    xs = [-3.9 + i * 0.975 for i in range(9)]
    for i, x in enumerate(xs):
        ln = [3, 2, 3, 2, 3, 2, 3, 2, 3][i]
        if i in (1, 7):
            ln = 4  # fangs
        tooth(head, x, -1.7, -5.75, ln, False, 'tf')
    for side in (-1, 1):
        for j, z in enumerate([-4.6, -3.5, -2.4, -1.3, -0.2]):
            tooth(head, side * 4.72, -1.7, z, [3, 2, 3, 2, 2][j], False, 'ts')

    # ---------------- lower jaw (hinged at the back of the skull) ----------------
    jaw = m.part('jaw', 'head', pivot=(0, -1, 3.5))
    jaw.box((-4.5, 0, -9), (9, 2, 10), faces={'top': 'mouth'}, inflate=(-0.05, 0, -0.02))
    jaw.box((-3, 1.6, -8.4), (6, 1, 6), inflate=(0, -0.1, 0))               # chin
    xs2 = [-3.4 + i * 0.975 for i in range(8)]
    for i, x in enumerate(xs2):
        ln = [2, 3, 2, 3, 3, 2, 3, 2][i]
        tooth(jaw, x, 0.5, -9.42, ln, True, 'tf')
    for side in (-1, 1):
        for j, z in enumerate([-7.7, -6.6, -5.5, -4.4]):
            tooth(jaw, side * 4.78, 0.5, z, [2, 3, 2, 2][j], True, 'ts')

    # ---------------- tongue (segment chain, hidden until the jaw opens) ----------------
    t0 = m.part('tongue0', 'head', pivot=(0, -0.55, 1.0))
    t0.box((-1.5, -0.5, -3), (3, 1, 3), mat='tongue')
    t1 = m.part('tongue1', 'tongue0', pivot=(0, 0, -3))
    t1.box((-1.5, -0.5, -3), (3, 1, 3), mat='tongue', inflate=(-0.15, -0.04, 0))
    t2 = m.part('tongue2', 'tongue1', pivot=(0, 0, -3))
    t2.box((-1, -0.5, -3), (2, 1, 3), mat='tongue', inflate=(0.1, -0.06, 0))
    t3 = m.part('tongue3', 'tongue2', pivot=(0, 0, -3))
    t3.box((-1, -0.5, -3), (2, 1, 3), mat='tongue', inflate=(-0.15, -0.1, 0))
    t4 = m.part('tongue4', 'tongue3', pivot=(0, 0, -3))
    t4.box((-0.5, -0.5, -3), (1, 1, 3), mat='tongue_tip', inflate=(0.1, -0.15, 0))

    # ---------------- torso ----------------
    body = m.part('body')
    body.box((-6.5, -1, -3.5), (13, 7, 7))                                   # rib cage
    body.box((-4.5, 6, -2.5), (9, 6, 5), inflate=(0.2, 0, 0.2))              # abdomen
    body.box((-5.5, -0.2, -4.4), (11, 5, 1), inflate=(0, 0, -0.05))          # pectorals
    body.box((-6, -0.5, 3.4), (12, 6, 1))                                    # lats
    body.box((-4.5, -2.6, -2.2), (9, 2, 6))                                  # trapezius hump
    # back tendrils (animated wisps)
    anchors = [(-4.2, 0.5), (4.2, 0.5), (-2.4, 3.6), (2.4, 3.6), (0, 1.6)]
    for i, (x, y) in enumerate(anchors):
        a = m.part('wisp%d_0' % i, 'body', pivot=(x, y, 4.2))
        a.box((-1, -1, 0), (2, 2, 4), inflate=-0.2, uvkey='wisp0')
        b = m.part('wisp%d_1' % i, 'wisp%d_0' % i, pivot=(0, 0, 3.6))
        b.box((-0.5, -0.5, 0), (1, 1, 4), inflate=0.2, uvkey='wisp1')
        c = m.part('wisp%d_2' % i, 'wisp%d_1' % i, pivot=(0, 0, 3.8))
        c.box((-0.5, -0.5, 0), (1, 1, 4), inflate=(-0.12, -0.12, 0), uvkey='wisp2')

    # ---------------- arms ----------------
    def arm(name, mirror):
        p = m.part(name, pivot=(5 if mirror else -5, 2, 0))

        def bx(o, s, **kw):
            if mirror:
                o = (-o[0] - s[0], o[1], o[2])
            p.box(o, s, mirror=mirror, **kw)

        bx((-8, -3.6, -3.5), (7, 6, 7), uvkey='shoulder')
        bx((-7, 2.2, -2.5), (5, 4, 5), uvkey='upperarm', inflate=(0.05, 0, 0.05))
        bx((-7.6, 5.9, -3), (6, 5, 6), uvkey='forearm')
        bx((-7.1, 10.8, -2.5), (5, 3, 5), uvkey='hand')
        for i, x in enumerate((-7.0, -5.6, -4.2)):
            bx((x, 13.5, -2.75), (1, 3, 1), mat='claw', inflate=(-0.2, 0, -0.2), uvkey='claw3')
        bx((-2.95, 12.6, -0.6), (1, 3, 1), mat='claw', inflate=(-0.2, -0.2, -0.2), uvkey='claw3')
        return p

    arm('right_arm', False)
    arm('left_arm', True)

    # ---------------- legs ----------------
    def leg(name, mirror):
        p = m.part(name, pivot=(1.9 if mirror else -1.9, 12, 0))

        def bx(o, s, **kw):
            if mirror:
                o = (-o[0] - s[0], o[1], o[2])
            p.box(o, s, mirror=mirror, **kw)

        bx((-3.7, -0.6, -3), (6, 7, 6), uvkey='thigh')
        bx((-3.2, 6.2, -2.5), (5, 4, 5), uvkey='shin', inflate=(0.1, 0, 0.1))
        bx((-3.6, 10, -5.2), (6, 2, 8), uvkey='foot')
        for x in (-3.3, -1.1, 1.1):
            bx((x, 10.9, -7.0), (1, 1, 2), mat='claw_fwd', inflate=(-0.15, -0.15, 0), uvkey='toe')
        return p

    leg('right_leg', False)
    leg('left_leg', True)

    m.pack()
    return m


def player_model():
    """Vanilla wide-arm player layout (64x64). Used to paint the suit / vein overlays in 3D."""
    m = Model(64, 64, px=4)

    def part(name, pivot, origin, size, uv):
        p = m.part(name, pivot=pivot)
        c = p.box(origin, size)
        c.uv = uv

    part('head', (0, 0, 0), (-4, -8, -4), (8, 8, 8), (0, 0))
    part('body', (0, 0, 0), (-4, 0, -2), (8, 12, 4), (16, 16))
    part('right_arm', (-5, 2, 0), (-3, -2, -2), (4, 12, 4), (40, 16))
    part('left_arm', (5, 2, 0), (-1, -2, -2), (4, 12, 4), (32, 48))
    part('right_leg', (-1.9, 12, 0), (-2, 0, -2), (4, 12, 4), (0, 16))
    part('left_leg', (1.9, 12, 0), (-2, 0, -2), (4, 12, 4), (16, 48))
    return m


def symbiote_model():
    """The wild symbiote: a crawling mass of living goo with reaching tendrils."""
    m = Model(64, 64, px=4)
    core = m.part('core', pivot=(0, 24, 0))
    core.box((-4, -5, -5), (8, 5, 10))
    core.box((-3, -6.4, -3.5), (6, 2, 7), inflate=(0, -0.2, 0))
    core.box((-5, -3, -3.5), (10, 3, 7), inflate=(0, -0.1, 0))
    head = m.part('head', 'core', pivot=(0, -4, -4.5))
    head.box((-2.5, -2.5, -4), (5, 4, 5), mat='symb_head')
    # crawling pseudopods
    spots = [(-4.5, -3.5, -1), (4.5, -3.5, 1), (-4.5, 3.5, -1), (4.5, 3.5, 1), (0, 5, 0)]
    for i, (x, z, s) in enumerate(spots):
        yaw = {0: 0.9, 1: -0.9, 2: 2.2, 3: -2.2, 4: 3.14159}[i]
        a = m.part('pod%d_0' % i, 'core', pivot=(x, -1.2, z), rot=(0, yaw, 0))
        a.box((-1, -1, -5), (2, 2, 5), uvkey='pod0')
        b = m.part('pod%d_1' % i, 'pod%d_0' % i, pivot=(0, 0, -5))
        b.box((-1, -1, -5), (2, 2, 5), inflate=-0.3, uvkey='pod1')
        c = m.part('pod%d_2' % i, 'pod%d_1' % i, pivot=(0, 0, -4.6))
        c.box((-0.5, -0.5, -4), (1, 1, 4), uvkey='pod2')
    # whipping feelers on the back
    for i, x in enumerate((-2, 2, 0)):
        a = m.part('feel%d_0' % i, 'core', pivot=(x, -5.5, 1 + (i == 2) * 2))
        a.box((-0.5, -5, -0.5), (1, 5, 1), inflate=0.15, uvkey='feel0')
        b = m.part('feel%d_1' % i, 'feel%d_0' % i, pivot=(0, -5, 0))
        b.box((-0.5, -5, -0.5), (1, 5, 1), inflate=-0.1, uvkey='feel1')
    m.pack()
    return m
