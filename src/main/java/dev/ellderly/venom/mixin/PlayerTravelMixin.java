package dev.ellderly.venom.mixin;

import dev.ellderly.venom.core.MovementHooks;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.phys.Vec3;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Lets the symbiote's locomotion (wall crawling, tendril swinging, gliding) replace vanilla movement for a tick. */
@Mixin(Player.class)
public abstract class PlayerTravelMixin {
    @Inject(method = "travel", at = @At("HEAD"), cancellable = true)
    private void venom$travel(Vec3 travelVector, CallbackInfo ci) {
        if (MovementHooks.onTravel((Player) (Object) this, travelVector)) ci.cancel();
    }
}
