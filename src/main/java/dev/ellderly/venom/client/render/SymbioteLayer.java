package dev.ellderly.venom.client.render;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import dev.ellderly.venom.VenomMod;
import dev.ellderly.venom.client.ClientAnim;
import dev.ellderly.venom.core.ModRegistry;
import dev.ellderly.venom.core.SymbioteData;
import dev.ellderly.venom.core.SymbioteForm;
import net.minecraft.client.model.PlayerModel;
import net.minecraft.client.model.geom.ModelPart;
import net.minecraft.client.model.geom.builders.CubeDeformation;
import net.minecraft.client.model.geom.builders.LayerDefinition;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.client.renderer.MultiBufferSource;
import net.minecraft.client.renderer.RenderType;
import net.minecraft.client.renderer.entity.LivingEntityRenderer;
import net.minecraft.client.renderer.entity.RenderLayerParent;
import net.minecraft.client.renderer.entity.layers.RenderLayer;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.util.FastColor;
import net.minecraft.util.Mth;
import org.joml.Quaternionf;
import org.joml.Vector3f;

/** Renders the symbiote on a player: veins, the suit, the full Venom body, and the creeping transformation between them. */
public class SymbioteLayer extends RenderLayer<AbstractClientPlayer, PlayerModel<AbstractClientPlayer>> {
    public static final int FRAMES = 12;
    public static final ResourceLocation SUIT = VenomMod.id("textures/entity/suit.png");
    public static final ResourceLocation SUIT_EYES = VenomMod.id("textures/entity/suit_eyes.png");
    public static final ResourceLocation VENOM = VenomMod.id("textures/entity/venom.png");
    public static final ResourceLocation VENOM_EYES = VenomMod.id("textures/entity/venom_eyes.png");
    public static final ResourceLocation VEINS = VenomMod.id("textures/entity/veins.png");
    public static final ResourceLocation MEMBRANE = VenomMod.id("textures/entity/membrane.png");
    private static final ResourceLocation[] SUIT_FRAMES = frames("suit");
    private static final ResourceLocation[] VENOM_FRAMES = frames("venom");
    private static final int FULL_BRIGHT = 0xF000F0;

    /** Shared between both skin-model renderers and the first-person arm renderer. */
    public static VenomModel venomModel;

    public final PlayerModel<AbstractClientPlayer> suit;
    private final PlayerModel<AbstractClientPlayer> veins;

    private static ResourceLocation[] frames(String name) {
        ResourceLocation[] out = new ResourceLocation[FRAMES - 1];
        for (int i = 1; i < FRAMES; i++) out[i - 1] = VenomMod.id(String.format("textures/entity/transition/%s_%02d.png", name, i));
        return out;
    }

    /** @return the dissolve frame for a coverage value, or null when nothing is covered yet. */
    public static ResourceLocation frame(boolean venom, float coverage) {
        int idx = (int) (coverage * FRAMES);
        if (idx <= 0) return null;
        if (idx >= FRAMES) return venom ? VENOM : SUIT;
        return (venom ? VENOM_FRAMES : SUIT_FRAMES)[idx - 1];
    }

    public SymbioteLayer(RenderLayerParent<AbstractClientPlayer, PlayerModel<AbstractClientPlayer>> parent, boolean slim) {
        super(parent);
        this.suit = bake(0.3F, slim);
        this.veins = bake(0.27F, slim);
        if (venomModel == null) venomModel = new VenomModel();
    }

    private static PlayerModel<AbstractClientPlayer> bake(float inflate, boolean slim) {
        PlayerModel<AbstractClientPlayer> model = new PlayerModel<>(
                LayerDefinition.create(PlayerModel.createMesh(new CubeDeformation(inflate), slim), 64, 64).bakeRoot(), slim);
        model.hat.visible = false;
        model.jacket.visible = false;
        model.leftSleeve.visible = false;
        model.rightSleeve.visible = false;
        model.leftPants.visible = false;
        model.rightPants.visible = false;
        return model;
    }

    @Override
    public void render(PoseStack poseStack, MultiBufferSource buffer, int light, AbstractClientPlayer player, float limbSwing,
                       float limbSwingAmount, float pt, float age, float netHeadYaw, float headPitch) {
        SymbioteData d = player.getData(ModRegistry.SYMBIOTE);
        if (!d.bonded || player.isInvisible() || player.isSpectator()) return;
        ClientAnim anim = ClientAnim.get(player);
        PlayerModel<AbstractClientPlayer> parent = getParentModel();
        int overlay = LivingEntityRenderer.getOverlayCoords(player, 0.0F);
        SymbioteForm upper = d.upper(), lower = d.lower();
        float cov = d.coverage(pt);

        float wVeins = d.weight(SymbioteForm.EMPOWERED, pt);
        if (wVeins > 0.01F) {
            parent.copyPropertiesTo(veins);
            float pulse = 0.8F + 0.2F * Mth.sin(age * 0.11F);
            int alpha = Mth.clamp((int) (255 * wVeins * pulse), 0, 255);
            veins.renderToBuffer(poseStack, buffer.getBuffer(RenderType.entityTranslucent(VEINS)), light, overlay,
                    FastColor.ARGB32.color(alpha, 255, 255, 255));
        }

        boolean suitLayer = upper == SymbioteForm.SUIT || (lower == SymbioteForm.SUIT && cov < 1.0F);
        if (suitLayer) {
            ResourceLocation tex = lower == SymbioteForm.SUIT ? SUIT : frame(false, cov);
            if (tex != null) {
                parent.copyPropertiesTo(suit);
                suit.renderToBuffer(poseStack, buffer.getBuffer(RenderType.entityCutoutNoCull(tex)), light, overlay, -1);
                if (tex == SUIT) suit.renderToBuffer(poseStack, buffer.getBuffer(RenderType.eyes(SUIT_EYES)), FULL_BRIGHT, overlay, -1);
            }
        }

        boolean venom = upper == SymbioteForm.VENOM;
        if (venom) {
            ResourceLocation tex = frame(true, cov);
            if (tex != null) {
                venomModel.setup(parent, anim, age, pt);
                venomModel.render(poseStack, buffer.getBuffer(RenderType.entityCutoutNoCull(tex)), light, overlay, -1);
                if (tex == VENOM) venomModel.render(poseStack, buffer.getBuffer(RenderType.eyes(VENOM_EYES)), FULL_BRIGHT, overlay, -1);
            }
        }

        float glide = Mth.lerp(pt, anim.glideO, anim.glide);
        if (glide > 0.2F && upper.atLeast(SymbioteForm.SUIT) && cov >= 1.0F) {
            VertexConsumer vc = buffer.getBuffer(RenderType.entityTranslucent(MEMBRANE));
            boolean big = venom;
            membrane(poseStack, vc, light, overlay, big ? venomModel.rightArm : parent.rightArm, big ? venomModel.rightLeg : parent.rightLeg, -1, big, glide);
            membrane(poseStack, vc, light, overlay, big ? venomModel.leftArm : parent.leftArm, big ? venomModel.leftLeg : parent.leftLeg, 1, big, glide);
        }
    }

    private static Vector3f onPart(ModelPart part, float x, float y, float z) {
        Vector3f v = new Vector3f(x, y, z);
        new Quaternionf().rotationZYX(part.zRot, part.yRot, part.xRot).transform(v);
        return v.add(part.x, part.y, part.z).div(16.0F);
    }

    /** Gliding membrane stretched between arm, flank and leg. */
    private static void membrane(PoseStack poseStack, VertexConsumer vc, int light, int overlay, ModelPart arm, ModelPart leg,
                                 int side, boolean big, float unfold) {
        Vector3f shoulder = new Vector3f(side * (big ? 6.0F : 4.2F), big ? 0.5F : 1.5F, 0.8F).div(16.0F);
        Vector3f hand = onPart(arm, side * (big ? 4.5F : 1.0F), big ? 12.5F : 9.5F, 0.0F);
        Vector3f ankle = onPart(leg, side * 0.6F, big ? 9.5F : 10.0F, 0.6F);
        Vector3f hip = new Vector3f(side * (big ? 4.6F : 3.8F), 11.5F, 0.8F).div(16.0F);
        hand = new Vector3f(shoulder).lerp(hand, unfold);
        PoseStack.Pose pose = poseStack.last();
        Vector3f n = new Vector3f(hand).sub(shoulder).cross(new Vector3f(hip).sub(shoulder));
        if (n.lengthSquared() < 1.0E-8F) return;
        n.normalize();
        if (n.z < 0) n.negate();
        int alpha = Mth.clamp((int) (255 * (unfold - 0.2F) / 0.6F), 0, 255);
        put(vc, pose, shoulder, 0, 0, n, light, overlay, alpha);
        put(vc, pose, hand, 0, 1, n, light, overlay, alpha);
        put(vc, pose, ankle, 1, 1, n, light, overlay, alpha);
        put(vc, pose, hip, 1, 0, n, light, overlay, alpha);
    }

    private static void put(VertexConsumer vc, PoseStack.Pose pose, Vector3f p, float u, float v, Vector3f n, int light, int overlay, int alpha) {
        vc.addVertex(pose, p.x, p.y, p.z).setColor(255, 255, 255, alpha).setUv(u, v).setOverlay(overlay).setLight(light).setNormal(pose, n.x, n.y, n.z);
    }
}
