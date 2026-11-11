package dev.ellderly.venom.client.render;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import dev.ellderly.venom.client.ClientAnim;
import net.minecraft.client.model.HumanoidModel;
import net.minecraft.client.model.geom.ModelPart;
import net.minecraft.util.Mth;

/** The full Venom body. Driven by the vanilla player animation, with its own jaw, tongue and writhing tendrils on top. */
public final class VenomModel {
    private static final int WISPS = 5;

    private final GeoModel geo = GeoModel.load("venom");
    public final ModelPart head = geo.part("head");
    public final ModelPart jaw = geo.part("jaw");
    public final ModelPart body = geo.part("body");
    public final ModelPart rightArm = geo.part("right_arm");
    public final ModelPart leftArm = geo.part("left_arm");
    public final ModelPart rightLeg = geo.part("right_leg");
    public final ModelPart leftLeg = geo.part("left_leg");
    private final ModelPart[] tongue = new ModelPart[5];
    private final ModelPart[][] wisps = new ModelPart[WISPS][3];

    public VenomModel() {
        for (int i = 0; i < tongue.length; i++) tongue[i] = geo.part("tongue" + i);
        for (int i = 0; i < WISPS; i++) {
            for (int j = 0; j < 3; j++) wisps[i][j] = geo.part("wisp" + i + "_" + j);
        }
    }

    private static void follow(ModelPart mine, ModelPart theirs) {
        mine.x = theirs.x;
        mine.y = theirs.y;
        mine.z = theirs.z;
        mine.xRot = theirs.xRot;
        mine.yRot = theirs.yRot;
        mine.zRot = theirs.zRot;
    }

    public void setup(HumanoidModel<?> parent, ClientAnim anim, float age, float pt) {
        geo.resetPose();
        follow(head, parent.head);
        follow(body, parent.body);
        follow(rightArm, parent.rightArm);
        follow(leftArm, parent.leftArm);
        follow(rightLeg, parent.rightLeg);
        follow(leftLeg, parent.leftLeg);

        float cling = Mth.lerp(pt, anim.clingO, anim.cling);
        float glide = Mth.lerp(pt, anim.glideO, anim.glide);
        float upright = (1.0F - cling) * (1.0F - glide);
        float breath = Mth.sin(age * 0.085F);

        // hulking, slightly hunched stance
        body.xRot += 0.11F * upright;
        head.z -= 1.3F * upright;
        head.y += 0.5F * upright;
        rightArm.z -= 0.9F * upright;
        leftArm.z -= 0.9F * upright;
        rightArm.zRot += 0.17F * upright;
        leftArm.zRot -= 0.17F * upright;
        rightArm.y += 0.4F;
        leftArm.y += 0.4F;
        body.zScale = 1.0F + 0.025F * breath;
        body.xScale = 1.0F + 0.01F * breath;

        // jaw + tongue
        float open = Mth.lerp(pt, anim.jawO, anim.jaw);
        float roar = Mth.lerp(pt, anim.roarO, anim.roar);
        jaw.xRot = 0.03F + 0.025F * breath + open * 0.92F + roar * 0.06F * Mth.sin(age * 2.6F);
        head.xRot -= roar * 0.32F;
        float ext = Mth.clamp((open - 0.12F) / 0.5F, 0.0F, 1.0F);
        ext = ext * ext * (3 - 2 * ext);
        tongue[0].visible = ext > 0.02F;
        tongue[0].xScale = tongue[0].yScale = 0.4F + 0.6F * ext;
        tongue[0].zScale = Math.max(ext, 0.05F);
        for (int i = 0; i < tongue.length; i++) {
            float lash = 1.0F + roar * 1.5F;
            tongue[i].xRot = (i == 0 ? 0.3F : 0.12F) + 0.2F * Mth.sin(age * 0.33F * lash + i * 0.9F) * ext;
            tongue[i].yRot = 0.28F * Mth.sin(age * 0.26F * lash + i * 1.15F) * ext;
        }

        // living tendrils on the back
        for (int i = 0; i < WISPS; i++) {
            for (int j = 0; j < 3; j++) {
                ModelPart w = wisps[i][j];
                float ph = age * (0.09F + 0.012F * i) + i * 1.7F + j * 0.9F;
                w.xRot = (j == 0 ? 0.75F : 0.25F) + 0.32F * Mth.sin(ph) + roar * 0.25F;
                w.yRot = (j == 0 ? (i % 2 == 0 ? -0.35F : 0.35F) * (i == 4 ? 0 : 1) : 0.0F) + 0.34F * Mth.sin(ph * 0.83F + 1.3F);
            }
        }
    }

    public void render(PoseStack poseStack, VertexConsumer buffer, int light, int overlay, int color) {
        geo.root.render(poseStack, buffer, light, overlay, color);
    }
}
