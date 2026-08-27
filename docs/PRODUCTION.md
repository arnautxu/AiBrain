# Operación de AiBrain en servidor dedicado

AiBrain se despliega como una instalación white-label independiente por empresa. La misma imagen sirve para otra compañía cambiando únicamente `InstallationConfig`, secretos, branding, rutas host, nombres de red/volúmenes, puerto e imagen de release. No existen servicios, usuarios o rutas funcionales precreados para una empresa concreta.

El stack de QA está en `infra/hetzner/compose.yaml` y su procedimiento reproducible en [HETZNER_MIGRATION.md](HETZNER_MIGRATION.md). No debe exponerse a tráfico real hasta completar allí todos los gates externos.

## Fronteras de seguridad

- Next.js, el publicador documental y los App Servers ejecutan como UID/GID no-root configurable; el root filesystem del contenedor es read-only y todas las capabilities están eliminadas.
- `sourceReadRoot` es un bind mount `ro` para Next.js y los workers.
- `publishWriteRoot` solo es writable por el proceso servidor/publicador. Cada App Server se ejecuta con `bubblewrap`: el root se vuelve read-only y `dataRoot` queda oculto. Solo se reexponen el contexto corporativo/documental de lectura, los tres Markdown privados del empleado y sus raíces runtime/workspace/staging/artifacts/audit. Perfiles Chromium, sesiones, backups y carpetas de otros empleados no son legibles; `publish-rw` se reemplaza por un mount vacío read-only.
- El arranque falla si el host no puede crear ese namespace o si `source-ro` es writable. No hay fallback de worker sin aislamiento.
- No se monta `docker.sock`, no se usan redes/volúmenes externos y todos sus nombres son obligatoriamente únicos por instalación.
- Chromium usa un canal CDP heredado por proceso (`--remote-debugging-pipe`),
  sin socket TCP, discovery URL ni `DevToolsActivePort`; perfiles, targets y
  descargas se aíslan por empleado y thread. No se publican puertos CDP o
  viewers internos.
- LibreOffice se ejecuta en headless/safe mode, con perfil desechable y seguridad de macros `Very High`; uploads OOXML con macros ya son rechazados antes de conversión. Poppler y QPDF forman parte de la imagen.
- Los logs Docker tienen rotación y buffer no bloqueante. No se debe ejecutar `docker compose config` sin `--quiet` en registros compartidos porque puede materializar variables del `env_file`.

## Persistencia

```text
/var/lib/aibrain/data/                 estado file-backed, sesiones y empleados
/var/lib/aibrain/data/users/<uuid>/    CODEX_HOME, workspace, staging, artefactos, browser y auditoría privados
/var/lib/aibrain/data/backups/         volumen de snapshots separado
/var/lib/aibrain-restores/             volumen de restauraciones QA, nunca root activo
/srv/aibrain/source-ro/                repositorio documental oficial, solo lectura
/srv/aibrain/publish-rw/               destino oficial, escritura solo server-side confirmada
```

Los límites de CPU, memoria, PIDs, descriptores, tmpfs y arranques de navegador protegen frente a saturación. No son cuotas comerciales de empleados, proyectos, chats, turns o tokens; se amplían cambiando recursos/configuración, no código.

## Riesgos P0 aún abiertos

El canal CDP ya no cruza el namespace de red: existe únicamente entre Next.js
y el proceso Chrome exacto mediante descriptores heredados. El worker aislado
no recibe esos descriptores ni puede descubrir un puerto. El riesgo browser que
queda abierto es el egress: la autorización de un hostname y la conexión deben
usar la misma resolución fijada para impedir DNS rebinding, y esa frontera debe
validarse dentro de la imagen QA junto con los bloqueos de red privada,
loopback, link-local y metadata. Browser/Computer Use no se considera listo
para producción hasta cerrar y probar ese gate.

La imagen base Node está fijada por versión y digest, pero Chromium, LibreOffice, Poppler y QPDF se resuelven desde APT durante el build. `AIBRAIN_CHROME_EXPECTED_VERSION` detecta cambios y bloquea un arranque que no coincida, pero no vuelve reproducible el build. Falta fijar snapshots/artifacts y checksums de esas herramientas o adoptar una imagen interna inmutable escaneada. Cada build QA debe registrar versiones, digest y SBOM; no debe describirse como reproducible bit a bit.

## Variables obligatorias

Los valores de Compose, no secretos, parten de `infra/hetzner/compose.env.example`. Los secretos de runtime parten de `infra/hetzner/aibrain.env.example` y deben vivir fuera del checkout con modo `0600`.

Secretos independientes, cada uno con al menos 32 bytes:

- `AIBRAIN_SESSION_SECRET`
- `AIBRAIN_AUTH_CHALLENGE_SECRET`
- `AIBRAIN_PUBLICATION_SECRET`
- `AIBRAIN_BROWSER_GATEWAY_SECRET`

Supabase solo requiere su URL y publishable key para Auth. No se inyecta service-role/secret key ni se usa Postgres de producto. `AIBRAIN_CHROME_EXPECTED_VERSION` debe coincidir exactamente con Chromium en la imagen inmutable.

## Health, logs y alertas

El healthcheck interno consulta Next.js por loopback cada 15 segundos, con período inicial de 45 segundos. Un estado `unhealthy`, reinicios repetidos, presión de disco mayor al 80 %, volumen de backups sin réplica reciente o errores `preflight failed` deben alertar al operador. El runbook muestra los comandos de diagnóstico sin imprimir secretos.

Los logs esperados son códigos y métricas acotadas. No añadir bodies, cookies, tokens, credenciales, contenido documental o variables de entorno a logs. La retención local por defecto es cinco ficheros de 10 MB; la exportación remota y el canal de alertas son configuración externa por instalación.

## Gates de producción

Antes de DNS/cutover deben estar validados en un servidor dedicado de la empresa:

1. build desde cero, `npm run infra:validate`, `docker compose config --quiet`, SBOM y scan crítico;
2. health estable y smoke de login/trabajo con Supabase temporalmente inaccesible después de login;
3. Codex dedicado autenticado en el `CODEX_HOME` del primer empleado, nunca una cuenta personal compartida;
4. matriz de dos empleados para workers, threads, approvals, archivos y browser sin acceso cruzado;
5. `source-ro` no writable y `publish-rw` invisible/no writable desde el App Server;
6. Office/PDF/texto/imagen y confirmación documental exactamente una vez;
7. backup, restore a volumen separado, reboot recovery, release y rollback medidos;
8. réplica de backup cifrada fuera del servidor y alertas conectadas;
9. revisión de capacidad/egress y hardening del host;
10. canal CDP heredado sin sockets, egress browser fijado por DNS y build reproducible de la toolchain;
11. autorización separada para DNS y producción.

La imagen base se fija por digest, Codex/Node packages por versión y APT contra
el snapshot inmutable `20260820T000000Z` de Debian. Cambiar ese snapshot es una
actualización de release revisable: requiere build limpio, SBOM, scan y matriz
Office/PDF/Chromium antes de promover la nueva imagen.
