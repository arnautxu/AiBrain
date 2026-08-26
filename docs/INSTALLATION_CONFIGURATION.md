# Configuración de una instalación white-label

`InstallationConfig` v1 es la fuente de verdad no secreta para la identidad, el dominio, el branding y las rutas de una instalación AiBrain. Una empresa nueva utiliza la misma imagen y el mismo código: cambia este fichero, sus assets de marca, secretos, mounts y servidor.

No se guardan contraseñas, tokens, claves de Supabase ni credenciales del repositorio documental en este JSON. Esos valores permanecen en secret files o variables operativas de la instalación.

## Selección y carga

- Producción exige `AIBRAIN_INSTALLATION_CONFIG` con una ruta absoluta a un fichero regular. El arranque falla si falta, contiene JSON inválido, usa una versión desconocida, incluye campos extra o viola las restricciones de rutas y branding.
- Desarrollo sin la variable utiliza únicamente el fixture sintético `config/installations/development.example.json`.
- QA puede usar `config/installations/qa.example.json`. Ambos fixtures tienen empresas, marcas, dominios y raíces diferentes y no contienen datos reales.
- Los paths de contexto, usuarios y backups deben quedar dentro de `dataRoot`.
- `sourceReadRoot` y `publishWriteRoot` deben ser distintos y no pueden contenerse entre sí. La configuración no concede permisos: Compose debe montar el primero read-only en el worker y reservar el segundo al publicador server-side.

Ejemplo local:

```bash
AIBRAIN_INSTALLATION_CONFIG="$PWD/config/installations/qa.example.json" npm run dev
```

## Crear otra instalación

El generador rechaza flags desconocidos, URLs inseguras, rutas relativas, identificadores no canónicos y sobrescrituras. No crea mounts ni toca un servidor externo.

```bash
npm run installation:new -- \
  --installation-id acme-production \
  --company-name "Acme Consulting" \
  --company-slug acme-consulting \
  --public-url https://brain.acme.example \
  --product-name "Acme Brain" \
  --accent-color '#315ee7' \
  --data-root /var/lib/aibrain-acme \
  --source-read-root /mnt/aibrain-acme/source-ro \
  --publish-write-root /mnt/aibrain-acme/publish-rw \
  --output /etc/aibrain/installation.json
```

Si no se indican, `companyContextRoot`, `usersRoot` y `backupsRoot` se derivan dentro de `dataRoot`; `logoPath` y `faviconPath` se derivan bajo `/branding/<companySlug>/`. Los assets deben añadirse al directorio `public/branding/<companySlug>/` de la imagen o suministrarse mediante el mecanismo de assets estáticos elegido para esa instalación.

Antes de arrancar:

1. Revisar el JSON contra `schemas/installation-config.schema.json`.
2. Crear las raíces en el servidor con ownership y permisos específicos de AiBrain.
3. Montar el JSON en `/etc/aibrain/installation.json:ro` dentro de la web.
4. Montar `sourceReadRoot` en modo de solo lectura para workers.
5. No montar `publishWriteRoot` en workers, navegador o herramientas Codex.
6. Configurar secretos de Auth y runtime fuera del JSON.
7. Ejecutar `npm run typecheck`, `npm run test:unit` y `npm run build`.

La configuración no contiene un literal reservado para una empresa concreta. `installationId` y `companySlug` aceptan cualquier identificador canónico; la primera instalación real se crea con el mismo comando después de confirmar nombre, dominio, rutas y branding.
