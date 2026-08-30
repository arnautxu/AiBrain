# Red documental empresarial

Cada instalación tiene una raíz persistente propia en
`<paths.dataRoot>/enterprise-documents`. Como `dataRoot` es un volumen de la
instalación, la raíz sobrevive a reinicios e imágenes nuevas y está montada por
igual en `app` y `automation-worker`. No se monta el `dataRoot` completo en el
sandbox de un trabajador.

La estructura es deliberadamente simple y ampliable:

```text
enterprise-documents/
  company/shared/                 # material común de empresa
  departments/<department-id>/shared/ # material de grupos/departamentos autorizados
  projects/<project-id>/shared/   # material del proyecto/equipo
  users/<user-id>/private/        # material privado del empleado
```

Cada scope contiene `.aibrain-document-scope.json`, con instalación y
procedencia. El proceso web resuelve empresa, grupos/departamentos, proyecto
actual y usuario desde la sesión y la administración server-side. El agente
consulta esos scopes mediante `aibrain_company_files.search/read`: no recibe
`dataRoot`, paths del host, secretos, `.env`, credenciales, socket de Docker,
el sistema anfitrión ni datos de otra instalación. La creación, búsqueda y
lectura rechazan traversal, enlaces simbólicos, raíces forjadas, nombres
sensibles y contenido con forma de credencial.

## Migración para una instalación nueva o existente

No hace falta cambiar el JSON de instalación: el directorio se deriva de su
`paths.dataRoot`, que ya es obligatorio y exclusivo por instalación. Después
del primer turno autorizado se crean las raíces necesarias; también puede
prepararse con el flujo normal de provisión de usuarios. Confirma que el
volumen `aibrain-data` sigue presente en ambos servicios de Compose.

Las políticas `PERMISSIONS.md` controlan los scopes de un turno:

- `documents.read` / `documents.write` habilitan lectura/escritura en los tres
  scopes base y en los departamentos derivados de la membresía server-side;
- los equivalentes precisos `documents.company.read`,
  `documents.project.write`, etc. limitan ese permiso a un solo scope;
- un `deny` efectivo prevalece. La resolución calcula también escritura para
  conservar la política completa, pero la superficie descrita abajo es de
  solo lectura.

La superficie del agente implementada aquí expone únicamente `search/read`.
Aunque la resolución conserva `documents.*.write` para una futura mutación
server-side, no monta esas raíces en el worker ni ofrece una herramienta de
escritura; por tanto, este flujo no puede modificar documentos empresariales.

El índice busca nombre y texto UTF-8 de archivos acotados y devuelve scope,
path relativo, hash y procedencia, nunca un path del host. Archivos binarios,
sensibles o mayores de 512 KB no se entregan al agente.
