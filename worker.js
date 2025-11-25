/**
 * 生成数学验证题（包含加减乘除，答案在100以内）
 */
function generateMathProblem() {
  const operators = ['+', '-', '*', '÷'];
  const operator = operators[Math.floor(Math.random() * operators.length)];
  
  let a, b, answer;
  
  if (operator === '+') {
    a = Math.floor(Math.random() * 50) + 1;
    b = Math.floor(Math.random() * 50) + 1;
    answer = a + b;
  } else if (operator === '-') {
    a = Math.floor(Math.random() * 100) + 1;
    b = Math.floor(Math.random() * a);
    answer = a - b;
  } else if (operator === '*') {
    a = Math.floor(Math.random() * 10) + 1;
    b = Math.floor(Math.random() * 10) + 1;
    answer = a * b;
  } else { // ÷
    b = Math.floor(Math.random() * 9) + 1;
    answer = Math.floor(Math.random() * 10) + 1;
    a = answer * b;
  }
  
  // 确保答案在100以内
  while (answer > 100) {
    return generateMathProblem();
  }
  
  return { 
    question: `${a} ${operator} ${b}`, 
    answer: answer.toString()
  };
}

/**
 * 常量配置
 */
const TOKEN = ENV_BOT_TOKEN;
const WEBHOOK = '/endpoint';
const SECRET = ENV_BOT_SECRET;
const ADMIN_UID = ENV_ADMIN_UID;
const NOTIFY_INTERVAL = 24 * 3600 * 1000; // 一天
const fraudDb = 'https://raw.githubusercontent.com/Squarelan/telegram-verify-bot/main/data/fraud.db';
const notificationUrl = 'https://raw.githubusercontent.com/Squarelan/telegram-verify-bot/main/data/notification.txt';
const enable_notification = false;

/**
 * 构建 Telegram API URL
 */
function apiUrl(methodName, params = null) {
  let query = '';
  if (params) {
    query = '?' + new URLSearchParams(params).toString();
  }
  return `https://api.telegram.org/bot${TOKEN}/${methodName}${query}`;
}

/**
 * 发送 Telegram 请求
 */
function requestTelegram(methodName, body, params = null) {
  return fetch(apiUrl(methodName, params), body).then(r => r.json());
}

/**
 * 构建请求体
 */
function makeReqBody(body) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  };
}

/**
 * 发送消息
 */
function sendMessage(msg = {}) {
  return requestTelegram('sendMessage', makeReqBody(msg));
}

/**
 * 复制消息
 */
function copyMessage(msg = {}) {
  return requestTelegram('copyMessage', makeReqBody(msg));
}

/**
 * 转发消息
 */
function forwardMessage(msg) {
  return requestTelegram('forwardMessage', makeReqBody(msg));
}

/**
 * Webhook 监听
 */
addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.pathname === WEBHOOK) {
    event.respondWith(handleWebhook(event));
  } else if (url.pathname === '/registerWebhook') {
    event.respondWith(registerWebhook(event, url, WEBHOOK, SECRET));
  } else if (url.pathname === '/unRegisterWebhook') {
    event.respondWith(unRegisterWebhook(event));
  } else {
    event.respondWith(new Response('No handler for this request'));
  }
});

/**
 * 处理 Webhook
 */
async function handleWebhook(event) {
  if (event.request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== SECRET) {
    return new Response('Unauthorized', { status: 403 });
  }
  const update = await event.request.json();
  event.waitUntil(onUpdate(update));
  return new Response('Ok');
}

/**
 * 处理消息
 */
async function onMessage(message) {
  // /start 命令
  if (message.text === '/start') {
    return sendMessage({
      chat_id: message.chat.id,
      text: '你好，这是我的聊天机器人，请通过验证后和我聊天，聊天消息会转发给我。\n\nBot Created Via @Squarelan'
    });
  }

  // 处理回调按钮（验证答案）
  if (message?.web_app_info || message?.callback_query) {
    return;
  }

  // 管理员命令
  if (message.chat.id.toString() === ADMIN_UID) {
    if (!message?.reply_to_message?.chat) {
      return sendMessage({
        chat_id: ADMIN_UID,
        text: '使用方法，回复转发的消息，并发送回复消息，或者`/block`、`/unblock`、`/checkblock`等指令'
      });
    }

    if (/^\/block$/.exec(message.text)) {
      return handleBlock(message);
    }
    if (/^\/unblock$/.exec(message.text)) {
      return handleUnBlock(message);
    }
    if (/^\/checkblock$/.exec(message.text)) {
      return checkBlock(message);
    }

    const guestChatId = await nfd.get('msg-map-' + message?.reply_to_message.message_id, { type: "json" });
    return copyMessage({
      chat_id: guestChatId,
      from_chat_id: message.chat.id,
      message_id: message.message_id
    });
  }

  return handleGuestMessage(message);
}

/**
 * 处理回调查询（按钮点击）
 */
async function onCallbackQuery(callbackQuery) {
  const userId = callbackQuery.from.id.toString();
  const data = callbackQuery.data;
  const messageId = callbackQuery.message.message_id;

  // 格式: verify_{answer}_{correctAnswer}
  if (!data.startsWith('verify_')) {
    return;
  }

  const [, userAnswer, correctAnswer] = data.split('_');

  if (userAnswer === correctAnswer) {
    await nfd.put('verified-' + userId, true, { expirationTtl: 259200 });
    await nfd.delete('verify-' + userId);
    
    await requestTelegram('editMessageText', makeReqBody({
      chat_id: userId,
      message_id: messageId,
      text: '✅ 验证成功，你现在可以使用机器人了！',
      reply_markup: undefined
    }));
  } else {
    await requestTelegram('answerCallbackQuery', makeReqBody({
      callback_query_id: callbackQuery.id,
      text: '❌ 回答错误，请重新尝试',
      show_alert: true
    }));
  }
}

/**
 * 处理更新
 */
async function onUpdate(update) {
  if ('message' in update) {
    await onMessage(update.message);
  }
  if ('callback_query' in update) {
    await onCallbackQuery(update.callback_query);
  }
}

/**
 * 处理客户消息
 */
async function handleGuestMessage(message) {
  const chatId = message.chat.id.toString();

  // 检查是否被屏蔽
  const isblocked = await nfd.get('isblocked-' + chatId, { type: "json" });
  if (isblocked) {
    return sendMessage({ chat_id: chatId, text: 'You are blocked' });
  }

  // 检查是否已验证
  const verified = await nfd.get('verified-' + chatId, { type: "json" });
  if (!verified) {
    const expected = await nfd.get('verify-' + chatId, { type: "json" });

    // 未发送验证题，生成新题
    if (!expected) {
      const { question, answer } = generateMathProblem();
      await nfd.put('verify-' + chatId, answer);
      
      // 生成四个选项
      const options = generateOptions(parseInt(answer));
      
      // 生成内联按钮
      const keyboard = {
        inline_keyboard: [
          [
            { text: options[0], callback_data: `verify_${options[0]}_${answer}` },
            { text: options[1], callback_data: `verify_${options[1]}_${answer}` }
          ],
          [
            { text: options[2], callback_data: `verify_${options[2]}_${answer}` },
            { text: options[3], callback_data: `verify_${options[3]}_${answer}` }
          ]
        ]
      };

      return sendMessage({
        chat_id: chatId,
        text: `🔐 请回答以下问题以验证你不是机器人：\n\n${question} = ?`,
        reply_markup: keyboard
      });
    } else {
      // 已发送过验证题，等待用户点击按钮
      return sendMessage({
        chat_id: chatId,
        text: '请点击上面的按钮选择答案'
      });
    }
  }

  // ✅ 诈骗检查
  if (await isFraud(chatId)) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: `⚠️ 检测到诈骗人员\nUID: ${chatId}`
    });
  }

  // 已验证用户 → 转发消息
  const forwardReq = await forwardMessage({
    chat_id: ADMIN_UID,
    from_chat_id: message.chat.id,
    message_id: message.message_id
  });

  if (forwardReq.ok) {
    await nfd.put('msg-map-' + forwardReq.result.message_id, chatId, { expirationTtl: 2592000 });
    // ✅ 启用通知功能
    return handleNotify(message, chatId);
  }
}

/**
 * 生成四个选项（包含正确答案）
 */
function generateOptions(correctAnswer) {
  const options = [correctAnswer];
  
  while (options.length < 4) {
    // 生成干扰项
    let wrongAnswer = correctAnswer + Math.floor(Math.random() * 20) - 10;
    
    // 确保干扰项不重复且不等于正确答案
    if (wrongAnswer !== correctAnswer && !options.includes(wrongAnswer) && wrongAnswer > 0) {
      options.push(wrongAnswer);
    }
  }
  
  // 打乱顺序
  return options.sort(() => Math.random() - 0.5);
}

/**
 * 处理通知
 */
async function handleNotify(message, chatId) {
  // 检查是否在诈骗名单中
  if (await isFraud(chatId)) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: `检测到骗子，UID: ${chatId}`
    });
  }

  // 根据时间间隔提醒
  if (enable_notification) {
    const lastMsgTime = await nfd.get('lastmsg-' + chatId, { type: "json" });
    if (!lastMsgTime || Date.now() - lastMsgTime > NOTIFY_INTERVAL) {
      await nfd.put('lastmsg-' + chatId, Date.now());
      const notification = await fetch(notificationUrl).then(r => r.text());
      return sendMessage({
        chat_id: ADMIN_UID,
        text: notification
      });
    }
  }
}

/**
 * 处理屏蔽
 */
async function handleBlock(message) {
  const guestChatId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: "json" });

  if (guestChatId === ADMIN_UID) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '不能屏蔽自己'
    });
  }

  await nfd.put('isblocked-' + guestChatId, true);
  return sendMessage({
    chat_id: ADMIN_UID,
    text: `UID:${guestChatId}屏蔽成功`
  });
}

/**
 * 处理解除屏蔽
 */
async function handleUnBlock(message) {
  const guestChatId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: "json" });
  await nfd.put('isblocked-' + guestChatId, false);
  return sendMessage({
    chat_id: ADMIN_UID,
    text: `UID:${guestChatId}解除屏蔽成功`
  });
}

/**
 * 检查屏蔽状态
 */
async function checkBlock(message) {
  const guestChatId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: "json" });
  const blocked = await nfd.get('isblocked-' + guestChatId, { type: "json" });

  return sendMessage({
    chat_id: ADMIN_UID,
    text: `UID:${guestChatId}` + (blocked ? '被屏蔽' : '没有被屏蔽')
  });
}

/**
 * 检查是否是诈骗人员
 */
async function isFraud(id) {
  id = id.toString();
  const db = await fetch(fraudDb).then(r => r.text());
  const arr = db.split('\n').filter(v => v);
  return arr.filter(v => v === id).length !== 0;
}

/**
 * 注册 Webhook
 */
async function registerWebhook(event, requestUrl, suffix, secret) {
  const webhookUrl = `${requestUrl.protocol}//${requestUrl.hostname}${suffix}`;
  const r = await fetch(apiUrl('setWebhook', { url: webhookUrl, secret_token: secret })).then(r => r.json());
  return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2));
}

/**
 * 注销 Webhook
 */
async function unRegisterWebhook(event) {
  const r = await fetch(apiUrl('setWebhook', { url: '' })).then(r => r.json());
  return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2));
}
