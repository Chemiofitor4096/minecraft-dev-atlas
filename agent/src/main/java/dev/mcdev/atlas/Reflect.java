package dev.mcdev.atlas;

import java.lang.instrument.Instrumentation;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Iterator;
import java.util.List;

/**
 * 骨架里唯一允许出现"类名字符串"的工具：所有对游戏代码的访问都从这里过。
 *
 * 两条纪律：
 * <ol>
 *   <li>取不到就抛带上下文的异常，绝不静默返回 null——null 会让一整段数据看起来"就是空的"；</li>
 *   <li>类加载器不假设是系统加载器：游戏类通常由 ModLauncher 的转换加载器加载，
 *       所以先用 {@link Instrumentation#getAllLoadedClasses()} 找到真实加载器，再用它去查类。</li>
 * </ol>
 */
public final class Reflect {
    private Reflect() {
    }

    /** 反射失败：带类名、成员名与根因，方便宿主在 warnings 里点名。 */
    public static final class ReflectException extends RuntimeException {
        public ReflectException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    /**
     * 等游戏类出现并返回加载它的那个类加载器。
     *
     * premain 比游戏主类还早，所以这里必须轮询；同时这也顺带完成"我在游戏进程里吗"的判断。
     *
     * @param probes 任意一个类名出现即可（选加载得最早的那几个）
     */
    public static ClassLoader awaitGameLoader(Instrumentation instrumentation, String[] probes, long timeoutMs) {
        long deadline = System.currentTimeMillis() + Math.max(0L, timeoutMs);
        do {
            ClassLoader loader = gameLoader(instrumentation, probes);
            if (loader != null) {
                return loader;
            }
            try {
                Thread.sleep(200L);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                return null;
            }
        } while (System.currentTimeMillis() < deadline);
        return null;
    }

    /** 扫一遍已加载的类，返回命中任一探针类的加载器。 */
    public static ClassLoader gameLoader(Instrumentation instrumentation, String[] probes) {
        if (instrumentation == null) {
            return null;
        }
        Class<?>[] loaded;
        try {
            loaded = instrumentation.getAllLoadedClasses();
        } catch (Throwable error) {
            return null;
        }
        for (Class<?> candidate : loaded) {
            String name = candidate.getName();
            for (String probe : probes) {
                if (probe.equals(name)) {
                    return candidate.getClassLoader();
                }
            }
        }
        return null;
    }

    /**
     * 只在**已经加载**的类里找一个名字，不触发任何类加载。
     *
     * 为什么不能用 {@code Class.forName} 做"这个类在不在"的判断：ModLauncher 在 mixin/事件
     * 转换窗口里跑，此时 {@code Class.forName} 会真的去加载那个类，从而把转换链扯进来——
     * 实测的后果是 Forge 的 {@code EventSubclassTransformer} 在算监听器列表时炸掉
     * （{@code Error computing listener list for ServerStartedEvent}），整个服务端加载失败。
     * 所以探测一律走"扫描已加载清单"这条路，它只读不写。
     *
     * @return 命中类的加载器；没找到返回 null
     */
    public static ClassLoader loadedClassLoader(Instrumentation instrumentation, String name) {
        if (instrumentation == null) {
            return null;
        }
        try {
            for (Class<?> candidate : instrumentation.getAllLoadedClasses()) {
                if (name.equals(candidate.getName())) {
                    return candidate.getClassLoader();
                }
            }
        } catch (Throwable ignored) {
            // 拿不到清单就当没加载，由调用方按"做不到这个判断"处理
        }
        return null;
    }

    /** 已加载清单里有没有这个类（同样不触发加载）。 */
    public static boolean isLoaded(Instrumentation instrumentation, String name) {
        return loadedClassLoader(instrumentation, name) != null;
    }

    /** 按首选加载器找类，失败再试上下文/本 jar 的加载器；找不到抛异常。 */
    public static Class<?> mustClass(String name, ClassLoader preferred) {
        Class<?> found = findClass(name, preferred);
        if (found == null) {
            throw new ReflectException("找不到类 " + name, null);
        }
        return found;
    }

    /** 找类；找不到返回 null（用于"这个运行时有没有这个类"这种判断）。 */
    public static Class<?> findClass(String name, ClassLoader preferred) {        List<ClassLoader> candidates = new ArrayList<>();
        if (preferred != null) {
            candidates.add(preferred);
        }
        ClassLoader context = Thread.currentThread().getContextClassLoader();
        if (context != null) {
            candidates.add(context);
        }
        ClassLoader own = Reflect.class.getClassLoader();
        if (own != null) {
            candidates.add(own);
        }
        candidates.add(ClassLoader.getSystemClassLoader());
        for (ClassLoader loader : candidates) {
            try {
                return Class.forName(name, false, loader);
            } catch (Throwable ignored) {
                // 换下一个加载器
            }
        }
        return null;
    }

    /** 读静态字段。 */
    public static Object staticValue(Class<?> owner, String field) {        try {
            Field found = owner.getField(field);
            return found.get(null);
        } catch (Throwable error) {
            throw new ReflectException("读不到静态字段 " + owner.getName() + "." + field, error);
        }
    }

    /** 有没有这个静态字段（不触发类初始化）。 */
    public static boolean hasStaticField(Class<?> owner, String field) {
        try {
            owner.getField(field);
            return true;
        } catch (Throwable error) {
            return false;
        }
    }

    /**
     * 读实例或静态字段（按名字找，不要求 public 可见性）。
     *
     * 为什么要有它：有些 getter 会碰客户端类（例如 {@code Item#getMaxStackSize} 在专用服务端
     * 会去加载 {@code AbstractClientPlayer} 然后被判 dist 不符），而同一个值在字段里是安全的——
     * 读字段不触发任何间接初始化。
     */
    public static Object field(Object target, String name) {
        Class<?> owner = target instanceof Class<?> type ? type : target.getClass();
        boolean isStatic = target instanceof Class<?>;
        for (Class<?> current = owner; current != null; current = current.getSuperclass()) {
            for (Field candidate : current.getDeclaredFields()) {
                if (!candidate.getName().equals(name)) {
                    continue;
                }
                try {
                    if (!candidate.canAccess(isStatic ? null : target)) {
                        candidate.setAccessible(true);
                    }
                    return candidate.get(isStatic ? null : target);
                } catch (Throwable error) {
                    throw new ReflectException("读不到字段 " + owner.getName() + "." + name + "：" + AgentLog.describe(error), error);
                }
            }
        }
        throw new ReflectException("找不到字段 " + owner.getName() + "." + name, null);
    }

    /** 调静态方法。 */
    public static Object callStatic(Class<?> owner, String method, Object... args) {
        return invoke(owner, null, method, args);
    }

    /**
     * 用构造器新建一个对象：按**参数个数**挑第一个能接住的构造器。
     *
     * 只给单参数场景用（例如 {@code new ItemStack(Item)}）——参数一多，按个数挑就会挑错，
     * 那种情况应该显式写死参数类型。
     *
     * @return 新对象；类找不到或没有匹配的构造器时返回 null（不让可选字段把整段弄挂）
     */
    public static Object callConstructor(String className, ClassLoader loader, Object... args) {
        Class<?> owner = findClass(className, loader);
        if (owner == null) {
            return null;
        }
        for (Constructor<?> candidate : owner.getConstructors()) {
            if (candidate.getParameterCount() != args.length) {
                continue;
            }
            try {
                if (!candidate.canAccess((Object) null)) {
                    candidate.setAccessible(true);
                }
                return candidate.newInstance(args);
            } catch (Throwable ignored) {
                // 换下一个签名相同的构造器
            }
        }
        return null;
    }

    /** 调实例方法（target 不能是 Class）。 */
    public static Object call(Object target, String method, Object... args) {
        if (target == null) {
            throw new ReflectException("调 " + method + " 时目标对象是 null", null);
        }
        return invoke(target.getClass(), target, method, args);
    }

    /**
     * 依次试多个方法名，返回第一个成功的。
     * 用于"同一件事在不同小版本里改过名"的场合；全失败时抛最后一个异常。
     */
    public static Object callAny(Object target, String[] methods, Object... args) {
        if (target == null) {
            throw new ReflectException("调 " + String.join("/", methods) + " 时目标对象是 null", null);
        }
        Throwable last = null;
        for (String method : methods) {
            try {
                return call(target, method, args);
            } catch (Throwable error) {
                last = error;
            }
        }
        throw new ReflectException("这些方法都调不通：" + target.getClass().getName() + "#" + String.join("/", methods), last);
    }

    /** 调静态方法，方法名可有多个候选。 */
    public static Object callStaticAny(Class<?> owner, String[] methods, Object... args) {
        Throwable last = null;
        for (String method : methods) {
            try {
                return callStatic(owner, method, args);
            } catch (Throwable error) {
                last = error;
            }
        }
        throw new ReflectException("这些静态方法都调不通：" + owner.getName() + "#" + String.join("/", methods), last);
    }

    private static Object invoke(Class<?> owner, Object target, String method, Object[] args) {
        Method found = findMethod(owner, method, args.length, target == null);
        if (found == null) {
            throw new ReflectException("找不到方法 " + owner.getName() + "#" + method + "/" + args.length, null);
        }
        try {
            if (!found.canAccess(Modifier.isStatic(found.getModifiers()) ? null : target)) {
                found.setAccessible(true);
            }
            return found.invoke(Modifier.isStatic(found.getModifiers()) ? null : target, args);
        } catch (InvocationTargetException wrapped) {
            Throwable cause = wrapped.getTargetException();
            throw new ReflectException("调用 " + owner.getName() + "#" + method + " 抛了 " + AgentLog.describe(cause), cause);
        } catch (Throwable error) {
            throw new ReflectException("调用 " + owner.getName() + "#" + method + " 失败：" + AgentLog.describe(error), error);
        }
    }

    private static Method findMethod(Class<?> owner, String name, int arity, boolean requireStatic) {
        for (Method candidate : owner.getMethods()) {
            if (!candidate.getName().equals(name) || candidate.getParameterCount() != arity) {
                continue;
            }
            if (requireStatic && !Modifier.isStatic(candidate.getModifiers())) {
                continue;
            }
            if (!requireStatic && Modifier.isStatic(candidate.getModifiers())) {
                continue;
            }
            return candidate;
        }
        // 非 public 的方法（少数 loader 事件钩子是 protected）：沿继承链找
        for (Class<?> current = owner; current != null; current = current.getSuperclass()) {
            for (Method candidate : current.getDeclaredMethods()) {
                if (!candidate.getName().equals(name) || candidate.getParameterCount() != arity) {
                    continue;
                }
                if (requireStatic && !Modifier.isStatic(candidate.getModifiers())) {
                    continue;
                }
                if (!requireStatic && Modifier.isStatic(candidate.getModifiers())) {
                    continue;
                }
                return candidate;
            }
        }
        return null;
    }

    /** 把一个 Stream / Iterable / 数组摊成 List（跨类加载器的集合也能走这里）。 */
    public static List<Object> values(Object source) {
        List<Object> values = new ArrayList<>();
        if (source == null) {
            return values;
        }
        if (source instanceof java.util.stream.Stream<?> stream) {
            Iterator<?> iterator = stream.iterator();
            while (iterator.hasNext()) {
                values.add(iterator.next());
            }
            return values;
        }
        if (source instanceof Iterable<?> iterable) {
            for (Object item : iterable) {
                values.add(item);
            }
            return values;
        }
        if (source instanceof Collection<?> collection) {
            values.addAll(collection);
            return values;
        }
        if (source instanceof Object[] array) {
            for (Object item : array) {
                values.add(item);
            }
            return values;
        }
        throw new ReflectException("不是可遍历的对象：" + source.getClass().getName(), null);
    }

    /** 拿一个字符串值（ResourceLocation#toString 之类），null 原样返回。 */
    public static String text(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    /** 是不是 Optional 且有值。 */
    public static Object optionalValue(Object optional) {
        if (optional instanceof java.util.Optional<?> present) {
            return present.orElse(null);
        }
        return null;
    }
}
