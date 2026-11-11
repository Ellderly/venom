package dev.ellderly.venom.item;

import dev.ellderly.venom.core.ModRegistry;
import dev.ellderly.venom.entity.WildSymbiote;
import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.TooltipFlag;

import java.util.List;

/** Containment vessel: use it on a weakened or stunned wild symbiote to capture it. */
public class EmptyCanisterItem extends Item {
    public EmptyCanisterItem(Properties properties) {
        super(properties);
    }

    @Override
    public InteractionResult interactLivingEntity(ItemStack stack, Player player, LivingEntity target, InteractionHand hand) {
        if (!(target instanceof WildSymbiote symbiote) || !symbiote.isAlive()) return InteractionResult.PASS;
        if (player.level().isClientSide) return InteractionResult.SUCCESS;
        if (!symbiote.isCapturable()) {
            player.displayClientMessage(Component.translatable("message.venom.too_lively"), true);
            return InteractionResult.FAIL;
        }
        symbiote.discard();
        player.level().playSound(null, target.getX(), target.getY(), target.getZ(), SoundEvents.BOTTLE_FILL, SoundSource.PLAYERS, 1.0F, 0.6F);
        player.level().playSound(null, target.getX(), target.getY(), target.getZ(), ModRegistry.SND_SYMBIOTE_HURT.get(), SoundSource.HOSTILE, 1.0F, 1.2F);
        if (!player.getAbilities().instabuild) stack.shrink(1);
        player.getInventory().placeItemBackInInventory(new ItemStack(ModRegistry.SYMBIOTE_CANISTER.get()));
        if (player instanceof net.minecraft.server.level.ServerPlayer sp) dev.ellderly.venom.logic.Advance.grant(sp, "capture");
        return InteractionResult.SUCCESS;
    }

    @Override
    public void appendHoverText(ItemStack stack, TooltipContext context, List<Component> tooltip, TooltipFlag flag) {
        tooltip.add(Component.translatable("item.venom.empty_canister.desc").withStyle(ChatFormatting.DARK_GRAY, ChatFormatting.ITALIC));
    }
}
