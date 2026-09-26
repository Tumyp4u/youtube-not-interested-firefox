(() => {
  "use strict";

  const selected = new Map();
  const controls = new Map();
  let busy = false;
  let cancelled = false;
  let message = "";

  const panel = document.createElement("div");
  panel.id = "ytni-panel";
  panel.hidden = true;

  const status = document.createElement("span");
  status.setAttribute("role", "status");

  const submit = document.createElement("button");
  submit.className = "ytni-submit";
  submit.textContent = "Не интересует";

  const clear = document.createElement("button");
  clear.textContent = "Снять выбор";

  panel.append(status, submit, clear);
  document.body.append(panel);

  const home = () => location.pathname === "/";
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = element =>
    Boolean(element && element.getClientRects().length) &&
    getComputedStyle(element).visibility !== "hidden";

  function videoId(card) {
    const link = card.querySelector('a[href*="/watch?v="]');
    if (!link) return null;
    return new URL(link.href, location.origin).searchParams.get("v");
  }

  function refreshPanel() {
    panel.hidden = !home() || (!busy && selected.size === 0);
    const text = busy
      ? message
      : `Выбрано: ${selected.size}${message ? ` · ${message}` : ""}`;

    if (status.textContent !== text) status.textContent = text;
    submit.disabled = busy || selected.size === 0;
    clear.textContent = busy ? "Остановить" : "Снять выбор";
  }

  function scan() {
    if (!home()) {
      cancelled = true;
      selected.clear();

      for (const control of controls.values()) {
        control.label.remove();
        control.host.classList.remove("ytni-thumbnail");
      }
      controls.clear();
      refreshPanel();
      return;
    }

    for (const [card, control] of controls) {
      if (!card.isConnected || !control.label.isConnected ||
          videoId(card) !== control.id) {
        selected.delete(card);
        control.label.remove();
        control.host.classList.remove("ytni-thumbnail");
        controls.delete(card);
      }
    }

    const cards = document.querySelectorAll(
      'ytd-browse[page-subtype="home"] ytd-rich-item-renderer'
    );

    for (const card of cards) {
      if (controls.has(card) || !visible(card)) continue;
      if (card.closest("ytd-rich-section-renderer")) continue;

      const id = videoId(card);
      if (!id) continue;

      const thumbnail = card.querySelector(
        'ytd-thumbnail a#thumbnail, a.yt-lockup-view-model__content-image, ' +
        'a.ytLockupViewModelContentImage'
      );
      const host = thumbnail?.parentElement;
      if (!host || !visible(thumbnail)) continue;

      if (getComputedStyle(host).position === "static") {
        host.classList.add("ytni-thumbnail");
      }

      const label = document.createElement("label");
      label.className = "ytni-choice";
      label.title = "Выбрать видео";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.disabled = busy;
      checkbox.setAttribute("aria-label", "Выбрать видео");

      label.append(checkbox);
      label.addEventListener("click", event => event.stopPropagation());

      checkbox.addEventListener("change", () => {
        message = "";
        if (checkbox.checked) selected.set(card, id);
        else selected.delete(card);
        refreshPanel();
      });

      host.append(label);
      controls.set(card, { id, label, checkbox, host });
    }

    for (const [card, control] of controls) {
      control.checkbox.disabled = busy;
      control.checkbox.checked = selected.has(card);
    }

    refreshPanel();
  }

  function assertActive() {
    if (cancelled || !home()) throw new Error("Обработка остановлена");
  }

  async function waitFor(find, timeout = 4000) {
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      assertActive();
      const result = find();
      if (result) return result;
      await sleep(100);
    }

    throw new Error("YouTube не ответил вовремя");
  }

  function openMenu() {
    return [...document.querySelectorAll(
      "ytd-menu-popup-renderer, yt-sheet-view-model"
    )].find(visible);
  }

  function interestItem(menu) {
    const candidates = menu.querySelectorAll(
      "ytd-menu-service-item-renderer, " +
      "yt-list-item-view-model, [role='menuitem']"
    );

    return [...candidates].find(element => {
      const text = element.textContent
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

      return visible(element) &&
        (text === "не интересует" || text === "not interested");
    });
  }

  clear.addEventListener("click", () => {
    if (busy) {
      cancelled = true;
    } else {
      selected.clear();
      message = "";
      scan();
    }
  });

  submit.addEventListener("click", async () => {
    if (busy || !home()) return;

    const queue = [...selected];
    busy = true;
    cancelled = false;
    let sent = 0;
    let failure = "";

    message = `Обработка: 0 из ${queue.length}`;
    scan();

    try {
      if (openMenu()) {
        throw new Error("Закрой открытое меню YouTube и повтори");
      }

      for (const [card, expectedId] of queue) {
        assertActive();

        if (!card.isConnected || videoId(card) !== expectedId) {
          throw new Error("Список видео изменился — проверь выбор");
        }

        card.scrollIntoView({ block: "center", behavior: "instant" });
        await sleep(200);
        assertActive();

        const menuButton = [...card.querySelectorAll(
          "ytd-menu-renderer yt-icon-button button, " +
          "ytd-menu-renderer button, " +
          "yt-lockup-metadata-view-model button"
        )].find(visible);

        if (!menuButton) {
          throw new Error("Не найдена кнопка меню видео");
        }

        menuButton.click();
        const menu = await waitFor(openMenu);
        const item = await waitFor(() => interestItem(menu));

        assertActive();

        if (!card.isConnected || videoId(card) !== expectedId) {
          throw new Error("Видео изменилось — обработка остановлена");
        }

        item.click();
        sent++;
        selected.delete(card);

        const control = controls.get(card);
        if (control) control.checkbox.checked = false;

        message = `Обработка: ${sent} из ${queue.length}`;
        refreshPanel();

        await waitFor(() => !visible(menu));
        await sleep(400);
      }
    } catch (error) {
      failure = error.message;
    } finally {
      busy = false;
      message = `Нажатий: ${sent} из ${queue.length}`;
      if (failure) message += `. ${failure}`;
      scan();
    }
  });

  document.addEventListener("yt-navigate-start", () => {
    cancelled = true;
    selected.clear();
    message = "";
  });

  document.addEventListener("yt-navigate-finish", scan);
  setInterval(scan, 700);
  scan();
})();
