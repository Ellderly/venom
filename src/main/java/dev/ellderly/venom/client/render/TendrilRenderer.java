package dev.ellderly.venom.client.render;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import dev.ellderly.venom.VenomMod;
import net.minecraft.client.renderer.MultiBufferSource;
import net.minecraft.client.renderer.RenderType;
import net.minecraft.client.renderer.texture.OverlayTexture;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.util.Mth;
import net.minecraft.world.phys.Vec3;
import org.joml.Vector3f;

/** Draws a living tendril as a textured tube along a sagging, wriggling curve. */
public final class TendrilRenderer {
    private TendrilRenderer() {}

    public static final ResourceLocation TEXTURE = VenomMod.id("textures/entity/tendril.png");
    private static final int SIDES = 7;

    /**
     * @param origin    world position the pose stack is currently centred on
     * @param extension 0..1 how far the tendril has shot out towards {@code to}
     * @param slack     0 = taut, 1 = hanging loose
     */
    public static void draw(PoseStack poseStack, MultiBufferSource buffers, Vec3 origin, Vec3 from, Vec3 to,
                            float extension, float slack, float time, float radius, int light) {
        if (extension <= 0.01F) return;
        Vec3 full = to.subtract(from);
        float len = (float) full.length();
        if (len < 0.05F) return;
        Vector3f a = new Vector3f((float) (from.x - origin.x), (float) (from.y - origin.y), (float) (from.z - origin.z));
        Vector3f dir = new Vector3f((float) full.x, (float) full.y, (float) full.z).div(len);
        // two axes perpendicular to the tendril
        Vector3f ref = Math.abs(dir.y) > 0.92F ? new Vector3f(1, 0, 0) : new Vector3f(0, 1, 0);
        Vector3f side = new Vector3f(dir).cross(ref).normalize();
        Vector3f up = new Vector3f(side).cross(dir).normalize();

        int segs = Mth.clamp((int) (len * extension * 1.6F) + 8, 8, 44);
        Vector3f[] pts = new Vector3f[segs + 1];
        float[] rad = new float[segs + 1];
        float wobble = (0.035F + 0.22F * slack) * Math.min(1.0F, len / 6.0F) + (1.0F - extension) * 0.25F;
        for (int i = 0; i <= segs; i++) {
            float t = i / (float) segs;
            float d = t * len * extension;
            float env = Mth.sin(t * Mth.PI);
            float w1 = Mth.sin(t * 9.0F + time * 0.55F) * wobble * env;
            float w2 = Mth.cos(t * 7.0F - time * 0.47F) * wobble * env;
            float sag = -env * slack * len * 0.16F;
            pts[i] = new Vector3f(a).add(new Vector3f(dir).mul(d)).add(new Vector3f(side).mul(w1)).add(new Vector3f(up).mul(w2)).add(0, sag, 0);
            float r = radius * (1.25F - 0.6F * t) + radius * 0.14F * Mth.sin(t * 34.0F - time * 0.5F);
            if (i >= segs - 1) r = radius * (extension >= 0.99F ? 1.5F : 0.8F); // the grip at the end
            rad[i] = r;
        }

        VertexConsumer vc = buffers.getBuffer(RenderType.entityCutoutNoCull(TEXTURE));
        PoseStack.Pose pose = poseStack.last();
        Vector3f[] ringA = new Vector3f[SIDES + 1], ringB = new Vector3f[SIDES + 1];
        Vector3f[] nrmA = new Vector3f[SIDES + 1], nrmB = new Vector3f[SIDES + 1];
        ring(pts, rad, 0, side, ringA, nrmA);
        float vScroll = -time * 0.02F;
        for (int i = 0; i < segs; i++) {
            ring(pts, rad, i + 1, side, ringB, nrmB);
            float v0 = i / (float) segs * len * extension * 0.45F + vScroll;
            float v1 = (i + 1) / (float) segs * len * extension * 0.45F + vScroll;
            for (int k = 0; k < SIDES; k++) {
                float u0 = k / (float) SIDES, u1 = (k + 1) / (float) SIDES;
                vertex(vc, pose, ringA[k], nrmA[k], u0, v0, light);
                vertex(vc, pose, ringA[k + 1], nrmA[k + 1], u1, v0, light);
                vertex(vc, pose, ringB[k + 1], nrmB[k + 1], u1, v1, light);
                vertex(vc, pose, ringB[k], nrmB[k], u0, v1, light);
            }
            Vector3f[] t1 = ringA;
            ringA = ringB;
            ringB = t1;
            Vector3f[] t2 = nrmA;
            nrmA = nrmB;
            nrmB = t2;
        }
    }

    private static void ring(Vector3f[] pts, float[] rad, int i, Vector3f sideHint, Vector3f[] out, Vector3f[] nrm) {
        Vector3f prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
        Vector3f tan = new Vector3f(next).sub(prev);
        if (tan.lengthSquared() < 1.0E-8F) tan.set(0, 1, 0);
        tan.normalize();
        Vector3f u = new Vector3f(tan).cross(sideHint);
        if (u.lengthSquared() < 1.0E-6F) u.set(tan.y, tan.z, tan.x).cross(tan);
        u.normalize();
        Vector3f w = new Vector3f(u).cross(tan).normalize();
        for (int k = 0; k <= SIDES; k++) {
            float ang = k / (float) SIDES * Mth.TWO_PI;
            Vector3f n = new Vector3f(u).mul(Mth.cos(ang)).add(new Vector3f(w).mul(Mth.sin(ang)));
            nrm[k] = n;
            out[k] = new Vector3f(n).mul(rad[i]).add(pts[i]);
        }
    }

    private static void vertex(VertexConsumer vc, PoseStack.Pose pose, Vector3f p, Vector3f n, float u, float v, int light) {
        vc.addVertex(pose, p.x, p.y, p.z).setColor(255, 255, 255, 255).setUv(u, v)
                .setOverlay(OverlayTexture.NO_OVERLAY).setLight(light).setNormal(pose, n.x, n.y, n.z);
    }
}
