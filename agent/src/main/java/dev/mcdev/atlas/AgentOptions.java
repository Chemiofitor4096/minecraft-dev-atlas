package dev.mcdev.atlas;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * {@code -javaagent:mcdev-atlas.jar=k1=v1,k2=v2} 里的那一串参数。
 *
 * 解析对 {@code sections=registries,tags,recipes} 这种写法是宽容的：逗号既是参数分隔符，
 * 也是列表分隔符，所以"没有等号的段"会被接回上一个参数的值里。
 *
 * 值一律做 URL 解码：路径里出现空格或逗号时由宿主编码（{@code encodeURIComponent}），
 * 这里解回来，保证 {@code out} 与 {@code root} 原样可用。
 */
public final class AgentOptions {
    /** 默认可导出的三类。 */
    public static final Set<String> ALL_SECTIONS = Set.of("registries", "tags", "recipes");

    /** 导出文件（必填）。 */
    public final Path out;

    /** 要导哪几段。 */
    public final Set<String> sections;

    /** 导出后是否让服务端自己停下。attach 模式默认 false。 */
    public final boolean stop;

    /** 等就绪与取数的总预算。 */
    public final long timeoutMs;

    /** 单 section 的条目上限。 */
    public final int max;

    /** auto | neoforge | fabric | forge */
    public final String loader;

    /** auto | mojmap | yarn */
    public final String mappings;

    /** 工程根：只写进 provenance，由宿主提供。 */
    public final String projectRoot;

    /** 工程指纹：只写进 provenance，由宿主提供。 */
    public final String sourceHash;

    private AgentOptions(Path out, Set<String> sections, boolean stop, long timeoutMs, int max,
                         String loader, String mappings, String projectRoot, String sourceHash) {
        this.out = out;
        this.sections = sections;
        this.stop = stop;
        this.timeoutMs = timeoutMs;
        this.max = max;
        this.loader = loader;
        this.mappings = mappings;
        this.projectRoot = projectRoot;
        this.sourceHash = sourceHash;
    }

    /**
     * @param raw          javaagent 参数串，可以为 null
     * @param defaultStop  attach 模式传 false：绝不默认停用户正在玩的游戏
     */
    public static AgentOptions parse(String raw, boolean defaultStop) {
        List<String> parts = new ArrayList<>();
        if (raw != null && !raw.isBlank()) {
            for (String part : raw.split(",")) {
                parts.add(part.strip());
            }
        }

        List<String[]> pairs = new ArrayList<>();
        for (String part : parts) {
            int equals = part.indexOf('=');
            if (equals < 0) {
                // 逗号兼作列表分隔符：接回上一个参数的值
                if (pairs.isEmpty()) {
                    continue;
                }
                String[] last = pairs.get(pairs.size() - 1);
                last[1] = last[1] + "," + part;
                continue;
            }
            pairs.add(new String[]{part.substring(0, equals).strip().toLowerCase(Locale.ROOT), part.substring(equals + 1)});
        }

        String out = null;
        String sectionsRaw = null;
        boolean stop = defaultStop;
        long timeoutMs = 120_000L;
        int max = 20_000;
        String loader = "auto";
        String mappings = "auto";
        String projectRoot = null;
        String sourceHash = null;

        for (String[] pair : pairs) {
            String key = pair[0];
            String value = decode(pair[1]);
            switch (key) {
                case "out" -> out = value;
                case "sections" -> sectionsRaw = value;
                case "stop" -> stop = parseBoolean(value);
                case "timeout" -> timeoutMs = clamp(parseLong(value, 120_000L), 1_000L, 3_600_000L);
                case "max" -> max = (int) clamp(parseLong(value, 20_000L), 1L, 1_000_000L);
                case "loader" -> loader = value.isBlank() ? "auto" : value.strip().toLowerCase(Locale.ROOT);
                case "mappings" -> mappings = value.isBlank() ? "auto" : value.strip().toLowerCase(Locale.ROOT);
                case "root" -> projectRoot = value.isBlank() ? null : value;
                case "sourcehash" -> sourceHash = value.isBlank() ? null : value;
                default -> {
                    // 未知参数忽略：新增参数不应当让旧 jar 炸掉
                }
            }
        }

        if (out == null || out.isBlank()) {
            throw new IllegalArgumentException("缺少 out（Agent 的唯一必填参数）");
        }

        Set<String> sections = new LinkedHashSet<>();
        if (sectionsRaw == null || sectionsRaw.isBlank()) {
            sections.addAll(ALL_SECTIONS);
        } else {
            for (String section : sectionsRaw.split(",")) {
                String name = section.strip().toLowerCase(Locale.ROOT);
                if (!name.isEmpty()) {
                    sections.add(name);
                }
            }
            if (sections.isEmpty()) {
                throw new IllegalArgumentException("sections 解析后为空");
            }
        }

        return new AgentOptions(Paths.get(out).toAbsolutePath(), sections, stop, timeoutMs, max,
                loader, mappings, projectRoot, sourceHash);
    }

    private static String decode(String value) {
        try {
            return URLDecoder.decode(value, StandardCharsets.UTF_8);
        } catch (IllegalArgumentException error) {
            // 不是编码过的值（比如普通的 -javaagent 手写参数），按原样用
            return value;
        }
    }

    private static boolean parseBoolean(String value) {
        String normalized = value.strip().toLowerCase(Locale.ROOT);
        return "true".equals(normalized) || "1".equals(normalized) || "yes".equals(normalized);
    }

    private static long parseLong(String value, long fallback) {
        try {
            return Long.parseLong(value.strip());
        } catch (NumberFormatException error) {
            return fallback;
        }
    }

    private static long clamp(long value, long min, long max) {
        return Math.max(min, Math.min(max, value));
    }
}
