const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const statusMessage = document.getElementById("statusMessage");

function setStatus(msg, color) {
  if (!statusMessage) return;
  statusMessage.textContent = msg;
  statusMessage.style.color = color;
}

function getEmailDomain(email) {
  const atIndex = email.indexOf("@");
  if (atIndex === -1) return "";
  return email.slice(atIndex + 1).toLowerCase();
}

function isLikelySchoolEmail(email) {
  const domain = getEmailDomain(email);
  if (!domain) return false;

  const freeProviders = [
    "gmail.com",
    "yahoo.com",
    "yahoo.co.uk",
    "hotmail.com",
    "outlook.com",
    "live.com",
    "aol.com",
    "icloud.com",
    "protonmail.com",
    "proton.me",
    "mail.com",
  ];
  if (freeProviders.includes(domain)) return false;

  return domain.includes("edu") || domain.includes("school");
}

function setRegisterRole(role) {
  const accountRoleInput = document.getElementById("accountRole");
  if (accountRoleInput) accountRoleInput.value = role;

  const tabButtons = document.querySelectorAll(".tab-btn[data-role]");
  tabButtons.forEach((btn) => {
    const isActive = btn.dataset.role === role;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
  });

  const panels = document.querySelectorAll(".tab-panel[data-role]");
  panels.forEach((panel) => {
    const isActive = panel.dataset.role === role;
    panel.classList.toggle("active", isActive);
  });

  const helpers = document.querySelectorAll(".email-helper[data-role]");
  helpers.forEach((p) => {
    p.style.display = p.dataset.role === role ? "block" : "none";
  });

  const studentSelect = document.getElementById("studentSubject");
  const educatorSelect = document.getElementById("educatorSubject");
  const schoolName = document.getElementById("schoolName");
  const educatorInstitution = document.getElementById("educatorInstitution");

  if (studentSelect) studentSelect.required = role === "student";
  if (educatorSelect) educatorSelect.required = role === "educator";
  if (schoolName) schoolName.required = role === "student";
  if (educatorInstitution) educatorInstitution.required = role === "educator";
}

function updatePasswordMeter(value) {
  const bar = document.getElementById("passwordMeterBar");
  const hint = document.getElementById("passwordHint");
  if (!bar) return;

  bar.className = "password-meter-bar";
  const len = value.length;
  const hasLetter = /[a-zA-Z]/.test(value);
  const hasNum = /\d/.test(value);

  if (!len) {
    if (hint) {
      hint.textContent =
        "At least 8 characters. Mix letters and numbers for a stronger password.";
    }
    return;
  }

  if (len < 8 || !hasLetter) {
    bar.classList.add("weak");
    if (hint) hint.textContent = "Weak — add more characters and letters.";
  } else if (len < 12 || !hasNum) {
    bar.classList.add("medium");
    if (hint) hint.textContent = "Medium — add numbers or more length.";
  } else {
    bar.classList.add("strong");
    if (hint) hint.textContent = "Strong password.";
  }
}

function wireRegisterExtras() {
  const pwd = document.getElementById("regPassword");
  const confirm = document.getElementById("regConfirmPassword");
  const t1 = document.getElementById("togglePassword");
  const t2 = document.getElementById("toggleConfirmPassword");

  if (pwd) {
    pwd.addEventListener("input", () => updatePasswordMeter(pwd.value));
  }

  if (t1 && pwd) {
    t1.addEventListener("click", () => {
      const next = pwd.type === "password" ? "text" : "password";
      pwd.type = next;
      t1.setAttribute("aria-label", next === "password" ? "Show password" : "Hide password");
    });
  }

  if (t2 && confirm) {
    t2.addEventListener("click", () => {
      const next = confirm.type === "password" ? "text" : "password";
      confirm.type = next;
      t2.setAttribute(
        "aria-label",
        next === "password" ? "Show confirm password" : "Hide confirm password"
      );
    });
  }
}

if (loginForm) {
  loginForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value.trim();

    if (!email || !password) {
      setStatus("Please fill in all login fields.", "#b91c1c");
      return;
    }

    setStatus("Login successful (demo). Redirecting...", "#15803d");
    setTimeout(() => {
      window.location.href = "./index.html";
    }, 900);
  });
}

if (registerForm) {
  const initialRole = document.getElementById("accountRole")?.value || "student";
  setRegisterRole(initialRole);
  wireRegisterExtras();
  updatePasswordMeter(document.getElementById("regPassword")?.value || "");

  const tabButtons = document.querySelectorAll(".tab-btn[data-role]");
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      setRegisterRole(btn.dataset.role);
    });
  });

  registerForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const role = document.getElementById("accountRole")?.value || "student";
    const fullName = document.getElementById("fullName").value.trim();
    const email = document.getElementById("regEmail").value.trim();
    const studentSubject = document.getElementById("studentSubject").value;
    const educatorSubject = document.getElementById("educatorSubject").value;
    const subject = role === "student" ? studentSubject : educatorSubject;
    const password = document.getElementById("regPassword").value.trim();
    const confirmPassword = document
      .getElementById("regConfirmPassword")
      .value.trim();
    const terms = document.getElementById("termsAccept")?.checked;

    const schoolName = document.getElementById("schoolName")?.value.trim() || "";
    const studentForm = document.getElementById("studentForm")?.value || "";
    const educatorInstitution =
      document.getElementById("educatorInstitution")?.value.trim() || "";
    const educatorBio = document.getElementById("educatorBio")?.value.trim() || "";

    if (!fullName || !email || !subject || !password || !confirmPassword) {
      setStatus("Please complete all registration fields.", "#b91c1c");
      return;
    }

    if (role === "student" && !schoolName) {
      setStatus("Please enter your school name.", "#b91c1c");
      return;
    }

    if (role === "educator" && !educatorInstitution) {
      setStatus("Please enter your school or institution.", "#b91c1c");
      return;
    }

    if (!terms) {
      setStatus("Please accept the Terms and Privacy Policy.", "#b91c1c");
      return;
    }

    if (password !== confirmPassword) {
      setStatus("Passwords do not match.", "#b91c1c");
      return;
    }

    if (password.length < 8) {
      setStatus("Password must be at least 8 characters.", "#b91c1c");
      return;
    }

    if (role === "student") {
      if (!isLikelySchoolEmail(email)) {
        setStatus(
          "Students must use a school email (not Gmail, Yahoo, Hotmail, etc.).",
          "#b91c1c"
        );
        return;
      }
    }

    const profile = {
      fullName,
      email,
      role,
      subject,
      schoolName: role === "student" ? schoolName : "",
      studentForm: role === "student" ? studentForm : "",
      educatorInstitution: role === "educator" ? educatorInstitution : "",
      educatorBio: role === "educator" ? educatorBio : "",
      registeredAt: new Date().toISOString(),
    };

    localStorage.setItem("eduspmhub_role", role);
    localStorage.setItem(
      "eduspmhub_verification",
      role === "educator" ? "pending" : "verified"
    );
    localStorage.setItem("eduspmhub_profile", JSON.stringify(profile));

    if (role === "educator") {
      setStatus(
        "Account created (demo). Verification pending — teaching tools stay locked until approved.",
        "#15803d"
      );
    } else {
      setStatus("Registration successful (demo). Redirecting to login...", "#15803d");
    }

    setTimeout(() => {
      window.location.href = "./login.html";
    }, 1100);
  });
}
