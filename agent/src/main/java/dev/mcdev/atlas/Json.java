package dev.mcdev.atlas;

import java.util.Iterator;
import java.util.List;
import java.util.Map;

/**
 * 极小的 JSON 序列化：只写、不读，够用就行。
 *
 * 不引 Gson 之类的运行时依赖是硬约束（jar 不带任何第三方库），而 dump 的结构是固定的
 * （Map / List / String / Number / Boolean / null），所以手写比引依赖更省事。
 * 输出用紧凑格式：一份 dump 有 1 MB 量级，缩进会白涨三成体积。
 */
public final class Json {
    private Json() {
    }

    /** 把 Map/List/标量写成 JSON 文本。 */
    public static String stringify(Object value) {
        StringBuilder out = new StringBuilder(1 << 16);
        write(out, value);
        return out.toString();
    }

    private static void write(StringBuilder out, Object value) {
        if (value == null) {
            out.append("null");
        } else if (value instanceof String text) {
            writeString(out, text);
        } else if (value instanceof Boolean flag) {
            out.append(flag.booleanValue());
        } else if (value instanceof Integer || value instanceof Long || value instanceof Short || value instanceof Byte) {
            out.append(((Number) value).longValue());
        } else if (value instanceof Float || value instanceof Double) {
            double number = ((Number) value).doubleValue();
            if (Double.isNaN(number) || Double.isInfinite(number)) {
                out.append("null");
            } else if (number == Math.rint(number) && Math.abs(number) < 1e15) {
                // 64.0 写成 64：hardness 这类字段读起来更干净
                out.append((long) number);
            } else {
                out.append(number);
            }
        } else if (value instanceof Number number) {
            out.append(number);
        } else if (value instanceof Map<?, ?> map) {
            out.append('{');
            Iterator<? extends Map.Entry<?, ?>> iterator = map.entrySet().iterator();
            while (iterator.hasNext()) {
                Map.Entry<?, ?> entry = iterator.next();
                writeString(out, String.valueOf(entry.getKey()));
                out.append(':');
                write(out, entry.getValue());
                if (iterator.hasNext()) {
                    out.append(',');
                }
            }
            out.append('}');
        } else if (value instanceof List<?> list) {
            out.append('[');
            for (int index = 0; index < list.size(); index++) {
                if (index > 0) {
                    out.append(',');
                }
                write(out, list.get(index));
            }
            out.append(']');
        } else {
            // 兜底：宁可多一个引号，也不要让整份 dump 写不出去
            writeString(out, String.valueOf(value));
        }
    }

    private static void writeString(StringBuilder out, String text) {
        out.append('"');
        for (int index = 0; index < text.length(); index++) {
            char ch = text.charAt(index);
            switch (ch) {
                case '"' -> out.append("\\\"");
                case '\\' -> out.append("\\\\");
                case '\b' -> out.append("\\b");
                case '\f' -> out.append("\\f");
                case '\n' -> out.append("\\n");
                case '\r' -> out.append("\\r");
                case '\t' -> out.append("\\t");
                default -> {
                    if (ch < 0x20) {
                        out.append(String.format("\\u%04x", (int) ch));
                    } else {
                        out.append(ch);
                    }
                }
            }
        }
        out.append('"');
    }
}
