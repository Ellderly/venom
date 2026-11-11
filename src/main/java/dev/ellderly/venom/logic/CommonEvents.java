package dev.ellderly.venom.logic;

import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import dev.ellderly.venom.VenomMod;
import dev.ellderly.venom.core.ModRegistry;
import dev.ellderly.venom.core.SymbioteData;
import dev.ellderly.venom.core.SymbioteForm;
import dev.ellderly.venom.network.Net;
import net.minecraft.commands.Commands;
import net.minecraft.commands.SharedSuggestionProvider;
import net.minecraft.core.particles.BlockParticleOption;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.tags.DamageTypeTags;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.damagesource.DamageTypes;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.food.FoodProperties;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.Vec3;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.PlayLevelSoundEvent;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import net.neoforged.neoforge.event.entity.living.LivingDeathEvent;
import net.neoforged.neoforge.event.entity.living.LivingEntityUseItemEvent;
import net.neoforged.neoforge.event.entity.living.LivingFallEvent;
import net.neoforged.neoforge.event.entity.living.LivingIncomingDamageEvent;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.event.tick.PlayerTickEvent;

import java.util.Arrays;

@EventBusSubscriber(modid = VenomMod.MODID)
public final class CommonEvents {
    private CommonEvents() {}

    @SubscribeEvent
    public static void onPlayerTick(PlayerTickEvent.Post event) {
        if (event.getEntity() instanceof ServerPlayer player) SymbioteLogic.tick(player);
    }

    @SubscribeEvent
    public static void onLogin(PlayerEvent.PlayerLoggedInEvent event) {
        if (event.getEntity() instanceof ServerPlayer player) {
            SymbioteData d = SymbioteLogic.data(player);
            d.prevForm = d.form;
            d.transition = 0;
            SymbioteLogic.applyAttributes(player, d);
            SymbioteLogic.sync(player);
        }
    }

    @SubscribeEvent
    public static void onRespawn(PlayerEvent.PlayerRespawnEvent event) {
        if (event.getEntity() instanceof ServerPlayer player) {
            SymbioteData d = SymbioteLogic.data(player);
            if (!event.isEndConquered()) {
                d.form = d.prevForm = SymbioteForm.HUMAN;
                d.transition = 0;
                d.weakened = 0;
                d.biomass = Math.max(d.biomass * 0.5F, 25.0F);
            }
            SymbioteLogic.applyAttributes(player, d);
            SymbioteLogic.sync(player);
        }
    }

    @SubscribeEvent
    public static void onChangeDimension(PlayerEvent.PlayerChangedDimensionEvent event) {
        if (event.getEntity() instanceof ServerPlayer player) SymbioteLogic.sync(player);
    }

    // ---- weaknesses: fire and sound ----
    @SubscribeEvent
    public static void onIncomingDamage(LivingIncomingDamageEvent event) {
        DamageSource source = event.getSource();
        if (event.getEntity() instanceof ServerPlayer player) {
            SymbioteData d = SymbioteLogic.data(player);
            if (d.bonded && d.form != SymbioteForm.HUMAN) {
                if (source.is(DamageTypeTags.IS_FIRE)) {
                    event.setAmount(event.getAmount() * (1.0F + 0.3F * d.form.ordinal()));
                    if (!player.isCreative()) d.biomass = Math.max(0.0F, d.biomass - event.getAmount() * 0.4F);
                }
                if (source.is(DamageTypes.SONIC_BOOM)) {
                    event.setAmount(event.getAmount() * 1.25F);
                    SymbioteLogic.weaken(player, 300);
                }
            }
        }
        // claws leave their mark
        if (source.getDirectEntity() instanceof ServerPlayer attacker && attacker.level() instanceof ServerLevel level) {
            SymbioteData d = SymbioteLogic.data(attacker);
            if (d.bonded && d.activeForm().atLeast(SymbioteForm.SUIT)) {
                LivingEntity target = event.getEntity();
                level.sendParticles(ModRegistry.GOO.get(), target.getX(), target.getY() + target.getBbHeight() * 0.6, target.getZ(), 5, 0.2, 0.2, 0.2, 0.06);
            }
        }
    }

    // ---- superhero landing ----
    @SubscribeEvent
    public static void onFall(LivingFallEvent event) {
        if (!(event.getEntity() instanceof ServerPlayer player)) return;
        SymbioteData d = SymbioteLogic.data(player);
        SymbioteForm form = d.activeForm();
        if (!d.bonded || !form.atLeast(SymbioteForm.SUIT)) return;
        float dist = event.getDistance();
        event.setDamageMultiplier(0.0F);
        if (dist < 6.0F) return;
        ServerLevel level = (ServerLevel) player.level();
        BlockState below = level.getBlockState(player.getOnPos());
        if (!below.isAir()) {
            level.sendParticles(new BlockParticleOption(ParticleTypes.BLOCK, below), player.getX(), player.getY() + 0.1, player.getZ(),
                    (int) Math.min(90, 20 + dist * 3), 0.9, 0.1, 0.9, 0.2);
        }
        SymbioteLogic.sound(player, ModRegistry.SND_SLAM, Math.min(2.0F, 0.6F + dist * 0.05F), form == SymbioteForm.VENOM ? 0.7F : 1.0F);
        Net.fx(player, Net.Fx.SLAM, new Vec3(dist, 0, 0));
        if (form == SymbioteForm.VENOM && dist >= 8.0F) {
            float damage = Math.min(16.0F, 3.0F + dist * 0.4F);
            for (LivingEntity e : level.getEntitiesOfClass(LivingEntity.class, player.getBoundingBox().inflate(3.5, 1.0, 3.5), e -> e != player && e.isAlive())) {
                e.hurt(player.damageSources().playerAttack(player), damage);
                e.knockback(1.0, player.getX() - e.getX(), player.getZ() - e.getZ());
                e.setDeltaMovement(e.getDeltaMovement().add(0, 0.35, 0));
            }
        }
    }

    // ---- the symbiote feeds ----
    @SubscribeEvent
    public static void onDeath(LivingDeathEvent event) {
        if (event.getSource().getEntity() instanceof ServerPlayer player && event.getEntity() != player) {
            SymbioteData d = SymbioteLogic.data(player);
            if (d.bonded && d.form != SymbioteForm.HUMAN) {
                SymbioteLogic.feed(player, Math.min(14.0F, 2.0F + event.getEntity().getMaxHealth() * 0.3F));
                if (player.getRandom().nextFloat() < 0.12F) SymbioteLogic.whisper(player, "kill");
            }
        }
    }

    @SubscribeEvent
    public static void onEat(LivingEntityUseItemEvent.Finish event) {
        if (!(event.getEntity() instanceof ServerPlayer player)) return;
        SymbioteData d = SymbioteLogic.data(player);
        if (!d.bonded) return;
        ItemStack stack = event.getItem();
        FoodProperties food = stack.getFoodProperties(player);
        if (food == null) return;
        if (stack.is(ModRegistry.CHOCOLATE_BAR.get()) || stack.is(Items.COOKIE)) {
            SymbioteLogic.feed(player, stack.is(Items.COOKIE) ? 9.0F : 22.0F);
            SymbioteLogic.whisper(player, "chocolate");
        } else if (stack.is(Items.BEEF) || stack.is(Items.PORKCHOP) || stack.is(Items.MUTTON) || stack.is(Items.CHICKEN)
                || stack.is(Items.RABBIT) || stack.is(Items.COD) || stack.is(Items.SALMON) || stack.is(Items.ROTTEN_FLESH)) {
            SymbioteLogic.feed(player, 12.0F);
            player.removeEffect(MobEffects.HUNGER);
            if (player.getRandom().nextFloat() < 0.4F) SymbioteLogic.whisper(player, "raw");
        } else {
            SymbioteLogic.feed(player, food.nutrition() * 0.8F);
        }
        SymbioteLogic.sync(player);
    }

    /** Church bells. Symbiotes cannot stand them. */
    @SubscribeEvent
    public static void onSound(PlayLevelSoundEvent.AtPosition event) {
        if (!(event.getLevel() instanceof ServerLevel level) || event.getSound() == null) return;
        if (event.getSound().value() != SoundEvents.BELL_BLOCK) return;
        Vec3 pos = event.getPosition();
        for (ServerPlayer player : level.players()) {
            if (player.distanceToSqr(pos) < 12 * 12) {
                SymbioteData d = SymbioteLogic.data(player);
                if (d.bonded && d.form.atLeast(SymbioteForm.SUIT)) SymbioteLogic.weaken(player, 120);
            }
        }
    }

    @SubscribeEvent
    public static void onCommands(RegisterCommandsEvent event) {
        event.getDispatcher().register(Commands.literal("venom").requires(s -> s.hasPermission(2))
                .then(Commands.literal("bond").executes(ctx -> {
                    SymbioteLogic.bond(ctx.getSource().getPlayerOrException(), false);
                    return 1;
                }))
                .then(Commands.literal("unbond").executes(ctx -> {
                    SymbioteLogic.unbond(ctx.getSource().getPlayerOrException(), false);
                    return 1;
                }))
                .then(Commands.literal("form").then(Commands.argument("form", StringArgumentType.word())
                        .suggests((c, b) -> SharedSuggestionProvider.suggest(Arrays.stream(SymbioteForm.VALUES).map(SymbioteForm::id), b))
                        .executes(ctx -> {
                            ServerPlayer player = ctx.getSource().getPlayerOrException();
                            SymbioteLogic.bond(player, false);
                            SymbioteLogic.requestForm(player, SymbioteForm.byName(StringArgumentType.getString(ctx, "form")).ordinal());
                            return 1;
                        })))
                .then(Commands.literal("biomass").then(Commands.argument("amount", IntegerArgumentType.integer(0, 100)).executes(ctx -> {
                    ServerPlayer player = ctx.getSource().getPlayerOrException();
                    SymbioteLogic.data(player).biomass = IntegerArgumentType.getInteger(ctx, "amount");
                    SymbioteLogic.sync(player);
                    ctx.getSource().sendSuccess(() -> Component.literal("Biomass set"), false);
                    return 1;
                }))));
    }
}
