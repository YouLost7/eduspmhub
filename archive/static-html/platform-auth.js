function getRole() {
  return localStorage.getItem("eduspmhub_role") || "student";
}

function getVerification() {
  return localStorage.getItem("eduspmhub_verification") || "verified";
}

function setEducatorGate() {
  const addCourseBtn = document.getElementById("addCourseBtn");
  const educatorStatus = document.getElementById("educatorStatus");
  if (!addCourseBtn || !educatorStatus) return;

  const role = getRole();
  const verification = getVerification();

  if (role !== "educator") {
    addCourseBtn.disabled = true;
    addCourseBtn.textContent = "Add Course (Locked)";
    educatorStatus.textContent = "Teaching tools are for verified educators only.";
    educatorStatus.classList.add("locked");
    return;
  }

  if (verification !== "verified") {
    addCourseBtn.disabled = true;
    addCourseBtn.textContent = "Add Course (Locked)";
    educatorStatus.textContent =
      "Your educator account is pending verification. Teaching tools will unlock after approval.";
    educatorStatus.classList.add("locked");
    return;
  }

  addCourseBtn.disabled = false;
  addCourseBtn.textContent = "Add Course";
  educatorStatus.textContent = "Welcome, verified educator. You can add courses now (demo).";
  educatorStatus.classList.remove("locked");
}

setEducatorGate();
