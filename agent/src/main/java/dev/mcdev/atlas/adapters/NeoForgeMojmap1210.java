package dev.mcdev.atlas.adapters;

import dev.mcdev.atlas.AgentContext;
import dev.mcdev.atlas.AgentLog;
import dev.mcdev.atlas.DataAdapter;
import dev.mcdev.atlas.Reflect;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * NeoForge 1.21.x + Mojang 官方名（mojmap）的 adapter。
 *
 * 这是首版唯一的一格：本机验收工程是 NeoForge 1.21.1。类名与方法名全部是字符串，
 * 版本面一变就新增一格表、而不是改这个类——除非语义本身变了。
 */
public final class NeoForgeMojmap1210 implements DataAdapter {
    private static final String KEY = "neoforge/mojmap/1.21@1";
    private static final String BUILT_IN = "net.minecraft.core.registries.BuiltInRegistries";
    private static final String LIFECYCLE = "net.neoforged.neoforge.server.ServerLifecycleHooks";

    private enum PropsKind {
        NONE, ITEM, BLOCK
    }

    private record Kind(String id, String field, PropsKind props) {
    }

    private static final List<Kind> REGISTRIES = List.of(
            new Kind("minecraft:item", "ITEM", PropsKind.ITEM),
            new Kind("minecraft:block", "BLOCK", PropsKind.BLOCK),
            new Kind("minecraft:entity_type", "ENTITY_TYPE", PropsKind.NONE),
            new Kind("minecraft:fluid", "FLUID", PropsKind.NONE),
            new Kind("minecraft:mob_effect", "MOB_EFFECT", PropsKind.NONE),
            // 1.21 起附魔是数据驱动的动态注册表，BuiltInRegistries 里没有静态字段
            new Kind("minecraft:enchantment", null, PropsKind.NONE));

    private static final List<Kind> TAG_KINDS = List.of(REGISTRIES.get(0), REGISTRIES.get(1), REGISTRIES.get(3));

    /** 同一处缺字段只报一次：一个坏方法会在一万条数据上重复出现。 */
    private final Set<String> reported = new LinkedHashSet<>();

    @Override
    public String key() {
        return KEY;
    }

    @Override
    public String loader() {
        return "neoforge";
    }

    @Override
    public String mappings() {
        return "mojmap";
    }

    @Override
    public String mcLine() {
        return "1.21";
    }

    @Override
    public List<String> registryIds() {
        List<String> ids = new ArrayList<>(REGISTRIES.size());
        for (Kind kind : REGISTRIES) {
            ids.add(kind.id());
        }
        return ids;
    }

    @Override
    public Object awaitReady(AgentContext ctx) throws Exception {
        Class<?> hooks = ctx.gameClass(LIFECYCLE);
        long deadline = System.currentTimeMillis() + ctx.options.timeoutMs;
        while (System.currentTimeMillis() < deadline) {
            Object server = Reflect.callStatic(hooks, "getCurrentServer");
            if (server != null) {
                Object ticks = Reflect.call(server, "getTickCount");
                if (ticks instanceof Number number && number.intValue() > 0) {
                    return server;
                }
            }
            Thread.sleep(200L);
        }
        throw new IllegalStateException("服务端在 " + ctx.options.timeoutMs + "ms 内没有就绪");
    }

    @Override
    public List<RegistryView> registries(AgentContext ctx) {
        List<RegistryView> views = new ArrayList<>(REGISTRIES.size());
        for (Kind kind : REGISTRIES) {
            List<RegistryEntry> entries = new ArrayList<>();
            Object registry = registry(ctx, kind);
            if (registry == null) {
                ctx.warnings().add(kind.id() + " 在这个运行时里不可用，entries 为空");
                views.add(new RegistryView(kind.id(), entries));
                continue;
            }
            try {
                for (Object value : Reflect.values(Reflect.call(registry, "stream"))) {
                    try {
                        Object key = Reflect.call(registry, "getKey", value);
                        if (key == null) {
                            continue;
                        }
                        String id = String.valueOf(key);
                        entries.add(new RegistryEntry(id, namespace(id), value.getClass().getName(),
                                props(ctx, kind, value)));
                    } catch (Throwable error) {
                        ctx.warnings().add(kind.id() + " 有一条读不出来：" + AgentLog.describe(error));
                    }
                }
            } catch (Throwable error) {
                ctx.warnings().add(kind.id() + " 遍历失败：" + AgentLog.describe(error));
            }
            entries.sort(Comparator.comparing(RegistryEntry::id));
            views.add(new RegistryView(kind.id(), entries));
        }
        // 1.21.1 的燃料值进了数据组件，没有跨 loader 的读取入口；明说，而不是悄悄缺一个字段
        if (warnOnce(ctx, "item.burnTime",
                "item.burnTime 在 " + KEY + " 上没有可读入口，全部记 null")) {
            // 只需要一条
        }
        return views;
    }

    @Override
    public Map<String, Map<String, List<String>>> tags(AgentContext ctx) {
        Map<String, Map<String, List<String>>> result = new TreeMap<>();
        for (Kind kind : TAG_KINDS) {
            Map<String, List<String>> byTag = new TreeMap<>();
            result.put(kind.id(), byTag);
            Object registry = registry(ctx, kind);
            if (registry == null) {
                continue;
            }
            try {
                for (Object pair : Reflect.values(Reflect.call(registry, "getTags"))) {
                    try {
                        Object tagKey = Reflect.call(pair, "getFirst");
                        Object holderSet = Reflect.call(pair, "getSecond");
                        String tagId = String.valueOf(Reflect.call(tagKey, "location"));
                        List<String> members = new ArrayList<>();
                        for (Object holder : Reflect.values(Reflect.call(holderSet, "stream"))) {
                            String member = memberId(registry, holder);
                            if (member != null) {
                                members.add(member);
                            }
                        }
                        Collections.sort(members);
                        byTag.put(tagId, unique(members));
                    } catch (Throwable error) {
                        warnOnce(ctx, "tag.entry", kind.id() + " 有一条标签读不出来：" + AgentLog.describe(error));
                    }
                }
            } catch (Throwable error) {
                ctx.warnings().add(kind.id() + " 标签遍历失败：" + AgentLog.describe(error));
            }
        }
        return result;
    }

    @Override
    public List<RecipeView> recipes(AgentContext ctx) throws Exception {
        Object server = ctx.server();
        if (server == null) {
            throw new IllegalStateException("服务端未就绪：配方只存在于已启动的服务器里");
        }
        Object manager = Reflect.call(server, "getRecipeManager");
        Object provider = Reflect.call(server, "registryAccess");
        Object itemRegistry = ctx.staticValue(BUILT_IN, "ITEM");
        Object typeRegistry = ctx.staticValue(BUILT_IN, "RECIPE_TYPE");

        List<RecipeView> views = new ArrayList<>();
        for (Object holder : Reflect.values(Reflect.call(manager, "getRecipes"))) {
            String id;
            try {
                id = String.valueOf(Reflect.call(holder, "id"));
            } catch (Throwable error) {
                warnOnce(ctx, "recipe.id", "有一条配方没有 id：" + AgentLog.describe(error));
                continue;
            }
            try {
                Object recipe = Reflect.call(holder, "value");
                String type = null;
                try {
                    Object rawType = Reflect.call(recipe, "getType");
                    Object typeId = Reflect.call(typeRegistry, "getKey", rawType);
                    type = typeId == null ? null : String.valueOf(typeId);
                } catch (Throwable error) {
                    warnOnce(ctx, "recipe.type", "recipe.type 读不出来（例如 " + id + "）：" + AgentLog.describe(error));
                }

                String resultItem = null;
                int resultCount = 0;
                try {
                    Object stack = Reflect.call(recipe, "getResultItem", provider);
                    if (stack != null) {
                        Object item = Reflect.call(stack, "getItem");
                        Object itemId = Reflect.call(itemRegistry, "getKey", item);
                        resultItem = itemId == null ? null : String.valueOf(itemId);
                        resultCount = ((Number) Reflect.call(stack, "getCount")).intValue();
                    }
                } catch (Throwable error) {
                    warnOnce(ctx, "recipe.result", "recipe.result 读不出来（例如 " + id + "）：" + AgentLog.describe(error));
                }

                List<List<String>> ingredients = new ArrayList<>();
                try {
                    for (Object ingredient : Reflect.values(Reflect.call(recipe, "getIngredients"))) {
                        List<String> options = new ArrayList<>();
                        for (Object stack : Reflect.values(Reflect.call(ingredient, "getItems"))) {
                            try {
                                Object item = Reflect.call(stack, "getItem");
                                Object itemId = Reflect.call(itemRegistry, "getKey", item);
                                if (itemId != null) {
                                    options.add(String.valueOf(itemId));
                                }
                            } catch (Throwable ignored) {
                                // 单个可选物读不出来不影响这条配方的其余部分
                            }
                        }
                        Collections.sort(options);
                        ingredients.add(unique(options));
                    }
                } catch (Throwable error) {
                    warnOnce(ctx, "recipe.ingredients", "recipe.ingredients 读不出来（例如 " + id + "）：" + AgentLog.describe(error));
                    ingredients = null;
                }

                views.add(new RecipeView(id, type == null ? "unknown:unknown" : type, resultItem, resultCount, ingredients));
            } catch (Throwable error) {
                warnOnce(ctx, "recipe.entry", "有一条配方读不出来：" + AgentLog.describe(error));
            }
        }
        views.sort(Comparator.comparing(RecipeView::id));
        return views;
    }

    // ---- 取一张注册表：优先服务端 registryAccess（含数据包注册的动态注册表），退回 BuiltInRegistries ----

    private Object registry(AgentContext ctx, Kind kind) {
        Object server = ctx.server();
        if (server != null) {
            try {
                Object access = Reflect.call(server, "registryAccess");
                for (Object entry : Reflect.values(Reflect.call(access, "registries"))) {
                    Object key = Reflect.call(entry, "key");
                    Object location = Reflect.call(key, "location");
                    if (kind.id().equals(String.valueOf(location))) {
                        return Reflect.call(entry, "value");
                    }
                }
            } catch (Throwable error) {
                warnOnce(ctx, "registryAccess", "服务端 registryAccess 不可用：" + AgentLog.describe(error));
            }
        }
        if (kind.field() == null) {
            return null;
        }
        try {
            return ctx.staticValue(BUILT_IN, kind.field());
        } catch (Throwable error) {
            warnOnce(ctx, "builtin." + kind.field(),
                    BUILT_IN + "." + kind.field() + " 读不出来：" + AgentLog.describe(error));
            return null;
        }
    }

    private Map<String, Object> props(AgentContext ctx, Kind kind, Object value) {
        Map<String, Object> props = new LinkedHashMap<>();
        switch (kind.props()) {
            case ITEM -> {
                Object stack = attempt(ctx, "item.getDefaultInstance", () -> Reflect.call(value, "getDefaultInstance"));
                props.put("maxStackSize", intOf(attempt(ctx, "item.maxStackSize",
                        () -> Reflect.call(stack, "getMaxStackSize"))));
                props.put("maxDamage", intOf(attempt(ctx, "item.maxDamage",
                        () -> Reflect.call(stack, "getMaxDamage"))));
                props.put("burnTime", null);
            }
            case BLOCK -> props.put("hardness", doubleOf(attempt(ctx, "block.defaultDestroyTime",
                    () -> Reflect.call(value, "defaultDestroyTime"))));
            case NONE -> {
                // 这些注册表没有跨 loader 同义的属性字段
            }
        }
        return props;
    }

    private interface Attempt {
        Object get() throws Throwable;
    }

    private Object attempt(AgentContext ctx, String field, Attempt attempt) {
        try {
            return attempt.get();
        } catch (Throwable error) {
            warnOnce(ctx, field, field + " 在 " + KEY + " 上读不出来，全部记 null：" + AgentLog.describe(error));
            return null;
        }
    }

    private boolean warnOnce(AgentContext ctx, String key, String message) {
        if (reported.add(key)) {
            ctx.warnings().add(message);
            return true;
        }
        return false;
    }

    private static Integer intOf(Object value) {
        return value instanceof Number number ? number.intValue() : null;
    }

    private static Double doubleOf(Object value) {
        return value instanceof Number number ? number.doubleValue() : null;
    }

    private static String memberId(Object registry, Object holder) {
        try {
            Object key = Reflect.optionalValue(Reflect.call(holder, "unwrapKey"));
            if (key != null) {
                return String.valueOf(Reflect.call(key, "location"));
            }
            Object value = Reflect.call(holder, "value");
            Object id = Reflect.call(registry, "getKey", value);
            return id == null ? null : String.valueOf(id);
        } catch (Throwable error) {
            return null;
        }
    }

    private static String namespace(String id) {
        int colon = id.indexOf(':');
        return colon <= 0 ? id : id.substring(0, colon);
    }

    private static List<String> unique(List<String> values) {
        List<String> result = new ArrayList<>(values.size());
        for (String value : values) {
            if (!result.contains(value)) {
                result.add(value);
            }
        }
        return result;
    }
}
