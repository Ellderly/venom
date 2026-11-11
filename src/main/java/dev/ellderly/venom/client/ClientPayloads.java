package dev.ellderly.venom.client;

import dev.ellderly.venom.client.gui.Hud;
import dev.ellderly.venom.core.ModRegistry;
import dev.ellderly.venom.network.Net;
import net.minecraft.client.Minecraft;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.phys.Vec3;

/** Handlers for server-to-client payloads. Only ever class-loaded on the physical client. */
public final class ClientPayloads {
    private ClientPayloads() {}

    public static void fx(Net.Fx p) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.level == null || mc.player == null) return;
        Entity e = mc.level.getEntity(p.entityId());
        if (e == null) return;
        ClientAnim anim = e instanceof Player player ? ClientAnim.get(player) : null;
        double dist = e.distanceTo(mc.player);
        Vec3 mid = e.position().add(0, e.getBbHeight() * 0.6, 0);
        switch (p.kind()) {
            case Net.Fx.ROAR -> {
                if (anim != null) anim.roarTicks = 46;
                ClientFx.shockwave(e.position().add(0, e.getBbHeight() * 0.8, 0), 3);
                if (dist < 20) ClientFx.shake((float) (1.6 * (1.0 - dist / 20.0)));
            }
            case Net.Fx.BITE -> {
                if (anim != null) anim.biteTicks = 11;
            }
            case Net.Fx.LASH -> {
                if (anim != null) anim.lash(p.pos(), !anim.lashRight);
            }
            case Net.Fx.LEAP -> {
                if (anim != null) anim.leapTicks = 10;
                for (int i = 0; i < 10; i++) {
                    mc.level.addParticle(ModRegistry.GOO.get(), e.getX() + (Math.random() - 0.5) * 0.6, e.getY() + 0.1, e.getZ() + (Math.random() - 0.5) * 0.6,
                            (Math.random() - 0.5) * 0.2, 0.05, (Math.random() - 0.5) * 0.2);
                }
            }
            case Net.Fx.SLAM -> {
                float power = (float) Math.min(1.0, p.pos().x / 30.0);
                if (dist < 16) ClientFx.shake((float) ((0.6 + 1.6 * power) * (1.0 - dist / 16.0)));
            }
            case Net.Fx.BOND -> {
                if (e == mc.player) {
                    ClientFx.bondTicks = 140;
                    ClientFx.shake(0.8F);
                }
            }
            case Net.Fx.SONIC -> {
                ClientFx.shockwave(p.pos(), 4);
                if (dist < 12) ClientFx.shake(0.5F);
            }
            default -> {}
        }
    }

    public static void whisper(Net.Whisper p) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.player == null) return;
        Hud.whisper(p.key());
        mc.level.playLocalSound(mc.player.getX(), mc.player.getY(), mc.player.getZ(), ModRegistry.SND_WHISPER.get(), SoundSource.PLAYERS, 0.5F, 0.6F, false);
    }
}
