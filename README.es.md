# Vigilante para Paperclip

[English](README.md) · **Español**

[![npm](https://img.shields.io/npm/v/paperclip-plugin-vigilante)](https://www.npmjs.com/package/paperclip-plugin-vigilante) [![CI](https://github.com/jstm-co/paperclip-plugin-vigilante/actions/workflows/ci.yml/badge.svg)](https://github.com/jstm-co/paperclip-plugin-vigilante/actions/workflows/ci.yml)

Un plugin de [Paperclip](https://github.com/paperclipai/paperclip) que encuentra las tareas de las que de verdad cuelgan tus cadenas de bloqueos, con un script simple (sin IA), cada 15 minutos.

- Clave del plugin: `jstm.vigilante` · paquete npm: `paperclip-plugin-vigilante`
- **Vigilar es lo normal.** De fábrica informa lo que *haría* y no cambia nada. Actuar se activa por empresa (`act`) y hoy hace una sola cosa: despierta al agente que otro agente está esperando (ver [Actuar](#actuar-opcional)). Nunca edita tareas, nunca comenta y nunca cambia relaciones.

## Por qué

Paperclip ya tiene un barrido automático de recuperación para las tareas en `todo` e `in_progress`. Lo que se queda muerto es el estado `blocked`: cadenas de tareas bloqueadas que cuelgan de una **tarea que frena** (el "stopper") que nadie mueve. Nadie recibe aviso, porque cada tarea de la cadena está "bien" bloqueada.

Vigilante recorre las tareas abiertas de cada empresa, sigue cada tarea bloqueada que necesita atención hasta la tarea que frena al final de su cadena, y lista esas tareas: las que nadie toca hace rato y en las que no trabaja ninguna ejecución.

## Qué hace

Cada 15 minutos en cada empresa que tenga el interruptor por empresa **encendido** (ver [Interruptor por empresa](#interruptor-por-empresa)), y a pedido con **Escanear ahora** en la empresa que estás mirando:

1. Lista las tareas abiertas de la empresa (`backlog`, `todo`, `in_progress`, `in_review`, `blocked`).
2. Para cada tarea bloqueada cuya atención de bloqueo es `needs_attention`, busca la que frena: sigue los bloqueadores hasta el final de la cadena, o toma la propia tarea si nada la bloquea.
3. Para cada tarea `todo` o `in_progress` con agente y sin ejecución, lee sus bloqueadores: Paperclip cancela todo despertar de una tarea abierta con bloqueadores sin resolver, pero como no está `blocked` el paso 2 no la ve. Cada bloqueador sin resolver cuenta como una que frena. Como máximo 50 de estas lecturas por empresa y escaneo.
4. Ignora las que tienen una ejecución activa y las `done` / `cancelled`. La que se movió en las últimas 24 horas se lista aparte como reciente, y todavía no se le haría nada.
5. Clasifica cada una y dice qué haría (y, con `act` encendido en la empresa, hace lo único que puede hacer: ver [Actuar](#actuar-opcional)).
6. Guarda un registro por empresa (estado del plugin, alcance empresa) que muestra la página **Vigilante**. También recuerda desde cuándo la ve atascada. Si el escaneo de una empresa falla, conserva su registro y su historial anteriores.

La página muestra la empresa en la que estás: la tarea que frena (con enlace), su tipo, hace cuánto está quieta, cuántas tareas frena, qué haría el vigilante y el texto del motivo si lo hay. La interfaz sigue el idioma del navegador: español por defecto, inglés si el navegador está en inglés. Un aviso dice la verdad por empresa: "no se cambia nada" con `act` apagado, y la única acción que toma con `act` encendido.

## Tipos

Se evalúan en este orden; gana el primero que calza.

| Tipo | Cuándo | Haría |
|---|---|---|
| `waiting_person` | Asignada a una persona (y a ningún agente) | nada: Paperclip ya le avisa a la persona |
| `backlog_unowned` | `backlog`, sin asignar | informar: alguien debe asignarla |
| `backlog_assigned` | `backlog`, con un agente | pasarla a `todo` |
| `waiting_third_party` | `blocked` con un texto de acción de desbloqueo (la acción de recuperación `deliberate_wait_without_target` también cuenta, pero solo cuando el host la expone a los plugins) | informar, con el texto del motivo |
| `waiting_agent` | `blocked` con un texto de desbloqueo que nombra exactamente UN agente de la empresa distinto del responsable de la tarea (ver [Actuar](#actuar-opcional)) | despertar a ese agente (`wake_other_agent`) cuando lleve quieta `actAfterMinutes`; solo informa si `act` está apagado |
| `gave_up` | `blocked` con una acción de recuperación `stranded_*` activa. **Solo cuando el host expone su estado de recuperación a los plugins; hoy esas tareas salen como `blocked_unexplained`.** | despertar al responsable |
| `blocked_unexplained` | `blocked`, con agente, sin bloqueadores sin resolver y sin explicación | despertar al responsable |
| `open_no_run` | `todo`, `in_progress` o `in_review` sin ejecución en este momento | informar |
| `other` | cualquier otra | informar |
| `unknown` | la tarea que frena no está en la lista de abiertas | informar (solo se conoce el id) |

Las quietas hace más de un día van primero y las recientes en su propia tabla; cada una ordenada por cuántas tareas frena y, después, por cuánto lleva quieta.

## Interruptor por empresa

El job de cada 15 minutos corre sin alcance de empresa, así que Paperclip solo le deja tocar las empresas donde el plugin tiene una configuración guardada. Por eso el plugin declara un ajuste por empresa, **Escanear esta empresa cada 15 minutos** (`enabled`, apagado por defecto):

- **Encendido:** el escaneo programado cubre la empresa.
- **Apagado (o nunca guardado):** el escaneo programado la salta. El botón **Escanear ahora** de la página sigue funcionando para la empresa que estás mirando; reescanea solo esa y no toca los datos de las demás.

Guarda el ajuste en cada empresa que quieras cubrir (el host guarda una configuración por empresa). Esa misma configuración por empresa tiene tres ajustes más:

| Ajuste | Por defecto | Qué hace |
|---|---|---|
| `act` | apagado | Despertar al agente que otro agente está esperando (ver [Actuar](#actuar-opcional)). Aparte de `enabled`. |
| `actAfterMinutes` | 30 (mínimo 10) | Minutos que debe llevar quieta una tarea `waiting_agent` antes de despertar al agente. |
| `language` | `en` | `en` o `es`: idioma del mensaje que recibe el agente despertado y de la entrada de actividad. |

Los valores inválidos vuelven al valor por defecto.

## Actuar (opcional)

Un agente suele dejar su tarea en `blocked` con una explicación como "Esperando al Tech Lead: mantén la atribución de X y devuélvela". El agente nombrado está inactivo y nadie lo despierta: la tarea no es suya y su propia tarea está bloqueada por esta, así que Paperclip cancela los despertares ahí. Vigilante lo despierta, sin IA.

- **Detección** por texto simple: se buscan los nombres de los agentes de la empresa dentro del texto de la explicación, sin distinguir mayúsculas, tildes ni espacios de más, y en límites de palabra. Los agentes terminados se ignoran y el responsable de la tarea no cuenta. Si se nombra exactamente un agente distinto (un nombre largo gana sobre uno corto que contiene), la tarea que frena es `waiting_agent`. Dos agentes distintos, o ninguno, queda como `waiting_third_party`.
- **Cuándo:** cuando la tarea lleva quieta `actAfterMinutes` (30 por defecto, mínimo 10), se haya movido o no en las últimas 24 horas. Antes de eso la página muestra "nada todavía".
- **Solo si** la empresa tiene `act` encendido y el escaneo corre para ella (el job de 15 minutos exige además `enabled`; **Escanear ahora** también actúa si `act` está encendido).
- **Límites**, guardados en el registro de la empresa: como máximo un despertar por tarea cada 24 horas, como máximo 3 por tarea mientras siga atascada (el historial se borra cuando la tarea deja de frenar), como máximo 5 por empresa y escaneo. Si el destinatario no está `idle` (corriendo, en pausa, con error...) se salta y se reintenta en el siguiente escaneo sin contar. Un despertar fallido queda anotado con su mensaje, no cuenta y no detiene el escaneo.
- **El mensaje** es un aviso corto en texto plano en el `language` de la empresa: que es automático (sin IA), el identificador y título de la tarea, quién la tiene, que está bloqueada esperando al destinatario, el texto de la explicación, cuánto lleva quieta y qué se espera (abrir la tarea y hacer lo que pide, o comentar en ella si no le corresponde).
- **El rastro:** una entrada en el registro de actividad de la tarea, a nombre del plugin, dice a quién se despertó y por qué. No publica comentarios (un comentario despertaría al responsable de la tarea).

La página muestra "Despertar a <nombre>" en esas filas y, hecho, "Despertó a <nombre> hace 2 h (1 de 3)", o por qué se saltó o falló.

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

`upgrade` rechaza una versión que pide permisos nuevos. La versión que agrega el actuar pide tres (`agents.read`, `agents.invoke`, `activity.log.write`), así que una instalación existente hay que desinstalarla **sin** `--force` e instalarla de nuevo.

## Permisos y datos

| Permiso | Para qué |
|---|---|
| `companies.read` | Leer el nombre y el prefijo de cada empresa escaneada. |
| `issues.read` | Leer las tareas abiertas de cada empresa escaneada. |
| `issue.relations.read` | Leer qué tareas bloquean a una abierta que no está `blocked`. |
| `jobs.schedule` | El escaneo cada 15 minutos. |
| `plugin.state.read`, `plugin.state.write` | Guardar la última instantánea, las horas de "visto por primera vez" y el historial de despertares, en el estado propio del plugin. |
| `agents.read` | Listar los agentes de la empresa (id, nombre, estado) una vez por escaneo, para calzar los nombres de los textos de explicación. |
| `agents.invoke` | Despertar al agente que otro agente está esperando. Solo con `act` encendido. |
| `activity.log.write` | Escribir la entrada de actividad que deja registro de cada despertar. |
| `ui.page.register`, `ui.sidebar.register`, `ui.action.register` | La página, su enlace del menú lateral y su botón en la barra de arriba. |

Ausentes a propósito: `issues.update`, `issues.wakeup`, cualquier capacidad de comentar y la escritura de relaciones. El plugin no puede editar una tarea, comentar ni cambiar relaciones; lo único que puede hacer además de vigilar es despertar a un agente y escribir una entrada de actividad. No llama a ningún servicio externo.

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
