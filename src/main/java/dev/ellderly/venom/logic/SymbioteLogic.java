package dev.ellderly.venom.logic;

import dev.ellderly.venom.VenomMod;
import dev.ellderly.venom.core.ModRegistry;
import dev.ellderly.venom.core.MoveState;
import dev.ellderly.venom.core.SymbioteData;
import dev.ellderly.venom.core.SymbioteForm;
import dev.ellderly.venom.network.Net;
import net.minecraft.core.Holder;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvent;
import net.minecraft.sounds.SoundSource;
import net.minecraft.util.Mth;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.entity.Pose;
import net.minecraft.world.entity.ai.attributes.Attribute;
import net.minecraft.world.entity.ai.attributes.AttributeInstance;
import net.minecraft.world.entity.ai.attributes.AttributeModifier;
import net.minecraft.world.entity.ai.attributes.AttributeModifier.Operation;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.phys.AABB;

import java.util.List;
import java.util.Map;
import java.util.WeakHashMap;

/** Server-side rules of the bond: transformations, upkeep, stats. */
public final class SymbioteLogic {
    private SymbioteLogic() {}

    public static final float VENOM_SCALE = 0.3F;
    private static final ResourceLocation MOD_ID = VenomMod.id("form");
    private static final ResourceLocation SCALE_ID = VenomMod.id("form_scale");

    private record Stat(Holder<Attribute> attribute, Operation op, double empowered, double suit, double venom) {
        double value(SymbioteForm form) {
            return switch (form) {
                case HUMAN -> 0.0;
                case EMPOWERED -> empowered;
                case SUIT -> suit;
                case VENOM -> venom;
            };
        }
    }

    private static final List<Stat> STATS = List.of(
            new Stat(Attributes.MAX_HEALTH, Operation.ADD_VALUE, 4, 10, 30),
            new Stat(Attributes.ATTACK_DAMAGE, Operation.ADD_VALUE, 3, 6, 12),
            new Stat(Attributes.ATTACK_SPEED, Operation.ADD_VALUE, 0.3, 0.6, 0.4),
            new Stat(Attributes.ATTACK_KNOCKBACK, Operation.ADD_VALUE, 0.3, 0.8, 1.8),
            new Stat(Attributes.MOVEMENT_SPEED, Operation.ADD_MULTIPLIED_TOTAL, 0.2, 0.35, 0.3),
            new Stat(Attributes.ARMOR, Operation.ADD_VALUE, 2, 8, 14),
            new Stat(Attributes.ARMOR_TOUGHNESS, Operation.ADD_VALUE, 0, 3, 8),
            new Stat(Attributes.KNOCKBACK_RESISTANCE, Operation.ADD_VALUE, 0.1, 0.35, 0.75),
            new Stat(Attributes.JUMP_STRENGTH, Operation.ADD_VALUE, 0.12, 0.2, 0.3),
            new Stat(Attributes.SAFE_FALL_DISTANCE, Operation.ADD_VALUE, 14, 80, 300),
            new Stat(Attributes.FALL_DAMAGE_MULTIPLIER, Operation.ADD_MULTIPLIED_TOTAL, -0.7, -1, -1),
            new Stat(Attributes.STEP_HEIGHT, Operation.ADD_VALUE, 0, 0.4, 0.65),
            new Stat(Attributes.ENTITY_INTERACTION_RANGE, Operation.ADD_VALUE, 0.25, 0.75, 1.75),
            new Stat(Attributes.BLOCK_INTERACTION_RANGE, Operation.ADD_VALUE, 0, 0.5, 1.5),
            new Stat(Attributes.BLOCK_BREAK_SPEED, Operation.ADD_MULTIPLIED_TOTAL, 0.15, 0.4, 1.0),
            new Stat(Attributes.OXYGEN_BONUS, Operation.ADD_VALUE, 1, 3, 6),
            new Stat(Attributes.WATER_MOVEMENT_EFFICIENCY, Operation.ADD_VALUE, 0.2, 0.5, 0.5)
    );

    /** Per-player bookkeeping that never needs saving. */
    private static final class Session {
        int lastSyncedBiomass = -1;
        int whisperTimer = 600;
        int hungerWarn;
        int fireWarn;
    }

    private static final Map<Player, Session> SESSIONS = new WeakHashMap<>();

    private static Session session(Player p) {
        return SESSIONS.computeIfAbsent(p, k -> new Session());
    }

    public static SymbioteData data(Player player) {
        return player.getData(ModRegistry.SYMBIOTE);
    }

    public static MoveState move(Player player) {
        return player.getData(ModRegistry.MOVE);
    }

    public static void setMove(ServerPlayer player, MoveState state) {
        player.setData(ModRegistry.MOVE, state);
        // gliding uses the small "elytra" hitbox, exactly like the owning client does
        player.setForcedPose(state.gliding() ? Pose.SPIN_ATTACK : null);
    }

    public static void sync(ServerPlayer player) {
        player.syncData(ModRegistry.SYMBIOTE);
        session(player).lastSyncedBiomass = (int) data(player).biomass;
    }

    public static void sound(ServerPlayer player, Holder<SoundEvent> sound, float volume, float pitch) {
        player.level().playSound(null, player.getX(), player.getY() + player.getBbHeight() * 0.5, player.getZ(),
                sound.value(), SoundSource.PLAYERS, volume, pitch);
    }

    public static void whisper(ServerPlayer player, String group) {
        Integer count = WHISPERS.get(group);
        if (count == null) return;
        Net.whisper(player, "whisper.venom." + group + "." + player.getRandom().nextInt(count));
    }

    /** Number of translated variants per whisper group (see lang files). */
    private static final Map<String, Integer> WHISPERS = Map.ofEntries(
            Map.entry("bond", 3), Map.entry("venom", 4), Map.entry("hungry", 4), Map.entry("starving", 2),
            Map.entry("weak", 3), Map.entry("fire", 2), Map.entry("kill", 4), Map.entry("devour", 4),
            Map.entry("chocolate", 3), Map.entry("idle_human", 5), Map.entry("idle_power", 6), Map.entry("night", 3),
            Map.entry("no_room", 1), Map.entry("raw", 2), Map.entry("recover", 2), Map.entry("lowhp", 3));

    // ------------------------------------------------------------------------------------------------ bonding

    public static void bond(ServerPlayer player, boolean forced) {
        SymbioteData d = data(player);
        if (d.bonded) return;
        d.bonded = true;
        d.form = d.prevForm = SymbioteForm.HUMAN;
        d.transition = 0;
        d.biomass = 55.0F;
        d.weakened = 0;
        applyAttributes(player, d);
        player.addEffect(new MobEffectInstance(MobEffects.DARKNESS, 100, 0, false, false));
        player.addEffect(new MobEffectInstance(MobEffects.CONFUSION, 160, 0, false, false));
        player.addEffect(new MobEffectInstance(MobEffects.MOVEMENT_SLOWDOWN, 60, 2, false, false));
        sound(player, ModRegistry.SND_BOND, 1.0F, 1.0F);
        Net.fx(player, Net.Fx.BOND, player.position());
        goo(player, 60, 0.12);
        whisper(player, "bond");
        player.displayClientMessage(Component.translatable(forced ? "message.venom.bonded_forced" : "message.venom.bonded"), false);
        sync(player);
    }

    public static void unbond(ServerPlayer player, boolean dropCanister) {
        SymbioteData d = data(player);
        if (!d.bonded) return;
        d.bonded = false;
        d.form = d.prevForm = SymbioteForm.HUMAN;
        d.transition = 0;
        d.weakened = 0;
        applyAttributes(player, d);
        setMove(player, MoveState.IDLE);
        player.addEffect(new MobEffectInstance(MobEffects.WEAKNESS, 600, 1));
        player.addEffect(new MobEffectInstance(MobEffects.HUNGER, 400, 1));
        player.addEffect(new MobEffectInstance(MobEffects.CONFUSION, 200, 0));
        sound(player, ModRegistry.SND_SCREAM, 1.0F, 0.8F);
        goo(player, 80, 0.2);
        if (dropCanister) {
            ItemEntity item = new ItemEntity(player.level(), player.getX(), player.getY() + 0.8, player.getZ(),
                    new ItemStack(ModRegistry.SYMBIOTE_CANISTER.get()));
            item.setPickUpDelay(40);
            player.level().addFreshEntity(item);
        }
        player.displayClientMessage(Component.translatable("message.venom.unbonded"), false);
        sync(player);
    }

    // ------------------------------------------------------------------------------------------------ forms

    public static void requestForm(ServerPlayer player, int formId) {
        SymbioteData d = data(player);
        if (!d.bonded || player.isSpectator() || !player.isAlive()) return;
        SymbioteForm target = SymbioteForm.byId(Mth.clamp(formId, 0, SymbioteForm.VALUES.length - 1));
        if (target == d.form || d.isTransforming()) return;
        boolean up = target.ordinal() > d.form.ordinal();
        if (up && d.weakened > 0) {
            whisper(player, "weak");
            return;
        }
        if (up && d.biomass < 4.0F && !player.isCreative()) {
            whisper(player, "starving");
            return;
        }
        if (target == SymbioteForm.VENOM && !hasRoomToGrow(player)) {
            whisper(player, "no_room");
            return;
        }
        startTransition(player, d, target);
    }

    private static boolean hasRoomToGrow(ServerPlayer player) {
        AABB bb = player.getBoundingBox();
        double grow = bb.getYsize() * VENOM_SCALE;
        double side = bb.getXsize() * VENOM_SCALE * 0.5;
        return player.level().noCollision(player, new AABB(bb.minX - side, bb.minY + 0.05, bb.minZ - side, bb.maxX + side, bb.maxY + grow, bb.maxZ + side));
    }

    public static void startTransition(ServerPlayer player, SymbioteData d, SymbioteForm target) {
        boolean up = target.ordinal() > d.form.ordinal();
        int steps = Math.abs(target.ordinal() - d.form.ordinal());
        d.prevForm = d.form;
        d.form = target;
        d.transitionTotal = 20 + 12 * steps;
        d.transition = d.transitionTotal;
        applyAttributes(player, d);
        sound(player, up ? ModRegistry.SND_TRANSFORM : ModRegistry.SND_RECEDE, 1.0F, up ? 0.9F + 0.1F * steps : 1.1F);
        if (up && target == SymbioteForm.VENOM) sound(player, ModRegistry.SND_GROWL, 1.2F, 0.7F);
        Net.fx(player, Net.Fx.TRANSFORM, player.position());
        goo(player, 14 + 10 * steps, 0.1);
        if (target.ordinal() < SymbioteForm.SUIT.ordinal() && move(player).gliding()) setMove(player, MoveState.IDLE);
        if (target == SymbioteForm.HUMAN) setMove(player, MoveState.IDLE);
        sync(player);
    }

    /** Knocks the symbiote back into hiding (fire / sound). */
    public static void weaken(ServerPlayer player, int ticks) {
        SymbioteData d = data(player);
        if (!d.bonded) return;
        boolean was = d.weakened > 0;
        d.weakened = Math.max(d.weakened, ticks);
        if (d.form != SymbioteForm.HUMAN) {
            if (d.isTransforming()) {
                d.prevForm = d.form;
                d.transition = 0;
            }
            startTransition(player, d, SymbioteForm.HUMAN);
        }
        if (!was) {
            sound(player, ModRegistry.SND_SCREAM, 1.0F, 1.1F);
            player.addEffect(new MobEffectInstance(MobEffects.CONFUSION, Math.min(ticks, 160), 0, false, false));
            player.addEffect(new MobEffectInstance(MobEffects.MOVEMENT_SLOWDOWN, Math.min(ticks, 80), 1, false, false));
            whisper(player, "weak");
        }
        sync(player);
    }

    public static void feed(ServerPlayer player, float amount) {
        SymbioteData d = data(player);
        if (!d.bonded) return;
        d.biomass = Mth.clamp(d.biomass + amount, 0.0F, SymbioteData.MAX_BIOMASS);
    }

    public static void applyAttributes(ServerPlayer player, SymbioteData d) {
        SymbioteForm form = d.bonded ? d.form : SymbioteForm.HUMAN;
        for (Stat stat : STATS) {
            AttributeInstance inst = player.getAttribute(stat.attribute);
            if (inst == null) continue;
            inst.removeModifier(MOD_ID);
            double v = stat.value(form);
            if (v != 0.0) inst.addTransientModifier(new AttributeModifier(MOD_ID, v, stat.op));
        }
        updateScale(player, d);
        if (player.getHealth() > player.getMaxHealth()) player.setHealth(player.getMaxHealth());
    }

    private static void updateScale(ServerPlayer player, SymbioteData d) {
        AttributeInstance inst = player.getAttribute(Attributes.SCALE);
        if (inst == null) return;
        float w = d.weight(SymbioteForm.VENOM, 0.0F);
        w = w * w * (3 - 2 * w);
        if (w <= 0.0F) {
            inst.removeModifier(SCALE_ID);
        } else {
            inst.addOrUpdateTransientModifier(new AttributeModifier(SCALE_ID, VENOM_SCALE * w, Operation.ADD_MULTIPLIED_BASE));
        }
    }

    public static void goo(ServerPlayer player, int count, double speed) {
        if (player.level() instanceof ServerLevel level) {
            level.sendParticles(ModRegistry.GOO.get(), player.getX(), player.getY() + player.getBbHeight() * 0.55, player.getZ(),
                    count, player.getBbWidth() * 0.4, player.getBbHeight() * 0.3, player.getBbWidth() * 0.4, speed);
        }
    }

    // ------------------------------------------------------------------------------------------------ movement relay

    public static void onMoveUpdate(ServerPlayer player, MoveState state) {
        SymbioteData d = data(player);
        SymbioteForm form = d.activeForm();
        boolean ok = switch (state.mode()) {
            case MoveState.CLING -> form.canCrawl() && state.face() >= 0 && state.face() < 6;
            case MoveState.SWING -> form.canSwing() && state.anchor().distanceTo(player.position()) < form.tendrilRange() + 16.0;
            case MoveState.GLIDE -> form.canGlide();
            default -> true;
        };
        MoveState old = move(player);
        MoveState next = ok ? state : MoveState.IDLE;
        if (next.swinging() && !old.swinging() && !player.isCreative()) d.biomass = Math.max(0.0F, d.biomass - 0.12F);
        setMove(player, next);
    }

    // ------------------------------------------------------------------------------------------------ tick

    public static void tick(ServerPlayer player) {
        SymbioteData d = data(player);
        if (!d.bonded) return;
        Session s = session(player);
        boolean dirty = false;

        if (d.transition > 0) {
            d.transition--;
            if (d.transition == 0) {
                SymbioteForm from = d.prevForm;
                d.prevForm = d.form;
                dirty = true;
                if (d.form == SymbioteForm.VENOM && from != SymbioteForm.VENOM) whisper(player, "venom");
            }
            updateScale(player, d);
        }
        if (d.roarCooldown > 0) d.roarCooldown--;
        if (d.lashCooldown > 0) d.lashCooldown--;
        if (d.devourCooldown > 0) d.devourCooldown--;
        if (d.weakened > 0 && --d.weakened == 0) {
            dirty = true;
            whisper(player, "recover");
        }
        if (s.hungerWarn > 0) s.hungerWarn--;
        if (s.fireWarn > 0) s.fireWarn--;

        MoveState move = move(player);
        if (move.mode() != MoveState.NONE) {
            player.resetFallDistance();
            if (!d.activeForm().canCrawl()) setMove(player, MoveState.IDLE);
        }

        boolean mortal = !player.isCreative() && !player.isSpectator();
        if (player.tickCount % 20 == 0) {
            SymbioteForm form = d.form;
            if (mortal) {
                if (form == SymbioteForm.HUMAN) {
                    // dormant: the symbiote slowly feeds on what its host eats
                    if (d.biomass < 45.0F && player.getFoodData().getFoodLevel() > 6) {
                        d.biomass += 0.06F;
                        player.causeFoodExhaustion(0.12F);
                    }
                } else {
                    d.biomass = Math.max(0.0F, d.biomass - form.upkeep());
                }
                if (player.isOnFire() && form.atLeast(SymbioteForm.SUIT)) {
                    d.biomass = Math.max(0.0F, d.biomass - 2.5F);
                    if (s.fireWarn == 0) {
                        whisper(player, "fire");
                        s.fireWarn = 200;
                    }
                }
                if (d.biomass <= 0.0F && form != SymbioteForm.HUMAN && !d.isTransforming()) {
                    whisper(player, "starving");
                    player.addEffect(new MobEffectInstance(MobEffects.HUNGER, 300, 1));
                    startTransition(player, d, SymbioteForm.HUMAN);
                } else if (d.biomass < 15.0F && form != SymbioteForm.HUMAN && s.hungerWarn == 0) {
                    whisper(player, "hungry");
                    s.hungerWarn = 700;
                }
            }
            // regeneration paid for with biomass
            int interval = switch (form) {
                case HUMAN -> 0;
                case EMPOWERED -> 100;
                case SUIT -> 60;
                case VENOM -> 20;
            };
            if (interval > 0 && player.tickCount % interval == 0 && player.getHealth() < player.getMaxHealth() && d.biomass > 8.0F) {
                player.heal(1.0F);
                if (mortal) d.biomass -= 0.35F;
            }
        }

        // the voice in your head
        if (--s.whisperTimer <= 0) {
            s.whisperTimer = 1400 + player.getRandom().nextInt(2400);
            if (d.weakened == 0 && !d.isTransforming()) {
                if (player.getHealth() < player.getMaxHealth() * 0.3F) whisper(player, "lowhp");
                else if (d.form == SymbioteForm.HUMAN) whisper(player, player.level().isNight() && player.getRandom().nextBoolean() ? "night" : "idle_human");
                else whisper(player, "idle_power");
            }
        }

        if (dirty || (player.tickCount % 10 == 0 && (int) d.biomass != s.lastSyncedBiomass)) sync(player);
    }
}
