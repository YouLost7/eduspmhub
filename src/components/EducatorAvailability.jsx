import { useCallback, useEffect, useState } from "react";
import { apiJson } from "../api.js";

const DAYS = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 0, label: "Sunday" },
];

function emptySlot() {
  return { dayOfWeek: 1, startTime: "09:00", endTime: "17:00" };
}

export default function EducatorAvailability({ verified }) {
  const [slots, setSlots] = useState([emptySlot()]);
  const [status, setStatus] = useState({ text: "", ok: true });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiJson("/api/tutoring/availability");
      const list = Array.isArray(data.slots) ? data.slots : [];
      setSlots(
        list.length
          ? list.map((s) => ({
              dayOfWeek: s.dayOfWeek,
              startTime: s.startTime,
              endTime: s.endTime,
            }))
          : [emptySlot()]
      );
    } catch (e) {
      setStatus({ text: e.message || "Could not load availability", ok: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function updateSlot(index, field, value) {
    setSlots((prev) =>
      prev.map((s, i) => (i === index ? { ...s, [field]: value } : s))
    );
  }

  function addSlot() {
    setSlots((prev) => [...prev, emptySlot()]);
  }

  function removeSlot(index) {
    setSlots((prev) => prev.filter((_, i) => i !== index));
  }

  async function save(e) {
    e.preventDefault();
    if (!verified) {
      setStatus({ text: "Verify your account before publishing availability.", ok: false });
      return;
    }
    setSaving(true);
    setStatus({ text: "", ok: true });
    try {
      const data = await apiJson("/api/tutoring/availability", {
        method: "PUT",
        body: { slots },
      });
      const list = Array.isArray(data.slots) ? data.slots : [];
      setSlots(
        list.length
          ? list.map((s) => ({
              dayOfWeek: s.dayOfWeek,
              startTime: s.startTime,
              endTime: s.endTime,
            }))
          : [emptySlot()]
      );
      setStatus({ text: "Weekly availability saved.", ok: true });
    } catch (e2) {
      setStatus({ text: e2.message || "Save failed", ok: false });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="profile-form section-block">
      <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Weekly availability (1-on-1)</h2>
      <p className="field-hint">
        Students can only book inside these windows. Use 24-hour times (e.g. 09:00–17:00).
        Sessions must fit entirely within one window on the same day.
      </p>
      {loading ? (
        <p className="field-hint">Loading…</p>
      ) : (
        <form onSubmit={save} className="availability-form">
          {slots.map((slot, index) => (
            <div key={index} className="availability-row">
              <select
                value={slot.dayOfWeek}
                onChange={(e) =>
                  updateSlot(index, "dayOfWeek", Number.parseInt(e.target.value, 10))
                }
                disabled={!verified || saving}
              >
                {DAYS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
              <input
                type="time"
                value={slot.startTime}
                onChange={(e) => updateSlot(index, "startTime", e.target.value)}
                disabled={!verified || saving}
                required
              />
              <span>to</span>
              <input
                type="time"
                value={slot.endTime}
                onChange={(e) => updateSlot(index, "endTime", e.target.value)}
                disabled={!verified || saving}
                required
              />
              {slots.length > 1 ? (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => removeSlot(index)}
                  disabled={saving}
                >
                  Remove
                </button>
              ) : null}
            </div>
          ))}
          <div className="availability-actions">
            <button
              type="button"
              className="outline-btn"
              onClick={addSlot}
              disabled={!verified || saving}
            >
              Add window
            </button>
            <button type="submit" className="solid-btn" disabled={!verified || saving}>
              {saving ? "Saving…" : "Save availability"}
            </button>
          </div>
          {status.text ? (
            <p className={status.ok ? "form-success" : "form-error"}>{status.text}</p>
          ) : null}
        </form>
      )}
    </section>
  );
}
