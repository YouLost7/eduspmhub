import { sendMail } from "../mail.js";
import { getBookingById } from "./store.js";
import { getDb, sqlite } from "../sqlite.js";

const REMINDER_MS = 24 * 60 * 60 * 1000;
const POLL_MS = 15 * 60 * 1000;

function formatWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

async function loadUserEmail(userId, loadUsers, findUserById) {
  const users = await loadUsers();
  const u = findUserById(users, userId);
  return u?.email || "";
}

async function markReminderSent(bookingId, column) {
  const db = await getDb();
  const now = new Date().toISOString();
  await sqlite.run(
    db,
    `UPDATE tutoring_bookings SET ${column} = ?, updated_at = ? WHERE id = ?`,
    [now, now, String(bookingId)]
  );
}

export async function notifyTutoringEvent({
  type,
  bookingId,
  loadUsers,
  findUserById,
  APP_BASE_URL,
}) {
  const booking = await getBookingById(bookingId);
  if (!booking) return;

  const users = await loadUsers();
  const student = findUserById(users, booking.studentId);
  const tutor = findUserById(users, booking.tutorId);
  if (!student || !tutor) return;

  const when = formatWhen(booking.scheduledStart);
  const amount = `RM${(booking.amountCents / 100).toFixed(2)}`;

  if (type === "paid" && !booking.tutorNotifiedPaidAt) {
    await sendMail({
      to: tutor.email,
      subject: `[EduSPM] New 1-on-1 booking request — ${student.fullName}`,
      text: [
        `Hi ${tutor.fullName},`,
        ``,
        `${student.fullName} paid for a 1-on-1 session.`,
        `When: ${when} (${booking.hours}h)`,
        `Amount: ${amount}`,
        booking.studentMessage ? `Message: ${booking.studentMessage}` : "",
        ``,
        `Accept or decline in the app: ${APP_BASE_URL}/bookings`,
      ]
        .filter(Boolean)
        .join("\n"),
    });
    await markReminderSent(booking.id, "tutor_notified_paid_at");
  }

  if (type === "accepted" && !booking.studentNotifiedAcceptedAt) {
    await sendMail({
      to: student.email,
      subject: `[EduSPM] Tutor accepted your session — ${tutor.fullName}`,
      text: [
        `Hi ${student.fullName},`,
        ``,
        `${tutor.fullName} accepted your 1-on-1 session.`,
        `When: ${when}`,
        ``,
        `View details: ${APP_BASE_URL}/bookings`,
      ].join("\n"),
    });
    await markReminderSent(booking.id, "student_notified_accepted_at");
  }

  if (type === "completed" && !booking.studentNotifiedCompleteAt) {
    await sendMail({
      to: student.email,
      subject: `[EduSPM] Session complete — leave feedback for ${tutor.fullName}`,
      text: [
        `Hi ${student.fullName},`,
        ``,
        `Your session with ${tutor.fullName} was marked complete.`,
        `Please leave a rating: ${APP_BASE_URL}/bookings`,
      ].join("\n"),
    });
    await markReminderSent(booking.id, "student_notified_complete_at");
  }

  if (type === "declined_refunded" && !booking.studentNotifiedDeclinedAt) {
    await sendMail({
      to: student.email,
      subject: `[EduSPM] Session declined — refund processing`,
      text: [
        `Hi ${student.fullName},`,
        ``,
        `${tutor.fullName} declined your 1-on-1 session scheduled for ${when}.`,
        `If you paid by card, a refund has been initiated to your original payment method.`,
        ``,
        `Browse other tutors: ${APP_BASE_URL}/tutoring`,
      ].join("\n"),
    });
    await markReminderSent(booking.id, "student_notified_declined_at");
  }
}

export function startTutoringReminderPoller({ loadUsers, findUserById, APP_BASE_URL }) {
  const tick = async () => {
    try {
      const db = await getDb();
      const now = Date.now();
      const windowStart = new Date(now + REMINDER_MS - POLL_MS).toISOString();
      const windowEnd = new Date(now + REMINDER_MS + POLL_MS).toISOString();
      const rows = await sqlite.all(
        db,
        `SELECT id FROM tutoring_bookings
         WHERE status = 'accepted'
           AND reminder_24h_sent_at IS NULL
           AND scheduled_start >= ?
           AND scheduled_start <= ?`,
        [windowStart, windowEnd]
      );
      for (const row of rows) {
        const booking = await getBookingById(row.id);
        if (!booking) continue;
        const studentEmail = await loadUserEmail(
          booking.studentId,
          loadUsers,
          findUserById
        );
        const users = await loadUsers();
        const tutor = findUserById(users, booking.tutorId);
        await sendMail({
          to: studentEmail,
          subject: `[EduSPM] Reminder: 1-on-1 session in ~24 hours`,
          text: [
            `Your session with ${tutor?.fullName || "your tutor"} is coming up.`,
            `When: ${formatWhen(booking.scheduledStart)}`,
            ``,
            `Details: ${APP_BASE_URL}/bookings`,
          ].join("\n"),
        });
        await markReminderSent(booking.id, "reminder_24h_sent_at");
      }
    } catch (e) {
      console.error("[tutoring reminders]", e);
    }
  };

  tick();
  const timer = setInterval(tick, POLL_MS);
  timer.unref?.();
}
