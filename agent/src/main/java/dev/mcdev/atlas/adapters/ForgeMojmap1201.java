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
 * Forge 1.20.1 + Mojang 官方名（mojmap）的 adapter。
 *
 * 与 1.21 那格相比，这里的差异都是**语义级**的，不是换个类名：
 *
 * <ul>
 *   <li><b>配方不是 Holder</b>：1.20.1 的 {@code RecipeManager#getRecipes()} 直接给
 *       {@code Collection<Recipe<?>>}，id 走 {@code Recipe#getId()}；1.21 才改成
 *       {@code RecipeHolder}。照 1.21 的写法会一个配方都读不到。</li>
 *   <li><b>标签是注册表自带的</b>：{@code Registry#getTags()} 给
 *       {@code Stream<Pair<TagKey<T>, HolderSet.Named<T>>>}，两者版本一致，可以照写。</li>
 *   <li><b>附魔是静态注册表</b>：1.20.1 的 {@code BuiltInRegistries.ENCHANTMENT} 存在；
 *       1.21 起才变成数据驱动、必须走 registryAccess 的动态注册表。</li>
 *   <li><b>燃料值还在</b>：{@code ForgeHooks#getBurnTime} 在 1.20.1 可读；1.21 那格只能记 null。</li>
 * </ul>
 *
 * 骨架里不出现任何游戏类名这条规矩照旧：下面全是字符串 + 反射。
 */
public final class ForgeMojmap1201 implements DataAdapter {
    private static final String KEY = "forge/mojmap/1.20@1";
    private static final String BUILT_IN = "net.minecraft.core.registries.BuiltInRegistries";
    private static final String LIFECYCLE = "net.minecraftforge.server.ServerLifecycleHooks";
    private static final String FORGE_HOOKS = "net.minecraftforge.common.ForgeHooks";

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
            // 1.20.1 的附魔仍是 BuiltInRegistries 里的静态注册表
            new Kind("minecraft:enchantment", "ENCHANTMENT", PropsKind.NONE));

    private static final List<Kind> TAG_KINDS = List.of(REGISTRIES.get(0), REGISTRIES.get(1), REGISTRIES.get(3));

    /** 同一处缺字段只报一次：一个坏方法会在一万条数据上重复出现。 */
    private final Set<String> reported = new LinkedHashSet<>();

    @Override
    public String key() {
        return KEY;
    }

    @Override
    public String loader() {
        return "forge";
    }

    @Override
    public String mappings() {
        return "mojmap";
    }

    @Override
    public String mcLine() {
        return "1.20";
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
                int streamed = 0;
                for (Object value : Reflect.values(Reflect.call(registry, "stream"))) {
                    streamed += 1;
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
                // 0 条不是"这局没东西"，而是我们的读法在这个运行时上不对——明说，
                // 否则下游只能看到一片空注册表却不知道为什么。
                if (streamed == 0) {
                    ctx.warnings().add(kind.id() + " 遍历到 0 条：注册表对象拿到了但 stream() 为空"
                            + "（" + registry.getClass().getName() + "）");
                }
            } catch (Throwable error) {
                ctx.warnings().add(kind.id() + " 遍历失败：" + AgentLog.describe(error));
            }
            entries.sort(Comparator.comparing(RegistryEntry::id));
            views.add(new RegistryView(kind.id(), entries));
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

        List<RecipeView> views = new ArrayList<>();
        // 1.20.1：Collection<Recipe<?>>，不是 RecipeHolder
        for (Object recipe : Reflect.values(Reflect.call(manager, "getRecipes"))) {
            String id;
            try {
                id = String.valueOf(Reflect.call(recipe, "getId"));
            } catch (Throwable error) {
                warnOnce(ctx, "recipe.id", "有一条配方没有 id：" + AgentLog.describe(error));
                continue;
            }
            try {
                String type = null;
                try {
                    Object rawType = Reflect.call(recipe, "getType");
                    type = rawType == null ? null : String.valueOf(Reflect.call(rawType, "toString"));
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
                        // 1.20.1：Ingredient#getItems() 在部分版本返回数组，Reflect.values 两种都吃
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

    // ---- 取一张注册表 ----
    //
    // 1.20.1 的权威来源是 BuiltInRegistries 的静态字段：物品/方块/实体/流体/状态效果/附魔
    // 全是静态注册表，BuiltInRegistries 里一定拿得到满份。
    //
    // 反过来，服务端 registryAccess() 在这些注册表上并不可靠：实测它给出的
    // entity_type / fluid / mob_effect / enchantment 是空壳（count 0），
    // 只有 item / block 有内容。所以顺序是 BuiltInRegistries 优先、registryAccess 兜底——
    // 这与 1.21 那格正好相反（1.21 的附魔是数据驱动，只有 registryAccess 有）。

    private Object registry(AgentContext ctx, Kind kind) {
        if (kind.field() != null) {
            try {
                Object builtin = ctx.staticValue(BUILT_IN, kind.field());
                if (builtin != null) {
                    return builtin;
                }
            } catch (Throwable error) {
                warnOnce(ctx, "builtin." + kind.field(),
                        BUILT_IN + "." + kind.field() + " 读不出来：" + AgentLog.describe(error));
            }
        }
        Object server = ctx.server();
        if (server != null) {
            try {
                Object access = Reflect.call(server, "registryAccess");
                for (Object entry : Reflect.values(Reflect.call(access, "registries"))) {
                    Object key = Reflect.call(entry, "key");
                    Object location = Reflect.call(key, "location");
                    if (!kind.id().equals(String.valueOf(location))) {
                        continue;
                    }
                    Object value = Reflect.call(entry, "value");
                    if (value != null) {
                        return value;
                    }
                }
            } catch (Throwable error) {
                warnOnce(ctx, "registryAccess", "服务端 registryAccess 不可用：" + AgentLog.describe(error));
            }
        }
        return null;
    }

    private Map<String, Object> props(AgentContext ctx, Kind kind, Object value) {
        Map<String, Object> props = new LinkedHashMap<>();
        switch (kind.props()) {
            case ITEM -> {
                // 注意：Item#getMaxStackSize / getMaxDamage / getDefaultInstance 在专用服务端
                // 都会间接触碰客户端类（实测报
                // "Attempted to load class net/minecraft/client/player/AbstractClientPlayer
                //  for invalid dist DEDICATED_SERVER"）。所以这两项读**公共字段**：
                // 1.20.1 的 Item 上它们是 public final 的 `maxStackSize` / `maxDamage`。
                props.put("maxStackSize", intOf(attempt(ctx, "item.maxStackSize",
                        () -> Reflect.field(value, "maxStackSize"))));
                props.put("maxDamage", intOf(attempt(ctx, "item.maxDamage",
                        () -> Reflect.field(value, "maxDamage"))));
                // 1.20.1 的燃料值仍可从 ForgeHooks 读到（1.21 起进了数据组件、读不到）
                props.put("burnTime", intOf(attempt(ctx, "item.burnTime", () -> burnTime(ctx, value))));
            }
            case BLOCK -> props.put("hardness", doubleOf(attempt(ctx, "block.defaultDestroyTime",
                    () -> Reflect.call(value, "defaultDestroyTime"))));
            case NONE -> {
                // 这些注册表没有跨 loader 同义的属性字段
            }
        }
        return props;
    }

    /**
     * Forge 的燃料值：{@code ForgeHooks#getBurnTime(ItemStack, RecipeType)}。
     *
     * 1.20.1 是**两个**参数（1.21 那格同样签名，但读不到值）。这里传 null 的 recipeType
     * 表示"不针对特定配方"，正是燃料值本身的定义。
     *
     * 也是“读得到就记、读不到记 null”的可选字段：ForgeHooks 不在就跳过，
     * 不影响物品的其余属性。
     */
    private Object burnTime(AgentContext ctx, Object item) throws Throwable {
        Class<?> hooks = Reflect.findClass(FORGE_HOOKS, ctx.gameLoader);
        if (hooks == null) {
            return null;
        }
        Object stack = Reflect.callConstructor("net.minecraft.world.item.ItemStack", ctx.gameLoader, item);
        if (stack == null) {
            return null;
        }
        Object value = Reflect.callStatic(hooks, "getBurnTime", stack, null);
        return value instanceof Number ? value : null;
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
