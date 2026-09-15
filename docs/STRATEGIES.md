# STRATEGIES — Лаборатория торговых и аналитических стратегий

> **Статус:** Концептуальная архитектура (Этап 1: Документация и демонстрационное превью; Этап 3+: Engine)

---

## 1. Концепция Strategy Lab

Strategy Lab — это среда конструирования детерминированных правил на основе комбинаций рыночных условий:

### Пример структуры правила:
```yaml
strategy:
  name: "Negative Funding & High OI Breakout"
  instrument_filter: "Top 50 by Volume"
  timeframe: "4h"
  conditions_entry_long:
    - indicator: "FundingRate"
      operator: "<"
      value: -0.015
    - indicator: "OI_Change_24h"
      operator: ">"
      value: 5.0
    - indicator: "Price"
      operator: ">"
      value: "EMA(200)"
    - indicator: "RSI_14"
      operator: "<"
      value: 65
  conditions_exit:
    - type: "TakeProfit"
      value: "+4.5%"
    - type: "StopLoss"
      value: "-2.0%"
    - type: "FundingFlip"
      condition: "FundingRate > 0.03"
```

---

## 2. Разделение фаз разработки
- **Этап 1:** Честное превью интерфейса конструктора и разъяснение архитектуры. Без симуляции ложных результатов.
- **Этап 3:** Движок декларативной валидации стратегий.
- **Этап 4:** Подключение бэктестинга на чистых исторических данных.
