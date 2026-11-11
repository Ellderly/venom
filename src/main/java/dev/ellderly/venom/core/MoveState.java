package dev.ellderly.venom.core;

import io.netty.buffer.ByteBuf;
import net.minecraft.core.Direction;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.world.phys.Vec3;

/**
 * The special locomotion a host is performing. Movement itself is simulated by the owning client (like all player
 * movement in Minecraft); this state is relayed so the server can validate / react and other clients can animate it.
 *
 * @param mode   one of the MODE_ constants
 * @param face   for {@link #CLING}: 3D data value of the surface normal direction (pointing away from the surface)
 * @param anchor for {@link #SWING}: where the tendril is attached
 * @param right  which hand the tendril comes from
 */
public record MoveState(byte mode, byte face, Vec3 anchor, boolean right) {
    public static final byte NONE = 0;
    public static final byte CLING = 1;
    public static final byte SWING = 2;
    public static final byte GLIDE = 3;

    public static final MoveState IDLE = new MoveState(NONE, (byte) 0, Vec3.ZERO, true);

    public static final StreamCodec<ByteBuf, MoveState> STREAM_CODEC = StreamCodec.of((buf, s) -> {
        buf.writeByte(s.mode);
        buf.writeByte(s.face);
        buf.writeBoolean(s.right);
        if (s.mode == SWING) {
            buf.writeDouble(s.anchor.x);
            buf.writeDouble(s.anchor.y);
            buf.writeDouble(s.anchor.z);
        }
    }, buf -> {
        byte mode = buf.readByte();
        byte face = buf.readByte();
        boolean right = buf.readBoolean();
        Vec3 anchor = mode == SWING ? new Vec3(buf.readDouble(), buf.readDouble(), buf.readDouble()) : Vec3.ZERO;
        return new MoveState(mode, face, anchor, right);
    });

    public static MoveState cling(Direction normal) {
        return new MoveState(CLING, (byte) normal.get3DDataValue(), Vec3.ZERO, true);
    }

    public static MoveState swing(Vec3 anchor, boolean right) {
        return new MoveState(SWING, (byte) 0, anchor, right);
    }

    public static MoveState glide() {
        return new MoveState(GLIDE, (byte) 0, Vec3.ZERO, true);
    }

    public boolean clinging() {
        return mode == CLING;
    }

    public boolean swinging() {
        return mode == SWING;
    }

    public boolean gliding() {
        return mode == GLIDE;
    }

    public Direction normal() {
        return Direction.from3DDataValue(face);
    }
}
