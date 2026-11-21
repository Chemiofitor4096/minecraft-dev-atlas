package dev.mcdev.atlas;

import java.io.InputStream;
import java.util.Properties;

/**
 * 运行环境探测与 adapter 选择。
 *
 * 判定顺序：先看类在不在（loader 与 mappings 都只能是二元的），再看版本，最后查表。
 * 没有表就报"不支持"，不猜、不导出半份 null。
 */
public final class Detect {
    /**
     * 探针类：任何一个出现就说明游戏类已经加载。
     * 选加载得早的（SharedConstants / BuiltInRegistries），别等 MinecraftServer 构造出来。
     */
    public static final String[] PROBES = {
            "net.minecraft.SharedConstants",
            "net.minecraft.core.registries.BuiltInRegistries",
            "net.minecraft.registry.Registries",
            "net.minecraft.server.MinecraftServer",
    };

    private Detect() {
    }

    /** 需要升级 adapter 表时抛这个：带上探测到的三元组，方便补表。 */
    public static final class UnsupportedException extends Exception {
        public final String loader;
        public final String mappings;
        public final String mcVersion;

        public UnsupportedException(String loader, String mappings, String mcVersion, String message) {
            super(message);
            this.loader = loader;
            this.mappings = mappings;
            this.mcVersion = mcVersion;
        }
    }

    public static String loader(ClassLoader loader) {
        if (Reflect.findClass("net.neoforged.neoforge.server.ServerLifecycleHooks", loader) != null) {
            return "neoforge";
        }
        if (Reflect.findClass("net.minecraftforge.server.ServerLifecycleHooks", loader) != null) {
            return "forge";
        }
        if (Reflect.findClass("net.fabricmc.loader.api.FabricLoader", loader) != null) {
            return "fabric";
        }
        return null;
    }

    public static String mappings(ClassLoader loader) {
        if (Reflect.findClass("net.minecraft.core.registries.BuiltInRegistries", loader) != null) {
            return "mojmap";
        }
        if (Reflect.findClass("net.minecraft.registry.Registries", loader) != null) {
            return "yarn";
        }
        return null;
    }

    /**
     * 客户端还是服务端。
     *
     * 不能只看 `net.minecraft.client.Minecraft` 类在不在：开发环境里客户端与服务端的类都在
     * classpath 上，runServer 也能加载到 Minecraft。所以以**实例**为准：DedicatedServer 才是服务端。
     * @param server 已就绪的服务端对象（可能为 null，超时导出时就是这样）
     */
    public static String sideOf(Object server) {
        if (server == null) {
            return null;
        }
        try {
            Object dedicated = Reflect.call(server, "isDedicatedServer");
            if (dedicated instanceof Boolean value) {
                return value.booleanValue() ? "server" : "client";
            }
        } catch (Throwable ignored) {
            // 老版本没有这个方法，退回类名判断
        }
        return server.getClass().getName().contains("DedicatedServer") ? "server" : "client";
    }

    /** MC 版本：优先读 SharedConstants.VERSION_STRING，其次是 WorldVersion#getName。 */
    public static String mcVersion(ClassLoader loader) {
        Class<?> sharedConstants = Reflect.findClass("net.minecraft.SharedConstants", loader);
        if (sharedConstants == null) {
            return null;
        }
        try {
            Object value = Reflect.staticValue(sharedConstants, "VERSION_STRING");
            if (value != null && !String.valueOf(value).isBlank()) {
                return String.valueOf(value);
            }
        } catch (Throwable ignored) {
            // 有的映射把常量挪进方法了，继续走下面
        }
        try {
            Object version = Reflect.callStaticAny(sharedConstants, new String[]{"getCurrentVersion", "getGameVersion"});
            if (version != null) {
                Object name = Reflect.callAny(version, new String[]{"getName", "getId"});
                if (name != null) {
                    return String.valueOf(name);
                }
            }
        } catch (Throwable ignored) {
            // 读不到就是 null，由调用方报"版本未知"
        }
        return null;
    }

    /** loader 自身版本，只作信息性字段；读不到不阻塞导出。 */
    public static String loaderVersion(String loader, ClassLoader classLoader) {
        try {
            if ("neoforge".equals(loader)) {
                Class<?> type = Reflect.findClass("net.neoforged.neoforge.internal.versions.neoforge.NeoForgeVersion", classLoader);
                if (type != null) {
                    return String.valueOf(Reflect.callStatic(type, "getVersion"));
                }
            }
            if ("forge".equals(loader)) {
                Class<?> type = Reflect.findClass("net.minecraftforge.versions.forge.ForgeVersion", classLoader);
                if (type != null) {
                    return String.valueOf(Reflect.callStatic(type, "getVersion"));
                }
            }
            if ("fabric".equals(loader)) {
                Class<?> type = Reflect.findClass("net.fabricmc.loader.api.FabricLoader", classLoader);
                if (type != null) {
                    Object instance = Reflect.callStatic(type, "getInstance");
                    Object container = Reflect.call(instance, "getModContainer", "fabricloader");
                    Object metadata = Reflect.optionalValue(container);
                    if (metadata != null) {
                        Object version = Reflect.call(metadata, "getVersion");
                        return String.valueOf(Reflect.call(version, "getFriendlyString"));
                    }
                }
            }
        } catch (Throwable ignored) {
            // 版本号只是给人看的，读不到写 null
        }
        return null;
    }

    /** 查表拿 adapter；没有就抛 UnsupportedException。 */
    public static DataAdapter adapter(String loader, String mappings, String mcVersion, AgentOptions options)
            throws UnsupportedException {
        String forcedLoader = options.loader == null ? "auto" : options.loader;
        String forcedMappings = options.mappings == null ? "auto" : options.mappings;

        if (!"auto".equals(forcedLoader) && !forcedLoader.equals(loader)) {
            throw new UnsupportedException(loader, mappings, mcVersion,
                    "loader 是 " + loader + "，但参数要求 " + forcedLoader);
        }
        if (!"auto".equals(forcedMappings) && !forcedMappings.equals(mappings)) {
            throw new UnsupportedException(loader, mappings, mcVersion,
                    "mappings 是 " + mappings + "，但参数要求 " + forcedMappings);
        }
        if (loader == null) {
            throw new UnsupportedException(null, mappings, mcVersion, "认不出这是哪个 loader");
        }
        if (mappings == null) {
            throw new UnsupportedException(loader, null, mcVersion, "认不出用的是哪套映射");
        }
        String line = mcLine(mcVersion);
        if (line == null) {
            throw new UnsupportedException(loader, mappings, mcVersion, "MC 版本未知，不敢套用任何 adapter 表");
        }

        String wanted = loader + "/" + mappings + "/" + line;
        Properties table = table();
        for (String name : table.stringPropertyNames()) {
            String base = name.contains("@") ? name.substring(0, name.indexOf('@')) : name;
            if (!wanted.equals(base)) {
                continue;
            }
            String className = table.getProperty(name, "").strip();
            try {
                Class<?> type = Class.forName(className, true, Detect.class.getClassLoader());
                return (DataAdapter) type.getDeclaredConstructor().newInstance();
            } catch (Throwable error) {
                throw new UnsupportedException(loader, mappings, mcVersion,
                        "adapter " + className + " 实例化失败：" + AgentLog.describe(error));
            }
        }
        throw new UnsupportedException(loader, mappings, mcVersion, "没有 " + wanted + " 的 adapter 表");
    }

    /** 1.21.1 → 1.21；认不出来就 null。 */
    public static String mcLine(String mcVersion) {
        if (mcVersion == null || mcVersion.isBlank()) {
            return null;
        }
        String[] parts = mcVersion.strip().split("\\.");
        if (parts.length >= 2 && parts[0].matches("\\d+") && parts[1].matches("\\d+")) {
            return parts[0] + "." + parts[1];
        }
        return null;
    }

    private static Properties table() {
        Properties properties = new Properties();
        try (InputStream stream = Detect.class.getResourceAsStream("/adapters.properties")) {
            if (stream != null) {
                properties.load(stream);
            }
        } catch (Throwable ignored) {
            // 没有表就当作"不支持"，由调用方报错
        }
        return properties;
    }
}
