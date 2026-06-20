import { supabase } from './supabase'
import { buildAiContext, getOrCreateMonth, formatSum, SUBCATEGORY_PRESETS } from './db'

// ===== ИИ-ассистент «FinLit Бухгалтер» (ИИ-3) =====
// Здесь живёт «душа» ассистента (SOUL) и работа с историей чата.
// Архитектура (по плану ИИ): SOUL (этот файл) + живые данные (buildAiContext)
// + история переписки (таблица ai_messages). Серверная функция ai-chat прячет
// ключи и сама переключается с Grok 4.3 на запасной GLM 5.1.

// SOUL: личность, метод и принципы ассистента. Намеренно компактно, чтобы беречь
// токены. Конкретные цифры пользователя приходят отдельно из buildAiContext.
export const ASSISTANT_NAME = 'FinLit Бухгалтер'

export const SOUL = `Ты «FinLit Бухгалтер» - дружелюбный личный финансовый помощник и коуч внутри приложения FinLit.

Кто ты:
- Говоришь только по-русски, просто и по-человечески, без сложных терминов. Если термин нужен, коротко поясняешь его.
- Тон спокойный и поддерживающий, но честный: хвалишь за хорошие шаги и прямо предупреждаешь о рисках. Без осуждения и нравоучений.
- Ты помощник, а не начальник. Финальное решение всегда за пользователем.
- Важно: ты не лицензированный финансовый советник. Твои подсказки носят образовательный характер и основаны на данных пользователя. Для крупных и рискованных решений (кредиты, инвестиции, налоги, юридические вопросы) мягко советуй свериться с профильным специалистом.

Как ты работаешь с деньгами:
- Опираешься на реальные цифры пользователя из блока «СВОДКА ФИНАНСОВ» ниже. Если данных не хватает, честно говоришь об этом и просишь уточнить, а не выдумываешь.
- Все суммы в долларах США. Считаешь аккуратно и показываешь короткий расчёт, когда это помогает понять ответ.
- Помнишь про подушку безопасности, цели, долги и копилки: предлагаешь решения с учётом всей картины, а не одной цифры.

Метод разбора крупной покупки (применяй, когда пользователь думает что-то купить):
- 🟢 Зелёный: покупка по силам, подушка и цели не страдают. Можно брать.
- 🟡 Жёлтый: купить можно, но есть компромисс (просядут цели или свободные деньги). Объясни компромисс и предложи план.
- 🔴 Красный: покупка бьёт по подушке или обязательным расходам. Отговори мягко и предложи альтернативу.
- 📋 План: если хочется, но дорого - предложи накопить (на сколько месяцев и сколько откладывать).

Принципы:
- Сначала безопасность (подушка и обязательные платежи), потом цели, потом желания.
- Маленькие регулярные шаги важнее резких рывков.
- Долги с высокой нагрузкой гасим в приоритете.
- Никогда не советуешь то, что загоняет в минус или обнуляет подушку.

Формат ответа:
- Коротко и по делу. Маркированные списки вместо длинных абзацев, когда уместно.
- Не используешь длинное тире, только обычный дефис и двоеточие.
- В конце, если уместно, один понятный следующий шаг.`

// НАВЫК «Разбор покупки» (ИИ-4). Подмешивается в системный промпт, когда
// пользователь просит оценить конкретную покупку. Опирается на «СВОДКУ ФИНАНСОВ».
export const PURCHASE_SKILL = `НАВЫК: «Разбор покупки» (стоит ли покупать).
Пользователь думает о покупке. Разбери её строго по схеме и опираясь на блок «СВОДКА ФИНАНСОВ».

Шаги разбора:
1. Коротко повтори, что разбираем и за сколько (если цена названа).
2. Прикинь влияние на бюджет: хватает ли свободных денег и бюджета категорий «Цели/Хотелки» или «Свободные» в этом месяце, не залезает ли покупка в подушку, обязательные платежи и долги.
3. Дай вердикт одним из цветов и поясни почему:
   🟢 Зелёный: по силам, подушка и цели не страдают.
   🟡 Жёлтый: купить можно, но есть компромисс (просядут цели или свободные). Назови компромисс.
   🔴 Красный: бьёт по подушке и обязательным платежам или загоняет в минус. Мягко отговори.
4. 📋 План: если 🟡 или 🔴 либо покупка дорогая - предложи, сколько откладывать в месяц и за сколько месяцев накопится (с учётом доступного бюджета категории «Цели»).
5. Если данных не хватает (нет цены, неясна категория) - задай один короткий уточняющий вопрос вместо того чтобы выдумывать.

Формат ответа:
- Начни строкой-вердиктом с цветом, например «🟢 Можно брать» или «🔴 Лучше пока не стоит».
- Дальше 2-4 пункта обоснования с конкретными цифрами из сводки.
- В конце один понятный следующий шаг (или короткий план накопления).
- Без длинного тире, только дефис и двоеточие. Все суммы в долларах.`

// Формирует читаемый вопрос для разбора покупки. Показывается в чате как
// сообщение пользователя, поэтому пишем естественным языком.
export function buildPurchaseQuestion(item: string, price: string): string {
  const it = item.trim()
  const pr = price.trim()
  const priceText = pr ? ` примерно за ${pr}` : ''
  return `Разбери покупку по схеме 🟢🟡🔴📋: «${it}»${priceText}. Стоит ли мне это покупать сейчас?`
}

// ===== Навык «Действия» (ИИ-5): запись операций с подтверждением =====
// Ассистент умеет записывать за пользователя расход или доход. Чтобы это работало
// у обоих провайдеров (Grok и GLM) без серверных правок, мы НЕ используем «родной»
// function-calling, а просим модель добавить в конце ответа компактный блок ```action
// с JSON. Приложение распознаёт его, показывает кнопку подтверждения и только после
// согласия пользователя реально пишет в базу. Так соблюдается правило «действия только
// с подтверждением».
export const ACTIONS_SKILL = `НАВЫК: «Действия» (запись операций по просьбе пользователя).
Ты умеешь записывать за пользователя расход или доход. Делай это ТОЛЬКО когда пользователь явно просит записать, добавить, внести или потратить (например «запиши расход 20 на продукты», «добавь доход 1500 зарплата»).

Как оформить действие:
1. Сначала обычным языком коротко подтверди, что собираешься записать (сумма, категория или источник, дата если названа).
2. В САМОМ КОНЦЕ ответа добавь блок действия ровно в таком формате (тройные кавычки с меткой action):

\`\`\`action
{"type":"add_expense","amount":20,"category":"Обязательные","subcategory":"Продукты","note":"молоко","summary":"Записать расход $20.00 в «Обязательные / Продукты»"}
\`\`\`

Поля блока:
- type: "add_expense" (расход) или "add_income" (доход).
- amount: число в долларах, строго больше нуля.
- Для расхода: category (точное название категории из «СВОДКИ ФИНАНСОВ»), при желании subcategory и note.
- Для дохода: source (источник, например «Зарплата»), при желании note.
- date: "ГГГГ-ММ-ДД", только если пользователь назвал дату. Без даты поле не указывай - запишется на сегодня.
- summary: короткая фраза-подтверждение для пользователя.

Правила:
- category бери ТОЛЬКО из списка категорий пользователя в сводке. Если не уверен, какая категория - сначала задай один уточняющий вопрос и НЕ добавляй блок.
- Не добавляй блок action, если пользователь просто просит совет или размышляет вслух. Блок нужен только для реальной записи.
- В одном ответе максимум один блок action.
- Не проси подтверждать словами: приложение само покажет кнопку подтверждения.
- Никогда не выдумывай сумму. Если суммы нет - уточни.`

// ===== Справочник категорий (ИИ-6): для авто-категоризации =====
// Подсказывает мозгу, какие подкатегории обычно бывают в каждой категории, чтобы он
// сам подбирал категорию и подкатегорию по смыслу. Берём из встроенных пресетов
// (статично, без обращения к базе). Реальные названия категорий пользователя приходят
// отдельно в «СВОДКЕ ФИНАНСОВ».
export function buildCategoryGuide(): string {
  const lines: string[] = [
    'Категории и типичные подкатегории (подсказка для авто-категоризации, подкатегория не обязательна):',
  ]
  for (const [cat, subs] of Object.entries(SUBCATEGORY_PRESETS)) {
    lines.push(`- ${cat}: ${subs.join(', ')}`)
  }
  return lines.join('\n')
}

// ===== Навык «Быстрый ввод» (ИИ-6): авто-категоризация =====
// Пользователь коротко пишет трату/доход обычными словами (или диктует голосом), а
// мозг сам подбирает категорию, подкатегорию и сумму и предлагает запись. Запись
// по-прежнему проходит через подтверждение (тот же блок ```action из навыка «Действия»).
export const AUTOCAT_SKILL = `НАВЫК: «Быстрый ввод» (быстро записать трату или доход обычным текстом).
Пользователь коротко пишет, что потратил или получил, обычными словами (например «такси 30», «кофе 4.5», «зарплата 1500»). Твоя задача - быстро и без лишних вопросов оформить это как операцию.

Что делаешь:
1. Определи тип: трата (расход) или поступление (доход). Слова «потратил, купил, оплатил, такси, кафе, продукты» - расход. «Получил, зарплата, аванс, премия, вернули долг» - доход.
2. Определи сумму (число больше нуля). Если суммы нет совсем - коротко переспроси и НЕ добавляй блок.
3. Для расхода сам подбери категорию из категорий пользователя (в «СВОДКЕ ФИНАНСОВ») по смыслу, опираясь на справочник «Категории и типичные подкатегории». Подбери и подкатегорию, если она очевидна.
4. Для дохода подбери источник (source) по смыслу: зарплата, аванс, фриланс, подарок и т. п.
5. Дай очень короткий ответ (одна строка) и в самом конце добавь блок action (формат как в навыке «Действия»).

Правила:
- Не спрашивай подтверждения категории - пользователь увидит кнопку подтверждения и сможет отменить или поправить.
- Категорию бери только из категорий пользователя. Если ни одна не подходит идеально - выбери самую близкую по смыслу, не выдумывай новую.
- Всегда ровно один блок action на сообщение.
- Сумму не выдумывай. Нет суммы - переспроси одним коротким вопросом.
- Без длинного тире, только дефис и двоеточие. Все суммы в долларах.`

// ===== Навык «Разбор месяца и инсайты» (ИИ-7): анализ финансов =====
// Read-only навык: ассистент анализирует «СВОДКУ ФИНАНСОВ» и даёт выводы и советы.
// Никаких записей операций - блок action в этом навыке не добавляется.
export const ANALYSIS_SKILL = `НАВЫК: «Разбор месяца и инсайты» (анализ финансов и полезные выводы).
Пользователь хочет понять, как у него дела с деньгами, и получить конкретные выводы. Опирайся ТОЛЬКО на блок «СВОДКА ФИНАНСОВ».

Что делаешь:
1. Коротко оцени общую картину месяца: доход факт против плана, расходы на жизнь, остаток.
2. Найди главное: где перерасход (факт больше плана по категории) и где хорошо (уложился или отложил). Назови 2-4 конкретные категории с цифрами.
3. Оцени здоровье финансов: норма сбережений (сколько отложено от дохода), подушка (накоплено против цели), нагрузка по долгам.
4. Дай 2-3 конкретных и выполнимых совета на основе цифр (например «переложи X в подушку», «срежь категорию Y на Z»). Без общих фраз.
5. Если данных мало (нет дохода или расходов за месяц) - честно скажи и предложи, что внести.

Формат ответа:
- Начни одной строкой-итогом, например «📊 Месяц в целом в плюсе» или «⚠️ В этом месяце перерасход».
- Дальше короткие пункты с цифрами из сводки.
- В конце блок «Что сделать дальше» с 2-3 шагами.
- Только анализ и советы: операции не записывай, блок action не добавляй.
- Без длинного тире, только дефис и двоеточие. Все суммы в долларах.`

// Готовый вопрос для кнопки «Разбор месяца» (ИИ-7). Показывается в чате как обычное сообщение пользователя.
export function buildMonthlyReviewQuestion(): string {
  return 'Сделай разбор моего текущего месяца по сводке финансов: где перерасход, где хорошо, оцени норму сбережений, подушку и долги, и дай 2-3 конкретных совета. В конце короткий план «Что сделать дальше».'
}

// Действие, которое предлагает ассистент (распознаётся из блока ```action).
export type AiAction =
  | {
      type: 'add_expense'
      amount: number
      category: string | null
      subcategory: string | null
      date: string | null
      note: string | null
      summary: string | null
    }
  | {
      type: 'add_income'
      amount: number
      source: string | null
      date: string | null
      note: string | null
      summary: string | null
    }

// Результат разбора ответа: текст для показа (без служебного блока) и само действие.
export type ParsedReply = { text: string; action: AiAction | null }

const ACTION_BLOCK_RE = /```action\s*\n?([\s\S]*?)```/i

function isIsoDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null
}

// Приводит «сырой» объект из блока к безопасному действию или null.
function normalizeAction(raw: unknown): AiAction | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const amount = Math.round((Number(o.amount) || 0) * 100) / 100
  if (!Number.isFinite(amount) || amount <= 0) return null
  if (o.type === 'add_expense') {
    return {
      type: 'add_expense',
      amount,
      category: str(o.category),
      subcategory: str(o.subcategory),
      date: isIsoDate(o.date) ? o.date : null,
      note: str(o.note),
      summary: str(o.summary),
    }
  }
  if (o.type === 'add_income') {
    return {
      type: 'add_income',
      amount,
      source: str(o.source),
      date: isIsoDate(o.date) ? o.date : null,
      note: str(o.note),
      summary: str(o.summary),
    }
  }
  return null
}

// Достаёт действие из ответа модели и возвращает текст без служебного блока.
export function extractAction(reply: string): ParsedReply {
  const m = reply.match(ACTION_BLOCK_RE)
  if (!m) return { text: reply.trim(), action: null }
  let action: AiAction | null = null
  try {
    action = normalizeAction(JSON.parse(m[1].trim()))
  } catch {
    action = null
  }
  const text = reply.replace(m[0], '').trim()
  return { text, action }
}

// Человеческое описание действия для окна подтверждения.
export function describeAction(a: AiAction): string {
  if (a.summary) return a.summary
  const dateNote = a.date ? `, дата ${a.date}` : ''
  if (a.type === 'add_expense') {
    const cat = a.category ? `, категория «${a.category}»` : ''
    const sub = a.subcategory ? ` / ${a.subcategory}` : ''
    return `Записать расход ${formatSum(a.amount)}${cat}${sub}${dateNote}`
  }
  const src = a.source ? `, источник «${a.source}»` : ''
  return `Записать доход ${formatSum(a.amount)}${src}${dateNote}`
}

export type ActionResult = { ok: boolean; message: string }

// Реально выполняет подтверждённое действие: пишет расход или доход в базу.
// Возвращает короткое сообщение для показа в чате.
export async function runAction(userId: string, action: AiAction): Promise<ActionResult> {
  try {
    const today = new Date().toISOString().slice(0, 10)
    const date = action.date ?? today
    const d = new Date(date + 'T00:00:00')
    const m = await getOrCreateMonth(userId, d.getFullYear(), d.getMonth() + 1)

    if (action.type === 'add_expense') {
      // Сопоставляем название категории с её id (без учёта регистра).
      let categoryId: string | null = null
      let categoryMissing = false
      if (action.category) {
        const { data: cats } = await supabase
          .from('categories')
          .select('id, name')
          .eq('user_id', userId)
        const found = ((cats ?? []) as { id: string; name: string }[]).find(
          (c) => (c.name ?? '').trim().toLowerCase() === action.category!.trim().toLowerCase(),
        )
        categoryId = found?.id ?? null
        categoryMissing = !found
      }
      const { error } = await supabase.from('expenses').insert({
        user_id: userId,
        month_id: m.id,
        category_id: categoryId,
        subcategory: action.subcategory,
        amount: action.amount,
        date,
        description: action.note,
        paid_from_pot: null,
      })
      if (error) return { ok: false, message: 'Не удалось записать расход: ' + error.message }
      const catNote = action.category
        ? categoryMissing
          ? `, категория «${action.category}» не найдена - записал без категории`
          : `, категория «${action.category}»`
        : ''
      return { ok: true, message: `Записал расход ${formatSum(action.amount)}${catNote}.` }
    }

    const { error } = await supabase.from('incomes').insert({
      user_id: userId,
      month_id: m.id,
      amount: action.amount,
      date,
      source: action.source,
      description: action.note,
    })
    if (error) return { ok: false, message: 'Не удалось записать доход: ' + error.message }
    const srcNote = action.source ? `, источник «${action.source}»` : ''
    return { ok: true, message: `Записал доход ${formatSum(action.amount)}${srcNote}.` }
  } catch (e) {
    return { ok: false, message: 'Ошибка при записи: ' + String(e) }
  }
}

export type AiRole = 'user' | 'assistant'

export type AiMessage = {
  id: string
  role: AiRole
  content: string
  provider: string | null
  model: string | null
  created_at: string
}

// Загружает историю чата пользователя по возрастанию времени (старые сверху).
// limit ограничивает «хвост»: берём последние N сообщений и разворачиваем.
export async function loadAiMessages(userId: string, limit = 100): Promise<AiMessage[]> {
  const { data, error } = await supabase
    .from('ai_messages')
    .select('id, role, content, provider, model, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  const rows = (data ?? []) as AiMessage[]
  return rows.reverse()
}

// Сохраняет одно сообщение чата. provider/model заполняем только у ответов ИИ.
export async function saveAiMessage(
  userId: string,
  msg: { role: AiRole; content: string; provider?: string | null; model?: string | null },
): Promise<AiMessage | null> {
  const { data, error } = await supabase
    .from('ai_messages')
    .insert({
      user_id: userId,
      role: msg.role,
      content: msg.content,
      provider: msg.provider ?? null,
      model: msg.model ?? null,
    })
    .select('id, role, content, provider, model, created_at')
    .single()
  if (error) throw error
  return (data as AiMessage) ?? null
}

// Полностью очищает историю чата пользователя (кнопка «очистить» в UI).
export async function clearAiMessages(userId: string): Promise<void> {
  const { error } = await supabase.from('ai_messages').delete().eq('user_id', userId)
  if (error) throw error
}

export type AskResult = {
  reply: string
  provider: string | null
  model: string | null
  error?: string
}

// Сколько последних сообщений истории отправляем модели (бережём токены).
const HISTORY_WINDOW = 12

// Главная функция: задаёт вопрос ассистенту.
// Собирает системный промпт (SOUL + живые данные пользователя), добавляет хвост
// истории и новый вопрос, затем зовёт серверную функцию ai-chat.
// История (history) НЕ должна содержать новое сообщение пользователя - его передаём отдельно.
export async function askAssistant(
  userId: string,
  userText: string,
  history: AiMessage[],
  options?: { skill?: string | null },
): Promise<AskResult> {
  // Живая сводка финансов. Если собрать не удалось - продолжаем без неё.
  let context = ''
  try {
    context = await buildAiContext(userId)
  } catch {
    context = ''
  }

  // Системный промпт собираем слоями: SOUL + (нужный навык) + живые данные.
  const parts: string[] = [SOUL, ACTIONS_SKILL, buildCategoryGuide()]
  if (options?.skill) {
    parts.push(`===== НАВЫК (применяй для этого запроса) =====\n${options.skill}`)
  }
  if (context) {
    parts.push(`===== СВОДКА ФИНАНСОВ (актуальные данные пользователя) =====\n${context}`)
  }
  const system = parts.join('\n\n')

  const tail = history.slice(-HISTORY_WINDOW).map((m) => ({ role: m.role, content: m.content }))
  const messages = [...tail, { role: 'user' as const, content: userText }]

  const { data, error } = await supabase.functions.invoke('ai-chat', {
    body: { messages, system },
  })

  if (error) {
    return { reply: '', provider: null, model: null, error: 'network' }
  }
  const d = (data ?? {}) as { reply?: string; provider?: string; model?: string; error?: string }
  if (d.error || !d.reply) {
    return { reply: '', provider: null, model: null, error: d.error || 'empty' }
  }
  return { reply: d.reply, provider: d.provider ?? null, model: d.model ?? null }
}
