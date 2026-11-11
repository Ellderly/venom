package dev.ellderly.venom.core;

import net.minecraft.world.entity.player.Player;
import net.minecraft.world.phys.Vec3;

/** Bridge between the {@code Player.travel} mixin (common code) and the client-only movement simulation. */
public final class MovementHooks {
    private MovementHooks() {}

    @FunctionalInterface
    public interface TravelHandler {
        /** @return true if the movement for this tick was fully handled and vanilla travel must be skipped. */
        boolean travel(Player player, Vec3 input);
    }

    public static volatile TravelHandler localHandler;

    public static boolean onTravel(Player player, Vec3 input) {
        TravelHandler h = localHandler;
        return h != null && player.level().isClientSide && player.isLocalPlayer() && h.travel(player, input);
    }
}
