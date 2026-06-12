const activationPanel = document.getElementById("activationPanel");
const chatPanel = document.getElementById("chatPanel");
const activationForm = document.getElementById("activationForm");
const activationMessage = document.getElementById("activationMessage");
const activateButton = document.getElementById("activateButton");
const serverUrl = document.getElementById("serverUrl");
const registrationCode = document.getElementById("registrationCode");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const userText = document.getElementById("userText");
const roleText = document.getElementById("roleText");
const deviceText = document.getElementById("deviceText");
const heartbeatText = document.getElementById("heartbeatText");
const heartbeatButton = document.getElementById("heartbeatButton");
const resetButton = document.getElementById("resetButton");
const chatForm = document.getElementById("chatForm");
const question = document.getElementById("question");
const askButton = document.getElementById("askButton");
const messages = document.getElementById("messages");
const actionsList = document.getElementById("actionsList");

let currentStatus = null;

init().catch((error) => {
  setActivationMessage(error.message || String(error), "bad");
});

async function init() {
  currentStatus = await window.starlabAgent.getStatus();
  renderStatus(currentStatus);
  window.starlabAgent.onStatus((status) => {
    currentStatus = status;
    renderStatus(status);
  });
  if (window.starlabAgent.recentActions) {
    renderActions(await window.starlabAgent.recentActions());
  }
  if (window.starlabAgent.onRecentActions) {
    window.starlabAgent.onRecentActions((actions) => renderActions(actions));
  }
}

function renderActions(actions) {
  if (!actionsList) {
    return;
  }
  const list = Array.isArray(actions) ? actions : [];
  if (!list.length) {
    actionsList.innerHTML = '<li id="actionsEmpty" style="color:#8a94a6;">Действий ещё не было</li>';
    return;
  }
  actionsList.innerHTML = list
    .map((action) => {
      const color = action.status === "succeeded" ? "#0e7c66" : action.status === "rejected" ? "#b06a00" : "#b42318";
      const time = formatDate(action.at);
      const detail = action.error ? ` — ${escapeText(action.error)}` : "";
      return `<li style="padding:4px 0;border-bottom:1px solid #eef2f7;"><span style="color:${color};font-weight:600;">${escapeText(
        action.status,
      )}</span> ${escapeText(action.type)}${detail}<div style="color:#8a94a6;">${escapeText(time)}</div></li>`;
    })
    .join("");
}

function escapeText(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

activationForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  activateButton.disabled = true;
  setActivationMessage("Проверяю код и привязываю устройство...", "");
  try {
    const status = await window.starlabAgent.activate({
      controlPlaneUrl: serverUrl.value,
      registrationCode: registrationCode.value.trim(),
    });
    currentStatus = status;
    renderStatus(status);
    setActivationMessage("Готово. Агент активирован.", "ok");
  } catch (error) {
    setActivationMessage(error.message || String(error), "bad");
  } finally {
    activateButton.disabled = false;
  }
});

heartbeatButton.addEventListener("click", async () => {
  heartbeatButton.disabled = true;
  try {
    const status = await window.starlabAgent.heartbeat();
    if (status) {
      currentStatus = status;
      renderStatus(status);
    }
  } catch (error) {
    renderStatus({ ...currentStatus, lastHeartbeatError: error.message || String(error) });
  } finally {
    heartbeatButton.disabled = false;
  }
});

resetButton.addEventListener("click", async () => {
  const ok = confirm("Сбросить активацию этого устройства?");
  if (!ok) {
    return;
  }
  currentStatus = await window.starlabAgent.reset();
  messages.innerHTML = "";
  renderStatus(currentStatus);
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = question.value.trim();
  if (!text) {
    return;
  }
  question.value = "";
  appendMessage(text, "user");
  askButton.disabled = true;
  const pending = appendMessage("Думаю...", "agent");
  try {
    const answer = await window.starlabAgent.ask(text);
    pending.textContent = answer || "Пустой ответ";
  } catch (error) {
    pending.className = "bubble error";
    pending.textContent = error.message || String(error);
  } finally {
    askButton.disabled = false;
  }
});

function renderStatus(status) {
  const activated = Boolean(status?.activated);
  activationPanel.classList.toggle("hidden", activated);
  chatPanel.classList.toggle("hidden", !activated);
  serverUrl.value = status?.controlPlaneUrl || "https://starlabagent.pp.ua";

  statusDot.className = "dot";
  if (!activated) {
    statusDot.classList.add("warn");
    statusText.textContent = "Не активирован";
  } else if (status.lastHeartbeatError) {
    statusDot.classList.add("bad");
    statusText.textContent = "Ошибка связи";
  } else {
    statusDot.classList.add("ok");
    statusText.textContent = "Активен";
  }

  userText.textContent = status?.user?.displayName || "-";
  roleText.textContent = status?.user?.role || "-";
  deviceText.textContent = status?.agent?.displayName || status?.agent?.deviceId || "-";
  heartbeatText.textContent = status?.lastHeartbeatError
    ? status.lastHeartbeatError
    : formatDate(status?.lastHeartbeatAt);
}

function setActivationMessage(text, kind) {
  activationMessage.textContent = text;
  activationMessage.className = `message ${kind || ""}`.trim();
}

function appendMessage(text, kind) {
  const item = document.createElement("div");
  item.className = `bubble ${kind}`;
  item.textContent = text;
  messages.appendChild(item);
  messages.scrollTop = messages.scrollHeight;
  return item;
}

function formatDate(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("ru-RU");
}
