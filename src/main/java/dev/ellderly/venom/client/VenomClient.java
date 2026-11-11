package dev.ellderly.venom.client;

import dev.ellderly.venom.VenomMod;
import dev.ellderly.venom.client.gui.FormWheelScreen;
import dev.ellderly.venom.client.gui.Hud;
import dev.ellderly.venom.client.particle.GooParticle;
import dev.ellderly.venom.client.particle.ShockwaveParticle;
import dev.ellderly.venom.client.render.PlayerRenderHooks;
import dev.ellderly.venom.client.render.SymbioteLayer;
import dev.ellderly.venom.client.render.WildSymbioteRenderer;
import dev.ellderly.venom.core.ModRegistry;
import dev.ellderly.venom.core.MovementHooks;
import dev.ellderly.venom.core.SymbioteData;
import dev.ellderly.venom.core.SymbioteForm;
import dev.ellderly.venom.network.Net;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.client.renderer.entity.EntityRenderer;
import net.minecraft.client.renderer.entity.player.PlayerRenderer;
import net.minecraft.client.resources.PlayerSkin;
import net.minecraft.world.entity.player.Player;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.EventPriority;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.client.event.ClientPlayerNetworkEvent;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.client.event.EntityRenderersEvent;
import net.neoforged.neoforge.client.event.RegisterGuiLayersEvent;
import net.neoforged.neoforge.client.event.RegisterParticleProvidersEvent;
import net.neoforged.neoforge.client.gui.VanillaGuiLayers;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.network.PacketDistributor;

@Mod(value = VenomMod.MODID, dist = Dist.CLIENT)
public class VenomClient {
    public VenomClient(IEventBus modBus) {
        modBus.addListener(Keys::register);
        modBus.addListener(VenomClient::addLayers);
        modBus.addListener(VenomClient::registerRenderers);
        modBus.addListener(VenomClient::registerParticles);
        modBus.addListener(VenomClient::registerGui);

        NeoForge.EVENT_BUS.addListener(VenomClient::tickPre);
        NeoForge.EVENT_BUS.addListener(VenomClient::tickPost);
        NeoForge.EVENT_BUS.addListener(EventPriority.LOWEST, PlayerRenderHooks::onPre);
        NeoForge.EVENT_BUS.addListener(EventPriority.HIGHEST, PlayerRenderHooks::onPost);
        NeoForge.EVENT_BUS.addListener(PlayerRenderHooks::onArm);
        NeoForge.EVENT_BUS.addListener(PlayerRenderHooks::onLevelStage);
        NeoForge.EVENT_BUS.addListener(ClientFx::onFov);
        NeoForge.EVENT_BUS.addListener(ClientFx::onCamera);
        NeoForge.EVENT_BUS.addListener((ClientPlayerNetworkEvent.LoggingOut e) -> LocalMovement.reset());
        NeoForge.EVENT_BUS.addListener((ClientPlayerNetworkEvent.Clone e) -> LocalMovement.reset());

        MovementHooks.localHandler = LocalMovement::travel;
    }

    private static void addLayers(EntityRenderersEvent.AddLayers event) {
        for (PlayerSkin.Model skin : event.getSkins()) {
            EntityRenderer<? extends Player> r = event.getSkin(skin);
            if (r instanceof PlayerRenderer renderer) {
                SymbioteLayer layer = new SymbioteLayer(renderer, skin == PlayerSkin.Model.SLIM);
                renderer.addLayer(layer);
                PlayerRenderHooks.LAYERS.put(renderer, layer);
            }
        }
    }

    private static void registerRenderers(EntityRenderersEvent.RegisterRenderers event) {
        event.registerEntityRenderer(ModRegistry.WILD_SYMBIOTE.get(), WildSymbioteRenderer::new);
    }

    private static void registerParticles(RegisterParticleProvidersEvent event) {
        event.registerSpriteSet(ModRegistry.GOO.get(), s -> new GooParticle.Provider(s, false));
        event.registerSpriteSet(ModRegistry.STRAND.get(), s -> new GooParticle.Provider(s, true));
        event.registerSpriteSet(ModRegistry.SHOCKWAVE.get(), ShockwaveParticle.Provider::new);
    }

    private static void registerGui(RegisterGuiLayersEvent event) {
        event.registerBelowAll(VenomMod.id("overlay"), Hud::renderOverlay);
        event.registerAbove(VanillaGuiLayers.HOTBAR, VenomMod.id("hud"), Hud::renderHud);
    }

    private static void tickPre(ClientTickEvent.Pre event) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.player == null || mc.level == null) {
            LocalMovement.reset();
            return;
        }
        if (mc.isPaused()) return;
        SymbioteData d = mc.player.getData(ModRegistry.SYMBIOTE);
        SymbioteForm active = d.activeForm();
        while (Keys.CRAWL.consumeClick()) if (d.bonded) LocalMovement.toggleCrawl(mc);
        while (Keys.LASH.consumeClick()) if (active.canLash() && d.lashCooldown <= 0) PacketDistributor.sendToServer(new Net.UseAbility(Net.UseAbility.LASH));
        while (Keys.ROAR.consumeClick()) if (active.canRoar() && d.roarCooldown <= 0) PacketDistributor.sendToServer(new Net.UseAbility(Net.UseAbility.ROAR));
        while (Keys.DEVOUR.consumeClick()) if (active.canDevour() && d.devourCooldown <= 0) PacketDistributor.sendToServer(new Net.UseAbility(Net.UseAbility.DEVOUR));
        while (Keys.FORM_UP.consumeClick()) if (d.bonded && d.form != SymbioteForm.VENOM) PacketDistributor.sendToServer(new Net.RequestForm(d.form.ordinal() + 1));
        while (Keys.FORM_DOWN.consumeClick()) if (d.bonded && d.form != SymbioteForm.HUMAN) PacketDistributor.sendToServer(new Net.RequestForm(d.form.ordinal() - 1));
        while (Keys.FORM_MENU.consumeClick()) if (d.bonded && mc.screen == null) mc.setScreen(new FormWheelScreen());
        LocalMovement.preTick(mc);
    }

    private static void tickPost(ClientTickEvent.Post event) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.player == null || mc.level == null || mc.isPaused()) return;
        LocalMovement.postTick(mc);
        ClientFx.tick(mc);
        Hud.tick(mc);
        for (AbstractClientPlayer p : mc.level.players()) {
            p.getData(ModRegistry.SYMBIOTE).clientTick();
            ClientAnim.get(p).tick(p);
        }
    }
}
