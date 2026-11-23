plugins {
    java
}

group = "dev.mcdev"

// 版本只有一个来源：npm 包的 package.json。jar 与包版本必须相等（prepack 会再校验一次）。
val packageJson = file("../package.json")
val packageVersion = Regex("\"version\"\\s*:\\s*\"([^\"]+)\"").find(packageJson.readText())
    ?.groupValues?.get(1)
    ?: error("package.json 里没有 version 字段")
version = packageVersion

// 产物面向 Java 17（class 文件 61）。这不是"保守"，是契约：
// agent 跑在**游戏 JVM**里，而 1.20.1 那代是 Java 17——按 21 编译会让 premain 直接
// UnsupportedClassVersionError 把游戏弄挂。class 版本向下兼容，61 在 21/25 的 JVM 上照常加载，
// 所以一个 jar 同时覆盖两代运行时。要调高它之前，先确认没有任何 Java 17 线还在用。
// 构建机只需 JDK 17+，不设 toolchain（省掉一次自动探测）。
tasks.withType<JavaCompile>().configureEach {
    options.release.set(17)
    options.encoding = "UTF-8"
}

tasks.jar {
    archiveBaseName.set("mcdev-atlas")
    archiveVersion.set("")
    manifest {
        attributes(
            "Premain-Class" to "dev.mcdev.atlas.Premain",
            "Agent-Class" to "dev.mcdev.atlas.AgentMain",
            "Implementation-Title" to "minecraft-dev-atlas agent",
            "Implementation-Version" to project.version,
            "MCDEV-Schema" to "1",
            "Can-Redefine-Classes" to false,
            "Can-Retransform-Classes" to false,
        )
    }
}
