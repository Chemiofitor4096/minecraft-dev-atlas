package dev.mcdev.atlas;

import java.util.List;
import java.util.Map;

/**
 * 映射知识的唯一容器：每个 (loader, mappings, MC 小版本线) 一个实现。
 *
 * 骨架只负责编排（何时等、等多久、怎么写盘、怎么记日志），adapter 只负责"取"。
 * 这样"纯反射"的脆弱性被关在某个具体的组合里：它坏了，坏的是这一格，不是整个插件。
 */
public interface DataAdapter {
    /** 一条注册表条目。{@code props} 只放跨 loader 同义的字段，读不到是 null，不省略键。 */
    record RegistryEntry(String id, String owner, String className, Map<String, Object> props) {
    }

    /** 一张注册表。 */
    record RegistryView(String id, List<RegistryEntry> entries) {
    }

    /** 索引阶段的配方：id / type / result / ingredients，完整 JSON 留到后面再说。 */
    record RecipeView(String id, String type, String resultItem, int resultCount, List<List<String>> ingredients) {
    }

    /** 表里的键，形如 {@code neoforge/mojmap/1.21@1}：@ 后面是表自己的修订号。 */
    String key();

    String loader();

    String mappings();

    /** MC 小版本线，例如 {@code 1.21}。 */
    String mcLine();

    /** 等这个 loader 的"服务端就绪"，返回服务端对象。超时抛异常。 */
    Object awaitReady(AgentContext ctx) throws Exception;

    /** 导出的注册表根清单（用于日志与"这一段导了什么"）。 */
    List<String> registryIds();

    List<RegistryView> registries(AgentContext ctx) throws Exception;

    Map<String, Map<String, List<String>>> tags(AgentContext ctx) throws Exception;

    List<RecipeView> recipes(AgentContext ctx) throws Exception;
}
