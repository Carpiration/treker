"""Сборка APK без Gradle: aapt2 + javac + d8 + zipalign + apksigner из Android SDK.

Запуск из корня проекта:  python android\\build.py
Результат:                Treker-<версия>.apk в корне проекта
"""
import os
import re
import secrets
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

APP_ID = "app.treker.tasks"
APP_URL = "https://carpiration.github.io/treker/"  # сайт, который открывает приложение
VERSION_NAME = "2.0"
VERSION_CODE = 2          # увеличивайте при каждом новом APK, иначе он не встанет поверх старого
MIN_SDK = 24              # Android 7.0
TARGET_SDK = 35

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
OUT = HERE / "build"
SIGNING = HERE / "signing"
IS_WIN = os.name == "nt"


def find_sdk():
    for p in (os.environ.get("ANDROID_HOME"), os.environ.get("ANDROID_SDK_ROOT"),
              os.path.join(os.environ.get("LOCALAPPDATA", ""), "Android", "Sdk")):
        if p and Path(p, "platforms").is_dir():
            return Path(p)
    sys.exit("Не найден Android SDK: задайте ANDROID_HOME.")


def find_jdk():
    candidates = [os.environ.get("JAVA_HOME")]
    for base in (Path(r"C:\Program Files\Android"),):
        if base.is_dir():
            candidates += [str(d / "jbr") for d in sorted(base.iterdir())]
    for c in candidates:
        if not c:
            continue
        javac = Path(c, "bin", "javac.exe" if IS_WIN else "javac")
        if javac.is_file() and subprocess.run([str(javac), "-version"], capture_output=True).returncode == 0:
            return Path(c)
    sys.exit("Не найден JDK 17+: задайте JAVA_HOME (подходит jbr из Android Studio).")


def newest(dirs, pattern):
    """Самая новая стабильная версия из списка папок вида 35.0.1 / android-35."""
    best = None
    for d in dirs:
        m = re.fullmatch(pattern, d.name)
        if m:
            key = tuple(int(x) for x in m.groups())
            if best is None or key > best[0]:
                best = (key, d)
    return best[1] if best else None


def run(*cmd, **kw):
    cmd = [str(c) for c in cmd]
    print(">", " ".join(Path(cmd[0]).name if i == 0 else c for i, c in enumerate(cmd)))
    r = subprocess.run(cmd, **kw)
    if r.returncode:
        sys.exit(f"Ошибка на шаге: {Path(cmd[0]).name} (код {r.returncode})")


def ensure_keystore(keytool):
    """Ключ подписи создаётся один раз. Обновления APK должны подписываться тем же ключом."""
    ks, pw = SIGNING / "release.jks", SIGNING / "keystore-password.txt"
    if ks.exists() and pw.exists():
        return ks, pw
    SIGNING.mkdir(exist_ok=True)
    password = secrets.token_urlsafe(24)
    pw.write_text(password, encoding="ascii")
    run(keytool, "-genkeypair", "-keystore", ks, "-storetype", "PKCS12", "-alias", "treker",
        "-keyalg", "RSA", "-keysize", "3072", "-validity", "10000",
        "-dname", "CN=Treker", "-storepass:file", pw, "-keypass:file", pw)
    return ks, pw


def main():
    sdk, jdk = find_sdk(), find_jdk()
    bt = newest((sdk / "build-tools").iterdir(), r"(\d+)\.(\d+)\.(\d+)")
    platform = sdk / "platforms" / f"android-{TARGET_SDK}"
    if not platform.is_dir():
        platform = newest((sdk / "platforms").iterdir(), r"android-(\d+)")
    android_jar = platform / "android.jar"
    exe = ".exe" if IS_WIN else ""
    bat = ".bat" if IS_WIN else ""
    print(f"SDK: {sdk}\nbuild-tools: {bt.name}, платформа: {platform.name}\nJDK: {jdk}")

    # d8 и apksigner — Java-программы: им нужен этот же JDK, а не старая Java из PATH.
    env = dict(os.environ, JAVA_HOME=str(jdk), PATH=str(jdk / "bin") + os.pathsep + os.environ["PATH"])

    shutil.rmtree(OUT, ignore_errors=True)
    for d in ("assets", "gen", "classes", "dex"):
        (OUT / d).mkdir(parents=True)
    shutil.copytree(HERE / "assets", OUT / "assets", dirs_exist_ok=True)

    pkg_dir = OUT / "gen" / Path(*APP_ID.split("."))
    pkg_dir.mkdir(parents=True)
    (pkg_dir / "BuildInfo.java").write_text(
        f'package {APP_ID};\n\nfinal class BuildInfo {{\n    static final String VERSION_NAME = "{VERSION_NAME}";\n    static final String APP_URL = "{APP_URL}";\n}}\n',
        encoding="utf-8")

    run(bt / f"aapt2{exe}", "compile", "--dir", HERE / "res", "-o", OUT / "res.zip")
    run(bt / f"aapt2{exe}", "link", "-o", OUT / "app.unsigned.apk", "-I", android_jar,
        "--manifest", HERE / "AndroidManifest.xml", "-A", OUT / "assets", "--java", OUT / "gen",
        "--min-sdk-version", MIN_SDK, "--target-sdk-version", TARGET_SDK,
        "--version-code", VERSION_CODE, "--version-name", VERSION_NAME, OUT / "res.zip")

    sources = list((HERE / "src").rglob("*.java")) + list((OUT / "gen").rglob("*.java"))
    run(jdk / "bin" / f"javac{exe}", "-encoding", "UTF-8", "-source", "8", "-target", "8",
        "-Xlint:-options", "-bootclasspath", android_jar,
        "-classpath", bt / "core-lambda-stubs.jar",  # android.jar не содержит классов для лямбд
        "-d", OUT / "classes", *sources, env=env)

    classes = list((OUT / "classes").rglob("*.class"))
    run(bt / f"d8{bat}", "--release", "--min-api", MIN_SDK, "--lib", android_jar,
        "--output", OUT / "dex", *classes, env=env)

    with zipfile.ZipFile(OUT / "app.unsigned.apk", "a", zipfile.ZIP_DEFLATED) as z:
        z.write(OUT / "dex" / "classes.dex", "classes.dex")

    run(bt / f"zipalign{exe}", "-p", "-f", "4", OUT / "app.unsigned.apk", OUT / "app.aligned.apk")

    ks, pw = ensure_keystore(jdk / "bin" / f"keytool{exe}")
    apk = ROOT / f"Treker-{VERSION_NAME}.apk"
    run(bt / f"apksigner{bat}", "sign", "--ks", ks, "--ks-key-alias", "treker",
        "--ks-pass", f"file:{pw}",  # пароль ключа в PKCS12 совпадает с паролем хранилища
        "--v4-signing-enabled", "false",  # .idsig нужен только для потоковой установки через adb
        "--out", apk, OUT / "app.aligned.apk", env=env)
    run(bt / f"apksigner{bat}", "verify", "--verbose", apk, env=env)
    print(f"\nГотово: {apk}  ({apk.stat().st_size // 1024} КБ)")


if __name__ == "__main__":
    main()
