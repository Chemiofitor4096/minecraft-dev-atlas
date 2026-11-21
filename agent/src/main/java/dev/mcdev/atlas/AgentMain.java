package dev.mcdev.atlas;

import java.lang.instrument.Instrumentation;

/**
 * attach 入口（M-A3）：{@code loadAgent} 之后 JVM 调这里。
 *
 * 与 premain 的唯一区别是默认 {@code stop=false}——把用户正在玩的游戏关掉不是我们的权力。
 */
public final class AgentMain {
    private AgentMain() {
    }

    public static void agentmain(String args, Instrumentation instrumentation) {
        try {
            AgentOptions options = AgentOptions.parse(args, false);
            AtlasAgent.start(options, instrumentation, "agent-attach");
        } catch (Throwable error) {
            AgentLog.failed("parse", error);
        }
    }
}
