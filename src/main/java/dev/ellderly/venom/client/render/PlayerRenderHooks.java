package dev.ellderly.venom.client.render;

import com.mojang.blaze3d.vertex.PoseStack;
import dev.ellderly.venom.client.ClientAnim;
import dev.ellderly.venom.core.ModRegistry;
import dev.ellderly.venom.core.MoveState;
import dev.ellderly.venom.core.SurfaceMath;
import dev.ellderly.venom.core.SymbioteData;
import dev.ellderly.venom.core.SymbioteForm;
import net.minecraft.client.Camera;
import net.minecraft.client.Minecraft;
import net.minecraft.client.model.PlayerModel;
import net.minecraft.client.model.geom.ModelPart;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.client.renderer.LevelRenderer;
import net.minecraft.client.renderer.MultiBufferSource;
import net.minecraft.client.renderer.RenderType;
import net.minecraft.client.renderer.entity.EntityRenderer;
import net.minecraft.client.renderer.entity.player.PlayerRenderer;
import net.minecraft.client.renderer.texture.OverlayTexture;
import net.minecraft.core.BlockPos;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.util.Mth;
import net.minecraft.world.entity.HumanoidArm;
import net.minecraft.world.phys.Vec3;
import net.neoforged.neoforge.client.event.RenderArmEvent;
import net.neoforged.neoforge.client.event.RenderLevelStageEvent;
import net.neoforged.neoforge.client.event.RenderPlayerEvent;
import org.joml.Quaternionf;
import org.joml.Vector3f;

/** Render-thread event handlers for players. */
public final class PlayerRenderHooks {
    private PlayerRenderHooks() {}

    // ---------------------------------------------------------------------------------------- body orientation + skin

    public static void onPre(RenderPlayerEvent.Pre event) {
        if (!(event.getEntity() instanceof AbstractClientPlayer player)) return;
        SymbioteData d = player.getData(ModRegistry.SYMBIOTE);
        if (!d.bonded || player.isSpectator()) return;
        float pt = event.getPartialTick();
        PlayerModel<AbstractClientPlayer> model = event.getRenderer().getModel();

        // the symbiote replaces the host's skin
        SymbioteForm lower = d.lower(), upper = d.upper();
        float cov = d.coverage(pt);
        if (lower.atLeast(SymbioteForm.SUIT) || (upper.atLeast(SymbioteForm.SUIT) && cov >= 1.0F)) {
            model.setAllVisible(false);
        } else if (upper.atLeast(SymbioteForm.SUIT) && cov > 0.0F) {
            model.hat.visible = false;
            model.jacket.visible = false;
            model.leftSleeve.visible = false;
            model.rightSleeve.visible = false;
            model.leftPants.visible = false;
            model.rightPants.visible = false;
        }

        ClientAnim a = ClientAnim.get(player);
        float w = Mth.lerp(pt, a.weightO, a.weight);
        if (w <= 0.001F) return;

        // Take over the whole body rotation: vanilla gets a neutral yaw and we apply the full orientation ourselves.
        float bodyYaw = Mth.rotLerp(pt, player.yBodyRotO, player.yBodyRot);
        float headYaw = Mth.rotLerp(pt, player.yHeadRotO, player.yHeadRot);
        float pitch = Mth.lerp(pt, player.xRotO, player.getXRot());
        Quaternionf special = new Quaternionf(a.orientO).slerp(a.orient, pt);
        Quaternionf q = SurfaceMath.standing(bodyYaw, new Quaternionf()).slerp(special, w);

        // where the head should look, expressed in the rotated body's frame
        Vec3 look = player.getViewVector(pt);
        Vector3f local = new Quaternionf(q).conjugate().transform(new Vector3f((float) look.x, (float) look.y, (float) look.z));
        float localYaw = Mth.clamp((float) (Mth.atan2(-local.x, local.z) * Mth.RAD_TO_DEG), -75.0F, 75.0F);
        float localPitch = Mth.clamp((float) (-Math.asin(Mth.clamp(local.y, -1.0F, 1.0F)) * Mth.RAD_TO_DEG), -85.0F, 70.0F);
        float relYaw = Mth.wrapDegrees(headYaw - bodyYaw);

        a.sBodyRot = player.yBodyRot;
        a.sBodyRotO = player.yBodyRotO;
        a.sHeadRot = player.yHeadRot;
        a.sHeadRotO = player.yHeadRotO;
        a.sXRot = player.getXRot();
        a.sXRotO = player.xRotO;
        a.pushed = true;

        player.yBodyRot = player.yBodyRotO = 0.0F;
        player.yHeadRot = player.yHeadRotO = Mth.lerp(w, relYaw, localYaw);
        float xr = Mth.lerp(w, pitch, localPitch);
        player.setXRot(xr);
        player.xRotO = xr;

        Vec3 shift = a.shiftO.lerp(a.shift, pt).scale(w);
        float standCenter = 0.93F * player.getScale();
        float center = Mth.lerp(w, standCenter, Mth.lerp(pt, a.centerYO, a.centerY));
        PoseStack ps = event.getPoseStack();
        ps.pushPose();
        ps.translate(shift.x, center + shift.y, shift.z);
        ps.mulPose(q);
        ps.translate(0.0F, -standCenter, 0.0F);
    }

    public static void onPost(RenderPlayerEvent.Post event) {
        if (!(event.getEntity() instanceof AbstractClientPlayer player)) return;
        ClientAnim a = ClientAnim.get(player);
        if (!a.pushed) return;
        a.pushed = false;
        event.getPoseStack().popPose();
        player.yBodyRot = a.sBodyRot;
        player.yBodyRotO = a.sBodyRotO;
        player.yHeadRot = a.sHeadRot;
        player.yHeadRotO = a.sHeadRotO;
        player.setXRot(a.sXRot);
        player.xRotO = a.sXRotO;
    }

    // ---------------------------------------------------------------------------------------- first-person arm

    public static void onArm(RenderArmEvent event) {
        AbstractClientPlayer player = event.getPlayer();
        SymbioteData d = player.getData(ModRegistry.SYMBIOTE);
        if (!d.bonded) return;
        Minecraft mc = Minecraft.getInstance();
        float pt = mc.getTimer().getGameTimeDeltaPartialTick(true);
        SymbioteForm upper = d.upper(), lower = d.lower();
        float cov = d.coverage(pt);
        EntityRenderer<?> er = mc.getEntityRenderDispatcher().getRenderer(player);
        if (!(er instanceof PlayerRenderer renderer)) return;
        PlayerModel<AbstractClientPlayer> model = renderer.getModel();
        boolean right = event.getArm() == HumanoidArm.RIGHT;
        PoseStack ps = event.getPoseStack();
        MultiBufferSource buffers = event.getMultiBufferSource();
        int light = event.getPackedLight();

        boolean skinHidden = lower.atLeast(SymbioteForm.SUIT) || (upper.atLeast(SymbioteForm.SUIT) && cov >= 1.0F);
        boolean any = false;

        model.attackTime = 0.0F;
        model.crouching = false;
        model.swimAmount = 0.0F;
        model.setupAnim(player, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F);
        ModelPart vanillaArm = right ? model.rightArm : model.leftArm;
        vanillaArm.xRot = 0.0F;

        if (upper == SymbioteForm.SUIT || lower == SymbioteForm.SUIT) {
            ResourceLocation tex = lower == SymbioteForm.SUIT ? SymbioteLayer.SUIT : SymbioteLayer.frame(false, cov);
            SymbioteLayer layer = layerOf(renderer);
            if (tex != null && layer != null && !(upper == SymbioteForm.VENOM && cov >= 1.0F)) {
                ModelPart arm = right ? layer.suit.rightArm : layer.suit.leftArm;
                arm.copyFrom(vanillaArm);
                arm.visible = true;
                arm.render(ps, buffers.getBuffer(RenderType.entityCutoutNoCull(tex)), light, OverlayTexture.NO_OVERLAY);
                any = true;
            }
        }
        if (upper == SymbioteForm.VENOM && SymbioteLayer.venomModel != null) {
            ResourceLocation tex = SymbioteLayer.frame(true, cov);
            if (tex != null) {
                VenomModel vm = SymbioteLayer.venomModel;
                ModelPart arm = right ? vm.rightArm : vm.leftArm;
                arm.resetPose();
                arm.x = vanillaArm.x + (right ? 1.2F : -1.2F);
                arm.y = vanillaArm.y + 0.5F;
                arm.z = vanillaArm.z;
                arm.xRot = 0.0F;
                arm.zRot = vanillaArm.zRot;
                arm.yRot = vanillaArm.yRot;
                arm.render(ps, buffers.getBuffer(RenderType.entityCutoutNoCull(tex)), light, OverlayTexture.NO_OVERLAY);
                any = true;
            }
        }
        if (skinHidden && any) event.setCanceled(true);
    }

    private static SymbioteLayer layerOf(PlayerRenderer renderer) {
        return LAYERS.get(renderer);
    }

    public static final java.util.Map<PlayerRenderer, SymbioteLayer> LAYERS = new java.util.WeakHashMap<>();

    // ---------------------------------------------------------------------------------------- tendrils in the world

    public static Vec3 handPos(AbstractClientPlayer p, boolean right, float pt, Vec3 target) {
        Minecraft mc = Minecraft.getInstance();
        if (p == mc.getCameraEntity() && mc.options.getCameraType().isFirstPerson()) {
            Camera cam = mc.gameRenderer.getMainCamera();
            Vector3f l = cam.getLookVector(), u = cam.getUpVector(), left = cam.getLeftVector();
            float s = right ? -0.42F : 0.42F;
            return cam.getPosition().add(l.x * 0.5F + u.x * -0.36F + left.x * s, l.y * 0.5F + u.y * -0.36F + left.y * s, l.z * 0.5F + u.z * -0.36F + left.z * s);
        }
        float scale = p.getScale();
        float yaw = Mth.rotLerp(pt, p.yBodyRotO, p.yBodyRot);
        Vec3 shoulder = p.getPosition(pt).add(SurfaceMath.rightOf(yaw).scale((right ? 0.36 : -0.36) * scale)).add(0, p.getBbHeight() * 0.76, 0);
        Vec3 d = target.subtract(shoulder);
        double len = d.length();
        return len < 1.0E-3 ? shoulder : shoulder.add(d.scale(Math.min(len, 0.62 * scale) / len));
    }

    public static void onLevelStage(RenderLevelStageEvent event) {
        if (event.getStage() != RenderLevelStageEvent.Stage.AFTER_ENTITIES) return;
        Minecraft mc = Minecraft.getInstance();
        if (mc.level == null) return;
        float pt = event.getPartialTick().getGameTimeDeltaPartialTick(true);
        Vec3 cam = event.getCamera().getPosition();
        MultiBufferSource.BufferSource buffers = mc.renderBuffers().bufferSource();
        PoseStack ps = event.getPoseStack();
        boolean drew = false;
        for (AbstractClientPlayer p : mc.level.players()) {
            SymbioteData d = p.getData(ModRegistry.SYMBIOTE);
            if (!d.bonded || p.isInvisible() || p.distanceToSqr(cam) > 160 * 160) continue;
            ClientAnim a = ClientAnim.get(p);
            MoveState ms = ClientAnim.stateOf(p);
            float time = p.tickCount + pt;
            float radius = 0.05F * (0.85F + 0.15F * d.activeForm().ordinal()) * (0.8F + 0.2F * p.getScale());
            if (ms.swinging() || a.retractTicks > 0) {
                Vec3 anchor = a.anchor;
                Vec3 hand = handPos(p, a.anchorRight, pt, anchor);
                float ext = ms.swinging() ? Mth.clamp((a.tendrilAge + pt) / 3.0F, 0.0F, 1.0F) : Mth.clamp((a.retractTicks - pt) / 5.0F, 0.0F, 1.0F);
                double rope = p == mc.player ? dev.ellderly.venom.client.LocalMovement.ropeLength : hand.distanceTo(anchor);
                float slack = (float) Mth.clamp((rope - hand.distanceTo(anchor)) / Math.max(rope, 1.0) * 2.5, 0.0, 1.0);
                TendrilRenderer.draw(ps, buffers, cam, hand, anchor, ext, ms.swinging() ? slack : 0.6F, time, radius, light(mc, hand));
                drew = true;
            }
            float lash = a.lashExtension(pt);
            if (lash > 0.0F) {
                Vec3 hand = handPos(p, a.lashRight, pt, a.lashTarget);
                TendrilRenderer.draw(ps, buffers, cam, hand, a.lashTarget, lash, 0.25F, time, radius * 1.15F, light(mc, hand));
                drew = true;
            }
        }
        if (drew) buffers.endBatch(RenderType.entityCutoutNoCull(TendrilRenderer.TEXTURE));
    }

    private static int light(Minecraft mc, Vec3 pos) {
        return LevelRenderer.getLightColor(mc.level, BlockPos.containing(pos));
    }
}
