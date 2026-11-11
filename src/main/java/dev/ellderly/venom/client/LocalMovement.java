package dev.ellderly.venom.client;

import dev.ellderly.venom.core.ModRegistry;
import dev.ellderly.venom.core.MoveState;
import dev.ellderly.venom.core.SurfaceMath;
import dev.ellderly.venom.core.SymbioteData;
import dev.ellderly.venom.core.SymbioteForm;
import dev.ellderly.venom.network.Net;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.network.chat.Component;
import net.minecraft.util.Mth;
import net.minecraft.world.entity.MoverType;
import net.minecraft.world.entity.Pose;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.ClipContext;
import net.minecraft.world.level.Level;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.HitResult;
import net.minecraft.world.phys.Vec3;
import net.neoforged.neoforge.network.PacketDistributor;

/**
 * Client-side simulation of everything the symbiote adds to the way its host moves. Like all player movement in
 * Minecraft it runs on the owning client; the resulting {@link MoveState} is reported to the server.
 */
public final class LocalMovement {
    private LocalMovement() {}

    /** The local player's authoritative special-movement state. */
    public static MoveState state = MoveState.IDLE;
    /** Auto-cling to walls when touching them in mid-air. */
    public static boolean crawlMode = true;
    /** Low-drag flight after a leap / tendril release, so momentum carries like it should. */
    public static boolean ballistic;
    /** 0..1 charge of the super leap (shown on the HUD). */
    public static float leapCharge;
    public static double ropeLength;
    public static int stateTicks;

    private static int reattachCooldown;
    private static Vec3 clingVel = Vec3.ZERO;
    private static boolean nextRight = true;
    private static int chargeTicks;
    private static float pendingLeap = -1.0F;
    private static boolean jumpWasDown, sneakWasDown, swingWasDown;
    private static int airTicks;

    public static void reset() {
        state = MoveState.IDLE;
        ballistic = false;
        leapCharge = 0;
        chargeTicks = 0;
        pendingLeap = -1;
        clingVel = Vec3.ZERO;
    }

    private static void setState(LocalPlayer p, MoveState next) {
        if (next.equals(state)) return;
        boolean modeChanged = next.mode() != state.mode();
        state = next;
        if (modeChanged) stateTicks = 0;
        p.setForcedPose(next.gliding() ? Pose.FALL_FLYING : null);
        PacketDistributor.sendToServer(new Net.MoveUpdate(next));
    }

    private static Vec3 chest(Player p) {
        return p.position().add(0, p.getBbHeight() * 0.62, 0);
    }

    // ------------------------------------------------------------------------------------------------ per-tick input

    /** Runs before the player ticks: reads input and decides state changes. */
    public static void preTick(Minecraft mc) {
        LocalPlayer p = mc.player;
        if (p == null) {
            reset();
            return;
        }
        SymbioteData d = p.getData(ModRegistry.SYMBIOTE);
        SymbioteForm form = d.activeForm();
        boolean free = mc.screen == null;
        boolean jump = mc.options.keyJump.isDown() && free;
        boolean sneak = mc.options.keyShift.isDown() && free;
        boolean swingKey = Keys.SWING.isDown() && free;
        boolean jumpPressed = jump && !jumpWasDown;
        boolean sneakPressed = sneak && !sneakWasDown;
        boolean swingPressed = swingKey && !swingWasDown;
        jumpWasDown = jump;
        sneakWasDown = sneak;
        swingWasDown = swingKey;
        if (reattachCooldown > 0) reattachCooldown--;
        stateTicks++;
        airTicks = p.onGround() ? 0 : airTicks + 1;

        boolean blocked = !p.isAlive() || p.isSpectator() || p.isPassenger() || p.getAbilities().flying || p.isFallFlying()
                || p.isSleeping() || !d.bonded;
        if (blocked || p.isInWater() || p.isInLava()) {
            if (state.mode() != MoveState.NONE) setState(p, MoveState.IDLE);
            ballistic = false;
            leapCharge = 0;
            chargeTicks = 0;
            if (blocked) return;
        }
        boolean wet = p.isInWater() || p.isInLava();

        // ---- tendril swing ----
        if (state.swinging()) {
            if (!swingKey || !form.canSwing() || p.level().getBlockState(BlockPos.containing(anchorProbe())).isAir()) releaseSwing(p);
        } else if (swingPressed && form.canSwing() && !wet) {
            tryStartSwing(p, form);
        }

        switch (state.mode()) {
            case MoveState.CLING -> {
                if (!form.canCrawl() || !crawlMode) {
                    detach(p, Vec3.ZERO, 6);
                } else if (jumpPressed && stateTicks > 3) {
                    Vec3 n = SurfaceMath.normal(state.normal());
                    Vec3 look = p.getLookAngle();
                    double power = 0.55 + 0.12 * form.ordinal();
                    Vec3 v = n.scale(0.42).add(look.scale(power)).add(0, 0.36, 0);
                    detach(p, v, 9);
                    ballistic = true;
                    PacketDistributor.sendToServer(new Net.UseAbility(Net.UseAbility.LEAP));
                } else if (sneakPressed) {
                    detach(p, SurfaceMath.normal(state.normal()).scale(0.12), 12);
                }
            }
            case MoveState.GLIDE -> {
                if (!form.canGlide() || p.onGround() || jumpPressed || sneakPressed) {
                    setState(p, MoveState.IDLE);
                    ballistic = !p.onGround();
                } else if (p.horizontalCollision && crawlMode && form.canCrawl() && stateTicks > 5) {
                    Direction wall = findWall(p);
                    if (wall != null) attach(p, wall.getOpposite());
                    else setState(p, MoveState.IDLE);
                }
            }
            case MoveState.NONE -> {
                if (wet) break;
                boolean canAttach = form.canCrawl() && crawlMode && reattachCooldown == 0 && !p.onGround();
                if (canAttach && p.horizontalCollision) {
                    Direction wall = findWall(p);
                    if (wall != null) attach(p, wall.getOpposite());
                } else if (canAttach && jump && p.verticalCollision && !p.verticalCollisionBelow) {
                    attach(p, Direction.DOWN);
                } else if (form.canGlide() && jumpPressed && !p.onGround() && airTicks > 4) {
                    setState(p, MoveState.glide());
                    ballistic = false;
                }
            }
            default -> {}
        }

        // ---- super leap: hold sneak on the ground to coil up, jump to release ----
        if (state.mode() == MoveState.NONE && form.atLeast(SymbioteForm.EMPOWERED) && p.onGround() && sneak) {
            chargeTicks++;
            leapCharge = Mth.clamp((chargeTicks - 6) / 24.0F, 0.0F, 1.0F);
            if (jumpPressed && chargeTicks >= 6) {
                pendingLeap = leapCharge;
                chargeTicks = 0;
                leapCharge = 0;
            }
        } else {
            chargeTicks = 0;
            leapCharge = 0;
        }

        if (ballistic && (p.onGround() || wet)) ballistic = false;
    }

    /** Runs after the player ticked. */
    public static void postTick(Minecraft mc) {
        LocalPlayer p = mc.player;
        if (p == null) return;
        if (pendingLeap >= 0.0F) {
            SymbioteForm form = p.getData(ModRegistry.SYMBIOTE).activeForm();
            float c = pendingLeap;
            pendingLeap = -1.0F;
            double factor = switch (form) {
                case EMPOWERED -> 0.8;
                case SUIT -> 1.0;
                case VENOM -> 1.15;
                default -> 0.0;
            };
            if (factor > 0) {
                Vec3 look = p.getLookAngle();
                Vec3 dir = new Vec3(look.x, Math.max(look.y, 0.3), look.z).normalize();
                double power = (0.85 + 1.55 * c) * factor;
                Vec3 v = dir.scale(power);
                v = new Vec3(v.x, Math.max(v.y, 0.5 + 0.45 * c), v.z);
                p.setDeltaMovement(v);
                p.hasImpulse = true;
                ballistic = true;
                PacketDistributor.sendToServer(new Net.UseAbility(Net.UseAbility.LEAP));
            }
        }
    }

    public static void toggleCrawl(Minecraft mc) {
        crawlMode = !crawlMode;
        if (mc.player != null) {
            mc.player.displayClientMessage(Component.translatable(crawlMode ? "message.venom.crawl_on" : "message.venom.crawl_off"), true);
        }
    }

    // ------------------------------------------------------------------------------------------------ cling

    private static void attach(LocalPlayer p, Direction normal) {
        clingVel = Vec3.ZERO;
        ballistic = false;
        p.setSprinting(false);
        setState(p, MoveState.cling(normal));
    }

    private static void detach(LocalPlayer p, Vec3 velocity, int cooldown) {
        reattachCooldown = cooldown;
        setState(p, MoveState.IDLE);
        p.setDeltaMovement(velocity);
        clingVel = Vec3.ZERO;
    }

    /** Which horizontal direction has a wall we are pressing against (pointing at the wall). */
    private static Direction findWall(LocalPlayer p) {
        Level level = p.level();
        AABB bb = p.getBoundingBox();
        Vec3 want = p.getDeltaMovement().multiply(1, 0, 1);
        Vec3 look = p.getLookAngle().multiply(1, 0, 1);
        Vec3 input = SurfaceMath.forwardOf(p.getYRot()).scale(p.zza).add(SurfaceMath.rightOf(p.getYRot()).scale(-p.xxa));
        Direction best = null;
        double bestScore = 0.05;
        for (Direction dir : Direction.Plane.HORIZONTAL) {
            Vec3 v = SurfaceMath.normal(dir);
            if (level.noCollision(p, bb.move(v.scale(0.1)).deflate(0.0, 0.1, 0.0))) continue;
            double score = v.dot(input) * 1.5 + v.dot(want) * 4.0 + v.dot(look) * 0.6;
            if (score > bestScore) {
                bestScore = score;
                best = dir;
            }
        }
        return best;
    }

    private static Direction dominant(Vec3 v) {
        return Direction.getNearest(v.x, v.y, v.z);
    }

    private static boolean clingTravel(LocalPlayer p, Vec3 input) {
        SymbioteForm form = p.getData(ModRegistry.SYMBIOTE).activeForm();
        Level level = p.level();
        Direction nd = state.normal();
        Vec3 n = SurfaceMath.normal(nd);
        Vec3 look = p.getLookAngle();
        Vec3 f = SurfaceMath.heading(look, nd, p.getYRot());
        Vec3 r = f.cross(n);
        if (r.dot(SurfaceMath.rightOf(p.getYRot())) < 0) r = r.scale(-1);

        double speed = form.crawlSpeed() * (Minecraft.getInstance().options.keySprint.isDown() ? 1.45 : 1.0);
        Vec3 want = f.scale(input.z).add(r.scale(-input.x));
        double len = want.length();
        if (len > 1.0E-4) want = want.scale(Math.min(1.0, len) / len * speed);
        clingVel = clingVel.lerp(want, 0.45);
        if (clingVel.lengthSqr() < 1.0E-5) clingVel = Vec3.ZERO;

        Vec3 before = p.position();
        Vec3 mv = clingVel.add(n.scale(-0.08));
        p.setDeltaMovement(mv);
        p.move(MoverType.SELF, mv);
        Vec3 moved = p.position().subtract(before);
        p.resetFallDistance();
        p.setSprinting(false);
        p.calculateEntityAnimation(false);

        double sp = clingVel.length();
        Direction dir = sp > 0.02 ? dominant(clingVel) : null;
        boolean attached = !level.noCollision(p, p.getBoundingBox().move(n.scale(-0.12)));
        if (!attached) {
            // crawled past an outer edge: wrap around it onto the neighbouring face
            if (dir != null && dir.getAxis() != nd.getAxis()) {
                Vec3 dv = SurfaceMath.normal(dir);
                AABB probe = p.getBoundingBox().move(n.scale(-0.32)).move(dv.scale(-0.14));
                if (!level.noCollision(p, probe)) {
                    p.move(MoverType.SELF, n.scale(-0.32));
                    p.move(MoverType.SELF, dv.scale(-0.3));
                    if (dir == Direction.UP) {
                        // pulled ourselves over the top of the wall
                        reattachCooldown = 6;
                        setState(p, MoveState.IDLE);
                        p.setDeltaMovement(clingVel.scale(0.5));
                    } else {
                        clingVel = Vec3.ZERO;
                        setState(p, MoveState.cling(dir));
                        p.setDeltaMovement(Vec3.ZERO);
                    }
                    return true;
                }
            }
            reattachCooldown = 4;
            setState(p, MoveState.IDLE);
            p.setDeltaMovement(clingVel);
            return true;
        }
        if (dir != null && dir.getAxis() != nd.getAxis()) {
            // ran into an inner corner: step onto the surface in front of us
            Vec3 dv = SurfaceMath.normal(dir);
            double intended = mv.dot(dv);
            if (intended > 0.02 && moved.dot(dv) < intended * 0.3) {
                Direction next = dir.getOpposite();
                clingVel = Vec3.ZERO;
                if (next == Direction.UP) {
                    setState(p, MoveState.IDLE);  // reached the floor
                } else {
                    setState(p, MoveState.cling(next));
                }
                p.setDeltaMovement(Vec3.ZERO);
                return true;
            }
        }
        p.setDeltaMovement(clingVel);
        return true;
    }

    // ------------------------------------------------------------------------------------------------ swing

    private static Vec3 anchorProbe() {
        // sample slightly inside the block the tendril grabbed
        return state.anchor().add(anchorInward);
    }

    private static Vec3 anchorInward = Vec3.ZERO;

    private static void tryStartSwing(LocalPlayer p, SymbioteForm form) {
        double range = form.tendrilRange();
        Vec3 eye = p.getEyePosition();
        BlockHitResult found = null;
        // aim assist: if the crosshair misses, look for something to grab above it
        for (float lift : new float[]{0, 7, 14, 22, 32, 44}) {
            Vec3 dir = Vec3.directionFromRotation(Mth.clamp(p.getXRot() - lift, -89.0F, 89.0F), p.getYRot());
            BlockHitResult hit = p.level().clip(new ClipContext(eye, eye.add(dir.scale(range)), ClipContext.Block.COLLIDER, ClipContext.Fluid.NONE, p));
            if (hit.getType() == HitResult.Type.BLOCK && (lift == 0 || hit.getLocation().y > p.getY() + 2.0)) {
                found = hit;
                break;
            }
        }
        if (found == null) {
            ClientAnim.get(p).lash(eye.add(p.getLookAngle().scale(Math.min(range, 18.0))), nextRight);
            return;
        }
        Vec3 anchor = found.getLocation();
        anchorInward = SurfaceMath.normal(found.getDirection()).scale(-0.05);
        ropeLength = Math.max(2.5, chest(p).distanceTo(anchor));
        if (!p.onGround()) ropeLength *= 0.97;
        ballistic = false;
        setState(p, MoveState.swing(anchor, nextRight));
        nextRight = !nextRight;
    }

    private static void releaseSwing(LocalPlayer p) {
        Vec3 v = p.getDeltaMovement();
        if (!p.onGround()) {
            v = v.scale(1.12);
            if (v.y > -0.15) v = v.add(0, 0.2, 0);
            p.setDeltaMovement(v);
            ballistic = true;
        }
        setState(p, MoveState.IDLE);
    }

    private static Vec3 steer(LocalPlayer p, Vec3 input, double accel) {
        return SurfaceMath.forwardOf(p.getYRot()).scale(input.z * accel).add(SurfaceMath.rightOf(p.getYRot()).scale(-input.x * accel));
    }

    private static boolean swingTravel(LocalPlayer p, Vec3 input) {
        Minecraft mc = Minecraft.getInstance();
        Vec3 anchor = state.anchor();
        Vec3 c = chest(p);
        double range = p.getData(ModRegistry.SYMBIOTE).activeForm().tendrilRange();
        if (mc.options.keyJump.isDown()) ropeLength = Math.max(2.0, ropeLength - 0.45);
        if (mc.options.keyShift.isDown()) ropeLength = Math.min(range, ropeLength + 0.45);
        if (p.onGround() && c.distanceTo(anchor) < ropeLength - 0.3) return false; // slack rope on the ground: just walk

        Vec3 v = p.getDeltaMovement();
        v = v.add(0, -p.getGravity(), 0).add(steer(p, input, 0.035)).scale(0.993);
        Vec3 next = c.add(v);
        Vec3 off = next.subtract(anchor);
        double dist = off.length();
        if (dist > ropeLength) {
            // rope is taut: keep us on the sphere around the anchor (the radial part of the velocity is absorbed)
            v = anchor.add(off.scale(ropeLength / dist)).subtract(c);
            double sp = v.length();
            if (sp > 2.6) v = v.scale(2.6 / sp);
        }
        p.setDeltaMovement(v);
        p.move(MoverType.SELF, v);
        if (p.horizontalCollision || p.verticalCollision) p.setDeltaMovement(p.getDeltaMovement().scale(0.85));
        p.resetFallDistance();
        p.calculateEntityAnimation(false);
        return true;
    }

    // ------------------------------------------------------------------------------------------------ glide / ballistic

    private static boolean glideTravel(LocalPlayer p) {
        Vec3 v = p.getDeltaMovement();
        Vec3 look = p.getLookAngle();
        float pitch = p.getXRot() * Mth.DEG_TO_RAD;
        double hLook = Math.sqrt(look.x * look.x + look.z * look.z);
        double hSpeed = v.horizontalDistance();
        double g = p.getGravity();
        double lift = Mth.square(Math.cos(pitch));
        v = v.add(0, g * (-1.0 + lift * 0.75), 0);
        if (v.y < 0 && hLook > 0) {
            double d = v.y * -0.1 * lift;
            v = v.add(look.x * d / hLook, d, look.z * d / hLook);
        }
        if (pitch < 0 && hLook > 0) {
            double d = hSpeed * -Mth.sin(pitch) * 0.04;
            v = v.add(-look.x * d / hLook, d * 3.2, -look.z * d / hLook);
        }
        if (hLook > 0) v = v.add((look.x / hLook * hSpeed - v.x) * 0.1, 0, (look.z / hLook * hSpeed - v.z) * 0.1);
        v = v.multiply(0.99, 0.98, 0.99);
        p.setDeltaMovement(v);
        p.move(MoverType.SELF, v);
        p.resetFallDistance();
        p.calculateEntityAnimation(false);
        return true;
    }

    private static boolean ballisticTravel(LocalPlayer p, Vec3 input) {
        Vec3 v = p.getDeltaMovement();
        if (p.onGround() || v.horizontalDistanceSqr() < 0.25 * 0.25) {
            ballistic = false;
            return false;
        }
        v = v.add(0, -p.getGravity(), 0).add(steer(p, input, 0.022));
        v = v.multiply(0.985, 0.985, 0.985);
        p.setDeltaMovement(v);
        p.move(MoverType.SELF, v);
        p.calculateEntityAnimation(false);
        if (p.horizontalCollision) ballistic = false;
        return true;
    }

    /** Called from the {@code Player.travel} mixin for the local player. */
    public static boolean travel(Player player, Vec3 input) {
        if (!(player instanceof LocalPlayer p) || p != Minecraft.getInstance().player) return false;
        if (p.getAbilities().flying || p.isPassenger() || p.isInWater() || p.isInLava()) return false;
        return switch (state.mode()) {
            case MoveState.CLING -> clingTravel(p, input);
            case MoveState.SWING -> swingTravel(p, input);
            case MoveState.GLIDE -> glideTravel(p);
            default -> ballistic && ballisticTravel(p, input);
        };
    }
}
