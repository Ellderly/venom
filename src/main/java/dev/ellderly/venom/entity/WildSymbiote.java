package dev.ellderly.venom.entity;

import dev.ellderly.venom.core.ModRegistry;
import dev.ellderly.venom.logic.SymbioteLogic;
import net.minecraft.core.BlockPos;
import net.minecraft.network.syncher.EntityDataAccessor;
import net.minecraft.network.syncher.EntityDataSerializers;
import net.minecraft.network.syncher.SynchedEntityData;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvent;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.tags.DamageTypeTags;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.ai.attributes.AttributeSupplier;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.entity.ai.goal.FloatGoal;
import net.minecraft.world.entity.ai.goal.LeapAtTargetGoal;
import net.minecraft.world.entity.ai.goal.LookAtPlayerGoal;
import net.minecraft.world.entity.ai.goal.MeleeAttackGoal;
import net.minecraft.world.entity.ai.goal.RandomLookAroundGoal;
import net.minecraft.world.entity.ai.goal.WaterAvoidingRandomStrollGoal;
import net.minecraft.world.entity.ai.goal.target.HurtByTargetGoal;
import net.minecraft.world.entity.ai.goal.target.NearestAttackableTargetGoal;
import net.minecraft.world.entity.ai.navigation.PathNavigation;
import net.minecraft.world.entity.ai.navigation.WallClimberNavigation;
import net.minecraft.world.entity.monster.Monster;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.state.BlockState;

/**
 * A symbiote without a host: a fast, wall-climbing mass of living goo that hunts for someone to bond with.
 * It does not want to kill you. It wants <i>in</i>.
 */
public class WildSymbiote extends Monster {
    private static final EntityDataAccessor<Byte> FLAGS = SynchedEntityData.defineId(WildSymbiote.class, EntityDataSerializers.BYTE);
    private int stunTicks;

    public WildSymbiote(EntityType<? extends WildSymbiote> type, Level level) {
        super(type, level);
        this.xpReward = 8;
    }

    public static AttributeSupplier.Builder createAttributes() {
        return Monster.createMonsterAttributes()
                .add(Attributes.MAX_HEALTH, 18.0)
                .add(Attributes.MOVEMENT_SPEED, 0.36)
                .add(Attributes.ATTACK_DAMAGE, 3.0)
                .add(Attributes.FOLLOW_RANGE, 28.0)
                .add(Attributes.KNOCKBACK_RESISTANCE, 0.3);
    }

    @Override
    protected void defineSynchedData(SynchedEntityData.Builder builder) {
        super.defineSynchedData(builder);
        builder.define(FLAGS, (byte) 0);
    }

    @Override
    protected void registerGoals() {
        this.goalSelector.addGoal(0, new FloatGoal(this));
        this.goalSelector.addGoal(2, new LeapAtTargetGoal(this, 0.5F));
        this.goalSelector.addGoal(3, new MeleeAttackGoal(this, 1.25, true));
        this.goalSelector.addGoal(5, new WaterAvoidingRandomStrollGoal(this, 0.8));
        this.goalSelector.addGoal(6, new LookAtPlayerGoal(this, Player.class, 10.0F));
        this.goalSelector.addGoal(7, new RandomLookAroundGoal(this));
        this.targetSelector.addGoal(1, new HurtByTargetGoal(this));
        this.targetSelector.addGoal(2, new NearestAttackableTargetGoal<>(this, Player.class, 10, true, false,
                e -> e instanceof Player p && !SymbioteLogic.data(p).bonded));
    }

    @Override
    protected PathNavigation createNavigation(Level level) {
        return new WallClimberNavigation(this, level);
    }

    @Override
    public void tick() {
        super.tick();
        if (!this.level().isClientSide) {
            setFlag(1, this.horizontalCollision);
            if (stunTicks > 0 && --stunTicks == 0) setFlag(2, false);
        }
    }

    @Override
    protected void customServerAiStep() {
        if (stunTicks > 0) {
            this.getNavigation().stop();
            this.setTarget(null);
        }
        super.customServerAiStep();
    }

    @Override
    protected boolean isImmobile() {
        return super.isImmobile() || isStunned();
    }

    private void setFlag(int bit, boolean value) {
        byte b = this.entityData.get(FLAGS);
        byte n = (byte) (value ? b | bit : b & ~bit);
        if (n != b) this.entityData.set(FLAGS, n);
    }

    public boolean isClimbing() {
        return (this.entityData.get(FLAGS) & 1) != 0;
    }

    public boolean isStunned() {
        return (this.entityData.get(FLAGS) & 2) != 0;
    }

    public void stun(int ticks) {
        stunTicks = Math.max(stunTicks, ticks);
        setFlag(2, true);
    }

    public boolean isCapturable() {
        return isStunned() || getHealth() <= getMaxHealth() * 0.5F;
    }

    @Override
    public boolean onClimbable() {
        return isClimbing() && !isStunned();
    }

    @Override
    public boolean doHurtTarget(Entity target) {
        if (target instanceof ServerPlayer player && !SymbioteLogic.data(player).bonded && !player.isCreative()) {
            // found a host
            if (this.level() instanceof ServerLevel level) {
                level.sendParticles(ModRegistry.GOO.get(), getX(), getY() + 0.3, getZ(), 30, 0.3, 0.2, 0.3, 0.15);
            }
            SymbioteLogic.bond(player, true);
            this.discard();
            return true;
        }
        return super.doHurtTarget(target);
    }

    @Override
    public boolean hurt(DamageSource source, float amount) {
        if (source.is(DamageTypeTags.IS_FIRE)) amount *= 2.5F;
        return super.hurt(source, amount);
    }

    @Override
    public boolean causeFallDamage(float fallDistance, float multiplier, DamageSource source) {
        return false;
    }

    @Override
    public int getMaxSpawnClusterSize() {
        return 1;
    }

    @Override
    protected SoundEvent getAmbientSound() {
        return ModRegistry.SND_SYMBIOTE_AMBIENT.get();
    }

    @Override
    protected SoundEvent getHurtSound(DamageSource source) {
        return ModRegistry.SND_SYMBIOTE_HURT.get();
    }

    @Override
    protected SoundEvent getDeathSound() {
        return ModRegistry.SND_SYMBIOTE_DEATH.get();
    }

    @Override
    protected void playStepSound(BlockPos pos, BlockState state) {
        this.playSound(SoundEvents.SLIME_SQUISH_SMALL, 0.25F, 0.6F);
    }
}
