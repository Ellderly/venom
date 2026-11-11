package dev.ellderly.venom.client;

import dev.ellderly.venom.core.ModRegistry;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.util.Mth;
import net.minecraft.world.phys.Vec3;
import net.neoforged.neoforge.client.event.ComputeFovModifierEvent;
import net.neoforged.neoforge.client.event.ViewportEvent;

/** Camera feel: shake, speed FOV, a slight lean while wall crawling. */
public final class ClientFx {
    private ClientFx() {}

    public static float shake;
    public static int bondTicks;
    private static float fovBoost, fovBoostO;
    private static float roll, rollO;

    public static void shake(float amount) {
        shake = Math.max(shake, amount);
    }

    public static void tick(Minecraft mc) {
        shake *= 0.86F;
        if (shake < 0.01F) shake = 0;
        if (bondTicks > 0) bondTicks--;
        LocalPlayer p = mc.player;
        fovBoostO = fovBoost;
        rollO = roll;
        float fovTarget = 0, rollTarget = 0;
        if (p != null) {
            boolean fast = LocalMovement.state.swinging() || LocalMovement.state.gliding() || LocalMovement.ballistic;
            if (fast) fovTarget = (float) Math.min(0.22, Math.max(0.0, p.getDeltaMovement().length() - 0.35) * 0.16);
            if (LocalMovement.state.clinging() && LocalMovement.state.normal().getAxis().isHorizontal()) {
                Vec3 n = new Vec3(LocalMovement.state.normal().getStepX(), 0, LocalMovement.state.normal().getStepZ());
                float yaw = p.getYRot() * Mth.DEG_TO_RAD;
                Vec3 right = new Vec3(-Mth.cos(yaw), 0, -Mth.sin(yaw));
                rollTarget = (float) (n.dot(right) * 9.0);
            } else if (LocalMovement.state.swinging()) {
                Vec3 v = p.getDeltaMovement();
                float yaw = p.getYRot() * Mth.DEG_TO_RAD;
                Vec3 right = new Vec3(-Mth.cos(yaw), 0, -Mth.sin(yaw));
                rollTarget = (float) Mth.clamp(v.dot(right) * 9.0, -10.0, 10.0);
            }
        }
        fovBoost += (fovTarget - fovBoost) * 0.15F;
        roll += (rollTarget - roll) * 0.18F;
    }

    public static void onFov(ComputeFovModifierEvent event) {
        float pt = Minecraft.getInstance().getTimer().getGameTimeDeltaPartialTick(true);
        float boost = Mth.lerp(pt, fovBoostO, fovBoost);
        if (boost > 0.001F) event.setNewFovModifier(event.getNewFovModifier() * (1.0F + boost));
    }

    public static void onCamera(ViewportEvent.ComputeCameraAngles event) {
        float pt = (float) event.getPartialTick();
        float r = Mth.lerp(pt, rollO, roll);
        if (Math.abs(r) > 0.01F) event.setRoll(event.getRoll() + r);
        if (shake > 0) {
            Minecraft mc = Minecraft.getInstance();
            float t = (mc.player != null ? mc.player.tickCount : 0) + pt;
            event.setPitch(event.getPitch() + Mth.sin(t * 2.9F) * shake * 1.6F);
            event.setYaw(event.getYaw() + Mth.sin(t * 3.7F + 1.3F) * shake * 1.2F);
            event.setRoll(event.getRoll() + Mth.sin(t * 4.3F + 0.4F) * shake * 1.8F);
        }
    }

    public static void shockwave(Vec3 pos, int count) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.level == null) return;
        for (int i = 0; i < count; i++) {
            mc.level.addParticle(ModRegistry.SHOCKWAVE.get(), true, pos.x, pos.y, pos.z, i * 3, 0, 0);
        }
    }
}
