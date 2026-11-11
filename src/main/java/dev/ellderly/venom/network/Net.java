package dev.ellderly.venom.network;

import dev.ellderly.venom.VenomMod;
import dev.ellderly.venom.core.MoveState;
import dev.ellderly.venom.logic.Abilities;
import dev.ellderly.venom.logic.SymbioteLogic;
import io.netty.buffer.ByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.phys.Vec3;
import net.neoforged.neoforge.network.PacketDistributor;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;
import net.neoforged.neoforge.network.registration.PayloadRegistrar;

public final class Net {
    private Net() {}

    // ---------------------------------------------------------------------------------------------------- payloads

    /** Client asks to morph into another form. */
    public record RequestForm(int form) implements CustomPacketPayload {
        public static final Type<RequestForm> TYPE = new Type<>(VenomMod.id("request_form"));
        public static final StreamCodec<ByteBuf, RequestForm> CODEC = ByteBufCodecs.VAR_INT.map(RequestForm::new, RequestForm::form);

        @Override
        public Type<RequestForm> type() {
            return TYPE;
        }
    }

    /** Client triggers an ability. */
    public record UseAbility(int ability) implements CustomPacketPayload {
        public static final int LASH = 0, ROAR = 1, DEVOUR = 2, LEAP = 3;
        public static final Type<UseAbility> TYPE = new Type<>(VenomMod.id("use_ability"));
        public static final StreamCodec<ByteBuf, UseAbility> CODEC = ByteBufCodecs.VAR_INT.map(UseAbility::new, UseAbility::ability);

        @Override
        public Type<UseAbility> type() {
            return TYPE;
        }
    }

    /** Client reports its special locomotion state. */
    public record MoveUpdate(MoveState state) implements CustomPacketPayload {
        public static final Type<MoveUpdate> TYPE = new Type<>(VenomMod.id("move"));
        public static final StreamCodec<ByteBuf, MoveUpdate> CODEC = MoveState.STREAM_CODEC.map(MoveUpdate::new, MoveUpdate::state);

        @Override
        public Type<MoveUpdate> type() {
            return TYPE;
        }
    }

    /** Server tells clients to play a one-shot animation / effect on an entity. */
    public record Fx(int entityId, int kind, Vec3 pos) implements CustomPacketPayload {
        public static final int ROAR = 0, BITE = 1, LASH = 2, LEAP = 3, SLAM = 4, TRANSFORM = 5, BOND = 6, SONIC = 7;
        public static final Type<Fx> TYPE = new Type<>(VenomMod.id("fx"));
        public static final StreamCodec<ByteBuf, Fx> CODEC = StreamCodec.of((buf, p) -> {
            ByteBufCodecs.VAR_INT.encode(buf, p.entityId);
            buf.writeByte(p.kind);
            buf.writeDouble(p.pos.x);
            buf.writeDouble(p.pos.y);
            buf.writeDouble(p.pos.z);
        }, buf -> new Fx(ByteBufCodecs.VAR_INT.decode(buf), buf.readByte(), new Vec3(buf.readDouble(), buf.readDouble(), buf.readDouble())));

        @Override
        public Type<Fx> type() {
            return TYPE;
        }
    }

    /** The symbiote speaks inside its host's head. */
    public record Whisper(String key) implements CustomPacketPayload {
        public static final Type<Whisper> TYPE = new Type<>(VenomMod.id("whisper"));
        public static final StreamCodec<ByteBuf, Whisper> CODEC = ByteBufCodecs.STRING_UTF8.map(Whisper::new, Whisper::key);

        @Override
        public Type<Whisper> type() {
            return TYPE;
        }
    }

    // ---------------------------------------------------------------------------------------------------- wiring

    public static void register(RegisterPayloadHandlersEvent event) {
        PayloadRegistrar r = event.registrar("1");
        r.playToServer(RequestForm.TYPE, RequestForm.CODEC, (p, ctx) -> {
            if (ctx.player() instanceof ServerPlayer sp) SymbioteLogic.requestForm(sp, p.form());
        });
        r.playToServer(UseAbility.TYPE, UseAbility.CODEC, (p, ctx) -> {
            if (ctx.player() instanceof ServerPlayer sp) Abilities.use(sp, p.ability());
        });
        r.playToServer(MoveUpdate.TYPE, MoveUpdate.CODEC, (p, ctx) -> {
            if (ctx.player() instanceof ServerPlayer sp) SymbioteLogic.onMoveUpdate(sp, p.state());
        });
        r.playToClient(Fx.TYPE, Fx.CODEC, (p, ctx) -> dev.ellderly.venom.client.ClientPayloads.fx(p));
        r.playToClient(Whisper.TYPE, Whisper.CODEC, (p, ctx) -> dev.ellderly.venom.client.ClientPayloads.whisper(p));
    }

    public static void fx(Entity entity, int kind, Vec3 pos) {
        PacketDistributor.sendToPlayersTrackingEntityAndSelf(entity, new Fx(entity.getId(), kind, pos));
    }

    public static void whisper(ServerPlayer player, String key) {
        PacketDistributor.sendToPlayer(player, new Whisper(key));
    }
}
