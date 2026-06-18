import { useCallback, useEffect, useMemo, useState } from "react";
import { apiJson } from "../api.js";
import { useI18n } from "../i18n/I18nContext.jsx";

function groupByDay(slots) {
  const map = new Map();
  for (const s of slots) {
    const key = s.dateKey || s.dayLabel;
    if (!map.has(key)) {
      map.set(key, { dayLabel: s.dayLabel, dateKey: key, items: [] });
    }
    map.get(key).items.push(s);
  }
  return [...map.values()];
}

export default function TutoringSlotPicker({
  tutorId,
  hours,
  hourlyRateLabel,
  selectedStart,
  onSelect,
}) {
  const { t } = useI18n();
  const [slots, setSlots] = useState([]);
  const [estimate, setEstimate] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const hoursLabel = useMemo(
    () =>
      hours === 1
        ? t("slotPicker.hourSingular", { count: hours })
        : t("slotPicker.hoursPlural", { count: hours }),
    [hours, t]
  );

  const load = useCallback(async () => {
    if (!tutorId || !hours) return;
    setLoading(true);
    setErr("");
    try {
      const data = await apiJson(
        `/api/tutoring/tutors/${encodeURIComponent(tutorId)}/slots?hours=${encodeURIComponent(hours)}&days=21`
      );
      const list = Array.isArray(data.slots) ? data.slots : [];
      setSlots(list);
      setEstimate(data.estimatedTotalLabel || "");
    } catch (e) {
      setSlots([]);
      setErr(e.message || t("slotPicker.loadError"));
    } finally {
      setLoading(false);
    }
  }, [tutorId, hours, t]);

  useEffect(() => {
    load();
  }, [load]);

  const grouped = useMemo(() => groupByDay(slots), [slots]);

  return (
    <div className="slot-picker">
      <div className="slot-picker-head">
        <span className="slot-picker-title">{t("slotPicker.chooseTime")}</span>
        {hourlyRateLabel ? (
          <span className="field-hint">
            {hourlyRateLabel}
            {estimate ? ` · ${hours}h ≈ ${estimate}` : ""}
          </span>
        ) : null}
      </div>

      {loading && <p className="field-hint">{t("slotPicker.loadingSlots")}</p>}
      {err && (
        <p className="form-error" role="alert">
          {err}
        </p>
      )}

      {!loading && !err && slots.length === 0 && (
        <p className="field-hint">{t("slotPicker.noSlots", { hours: hoursLabel })}</p>
      )}

      {!loading && grouped.length > 0 && (
        <div className="slot-picker-days">
          {grouped.map((day) => (
            <div key={day.dateKey} className="slot-picker-day">
              <p className="slot-picker-day-label">{day.dayLabel}</p>
              <div className="slot-picker-grid" role="listbox" aria-label={day.dayLabel}>
                {day.items.map((slot) => {
                  const selected = selectedStart === slot.scheduledStart;
                  return (
                    <button
                      key={slot.scheduledStart}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`slot-chip${selected ? " slot-chip--selected" : ""}`}
                      onClick={() => onSelect(slot.scheduledStart)}
                    >
                      {new Date(slot.scheduledStart).toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedStart ? (
        <p className="field-hint slot-picker-selected">
          {t("slotPicker.selected")}{" "}
          <strong>
            {new Date(selectedStart).toLocaleString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </strong>
        </p>
      ) : (
        <p className="field-hint">{t("slotPicker.tapToContinue")}</p>
      )}
    </div>
  );
}
