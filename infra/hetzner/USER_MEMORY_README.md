# Memoria privada

Esta carpeta pertenece al usuario de su directorio padre. El mapa del servidor
y el contexto compartido de empresa se mantienen en sus propios ámbitos.

- [Perfil](../PROFILE.md): identidad y contexto del usuario.
- [Preferencias](../PREFERENCES.md): preferencias explícitas de trabajo.
- `events.jsonl`: historial duradero de recuerdos y decisiones explícitos.
- `index.json`: índice reconstruible de ese historial.
- `governed/state.json`: recuerdos y decisiones con ámbito, proyecto, fuente,
  revisión y estado. Las entradas eliminadas no son memoria activa.
- `proposals/state.json`: propuestas pendientes; una propuesta no es un hecho
  confirmado ni una instrucción del usuario.

Algunos archivos aparecen cuando existe el primer registro de ese tipo.
Consulta, corrige o elimina recuerdos desde las herramientas y ajustes de memoria
de AiBrain. Conserva siempre su ámbito, fuente, fecha y revisión. El contexto de
un proyecto se recupera para ese proyecto y la memoria privada no se publica
automáticamente como conocimiento de empresa.

Este documento describe la organización; no contiene copias de recuerdos, no
amplía permisos y no sustituye los registros que utiliza AiBrain. Los archivos
del servidor se localizan mediante el mapa y su contenido se lee cuando hace falta.
