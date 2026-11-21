package dev.mcdev.atlas;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * 把 adapter 取到的视图拼成 dump（schema=1，权威定义见 starter 仓库的 dump-v1.schema.json）。
 *
 * 两条硬语义在这里落实：
 * <ul>
 *   <li>字段顺序固定、条目按 id 排序——同一工程两次导出除 generatedAt/durationMs 外逐字节相同；</li>
 *   <li>失败的 section 是 count=0 + entries=[]，并且 errors[] 里点名，不用空数组假装"没有"。</li>
 * </ul>
 */
public final class DumpBuilder {
    private DumpBuilder() {
    }

    public static Map<String, Object> build(AgentContext ctx, String via, String generatedAt,
                                            List<DataAdapter.RegistryView> registries,
                                            Map<String, Map<String, List<String>>> tags,
                                            List<DataAdapter.RecipeView> recipes,
                                            long durationMs, List<String> truncatedSections) {
        Map<String, Object> dump = new LinkedHashMap<>();
        dump.put("schema", 1);
        dump.put("generatedAt", generatedAt);

        Map<String, Object> env = new LinkedHashMap<>();
        env.put("via", via);
        env.put("loader", ctx.loader);
        env.put("loaderVersion", ctx.loaderVersion);
        env.put("mcVersion", ctx.mcVersion == null ? "unknown" : ctx.mcVersion);
        env.put("mappings", ctx.mappings);
        env.put("adapter", ctx.adapter.key());
        env.put("side", ctx.side());
        env.put("java", Runtime.version().feature());
        dump.put("env", env);

        Map<String, Object> provenance = new LinkedHashMap<>();
        provenance.put("projectRoot", ctx.options.projectRoot);
        provenance.put("sourceHash", ctx.options.sourceHash == null ? "" : ctx.options.sourceHash);
        provenance.put("durationMs", durationMs);
        dump.put("provenance", provenance);

        dump.put("truncated", !truncatedSections.isEmpty());
        dump.put("truncatedSections", truncatedSections);

        Map<String, Object> registrySection = new LinkedHashMap<>();
        for (DataAdapter.RegistryView view : registries) {
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("count", view.entries().size());
            List<Object> items = new ArrayList<>(view.entries().size());
            for (DataAdapter.RegistryEntry value : view.entries()) {
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("id", value.id());
                item.put("owner", value.owner());
                item.put("class", value.className());
                item.put("props", value.props());
                items.add(item);
            }
            entry.put("entries", items);
            registrySection.put(view.id(), entry);
        }
        dump.put("registries", registrySection);

        Map<String, Object> tagSection = new LinkedHashMap<>();
        for (Map.Entry<String, Map<String, List<String>>> registry : new TreeMap<>(tags).entrySet()) {
            tagSection.put(registry.getKey(), new LinkedHashMap<>(registry.getValue()));
        }
        dump.put("tags", tagSection);

        Map<String, Object> recipeSection = new LinkedHashMap<>();
        recipeSection.put("count", recipes.size());
        List<Object> recipeItems = new ArrayList<>(recipes.size());
        for (DataAdapter.RecipeView recipe : recipes) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", recipe.id());
            item.put("type", recipe.type());
            if (recipe.resultItem() == null) {
                item.put("result", null);
            } else {
                Map<String, Object> result = new LinkedHashMap<>();
                result.put("item", recipe.resultItem());
                result.put("count", Math.max(1, recipe.resultCount()));
                item.put("result", result);
            }
            item.put("ingredients", recipe.ingredients());
            // v1 固定 null（D17：先索引，完整 JSON 以后再说）
            item.put("json", null);
            recipeItems.add(item);
        }
        recipeSection.put("entries", recipeItems);
        dump.put("recipes", recipeSection);

        dump.put("warnings", ctx.warnings().finish());
        dump.put("errors", ctx.errors());
        return dump;
    }
}
