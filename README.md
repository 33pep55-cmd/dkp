Readme · MD
dkp-bot
Telegram-бот: присылаете по очереди фото документов — договор купли-продажи автомобиля (ДКП) собирается сам.

Переменные окружения (задаются в настройках хостинга, не в коде)
TELEGRAM_BOT_TOKEN — токен бота от @BotFather
ANTHROPIC_API_KEY — ключ с console.anthropic.com (Settings → API Keys)
ANTHROPIC_MODEL — необязательно, по умолчанию claude-sonnet-5
При старте сервер сам регистрирует Telegram-вебхук на свой адрес (RENDER_EXTERNAL_URL, эту переменную Render подставляет автоматически) — руками ничего вызывать не нужно.

Локальный запуск (для проверки)
npm install
TELEGRAM_BOT_TOKEN=... ANTHROPIC_API_KEY=... npm start


