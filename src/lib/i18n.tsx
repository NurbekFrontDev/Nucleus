import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { setDbLang } from './db'

export type Lang = 'ru' | 'en'

const STORAGE_KEY = 'finlit-lang'

function getInitial(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'ru' || saved === 'en') return saved
  } catch {
    // localStorage может быть недоступен
  }
  return 'ru'
}

// Синхронный модульный флаг языка — чтобы tr()/месяцы работали и вне React.
let currentLang: Lang = getInitial()
setDbLang(currentLang)

// ===== UI-строки (ключ → перевод) =====
const UI: Record<Lang, Record<string, string>> = {
  ru: {
    'app.loading': 'Загрузка…',
    'common.loading': 'Загрузка…',
    'common.save': 'Сохранить',
    'common.saving': 'Сохранение…',
    'common.cancel': 'Отмена',
    'common.delete': 'Удалить',
    'common.edit': 'Изменить',
    'common.add': 'Добавить',
    'common.confirm': 'Подтвердить',
    'common.amount': 'Сумма',
    'common.category': 'Категория',
    'common.descOptional': 'Описание (необязательно)',
    'common.desc': 'Описание',
    'common.sort': 'Сортировка:',
    'common.sortNew': 'Сначала новые',
    'common.sortOld': 'Сначала старые',
    'common.choose': 'Выбрать…',
    'common.enterPositive': 'Введите сумму больше нуля',
    'common.saveFailed': 'Не удалось сохранить',
    'common.editFailed': 'Не удалось изменить',
    'common.error': 'Ошибка',
    'common.byRate': 'по курсу',

    'nav.dashboard': 'Дашборд',
    'nav.incomes': 'Доходы',
    'nav.expenses': 'Расходы',
    'nav.budget': 'Бюджет',
    'nav.goals': 'Цели',
    'nav.history': 'История',
    'nav.settings': 'Настройки',
    'nav.tagline': 'Личный помощник по финансам',

    'login.tagline': 'Личный помощник по финансам',
    'login.email': 'Email',
    'login.password': 'Пароль',
    'login.wait': 'Подождите…',
    'login.signin': 'Войти',
    'login.signup': 'Зарегистрироваться',
    'login.toSignup': 'Нет аккаунта? Зарегистрироваться',
    'login.toSignin': 'Уже есть аккаунт? Войти',
    'login.created': 'Аккаунт создан! Если включено подтверждение по email — проверь почту, иначе можно сразу войти.',

    'dash.title': 'Дашборд',
    'dash.incomeGoal': 'Цель по доходу',
    'dash.incomeFact': 'Доход (факт)',
    'dash.expenseFact': 'Расходы (факт)',
    'dash.saved': 'Уже отложено',
    'dash.addIncomeHint': '⚠️ Добавь доходы во вкладке «Доходы» — проценты категорий распределят реально полученные деньги.',
    'dash.planVsFact': 'План против факта по категориям',
    'dash.remainder': 'Остаток: {v}',
    'dash.overspent': 'Превышение: {v}',

    'budget.title': 'Бюджет / План',
    'budget.received': 'Получено в этом месяце',
    'budget.incomeGoal': 'Цель по доходу (ориентир)',
    'budget.incomeGoalPh': 'Например, 10 000 000',
    'budget.catsPercents': 'Категории и проценты',
    'budget.total': 'Сумма: {p}%',
    'budget.thisMonth': 'В этом месяце',
    'budget.newCat': 'Новая категория',
    'budget.add': '+ Добавить',
    'budget.percentWarn': '⚠️ Сумма процентов = {p}%. Рекомендуется ровно 100%.',
    'budget.dupName': 'Категория с таким названием уже есть.',
    'budget.addFailed': 'Не удалось добавить категорию',
    'budget.deleteTitle': 'Удалить категорию?',
    'budget.deleteMsg': 'Категория «{n}» будет убрана из списка. Прошлые расходы останутся в истории с пометкой «(удалена)».',
    'budget.dragHint': 'Перетащи, чтобы изменить порядок (нажми — меню)',
    'budget.menuEdit': '✏️ Изменить',
    'budget.menuDelete': '🗑️ Удалить',
    'budget.design': 'Вид {n}',
    'budget.designTitle': 'Переключить дизайн карточек',

    'inc.title': 'Доходы',
    'inc.total': 'Итого:',
    'inc.source': 'Источник дохода (напр. Зарплата)',
    'inc.sourceShort': 'Источник дохода',
    'inc.addBtn': 'Добавить доход',
    'inc.empty': 'За этот период доходов нет.',
    'inc.rate': 'Курс: 1 {c} ≈ {v}',
    'inc.convApprox': '≈ {v} ({by})',

    'exp.title': 'Расходы',
    'exp.sub': 'Подкатегория (напр. Интернет)',
    'exp.subShort': 'Подкатегория',
    'exp.addBtn': 'Добавить расход',
    'exp.empty': 'За этот период расходов нет.',
    'exp.deleted': '(удалена)',

    'goals.title': 'Цели и желания',
    'goals.addWish': '➕ Добавить в список желаний',
    'goals.wishName': 'Что хочу (напр. iPhone, визит к стоматологу)',
    'goals.priceApprox': 'Примерная цена (необязательно)',
    'goals.note': 'Заметка (необязательно)',
    'goals.adding': 'Добавление…',
    'goals.active': '🎯 Активные цели',
    'goals.noActive': 'Пока нет активных целей.',
    'goals.by': 'до {d}',
    'goals.collected': 'Собрано',
    'goals.left': 'Осталось',
    'goals.perMonth': 'В месяц',
    'goals.target': 'Цель: {v}',
    'goals.howMuch': 'Сколько отложить',
    'goals.setAside': 'Отложить',
    'goals.setAsideBtn': '💰 Отложить',
    'goals.bought': '✅ Куплено',
    'goals.makeGoalBtn': '🎯 Сделать целью',
    'goals.makeGoal': 'Сделать целью',
    'goals.goalAmount': 'Сумма цели',
    'goals.contribs': 'Вклады ({n})',
    'goals.toExpenses': '🛒 Записать в расходы',
    'goals.purchaseAmount': 'Сумма покупки',
    'goals.subOptional': 'Подкатегория (необязательно)',
    'goals.willBeExpense': '«{n}» попадёт в расходы на {v}.',
    'goals.recordExpense': 'Записать в расходы',
    'goals.noExpense': 'Без расхода',
    'goals.wantBuy': '🛒 Хочу купить',
    'goals.emptyList': 'Список пуст.',
    'goals.byPriority': 'По важности',
    'goals.done': '✅ Достигнуто / куплено',
    'goals.inExpenses': 'в расходах',
    'goals.restore': 'Вернуть',
    'goals.errAmount': 'Укажи сумму',
    'goals.errGoalAmount': 'Укажи сумму цели',
    'goals.errBuyAmount': 'Укажи сумму покупки',
    'goals.errAdd': 'Не удалось добавить',

    'hist.title': 'История',
    'hist.empty': 'Пока нет данных. Добавь доходы и расходы — месяцы появятся здесь.',
    'hist.plan': 'План',
    'hist.income': 'Доход',
    'hist.expense': 'Расход',
    'hist.planDone': 'План выполнен на {p}%',
    'hist.incomeBySource': '💰 Доходы по источникам',
    'hist.noIncome': 'Нет доходов',
    'hist.expenseBySub': '🛒 Расходы по подкатегориям',
    'hist.noExpense': 'Нет расходов',
    'hist.noSource': 'Без источника',
    'hist.other': 'Прочее',

    'set.title': 'Настройки',
    'set.signedInAs': 'Вошёл как',
    'set.theme': 'Тема оформления',
    'set.themeNow': 'Сейчас: {v}',
    'set.dark': 'тёмная',
    'set.light': 'светлая',
    'set.toLight': '☀️ Светлая',
    'set.toDark': '🌙 Тёмная',
    'set.language': 'Язык',
    'set.langNow': 'Сейчас: {v}',
    'set.currencies': '💱 Валюты и курс',
    'set.onlyBase': 'Пока добавлен только сум. Добавь валюту ниже.',
    'set.baseUnit': 'сум',
    'set.refreshRate': '↻ Курс',
    'set.refreshTitle': 'Подтянуть актуальный курс',
    'set.chooseCur': 'Выбери валюту…',
    'set.rateInBase': 'Курс в сумах',
    'set.rateNow': '↻ Курс сейчас',
    'set.addCurrency': 'Добавить валюту',
    'set.preview': 'Предпросмотр: 1 {c} = {v} сум',
    'set.signOut': 'Выйти',
    'set.errChooseFirst': 'Сначала выбери валюту из списка',
    'set.errAutoFail': 'Не удалось получить курс автоматически — впиши вручную',
    'set.errChoose': 'Выбери валюту из списка',
    'set.errRate': 'Укажи курс в сумах (вручную или кнопкой «Курс сейчас»)',
    'set.errAddFail': 'Не удалось добавить',
    'set.errRefreshFail': 'Не удалось обновить курс автоматически',

    'date.select': 'Выберите дату',
    'date.clear': 'Очистить',
    'date.today': 'Сегодня',

    'period.day': 'День',
    'period.week': 'Неделя',
    'period.month': 'Месяц',
    'period.year': 'Год',
    'period.all': 'Всё',
    'period.range': 'Период',
    'period.allTime': 'Всё время',

    'range.pickEnd': 'Выберите конечную дату…',
    'range.pickStart': 'Нажмите начальную дату, затем конечную',

    'backup.title': 'Пора сделать бэкап',
    'backup.sub': 'Прошёл месяц с последней резервной копии. Это займёт пару минут и защитит твои данные.',
    'backup.how': 'Как сделать бэкап',
    'backup.way1': 'Способ 1 — экспорт в CSV (просто)',
    'backup.way1s1': 'Открой Supabase → Table Editor.',
    'backup.way1s2': 'Для каждой таблицы ({t}) нажми Export → Export to CSV.',
    'backup.way1s3': 'Сохрани файлы в Google Drive или на компьютер.',
    'backup.way2': 'Способ 2 — одной командой (Supabase CLI)',
    'backup.once': 'Один раз:',
    'backup.each': 'Каждый раз:',
    'backup.warn': '⚠️ Не заливай файл бэкапа в Git — репозиторий публичный. Храни его отдельно.',
    'backup.done': '✅ Готово',
    'backup.later': 'Позже',
  },
  en: {
    'app.loading': 'Loading…',
    'common.loading': 'Loading…',
    'common.save': 'Save',
    'common.saving': 'Saving…',
    'common.cancel': 'Cancel',
    'common.delete': 'Delete',
    'common.edit': 'Edit',
    'common.add': 'Add',
    'common.confirm': 'Confirm',
    'common.amount': 'Amount',
    'common.category': 'Category',
    'common.descOptional': 'Description (optional)',
    'common.desc': 'Description',
    'common.sort': 'Sort:',
    'common.sortNew': 'Newest first',
    'common.sortOld': 'Oldest first',
    'common.choose': 'Select…',
    'common.enterPositive': 'Enter an amount greater than zero',
    'common.saveFailed': 'Could not save',
    'common.editFailed': 'Could not update',
    'common.error': 'Error',
    'common.byRate': 'converted',

    'nav.dashboard': 'Dashboard',
    'nav.incomes': 'Income',
    'nav.expenses': 'Expenses',
    'nav.budget': 'Budget',
    'nav.goals': 'Goals',
    'nav.history': 'History',
    'nav.settings': 'Settings',
    'nav.tagline': 'Your personal finance assistant',

    'login.tagline': 'Your personal finance assistant',
    'login.email': 'Email',
    'login.password': 'Password',
    'login.wait': 'Please wait…',
    'login.signin': 'Sign in',
    'login.signup': 'Sign up',
    'login.toSignup': "Don't have an account? Sign up",
    'login.toSignin': 'Already have an account? Sign in',
    'login.created': 'Account created! If email confirmation is enabled, check your inbox; otherwise you can sign in right away.',

    'dash.title': 'Dashboard',
    'dash.incomeGoal': 'Income goal',
    'dash.incomeFact': 'Income (actual)',
    'dash.expenseFact': 'Expenses (actual)',
    'dash.saved': 'Already saved',
    'dash.addIncomeHint': '⚠️ Add income on the “Income” tab — category percentages will allocate the money you actually received.',
    'dash.planVsFact': 'Planned vs actual by category',
    'dash.remainder': 'Remaining: {v}',
    'dash.overspent': 'Over by: {v}',

    'budget.title': 'Budget / Plan',
    'budget.received': 'Received this month',
    'budget.incomeGoal': 'Income goal (reference)',
    'budget.incomeGoalPh': 'e.g. 10,000,000',
    'budget.catsPercents': 'Categories & percentages',
    'budget.total': 'Total: {p}%',
    'budget.thisMonth': 'This month',
    'budget.newCat': 'New category',
    'budget.add': '+ Add',
    'budget.percentWarn': '⚠️ Percentages total {p}%. Exactly 100% is recommended.',
    'budget.dupName': 'A category with this name already exists.',
    'budget.addFailed': 'Could not add the category',
    'budget.deleteTitle': 'Delete category?',
    'budget.deleteMsg': 'The “{n}” category will be removed from the list. Past expenses will stay in history marked “(deleted)”.',
    'budget.dragHint': 'Drag to reorder (tap for menu)',
    'budget.menuEdit': '✏️ Edit',
    'budget.menuDelete': '🗑️ Delete',
    'budget.design': 'Layout {n}',
    'budget.designTitle': 'Switch card layout',

    'inc.title': 'Income',
    'inc.total': 'Total:',
    'inc.source': 'Income source (e.g. Salary)',
    'inc.sourceShort': 'Income source',
    'inc.addBtn': 'Add income',
    'inc.empty': 'No income for this period.',
    'inc.rate': 'Rate: 1 {c} ≈ {v}',
    'inc.convApprox': '≈ {v} ({by})',

    'exp.title': 'Expenses',
    'exp.sub': 'Subcategory (e.g. Internet)',
    'exp.subShort': 'Subcategory',
    'exp.addBtn': 'Add expense',
    'exp.empty': 'No expenses for this period.',
    'exp.deleted': '(deleted)',

    'goals.title': 'Goals & wishes',
    'goals.addWish': '➕ Add to wishlist',
    'goals.wishName': 'What I want (e.g. iPhone, dentist visit)',
    'goals.priceApprox': 'Approx. price (optional)',
    'goals.note': 'Note (optional)',
    'goals.adding': 'Adding…',
    'goals.active': '🎯 Active goals',
    'goals.noActive': 'No active goals yet.',
    'goals.by': 'by {d}',
    'goals.collected': 'Saved',
    'goals.left': 'Left',
    'goals.perMonth': 'Per month',
    'goals.target': 'Target: {v}',
    'goals.howMuch': 'How much to set aside',
    'goals.setAside': 'Set aside',
    'goals.setAsideBtn': '💰 Set aside',
    'goals.bought': '✅ Bought',
    'goals.makeGoalBtn': '🎯 Make a goal',
    'goals.makeGoal': 'Make a goal',
    'goals.goalAmount': 'Goal amount',
    'goals.contribs': 'Contributions ({n})',
    'goals.toExpenses': '🛒 Add to expenses',
    'goals.purchaseAmount': 'Purchase amount',
    'goals.subOptional': 'Subcategory (optional)',
    'goals.willBeExpense': '“{n}” will be added to expenses for {v}.',
    'goals.recordExpense': 'Add to expenses',
    'goals.noExpense': 'No expense',
    'goals.wantBuy': '🛒 Want to buy',
    'goals.emptyList': 'The list is empty.',
    'goals.byPriority': 'By priority',
    'goals.done': '✅ Achieved / bought',
    'goals.inExpenses': 'in expenses',
    'goals.restore': 'Restore',
    'goals.errAmount': 'Enter an amount',
    'goals.errGoalAmount': 'Enter the goal amount',
    'goals.errBuyAmount': 'Enter the purchase amount',
    'goals.errAdd': 'Could not add',

    'hist.title': 'History',
    'hist.empty': 'No data yet. Add income and expenses — months will appear here.',
    'hist.plan': 'Plan',
    'hist.income': 'Income',
    'hist.expense': 'Expense',
    'hist.planDone': 'Plan completed: {p}%',
    'hist.incomeBySource': '💰 Income by source',
    'hist.noIncome': 'No income',
    'hist.expenseBySub': '🛒 Expenses by subcategory',
    'hist.noExpense': 'No expenses',
    'hist.noSource': 'No source',
    'hist.other': 'Other',

    'set.title': 'Settings',
    'set.signedInAs': 'Signed in as',
    'set.theme': 'Theme',
    'set.themeNow': 'Current: {v}',
    'set.dark': 'Dark',
    'set.light': 'Light',
    'set.toLight': '☀️ Light',
    'set.toDark': '🌙 Dark',
    'set.language': 'Language',
    'set.langNow': 'Current: {v}',
    'set.currencies': '💱 Currencies & rates',
    'set.onlyBase': "Only so'm is added so far. Add a currency below.",
    'set.baseUnit': "so'm",
    'set.refreshRate': '↻ Rate',
    'set.refreshTitle': 'Fetch the current rate',
    'set.chooseCur': 'Choose a currency…',
    'set.rateInBase': "Rate in so'm",
    'set.rateNow': '↻ Get rate',
    'set.addCurrency': 'Add currency',
    'set.preview': "Preview: 1 {c} = {v} so'm",
    'set.signOut': 'Sign out',
    'set.errChooseFirst': 'First choose a currency from the list',
    'set.errAutoFail': 'Could not fetch the rate automatically — enter it manually',
    'set.errChoose': 'Choose a currency from the list',
    'set.errRate': "Enter the rate in so'm (manually or via the “Get rate” button)",
    'set.errAddFail': 'Could not add',
    'set.errRefreshFail': 'Could not refresh the rate automatically',

    'date.select': 'Select date',
    'date.clear': 'Clear',
    'date.today': 'Today',

    'period.day': 'Day',
    'period.week': 'Week',
    'period.month': 'Month',
    'period.year': 'Year',
    'period.all': 'All',
    'period.range': 'Range',
    'period.allTime': 'All time',

    'range.pickEnd': 'Select the end date…',
    'range.pickStart': 'Tap the start date, then the end date',

    'backup.title': 'Time to back up',
    'backup.sub': "It's been a month since your last backup. It takes a couple of minutes and protects your data.",
    'backup.how': 'How to back up',
    'backup.way1': 'Option 1 — export to CSV (easy)',
    'backup.way1s1': 'Open Supabase → Table Editor.',
    'backup.way1s2': 'For each table ({t}) click Export → Export to CSV.',
    'backup.way1s3': 'Save the files to Google Drive or your computer.',
    'backup.way2': 'Option 2 — one command (Supabase CLI)',
    'backup.once': 'Once:',
    'backup.each': 'Each time:',
    'backup.warn': "⚠️ Don't push the backup file to Git — the repo is public. Keep it separately.",
    'backup.done': '✅ Done',
    'backup.later': 'Later',
  },
}

// ===== Перевод контента из БД/пресетов (русский → английский) =====
// Имена категорий, источников, подкатегорий, валют и стран.
const CONTENT_EN: Record<string, string> = {
  // Категории бюджета
  'Сбережения': 'Savings',
  'Инвестиции': 'Investments',
  'Долги': 'Debt',
  'Обязательные': 'Essentials',
  'Цели/Хотелки': 'Goals/Wishes',
  'Цели и хотелки': 'Goals & wishes',
  'Свободные': 'Discretionary',
  'Благотворительность': 'Charity',
  // Источники дохода
  'Зарплата': 'Salary',
  'Аванс': 'Advance',
  'Фриланс': 'Freelance',
  'Подработка': 'Side job',
  'Бизнес': 'Business',
  'Проценты по вкладу': 'Deposit interest',
  'Подарок': 'Gift',
  'Возврат долга': 'Debt repayment',
  'Другое': 'Other',
  // Подкатегории
  'Аренда жилья': 'Rent',
  'Коммуналка': 'Utilities',
  'Интернет': 'Internet',
  'Связь': 'Mobile',
  'Продукты': 'Groceries',
  'Транспорт': 'Transport',
  'Здоровье': 'Health',
  'Одежда': 'Clothing',
  'Кафе и рестораны': 'Cafés & restaurants',
  'Развлечения': 'Entertainment',
  'Путешествия': 'Travel',
  'Техника': 'Electronics',
  'Подарки': 'Gifts',
  'Кредит': 'Loan',
  'Рассрочка': 'Installments',
  'Долг другу': 'Loan to a friend',
  'Подписки': 'Subscriptions',
  'Хобби': 'Hobbies',
  'Разное': 'Misc',
  'Подушка безопасности': 'Emergency fund',
  'Накопления': 'Savings',
  'Акции': 'Stocks',
  'Криптовалюта': 'Crypto',
  'Вклад': 'Deposit',
  // Названия валют
  'Доллар': 'Dollar',
  'Евро': 'Euro',
  'Рубль': 'Ruble',
  'Тенге': 'Tenge',
  'Сом': 'Som',
  'Лира': 'Lira',
  'Юань': 'Yuan',
  'Фунт': 'Pound',
  'Дирхам': 'Dirham',
  'Вона': 'Won',
  // Страны
  'США': 'USA',
  'Евросоюз': 'Eurozone',
  'Россия': 'Russia',
  'Казахстан': 'Kazakhstan',
  'Киргизия': 'Kyrgyzstan',
  'Турция': 'Turkey',
  'Китай': 'China',
  'Великобритания': 'UK',
  'ОАЭ': 'UAE',
  'Южная Корея': 'South Korea',
}

function interpolate(s: string, vars?: Record<string, string | number>) {
  if (!vars) return s
  let out = s
  for (const k of Object.keys(vars)) out = out.replace('{' + k + '}', String(vars[k]))
  return out
}

export function translate(lang: Lang, key: string, vars?: Record<string, string | number>) {
  const s = UI[lang][key] ?? UI.ru[key] ?? key
  return interpolate(s, vars)
}

// Перевод контента (названия из БД). Для пользовательских значений — возвращаем как есть.
export function translateContent(lang: Lang, value: string | null | undefined): string {
  if (!value) return value ?? ''
  if (lang === 'ru') return value
  return CONTENT_EN[value] ?? value
}

type Ctx = {
  lang: Lang
  setLang: (l: Lang) => void
  t: (key: string, vars?: Record<string, string | number>) => string
  tr: (value: string | null | undefined) => string
}

const LangContext = createContext<Ctx | undefined>(undefined)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(currentLang)

  useEffect(() => {
    currentLang = lang
    setDbLang(lang)
    try {
      localStorage.setItem(STORAGE_KEY, lang)
    } catch {
      // игнорируем
    }
    document.documentElement.lang = lang
  }, [lang])

  const setLang = (l: Lang) => {
    currentLang = l
    setDbLang(l)
    setLangState(l)
  }

  const value: Ctx = {
    lang,
    setLang,
    t: (key, vars) => translate(lang, key, vars),
    tr: (v) => translateContent(lang, v),
  }

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useLang() {
  const ctx = useContext(LangContext)
  if (!ctx) throw new Error('useLang must be used within LanguageProvider')
  return ctx
}
