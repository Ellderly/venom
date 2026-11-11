package dev.ellderly.venom.client.particle;

import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.particle.Particle;
import net.minecraft.client.particle.ParticleProvider;
import net.minecraft.client.particle.ParticleRenderType;
import net.minecraft.client.particle.SpriteSet;
import net.minecraft.client.particle.TextureSheetParticle;
import net.minecraft.core.particles.SimpleParticleType;

/** Expanding ring of displaced air for roars and sonic bursts. The x-speed parameter is used as a start delay in ticks. */
public class ShockwaveParticle extends TextureSheetParticle {
    private final int delay;

    protected ShockwaveParticle(ClientLevel level, double x, double y, double z, int delay, SpriteSet sprites) {
        super(level, x, y, z);
        this.delay = delay;
        this.lifetime = 14 + delay;
        this.gravity = 0;
        this.hasPhysics = false;
        this.quadSize = 0.3F;
        this.alpha = 0;
        this.pickSprite(sprites);
    }

    @Override
    public void tick() {
        this.xo = x;
        this.yo = y;
        this.zo = z;
        if (age++ >= lifetime) {
            remove();
            return;
        }
        if (age < delay) return;
        float t = (age - delay) / 14.0F;
        this.quadSize = 0.4F + 9.0F * (1 - (1 - t) * (1 - t));
        this.alpha = 0.75F * (1 - t);
    }

    @Override
    protected int getLightColor(float partialTick) {
        return 0xF000F0;
    }

    @Override
    public ParticleRenderType getRenderType() {
        return ParticleRenderType.PARTICLE_SHEET_TRANSLUCENT;
    }

    public record Provider(SpriteSet sprites) implements ParticleProvider<SimpleParticleType> {
        @Override
        public Particle createParticle(SimpleParticleType type, ClientLevel level, double x, double y, double z, double xd, double yd, double zd) {
            return new ShockwaveParticle(level, x, y, z, (int) xd, sprites);
        }
    }
}
