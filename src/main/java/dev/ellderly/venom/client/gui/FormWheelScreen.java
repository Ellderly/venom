package dev.ellderly.venom.client.gui;

import com.mojang.blaze3d.systems.RenderSystem;
import com.mojang.blaze3d.vertex.BufferBuilder;
import com.mojang.blaze3d.vertex.BufferUploader;
import com.mojang.blaze3d.vertex.DefaultVertexFormat;
import com.mojang.blaze3d.vertex.Tesselator;
import com.mojang.blaze3d.vertex.VertexFormat;
import dev.ellderly.venom.client.Keys;
import dev.ellderly.venom.core.ModRegistry;
import dev.ellderly.venom.core.SymbioteData;
import dev.ellderly.venom.core.SymbioteForm;
import dev.ellderly.venom.network.Net;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.renderer.GameRenderer;
import net.minecraft.network.chat.Component;
import net.minecraft.util.Mth;
import net.neoforged.neoforge.network.PacketDistributor;
import org.joml.Matrix4f;

/** Radial menu for choosing a form: hold the key, point, release. */
public class FormWheelScreen extends Screen {
    private static final float INNER = 26.0F, OUTER = 82.0F;
    private int hovered = -1;
    private int openTicks;

    public FormWheelScreen() {
        super(Component.translatable("screen.venom.forms"));
    }

    @Override
    public boolean isPauseScreen() {
        return false;
    }

    @Override
    public void tick() {
        openTicks++;
        if (minecraft != null && minecraft.player != null && !minecraft.player.getData(ModRegistry.SYMBIOTE).bonded) onClose();
    }

    private int sectorAt(double mx, double my) {
        double dx = mx - width / 2.0, dy = my - height / 2.0;
        if (dx * dx + dy * dy < INNER * INNER * 0.5) return -1;
        // sector 0 is at the top, going clockwise
        double ang = Math.atan2(dx, -dy);
        if (ang < 0) ang += Math.PI * 2;
        int n = SymbioteForm.VALUES.length;
        return (int) Math.floor((ang + Math.PI / n) / (Math.PI * 2 / n)) % n;
    }

    @Override
    public void renderBackground(GuiGraphics g, int mouseX, int mouseY, float partialTick) {
        // keep the world visible: no blur, just a slight darkening
        g.fill(0, 0, width, height, 0x50000000);
    }

    @Override
    public void render(GuiGraphics g, int mouseX, int mouseY, float pt) {
        super.render(g, mouseX, mouseY, pt);
        if (minecraft == null || minecraft.player == null) return;
        SymbioteData d = minecraft.player.getData(ModRegistry.SYMBIOTE);
        hovered = sectorAt(mouseX, mouseY);
        float cx = width / 2.0F, cy = height / 2.0F;
        float open = Mth.clamp((openTicks + pt) / 4.0F, 0.0F, 1.0F);
        open = 1 - (1 - open) * (1 - open);
        int n = SymbioteForm.VALUES.length;
        float step = Mth.TWO_PI / n;

        for (int i = 0; i < n; i++) {
            boolean hov = i == hovered, cur = d.form.ordinal() == i;
            float a0 = i * step - step / 2 + 0.03F, a1 = i * step + step / 2 - 0.03F;
            float outer = (OUTER + (hov ? 8 : 0)) * open;
            int color = hov ? 0xE0F2F4FA : cur ? 0xD0303442 : 0xC00C0C12;
            sector(g, cx, cy, INNER * open, outer, a0, a1, color);
            if (cur) sector(g, cx, cy, outer, outer + 2.5F, a0, a1, 0xFFFFFFFF);
        }
        for (int i = 0; i < n; i++) {
            boolean hov = i == hovered;
            float mid = i * step;
            float r = (INNER + OUTER) / 2 * open + (hov ? 4 : 0);
            int ix = Math.round(cx + Mth.sin(mid) * r), iy = Math.round(cy - Mth.cos(mid) * r);
            RenderSystem.enableBlend();
            g.blit(Hud.FORMS, ix - 16, iy - 20, 32, 32, i * 32, 0, 32, 32, 128, 32);
            Component name = SymbioteForm.VALUES[i].displayName();
            g.drawString(font, name, ix - font.width(name) / 2, iy + 13, hov ? 0xFF101018 : 0xFFE6E8F0, !hov);
        }
        String bio = (int) d.biomass + "%";
        g.drawString(font, bio, Math.round(cx - font.width(bio) / 2.0F), Math.round(cy - 4), d.biomass < 15 ? 0xFFFF6060 : 0xFFFFFFFF, true);
        if (d.weakened > 0) {
            Component weak = Component.translatable("screen.venom.weakened");
            g.drawString(font, weak, Math.round(cx - font.width(weak) / 2.0F), Math.round(cy + OUTER + 16), 0xFFFF7070, true);
        } else if (hovered >= 0) {
            Component desc = Component.translatable("form.venom." + SymbioteForm.VALUES[hovered].id() + ".desc");
            g.drawString(font, desc, Math.round(cx - font.width(desc) / 2.0F), Math.round(cy + OUTER + 16), 0xFFC8CCDA, true);
        }
    }

    private static void sector(GuiGraphics g, float cx, float cy, float r0, float r1, float a0, float a1, int argb) {
        Matrix4f m = g.pose().last().pose();
        RenderSystem.enableBlend();
        RenderSystem.defaultBlendFunc();
        RenderSystem.setShader(GameRenderer::getPositionColorShader);
        BufferBuilder bb = Tesselator.getInstance().begin(VertexFormat.Mode.TRIANGLE_STRIP, DefaultVertexFormat.POSITION_COLOR);
        int steps = 24;
        for (int i = 0; i <= steps; i++) {
            float a = Mth.lerp(i / (float) steps, a0, a1);
            float sx = Mth.sin(a), sy = -Mth.cos(a);
            bb.addVertex(m, cx + sx * r1, cy + sy * r1, 0).setColor(argb);
            bb.addVertex(m, cx + sx * r0, cy + sy * r0, 0).setColor(argb);
        }
        BufferUploader.drawWithShader(bb.buildOrThrow());
    }

    private void choose() {
        if (hovered >= 0 && minecraft != null && minecraft.player != null
                && minecraft.player.getData(ModRegistry.SYMBIOTE).form.ordinal() != hovered) {
            PacketDistributor.sendToServer(new Net.RequestForm(hovered));
        }
        onClose();
    }

    @Override
    public boolean keyReleased(int keyCode, int scanCode, int modifiers) {
        if (Keys.FORM_MENU.matches(keyCode, scanCode)) {
            choose();
            return true;
        }
        return super.keyReleased(keyCode, scanCode, modifiers);
    }

    @Override
    public boolean mouseClicked(double mouseX, double mouseY, int button) {
        hovered = sectorAt(mouseX, mouseY);
        choose();
        return true;
    }
}
