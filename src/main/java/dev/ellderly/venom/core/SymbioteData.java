package dev.ellderly.venom.core;

import com.mojang.serialization.Codec;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import io.netty.buffer.ByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.util.Mth;

/** Everything the symbiote remembers about its host. Stored as a synced player attachment. */
public class SymbioteData {
    public static final float MAX_BIOMASS = 100.0F;

    public boolean bonded;
    public SymbioteForm form = SymbioteForm.HUMAN;
    /** Form we are morphing away from; equals {@link #form} when no transformation is running. */
    public SymbioteForm prevForm = SymbioteForm.HUMAN;
    /** Ticks left of the running transformation. */
    public int transition;
    public int transitionTotal;
    /** The symbiote's food reserve, 0..100. */
    public float biomass = 60.0F;
    public int roarCooldown;
    public int lashCooldown;
    public int devourCooldown;
    /** While &gt; 0 the symbiote is stunned (fire / sound) and cannot manifest. */
    public int weakened;

    public SymbioteData() {}

    private SymbioteData(boolean bonded, int form, float biomass, int weakened) {
        this.bonded = bonded;
        this.form = SymbioteForm.byId(form);
        this.prevForm = this.form;
        this.biomass = biomass;
        this.weakened = weakened;
    }

    public static final Codec<SymbioteData> CODEC = RecordCodecBuilder.create(i -> i.group(
            Codec.BOOL.fieldOf("bonded").forGetter(d -> d.bonded),
            Codec.INT.fieldOf("form").forGetter(d -> d.form.ordinal()),
            Codec.FLOAT.fieldOf("biomass").forGetter(d -> d.biomass),
            Codec.INT.optionalFieldOf("weakened", 0).forGetter(d -> d.weakened)
    ).apply(i, SymbioteData::new));

    public static final StreamCodec<ByteBuf, SymbioteData> STREAM_CODEC = StreamCodec.of((buf, d) -> {
        buf.writeBoolean(d.bonded);
        buf.writeByte(d.form.ordinal());
        buf.writeByte(d.prevForm.ordinal());
        buf.writeShort(d.transition);
        buf.writeShort(d.transitionTotal);
        buf.writeFloat(d.biomass);
        buf.writeShort(d.roarCooldown);
        buf.writeShort(d.lashCooldown);
        buf.writeShort(d.devourCooldown);
        buf.writeShort(d.weakened);
    }, buf -> {
        SymbioteData d = new SymbioteData();
        d.bonded = buf.readBoolean();
        d.form = SymbioteForm.byId(buf.readByte());
        d.prevForm = SymbioteForm.byId(buf.readByte());
        d.transition = buf.readShort();
        d.transitionTotal = buf.readShort();
        d.biomass = buf.readFloat();
        d.roarCooldown = buf.readShort();
        d.lashCooldown = buf.readShort();
        d.devourCooldown = buf.readShort();
        d.weakened = buf.readShort();
        return d;
    });

    public boolean isTransforming() {
        return transition > 0 && prevForm != form;
    }

    /** Active form for gameplay purposes (abilities unlock once the transformation has finished). */
    public SymbioteForm activeForm() {
        if (!bonded) return SymbioteForm.HUMAN;
        return isTransforming() && form.ordinal() > prevForm.ordinal() ? prevForm : form;
    }

    /** 0..1 progress of the running transformation. */
    public float progress(float partialTick) {
        if (!isTransforming() || transitionTotal <= 0) return 1.0F;
        return Mth.clamp(1.0F - (transition - partialTick) / transitionTotal, 0.0F, 1.0F);
    }

    /** How strongly a given form is currently "present" (cross-fades during a transformation). */
    public float weight(SymbioteForm f, float partialTick) {
        if (!bonded) return f == SymbioteForm.HUMAN ? 1.0F : 0.0F;
        if (!isTransforming()) return f == form ? 1.0F : 0.0F;
        float p = progress(partialTick);
        if (f == form) return p;
        if (f == prevForm) return 1.0F - p;
        return 0.0F;
    }

    public SymbioteForm lower() {
        return prevForm.ordinal() < form.ordinal() ? prevForm : form;
    }

    public SymbioteForm upper() {
        return prevForm.ordinal() < form.ordinal() ? form : prevForm;
    }

    /** How much of the body the {@link #upper()} form covers right now. */
    public float coverage(float partialTick) {
        if (!isTransforming()) return 1.0F;
        float p = progress(partialTick);
        return form.ordinal() > prevForm.ordinal() ? p : 1.0F - p;
    }

    /** Client-side prediction between server syncs. */
    public void clientTick() {
        if (transition > 0 && --transition == 0) prevForm = form;
        if (roarCooldown > 0) roarCooldown--;
        if (lashCooldown > 0) lashCooldown--;
        if (devourCooldown > 0) devourCooldown--;
        if (weakened > 0) weakened--;
    }
}
