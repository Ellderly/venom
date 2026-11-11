package dev.ellderly.venom.client.render;

import dev.ellderly.venom.client.ClientAnim;
import dev.ellderly.venom.core.ModRegistry;
import dev.ellderly.venom.core.SymbioteData;
import dev.ellderly.venom.core.SymbioteForm;
import net.minecraft.client.model.HumanoidModel;
import net.minecraft.client.model.geom.ModelPart;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.util.Mth;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.phys.Vec3;

/** Called from mixins: layers the symbiote's body language on top of the vanilla player animation. */
public final class PoseHooks {
    private PoseHooks() {}

    public static boolean hidesArmor(LivingEntity entity) {
        if (!(entity instanceof AbstractClientPlayer player)) return false;
        SymbioteData d = player.getData(ModRegistry.SYMBIOTE);
        return d.bonded && d.upper().atLeast(SymbioteForm.SUIT) && d.coverage(0.0F) > 0.45F;
    }

    private static void rot(ModelPart part, float w, float x, float y, float z) {
        part.xRot = Mth.rotLerp(w, part.xRot * Mth.RAD_TO_DEG, x * Mth.RAD_TO_DEG) * Mth.DEG_TO_RAD;
        part.yRot = Mth.rotLerp(w, part.yRot * Mth.RAD_TO_DEG, y * Mth.RAD_TO_DEG) * Mth.DEG_TO_RAD;
        part.zRot = Mth.rotLerp(w, part.zRot * Mth.RAD_TO_DEG, z * Mth.RAD_TO_DEG) * Mth.DEG_TO_RAD;
    }

    public static void pose(HumanoidModel<?> model, LivingEntity entity, float age) {
        if (age == 0.0F || !(entity instanceof AbstractClientPlayer player)) return; // age 0 = first-person arm pass
        SymbioteData d = player.getData(ModRegistry.SYMBIOTE);
        if (!d.bonded) return;
        ClientAnim a = ClientAnim.get(player);
        float pt = Mth.clamp(age - player.tickCount, 0.0F, 1.0F);

        float cling = Mth.lerp(pt, a.clingO, a.cling);
        if (cling > 0.001F) {
            float ph = Mth.lerp(pt, a.crawlPhaseO, a.crawlPhase);
            float s = Mth.sin(ph), c = Mth.cos(ph);
            rot(model.rightArm, cling, -2.35F + 0.5F * s, 0.0F, -0.5F - 0.1F * c);
            rot(model.leftArm, cling, -2.35F - 0.5F * s, 0.0F, 0.5F + 0.1F * c);
            rot(model.rightLeg, cling, -0.85F - 0.5F * s, 0.0F, 0.42F);
            rot(model.leftLeg, cling, -0.85F + 0.5F * s, 0.0F, -0.42F);
            model.rightLeg.z = Mth.lerp(cling, model.rightLeg.z, -0.5F);
            model.leftLeg.z = Mth.lerp(cling, model.leftLeg.z, -0.5F);
        }

        float glide = Mth.lerp(pt, a.glideO, a.glide);
        if (glide > 0.001F) {
            float flutter = 0.04F * Mth.sin(age * 0.9F);
            rot(model.rightArm, glide, 0.12F, 0.0F, 1.32F + flutter);
            rot(model.leftArm, glide, 0.12F, 0.0F, -1.32F - flutter);
            rot(model.rightLeg, glide, 0.1F, 0.0F, 0.26F);
            rot(model.leftLeg, glide, 0.1F, 0.0F, -0.26F);
        }

        float swing = Mth.lerp(pt, a.swingO, a.swing);
        if (swing > 0.001F) {
            pointArm(model, player, a.anchorRight, a.anchor, swing, pt);
            ModelPart other = a.anchorRight ? model.leftArm : model.rightArm;
            rot(other, swing * 0.8F, 0.55F, 0.0F, a.anchorRight ? -0.25F : 0.25F);
            float sway = 0.12F * Mth.sin(age * 0.2F);
            rot(model.rightLeg, swing * 0.8F, 0.4F + sway, 0.0F, 0.08F);
            rot(model.leftLeg, swing * 0.8F, -0.3F - sway, 0.0F, -0.08F);
        }

        float lash = a.lashExtension(pt);
        if (lash > 0.001F) pointArm(model, player, a.lashRight, a.lashTarget, Math.min(1.0F, lash * 1.6F), pt);

        float roar = Mth.lerp(pt, a.roarO, a.roar);
        if (roar > 0.001F) {
            float shake = 0.05F * Mth.sin(age * 2.4F);
            rot(model.rightArm, roar, 0.55F + shake, 0.0F, 0.75F);
            rot(model.leftArm, roar, 0.55F - shake, 0.0F, -0.75F);
            model.head.xRot -= 0.3F * roar;
            model.body.xRot -= 0.12F * roar;
        }

        if (a.leapTicks > 0 && cling < 0.5F && glide < 0.5F) {
            float w = Mth.clamp((a.leapTicks - pt) / 10.0F, 0.0F, 1.0F);
            rot(model.rightArm, w, 0.9F, 0.0F, 0.3F);
            rot(model.leftArm, w, 0.9F, 0.0F, -0.3F);
            rot(model.rightLeg, w, 0.5F, 0.0F, 0.05F);
            rot(model.leftLeg, w, -0.4F, 0.0F, -0.05F);
        }
        model.hat.copyFrom(model.head);
    }

    /** Aims an arm at a world position (same convention vanilla uses for bows: yaw via yRot, elevation via xRot). */
    private static void pointArm(HumanoidModel<?> model, AbstractClientPlayer player, boolean right, Vec3 target, float w, float pt) {
        Vec3 shoulder = player.getPosition(pt).add(0, player.getBbHeight() * 0.75, 0);
        Vec3 dir = target.subtract(shoulder);
        double horiz = Math.sqrt(dir.x * dir.x + dir.z * dir.z);
        float elevation = (float) Math.atan2(dir.y, horiz);
        float bodyYaw = Mth.rotLerp(pt, player.yBodyRotO, player.yBodyRot);
        float yawTo = (float) (Mth.atan2(-dir.x, dir.z) * Mth.RAD_TO_DEG);
        float rel = Mth.clamp(Mth.wrapDegrees(yawTo - bodyYaw), -100.0F, 100.0F) * Mth.DEG_TO_RAD;
        ModelPart arm = right ? model.rightArm : model.leftArm;
        rot(arm, w, -Mth.HALF_PI - elevation, rel, 0.0F);
    }
}
