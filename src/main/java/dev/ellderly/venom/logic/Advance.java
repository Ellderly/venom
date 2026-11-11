package dev.ellderly.venom.logic;

import dev.ellderly.venom.VenomMod;
import net.minecraft.advancements.AdvancementHolder;
import net.minecraft.advancements.AdvancementProgress;
import net.minecraft.server.level.ServerPlayer;

/** Grants the mod's advancements (they double as an in-game guide to what the symbiote can do). */
public final class Advance {
    private Advance() {}

    public static void grant(ServerPlayer player, String name) {
        if (player.getServer() == null) return;
        AdvancementHolder holder = player.getServer().getAdvancements().get(VenomMod.id(name));
        if (holder == null) return;
        AdvancementProgress progress = player.getAdvancements().getOrStartProgress(holder);
        if (progress.isDone()) return;
        for (String criterion : progress.getRemainingCriteria()) player.getAdvancements().award(holder, criterion);
    }
}
