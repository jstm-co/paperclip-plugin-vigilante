# Vigilante para Paperclip

[English](README.md) · **Español**

[![npm](https://img.shields.io/npm/v/paperclip-plugin-vigilante)](https://www.npmjs.com/package/paperclip-plugin-vigilante) [![CI](https://github.com/jstm-co/paperclip-plugin-vigilante/actions/workflows/ci.yml/badge.svg)](https://github.com/jstm-co/paperclip-plugin-vigilante/actions/workflows/ci.yml)

Un plugin de [Paperclip](https://github.com/paperclipai/paperclip) que encuentra las tareas de las que de verdad cuelgan tus cadenas de bloqueos, con un script simple (sin IA), cada 15 minutos.

- Clave del plugin: `jstm.vigilante` · paquete npm: `paperclip-plugin-vigilante`
- **Vigilar es lo normal.** De fábrica informa lo que *haría* y no cambia nada. Actuar se activa por empresa (`act`) y hoy hace una sola cosa: despierta al agente que otro agente está esperando (ver [Actuar](#actuar-opcional)). Nunca edita tareas, nunca comenta, nunca cambia relaciones y no escribe entradas de actividad. **Solo el job programado de 15 minutos actúa**; **Escanear ahora** solo informa.

## Por qué

Paperclip ya tiene un barrido automático de recuperación para las tareas en `todo` e `in_progress`. Lo que se queda muerto es el estado `blocked`: cadenas de tareas bloqueadas que cuelgan de una **tarea que frena** (el "stopper") que nadie mueve. Nadie recibe aviso, porque cada tarea de la cadena está "bien" bloqueada.

Vigilante recorre las tareas abiertas de cada empresa, sigue cada tarea bloqueada que necesita atención hasta la tarea que frena al final de su cadena, y lista esas tareas: las que nadie toca hace rato y en las que no trabaja ninguna ejecución.

## Qué hace

Cada 15 minutos en cada empresa que tenga el interruptor por empresa **encendido** (ver [Interruptor por empresa](#interruptor-por-empresa)), y a pedido con **Escanear ahora** (solo informa, nunca despierta a nadie) en la empresa que estás mirando:

1. Lista las tareas abiertas de la empresa (`backlog`, `todo`, `in_progress`, `in_review`, `blocked`).
2. Para cada tarea bloqueada cuya atención de bloqueo es `needs_attention`, busca la que frena: sigue los bloqueadores hasta el final de la cadena, o toma la propia tarea si nada la bloquea.
3. Para cada tarea `todo` o `in_progress` con agente y sin ejecución, lee sus bloqueadores: Paperclip cancela todo despertar de una tarea abierta con bloqueadores sin resolver, pero como no está `blocked` el paso 2 no la ve. Cada bloqueador sin resolver cuenta como una que frena. Como máximo 50 de estas lecturas por empresa y escaneo.
4. Ignora las que tienen una ejecución activa y las `done` / `cancelled`. La que se movió en las últimas 24 horas se lista aparte como reciente. Paperclip todavía puede moverla, así que el plugin no la tocaría, con una excepción: una tarea que espera a otro agente (ver [Actuar](#actuar-opcional)) es accionable cuando lleva quieta `actAfterMinutes`, reciente o no.
5. Clasifica cada una y dice qué haría (y, en el job programado y con `act` encendido en la empresa, hace lo único que puede hacer: ver [Actuar](#actuar-opcional)).
6. Guarda un registro por empresa (estado del plugin, alcance empresa) que muestra la página **Vigilante**. También recuerda desde cuándo la ve atascada. Si el escaneo de una empresa falla, conserva su registro y su historial anteriores.

La página muestra la empresa en la que estás: la tarea que frena (con enlace), su tipo, hace cuánto está quieta, cuántas tareas frena, qué haría el vigilante y el texto del motivo si lo hay. La interfaz sigue el idioma del navegador: español por defecto, inglés si el navegador está en inglés. Un aviso dice la verdad por empresa: "no se cambia nada" con `act` apagado, la única acción que toma el escaneo programado con `act` encendido, y una línea neutra mientras el informe carga o no se pudo cargar.

## Tipos

Se evalúan en este orden; gana el primero que calza.

| Tipo | Cuándo | Haría |
|---|---|---|
| `waiting_person` | Asignada a una persona (y a ningún agente) | nada: Paperclip ya le avisa a la persona |
| `backlog_unowned` | `backlog`, sin asignar | informar: alguien debe asignarla |
| `backlog_assigned` | `backlog`, con un agente | pasarla a `todo` |
| `waiting_third_party` | `blocked` con un texto de acción de desbloqueo (la acción de recuperación `deliberate_wait_without_target` también cuenta, pero solo cuando el host la expone a los plugins) | informar, con el texto del motivo |
| `waiting_agent` | `blocked` con una acción de desbloqueo cuyo dueño es otro agente de la empresa, o (sin dueño, o dueño = el responsable) cuyo texto dice que alguien espera a exactamente UN agente de la empresa (ver [Actuar](#actuar-opcional)) | despertar a ese agente (`wake_other_agent`) cuando lleve quieta `actAfterMinutes`; solo informa si `act` está apagado |
| `gave_up` | `blocked` con una acción de recuperación `stranded_*` activa. **Solo cuando el host expone su estado de recuperación a los plugins; hoy esas tareas salen como `blocked_unexplained`.** | despertar al responsable |
| `blocked_unexplained` | `blocked`, con agente, sin bloqueadores sin resolver y sin explicación | despertar al responsable |
| `open_no_run` | `todo`, `in_progress` o `in_review` sin ejecución en este momento | informar |
| `other` | cualquier otra | informar |
| `unknown` | la tarea que frena no está en la lista de abiertas | informar (solo se conoce el id) |

Las quietas hace más de un día van primero y las recientes en su propia tabla; cada una ordenada por cuántas tareas frena y, después, por cuánto lleva quieta.

## Interruptor por empresa

El job de cada 15 minutos corre sin alcance de empresa, así que Paperclip solo le deja tocar las empresas donde el plugin tiene una configuración guardada. Por eso el plugin declara un ajuste por empresa, **Escanear esta empresa cada 15 minutos** (`enabled`, apagado por defecto):

- **Encendido:** el escaneo programado cubre la empresa.
- **Apagado (o nunca guardado):** el escaneo programado la salta. El botón **Escanear ahora** de la página sigue funcionando para la empresa que estás mirando (solo informa); reescanea solo esa y no toca los datos de las demás.

Guarda el ajuste en cada empresa que quieras cubrir (el host guarda una configuración por empresa). Esa misma configuración por empresa tiene tres ajustes más:

| Ajuste | Por defecto | Qué hace |
|---|---|---|
| `act` | apagado | Despertar al agente que otro agente está esperando (ver [Actuar](#actuar-opcional)). Aparte de `enabled`. |
| `actAfterMinutes` | 30 (mínimo 10) | Minutos que debe llevar quieta una tarea `waiting_agent` antes de despertar al agente. |
| `language` | `en` | `en` o `es`: idioma del mensaje que recibe el agente despertado. |

Los valores inválidos vuelven al valor por defecto.

## Actuar (opcional)

Un agente suele dejar su tarea en `blocked` con una explicación como "Esperando al Tech Lead: mantén la atribución de X y devuélvela". El agente nombrado está inactivo y, salvo que Paperclip ya lo haya despertado como dueño del desbloqueo (una vez), nadie lo vuelve a despertar: la tarea no es suya y su propia tarea está bloqueada por esta, así que Paperclip cancela los despertares ahí. "Nadie lo despierta" vale, entonces, cuando el dueño del desbloqueo no es ese agente. Vigilante lo despierta, sin IA.

- **A quién se despierta.** El host guarda un dueño estructurado con cada acción de desbloqueo: un agente, un usuario o el board.
  - Dueño **board** o **usuario**: una persona debe actuar, así que Vigilante nunca despierta a nadie (la tarea queda como `waiting_third_party`).
  - Dueño **otro agente** de la empresa (no terminado y distinto del responsable de la tarea): ese agente es el destinatario, sin buscar en el texto.
  - **Sin dueño**, o dueño **igual al responsable** (los agentes suelen ponerse a sí mismos mientras el texto dice a quién esperan): Vigilante recurre al texto. Un nombre de agente solo cuenta justo después de una frase de espera, con solo artículos, preposiciones, espacios o dos puntos en medio, sin distinguir mayúsculas ni tildes: inglés "waiting for", "waiting on", "waits for", "wait for", "blocked by", "blocked on", "pending on", "needs", "need"; español "espera a/al/a la", "esperando a/al", "espero a/al", "pendiente de/del", "bloqueada/bloqueado por", "falta que", "depende de/del", "necesita a/al" (la lista es `WAITING_PHRASES` en `src/mentions.ts`). Una negación antes en la misma cláusula ("not", "no longer", "no", "ya no", "sin"...) la anula ("Not waiting on the CEO anymore"). Los nombres de 3 caracteres o menos deben coincidir con sus mayúsculas exactas, y tras el "need"/"needs" suelto, todos. Los agentes terminados se ignoran y el responsable de la tarea no cuenta. Si se nombra exactamente un agente distinto (un nombre largo gana sobre uno corto que contiene), la tarea es `waiting_agent`; un segundo agente nombrado en cualquier parte, o ninguno tras una frase de espera, significa sin destinatario.
- **Cuándo:** cuando la tarea lleva quieta `actAfterMinutes` (30 por defecto, mínimo 10), se haya movido o no en las últimas 24 horas. Antes de eso la página muestra "nada todavía".
- **Solo actúa el job programado**, y solo si la empresa tiene `act` encendido (y `enabled`, para que el job la escanee). **Escanear ahora** nunca despierta a nadie: tiene un límite de 30 segundos en el host y se saltaría el tope por escaneo. Las filas de la página siguen mostrando lo que haría el job.
- **Límites**, guardados en el registro de la empresa. Todo intento de despertar cuenta, haya funcionado, fallado o vencido por tiempo (el host puede haber creado la ejecución igual):
  - por tarea: como máximo 1 despertar cada 24 horas y 3 en total durante toda la vida de su registro. El registro se conserva hasta que la tarea sale de las listas de tareas abiertas de la empresa (se cerró) o pasan 14 días desde su último despertar, así que una tarea que rebota (el agente despertado comenta, el responsable corre, la tarea se bloquea de nuevo con el mismo texto) no vuelve a "1 de 3". Si cambia el destinatario, la tarea empieza un registro nuevo para el nuevo destinatario pero conserva la separación de 24 horas;
  - por agente destinatario: como máximo 1 despertar cada 60 minutos y 6 en cualquier ventana de 24 horas;
  - por empresa: como máximo 20 despertares en cualquier ventana de 24 horas;
  - por escaneo: como máximo 5 llamadas a `agents.invoke`.

  Las constantes se exportan desde `src/shared.ts` (`NUDGE_SPACING_MS`, `MAX_NUDGES_PER_STOPPER`, `NUDGE_AGENT_SPACING_MS`, `MAX_NUDGES_PER_AGENT_DAY`, `MAX_NUDGES_PER_COMPANY_DAY`, `MAX_NUDGES_PER_SCAN`, `NUDGE_RECORD_TTL_MS`). Peor caso: 1 despertar por tarea al día, 6 por agente al día, 20 por empresa al día.
- **Escribir antes de despertar.** Por cada despertar el plugin primero guarda el registro con el intento contado, y solo si esa escritura funciona llama a `agents.invoke`. Si la escritura falla no se invoca nada y el escaneo deja de actuar. Un destinatario que no está `idle` (corriendo, en pausa, con error...) se salta y se reintenta en el siguiente escaneo sin contar.
- **Un despertar por agente y escaneo, un solo mensaje.** Las tareas de un escaneo que esperan al mismo agente se agrupan en un despertar. El mensaje lista hasta 5 y luego "y N más", y todas quedan anotadas como intentadas. (Paperclip junta los despertares simultáneos de un agente en una sola ejecución y se queda solo con el último mensaje, así que varios seguidos perderían mensajes.)
- **El mensaje** es un aviso corto en texto plano (hasta unos 1.500 caracteres) en el `language` de la empresa: que es automático (sin IA) y, por cada tarea, su identificador y título, quién la tiene, cuánto lleva quieta y el texto de la explicación, más lo que se espera (abrir la tarea y hacer lo que pide, o comentar en ella si no le corresponde).
- **El rastro** es la página (a quién se despertó, cuándo, "k de 3") y la propia ejecución despertada, que lleva el mensaje. El plugin **no escribe entradas de actividad**: Paperclip cuenta cada fila de actividad como última actividad de la tarea, así que el rastro del propio plugin haría parecer reciente a una tarea atascada y arruinaría la medición de quietud. Tampoco publica comentarios (un comentario despertaría al responsable de la tarea).

La página muestra "Despertar a <nombre>" en esas filas y, hecho, "Despertó a <nombre> hace 2 h (1 de 3)", o que el intento no tuvo confirmación o falló (igual cuenta), o por qué se saltó.

## Requisitos

- Desarrollado contra el SDK de plugins `2026.824.1`; probado en un host `2026.1117.0` en vivo (página, Escanear ahora, el interruptor por empresa y el trabajo de escaneo lanzado a mano).
- Acceso de board a la instancia. En modo `local_trusted` cualquier proceso local lo tiene; en modo `authenticated`, inicia sesión antes con `npx paperclipai auth login`.
- Para instalar desde npm: npm en la máquina donde corre Paperclip. Para instalar desde el código: Node.js 20 o superior y npm.

## Instalación

### Desde npm

```bash
npx paperclipai plugin install paperclip-plugin-vigilante
npx paperclipai plugin list        # jstm.vigilante, status=ready
```

### Desde el código

Paperclip carga el plugin desde una carpeta local y no copia el código: deja la carpeta donde está mientras uses el plugin.

```bash
git clone https://github.com/jstm-co/paperclip-plugin-vigilante.git
cd paperclip-plugin-vigilante
npm ci
npm run build
npx paperclipai plugin install "$PWD"
npx paperclipai plugin list        # jstm.vigilante, status=ready
```

Si tu instancia no está en la dirección por defecto, agrega `--api-base <url>` a los comandos de `paperclipai`. Luego recarga Paperclip: "Vigilante" aparece en la barra de arriba (el espacio Coordinator, que es el que Paperclip trae por defecto, no dibuja los enlaces de plugins en el menú lateral) y en el menú lateral donde se dibuja. También puedes abrir `/<prefijo-de-empresa>/vigilante`. Después enciende el interruptor por empresa.

## Actualizar y desinstalar

```bash
npx paperclipai plugin upgrade jstm.vigilante
npx paperclipai plugin uninstall jstm.vigilante            # conserva el registro y los datos
npx paperclipai plugin uninstall jstm.vigilante --force    # borra todo
```

`upgrade` rechaza una versión que pide permisos nuevos. La versión que agrega el actuar pide dos (`agents.read`, `agents.invoke`), así que una instalación existente hay que desinstalarla **sin** `--force` e instalarla de nuevo.

## Permisos y datos

| Permiso | Para qué |
|---|---|
| `companies.read` | Leer el nombre y el prefijo de cada empresa escaneada. |
| `issues.read` | Leer las tareas abiertas de cada empresa escaneada. |
| `issue.relations.read` | Leer qué tareas bloquean a una abierta que no está `blocked`. |
| `jobs.schedule` | El escaneo cada 15 minutos. |
| `plugin.state.read`, `plugin.state.write` | Guardar la última instantánea, las horas de "visto por primera vez" y el historial de despertares, en el estado propio del plugin. |
| `agents.read` | Listar los agentes de la empresa (id, nombre, estado) una vez por escaneo, para calzar los nombres de los textos de explicación. |
| `agents.invoke` | Despertar al agente que otro agente está esperando. Solo el job programado, y solo con `act` encendido. |
| `ui.page.register`, `ui.sidebar.register`, `ui.action.register` | La página, su enlace del menú lateral y su botón en la barra de arriba. |

Ausentes a propósito: `issues.update`, `issues.wakeup`, cualquier capacidad de comentar y la escritura de relaciones. El plugin no puede editar una tarea, comentar ni cambiar relaciones; lo único que puede hacer además de vigilar es despertar a un agente. No tiene capacidad de registro de actividad a propósito (ver [Actuar](#actuar-opcional)). No llama a ningún servicio externo.

## Hoja de ruta

Aún sin implementar, y que siguen solo informando: `promote_to_todo` (pasar a `todo` una tarea de backlog con agente) y `wake_assignee` (despertar al agente que tiene una tarea bloqueada sin explicación). Promover trabajo del backlog necesitará un paso de confirmación, porque algo en el backlog puede estar aparcado a propósito. Toda acción nueva mantendrá las mismas reglas: opcional por empresa, con tope, y sin editar tareas sin una persona de por medio.

## Desarrollo

```bash
npm ci
npm run typecheck
npm test
npm run build
```

Mira [CONTRIBUTING.md](CONTRIBUTING.md). Licencia MIT.
