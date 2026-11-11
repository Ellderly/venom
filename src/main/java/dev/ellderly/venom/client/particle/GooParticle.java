package dev.ellderly.venom.client.particle;

import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.particle.Particle;
import net.minecraft.client.particle.ParticleProvider;
import net.minecraft.client.particle.ParticleRenderType;
import net.minecraft.client.particle.SpriteSet;
import net.minecraft.client.particle.TextureSheetParticle;
import net.minecraft.core.particles.SimpleParticleType;

/** A droplet of living goo: falls, splats, and soaks away. Also used (weightless) for wisps while transforming. */
public class GooParticle extends TextureSheetParticle {
    private final boolean strand;

    protected GooParticle(ClientLevel level, double x, double y, double z, double xd, double yd, double zd, SpriteSet sprites, boolean strand) {
        super(level, x, y, z);
        this.strand = strand;
        this.xd = xd + (random.nextDouble() - 0.5) * 0.02;
        this.yd = yd;
        this.zd = zd + (random.nextDouble() - 0.5) * 0.02;
        this.gravity = strand ? -0.02F : 0.85F;
        this.friction = strand ? 0.9F : 0.98F;
        this.lifetime = strand ? 10 + random.nextInt(8) : 24 + random.nextInt(22);
        this.quadSize = strand ? 0.12F + random.nextFloat() * 0.1F : 0.05F + random.nextFloat() * 0.08F;
        this.roll = this.oRoll = random.nextFloat() * 6.2832F;
        this.pickSprite(sprites);
    }

    @Override
    public void tick() {
        super.tick();
        float life = age / (float) lifetime;
        if (strand) {
            this.oRoll = this.roll;
            this.roll += 0.12F;
            this.alpha = 1.0F - life * life;
            this.quadSize *= 0.97F;
        } else if (onGround) {
            this.alpha = Math.max(0.0F, 1.0F - life) * 0.9F;
            this.quadSize *= 0.96F;
        }
    }

    @Override
    public ParticleRenderType getRenderType() {
        return ParticleRenderType.PARTICLE_SHEET_TRANSLUCENT;
    }

    public record Provider(SpriteSet sprites, boolean strand) implements ParticleProvider<SimpleParticleType> {
        @Override
        public Particle createParticle(SimpleParticleType type, ClientLevel level, double x, double y, double z, double xd, double yd, double zd) {
            return new GooParticle(level, x, y, z, xd, yd, zd, sprites, strand);
        }
    }
}
