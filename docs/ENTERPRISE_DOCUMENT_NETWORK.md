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
  projects/<project-id>/shared/   # material del proyecto/equipo
  users/<user-id>/private/        # material privado del empleado
```

Cada scope contiene `.aibrain-document-scope.json`, con instalación y
procedencia. Los workers reciben solamente los scopes resueltos para su sesión
y proyecto; no reciben `dataRoot`, secretos, `.env`, credenciales, socket de
Docker, el sistema anfitrión ni datos de otra instalación. La creación y la
indexación rechazan traversal y enlaces simbólicos.

## Migración para una instalación nueva o existente

No hace falta cambiar el JSON de instalación: el directorio se deriva de su
`paths.dataRoot`, que ya es obligatorio y exclusivo por instalación. Después
del primer turno autorizado se crean las raíces necesarias; también puede
prepararse con el flujo normal de provisión de usuarios. Confirma que el
volumen `aibrain-data` sigue presente en ambos servicios de Compose.

Las políticas `PERMISSIONS.md` controlan los scopes de un turno:

- `documents.read` / `documents.write` habilitan lectura/escritura en los tres
  scopes;
- los equivalentes precisos `documents.company.read`,
  `documents.project.write`, etc. limitan ese permiso a un solo scope;
- un `deny` efectivo prevalece. La escritura solo se entrega a turnos `agent`;
  los modos de consulta y plan siguen en solo lectura.

El índice busca nombre y texto UTF-8 de archivos acotados y devuelve el scope,
hash y procedencia. Archivos binarios o mayores de 512 KB no se indexan; siguen
siendo accesibles dentro de su scope cuando la política lo permite.
