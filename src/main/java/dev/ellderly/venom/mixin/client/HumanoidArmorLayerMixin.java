package dev.ellderly.venom.mixin.client;

import com.mojang.blaze3d.vertex.PoseStack;
import dev.ellderly.venom.client.render.PoseHooks;
import net.minecraft.client.renderer.MultiBufferSource;
import net.minecraft.client.renderer.entity.layers.HumanoidArmorLayer;
import net.minecraft.world.entity.LivingEntity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** The symbiote flows over whatever its host wears: armour is not drawn once the suit has covered it. */
@Mixin(HumanoidArmorLayer.class)
public abstract class HumanoidArmorLayerMixin {
    @Inject(method = "render(Lcom/mojang/blaze3d/vertex/PoseStack;Lnet/minecraft/client/renderer/MultiBufferSource;ILnet/minecraft/world/entity/LivingEntity;FFFFFF)V",
            at = @At("HEAD"), cancellable = true)
    private void venom$hideArmor(PoseStack poseStack, MultiBufferSource buffer, int packedLight, LivingEntity entity, float limbSwing,
                                 float limbSwingAmount, float partialTicks, float ageInTicks, float netHeadYaw, float headPitch, CallbackInfo ci) {
        if (PoseHooks.hidesArmor(entity)) ci.cancel();
    }
}
