import { MODEL_CAPACITY_MESSAGE } from "./model-capacity-retry";

const support = "Avisa al equipo que gestiona vuestro Brain e indica qué intentabas hacer, la tienda o proyecto y cuándo ha ocurrido. No envíes contraseñas.";
const uncertain = "Si la petición incluía guardar o enviar algo, debemos comprobar su estado antes de repetirla.";

/** Last-resort copy when the assistant cannot produce its own explanation.
 * Never copy arbitrary provider errors or pretend to know an internal cause.
 */
export function productSafeRuntimeMessage(message: string): string {
  if (message === "Selected model is at capacity. Please try a different model." || message === MODEL_CAPACITY_MESSAGE) {
    return `${MODEL_CAPACITY_MESSAGE} Si el problema continúa, avisa al equipo que gestiona vuestro Brain.`;
  }
  if (/timeout|timed out|tiempo de espera|temps d.espera/iu.test(message)) {
    return `El Brain no ha recibido la respuesta del servicio dentro del tiempo de espera. ${support} ${uncertain}`;
  }
  if (/permission denied|access denied|permiso denegado|no tienes permiso|acceso denegado/iu.test(message)) {
    return `El sistema ha bloqueado esta operación por un problema de permisos. No puedes resolverlo desde esta conversación. ${support} ${uncertain}`;
  }
  return `El Brain no ha podido completar esta petición y no tenemos una causa confirmada. ${support} ${uncertain}`;
}
