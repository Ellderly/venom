package dev.ellderly.venom.client.gui;

import com.mojang.blaze3d.systems.RenderSystem;
import dev.ellderly.venom.VenomMod;
import dev.ellderly.venom.client.ClientFx;
import dev.ellderly.venom.client.Keys;
import dev.ellderly.venom.client.LocalMovement;
import dev.ellderly.venom.core.ModRegistry;
import dev.ellderly.venom.core.SymbioteData;
import dev.ellderly.venom.core.SymbioteForm;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.resources.language.I18n;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.util.Mth;

/** Symbiote HUD: form + biomass, ability cooldowns, screen-edge goo and the voice in your head. */
public final class Hud {
    private Hud() {}

    public static final ResourceLocation FORMS = VenomMod.id("textures/gui/forms.png");
    public static final ResourceLocation ABILITIES = VenomMod.id("textures/gui/abilities.png");
    private static final ResourceLocation VIGNETTE = VenomMod.id("textures/gui/vignette.png");
    private static final ResourceLocation VEINS = VenomMod.id("textures/gui/veins_overlay.png");

    private static String whisperText = "";
    private static int whisperAge = 1000;
    private static final int WHISPER_TIME = 120;
    private static float vignette, vignetteO;

    public static void whisper(String key) {
        whisperText = I18n.get(key);
        whisperAge = 0;
    }

    public static void tick(Minecraft mc) {
        if (whisperAge < 1000) whisperAge++;
        vignetteO = vignette;
        float target = 0;
        if (mc.player != null) {
            SymbioteData d = mc.player.getData(ModRegistry.SYMBIOTE);
            if (d.bonded) target = 0.34F * d.weight(SymbioteForm.VENOM, 0) + 0.16F * d.weight(SymbioteForm.SUIT, 0);
        }
        vignette += (target - vignette) * 0.1F;
    }

    private static void fullscreen(GuiGraphics g, ResourceLocation tex, float alpha) {
        if (alpha <= 0.01F) return;
        RenderSystem.enableBlend();
        RenderSystem.defaultBlendFunc();
        g.setColor(1, 1, 1, Math.min(alpha, 1.0F));
        g.blit(tex, 0, 0, g.guiWidth(), g.guiHeight(), 0, 0, 256, 256, 256, 256);
        g.setColor(1, 1, 1, 1);
    }

    /** Drawn underneath the rest of the GUI. */
    public static void renderOverlay(GuiGraphics g, DeltaTracker delta) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.player == null || mc.options.hideGui) return;
        SymbioteData d = mc.player.getData(ModRegistry.SYMBIOTE);
        if (!d.bonded) return;
        float pt = delta.getGameTimeDeltaPartialTick(true);
        fullscreen(g, VIGNETTE, Mth.lerp(pt, vignetteO, vignette));
        float veins = 0;
        if (d.isTransforming()) veins = Mth.sin(d.progress(pt) * Mth.PI) * 0.85F;
        if (d.weakened > 0) veins = Math.max(veins, 0.45F + 0.3F * Mth.sin((mc.player.tickCount + pt) * 0.5F));
        if (ClientFx.bondTicks > 0) veins = Math.max(veins, Math.min(1.0F, ClientFx.bondTicks / 40.0F));
        if (d.form != SymbioteForm.HUMAN && d.biomass < 15.0F) veins = Math.max(veins, 0.25F + 0.15F * Mth.sin((mc.player.tickCount + pt) * 0.2F));
        fullscreen(g, VEINS, veins);
    }

    public static void renderHud(GuiGraphics g, DeltaTracker delta) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.player == null || mc.options.hideGui || mc.player.isSpectator()) return;
        SymbioteData d = mc.player.getData(ModRegistry.SYMBIOTE);
        float pt = delta.getGameTimeDeltaPartialTick(true);
        Font font = mc.font;
        int w = g.guiWidth(), h = g.guiHeight();

        if (whisperAge < WHISPER_TIME && !whisperText.isEmpty()) {
            float age = whisperAge + pt;
            float alpha = Mth.clamp(Math.min(age / 8.0F, (WHISPER_TIME - age) / 25.0F), 0.0F, 1.0F);
            int shown = Mth.clamp((int) (age * 1.4F), 0, whisperText.length());
            String text = whisperText.substring(0, shown);
            int a = (int) (alpha * 255);
            if (a > 8) {
                int tw = font.width(whisperText);
                int x = (w - tw) / 2;
                int y = h - 78;
                float jx = Mth.sin(age * 0.9F) * 0.6F, jy = Mth.cos(age * 1.3F) * 0.6F;
                g.pose().pushPose();
                g.pose().translate(jx, jy, 0);
                g.drawString(font, "§o" + text, x + 1, y + 1, (a / 2) << 24, false);
                g.drawString(font, "§o" + text, x, y, (a << 24) | 0xEDEFF7, false);
                g.pose().popPose();
            }
        }
        if (!d.bonded) return;

        int x = 6, y = h - 34;
        SymbioteForm form = d.form;
        // form icon
        RenderSystem.enableBlend();
        g.fill(x - 2, y - 2, x + 106, y + 28, 0x66000000);
        g.blit(FORMS, x, y, 24, 24, form.ordinal() * 32, 0, 32, 32, 128, 32);
        if (d.isTransforming()) {
            g.setColor(1, 1, 1, 1.0F - d.progress(pt));
            g.blit(FORMS, x, y, 24, 24, d.prevForm.ordinal() * 32, 0, 32, 32, 128, 32);
            g.setColor(1, 1, 1, 1);
        }
        net.minecraft.network.chat.Component name = form.displayName();
        float fit = Math.min(1.0F, 74.0F / Math.max(1, font.width(name)));
        g.pose().pushPose();
        g.pose().translate(x + 28, y + (1.0F - fit) * 4.0F, 0);
        g.pose().scale(fit, fit, 1.0F);
        g.drawString(font, name, 0, 0, d.weakened > 0 ? 0xFF7070 : 0xFFFFFF, true);
        g.pose().popPose();

        // biomass bar
        int bx = x + 28, by = y + 11, bw = 74, bh = 5;
        g.fill(bx - 1, by - 1, bx + bw + 1, by + bh + 1, 0xFF000000);
        g.fill(bx, by, bx + bw, by + bh, 0xFF15151C);
        int fill = Math.round(bw * Mth.clamp(d.biomass / SymbioteData.MAX_BIOMASS, 0, 1));
        boolean low = d.biomass < 15.0F;
        int top = low ? 0xFFE04848 : 0xFFE9ECF6, bottom = low ? 0xFF8A1E1E : 0xFF8C92AA;
        if (fill > 0) g.fillGradient(bx, by, bx + fill, by + bh, top, bottom);

        // abilities
        int ax = bx, ay = y + 18;
        SymbioteForm active = d.activeForm();
        ax = ability(g, font, ax, ay, 1, active.canLash(), d.lashCooldown, 30, Keys.LASH);
        ax = ability(g, font, ax, ay, 4, active.canRoar(), d.roarCooldown, 320, Keys.ROAR);
        ax = ability(g, font, ax, ay, 5, active.canDevour(), d.devourCooldown, 50, Keys.DEVOUR);
        ax = ability(g, font, ax, ay, 2, active.canCrawl() && LocalMovement.crawlMode, LocalMovement.state.clinging() ? 1 : 0, 0, Keys.CRAWL);
        ax = ability(g, font, ax, ay, 0, active.canSwing(), LocalMovement.state.swinging() ? 1 : 0, 0, Keys.SWING);
        ability(g, font, ax, ay, 3, active.canGlide(), LocalMovement.state.gliding() ? 1 : 0, 0, null);

        // leap charge under the crosshair
        if (LocalMovement.leapCharge > 0.0F) {
            int cw = 40, cx = (w - cw) / 2, cy = h / 2 + 14;
            g.fill(cx - 1, cy - 1, cx + cw + 1, cy + 3, 0xAA000000);
            g.fill(cx, cy, cx + Math.round(cw * LocalMovement.leapCharge), cy + 2, LocalMovement.leapCharge >= 1.0F ? 0xFFFFFFFF : 0xFFB8BED2);
        }
    }

    /** @param cooldown remaining cooldown, or (when max is 0) a flag: 1 = currently in use */
    private static int ability(GuiGraphics g, Font font, int x, int y, int icon, boolean available, int cooldown, int max, KeyMapping key) {
        float c = available ? 1.0F : 0.3F;
        boolean activeNow = max == 0 && cooldown > 0;
        RenderSystem.enableBlend();
        if (activeNow) g.fill(x - 1, y - 1, x + 11, y + 11, 0x88FFFFFF);
        g.setColor(c, c, c, available ? 1.0F : 0.6F);
        if (activeNow) g.setColor(0.05F, 0.05F, 0.08F, 1.0F);
        g.blit(ABILITIES, x, y, 10, 10, icon * 24, 0, 24, 24, 144, 24);
        g.setColor(1, 1, 1, 1);
        if (max > 0 && cooldown > 0) {
            int hh = Math.round(10 * Mth.clamp(cooldown / (float) max, 0, 1));
            g.fill(x, y + 10 - hh, x + 10, y + 10, 0xAA000000);
        }
        return x + 13;
    }
}
