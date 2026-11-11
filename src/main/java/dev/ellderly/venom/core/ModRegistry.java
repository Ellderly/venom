package dev.ellderly.venom.core;

import dev.ellderly.venom.VenomMod;
import dev.ellderly.venom.entity.WildSymbiote;
import dev.ellderly.venom.item.EmptyCanisterItem;
import dev.ellderly.venom.item.SonicEmitterItem;
import dev.ellderly.venom.item.SymbioteCanisterItem;
import net.minecraft.core.particles.ParticleType;
import net.minecraft.core.particles.SimpleParticleType;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.chat.Component;
import net.minecraft.sounds.SoundEvent;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.MobCategory;
import net.minecraft.world.entity.SpawnPlacementTypes;
import net.minecraft.world.entity.monster.Monster;
import net.minecraft.world.food.FoodProperties;
import net.minecraft.world.item.CreativeModeTab;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Rarity;
import net.minecraft.world.level.levelgen.Heightmap;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.attachment.AttachmentType;
import net.neoforged.neoforge.common.DeferredSpawnEggItem;
import net.neoforged.neoforge.event.entity.EntityAttributeCreationEvent;
import net.neoforged.neoforge.event.entity.RegisterSpawnPlacementsEvent;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredItem;
import net.neoforged.neoforge.registries.DeferredRegister;
import net.neoforged.neoforge.registries.NeoForgeRegistries;

import java.util.function.Supplier;

public final class ModRegistry {
    private ModRegistry() {}

    public static final DeferredRegister<AttachmentType<?>> ATTACHMENTS =
            DeferredRegister.create(NeoForgeRegistries.ATTACHMENT_TYPES, VenomMod.MODID);
    public static final DeferredRegister.Items ITEMS = DeferredRegister.createItems(VenomMod.MODID);
    public static final DeferredRegister<SoundEvent> SOUNDS = DeferredRegister.create(Registries.SOUND_EVENT, VenomMod.MODID);
    public static final DeferredRegister<ParticleType<?>> PARTICLES = DeferredRegister.create(Registries.PARTICLE_TYPE, VenomMod.MODID);
    public static final DeferredRegister<EntityType<?>> ENTITIES = DeferredRegister.create(Registries.ENTITY_TYPE, VenomMod.MODID);
    public static final DeferredRegister<CreativeModeTab> TABS = DeferredRegister.create(Registries.CREATIVE_MODE_TAB, VenomMod.MODID);

    // ---- attachments ----
    public static final Supplier<AttachmentType<SymbioteData>> SYMBIOTE = ATTACHMENTS.register("symbiote",
            () -> AttachmentType.builder(SymbioteData::new)
                    .serialize(SymbioteData.CODEC)
                    .copyOnDeath()
                    .sync(SymbioteData.STREAM_CODEC)
                    .build());

    /** Not saved; relayed to everyone except the player it belongs to (their client is the authority). */
    public static final Supplier<AttachmentType<MoveState>> MOVE = ATTACHMENTS.register("move",
            () -> AttachmentType.builder(() -> MoveState.IDLE)
                    .sync((holder, to) -> holder != to, MoveState.STREAM_CODEC)
                    .build());

    // ---- entities ----
    public static final DeferredHolder<EntityType<?>, EntityType<WildSymbiote>> WILD_SYMBIOTE = ENTITIES.register("symbiote",
            () -> EntityType.Builder.of(WildSymbiote::new, MobCategory.MONSTER)
                    .sized(0.8F, 0.45F).eyeHeight(0.3F).clientTrackingRange(8)
                    .build("symbiote"));

    // ---- items ----
    public static final DeferredItem<Item> SYMBIOTE_CANISTER = ITEMS.register("symbiote_canister",
            () -> new SymbioteCanisterItem(new Item.Properties().stacksTo(1).rarity(Rarity.EPIC)));
    public static final DeferredItem<Item> EMPTY_CANISTER = ITEMS.register("empty_canister",
            () -> new EmptyCanisterItem(new Item.Properties().stacksTo(16)));
    public static final DeferredItem<Item> SONIC_EMITTER = ITEMS.register("sonic_emitter",
            () -> new SonicEmitterItem(new Item.Properties().durability(24).rarity(Rarity.UNCOMMON)));
    public static final DeferredItem<Item> CHOCOLATE_BAR = ITEMS.register("chocolate_bar",
            () -> new Item(new Item.Properties().food(new FoodProperties.Builder().nutrition(4).saturationModifier(0.6F).fast().alwaysEdible().build())));
    public static final DeferredItem<Item> SYMBIOTE_SPAWN_EGG = ITEMS.register("symbiote_spawn_egg",
            () -> new DeferredSpawnEggItem(WILD_SYMBIOTE, 0x0B0B10, 0xE8ECF5, new Item.Properties()));

    // ---- sounds ----
    public static final DeferredHolder<SoundEvent, SoundEvent> SND_TRANSFORM = sound("transform");
    public static final DeferredHolder<SoundEvent, SoundEvent> SND_RECEDE = sound("recede");
    public static final DeferredHolder<SoundEvent, SoundEvent> SND_ROAR = sound("roar");
    public static final DeferredHolder<SoundEvent, SoundEvent> SND_GROWL = sound("growl");
    public static final DeferredHolder<SoundEvent, SoundEvent> SND_TENDRIL_SHOOT = sound("tendril_shoot");
    public static final DeferredHolder<SoundEvent, SoundEvent> SND_TENDRIL_HIT = sound("tendril_hit");
    public static final DeferredHolder<SoundEvent, SoundEvent> SND_BITE = sound("bite");
    public static final DeferredHolder<SoundEvent, SoundEvent> SND_WHISPER = sound("whisper");
    public static final DeferredHolder<SoundEvent, SoundEvent> SND_SCREAM = sound("scream");
    public static final DeferredHolder<SoundEvent, SoundEvent> SND_BOND = sound("bond");
    public static final DeferredHolder<SoundEvent, SoundEvent> SND_SLAM = sound("slam");
    public static final DeferredHolder<SoundEvent, SoundEvent> SND_LEAP = sound("leap");
    public static final DeferredHolder<SoundEvent, SoundEvent> SND_CRAWL = sound("crawl");
    public static final DeferredHolder<SoundEvent, SoundEvent> SND_GLIDE = sound("glide");
    public static final DeferredHolder<SoundEvent, SoundEvent> SND_SONIC = sound("sonic");
    public static final DeferredHolder<SoundEvent, SoundEvent> SND_SYMBIOTE_AMBIENT = sound("symbiote_ambient");
    public static final DeferredHolder<SoundEvent, SoundEvent> SND_SYMBIOTE_HURT = sound("symbiote_hurt");
    public static final DeferredHolder<SoundEvent, SoundEvent> SND_SYMBIOTE_DEATH = sound("symbiote_death");

    // ---- particles ----
    public static final DeferredHolder<ParticleType<?>, SimpleParticleType> GOO = PARTICLES.register("goo", () -> new SimpleParticleType(false));
    public static final DeferredHolder<ParticleType<?>, SimpleParticleType> STRAND = PARTICLES.register("strand", () -> new SimpleParticleType(false));
    public static final DeferredHolder<ParticleType<?>, SimpleParticleType> SHOCKWAVE = PARTICLES.register("shockwave", () -> new SimpleParticleType(true));

    // ---- creative tab ----
    public static final Supplier<CreativeModeTab> TAB = TABS.register("venom", () -> CreativeModeTab.builder()
            .title(Component.translatable("itemGroup.venom"))
            .icon(() -> new ItemStack(SYMBIOTE_CANISTER.get()))
            .displayItems((params, out) -> {
                out.accept(SYMBIOTE_CANISTER.get());
                out.accept(EMPTY_CANISTER.get());
                out.accept(SONIC_EMITTER.get());
                out.accept(CHOCOLATE_BAR.get());
                out.accept(SYMBIOTE_SPAWN_EGG.get());
            })
            .build());

    private static DeferredHolder<SoundEvent, SoundEvent> sound(String name) {
        return SOUNDS.register(name, () -> SoundEvent.createVariableRangeEvent(VenomMod.id(name)));
    }

    public static void init(IEventBus modBus) {
        ATTACHMENTS.register(modBus);
        ITEMS.register(modBus);
        SOUNDS.register(modBus);
        PARTICLES.register(modBus);
        ENTITIES.register(modBus);
        TABS.register(modBus);
        modBus.addListener(ModRegistry::attributes);
        modBus.addListener(ModRegistry::spawnPlacements);
    }

    private static void attributes(EntityAttributeCreationEvent event) {
        event.put(WILD_SYMBIOTE.get(), WildSymbiote.createAttributes().build());
    }

    private static void spawnPlacements(RegisterSpawnPlacementsEvent event) {
        event.register(WILD_SYMBIOTE.get(), SpawnPlacementTypes.ON_GROUND, Heightmap.Types.MOTION_BLOCKING_NO_LEAVES,
                Monster::checkMonsterSpawnRules, RegisterSpawnPlacementsEvent.Operation.REPLACE);
    }
}
