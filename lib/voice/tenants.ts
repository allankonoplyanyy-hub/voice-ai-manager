import type { KnowledgeDocument, VoiceTenant } from "./types"

// Demo-компании (multi-tenant). Каждая компания имеет собственную базу знаний,
// номер и настройки. Данные компаний строго изолированы по companyId.

export const DEMO_TENANTS: VoiceTenant[] = [
  {
    companyId: "school-astana",
    name: "Частная школа «Білім Плюс»",
    industry: "Образование",
    phoneNumber: "+7 (7172) 55-01-01",
    language: "ru",
    greeting: "Здравствуйте! Это голосовой ассистент школы «Білім Плюс». Чем могу помочь?",
    systemPrompt:
      "Ты — голосовой ассистент частной школы. Отвечай коротко и дружелюбно, один вопрос за реплику. Не придумывай цены и свободные места — используй только базу знаний.",
    criticalKeywords: ["жалоба директору", "суд", "прокуратура"],
    maxCallDurationSec: 600,
    maxCallCostTenge: 500,
    active: true,
    createdAt: "2026-06-01T09:00:00Z",
  },
  {
    companyId: "clinic-almaty",
    name: "Клиника «MedCity»",
    industry: "Медицина",
    phoneNumber: "+7 (727) 300-22-33",
    language: "ru",
    greeting: "Добрый день! Клиника MedCity, голосовой ассистент. Слушаю вас.",
    systemPrompt:
      "Ты — голосовой ассистент клиники. Не давай медицинских рекомендаций и гарантий. Записывай на приём, отвечай по базе знаний, при сложных медицинских вопросах передавай администратору.",
    criticalKeywords: ["осложнение", "врачебная ошибка", "жалоба"],
    maxCallDurationSec: 480,
    maxCallCostTenge: 400,
    active: true,
    createdAt: "2026-06-05T09:00:00Z",
  },
  {
    companyId: "beauty-astana",
    name: "Салон красоты «Aura»",
    industry: "Красота",
    phoneNumber: "+7 (7172) 44-77-88",
    language: "ru",
    greeting: "Здравствуйте! Салон красоты Aura. Я голосовой ассистент, помогу записаться.",
    systemPrompt:
      "Ты — ассистент салона красоты. Тон лёгкий и приветливый. Уточняй мастера и услугу, предлагай только реально свободные слоты из базы.",
    criticalKeywords: ["аллергия", "ожог"],
    maxCallDurationSec: 420,
    maxCallCostTenge: 300,
    active: true,
    createdAt: "2026-06-10T09:00:00Z",
  },
  {
    companyId: "auto-almaty",
    name: "Автосервис «TopGear KZ»",
    industry: "Автосервис",
    phoneNumber: "+7 (727) 250-90-90",
    language: "ru",
    greeting: "Здравствуйте! Автосервис TopGear. Голосовой ассистент на связи.",
    systemPrompt:
      "Ты — ассистент автосервиса. Уточняй марку, модель и проблему. Не называй точную стоимость ремонта без диагностики — только диапазоны из базы знаний.",
    criticalKeywords: ["гарантийный спор", "испортили машину"],
    maxCallDurationSec: 480,
    maxCallCostTenge: 350,
    active: true,
    createdAt: "2026-06-12T09:00:00Z",
  },
  {
    companyId: "realty-astana",
    name: "Агентство недвижимости «Astana Estate»",
    industry: "Недвижимость",
    phoneNumber: "+7 (7172) 60-11-22",
    language: "ru",
    greeting: "Добрый день! Astana Estate, голосовой ассистент. Подбираем недвижимость.",
    systemPrompt:
      "Ты — ассистент агентства недвижимости. Квалифицируй: покупка/аренда, бюджет, район, сроки. Сделки дороже 80 млн тенге — передавай старшему брокеру.",
    criticalKeywords: ["задаток пропал", "обман"],
    maxCallDurationSec: 600,
    maxCallCostTenge: 500,
    active: true,
    createdAt: "2026-06-15T09:00:00Z",
  },
  {
    companyId: "resto-almaty",
    name: "Ресторан «Dastarkhan»",
    industry: "Рестораны",
    phoneNumber: "+7 (727) 311-55-66",
    language: "ru",
    greeting: "Добрый вечер! Ресторан Dastarkhan. Я помогу забронировать столик.",
    systemPrompt:
      "Ты — ассистент ресторана. Бронируй столики, отвечай про меню и банкеты по базе знаний. Банкеты от 30 человек — передавай администратору.",
    criticalKeywords: ["отравление"],
    maxCallDurationSec: 300,
    maxCallCostTenge: 250,
    active: true,
    createdAt: "2026-06-18T09:00:00Z",
  },
  {
    companyId: "shop-online",
    name: "Интернет-магазин «TezShop»",
    industry: "E-commerce",
    phoneNumber: "+7 (700) 555-00-11",
    language: "ru",
    greeting: "Здравствуйте! TezShop, голосовой ассистент. Помогу с заказом или доставкой.",
    systemPrompt:
      "Ты — ассистент интернет-магазина. Помогай со статусом заказа, возвратами и доставкой. Претензии по повреждённому товару — передавай менеджеру.",
    criticalKeywords: ["возврат денег", "роспотребнадзор"],
    maxCallDurationSec: 360,
    maxCallCostTenge: 300,
    active: true,
    createdAt: "2026-06-20T09:00:00Z",
  },
]

const doc = (
  companyId: string,
  id: string,
  category: KnowledgeDocument["category"],
  title: string,
  content: string,
): KnowledgeDocument => ({
  id: `${companyId}-${id}`,
  companyId,
  category,
  title,
  content,
  updatedAt: "2026-07-01T10:00:00Z",
})

export const DEMO_KNOWLEDGE: KnowledgeDocument[] = [
  // Школа
  doc("school-astana", "about", "about", "О школе", "Частная школа «Білім Плюс» в Астане, классы 1–11, обучение на русском и казахском. Лицензия МОН РК. До 16 учеников в классе."),
  doc("school-astana", "services", "services", "Программы", "Начальная школа, средняя школа, подготовка к ЕНТ, продлёнка до 18:00, кружки: робототехника, шахматы, английский."),
  doc("school-astana", "pricing", "pricing", "Стоимость", "1–4 класс: 180 000 ₸/мес. 5–9 класс: 200 000 ₸/мес. 10–11 класс: 220 000 ₸/мес. Вступительный взнос 150 000 ₸. Скидка 10% за второго ребёнка."),
  doc("school-astana", "schedule", "schedule", "График", "Учебные дни пн–пт 08:30–15:30. Продлёнка до 18:00. Приёмная комиссия: пн–сб 09:00–17:00."),
  doc("school-astana", "address", "address", "Адрес", "г. Астана, ул. Кабанбай батыра 42, 3 этаж. Парковка для родителей бесплатная."),
  doc("school-astana", "faq", "faq", "FAQ", "Есть ли места в 1 класс? — На 2026/27 год есть 8 мест. Питание? — Трёхразовое, включено. Форма? — Да, заказывается через школу."),
  doc("school-astana", "forbidden", "forbidden", "Запрещённые ответы", "Не обещать поступление без собеседования. Не гарантировать результаты ЕНТ. Не обсуждать других учеников."),
  doc("school-astana", "handoff_rules", "handoff_rules", "Передача менеджеру", "Передавать: вопросы о переводе из другой школы с задолженностью, конфликтные ситуации, индивидуальные скидки."),
  // Клиника
  doc("clinic-almaty", "about", "about", "О клинике", "Многопрофильная клиника MedCity в Алматы: терапия, кардиология, УЗИ, анализы, стоматология."),
  doc("clinic-almaty", "services", "services", "Услуги", "Приём терапевта, кардиолога, невролога. УЗИ, ЭКГ, лабораторные анализы, стоматология."),
  doc("clinic-almaty", "pricing", "pricing", "Цены", "Приём терапевта 8 000 ₸, кардиолога 12 000 ₸, УЗИ от 7 000 ₸, общий анализ крови 3 500 ₸."),
  doc("clinic-almaty", "schedule", "schedule", "График", "Пн–сб 08:00–20:00, вс 09:00–15:00. Анализы сдаются с 08:00 до 11:00 натощак."),
  doc("clinic-almaty", "address", "address", "Адрес", "г. Алматы, ул. Абая 150, 2 этаж. Рядом станция метро Абая."),
  doc("clinic-almaty", "rules", "rules", "Правила", "Ассистент не ставит диагнозы, не рекомендует лекарства, не интерпретирует анализы. Только запись и справочная информация."),
  doc("clinic-almaty", "handoff_rules", "handoff_rules", "Передача администратору", "Передавать: вопросы об осложнениях, жалобы, срочные состояния (рекомендовать 103), вопросы по конкретному лечению."),
  // Салон
  doc("beauty-astana", "services", "services", "Услуги", "Стрижки, окрашивание, маникюр, педикюр, брови, макияж. Мастера: Аружан (волосы), Дана (ногти), Камила (брови)."),
  doc("beauty-astana", "pricing", "pricing", "Цены", "Женская стрижка от 8 000 ₸, окрашивание от 20 000 ₸, маникюр с покрытием 7 000 ₸, коррекция бровей 4 000 ₸."),
  doc("beauty-astana", "schedule", "schedule", "График", "Ежедневно 10:00–21:00, без выходных."),
  doc("beauty-astana", "address", "address", "Адрес", "г. Астана, пр. Туран 37, ТЦ «Керуен», 2 этаж."),
  // Автосервис
  doc("auto-almaty", "services", "services", "Услуги", "Диагностика, ТО, ремонт ходовой, замена масла, шиномонтаж, автоэлектрика. Работаем со всеми марками."),
  doc("auto-almaty", "pricing", "pricing", "Цены", "Компьютерная диагностика 10 000 ₸ (бесплатно при ремонте у нас). Замена масла от 5 000 ₸ + материалы. Ремонт ходовой — после диагностики."),
  doc("auto-almaty", "schedule", "schedule", "График", "Пн–сб 09:00–19:00. Воскресенье — выходной."),
  doc("auto-almaty", "address", "address", "Адрес", "г. Алматы, ул. Рыскулова 103Б."),
  // Недвижимость
  doc("realty-astana", "services", "services", "Услуги", "Продажа и аренда квартир и коммерческой недвижимости в Астане. Ипотечное сопровождение, юридическая проверка."),
  doc("realty-astana", "pricing", "pricing", "Комиссия", "Покупка: комиссия 1,5% от сделки. Аренда: 50% месячной ставки. Юридическая проверка объекта 80 000 ₸."),
  doc("realty-astana", "handoff_rules", "handoff_rules", "Передача брокеру", "Сделки от 80 млн ₸, коммерческая недвижимость от 200 м², VIP-клиенты — передавать старшему брокеру."),
  // Ресторан
  doc("resto-almaty", "services", "services", "Меню и залы", "Казахская и европейская кухня. Основной зал 60 мест, VIP-кабинки, банкетный зал до 100 человек. Средний чек 12 000 ₸."),
  doc("resto-almaty", "schedule", "schedule", "График", "Ежедневно 12:00–00:00. Бронь столиков бесплатная, депозит только для банкетов."),
  doc("resto-almaty", "address", "address", "Адрес", "г. Алматы, пр. Достык 91."),
  // Магазин
  doc("shop-online", "services", "services", "Доставка и возврат", "Доставка по Казахстану 2–5 дней, по Алматы и Астане — на следующий день. Возврат 14 дней. Оплата: Kaspi, карта, наличные при получении."),
  doc("shop-online", "faq", "faq", "FAQ", "Где мой заказ? — Ассистент проверяет статус по номеру заказа. Как вернуть товар? — Заявка на возврат оформляется ассистентом, курьер заберёт товар."),
]

export function getTenant(companyId: string): VoiceTenant | undefined {
  return DEMO_TENANTS.find((t) => t.companyId === companyId)
}

export function getKnowledge(companyId: string): KnowledgeDocument[] {
  // Изоляция: возвращаются только документы данной компании
  return DEMO_KNOWLEDGE.filter((d) => d.companyId === companyId)
}
