package dev.ellderly.venom;

import com.mojang.logging.LogUtils;
import dev.ellderly.venom.core.ModRegistry;
import dev.ellderly.venom.network.Net;
import net.minecraft.resources.ResourceLocation;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import org.slf4j.Logger;

@Mod(VenomMod.MODID)
public class VenomMod {
    public static final String MODID = "venom";
    public static final Logger LOGGER = LogUtils.getLogger();

    public VenomMod(IEventBus modBus) {
        ModRegistry.init(modBus);
        modBus.addListener(Net::register);
    }

    public static ResourceLocation id(String path) {
        return ResourceLocation.fromNamespaceAndPath(MODID, path);
    }
}
