package dev.mcdev.atlas;

/**
 * 一行一个事件、键值对形式的日志。
 *
 * 宿主按 {@code [mcdev-atlas]} 前缀 grep 这些行做进度与归因（见 doc/拓展-MC数据导出.md §3.2）。
 * 约定：值里不允许出现空格，切分只看空白，因此这里统一把空白折成下划线。
 */
public final class AgentLog {
    /** 固定的行前缀，宿主与面板都按它过滤。 */
    public static final String PREFIX = "[mcdev-atlas] ";

    private AgentLog() {
    }

    /** 打一行事件：kind 后面跟成对的 key/value。 */
    public static void event(String kind, String... pairs) {
        StringBuilder line = new StringBuilder(PREFIX).append(kind);
        appendPairs(line, pairs);
        System.out.println(line);
        System.out.flush();
    }

    /**
     * 带一个"位置词"的事件：`section registries count=1240` / `wrote <path> bytes=123`。
     * 位置词就是行里第一个没有等号的词，宿主按它区分段落或路径。
     */
    public static void eventNamed(String kind, String name, String... pairs) {
        StringBuilder line = new StringBuilder(PREFIX).append(kind).append(' ').append(value(name));
        appendPairs(line, pairs);
        System.out.println(line);
        System.out.flush();
    }

    private static void appendPairs(StringBuilder line, String... pairs) {
        for (int index = 0; index + 1 < pairs.length; index += 2) {
            line.append(' ').append(pairs[index]).append('=').append(value(pairs[index + 1]));
        }
    }

    /** 失败事件的统一写法：stage 说明卡在哪一步，at 给出最内层异常的第一帧。 */
    public static void failed(String stage, Throwable error) {
        Throwable root = rootCause(error);
        StackTraceElement[] trace = root.getStackTrace();
        String at = trace.length == 0
                ? "unknown"
                : trace[0].getClassName() + "." + trace[0].getMethodName() + ":" + trace[0].getLineNumber();
        event("failed", "stage", stage, "error", describe(error), "at", at);
    }

    /** 异常的一行摘要：类名 + 消息，异常链只取最内层的那条消息。 */
    public static String describe(Throwable error) {
        Throwable root = rootCause(error);
        String message = root.getMessage();
        return root.getClass().getSimpleName() + ":" + (message == null ? "" : message);
    }

    private static Throwable rootCause(Throwable error) {
        Throwable root = error;
        while (root.getCause() != null && root.getCause() != root) {
            root = root.getCause();
        }
        return root;
    }

    /** 把值折成没有空白的 token；空值也有明确的表示，不留空。 */
    public static String value(String raw) {
        if (raw == null) {
            return "null";
        }
        String trimmed = raw.strip();
        if (trimmed.isEmpty()) {
            return "empty";
        }
        return trimmed.replaceAll("\\s+", "_");
    }
}
