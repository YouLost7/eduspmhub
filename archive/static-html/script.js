const resources = [];

const resourceList = document.getElementById("resourceList");
const subjectFilter = document.getElementById("subjectFilter");
const demoBtn = document.getElementById("demoBtn");
const demoMessage = document.getElementById("demoMessage");

function renderResources(filterValue) {
  const filtered =
    filterValue === "all"
      ? resources
      : resources.filter((item) => item.subject === filterValue);

  resourceList.innerHTML = "";

  if (filtered.length === 0) {
    const p = document.createElement("p");
    p.className = "resource-meta";
    p.textContent =
      "No sample resources here. Use the main EduSPM Hub app — educators publish the real catalogue under My teaching.";
    resourceList.appendChild(p);
    return;
  }

  filtered.forEach((item) => {
    const card = document.createElement("article");
    card.className = "resource-item";
    card.innerHTML = `
      <h3>${item.title}</h3>
      <p class="resource-meta">${item.type} • ${item.subject}</p>
      <p>${item.level}</p>
    `;
    resourceList.appendChild(card);
  });
}

subjectFilter.addEventListener("change", (event) => {
  renderResources(event.target.value);
});

demoBtn.addEventListener("click", () => {
  demoMessage.textContent =
    "Thanks! You are added to the Objective 1 early-access waitlist.";
});

renderResources("all");
