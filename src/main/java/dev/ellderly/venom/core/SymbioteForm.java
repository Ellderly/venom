package dev.ellderly.venom.core;

import net.minecraft.network.chat.Component;

/**
 * How far the symbiote has taken over its host.
 * <ul>
 *     <li>{@link #HUMAN} – dormant, the host looks and plays like a normal player.</li>
 *     <li>{@link #EMPOWERED} – still human on the outside, but the symbiote lends its strength.</li>
 *     <li>{@link #SUIT} – the symbiote covers the host as a living suit.</li>
 *     <li>{@link #VENOM} – full transformation.</li>
 * </ul>
 */
public enum SymbioteForm {
    HUMAN("human"),
    EMPOWERED("empowered"),
    SUIT("suit"),
    VENOM("venom");

    public static final SymbioteForm[] VALUES = values();

    private final String id;

    SymbioteForm(String id) {
        this.id = id;
    }

    public String id() {
        return id;
    }

    public boolean atLeast(SymbioteForm other) {
        return ordinal() >= other.ordinal();
    }

    public Component displayName() {
        return Component.translatable("form.venom." + id);
    }

    public static SymbioteForm byId(int i) {
        return VALUES[Math.floorMod(i, VALUES.length)];
    }

    public static SymbioteForm byName(String name) {
        for (SymbioteForm f : VALUES) {
            if (f.id.equals(name)) return f;
        }
        return HUMAN;
    }

    // ---- balance -------------------------------------------------------------------------------------------------

    /** Biomass drained per second just for holding this form. */
    public float upkeep() {
        return switch (this) {
            case HUMAN -> 0.0F;
            case EMPOWERED -> 0.04F;
            case SUIT -> 0.09F;
            case VENOM -> 0.18F;
        };
    }

    /** Crawl speed on walls and ceilings, blocks per tick. */
    public double crawlSpeed() {
        return switch (this) {
            case HUMAN -> 0.0;
            case EMPOWERED -> 0.13;
            case SUIT -> 0.19;
            case VENOM -> 0.22;
        };
    }

    /** Maximum reach of the swinging tendril, blocks. */
    public double tendrilRange() {
        return switch (this) {
            case HUMAN -> 0.0;
            case EMPOWERED -> 28.0;
            case SUIT -> 44.0;
            case VENOM -> 56.0;
        };
    }

    public boolean canCrawl() {
        return atLeast(EMPOWERED);
    }

    public boolean canSwing() {
        return atLeast(EMPOWERED);
    }

    public boolean canGlide() {
        return atLeast(SUIT);
    }

    public boolean canLash() {
        return atLeast(EMPOWERED);
    }

    public boolean canRoar() {
        return atLeast(SUIT);
    }

    public boolean canDevour() {
        return this == VENOM;
    }
}
