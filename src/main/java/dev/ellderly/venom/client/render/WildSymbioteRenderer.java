package dev.ellderly.venom.client.render;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import dev.ellderly.venom.VenomMod;
import dev.ellderly.venom.entity.WildSymbiote;
import net.minecraft.client.model.EntityModel;
import net.minecraft.client.model.geom.ModelPart;
import net.minecraft.client.renderer.RenderType;
import net.minecraft.client.renderer.entity.EntityRendererProvider;
import net.minecraft.client.renderer.entity.MobRenderer;
import net.minecraft.client.renderer.entity.layers.EyesLayer;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.util.Mth;

public class WildSymbioteRenderer extends MobRenderer<WildSymbiote, WildSymbioteRenderer.Model> {
    private static final ResourceLocation TEXTURE = VenomMod.id("textures/entity/symbiote.png");
    private static final RenderType EYES = RenderType.eyes(VenomMod.id("textures/entity/symbiote_eyes.png"));

    public WildSymbioteRenderer(EntityRendererProvider.Context context) {
        super(context, new Model(), 0.45F);
        addLayer(new EyesLayer<>(this) {
            @Override
            public RenderType renderType() {
                return EYES;
            }
        });
    }

    @Override
    public ResourceLocation getTextureLocation(WildSymbiote entity) {
        return TEXTURE;
    }

    @Override
    protected void scale(WildSymbiote entity, PoseStack poseStack, float partialTick) {
        if (entity.isStunned()) {
            float t = entity.tickCount + partialTick;
            poseStack.scale(1.15F + 0.05F * Mth.sin(t * 2.2F), 0.7F, 1.15F + 0.05F * Mth.cos(t * 2.6F));
        }
    }

    public static class Model extends EntityModel<WildSymbiote> {
        private final GeoModel geo = GeoModel.load("symbiote");
        private final ModelPart core = geo.part("core");
        private final ModelPart head = geo.part("head");
        private final ModelPart[][] pods = new ModelPart[5][3];
        private final ModelPart[][] feelers = new ModelPart[3][2];

        public Model() {
            for (int i = 0; i < 5; i++) for (int j = 0; j < 3; j++) pods[i][j] = geo.part("pod" + i + "_" + j);
            for (int i = 0; i < 3; i++) for (int j = 0; j < 2; j++) feelers[i][j] = geo.part("feel" + i + "_" + j);
        }

        @Override
        public void setupAnim(WildSymbiote entity, float limbSwing, float limbSwingAmount, float age, float netHeadYaw, float headPitch) {
            geo.resetPose();
            float amt = Math.min(1.0F, limbSwingAmount);
            core.yScale = 1.0F + 0.07F * Mth.sin(age * 0.22F);
            core.xScale = core.zScale = 1.0F - 0.03F * Mth.sin(age * 0.22F);
            head.yRot = netHeadYaw * Mth.DEG_TO_RAD * 0.6F;
            head.xRot = headPitch * Mth.DEG_TO_RAD * 0.6F;
            for (int i = 0; i < 5; i++) {
                float ph = limbSwing * 1.1F + i * 2.1F;
                float idle = age * 0.07F + i * 1.3F;
                pods[i][0].yRot += 0.45F * Mth.sin(ph) * amt + 0.08F * Mth.sin(idle);
                pods[i][0].xRot = 0.32F + 0.25F * Mth.cos(ph) * amt + 0.05F * Mth.cos(idle);
                pods[i][1].xRot = 0.5F - 0.3F * Mth.cos(ph) * amt;
                pods[i][1].yRot = 0.15F * Mth.sin(idle * 1.4F);
                pods[i][2].xRot = -0.55F + 0.2F * Mth.sin(ph + 1.0F) * amt;
            }
            for (int i = 0; i < 3; i++) {
                float ph = age * (0.12F + 0.02F * i) + i * 2.0F;
                feelers[i][0].xRot = 0.35F * Mth.sin(ph) + 0.4F * amt;
                feelers[i][0].zRot = 0.3F * Mth.cos(ph * 0.8F);
                feelers[i][1].xRot = 0.5F * Mth.sin(ph + 0.9F) + 0.3F * amt;
                feelers[i][1].zRot = 0.4F * Mth.cos(ph * 0.8F + 0.7F);
            }
        }

        @Override
        public void renderToBuffer(PoseStack poseStack, VertexConsumer buffer, int packedLight, int packedOverlay, int color) {
            geo.root.render(poseStack, buffer, packedLight, packedOverlay, color);
        }
    }
}
