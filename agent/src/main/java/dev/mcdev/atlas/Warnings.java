package dev.mcdev.atlas;

import java.util.ArrayList;
import java.util.List;

/**
 * 收集"读得到、但字段缺了"的情况（dump 的 warnings）。
 *
 * 与 errors 的分工：warnings 是单条数据的小缺陷，不影响这一段的成败；errors 是整段失败。
 * 有上限是因为大整合包里一个坏字段能刷几千行——刷屏的警告等于没有警告。
 */
public final class Warnings {
    private final List<String> messages = new ArrayList<>();
    private final int limit;
    private int dropped;

    public Warnings(int limit) {
        this.limit = limit;
    }

    public void add(String message) {
        if (messages.size() < limit) {
            messages.add(message);
        } else {
            dropped++;
        }
    }

    /** 是不是已经满到开始丢弃了（用于决定要不要再记一条汇总）。 */
    public boolean isDropping() {
        return dropped > 0;
    }

    /** 收尾：把丢弃的条数补成最后一条，不静默。 */
    public List<String> finish() {
        if (dropped > 0) {
            messages.add("另有 " + dropped + " 条同类提示未列出（warnings 上限 " + limit + "）");
            dropped = 0;
        }
        return List.copyOf(messages);
    }
}
