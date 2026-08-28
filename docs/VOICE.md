# Voz en AiBrain

AiBrain ofrece voz como ayuda de entrada y accesibilidad del navegador. No introduce una ruta de audio propia ni presenta como disponible una transcripción que el backend no soporte.

## Dictado

- El botón **Dictar mensaje** aparece en el composer en escritorio y móvil.
- La primera activación muestra una explicación y requiere consentimiento explícito antes de pedir acceso al micrófono.
- El reconocimiento usa `SpeechRecognition`/`webkitSpeechRecognition` del navegador. El audio lo procesa el servicio de voz del propio navegador; AiBrain recibe únicamente el texto que se inserta en el composer.
- El usuario ve los estados escuchando, procesando y error. Puede terminar y conservar el texto, o cancelar y volver exactamente al texto anterior.
- El texto siempre queda editable y nunca se envía automáticamente.
- Si la API no existe, la interfaz indica que se debe escribir o pegar texto. La instalación actual no expone una API de transcripción de archivos de audio, por lo que no se simula esa capacidad.

El consentimiento se recuerda solo en el navegador con `aibrain.voice.dictation-consent.v1`. Los permisos reales del micrófono siguen bajo control del navegador y del sistema operativo.

## Lectura en voz alta

Las respuestas completas incluyen la acción **Leer en voz alta** cuando `speechSynthesis` está disponible. El usuario decide cuándo reproducir y puede detener la lectura en cualquier momento. Puede elegir 0,75×, 1×, 1,25× o 1,5×; la velocidad se guarda solo en el dispositivo con `aibrain.voice.read-rate.v1`.

La lectura usa `SpeechSynthesisUtterance` del navegador y no envía el contenido a una ruta nueva de AiBrain. La disponibilidad y las voces dependen del navegador y del sistema operativo.

## Accesibilidad y privacidad

- Todos los controles tienen nombre accesible y los estados se anuncian con `status`/`alert`.
- Los objetivos táctiles son de 44 px en móvil.
- Las animaciones respetan `prefers-reduced-motion` mediante las utilidades existentes.
- La interfaz explica dónde se procesa la voz antes de activar el micrófono y en el menú de lectura.
