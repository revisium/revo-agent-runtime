# ADR-0009: Отделить корреляцию активной строки от права послать сигнал

- Status: Accepted
- Date: 2026-07-29
- Refines: [ADR-0002](./0002-agent-manager-consumer-boundary.md),
  [ADR-0006](./0006-consumer-backed-active-invocation-recovery.md), and
  [ADR-0008](./0008-real-mechanics-supervision-boundary.md)

## Контекст

Потребитель хранит активную строку дольше, чем живёт менеджер. PID и PGID могут быть
переиспользованы, а идентификатор инвокации, pin, `startedAt` и возможный epoch описывают
связь строки с попыткой, но не дают пакету право воздействовать на процесс. Такое право
нельзя получать из данных потребительского хранилища.

## Решение

Все сохранённые поля `pid`, `processGroupId`, `invocationId`, `pin`, `startedAt` и epoch
(если он когда-либо появится в строке) являются только данными корреляции. Ни одно из них,
отдельно или вместе, не является основанием для `SIGTERM`, `SIGKILL`, reap или утверждения
о потомках.

У пакета есть ровно два источника права сигнализировать:

1. приватная живая capability процесса, созданная и удерживаемая этим экземпляром
   менеджера; либо
2. при recovery — новый снимок из package-owned platform inspector, чей канонический
   fingerprint в точности совпал с сохранённым fingerprint.

Во втором случае пакет сначала наблюдает лидера и заново вычисляет fingerprint. Только
точное совпадение разрешает сигнализировать соответствующую группу. Во всех остальных
случаях сохранённая строка не даёт права воздействия на ОС.

Выбран Option A: сохранённый `running` — граница acceptance. До неё lifecycle остаётся
приватным; отклонённый `start()` не создаёт публичную lifecycle-запись. Это отделяет
непринятый setup от accepted invocation, который уже следует обычному публичному lifecycle.

Claimed output leaf при rejected setup остаётся consumer-owned evidence; этот ADR не
добавляет Windows, provider adapter, public API/export, публикацию результата или consumer
storage.

Нормативные исходы recovery, pre-acceptance, sink, typed fault и shutdown определяет
[AgentManager v1 specification](../specs/agent-manager-v1.spec.md#signal-authority-and-context-specific-outcomes).
Требуемое доказательство real-process harness определяет
[roadmap](../roadmap.md#real-process-filesystem-security-cancellation-and-shutdown-conformance).

## Последствия

- Путь recovery не превращает consumer storage в capability для управления ОС.
- Consumer storage остаётся корреляцией и workflow-boundary, а не способом управлять
  процессами; consumer отвечает за внешнее разрешение недоступных пакету случаев.
- Граница Option A запрещает превращать непринятый setup в accepted invocation, result или
  retention лишь потому, что процесс кратко существовал.
- Точные правила active-state quiescence и reconcile остаются в спецификации, а их
  provider-neutral real-process proof — в roadmap; этот ADR не дублирует их lifecycle
  механику.
- Документация уточняет draft target; реализация, platform evidence и публичный экспорт
  по-прежнему отсутствуют.

## Отклонённые альтернативы

- **Сигнал по сохранённым PID/PGID:** допускает воздействие на переиспользованный процесс.
- **`invocationId`, pin или epoch как fencing-token процесса:** это корреляция consumer
  workflow, а не наблюдаемая package capability.
- **Заявлять очистку потомков без живого лидера:** сохранённый PGID не доказывает
  принадлежность потомков инвокации.
- **Старый post-acceptance terminal-result путь:** делает неготовый pre-`running` процесс
  публичной инвокацией, хотя первоначальная active-state запись не подтверждена.
