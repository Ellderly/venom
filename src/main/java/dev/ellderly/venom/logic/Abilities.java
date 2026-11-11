package dev.ellderly.venom.logic;

import dev.ellderly.venom.core.ModRegistry;
import dev.ellderly.venom.core.SymbioteData;
import dev.ellderly.venom.core.SymbioteForm;
import dev.ellderly.venom.network.Net;
import net.minecraft.core.particles.BlockParticleOption;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.server.TickTask;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.OwnableEntity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.entity.projectile.ProjectileUtil;
import net.minecraft.world.level.ClipContext;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.EntityHitResult;
import net.minecraft.world.phys.HitResult;
import net.minecraft.world.phys.Vec3;
import net.neoforged.neoforge.common.Tags;

/** Active powers triggered by key presses. */
public final class Abilities {
    private Abilities() {}

    public static void use(ServerPlayer player, int ability) {
        SymbioteData d = SymbioteLogic.data(player);
        if (!d.bonded || !player.isAlive() || player.isSpectator()) return;
        switch (ability) {
            case Net.UseAbility.LASH -> lash(player, d);
            case Net.UseAbility.ROAR -> roar(player, d);
            case Net.UseAbility.DEVOUR -> devour(player, d);
            case Net.UseAbility.LEAP -> leap(player, d);
            default -> {}
        }
    }

    private static void spend(ServerPlayer player, SymbioteData d, float biomass) {
        if (!player.isCreative()) d.biomass = Math.max(0.0F, d.biomass - biomass);
    }

    private static EntityHitResult aimEntity(ServerPlayer player, Vec3 eye, Vec3 end, float margin) {
        Vec3 dir = end.subtract(eye);
        return ProjectileUtil.getEntityHitResult(player.level(), player, eye, end,
                player.getBoundingBox().expandTowards(dir).inflate(1.5),
                e -> e instanceof LivingEntity && e.isAlive() && !e.isSpectator() && e.isPickable(), margin);
    }

    // ---- tendril lash: whip a target and yank it towards you ----
    private static void lash(ServerPlayer player, SymbioteData d) {
        SymbioteForm form = d.activeForm();
        if (!form.canLash() || d.lashCooldown > 0) return;
        double range = 10.0 + 4.0 * form.ordinal();
        Vec3 eye = player.getEyePosition();
        Vec3 look = player.getLookAngle();
        Vec3 end = eye.add(look.scale(range));
        BlockHitResult block = player.level().clip(new ClipContext(eye, end, ClipContext.Block.COLLIDER, ClipContext.Fluid.NONE, player));
        if (block.getType() != HitResult.Type.MISS) end = block.getLocation();
        EntityHitResult hit = aimEntity(player, eye, end, 0.7F);
        Vec3 fxPos = end;
        if (hit != null && hit.getEntity() instanceof LivingEntity target) {
            fxPos = target.position().add(0, target.getBbHeight() * 0.6, 0);
            float damage = switch (form) {
                case VENOM -> 9.0F;
                case SUIT -> 6.0F;
                default -> 4.0F;
            };
            target.hurt(player.damageSources().playerAttack(player), damage);
            Vec3 to = player.position().add(0, 1.0, 0).subtract(target.position());
            double dist = to.length();
            if (dist > 2.0) {
                double resist = target.getAttributeValue(net.minecraft.world.entity.ai.attributes.Attributes.KNOCKBACK_RESISTANCE);
                Vec3 pull = to.normalize().scale(Math.min(1.9, 0.4 + dist * 0.12) * (1.0 - resist * 0.8)).add(0, 0.28, 0);
                target.setDeltaMovement(pull);
                target.hurtMarked = true;
                target.hasImpulse = true;
            }
            player.level().playSound(null, target.getX(), target.getY(), target.getZ(), ModRegistry.SND_TENDRIL_HIT.get(), SoundSource.PLAYERS, 1.0F, 0.9F);
        } else if (block.getType() != HitResult.Type.MISS) {
            player.level().playSound(null, end.x, end.y, end.z, ModRegistry.SND_TENDRIL_HIT.get(), SoundSource.PLAYERS, 0.7F, 1.2F);
            if (player.level() instanceof ServerLevel level) {
                level.sendParticles(new BlockParticleOption(ParticleTypes.BLOCK, level.getBlockState(block.getBlockPos())),
                        end.x, end.y, end.z, 10, 0.1, 0.1, 0.1, 0.05);
            }
        }
        SymbioteLogic.sound(player, ModRegistry.SND_TENDRIL_SHOOT, 0.9F, 1.0F);
        Net.fx(player, Net.Fx.LASH, fxPos);
        d.lashCooldown = form == SymbioteForm.VENOM ? 20 : 30;
        spend(player, d, 0.6F);
        SymbioteLogic.sync(player);
    }

    // ---- roar: stagger everything around you ----
    private static void roar(ServerPlayer player, SymbioteData d) {
        SymbioteForm form = d.activeForm();
        if (!form.canRoar() || d.roarCooldown > 0) return;
        boolean venom = form == SymbioteForm.VENOM;
        double radius = venom ? 12.0 : 8.0;
        for (LivingEntity e : player.level().getEntitiesOfClass(LivingEntity.class, player.getBoundingBox().inflate(radius), e -> e != player && e.isAlive())) {
            if (e instanceof OwnableEntity own && player.getUUID().equals(own.getOwnerUUID())) continue;
            double dist = e.distanceTo(player);
            if (dist > radius) continue;
            float strength = (float) (1.0 - dist / radius);
            e.addEffect(new MobEffectInstance(MobEffects.MOVEMENT_SLOWDOWN, 100, venom ? 3 : 2), player);
            e.addEffect(new MobEffectInstance(MobEffects.WEAKNESS, 140, venom ? 1 : 0), player);
            if (venom) e.hurt(player.damageSources().indirectMagic(player, player), 2.0F + 3.0F * strength);
            e.knockback(0.5 + 1.3 * strength, player.getX() - e.getX(), player.getZ() - e.getZ());
            if (e instanceof Mob mob && !mob.getType().is(Tags.EntityTypes.BOSSES)) {
                mob.setTarget(null);
                mob.getNavigation().stop();
            }
        }
        if (venom) player.addEffect(new MobEffectInstance(MobEffects.DAMAGE_BOOST, 120, 0, false, true));
        SymbioteLogic.sound(player, ModRegistry.SND_ROAR, venom ? 3.0F : 2.0F, venom ? 0.75F : 1.05F);
        if (venom) player.level().playSound(null, player.getX(), player.getY(), player.getZ(), SoundEvents.RAVAGER_ROAR, SoundSource.PLAYERS, 2.0F, 0.55F);
        Net.fx(player, Net.Fx.ROAR, player.position());
        d.roarCooldown = venom ? 240 : 320;
        spend(player, d, 3.0F);
        SymbioteLogic.sync(player);
    }

    // ---- devour: bite; finishes weakened prey whole ----
    private static void devour(ServerPlayer player, SymbioteData d) {
        if (!d.activeForm().canDevour() || d.devourCooldown > 0) return;
        Vec3 eye = player.getEyePosition();
        Vec3 look = player.getLookAngle();
        double reach = player.entityInteractionRange() + 1.0;
        Vec3 end = eye.add(look.scale(reach));
        BlockHitResult block = player.level().clip(new ClipContext(eye, end, ClipContext.Block.COLLIDER, ClipContext.Fluid.NONE, player));
        if (block.getType() != HitResult.Type.MISS) end = block.getLocation();
        EntityHitResult hit = aimEntity(player, eye, end, 0.6F);
        if (hit == null || !(hit.getEntity() instanceof LivingEntity target)) {
            Net.fx(player, Net.Fx.BITE, end);
            SymbioteLogic.sound(player, ModRegistry.SND_BITE, 0.6F, 1.2F);
            d.devourCooldown = 15;
            SymbioteLogic.sync(player);
            return;
        }
        Vec3 at = target.position().add(0, target.getBbHeight() * 0.7, 0);
        boolean boss = target.getType().is(Tags.EntityTypes.BOSSES);
        boolean edible = !boss && !(target instanceof Player)
                && (target.getMaxHealth() <= 14.0F || target.getHealth() <= Math.max(10.0F, target.getMaxHealth() * 0.35F));
        ServerLevel level = (ServerLevel) player.level();
        Vec3 lunge = target.position().subtract(player.position());
        if (lunge.lengthSqr() > 2.5) {
            player.setDeltaMovement(lunge.normalize().scale(0.7).add(0, 0.15, 0));
            player.hurtMarked = true;
        }
        SymbioteLogic.sound(player, ModRegistry.SND_BITE, 1.2F, 0.8F);
        Net.fx(player, Net.Fx.BITE, at);
        if (edible) {
            target.hurt(player.damageSources().playerAttack(player), Float.MAX_VALUE);
            if (!target.isAlive()) {
                level.sendParticles(new BlockParticleOption(ParticleTypes.BLOCK, Blocks.REDSTONE_BLOCK.defaultBlockState()), at.x, at.y, at.z, 24, 0.2, 0.2, 0.2, 0.1);
                level.sendParticles(ModRegistry.GOO.get(), at.x, at.y, at.z, 12, 0.2, 0.2, 0.2, 0.08);
                player.heal(8.0F);
                player.getFoodData().eat(4, 0.5F);
                SymbioteLogic.feed(player, 26.0F);
                SymbioteLogic.whisper(player, "devour");
                level.getServer().tell(new TickTask(level.getServer().getTickCount() + 14, () -> {
                    if (player.isAlive()) level.playSound(null, player.getX(), player.getY(), player.getZ(), SoundEvents.PLAYER_BURP, SoundSource.PLAYERS, 1.0F, 0.6F);
                }));
            }
        } else {
            target.hurt(player.damageSources().playerAttack(player), 14.0F);
            level.sendParticles(ParticleTypes.DAMAGE_INDICATOR, at.x, at.y, at.z, 6, 0.2, 0.2, 0.2, 0.1);
            SymbioteLogic.feed(player, 3.0F);
        }
        d.devourCooldown = 50;
        SymbioteLogic.sync(player);
    }

    // ---- leap: the jump itself is simulated by the client, the server just makes it heard ----
    private static void leap(ServerPlayer player, SymbioteData d) {
        if (!d.activeForm().atLeast(SymbioteForm.EMPOWERED)) return;
        SymbioteLogic.sound(player, ModRegistry.SND_LEAP, 0.9F, d.activeForm() == SymbioteForm.VENOM ? 0.7F : 1.0F);
        Net.fx(player, Net.Fx.LEAP, player.position());
        spend(player, d, 0.4F);
    }
}
