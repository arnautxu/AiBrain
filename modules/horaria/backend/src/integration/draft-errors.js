// Public messages are selected from a closed list, never copied from an
// exception (which may contain SQL, business records or provider credentials).
const messages = {
  DRAFT_INCOMPLETE: 'El cálculo devolvió una semana incompleta. No se ha generado el Excel ni guardado turnos. Avisa al equipo Brain para revisar el cálculo.',
  DRAFT_INVALID_SHIFT: 'El cálculo devolvió un turno no válido. No se ha generado el Excel ni guardado turnos. Avisa al equipo Brain.',
  DRAFT_INVALID_OUTPUT: 'No se ha podido interpretar la propuesta devuelta por el cálculo. No se han guardado turnos. Avisa al equipo Brain.',
  DRAFT_CALCULATION_UNAVAILABLE: 'El servicio de cálculo no ha completado la propuesta. No se han guardado turnos. Avisa al equipo Brain para revisar la conexión y el cálculo.',
  DRAFT_INTERNAL: 'Un error interno ha impedido completar el horario. No se han guardado turnos. Avisa al equipo Brain e indica la tienda y la semana.',
};
export function draftFailure(error) {
  const message = error instanceof Error ? error.message : '';
  let code = 'DRAFT_INTERNAL';
  if (message === 'La proposta no conté una setmana completa per persona.') code = 'DRAFT_INCOMPLETE';
  else if (message === 'Torn de la proposta invàlid.') code = 'DRAFT_INVALID_SHIFT';
  else if (message.startsWith('Error al parsear la respuesta de la IA:') || message === 'La IA no devolvió un horario válido.') code = 'DRAFT_INVALID_OUTPUT';
  else if (message.startsWith('Codex d’AiBrain no ha completat el càlcul') || message === 'Codex returned invalid JSON.') code = 'DRAFT_CALCULATION_UNAVAILABLE';
  return { code, error: messages[code], draftOnly: true, businessDataSaved: false };
}
