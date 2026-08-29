# Estrategia de apps nativas AiBrain

**Decisión (investigada el 2026-08-29):** mantener AiBrain como una instalación web/servidor Next y lanzar en este orden: **PWA instalable primero**, **cliente iOS con Capacitor después**, y **bridge de escritorio macOS con Tauri v2 sólo cuando exista un caso de uso local aprobado**. Android debe seguir al beta iOS si hay usuarios o cuentas objetivo que lo justifiquen; Capacitor permite hacerlo sobre el mismo cliente. No empaquetar hoy la aplicación Next completa con Tauri ni Electron, y no trasladar workers, conectores o Computer Use al dispositivo.

Esta es una decisión de arquitectura y de producto, no una autorización para instalar SDKs, crear targets nativos, publicar una store ni cambiar el backend.

## 1. Punto de partida y límites que no cambian

AiBrain es un servicio web Next con identidad externa limitada a Supabase y sesión opaca local emitida por el servidor. La autorización, tenancy, approvals, workers, conectores, datos, egress y Browser/Computer Use son límites del **servidor de cada instalación**, no del navegador. Véanse [sesiones](AUTH_LOCAL_SESSIONS.md), [límites de confianza](ARCHITECTURE_AND_TRUST_BOUNDARIES.md) y [runtime de Browser/Computer Use](BROWSER_COMPUTER_USE_RUNTIME.md).

```text
                    misma URL HTTPS / misma API versionada

 PWA Safari/Chrome ──┐
 iOS Capacitor ──────┼──> AiBrain Next + auth/session + policy/approval
 Android Capacitor ──┤                  │
 macOS Tauri bridge ─┘                  ├── workers aislados por usuario
                                        ├── conectores y egress gateway
                                        └── Chrome/CDP server-side aislado

El dispositivo nunca recibe: secretos de workers/conectores, CDP, un token de
browser gateway, raíces de datos de otra persona, ni autoridad para ejecutar
una aprobación. Sólo presenta UI, adjunta datos con permiso explícito y pide al
servidor que ejecute las mismas operaciones autorizadas/auditadas.
```

Por ello, “nativa” mejora la experiencia de dispositivo; no es una segunda ejecución de AiBrain. El viewer de Computer Use seguirá mostrando el navegador aislado del servidor. Un móvil no puede ser un host de Chrome/CDP/worker de confianza ni una forma de eludir approvals. En macOS, un bridge futuro tampoco recibe autorización implícita para automatizar otras aplicaciones ni accesibilidad global.

## 2. Recomendación concreta por fase

| Fase | Entrega y propósito | Reutilización | Condición de salida |
| --- | --- | --- | --- |
| 0 — web/PWA (ahora) | Hacer la web actual instalable y excelente en móvil/desktop: manifest, iconos, service worker sólo para shell/recursos no sensibles, offline explícito, upload/download responsive, URLs estables y telemetría. | Casi todo: React/Next, API, auth, permisos, workbench y tests responsive existentes. No exige SDK nativo. | Dos usuarios reales aislados; login/recovery/logout, aprobación, archivo y reconnect validados contra instalación QA; no se afirma offline de datos ni de ejecución. |
| 1 — MVP iOS | Un contenedor **Capacitor** para el cliente web con navegador embebido, fotos/archivos mediante selección explícita, deep links HTTPS, push de aviso y observabilidad móvil. El flujo de chat/archivos/approvals ha de ser utilizable sin bridge privilegiado. | UI React, contratos HTTP, URLs, modelos de datos y la mayor parte de la capa de presentación. Adaptadores pequeños para lifecycle, cámara/file picker, push, red y enlace entrante. | TestFlight con cuentas de review/demostración; iPhone real, cold start, universal link, expiración de sesión, denial de permiso, upload, push tap y una acción aprobada con readback. |
| 2 — beta iOS y Android condicional | Añadir Android con el mismo shell Capacitor si el beta demuestra demanda. Mantener diferencias de permisos/push/deep links en adaptadores por plataforma. | El mismo web client y, en general, los plugins/adaptadores Capacitor. Android no abre una segunda arquitectura. | Métricas de activación/retención y al menos una organización/usuario objetivo Android; App Links, FCM, Doze/killed-state y matriz de dispositivos verificados. |
| 3 — macOS desktop bridge | App **Tauri v2** pequeña y explícita: UI del workbench remoto de origen confiable o frontend estático separado, selector de ficheros nativo, notificaciones, menú/tray y deep links. Sólo sumar capacidades locales que tengan permiso, threat model, API y auditoría propios. | Componentes React puros, design system, contrato API y telemetría. No reutilizar el servidor Next como binario Tauri. | Caso de uso medido que PWA no cubra; sandbox/entitlements auditados, firma/notarización, bridge capability-scoped y revocación validada. |
| 4 — producción/selectivo nativo | Consolidar distribución, rollback, observabilidad y operación por canal. Considerar SwiftUI/AppKit sólo para flujos que justifiquen UX/seguridad verdaderamente nativas (p. ej. credenciales de dispositivo, accesibilidad o extensiones) y que no deban vivir en web. | Dominio/API/contratos/seguridad del backend; no se promete reutilizar la UI React en Swift. | SLO por plataforma, runbook de incidente/rollback, privacidad/stores aprobadas y prueba live de tenant/approval/readback. |

**Elección:** PWA primero + Capacitor para móvil. Tauri v2 es la opción preferida para un bridge macOS futuro, no para convertir la instalación Next actual en una app local. Electron queda como alternativa sólo si se decide conscientemente empaquetar un runtime Node/Chromium de escritorio y se acepta su superficie y coste; Swift/nativo se reserva para una capacidad nativa que el shell híbrido no pueda ofrecer de forma segura.

## 3. Comparativa de opciones

| Criterio | PWA | Capacitor | Tauri v2 | Electron | Swift/nativo |
| --- | --- | --- | --- | --- | --- |
| Reutiliza Next actual | Máxima; sigue contra el servidor existente. | Alta para UI web; el host nativo no vuelve estáticas las rutas de AiBrain. | Baja como empaquetado directo: [Tauri exige `output: 'export'` y no soporta soluciones server-based](https://v2.tauri.app/start/frontend/nextjs/). Viable sólo como shell remoto o frontend separado. | Media: puede alojar una web remota o empaquetar Node, pero este último duplica la operación y el hardening. | Baja para UI; alta sólo en contratos/API/dominio. |
| iOS / Android | Instalable donde el navegador lo permita; capacidades y UX varían. | Sí, runtime nativo web-first con plugins Swift/Java; soporta iOS y Android. | Soporta móvil, pero añade Rust y no resuelve la incompatibilidad con Next server-side. | No es plataforma móvil. | Sí, iOS; Android requeriría Kotlin/otro cliente. |
| macOS / bridge local | Web APIs, descargas y notificaciones web; sin bridge privilegiado. | No es la opción de escritorio recomendada. | Buena para app pequeña, IPC con capabilities y bridge mínimo. Hay updater firmado y firma macOS. | Muy flexible: Node/IPC/Chromium completo. Exige aislamiento estricto de contenido remoto. | Máxima integración AppKit/SwiftUI, sandbox y APIs Apple; mayor coste. |
| Auth y sesiones | Cookie `Secure`/`HttpOnly` existente; no duplicar tokens en storage web. | Preservar sesión contra el origen HTTPS y usar callback/Universal Link controlado; no llevar sesiones del servidor a preferencias nativas. | Igual si shell remoto; si bridge, guardar sólo credenciales de dispositivo necesarias en Keychain y usar API de enrolment/revocación. | Igual, pero el preload/IPC es una frontera adicional. | Keychain + URLSession/ASWebAuthenticationSession según flujo, con una implementación aparte. |
| Deep links | HTTPS normales; la web es fallback. | Universal Links/App Links más `appUrlOpen`; Capacitor exige enrutar el evento de entrada en la app. | Plugin/deep-link y handler nativo posibles, pero validar origen/ruta antes de cualquier acción. | Protocol handlers / links, con validación y single-instance. | Universal Links nativos. |
| Push / background | Web Push: Safari admite Web Push para web apps añadidas a Inicio desde iOS 16.4 y Safari macOS 13; no garantiza un worker continuo. | APNs/FCM y push visible. El plugin no soporta silent push iOS; Android killed-state para data-only requiere servicio nativo. Background Runner es trabajo breve, sujeto al SO, no un worker AiBrain. | Notificaciones locales; remoto/background depende de plataforma y bridge propio. | Notificaciones desktop y lógica local cuando la app corre; no sirve como scheduler cloud. | APNs/BGTaskScheduler, con entrega y ejecución no garantizadas. |
| Sandbox, archivos y secretos | Browser sandbox; file chooser y storage de navegador. | Sandboxes de iOS/Android y permisos declarados; file picker/cámara mediante plugin. | Sandboxing del SO + capabilities Tauri; delimitar cada comando y scope de fichero. | Sandbox de renderer/proceso, `contextIsolation`, preload mínimo; no exponer Node a remoto. | Sandbox de Apple, Keychain, document picker/security-scoped URLs. |
| Computer Use | Viewer remoto solamente. | Viewer remoto solamente; sin CDP/worker local. | Puede ser UI/estado de escritorio, nunca acceso automático a otras apps sin diseño, consentimiento y entitlements aparte. | Técnicamente amplio, pero aumenta gravemente el riesgo si carga contenido de trabajo no confiable. | Sólo APIs Apple autorizadas; App Sandbox restringe, entre otras cosas, Apple Events arbitrarios y simulación de input. |
| Updates/distribución | Deploy web reversible; el service worker necesita versionado/rollback. | Actualización binaria por App Store/Play; cambios de UI que alteren funcionalidades deben seguir reglas de la store. | App Store o Developer ID + hardened runtime/notarización; updater Tauri firma artefactos. | Stores o descarga firmada; auto-updater macOS requiere firma. | App Store/TestFlight/Mac App Store o Developer ID según plataforma. |
| Observabilidad | RUM web, logs correlacionados por request/turn sin prompts/secretos. | Añadir versión/build/OS, lifecycle, permiso, token-push hash y correlation ID; crashes nativos. | Igual, más bridge command/denial auditado. | Igual, más auditoría de IPC/preload, renderer crashes y updater. | Métricas/crash nativas y eventos API correlacionados. |
| Veredicto AiBrain | **Primero.** | **Móvil recomendado.** | **macOS posterior y estrecho.** | No para la primera entrega. | No para MVP; evaluar por feature específica. |

### Fundamentos oficiales de las diferencias

- Capacitor se define como runtime nativo web-first y permite añadir plugins Swift/Java al proyecto web; su guía confirma que el enrutado de deep link se implementa al iniciar la app ([overview](https://capacitorjs.com/docs), [deep links](https://capacitorjs.com/docs/guides/deep-links)).
- Su plugin de push aclara dos límites importantes: no ofrece silent push iOS y, en Android, data-only no despierta el listener si la app fue terminada sin un `FirebaseMessagingService` nativo; Background Runner ejecuta JS headless breve según reglas del SO, no un proceso persistente ([Push Notifications](https://capacitorjs.com/docs/apis/push-notifications), [Background Runner](https://capacitorjs.com/docs/apis/background-runner)).
- Apple permite Web Push para Home Screen web apps de iOS/iPadOS 16.4+ y Safari macOS 13+, pero el refresh background mediante APNs es de baja prioridad, sin garantía y puede ser throttled ([Web Push](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers), [background updates](https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app)).
- Tauri soporta updater firmado, pero su propia guía de Next obliga a exportación estática; no usarlo para convertir rutas server-side de AiBrain en app offline ([Next.js](https://v2.tauri.app/start/frontend/nextjs/), [updater](https://v2.tauri.app/plugin/updater/)).
- Electron es viable técnicamente, pero su documentación exige, entre otros, contenido seguro, sin Node integration para remoto, context isolation, process sandbox, CSP y validación de cada IPC. Cargar UI/documentos no confiables dentro de un cliente con privilegios contradice el modelo de aislamiento de AiBrain ([security checklist](https://www.electronjs.org/docs/latest/tutorial/security)).
- El sandbox macOS impide capacidades que invalidarían un “computer-use” local genérico: Apple Events arbitrarios, simulación de input en diálogos y terminar otros procesos; para Mac App Store es obligatorio. Los archivos deben quedar en el contenedor o ser seleccionados explícitamente por la persona ([App Sandbox](https://developer.apple.com/documentation/security/protecting-user-data-with-app-sandbox), [file access](https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox)).

## 4. Arquitectura objetivo y reutilización

### Capas

```text
shared-web/ (a extraer de la app actual, sin privilegios)
  ├─ React UI, design tokens, validación de URLs/estados, API client
  ├─ navegación y URL parser allowlist
  └─ telemetry client con correlation ID

web-next/ (fuente de verdad)
  ├─ App Router, SSR/rutas API, cookies opacas y CSRF/same-origin
  ├─ tenancy, permisos, approvals, auditoría y notificaciones server-side
  └─ workers, conectores, egress y Browser/Computer Use aislados

mobile-shell/ (Capacitor; posterior)
  ├─ lifecycle/network/secure device registration
  ├─ native file/camera picker -> upload API autorizado
  ├─ Universal Link / App Link -> parser allowlist -> ruta sin side effect
  └─ APNs/FCM token -> endpoint de device registration/revocation

desktop-bridge/ (Tauri; posterior, separado)
  ├─ remote trusted web origin o frontend estático específico
  ├─ command allowlist: file chooser, notification, deep link, tray
  └─ Keychain/OS capabilities sólo tras permiso, API y audit event
```

### Qué se reutiliza y qué no

Reutilizar: UI React compatible, rutas semánticas, esquemas de request/response, controles de permisos representados en UI, design system, pruebas de contrato, visuales y a11y, y la instrumentación de turnos/approvals.

No reutilizar como si fuese seguro: cookies en `localStorage`, secretos del servidor, filesystem de instalación, perfiles Chromium, puertos/pipes CDP, los workers de Codex, tokens de navegador gateway, servicios Next server-side dentro del binario ni una aprobación “local”. No copiar datos de cliente a cache offline por defecto. Cada caché offline debe ser clasificada, cifrada cuando proceda, revocable y con TTL.

### Auth, enlaces y sesiones

1. Mantener `https://<installation>/...` como URL canónica y fallback web. Nunca mandar una sesión o bootstrap secret en query string, deep link, push o log.
2. En iOS registrar Associated Domains + `apple-app-site-association`; en Android `assetlinks.json` con el certificado de release. Universal Links y Android App Links prueban que el dominio autoriza a la app, pero **no** autorizan acciones: validar host, ruta, longitud, parámetros y estado de sesión antes de navegar. Apple también advierte que un universal link es vector de ataque y no debe dar acceso/borrar datos por sí mismo ([Universal Links](https://developer.apple.com/documentation/xcode/allowing-apps-and-websites-to-link-to-your-content)); Android exige asociación verificable del dominio ([App Links](https://developer.android.com/training/app-links/about)).
3. Para login/recovery, abrir el flujo HTTPS asociado a la instalación, conservar el retorno bajo una allowlist y canjear cualquier challenge una única vez en el servidor. No convertir la sesión opaca existente en JWT permanente de móvil sin threat model, revocación y device binding.
4. Registrar dispositivos y tokens APNs/FCM mediante API autenticada, por instalación/usuario/dispositivo, con hash del token, timestamps, consentimiento, invalidación al logout/disable y cola de aviso que nunca contenga datos sensibles.

### Push, background y offline

- Push significa “hay algo que revisar”; el contenido confidencial se recupera autenticado al abrir. Apple prohíbe usar push para información sensible/confidencial y no debe ser requisito para que la app funcione ([App Review Guidelines 4.5.4](https://developer.apple.com/app-store/review/guidelines/)).
- No convertir las automatizaciones, approvals, cron, agentes o Computer Use en background tasks de iOS/Android. El servidor conserva ejecución exactamente-una-vez, lease/fencing y audit trail; el dispositivo sólo refresca estado cuando el SO se lo permite.
- El MVP offline es shell/última pantalla claramente marcada, composer en borrador local y reintento idempotente con clave de cliente controlada por el servidor. No lectura offline de archivos/conversaciones hasta definir clasificación, cifrado, TTL, wipe on disable y conflicto/revocación.

### Archivos y desktop bridge

- Móvil: usar el selector/cámara nativo y subir directo a una ruta autenticada que conserve los actuales MIME/size/virus/approval checks. No mapear paths locales ni devolver URLs de filesystem al servidor.
- macOS: `open/save` mediante diálogo con selección explícita y scoped access. El bridge no puede recibir un path arbitrario de chat/documento. El bundle del bridge sólo expone comandos declarativos, tipados, con schema, origen de ventana, usuario/thread y audit event verificados server-side.
- Computer Use: no bridge en MVP. El cliente continúa usando el viewer same-origin con tokens efímeros y takeover/heartbeats existentes. Cualquier función futura de “abrir en app local” debe ser una acción de alto riesgo, approval específica, scope de dominio/proceso, readback y kill/revoke independiente; no una extensión de CDP.

## 5. Seguridad, operación y observabilidad

### Controles obligatorios antes de beta

1. No secretos ni cookies de sesión en logs, analytics, crash reports, URLs, clipboard, push payloads, screenshots automáticos ni storage no cifrado.
2. CSP/origin allowlist estrictas; `https`/`wss` únicamente; pinning no sustituye la validación TLS/servidor. La WebView sólo carga origen de instalación autorizado, no HTML proporcionado por chat/documento.
3. Bridge nativo deny-by-default: permisos/capabilities por ventana y plataforma, schemas estrechos, rate limit, usuario/thread/installation derivado de sesión y un event auditado por cada llamada. En Electron se requerirían explícitamente `contextIsolation`, sandbox de renderer, preload mínimo y validación del `sender` IPC; por eso no se adopta de entrada.
4. Keychain/Keystore sólo para material de dispositivo estrictamente necesario. El servidor conserva secretos, identidad efectiva y decisión de permiso. Logout/disable/recovery revocan device registration y limpian caché/credenciales locales permitidas.
5. Separar los pipelines de release web, iOS, Android y macOS; SBOM/dependencias, firma, checksum, provenance y rollback por canal. Una actualización nativa no debe modificar capacidades sin release/review correspondiente.

### Eventos y métricas mínimos

Correlacionar, sin texto de prompts/archivos ni tokens: `installation_id`, `user_id` pseudonimizado en proveedor externo, `device_installation_id`, versión web/binario, OS, ruta/feature, request/turn/approval/audit ID, red/lifecycle, resultado y clase de error. Retener/cruzar datos conforme a política de instalación.

Medir: instalación y activación, login/recovery/refresh/disable, URL entrante rechazada, grant/deny de permisos, registro/revocación push, entrega vs tap, cold start/TTI, upload/download, reconnect/NDJSON EOF, approval→readback, crash/ANR, actualización/rollback y divergencia de capacidades por plataforma. La aceptación no es una métrica verde: debe correlacionar usuario, aprobación, ejecución única y readback del proveedor, igual que la web.

## 6. Diferencias y límites iOS que condicionan el diseño

| Tema | Límite práctico iOS | Decisión AiBrain |
| --- | --- | --- |
| Background | El SO controla duración/frecuencia; APNs background es baja prioridad y sin entrega garantizada. | Server workers como fuente de ejecución; app refresca/reintenta, nunca promete cron/agent local. |
| Push | Consentimiento opcional; no contenido sensible ni requisito de acceso. | Notificación genérica y fetch autenticado al abrir. |
| Store | Una mera web embebida puede fallar mínimo de funcionalidad. Apple exige utilidad/UI más allá de website reempaquetado. | Capacitor MVP incluye valor nativo real: selector seguro de archivos/fotos, links, notificaciones, lifecycle/offline explícito, UX iOS y soporte. Usar TestFlight primero. |
| Código descargado | App Review limita descargar/ejecutar código que cambie funcionalidades. | No descargar plugins/JS ejecutable arbitrario ni hacer el cliente un runtime de agentes. La configuración/contenido es dato validado por backend. |
| Computer use | iOS no ofrece control general de otras apps; sandbox y revisión lo impiden. | Sólo viewer remoto y aprobaciones en servidor. |
| Files | Sandbox por app; acceso mediado por document/photo picker. | Selección explícita y upload; no rutas ni persistencia de archivos sin política. |
| Auth | Deep links son entrada no confiable; cookies/webview y callbacks requieren pruebas en cold start. | HTTPS canónica + Universal Links, parser allowlist, challenge one-time y sesión servidor. |
| Updates | Binarios por App Store/TestFlight; no usar actualización remota para alterar la funcionalidad nativa. | Feature flags server-side sólo dentro de capacidades ya revisadas; releases nativos versionados. |

Apple indica además que la app debe incluir valor por encima de un sitio reempaquetado, no puede usar background services fuera de sus propósitos y no puede descargar/ejecutar código que introduzca/cambie funcionalidades ([App Review Guidelines 2.5.2, 2.5.4 y 4.2](https://developer.apple.com/app-store/review/guidelines/)).

## 7. Checklist de distribución y stores

### Común antes de cualquier beta externa

- [ ] Owner legal, bundle IDs/package names, dominios y soporte definidos por instalación/producto; no publicar clones indistinguibles.
- [ ] Threat model de app/shell/bridge, inventario de permisos/SDKs/datos, política de privacidad, retención/borrado, DPA y revisión legal según cliente/sector.
- [ ] Cuenta demo aislada o modo demo plenamente funcional, backend accesible para review y Review Notes que expliquen login, approvals y funcionalidades no obvias. Apple lo exige para apps account-based ([Guidelines 2.1](https://developer.apple.com/app-store/review/guidelines/)).
- [ ] Matriz de dispositivos/OS/red/cold-start y casos de revocación, una prueba real de usuario/tenant aislado y una acción aprobada con readback.
- [ ] Crash reporting y logs con scrubbing verificado; runbook de incidente, revocación de device tokens y rollback de binario/web.
- [ ] Iconos, nombre, capturas, age rating, soporte, privacidad, accesibilidad, licencia/copyright y export compliance revisados; sólo permisos estrictamente necesarios y purpose strings comprensibles.

### iOS / iPadOS (Capacitor)

- [ ] Apple Developer Program, App ID/capabilities, perfiles/certificados y firma de release; TestFlight interno antes de externo.
- [ ] `apple-app-site-association` publicado por cada dominio canónico y Universal Links validados en instalación nueva, app cerrada y navegador fallback.
- [ ] APNs capability, consentimiento contextual, token registration/revocation y payload no sensible; no basar flujos críticos en silent push.
- [ ] Privacy Nutrition Label y declaración exacta de datos propios y SDKs; no marcar datos inexistentes ni omitir telemetría/crash reporting.
- [ ] Si existe login social de terceros como login principal, confirmar requisito de Apple de alternativa equivalente bajo Guideline 4.8; el flujo actual email/password/Supabase debe revalidarse en el momento de implementación.
- [ ] Review Notes: demo, pasos de login/recovery, qué hace cada permiso, cómo probar archivos/push, que los workers y Computer Use viven en servidor y cómo se restringen las operaciones.
- [ ] Confirmar que la app aporta valor nativo tangible y no es una URL en WebView; no solicitar push/track/location para permitir acceso.

### macOS

- [ ] Decidir canal antes de build: **Mac App Store** (App Sandbox obligatorio, updates por Apple) o **Developer ID directa** (Hardened Runtime, firma, notarización y updater propios). Apple describe la diferencia y que la distribución directa debe notarizarse ([distribución macOS](https://developer.apple.com/macos/distribution/), [notarización](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)).
- [ ] Validar entitlements mínimos, file picker/scoped access, Keychain, network, sandbox y que no se solicita Accessibility/Automation sin caso de uso concreto y revisión humana/legal.
- [ ] Para Tauri: signing identity segura, artefactos firmados, llave de updater fuera del repo y rotación/rollback ensayados. Tauri exige firma de actualizaciones y no permite desactivarla ([Updater](https://v2.tauri.app/plugin/updater/)).
- [ ] No cargar páginas/documentos no confiables en un contexto con bridge; capabilities separadas por ventana y auditoría de toda llamada nativa.

### Android (sólo después de validar demanda)

- [ ] Android App Bundle firmado y Play App Signing; Google exige AAB para nuevas apps de Play ([publicación Android](https://developer.android.com/studio/publish/)).
- [ ] `assetlinks.json` HTTPS sin redirects, con fingerprint de certificado de release/Play, e intent filters `autoVerify`; probar link con app instalada y no instalada.
- [ ] FCM y runtime permission de notificación en Android 13+; testar Doze, app terminada y preferencias de canal. No prometer entrega inmediata.
- [ ] Data Safety completado según datos propios y SDKs; Google Play requiere describir recogida/compartición en ese formulario ([Data safety](https://developer.android.com/privacy-and-security/declare-data-use)).
- [ ] Permisos mínimos, política de privacidad, target SDK vigente, pre-launch reports y matriz de dispositivos; no usar permisos sensibles/broad storage sin necesidad y declaración justificable.

## 8. Riesgos, decisiones diferidas y gates

| Riesgo | Mitigación / gate |
| --- | --- |
| Rechazo 4.2 por webview | No enviar una carcasa vacía: beta TestFlight, flujos nativos concretos, UX iOS, demo y notes; mantener PWA como alternativa de acceso. |
| Fuga de datos por cache/push/analytics | Data map por feature, payloads genéricos, redacción de logs, Keychain/Keystore y wipe/revocación antes de beta. |
| Confundir app con executor | Arquitectura fija: servidor ejecuta; cliente observa/solicita. Ningún background task local toma approvals o ejecuta conectores. |
| Bridge macOS se vuelve escape de sandbox | Scope por capability, no shell/Node/CDP general, user consent, audit/readback y decisión Store vs Developer ID previa. |
| Duplicar backend/operación | No empaquetar Next server con Tauri/Electron. Un API/URL canónico y releases separadas, no lógicas de negocio paralelas. |
| Android amplía coste sin demanda | Gate explícito tras beta iOS y señal de usuarios/cuentas; mantener React/Capacitor portable hasta entonces. |
| Cambios de reglas de stores | Releer enlaces oficiales, requisitos de target SDK y formularios justo antes de cada submit; este documento no sustituye revisión actual. |

## 9. Próximo trabajo autorizado al abrir implementación

1. Confirmar producto/canal: instalación única, multi-tenant o Custom App B2B; quién es titular de cada bundle y qué dominios se asocian.
2. Ejecutar un discovery de datos/permissions y escribir un ADR de auth móvil, URLs, device registration, cache y revocación con threat model.
3. Extraer sólo la capa React/API realmente compartible, sin migrar backend ni cambiar la semántica de la sesión/approval.
4. Crear el PWA backlog y validar en QA contra los gates existentes de tenancy, recoveries, Browser/Computer Use y readback real.
5. Sólo entonces crear el proyecto Capacitor en un worktree enfocado, con build firmado de TestFlight y pruebas físicas. No añadir Android ni bridge macOS como alcance implícito.

## Fuentes oficiales consultadas

- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Apple Universal Links](https://developer.apple.com/documentation/xcode/allowing-apps-and-websites-to-link-to-your-content)
- [Apple Web Push](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)
- [Apple background notifications](https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app)
- [Apple App Sandbox](https://developer.apple.com/documentation/security/protecting-user-data-with-app-sandbox)
- [Apple macOS distribution and notarization](https://developer.apple.com/macos/distribution/), [notarization details](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- [Capacitor documentation](https://capacitorjs.com/docs), [Deep Links](https://capacitorjs.com/docs/guides/deep-links), [Push Notifications](https://capacitorjs.com/docs/apis/push-notifications), [Background Runner](https://capacitorjs.com/docs/apis/background-runner)
- [Tauri v2 + Next.js](https://v2.tauri.app/start/frontend/nextjs/), [Tauri updater](https://v2.tauri.app/plugin/updater/), [Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/)
- [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security), [Electron auto-updater](https://www.electronjs.org/docs/latest/api/auto-updater/)
- [Android App Links](https://developer.android.com/training/app-links/about), [Android publishing](https://developer.android.com/studio/publish/), [Android Data safety](https://developer.android.com/privacy-and-security/declare-data-use), [reliable messaging](https://developer.android.com/social-and-messaging/guides/communication/receiving-messages)
