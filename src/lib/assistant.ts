import { supabase } from './supabase'
import { buildAiContext } from './db'

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
  const parts: string[] = [SOUL]
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
