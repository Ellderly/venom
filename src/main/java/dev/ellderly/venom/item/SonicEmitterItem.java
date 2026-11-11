package dev.ellderly.venom.item;

import dev.ellderly.venom.core.ModRegistry;
import dev.ellderly.venom.core.SymbioteData;
import dev.ellderly.venom.core.SymbioteForm;
import dev.ellderly.venom.entity.WildSymbiote;
import dev.ellderly.venom.logic.SymbioteLogic;
import dev.ellderly.venom.network.Net;
import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResultHolder;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.TooltipFlag;
import net.minecraft.world.level.Level;

import java.util.List;

/**
 * Emits a burst in the frequency symbiotes cannot bear. Staggers every symbiote (hosted or wild) nearby;
 * sneak-use it on yourself to tear your own symbiote off.
 */
public class SonicEmitterItem extends Item {
    private static final double RADIUS = 9.0;

    public SonicEmitterItem(Properties properties) {
        super(properties);
    }

    @Override
    public InteractionResultHolder<ItemStack> use(Level level, Player user, InteractionHand hand) {
        ItemStack stack = user.getItemInHand(hand);
        if (level.isClientSide) return InteractionResultHolder.success(stack);
        level.playSound(null, user.getX(), user.getY() + 1, user.getZ(), ModRegistry.SND_SONIC.get(), SoundSource.PLAYERS, 1.5F, 1.0F);
        Net.fx(user, Net.Fx.SONIC, user.position().add(0, user.getBbHeight() * 0.6, 0));
        for (LivingEntity e : level.getEntitiesOfClass(LivingEntity.class, user.getBoundingBox().inflate(RADIUS), LivingEntity::isAlive)) {
            if (e.distanceTo(user) > RADIUS) continue;
            if (e instanceof WildSymbiote symbiote) {
                symbiote.stun(160);
                symbiote.hurt(user.damageSources().magic(), 3.0F);
            } else if (e instanceof ServerPlayer player) {
                SymbioteData d = SymbioteLogic.data(player);
                if (!d.bonded) continue;
                if (player == user && user.isShiftKeyDown()) {
                    SymbioteLogic.unbond(player, true);
                } else if (d.form != SymbioteForm.HUMAN || player != user) {
                    player.hurt(user.damageSources().magic(), 2.0F);
                    SymbioteLogic.weaken(player, 200);
                }
            }
        }
        user.getCooldowns().addCooldown(this, 80);
        stack.hurtAndBreak(1, user, LivingEntity.getSlotForHand(hand));
        return InteractionResultHolder.consume(stack);
    }

    @Override
    public void appendHoverText(ItemStack stack, TooltipContext context, List<Component> tooltip, TooltipFlag flag) {
        tooltip.add(Component.translatable("item.venom.sonic_emitter.desc").withStyle(ChatFormatting.DARK_GRAY, ChatFormatting.ITALIC));
        tooltip.add(Component.translatable("item.venom.sonic_emitter.desc2").withStyle(ChatFormatting.DARK_GRAY, ChatFormatting.ITALIC));
    }
}
