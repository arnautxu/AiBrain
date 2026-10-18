/** Only deliberately public business errors may enter model/tool output. */
export class HorariaToolError extends Error {
  constructor(message: string, readonly code = "HORARIA_REQUEST_REJECTED") { super(message); }
}

/** Concrete recovery ownership; this never grants permissions or retries writes. */
export function horariaRecoveryGuidance(code: string) {
  if (["HORARIA_CONFIRMATION_REQUIRED", "HORARIA_PROPOSAL_NOT_FOUND", "HORARIA_PROPOSAL_EXPIRED"].includes(code)) {
    return { resolutionOwner: "user", nextStep: "Revisa la propuesta de cambios de este chat y confírmala de forma clara. Si ha caducado o no aparece, pide que se prepare de nuevo antes de confirmar. Si vuelve a fallar, avisa al equipo que gestiona vuestro Brain." };
  }
  if (["HORARIA_HTTP_400", "HORARIA_HTTP_422", "HORARIA_INVALID_REQUEST"].includes(code)) {
    return { resolutionOwner: "user", nextStep: "Corrige el dato concreto indicado en el aviso y vuelve a pedir la operación; cualquier cambio de datos guardados necesita una nueva propuesta revisada. Si el aviso no identifica qué dato falta o vuelve a fallar, avisa al equipo que gestiona vuestro Brain." };
  }
  return { resolutionOwner: "brain_team", nextStep: "Avisa al equipo que gestiona vuestro Brain para que revise el servicio, la conexión o los permisos. Indica qué intentabas hacer, la tienda o proyecto y cuándo ha ocurrido. No envíes contraseñas. Si se había empezado un cambio, debemos comprobar su estado antes de repetirlo." };
}
