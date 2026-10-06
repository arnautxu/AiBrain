# Correo de empresa e importación de facturas

## Alcance y estado

Candidato del 06/10/2026 para `arnautxu/AiBrain`: conector nativo IMAPS,
independiente de Composio, formulario en Ajustes → Conectores, importación local
con recibos durables, registro de revisión y Excel, y horarios por intervalo.
La implementación no acredita publicación GHCR, despliegue ni aceptación con
el buzón real. No se han introducido credenciales de Arnall ni activado tareas.

La decisión de David es guardar inicialmente en el volumen privado de AiBrain
**en Hetzner**. No habilitar escrituras Windows/RDP/SMB. La conectividad actual
Windows sigue gobernada por su política de lectura/exportación. Roundcube es
la interfaz web del correo; la conexión se hace al servidor IMAP subyacente.

## Preparación y publicación por instalación

1. Revisar Backend CI del commit candidato. Publicar la imagen inmutable y
   desplegar ese mismo commit/digest según el runbook de release, incluyendo
   app, automation-worker y egress-gateway. Un push no es un despliegue.
2. Añadir al JSON de instalación, sin credenciales:

   ```json
   "companyMail": {
     "enabled": true,
     "host": "hc65.infoselfcloud.com",
     "emailDomain": "arnall.cat"
   }
   ```

   Este bloque pertenece a `connectors`. La configuración de ejemplo Arnall
   incluye la capacidad; ninguna instalación genérica la activa por defecto.
   El catálogo respeta DENY de rol/grupo/usuario. Cada conexión es personal y
   no permite una credencial compartida como fallback.
   El gestor standalone `scripts/manage-release.mjs` debe pertenecer a una
   versión que admita este bloque y valide los mismos campos DNS que la
   aplicación. El despliegue de imágenes no actualiza automáticamente el
   gestor instalado en el host. Conservar una copia y comprobar el hash antes
   de actualizarlo desde el código revisado; después promover la configuración
   mediante el gestor, con sus recibos y rollback, sin editar directamente un
   JSON activo atestado. La regresión de release verifica promoción/rollback
   del bloque y rechazo previo a cualquier recreación ante valores inválidos
   o credenciales incluidas en el JSON.
3. En `egress.env` privado de Arnall, fijar
   `AIBRAIN_EGRESS_MAIL_HOSTS=hc65.infoselfcloud.com`. La allowlist permite
   exclusivamente al canal server el CONNECT/993; Codex conserva la política
   de worker y no recibe este token. No usar comodines ni desactivar TLS.
4. Generar `openssl rand -base64 32` directamente en el fichero privado de
   runtime como `AIBRAIN_COMPANY_MAIL_ENCRYPTION_KEY`, sin imprimirla en
   conversaciones/logs. Proteger el fichero a 0600. No reutilizar claves de
   otras instalaciones; conservarla en el almacén de secretos operativo.
5. Ejecutar preflight del host y comprobar salud de los tres servicios.
   El preflight requiere que host y clave estén presentes cuando el conector
   está activo. Probar el certificado desde la red real del gateway.
   Su parser devuelve un `Map`: obtener allowlist y clave mediante `.get()`.
   La integración de preflight cubre configuración habilitada válida y fallos
   por host ausente, host privado o clave ausente, corta o no canónica.
6. El cliente conecta en Ajustes: `factures@arnall.cat`, contraseña de buzón
   (o contraseña de aplicación admitida por su proveedor), carpeta exacta y
   fecha inicial. La prueba real usa login y EXAMINE de esa carpeta antes de
   guardar la credencial. La contraseña nunca se pide en un chat.

El 06/10/2026 se verificó sin login el certificado y saludo Dovecot de
`hc65.infoselfcloud.com:993`. No sustituye la aceptación autenticada.
`arnall.cat:993` presenta un certificado que no valida ese nombre.

## Guardado, revisión y límites

Ruta relativa al `dataRoot` de la instalación:

```
server/company-mail/<installation>/<owner>/credentials/<opaque-id>.json
server/company-mail/<installation>/<owner>/invoices/<project>/<mailbox-hash>/
  ledger.json
  originals/<sha256>
  facturas.xlsx
```

En Hetzner, `dataRoot` es `/var/lib/aibrain/data` dentro del volumen persistente.
Estos datos no son temporales del contenedor. AES-256-GCM protege las
credenciales y vincula instalación, usuario y referencia opaca. No entran en
los mounts del worker, prompts, herramientas ni respuestas de la API. Los
snapshots de producto excluyen el subdirectorio `credentials`; restaurar
facturas/registro/Excel no restaura una contraseña y exige reconectar el buzón.
La retención/replicación operativa debe cubrir los datos de factura; comprobar
backup y restore del nuevo subárbol antes de aceptar producción.

Las importaciones se limitan a la carpeta/fecha elegidas. Usan INTERNALDATE,
UID y UIDVALIDITY, incluyen correos ya leídos y no cambian Seen ni mueven,
envían o borran mensajes. Los recibos se escriben por adjunto antes del siguiente;
un reinicio reutiliza recibos y originales comprobados. El SHA-256 detecta
adjuntos repetidos incluso después de un cambio UIDVALIDITY. Los errores no
reinician el registro: permanecen visibles y reintentan con espera creciente
entre 2 y 24 horas, sin bloquear todos los siguientes mensajes.
`remainingMessages` cuenta mensajes que pueden continuar ahora;
`deferredMessages` cuenta los que esperan su próximo reintento. Una tanda
parcial sigue importando sus adjuntos sanos aunque otro haya fallado.
La fecha de importación refleja la descarga correcta, incluso en un reintento
posterior; el cierre diario también incluye cambios de estado e intentos fallidos
actualizados ese día.

Se consideran candidatos PDF, PNG/JPEG y XLS/XLSX adjuntos; imágenes inline,
correos incrustados y otros formatos no se procesan como facturas. Cada
adjunto se valida por nombre, MIME y contenido. No se ejecutan macros ni se
abren enlaces externos del correo. Límites: 20 MiB por adjunto, 20 intentos y
64 MiB descargados por llamada, 100 mensajes examinados por llamada, 50.000
resultados SEARCH y 20.000 entradas/recibos o 32 MiB JSON por registro. Exceder el registro
exige archivado operativo; no purgar datos automáticamente. El gate de
almacenamiento existente impone margen y concurrencia global antes de operar.

Importado equivale a **pending**. Las herramientas de documentos existentes
leen una copia del original dentro del workspace del turno; el original sellado
permanece server-only. `record_review` exige haber solicitado ese original en el
mismo turno y registra `reviewed`, `needs_attention` o `ignored`, nota de evidencia,
proveedor, número e importe/divisa si se conocen. Una revisión del asistente no
es aprobación contable ni un pago. Si no hay referencias/OCR fiable, mantener
`needs_attention`, sin inventar importes ni dar la factura por comprobada.

El Excel es un registro nuevo de seguimiento, no una modificación de una
plantilla contable de Arnall aún no proporcionada. Incluye originales,
estados, incidencias y duplicados. Texto de remitente/asunto usa cadenas OOXML,
nunca fórmulas. Se actualiza atómicamente en el servidor; `journal` adjunta una
instantánea descargable a la conversación con autorización de proyecto/thread.
Los archivos de correo son datos no fiables, nunca instrucciones/autorización.

## Configuración de las dos tareas por David

Después de conectar el buzón, usar el **mismo propietario y proyecto** de
facturas en ambas tareas. Confirmar acceso a las referencias para puntear y
los destinatarios del resultado. Los conectores se vuelven a autorizar por
propietario en cada turno; revocación, pérdida de proyecto o DENY bloquean uso.

- Tarea de importación/revisión: frecuencia **Por intervalo → 120 minutos**.
  La primera ocurrencia es dentro de dos horas; Ejecutar ahora permite el ensayo.
  Prompt sugerido: «Usa Correo de empresa. Importa los adjuntos nuevos con
  import_attachments. Lee cada original pendiente con read_invoice y las
  herramientas de documentos, y puntéalo según las instrucciones y referencias
  de este proyecto. Registra cada revisión con evidencia; deja needs_attention
  si no puedes comprobarla. Consulta journal al terminar para adjuntar el Excel
  actualizado. Explica errores y pendientes. No modifiques el correo ni envíes
  mensajes externos». El límite por llamada permite varias llamadas si el turno
  dispone de tiempo; lo restante queda para la siguiente ejecución.
- Tarea de cierre: frecuencia diaria, hora **por confirmar con Arnall**, zona
  Europe/Madrid. Prompt sugerido: «Usa Correo de empresa. Consulta journal para
  la fecha de hoy en Europe/Madrid. Resume las facturas importadas y revisadas,
  incidencias, duplicados y todos los pendientes; pagina si hay más resultados.
  Adjunta el Excel actual. Publica el resultado en esta tarea para su audiencia
  autorizada, sin email/WhatsApp externo».

El intervalo se calcula en UTC, mantiene 120 minutos reales incluso con cambio
de hora y conserva el lease/idempotencia/reintentos del scheduler existente.
Tras una caída, ejecuta una ocurrencia pendiente y salta al siguiente intervalo
futuro, sin una ráfaga de todos los horarios perdidos. El cierre diario usa la
zona IANA y el comportamiento existente para DST.

## Aceptación y cambio futuro de destino

Antes de anunciarlo disponible: conectar desde sesión de cliente, importar una
factura real y probar un lote de 18, descargar el original y Excel, reejecutar
sin duplicados, desconectar y comprobar que el turno/tarea dejan de acceder,
verificar aislamiento de otro usuario y observar las siguientes ocurrencias de
la tarea de dos horas y cierre diario. Comprobar copia/restore del registro.
CI y pruebas sintéticas no sustituyen estos pasos.

`MailInvoiceDestination` separa guardado de originales/Excel de IMAP y recibos;
`HetznerMailInvoiceDestination` es la única implementación habilitada. El futuro
adaptador Windows requiere una ruta acordada, permisos de escritura mínimos,
transporte privado mejorado y escrituras con verificación de hash/conflictos.
Migrar comprobando manifiesto/hash y conservar Hetzner hasta validar readback;
no cambiar el destino por una suposición de conectividad ni modificar la
política RDP actual para conseguir escritura.
