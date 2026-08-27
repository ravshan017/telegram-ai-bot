@echo off
cd /d "%~dp0"

if not exist ".env" (
  echo.
  echo  [ОШИБКА] Файл .env не найден.
  echo  Скопируй .env.example в .env и впиши свои ключи:
  echo    TELEGRAM_BOT_TOKEN=...   (от BotFather)
  echo    GEMINI_API_KEY=...       (от Google AI Studio)
  echo.
  pause
  exit /b 1
)

echo Запуск Telegram AI бота (long polling)...
echo Для остановки нажми Ctrl+C в этом окне.
echo.
node bot.js
pause
