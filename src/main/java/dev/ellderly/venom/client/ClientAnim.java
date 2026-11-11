package dev.ellderly.venom.client;

import dev.ellderly.venom.core.ModRegistry;
import dev.ellderly.venom.core.MoveState;
import dev.ellderly.venom.core.SurfaceMath;
import dev.ellderly.venom.core.SymbioteData;
import dev.ellderly.venom.core.SymbioteForm;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.core.Direction;
import net.minecraft.sounds.SoundEvent;
import net.minecraft.sounds.SoundSource;
import net.minecraft.util.Mth;
import net.minecraft.util.RandomSource;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.phys.Vec3;
import org.joml.Quaternionf;

import java.util.Map;
import java.util.WeakHashMap;

/** Per-player animation state that only exists on the client (smoothing, one-shot animations, sounds). */
public final class ClientAnim {
    private static final Map<Player, ClientAnim> ALL = new WeakHashMap<>();

    public static ClientAnim get(Player player) {
        return ALL.computeIfAbsent(player, p -> new ClientAnim());
    }

    // body orientation (crawling / gliding)
    public final Quaternionf orient = new Quaternionf();
    public final Quaternionf orientO = new Quaternionf();
    public float weight, weightO;
    public Vec3 shift = Vec3.ZERO, shiftO = Vec3.ZERO;
    public float centerY, centerYO;
    private float bank;

    public float cling, clingO, glide, glideO, swing, swingO;
    public float crawlPhase, crawlPhaseO;
    public float jaw, jawO;
    public float roar, roarO;
    public int roarTicks, biteTicks, leapTicks;
    public int lashTicks;
    public Vec3 lashTarget = Vec3.ZERO;
    public boolean lashRight = true;
    public int tendrilAge;
    /** Where the swinging tendril is attached and from which hand (kept while it retracts). */
    public Vec3 anchor = Vec3.ZERO;
    public boolean anchorRight = true;
    public int retractTicks;

    private MoveState last = MoveState.IDLE;
    private Vec3 lastPos;
    private float lastYaw;
    private float stepAccum;

    // render-time bookkeeping (see PlayerRenderHooks)
    public boolean pushed;
    public float sBodyRot, sBodyRotO, sHeadRot, sHeadRotO, sXRot, sXRotO;

    public static final int LASH_TIME = 9;

    public void lash(Vec3 target, boolean right) {
        lashTarget = target;
        lashRight = right;
        lashTicks = LASH_TIME;
    }

    public static MoveState stateOf(Player player) {
        return player == Minecraft.getInstance().player ? LocalMovement.state : player.getData(ModRegistry.MOVE);
    }

    private static float approach(float v, float target, float rate) {
        v += (target - v) * rate;
        return Math.abs(target - v) < 0.004F ? target : v;
    }

    public void tick(AbstractClientPlayer p) {
        SymbioteData d = p.getData(ModRegistry.SYMBIOTE);
        MoveState ms = stateOf(p);
        if (!d.bonded) ms = MoveState.IDLE;
        float scale = p.getScale();

        orientO.set(orient);
        weightO = weight;
        shiftO = shift;
        centerYO = centerY;
        clingO = cling;
        glideO = glide;
        swingO = swing;
        crawlPhaseO = crawlPhase;
        jawO = jaw;
        roarO = roar;

        boolean special = ms.clinging() || ms.gliding();
        if (special && weight == 0.0F) {
            SurfaceMath.standing(p.yBodyRot, orient);
            orientO.set(orient);
            centerY = centerYO = p.getBbHeight() * 0.5F;
        }
        weight = approach(weight, special ? 1 : 0, 0.3F);
        cling = approach(cling, ms.clinging() ? 1 : 0, 0.3F);
        glide = approach(glide, ms.gliding() ? 1 : 0, 0.25F);
        swing = approach(swing, ms.swinging() ? 1 : 0, 0.35F);

        Vec3 look = p.getLookAngle();
        Quaternionf target = new Quaternionf();
        Vec3 shiftTarget = Vec3.ZERO;
        float centerTarget = 0.93F * scale;
        float yawDelta = Mth.wrapDegrees(p.getYRot() - lastYaw);
        lastYaw = p.getYRot();
        if (ms.clinging()) {
            Direction n = ms.normal();
            SurfaceMath.clinging(look, n, p.getYRot(), target);
            double toward = n.getAxis() == Direction.Axis.Y ? p.getBbHeight() * 0.5 - 0.3 * scale : 0.05 * scale;
            shiftTarget = SurfaceMath.normal(n).scale(-toward);
            centerTarget = p.getBbHeight() * 0.5F;
            bank = 0;
        } else if (ms.gliding()) {
            bank = Mth.lerp(0.2F, bank, Mth.clamp(yawDelta * 0.07F, -0.9F, 0.9F));
            SurfaceMath.gliding(look, p.getYRot(), bank, target);
            centerTarget = p.getBbHeight() * 0.5F;
        } else {
            SurfaceMath.standing(p.yBodyRot, target);
            bank = 0;
        }
        if (weight > 0.0F) {
            orient.slerp(target, 0.4F);
            shift = shift.lerp(shiftTarget, 0.4);
            centerY = Mth.lerp(0.4F, centerY, centerTarget);
        } else {
            orient.set(target);
            shift = Vec3.ZERO;
        }

        // crawl cycle is driven by the distance actually travelled
        Vec3 pos = p.position();
        float dist = lastPos == null ? 0 : (float) pos.distanceTo(lastPos);
        lastPos = pos;
        if (ms.clinging()) {
            crawlPhase += Math.min(dist, 1.0F) * 5.2F;
            stepAccum += dist;
            if (stepAccum > 1.1F) {
                stepAccum = 0;
                play(p, ModRegistry.SND_CRAWL.get(), 0.35F, 0.9F + p.getRandom().nextFloat() * 0.3F);
            }
        }

        // one-shot animations
        if (roarTicks > 0) roarTicks--;
        if (biteTicks > 0) biteTicks--;
        if (leapTicks > 0) leapTicks--;
        if (lashTicks > 0) lashTicks--;
        if (retractTicks > 0) retractTicks--;
        roar = approach(roar, roarTicks > 0 ? 1 : 0, 0.3F);
        float jawTarget = 0.0F;
        if (roarTicks > 0) jawTarget = 1.0F;
        else if (biteTicks > 0) jawTarget = biteTicks > 5 ? 1.0F : 0.0F;
        jaw = roarTicks > 0 || biteTicks > 0 ? approach(jaw, jawTarget, biteTicks > 0 && biteTicks <= 5 ? 0.8F : 0.5F) : approach(jaw, 0, 0.25F);

        // tendril bookkeeping + state change sounds
        if (ms.swinging()) {
            if (!last.swinging() || !ms.anchor().equals(anchor)) {
                tendrilAge = 0;
                play(p, ModRegistry.SND_TENDRIL_SHOOT.get(), 0.8F, 0.95F + p.getRandom().nextFloat() * 0.2F);
            }
            anchor = ms.anchor();
            anchorRight = ms.right();
            tendrilAge++;
            if (tendrilAge == 3) Minecraft.getInstance().level.playLocalSound(anchor.x, anchor.y, anchor.z,
                    ModRegistry.SND_TENDRIL_HIT.get(), SoundSource.PLAYERS, 0.7F, 1.1F, false);
        } else if (last.swinging()) {
            retractTicks = 5;
        }
        if (ms.gliding() && !last.gliding()) play(p, ModRegistry.SND_GLIDE.get(), 0.8F, 0.8F);
        if (ms.clinging() && !last.clinging()) play(p, ModRegistry.SND_CRAWL.get(), 0.6F, 0.7F);
        last = ms;

        ambient(p, d);
    }

    private static void play(AbstractClientPlayer p, SoundEvent sound, float volume, float pitch) {
        p.level().playLocalSound(p.getX(), p.getY() + p.getBbHeight() * 0.5, p.getZ(), sound, SoundSource.PLAYERS, volume, pitch, false);
    }

    /** Living-goo particles: drips in the full form, a swirl while transforming. */
    private void ambient(AbstractClientPlayer p, SymbioteData d) {
        if (!d.bonded || p.isInvisible()) return;
        Minecraft mc = Minecraft.getInstance();
        if (p == mc.player && mc.options.getCameraType().isFirstPerson()) return;
        RandomSource rnd = p.getRandom();
        double w = p.getBbWidth() * 0.5, h = p.getBbHeight();
        if (d.isTransforming()) {
            for (int i = 0; i < 2; i++) {
                double a = rnd.nextDouble() * Math.PI * 2;
                p.level().addParticle(ModRegistry.STRAND.get(), p.getX() + Math.cos(a) * w * 1.3, p.getY() + rnd.nextDouble() * h,
                        p.getZ() + Math.sin(a) * w * 1.3, -Math.cos(a) * 0.03, 0.02, -Math.sin(a) * 0.03);
            }
        } else if (d.form == SymbioteForm.VENOM && rnd.nextInt(14) == 0) {
            p.level().addParticle(ModRegistry.GOO.get(), p.getX() + (rnd.nextDouble() - 0.5) * w * 2, p.getY() + h * (0.3 + rnd.nextDouble() * 0.6),
                    p.getZ() + (rnd.nextDouble() - 0.5) * w * 2, 0, -0.02, 0);
        }
    }

    // ---- lerp helpers used at render time ----
    public float lashExtension(float pt) {
        if (lashTicks <= 0) return 0.0F;
        float t = 1.0F - (lashTicks - pt) / LASH_TIME;
        return Mth.sin(Mth.clamp(t, 0, 1) * Mth.PI);
    }
}
