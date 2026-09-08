"use strict";

function uniqueStrings(values, max = 32) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => String(value || "").trim()).filter(Boolean))].slice(0, max);
}

function validDateKey(value) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [year, month, day] = text.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function validTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));
}

function defaultSchoolScheduleProfile({ anchorDate = "" } = {}) {
  return {
    id: "school-default",
    name: "School Schedule",
    anchorDate: validDateKey(anchorDate) ? anchorDate : "",
    cycleDays: ["A", "B"],
    dayGroups: [
      { id: "day-a", label: "Day A", cycleDays: ["A"], color: "#2aa866" },
      { id: "day-b", label: "Day B", cycleDays: ["B"], color: "#4c78c2" }
    ],
    periodCycleDays: {},
    exceptionRules: {},
    continuation: { maximumGapMinutes: 15, legacyBisonCompatibility: false },
    updatedAt: null
  };
}

function legacySchoolScheduleProfile(calendar = {}) {
  return {
    id: "imported-legacy-schedule",
    name: "Imported School Schedule",
    anchorDate: validDateKey(calendar.anchorDate) ? calendar.anchorDate : "2026-08-19",
    cycleDays: ["A", "B", "C", "D", "E", "F", "G", "H"],
    dayGroups: [
      { id: "group-a", label: String(calendar.anchorDayColor || "Group A"), cycleDays: ["A", "C", "E", "G"], color: "#2aa866" },
      { id: "group-b", label: String(calendar.secondaryDayColor || "Group B"), cycleDays: ["B", "D", "F", "H"], color: "#eef4f8" }
    ],
    periodCycleDays: {
      "1": ["A", "C", "E", "G"], "2": ["A", "C", "E", "G"],
      "3": ["A", "C", "E", "G"], "4": ["A", "C", "E", "G"],
      "5": ["B", "D", "F", "H"], "6": ["B", "D", "F", "H"], "7": ["B", "D", "F", "H"],
      "BISON-1": ["B"], "BISON-2": ["B"], "BISON-3": ["D"], "BISON-4": ["D"],
      "BISON-5": ["F"], "BISON-6": ["F"], "BISON-7": ["H"], "BISON-8": ["H"]
    },
    exceptionRules: {
      "half-day": { periodTimes: {
        "1": { startTime: "07:50", endTime: "08:50" }, "5": { startTime: "07:50", endTime: "08:50" },
        "2": { startTime: "08:58", endTime: "09:48" }, "6": { startTime: "08:58", endTime: "09:48" },
        "3": { startTime: "09:56", endTime: "10:46" }, "7": { startTime: "09:56", endTime: "10:46" },
        "4": { startTime: "10:54", endTime: "11:45" }, "8": { startTime: "10:54", endTime: "11:45" }
      }, excludeContinuationPeriods: true },
      "1-hour-delay": { transform: { normalStart: "07:50", normalEnd: "14:45", delayedStart: "08:50" } },
      "2-hour-delay": { transform: { normalStart: "07:50", normalEnd: "14:45", delayedStart: "09:50" } }
    },
    continuation: { maximumGapMinutes: 15, legacyBisonCompatibility: true },
    updatedAt: null
  };
}

function normalizeSchoolScheduleProfile(input = {}, fallback = defaultSchoolScheduleProfile()) {
  const base = fallback && typeof fallback === "object" ? fallback : defaultSchoolScheduleProfile();
  const cycleDays = uniqueStrings(input.cycleDays ?? base.cycleDays, 20).map(value => value.slice(0, 20));
  if (!cycleDays.length) throw new Error("At least one school cycle day is required");
  const allowed = new Set(cycleDays);
  const rawGroups = Array.isArray(input.dayGroups) ? input.dayGroups : base.dayGroups;
  const dayGroups = rawGroups.slice(0, 12).map((group, index) => ({
    id: String(group?.id || `group-${index + 1}`).trim().replace(/[^a-z0-9._-]+/gi, "-").slice(0, 40),
    label: String(group?.label || `Group ${index + 1}`).trim().slice(0, 40),
    cycleDays: uniqueStrings(group?.cycleDays, 20).filter(day => allowed.has(day)),
    color: /^#[0-9a-f]{6}$/i.test(String(group?.color || "")) ? String(group.color) : "#2aa866"
  })).filter(group => group.id && group.label && group.cycleDays.length);
  const periodCycleDays = {};
  for (const [period, days] of Object.entries(input.periodCycleDays ?? base.periodCycleDays ?? {})) {
    const key = String(period || "").trim().slice(0, 40);
    if (key) periodCycleDays[key] = uniqueStrings(days, 20).filter(day => allowed.has(day));
  }
  const exceptionRules = {};
  for (const [kind, rule] of Object.entries(input.exceptionRules ?? base.exceptionRules ?? {})) {
    if (!rule || typeof rule !== "object") continue;
    const periodTimes = {};
    for (const [period, times] of Object.entries(rule.periodTimes || {})) {
      if (validTime(times?.startTime) && validTime(times?.endTime) && timeToMinutes(times.startTime) < timeToMinutes(times.endTime)) periodTimes[String(period).slice(0, 40)] = { startTime: times.startTime, endTime: times.endTime };
    }
    let transform = null;
    if (validTime(rule.transform?.normalStart) && validTime(rule.transform?.normalEnd) && validTime(rule.transform?.delayedStart)) {
      transform = { normalStart: rule.transform.normalStart, normalEnd: rule.transform.normalEnd, delayedStart: rule.transform.delayedStart };
    }
    exceptionRules[String(kind).slice(0, 40)] = { periodTimes, transform, excludeContinuationPeriods: rule.excludeContinuationPeriods === true };
  }
  return {
    id: String(input.id || base.id || "school-default").trim().slice(0, 80),
    name: String(input.name || base.name || "School Schedule").trim().slice(0, 120),
    anchorDate: validDateKey(input.anchorDate) ? String(input.anchorDate) : (validDateKey(base.anchorDate) ? String(base.anchorDate) : ""),
    cycleDays,
    dayGroups,
    periodCycleDays,
    exceptionRules,
    continuation: {
      maximumGapMinutes: Math.max(0, Math.min(120, Number(input.continuation?.maximumGapMinutes ?? base.continuation?.maximumGapMinutes ?? 15))),
      legacyBisonCompatibility: input.continuation?.legacyBisonCompatibility ?? base.continuation?.legacyBisonCompatibility ?? false
    },
    updatedAt: input.updatedAt || base.updatedAt || null
  };
}

function timeToMinutes(value) {
  if (!validTime(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(value) {
  const minutes = Math.max(0, Math.min(1439, Math.round(value)));
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function effectiveTimesForRule(profile, classroom, ruleType) {
  const startTime = classroom?.startTime;
  const endTime = classroom?.endTime;
  const rule = profile?.exceptionRules?.[ruleType];
  if (!rule) return { startTime, endTime };
  if (rule.excludeContinuationPeriods && (classroom?.continuationOf || (profile.continuation?.legacyBisonCompatibility && /^(?:BISON-|B[12]\b)/i.test(String(classroom?.period || classroom?.name || ""))))) return null;
  const explicit = rule.periodTimes?.[String(classroom?.period || "")];
  if (explicit) return { ...explicit };
  const transform = rule.transform;
  const baseStart = timeToMinutes(startTime), baseEnd = timeToMinutes(endTime);
  const normalStart = timeToMinutes(transform?.normalStart), normalEnd = timeToMinutes(transform?.normalEnd), delayedStart = timeToMinutes(transform?.delayedStart);
  if ([baseStart, baseEnd, normalStart, normalEnd, delayedStart].every(Number.isFinite) && normalEnd > normalStart) {
    const scale = (normalEnd - delayedStart) / (normalEnd - normalStart);
    return { startTime: minutesToTime(delayedStart + (baseStart - normalStart) * scale), endTime: minutesToTime(delayedStart + (baseEnd - normalStart) * scale) };
  }
  return { startTime, endTime };
}

function groupForCycleDay(profile, cycleDay) {
  return (profile?.dayGroups || []).find(group => group.cycleDays.includes(cycleDay)) || null;
}

module.exports = {
  defaultSchoolScheduleProfile,
  legacySchoolScheduleProfile,
  normalizeSchoolScheduleProfile,
  effectiveTimesForRule,
  groupForCycleDay,
  validDateKey,
  validTime
};
