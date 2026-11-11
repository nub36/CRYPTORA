#!/usr/bin/env bash
# Дымовой тест standalone APK на эмуляторе БЕЗ Metro, компьютера и кабеля.
#
# Что доказывается:
#   1. APK устанавливается (`adb install`) и запускается;
#   2. процесс приложения жив после старта;
#   3. в logcat НЕТ «Unable to load script» / попыток подключиться к dev-серверу
#      (именно эти сообщения означали, что APK требует Metro);
#   4. приложение отрисовало свой экран (конфигурация сервера, пары или сигналы),
#      а не пустоту и не красный экран ошибки;
#   5. нет FATAL EXCEPTION.
#
# Запускается из GitHub Actions (reactivecircus/android-emulator-runner), но
# работает и локально с уже запущенным эмулятором/устройством:
#   APK_PATH=android/app/build/outputs/apk/release/app-release.apk \
#     bash scripts/emulator-smoke.sh
set -euo pipefail

APK_PATH="${APK_PATH:-android/app/build/outputs/apk/release/app-release.apk}"
PACKAGE="${PACKAGE:-com.nub36.cryptora.v34}"
ACTIVITY="${ACTIVITY:-$PACKAGE/.MainActivity}"

fail() {
  echo "::error title=Emulator smoke:: $1"
  echo "EMULATOR SMOKE: FAIL — $1"
  exit 1
}

if [ ! -f "$APK_PATH" ]; then
  fail "APK не найден: $APK_PATH"
fi

command -v adb >/dev/null 2>&1 || fail 'adb не найден в PATH'

echo "== Ждём устройство =="
adb wait-for-device
for _ in $(seq 1 180); do
  BOOTED="$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
  [ "$BOOTED" = "1" ] && break
  sleep 2
done
[ "${BOOTED:-}" = "1" ] || fail 'эмулятор не загрузился за 6 минут'

adb shell settings put global window_animation_scale 0 >/dev/null 2>&1 || true
adb shell settings put global transition_animation_scale 0 >/dev/null 2>&1 || true
adb shell settings put global animator_duration_scale 0 >/dev/null 2>&1 || true

# Прежняя debug-сборка подписана тем же debug-ключом, но если на устройстве
# оказался другой APK — установка «поверх» не пройдёт. На чистом эмуляторе это
# no-op.
adb uninstall "$PACKAGE" >/dev/null 2>&1 || true

echo "== Устанавливаем APK без Metro и без кабеля =="
adb install -r "$APK_PATH" || fail "adb install не удался для $APK_PATH"

adb logcat -c || true

echo "== Запускаем приложение =="
adb shell am start -W -n "$ACTIVITY" >/tmp/am-start.txt 2>&1 || fail "am start не удался: $(cat /tmp/am-start.txt)"
cat /tmp/am-start.txt

# Приложение должно остаться живым: падение сразу после старта — провал.
sleep 5
PID="$(adb shell pidof "$PACKAGE" 2>/dev/null | tr -d '\r' || true)"
[ -n "$PID" ] || fail "процесс $PACKAGE не запущен после am start"

# Ждём отрисовки любого экрана приложения (до 60 с): сервер может быть не
# настроен, недоступен или ответить — важно, что это ЭКРАН ПРИЛОЖЕНИЯ.
FOUND=0
UI_DUMPED=0
for _ in $(seq 1 30); do
  if adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 && adb pull /sdcard/ui.xml /tmp/ui.xml >/dev/null 2>&1; then
    if [ -s /tmp/ui.xml ]; then
      UI_DUMPED=1
      if grep -Eq 'Сервер не настроен|Пары V3\.4|Загружаем|Не удалось|Сигналы|О приложении' /tmp/ui.xml; then
        FOUND=1
        break
      fi
    fi
  fi
  sleep 2
done

if [ "$FOUND" != "1" ]; then
  if [ "$UI_DUMPED" = "1" ]; then
    fail 'приложение отрисовало пустой экран (в uiautomator нет ни одного экрана приложения)'
  fi
  # uiautomator недоступен на этом образе — проверяем, что Activity приложения
  # реально на переднем плане. Это слабее, но всё ещё доказывает запуск.
  adb shell dumpsys activity activities > /tmp/activities.txt 2>&1 || true
  if grep -Eq "mResumedActivity.*$PACKAGE|topResumedActivity.*$PACKAGE" /tmp/activities.txt; then
    echo "::warning title=Emulator smoke:: uiautomator недоступен — экран проверен через dumpsys activity"
  else
    fail 'приложение не вышло на передний план (возможен пустой экран/краш)'
  fi
fi

adb logcat -d > /tmp/logcat.txt 2>&1 || true

echo "== Ищем следы Metro/dev-сервера =="
if grep -Eai 'Unable to load script|Could not connect to development server|Failed to load JS bundle|Loading JS bundle failed|DevSupport.*(connect|failed)' /tmp/logcat.txt; then
  fail 'в logcat есть ошибка загрузки JS/Metro — APK не standalone'
fi

if grep -Ea 'FATAL EXCEPTION' /tmp/logcat.txt; then
  fail 'в logcat есть FATAL EXCEPTION'
fi

# PID мог измениться после рестарта процесса — проверяем ещё раз.
PID_AFTER="$(adb shell pidof "$PACKAGE" 2>/dev/null | tr -d '\r' || true)"
[ -n "$PID_AFTER" ] || fail "процесс $PACKAGE умер во время проверки"

if [ -s /tmp/ui.xml ]; then
  echo "== Экран приложения (фрагмент uiautomator) =="
  grep -o 'text="[^"]*"' /tmp/ui.xml | head -20 || true
fi

echo "EMULATOR SMOKE: OK — APK запущен без Metro, экран отрисован, процесс $PID_AFTER жив"
