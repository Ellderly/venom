package dev.ellderly.venom.client.dev;

import dev.ellderly.venom.VenomMod;
import dev.ellderly.venom.client.Keys;
import dev.ellderly.venom.client.LocalMovement;
import dev.ellderly.venom.client.gui.FormWheelScreen;
import dev.ellderly.venom.core.ModRegistry;
import dev.ellderly.venom.network.Net;
import net.minecraft.client.CameraType;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.core.registries.Registries;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.Difficulty;
import net.minecraft.world.level.GameRules;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.LevelSettings;
import net.minecraft.world.level.WorldDataConfiguration;
import net.minecraft.world.level.levelgen.WorldOptions;
import net.minecraft.world.level.levelgen.presets.WorldPresets;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.network.PacketDistributor;

import java.util.ArrayList;
import java.util.List;

/**
 * Development-only smoke test (never shipped in the release jar): started with {@code -Dvenom.autotest=...}, it creates
 * a flat world, walks through every form and movement mode, saves screenshots and quits. Used to check the mod in a
 * real client without a human at the keyboard.
 */
public final class AutoTest {
    private AutoTest() {}

    private record Step(int at, Runnable action) {}

    private static final List<Step> STEPS = new ArrayList<>();
    private static boolean started;
    private static int tick;
    private static int cursor;
    private static int next;

    public static void init() {
        NeoForge.EVENT_BUS.addListener(AutoTest::onTick);
        NeoForge.EVENT_BUS.addListener((net.neoforged.neoforge.event.entity.living.LivingDamageEvent.Post e) -> {
            if (e.getEntity() instanceof net.minecraft.world.entity.player.Player)
                VenomMod.LOGGER.info("[autotest] player damaged {} by {}", e.getNewDamage(), e.getSource().getMsgId());
        });
        script(System.getProperty("venom.autotest", "all"));
    }

    private static Minecraft mc() {
        return Minecraft.getInstance();
    }

    private static void at(int delay, Runnable r) {
        next += delay;
        STEPS.add(new Step(next, r));
    }

    private static void cmd(String command) {
        MinecraftServer server = mc().getSingleplayerServer();
        if (server == null) return;
        server.execute(() -> {
            ServerPlayer sp = server.getPlayerList().getPlayers().isEmpty() ? null : server.getPlayerList().getPlayers().get(0);
            var source = sp != null ? sp.createCommandSourceStack().withPermission(4).withSuppressedOutput() : server.createCommandSourceStack();
            server.getCommands().performPrefixedCommand(source, command);
        });
    }

    private static void shot(String name) {
        Screenshot.grab(mc().gameDirectory, name + ".png", mc().getMainRenderTarget(), c -> VenomMod.LOGGER.info("[autotest] screenshot {}", name));
    }

    private static void keys(boolean fwd, boolean jump, boolean sneak, boolean swing) {
        mc().options.keyUp.setDown(fwd);
        mc().options.keyJump.setDown(jump);
        mc().options.keyShift.setDown(sneak);
        Keys.SWING.setDown(swing);
    }

    private static void look(float yaw, float pitch) {
        mc().player.setYRot(yaw);
        mc().player.setXRot(pitch);
        mc().player.yRotO = yaw;
        mc().player.xRotO = pitch;
    }

    private static void log(String what) {
        var p = mc().player;
        VenomMod.LOGGER.info("[autotest] {} pos=({}, {}, {}) state={} face={} vel={} ballistic={}", what,
                String.format("%.2f", p.getX()), String.format("%.2f", p.getY()), String.format("%.2f", p.getZ()),
                LocalMovement.state.mode(), LocalMovement.state.clinging() ? LocalMovement.state.normal() : "-",
                String.format("%.2f", p.getDeltaMovement().length()), LocalMovement.ballistic);
    }

    private static void data(String what) {
        var d = mc().player.getData(ModRegistry.SYMBIOTE);
        VenomMod.LOGGER.info("[autotest] {}: bonded={} form={} prev={} transition={} weakened={} biomass={} hp={}/{}", what, d.bonded, d.form, d.prevForm,
                d.transition, d.weakened, String.format("%.1f", d.biomass), String.format("%.1f", mc().player.getHealth()), String.format("%.1f", mc().player.getMaxHealth()));
    }

    private static void script(String which) {
        boolean all = which.equals("all") || which.isEmpty();
        at(60, () -> {
            cmd("time set 6000");
            cmd("gamerule doDaylightCycle false");
            cmd("gamerule doMobSpawning false");
            cmd("weather clear");
            cmd("fill 6 -60 -4 6 -49 4 minecraft:stone_bricks");
            cmd("fill -4 -49 -4 6 -49 4 minecraft:smooth_stone");
            cmd("fill 30 -60 20 30 -25 20 minecraft:stone");
            cmd("fill 24 -25 14 36 -25 26 minecraft:stone");
            cmd("tp @s 0.5 -60 0.5 0 0");
            cmd("venom bond");
            mc().options.setCameraType(CameraType.THIRD_PERSON_FRONT);
        });
        at(20, () -> cmd("effect clear @s"));
        if (all || which.contains("forms")) {
            at(120, () -> shot("01_host"));
            at(1, () -> cmd("venom form empowered"));
            at(60, () -> shot("02_empowered"));
            at(1, () -> cmd("venom form suit"));
            at(16, () -> shot("03_suit_transition"));
            at(40, () -> shot("04_suit"));
            at(1, () -> cmd("venom form venom"));
            at(16, () -> shot("05_venom_transition"));
            at(50, () -> shot("06_venom"));
            at(1, () -> PacketDistributor.sendToServer(new Net.UseAbility(Net.UseAbility.ROAR)));
            at(14, () -> shot("07_roar"));
            at(60, () -> mc().options.setCameraType(CameraType.THIRD_PERSON_BACK));
            at(5, () -> shot("08_venom_back"));
            at(1, () -> mc().options.setCameraType(CameraType.FIRST_PERSON));
            at(5, () -> shot("09_first_person"));
            at(1, () -> mc().setScreen(new FormWheelScreen()));
            at(10, () -> shot("10_wheel"));
            at(1, () -> mc().setScreen(null));
        }
        if (all || which.contains("crawl")) {
            at(5, () -> {
                cmd("venom form suit");
                cmd("gamemode survival");
                cmd("tp @s 4.5 -60 0.5 -90 0");
                mc().options.setCameraType(CameraType.THIRD_PERSON_BACK);
            });
            at(60, () -> {
                look(-90, 0);
                keys(true, true, false, false);
            });
            at(6, () -> {
                keys(true, false, false, false);
                log("crawl start");
            });
            at(25, () -> {
                log("on wall");
                shot("11_wall");
            });
            at(40, () -> {
                log("near ceiling");
                look(90, 10);
            });
            at(30, () -> {
                log("on ceiling");
                mc().options.setCameraType(CameraType.THIRD_PERSON_FRONT);
            });
            at(4, () -> shot("12_ceiling"));
            for (int i = 0; i < 10; i++) at(8, () -> log("ceiling/edge"));
            at(1, () -> shot("13_over_edge"));
            at(1, () -> keys(false, false, true, false));
            at(3, () -> keys(false, false, false, false));
            at(30, () -> log("dropped"));
        }
        if (all || which.contains("swing")) {
            at(5, () -> {
                cmd("venom form venom");
                cmd("fill 30 -60 0 30 -36 0 minecraft:stone");
                cmd("tp @s 30.5 -35 0.5 0 -32");
                mc().options.setCameraType(CameraType.THIRD_PERSON_BACK);
            });
            at(60, () -> {
                look(0, -32);
                keys(true, false, false, true);
            });
            at(3, () -> log("swing start"));
            at(8, () -> {
                keys(false, false, false, true);
                look(90, 0);
            });
            for (int i = 0; i < 4; i++) at(4, () -> log("swing"));
            at(1, () -> shot("14_swing_a"));
            for (int i = 0; i < 4; i++) at(4, () -> log("swing"));
            at(1, () -> shot("15_swing_b"));
            for (int i = 0; i < 5; i++) at(4, () -> log("swing"));
            at(1, () -> {
                look(0, 0);
                keys(true, false, false, false);
            });
            for (int i = 0; i < 3; i++) at(3, () -> log("released"));
            at(1, () -> keys(true, true, false, false));
            at(2, () -> keys(true, false, false, false));
            for (int i = 0; i < 4; i++) at(5, () -> log("glide"));
            at(1, () -> shot("16_glide_back"));
            at(1, () -> mc().options.setCameraType(CameraType.THIRD_PERSON_FRONT));
            at(4, () -> shot("17_glide_front"));
            for (int i = 0; i < 12; i++) at(10, () -> log("glide"));
            at(1, () -> keys(false, false, false, false));
        }
        if (all || which.contains("leap")) {
            at(5, () -> {
                cmd("venom form suit");
                cmd("gamemode survival");
                cmd("tp @s 0.5 -60 40.5 0 -35");
                mc().options.setCameraType(CameraType.THIRD_PERSON_BACK);
            });
            at(70, () -> {
                look(0, -35);
                keys(false, false, true, false);
            });
            at(34, () -> keys(false, true, true, false));
            at(2, () -> keys(false, false, false, false));
            for (int i = 0; i < 3; i++) at(6, () -> log("leap"));
            at(1, () -> keys(false, true, false, false));
            at(2, () -> {
                keys(false, false, false, false);
                look(0, 5);
                mc().options.setCameraType(CameraType.THIRD_PERSON_FRONT);
            });
            at(14, () -> {
                log("leap->glide");
                shot("18_leap_glide");
            });
            for (int i = 0; i < 8; i++) at(6, () -> log("leap"));
            at(60, () -> log("leap landed"));
        }
        if (all || which.contains("mob")) {
            at(5, () -> {
                cmd("gamemode creative");
                cmd("tp @s 0.5 -60 -20.5 0 20");
                cmd("summon venom:symbiote 0.5 -60 -17.5 {NoAI:1b,Rotation:[150f,0f]}");
                mc().options.setCameraType(CameraType.FIRST_PERSON);
            });
            at(60, () -> shot("19_symbiote"));
            at(1, () -> VenomMod.LOGGER.info("[autotest] biomass before devour={}", mc().player.getData(ModRegistry.SYMBIOTE).biomass));
            at(1, () -> {
                cmd("kill @e[type=venom:symbiote]");
                cmd("venom form venom");
                cmd("tp @s 0.5 -60 -20.5 0 0");
                cmd("summon minecraft:pig 0.5 -60 -17.5 {NoAI:1b}");
                PacketDistributor.sendToServer(new Net.UseAbility(Net.UseAbility.LASH));
            });
            at(4, () -> shot("20_lash"));
            at(38, () -> look(0, 40));
            at(2, () -> PacketDistributor.sendToServer(new Net.UseAbility(Net.UseAbility.DEVOUR)));
            at(5, () -> shot("21_devour"));
        }
        if (all || which.contains("loop")) {
            // gameplay loop: sonic emitter stuns, sneak-use tears the symbiote off, canister bonds, wild symbiote bonds
            at(5, () -> {
                cmd("kill @e[type=!player]");
                cmd("gamemode survival");
                cmd("venom form suit");
                cmd("tp @s 0.5 -60 -40.5 0 0");
                cmd("item replace entity @s weapon.mainhand with venom:sonic_emitter");
                mc().options.setCameraType(CameraType.THIRD_PERSON_FRONT);
            });
            at(50, () -> {
                data("before sonic");
                mc().gameMode.useItem(mc().player, net.minecraft.world.InteractionHand.MAIN_HAND);
            });
            at(10, () -> {
                data("after sonic (expect weakened, receding)");
                shot("22_weakened");
            });
            at(90, () -> keys(false, false, true, false));
            at(5, () -> mc().gameMode.useItem(mc().player, net.minecraft.world.InteractionHand.MAIN_HAND));
            at(10, () -> {
                keys(false, false, false, false);
                data("after sneak-use (expect unbonded)");
                cmd("effect clear @s");
                cmd("kill @e[type=item]");
                cmd("item replace entity @s weapon.mainhand with venom:symbiote_canister");
            });
            at(10, () -> mc().options.keyUse.setDown(true));
            at(50, () -> {
                mc().options.keyUse.setDown(false);
                data("after canister (expect bonded)");
                cmd("venom unbond");
                cmd("effect clear @s");
                cmd("summon venom:symbiote 0.5 -60 -36.5");
            });
            at(120, () -> {
                data("after wild symbiote (expect bonded)");
                cmd("effect clear @s");
                cmd("venom form venom");
            });
            at(60, () -> {
                cmd("tp @s 0.5 -20 -40.5 0 0");
            });
            at(60, () -> data("after 40 block fall as venom (expect full health)"));
            at(1, () -> {
                cmd("setblock 0 -60 -38 minecraft:bell");
                cmd("setblock 0 -60 -37 minecraft:redstone_block");
            });
            at(20, () -> data("after bell (expect weakened)"));
        }
        if (all || which.contains("closeup")) {
            at(5, () -> {
                cmd("gamemode creative");
                cmd("effect clear @s");
                cmd("venom biomass 100");
                cmd("tp @s 0.5 -60 -60.5 0 0");
                mc().options.setCameraType(CameraType.THIRD_PERSON_FRONT);
                mc().options.fov().set(30);
                mc().options.hideGui = true;
            });
            at(200, () -> cmd("venom form venom"));
            at(60, () -> {
                look(20, 4);
                shot("30_closeup_venom");
            });
            at(1, () -> PacketDistributor.sendToServer(new Net.UseAbility(Net.UseAbility.ROAR)));
            at(16, () -> shot("31_closeup_roar"));
            at(60, () -> cmd("venom form suit"));
            at(60, () -> shot("32_closeup_suit"));
            at(1, () -> cmd("venom form empowered"));
            at(60, () -> shot("33_closeup_empowered"));
            at(1, () -> {
                mc().options.fov().set(70);
                mc().options.hideGui = false;
            });
        }
        at(40, () -> {
            VenomMod.LOGGER.info("[autotest] done, biomass={}", mc().player.getData(ModRegistry.SYMBIOTE).biomass);
            mc().stop();
        });
    }

    private static void onTick(ClientTickEvent.Post event) {
        Minecraft mc = mc();
        if (mc.level == null || mc.player == null) {
            if (!started && mc.screen instanceof TitleScreen) {
                started = true;
                String name = "venomtest-" + System.currentTimeMillis();
                LevelSettings settings = new LevelSettings(name, GameType.CREATIVE, false, Difficulty.EASY, true, new GameRules(), WorldDataConfiguration.DEFAULT);
                mc.createWorldOpenFlows().createFreshLevel(name, settings, new WorldOptions(4242L, false, false),
                        ra -> ra.registryOrThrow(Registries.WORLD_PRESET).getHolderOrThrow(WorldPresets.FLAT).value().createWorldDimensions(), mc.screen);
            }
            return;
        }
        if (mc.isPaused()) return;
        tick++;
        while (cursor < STEPS.size() && STEPS.get(cursor).at <= tick) {
            try {
                STEPS.get(cursor).action.run();
            } catch (Throwable t) {
                VenomMod.LOGGER.error("[autotest] step failed", t);
            }
            cursor++;
        }
    }
}
