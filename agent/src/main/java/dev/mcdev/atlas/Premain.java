package dev.mcdev.atlas;

import java.lang.instrument.Instrumentation;

/**
 * {@code -javaagent:mcdev-atlas.jar=...} 的入口。
 *
 * premain 抛异常会让 JVM 直接起不来，所以这里把所有异常都吃掉、只打一行日志：
 * "Agent 没生效"必须是可诊断的，而不是把游戏弄挂。
 */
public final class Premain {
    private Premain() {
    }

    public static void premain(String args, Instrumentation instrumentation) {
        try {
            AgentOptions options = AgentOptions.parse(args, true);
            AtlasAgent.start(options, instrumentation, "agent-boot");
        } catch (Throwable error) {
            AgentLog.failed("parse", error);
        }
    }
}
