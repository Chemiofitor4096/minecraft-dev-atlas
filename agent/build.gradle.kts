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

// 构建机只需要一个 JDK 21：产物面向 21，不设 toolchain（省掉一次自动探测）。
tasks.withType<JavaCompile>().configureEach {
    options.release.set(21)
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
