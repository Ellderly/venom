package dev.ellderly.venom.core;

import net.minecraft.core.Direction;
import net.minecraft.util.Mth;
import net.minecraft.world.phys.Vec3;
import org.joml.Matrix3f;
import org.joml.Quaternionf;
import org.joml.Vector3f;

/** Orientation maths shared by the movement simulation and the renderer, so both always agree. */
public final class SurfaceMath {
    private SurfaceMath() {}

    public static Vec3 normal(Direction d) {
        return new Vec3(d.getStepX(), d.getStepY(), d.getStepZ());
    }

    /** Unit vector to the right of someone facing {@code yaw} (degrees). */
    public static Vec3 rightOf(float yaw) {
        float r = yaw * Mth.DEG_TO_RAD;
        return new Vec3(-Mth.cos(r), 0, -Mth.sin(r));
    }

    public static Vec3 forwardOf(float yaw) {
        float r = yaw * Mth.DEG_TO_RAD;
        return new Vec3(-Mth.sin(r), 0, Mth.cos(r));
    }

    /**
     * The direction "forward" means while clinging to a surface: the look vector laid onto the surface.
     * Looking straight at a wall means "up the wall".
     */
    public static Vec3 heading(Vec3 look, Direction normal, float yaw) {
        Vec3 n = normal(normal);
        if (normal.getAxis() == Direction.Axis.Y) {
            Vec3 h = new Vec3(look.x, 0, look.z);
            if (h.lengthSqr() < 1.0E-4) h = forwardOf(yaw);
            return h.normalize();
        }
        double dot = look.dot(n);
        Vec3 f = look.subtract(n.scale(dot)).add(0, Math.max(0.0, -dot) * 1.4, 0);
        if (f.lengthSqr() < 1.0E-4) return new Vec3(0, 1, 0);
        return f.normalize();
    }

    /** Rotation taking model space (+Y up, +Z front) onto the given world-space up / front directions. */
    public static Quaternionf basis(Vec3 up, Vec3 front, Quaternionf dest) {
        Vector3f y = new Vector3f((float) up.x, (float) up.y, (float) up.z).normalize();
        Vector3f z = new Vector3f((float) front.x, (float) front.y, (float) front.z);
        z.sub(new Vector3f(y).mul(z.dot(y)));
        if (z.lengthSquared() < 1.0E-6F) z.set(y.y, y.z, y.x).cross(y);
        z.normalize();
        Vector3f x = new Vector3f(y).cross(z);
        return dest.setFromNormalized(new Matrix3f(x, y, z));
    }

    public static Quaternionf standing(float bodyYaw, Quaternionf dest) {
        return dest.rotationY(-bodyYaw * Mth.DEG_TO_RAD);
    }

    /** Body orientation while crawling: spine along the heading, belly against the surface. */
    public static Quaternionf clinging(Vec3 look, Direction normal, float yaw, Quaternionf dest) {
        return basis(heading(look, normal, yaw), normal(normal).scale(-1), dest);
    }

    /** Body orientation while gliding: spine along the look vector, belly down, banking into turns. */
    public static Quaternionf gliding(Vec3 look, float yaw, float bank, Quaternionf dest) {
        Vec3 right = rightOf(yaw);
        Vec3 belly = look.cross(right);
        basis(look, belly, dest);
        return dest.rotateY(bank);
    }
}
