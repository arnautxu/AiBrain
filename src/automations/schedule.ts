import type { AutomationSchedule } from "@/automations/contracts";

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string) {
  let value = formatterCache.get(timeZone);
  if (!value) {
    value = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    formatterCache.set(timeZone, value);
  }
  return value;
}

export function localParts(instant: Date, timeZone: string): LocalParts {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(instant).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function compareLocal(left: LocalParts, right: LocalParts) {
  return Date.UTC(left.year, left.month - 1, left.day, left.hour, left.minute) -
    Date.UTC(right.year, right.month - 1, right.day, right.hour, right.minute);
}

function sameLocal(left: LocalParts, right: LocalParts) {
  return compareLocal(left, right) === 0;
}

function offsetAt(instant: Date, timeZone: string) {
  const parts = localParts(instant, timeZone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) -
    Math.floor(instant.getTime() / 60_000) * 60_000;
}

/**
 * Resolves a wall-clock minute in an IANA zone. During an overlap the earliest
 * occurrence wins. During a spring-forward gap, the first valid minute later
 * on the same local date wins (for example 02:30 becomes 03:00 in Madrid).
 */
export function localMinuteToInstant(parts: LocalParts, timeZone: string) {
  const naive = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 6) {
    offsets.add(offsetAt(new Date(naive + hours * 3_600_000), timeZone));
  }
  const exact = [...offsets]
    .map((offset) => new Date(naive - offset))
    .filter((candidate) => sameLocal(localParts(candidate, timeZone), parts))
    .sort((left, right) => left.getTime() - right.getTime());
  if (exact[0]) return exact[0];

  const start = naive - 6 * 3_600_000;
  const end = naive + 6 * 3_600_000;
  for (let instant = start; instant <= end; instant += 60_000) {
    const candidate = new Date(instant);
    const local = localParts(candidate, timeZone);
    if (local.year === parts.year && local.month === parts.month && local.day === parts.day &&
      compareLocal(local, parts) >= 0) return candidate;
  }
  throw new Error("No se ha podido resolver la hora local del horario.");
}

function addLocalDays(parts: LocalParts, days: number): LocalParts {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: parts.hour,
    minute: parts.minute,
  };
}

function weekday(parts: LocalParts) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

export function nextScheduledInstant(
  schedule: AutomationSchedule,
  timeZone: string,
  after: Date,
): string | null {
  if (schedule.kind === "once") {
    return new Date(schedule.runAt).getTime() > after.getTime() ? schedule.runAt : null;
  }

  const afterLocal = localParts(after, timeZone);
  for (let add = 0; add <= 8; add += 1) {
    const target = addLocalDays({ ...afterLocal, hour: schedule.hour, minute: schedule.minute }, add);
    if (schedule.kind === "weekly" && !schedule.weekdays.includes(weekday(target))) continue;
    const instant = localMinuteToInstant(target, timeZone);
    if (instant.getTime() > after.getTime()) return instant.toISOString();
  }
  throw new Error("No se ha podido calcular la siguiente ejecución.");
}

export function nextAfterOccurrence(
  schedule: AutomationSchedule,
  timeZone: string,
  scheduledFor: string,
) {
  if (schedule.kind === "once") return null;
  return nextScheduledInstant(schedule, timeZone, new Date(scheduledFor));
}

export function describeSchedule(schedule: AutomationSchedule, timeZone: string) {
  if (schedule.kind === "once") {
    return `Una vez · ${new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(schedule.runAt))}`;
  }
  const time = `${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`;
  if (schedule.kind === "daily") return `Cada día · ${time}`;
  const labels = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  return `${schedule.weekdays.map((day) => labels[day]).join(", ")} · ${time}`;
}
