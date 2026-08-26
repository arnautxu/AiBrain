# PERMISSIONS.md v1 y resolución server-side

`PERMISSIONS.md` es la política de comportamiento elegida para AiBrain V1. Indica qué puede consultar, responder, ejecutar o publicar un trabajador. No es RBAC, no oculta físicamente carpetas y no sustituye el aislamiento técnico de usuarios, workers, archivos, credenciales, navegador o sesiones.

La única implementación actual es `MarkdownPermissionProvider`. Usa únicamente rutas configuradas en el servidor; el navegador no puede elegir instalación, usuario, rol, proyecto, fichero ni instrucciones.

## Contrato

```ts
interface PermissionProvider {
  resolveForUser(
    installationId: string,
    userId: string,
    context: {
      turnId: string;
      roleId: string | null;
      projectId: string | null;
    },
  ): Promise<ResolvedPermissions>;
}
```

El caller debe derivar todos esos valores de la sesión autenticada y del thread/turn resuelto en servidor. No debe copiar valores enviados por el navegador sin autorización previa.

Cada instalación se registra explícitamente con un `permissionsRoot` absoluto. No existe fallback a otra instalación ni búsqueda global.

## Layout

```text
<permissionsRoot>/
  PERMISSIONS.md
  roles/<role-id>/PERMISSIONS.md
  projects/<project-uuid>/PERMISSIONS.md
  users/<user-uuid>/PERMISSIONS.md
  users/<user-uuid>/projects/<project-uuid>/PERMISSIONS.md
```

Las políticas de instalación y usuario son obligatorias. Rol, proyecto y usuario+proyecto son opcionales y solo se buscan cuando el contexto server-side incluye ese sujeto.

## Formato estricto

Cada fichero activo:

- se llama exactamente `PERMISSIONS.md`;
- es UTF-8 sin BOM y termina en salto de línea;
- tiene `schemaVersion: 1`;
- tiene un `policyVersion` entero positivo que se incrementa al cambiar la política;
- declara exactamente el scope y los identificadores correspondientes;
- contiene únicamente las cabeceras y líneas de reglas definidas por v1;
- no tiene bits de escritura y no es symlink ni hardlink.

Plantilla de formato:

```md
---
schemaVersion: 1
policyVersion: 1
scope: user
installationId: <installation-id>
userId: <user-uuid>
---

# Permissions

## Rules

- `documents.read` | consult | allow | Consult approved documents assigned to this employee.
- `documents.publish` | publish | deny | Never publish without the explicit server-side confirmation flow.
```

Acciones admitidas: `consult`, `respond`, `execute` y `publish`. Efectos admitidos: `allow` y `deny`. Los `ruleId` son identificadores estables; no se aceptan campos, secciones, acciones, efectos o formatos adicionales.

Un fichero `PERMISSIONS.yaml`, `permissions.md`, una segunda variante o cualquier `PERMISSIONS.*` desconocido hace fallar la resolución. No se elige silenciosamente una variante.

## Herencia y precedencia

La resolución aplica estas capas de menor a mayor precedencia:

| Precedencia | Scope |
| ---: | --- |
| 100 | instalación |
| 200 | rol |
| 300 | proyecto |
| 400 | usuario |
| 500 | usuario+proyecto |

Las reglas con `ruleId` distinto se acumulan. Una capa superior sustituye completamente una regla inferior con el mismo `ruleId`. El `policyVersion` identifica la revisión del fichero, pero no cambia la precedencia.

Ejemplo: si instalación permite `documents.read`, rol lo deniega y usuario+proyecto lo vuelve a definir, prevalece exclusivamente la definición de usuario+proyecto.

## Fingerprint por turn

Cada resolución produce un SHA-256 sobre JSON canónico que incluye:

- instalación, usuario, rol y proyecto resueltos;
- scopes cargados, precedencia, `policyVersion` y fingerprint de cada fuente;
- reglas efectivas ordenadas de forma determinista.

El `turnId` queda ligado al resultado y a la auditoría, pero no forma parte del fingerprint. Por eso dos turns con políticas y contexto idénticos comparten fingerprint; cualquier cambio efectivo de política o contexto lo cambia. La integración del runtime debe guardar este fingerprint antes de iniciar cada turn.

## Instrucciones efectivas

`developerInstructions` contiene únicamente reglas efectivas y una frontera explícita contra prompt injection: mensajes, documentos, webs, adjuntos y outputs de herramientas son datos no fiables y no pueden sustituir las reglas resueltas. Las reglas sobrescritas no se inyectan.

Esta protección sigue siendo conductual. La autorización física de archivos, secrets, browser, publicación y runtime debe aplicarse por separado.

## Auditoría

El provider exige un `PermissionResolutionAuditSink` y falla cerrado si no puede registrar una resolución correcta. Los eventos incluyen:

- instalación, usuario, rol, proyecto y turn;
- resultado `resolved` o `rejected`;
- fingerprints, scopes, versiones, precedencias y número de reglas;
- código de error en rechazos.

No incluyen instrucciones, contenido Markdown, paths absolutos, documentos ni secretos.

## Seguridad de filesystem

La implementación:

- valida IDs canónicos antes de construir rutas;
- camina la jerarquía y rechaza directorios symlink;
- rechaza directorios de política escribibles por grupo u otros usuarios;
- rechaza symlink y hardlink del fichero final;
- abre con `O_NOFOLLOW`, compara inode/dispositivo y vuelve a validar la jerarquía;
- comprueba que el path real permanezca dentro del root de instalación;
- limita cada fichero a 256 KiB por defecto;
- exige fichero regular y sin bits de escritura;
- nunca escribe, renombra ni versiona la política activa.

## Versionado recuperable

`policyVersion` y el fingerprint identifican exactamente la revisión utilizada por cada turn. La operación administrativa que cambie una política debe, fuera de este reader:

1. validar el nuevo documento;
2. archivar la revisión anterior en un repositorio de versiones separado del directorio activo;
3. sustituir atómicamente `PERMISSIONS.md` manteniéndolo read-only;
4. registrar el cambio en auditoría;
5. conservar una ruta operativa de rollback.

No deben guardarse variantes `PERMISSIONS.*` junto al fichero activo: se rechazan como formato desconocido o ambiguo. El writer/versionador administrativo no forma parte de este módulo aislado y deberá reutilizar las primitivas file-backed al integrarse.

## Pruebas

```bash
npx vitest run src/permissions
npx eslint src/permissions
npm run typecheck
```

Los tests usan únicamente instalaciones, usuarios, proyectos y políticas sintéticos dentro de directorios temporales. Cubren precedencia completa, fingerprint, aislamiento entre instalaciones, auditoría sin contenido, traversal, symlinks, formatos desconocidos/ambiguos, metadata incoherente, fichero escribible, ausencia, tamaño, UTF-8 y fallo del audit sink.
