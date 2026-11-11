package dev.ellderly.venom.client;

import com.mojang.blaze3d.platform.InputConstants;
import net.minecraft.client.KeyMapping;
import net.neoforged.neoforge.client.event.RegisterKeyMappingsEvent;
import net.neoforged.neoforge.client.settings.KeyConflictContext;
import org.lwjgl.glfw.GLFW;

public final class Keys {
    private Keys() {}

    private static final String CATEGORY = "key.categories.venom";

    public static final KeyMapping FORM_MENU = key("form_menu", GLFW.GLFW_KEY_G);
    public static final KeyMapping FORM_UP = key("form_up", GLFW.GLFW_KEY_UP);
    public static final KeyMapping FORM_DOWN = key("form_down", GLFW.GLFW_KEY_DOWN);
    public static final KeyMapping SWING = key("swing", GLFW.GLFW_KEY_R);
    public static final KeyMapping LASH = key("lash", GLFW.GLFW_KEY_V);
    public static final KeyMapping CRAWL = key("crawl", GLFW.GLFW_KEY_H);
    public static final KeyMapping ROAR = key("roar", GLFW.GLFW_KEY_Z);
    public static final KeyMapping DEVOUR = key("devour", GLFW.GLFW_KEY_B);

    private static KeyMapping key(String name, int code) {
        return new KeyMapping("key.venom." + name, KeyConflictContext.IN_GAME, InputConstants.Type.KEYSYM, code, CATEGORY);
    }

    public static void register(RegisterKeyMappingsEvent event) {
        event.register(FORM_MENU);
        event.register(FORM_UP);
        event.register(FORM_DOWN);
        event.register(SWING);
        event.register(LASH);
        event.register(CRAWL);
        event.register(ROAR);
        event.register(DEVOUR);
    }
}
