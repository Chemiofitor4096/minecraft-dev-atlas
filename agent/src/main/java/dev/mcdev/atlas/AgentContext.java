package dev.mcdev.atlas;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 一次导出的上下文：参数、类加载器、adapter、已就绪的服务端，以及警告与错误。
 *
 * 它也是 adapter 唯一能看到的东西——adapter 不碰参数解析、不碰写盘、不碰日志格式。
 */
public final class AgentContext {
    public final AgentOptions options;
    public final ClassLoader gameLoader;
    public final DataAdapter adapter;
    public final String loader;
    public final String mappings;
    public final String mcVersion;
    public final String loaderVersion;

    private final Warnings warnings = new Warnings(200);
    private final List<Map<String, Object>> errors = new ArrayList<>();
    private Object server;
    private String side;
    private boolean readyTimedOut;

    public AgentContext(AgentOptions options, ClassLoader gameLoader, DataAdapter adapter,
                        String loader, String mappings, String mcVersion, String loaderVersion, String side) {
        this.options = options;
        this.gameLoader = gameLoader;
        this.adapter = adapter;
        this.loader = loader;
        this.mappings = mappings;
        this.mcVersion = mcVersion;
        this.loaderVersion = loaderVersion;
        this.side = side;
    }

    /** 就绪后由实例重新判定（runServer 也可能加载到客户端类，不能只看类名）。 */
    public String side() {
        return side;
    }

    public void side(String value) {
        if (value != null) {
            this.side = value;
        }
    }

    /** 就绪后的服务端对象；没就绪时为 null（超时导出时就是这种状态）。 */
    public Object server() {
        return server;
    }

    public void server(Object value) {
        this.server = value;
    }

    public Warnings warnings() {
        return warnings;
    }

    /** 记一条 section 级失败；同一 section 只留第一条，因为第一条通常最接近根因。 */
    public void error(String section, String message) {
        for (Map<String, Object> existing : errors) {
            if (section.equals(existing.get("section"))) {
                return;
            }
        }
        Map<String, Object> entry = new LinkedHashMap<>();
        entry.put("section", section);
        entry.put("message", message);
        errors.add(entry);
    }

    public List<Map<String, Object>> errors() {
        return Collections.unmodifiableList(errors);
    }

    public boolean readyTimedOut() {
        return readyTimedOut;
    }

    public void readyTimedOut(boolean value) {
        this.readyTimedOut = value;
    }

    /** 找游戏类；找不到就是 adapter 的映射表写错了，异常里带类名。 */
    public Class<?> gameClass(String name) {
        return Reflect.mustClass(name, gameLoader);
    }

    /** 静态字段的便捷写法（adapter 用）。 */
    public Object staticValue(String className, String field) {
        return Reflect.staticValue(gameClass(className), field);
    }
}
