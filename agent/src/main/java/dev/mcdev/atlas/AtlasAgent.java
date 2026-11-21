package dev.mcdev.atlas;

import java.lang.instrument.Instrumentation;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * 骨架：判断进程 → 选 adapter → 等就绪 → 逐段取数 → 写盘 → 按需停服。
 *
 * 这里没有一处游戏类名（全在 adapter 里），也不依赖宿主的任何东西：它只认参数、只写一个文件、
 * 只打 {@code [mcdev-atlas]} 前缀的日志。
 */
public final class AtlasAgent {
    /** 等游戏类出现的最长时间。类加载通常几秒内就发生，60 秒是给巨大整合包留的余量。 */
    private static final long GAME_CLASS_WAIT_MS = 60_000L;

    /**
     * 等 loader / mappings 的探针类进已加载清单的最长时间。
     *
     * 这两类类在事件总线装完之后才会被加载；用 {@code Class.forName} 去催会在转换窗口里
     * 制造 classloader 冲突，所以宁可等也不催。
     */
    private static final long DETECT_WAIT_MS = 120_000L;

    private AtlasAgent() {
    }

    /** premain/agentmain 必须立刻返回，否则会拖住 JVM 启动，所以真正的活都在这个线程里。 */
    public static void start(AgentOptions options, Instrumentation instrumentation, String via) {
        Thread worker = new Thread(() -> {
            try {
                run(options, instrumentation, via);
            } catch (Throwable error) {
                AgentLog.failed("agent", error);
            }
        }, "mcdev-atlas");
        worker.setDaemon(true);
        worker.start();
    }

    private static void run(AgentOptions options, Instrumentation instrumentation, String via) {
        String command = System.getProperty("sun.java.command", "");
        if (command.contains("GradleDaemon")) {
            // 宿主通过 JAVA_TOOL_OPTIONS 注入，Gradle daemon 也会加载到这个 jar——那里没有游戏类
            AgentLog.event("inert", "reason", "gradle-daemon");
            return;
        }

        ClassLoader gameLoader = Reflect.awaitGameLoader(instrumentation, Detect.PROBES, GAME_CLASS_WAIT_MS);
        if (gameLoader == null) {
            AgentLog.event("inert", "reason", "no-game-classes");
            return;
        }

        // 判定**只**走"扫描已加载清单"：转换窗口里用 Class.forName 探会把 ModLauncher 的
        // 转换链扯进来，实测让 Forge 的事件总线在算监听器列表时抛
        // "NoSuchMethodException: ServerAboutToStartEvent.<init>()"，整个服务端加载失败。
        // 清单里没有就先等——事件总线启动完成后这些类一定会被加载，等到的代价远小于弄挂一局。
        String loader = null;
        String mappings = null;
        long detectDeadline = System.currentTimeMillis() + DETECT_WAIT_MS;
        while (System.currentTimeMillis() < detectDeadline) {
            if (loader == null) {
                loader = Detect.loaderOf(instrumentation);
            }
            if (mappings == null) {
                mappings = Detect.mappingsOf(instrumentation);
            }
            if (loader != null && mappings != null) {
                break;
            }
            try {
                Thread.sleep(200L);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                AgentLog.event("inert", "reason", "interrupted");
                return;
            }
        }
        if (loader == null || mappings == null) {
            AgentLog.event("inert", "reason", "loader-or-mappings-not-loaded",
                    "loader", loader == null ? "unknown" : loader,
                    "mappings", mappings == null ? "unknown" : mappings);
            return;
        }
        String mcVersion = Detect.mcVersion(gameLoader);

        DataAdapter adapter;
        try {
            adapter = Detect.adapter(loader, mappings, mcVersion, options);
        } catch (Detect.UnsupportedException unsupported) {
            AgentLog.event("unsupported",
                    "loader", unsupported.loader == null ? "unknown" : unsupported.loader,
                    "mappings", unsupported.mappings == null ? "unknown" : unsupported.mappings,
                    "mc", unsupported.mcVersion == null ? "unknown" : unsupported.mcVersion,
                    "reason", unsupported.getMessage());
            return;
        }

        String side = "agent-boot".equals(via) ? "server" : "client";
        String loaderVersion = Detect.loaderVersion(loader, gameLoader);
        AgentContext ctx = new AgentContext(options, gameLoader, adapter, loader, mappings, mcVersion, loaderVersion, side);
        long startedAt = System.currentTimeMillis();

        AgentLog.event("ready",
                "schema", "1",
                "loader", loader,
                "mappings", mappings,
                "adapter", adapter.key(),
                "mc", mcVersion == null ? "unknown" : mcVersion,
                "side", side);

        try {
            Object server = adapter.awaitReady(ctx);
            ctx.server(server);
            ctx.side(Detect.sideOf(server));
        } catch (Throwable error) {
            // 超时也继续：注册表往往已经可读，能拿一段是一段；配方会单独记错
            ctx.readyTimedOut(true);
            AgentLog.failed("ready", error);
        }

        List<DataAdapter.RegistryView> registries = List.of();
        Map<String, Map<String, List<String>>> tags = new TreeMap<>();
        List<DataAdapter.RecipeView> recipes = List.of();
        List<String> truncated = new ArrayList<>();

        if (options.sections.contains("registries")) {
            try {
                registries = adapter.registries(ctx);
                AgentLog.eventNamed("section", "registries", "count", String.valueOf(countRegistryEntries(registries)));
            } catch (Throwable error) {
                AgentLog.failed("registries", error);
                ctx.error("registries", AgentLog.describe(error));
                registries = emptyRegistries(adapter.registryIds());
            }
        }

        if (options.sections.contains("tags")) {
            try {
                tags = adapter.tags(ctx);
                AgentLog.eventNamed("section", "tags", "count", String.valueOf(countTags(tags)));
            } catch (Throwable error) {
                AgentLog.failed("tags", error);
                ctx.error("tags", AgentLog.describe(error));
                tags = new TreeMap<>();
            }
        }

        if (options.sections.contains("recipes")) {
            try {
                recipes = adapter.recipes(ctx);
                AgentLog.eventNamed("section", "recipes", "count", String.valueOf(recipes.size()));
            } catch (Throwable error) {
                AgentLog.failed("recipes", error);
                ctx.error("recipes", AgentLog.describe(error));
                recipes = List.of();
            }
        }

        registries = capRegistries(registries, options.max, truncated);
        tags = capTags(tags, options.max, truncated);
        if (recipes.size() > options.max) {
            recipes = new ArrayList<>(recipes.subList(0, options.max));
            truncated.add("recipes");
        }

        Map<String, Object> dump = DumpBuilder.build(ctx, via, Instant.now().truncatedTo(ChronoUnit.MILLIS).toString(),
                registries, tags, recipes, System.currentTimeMillis() - startedAt, truncated);

        writeDump(options.out, dump);

        if (options.stop && ctx.server() != null) {
            requestStop(ctx.server());
        }
    }

    /**
     * 用 `/stop` 命令同一条路：{@code MinecraftServer#halt(false)} 只把 running 置 false，
     * 保存世界由服务端主线程在退出循环时自己做。
     *
     * 不用 {@code stopServer()}：它内部会 {@code waitUntilNextTick()}，从 tick 任务里调会把自己
     * 等死（真机炸出过 60 秒 watchdog），从外部线程调也会和主线程抢保存。
     */
    private static void requestStop(Object server) {
        try {
            Reflect.call(server, "halt", Boolean.FALSE);
        } catch (Throwable error) {
            try {
                Reflect.call(server, "stopServer");
            } catch (Throwable inner) {
                AgentLog.failed("stop", inner);
            }
        }
    }

    /** tmp + rename：进程被强杀时不会留下半个 JSON。 */
    private static void writeDump(Path out, Map<String, Object> dump) {
        Path parent = out.getParent();
        try {
            if (parent != null) {
                Files.createDirectories(parent);
            }
            String text = Json.stringify(dump);
            Path temporary = out.resolveSibling(out.getFileName() + ".tmp");
            Files.writeString(temporary, text, StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE);
            try {
                Files.move(temporary, out, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException fallback) {
                Files.move(temporary, out, StandardCopyOption.REPLACE_EXISTING);
            }
            AgentLog.eventNamed("wrote", out.toString(), "bytes", String.valueOf(text.getBytes(StandardCharsets.UTF_8).length));
        } catch (Throwable error) {
            AgentLog.failed("write", error);
        }
    }

    private static List<DataAdapter.RegistryView> emptyRegistries(List<String> ids) {
        List<DataAdapter.RegistryView> views = new ArrayList<>(ids.size());
        for (String id : ids) {
            views.add(new DataAdapter.RegistryView(id, List.of()));
        }
        return views;
    }

    private static int countRegistryEntries(List<DataAdapter.RegistryView> views) {
        int total = 0;
        for (DataAdapter.RegistryView view : views) {
            total += view.entries().size();
        }
        return total;
    }

    private static int countTags(Map<String, Map<String, List<String>>> tags) {
        int total = 0;
        for (Map<String, List<String>> byTag : tags.values()) {
            total += byTag.size();
        }
        return total;
    }

    /**
     * 单 section 上限：注册表按条目总数截，截断要显式记在 truncatedSections 里。
     *
     * 关键是**不能让前面的注册表把配额吃光**：这里按"均分 + 余量补足"分配，
     * 保证每张注册表都能拿到自己那份。否则物品(13079)+方块(6921)一满 20000，
     * entity_type / fluid / mob_effect / enchantment 就全是 0 —— 看起来像读不到，
     * 实际是被前面的挤没了。这类"缺数据却看着像没配"的故障最难查。
     */
    private static List<DataAdapter.RegistryView> capRegistries(List<DataAdapter.RegistryView> views, int max,
                                                                 List<String> truncated) {
        if (views.isEmpty()) {
            return views;
        }
        // 每张表的保底配额：均分；太小的表占不满时，余量再按顺序补给大表
        int share = Math.max(1, max / views.size());
        int[] budget = new int[views.size()];
        int assigned = 0;
        for (int index = 0; index < views.size(); index += 1) {
            int wanted = views.get(index).entries().size();
            budget[index] = Math.min(wanted, share);
            assigned += budget[index];
        }
        int leftover = max - assigned;
        for (int index = 0; index < views.size() && leftover > 0; index += 1) {
            int wanted = views.get(index).entries().size();
            int extra = Math.min(leftover, wanted - budget[index]);
            budget[index] += extra;
            leftover -= extra;
        }

        boolean capped = false;
        List<DataAdapter.RegistryView> cappedViews = new ArrayList<>(views.size());
        for (int index = 0; index < views.size(); index += 1) {
            DataAdapter.RegistryView view = views.get(index);
            List<DataAdapter.RegistryEntry> entries = view.entries();
            if (entries.size() > budget[index]) {
                entries = new ArrayList<>(entries.subList(0, budget[index]));
                capped = true;
            }
            cappedViews.add(new DataAdapter.RegistryView(view.id(), entries));
        }
        if (capped) {
            truncated.add("registries");
        }
        return cappedViews;
    }

    /** 标签按 tag 数截；成员列表本身不截（一个 tag 的成员不会到上限量级）。 */
    private static Map<String, Map<String, List<String>>> capTags(Map<String, Map<String, List<String>>> tags, int max,
                                                                  List<String> truncated) {
        Map<String, Map<String, List<String>>> capped = new TreeMap<>();
        int remaining = max;
        boolean limited = false;
        for (Map.Entry<String, Map<String, List<String>>> registry : tags.entrySet()) {
            Map<String, List<String>> byTag = new TreeMap<>();
            for (Map.Entry<String, List<String>> tag : registry.getValue().entrySet()) {
                if (remaining <= 0) {
                    limited = true;
                    break;
                }
                byTag.put(tag.getKey(), tag.getValue());
                remaining--;
            }
            capped.put(registry.getKey(), byTag);
        }
        if (limited) {
            truncated.add("tags");
        }
        return capped;
    }
}
