export default function CourseProgressBar({
  percent = 0,
  completedCount = 0,
  totalLessons = 0,
  compact = false,
  label,
}) {
  const pct = Math.min(100, Math.max(0, Number(percent) || 0));
  const done = Number(completedCount) || 0;
  const total = Number(totalLessons) || 0;
  const ariaLabel =
    label ||
    (total > 0 ? `${done} of ${total} lessons completed (${pct}%)` : "No lessons yet");

  return (
    <div className={`course-progress${compact ? " course-progress--compact" : ""}`}>
      <div className="course-progress-meta">
        <span>
          {total > 0 ? `${done} of ${total} lessons` : "No lessons yet"}
        </span>
        {total > 0 ? <span>{pct}%</span> : null}
      </div>
      <div
        className="course-progress-track"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={ariaLabel}
      >
        <div className="course-progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
