/* =====================================
   CHAT ASSISTANT
   A small chat window in the corner of every page. It talks to /api/chat on the server;
   the AI key never reaches the browser. If the server says the assistant is off (no key),
   nothing is shown at all.
===================================== */
(function () {
    const STORAGE_KEY = "danny-chat-v1";
    const MAX_SAVED = 40;
    const QUICK_QUESTIONS = [
        "What is available for rent?",
        "Show me houses for sale",
        "Do you have land for sale?",
        "I want to talk to someone"
    ];

    let panel, button, list, form, input, sendButton, chips;
    let history = [];
    let busy = false;

    /* ---------- saved conversation (this tab only, cleared when the tab closes) ---------- */
    function load() {
        try {
            const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "[]");
            if (Array.isArray(saved)) history = saved.filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string").slice(-MAX_SAVED);
        } catch (_) { history = []; }
    }

    function save() {
        try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-MAX_SAVED))); } catch (_) { /* private mode: fine */ }
    }

    /* ---------- building messages (text only, never HTML from the server) ---------- */
    function textWithLinks(text, links) {
        const wrap = document.createDocumentFragment();
        text.split(/(\[\[\d{1,6}\]\])/g).forEach(part => {
            const match = /^\[\[(\d{1,6})\]\]$/.exec(part);
            if (match && links && links[match[1]]) {
                const a = document.createElement("a");
                a.href = "property-detail.html?id=" + encodeURIComponent(match[1]);
                a.textContent = "View: " + links[match[1]].title;
                a.className = "underline font-semibold text-navy";
                wrap.appendChild(a);
            } else if (!match) {
                wrap.appendChild(document.createTextNode(part));
            }
        });
        return wrap;
    }

    function addMessage(message) {
        const row = document.createElement("div");
        row.className = "flex " + (message.role === "user" ? "justify-end" : "justify-start");

        const bubble = document.createElement("div");
        bubble.className = message.role === "user"
            ? "max-w-[85%] bg-navy text-white rounded-2xl rounded-br-sm px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap break-words"
            : "max-w-[85%] bg-gray-100 text-gray-900 rounded-2xl rounded-bl-sm px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap break-words";
        bubble.appendChild(textWithLinks(message.content, message.links));

        (message.actions || []).forEach(action => {
            if (action.type !== "whatsapp" || !/^https:\/\/wa\.me\//.test(action.url)) return;
            const a = document.createElement("a");
            a.href = action.url;
            a.target = "_blank";
            a.rel = "noopener";
            a.className = "mt-3 flex items-center justify-center gap-2 bg-green-600 text-white font-semibold rounded-lg px-4 min-h-[44px] hover:bg-green-700 transition";
            a.textContent = "Message the team on WhatsApp";
            bubble.appendChild(a);
        });

        if (message.enquiryId) {
            const note = document.createElement("p");
            note.className = "mt-2 text-xs font-semibold text-green-700";
            note.textContent = "Enquiry " + message.enquiryId + " saved. The team will contact you.";
            bubble.appendChild(note);
        }

        row.appendChild(bubble);
        list.appendChild(row);
        list.scrollTop = list.scrollHeight;
    }

    function showTyping(on) {
        const existing = document.getElementById("chatTyping");
        if (!on) { if (existing) existing.remove(); return; }
        if (existing) return;
        const row = document.createElement("div");
        row.id = "chatTyping";
        row.className = "flex justify-start";
        row.innerHTML = '<div class="bg-gray-100 text-gray-500 rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm">Typing...</div>';
        list.appendChild(row);
        list.scrollTop = list.scrollHeight;
    }

    function contactHint() {
        const phone = typeof siteConfig !== "undefined" && siteConfig.phone ? siteConfig.phone : "";
        return phone ? " You can call or WhatsApp us on " + phone + "." : "";
    }

    /* ---------- sending ---------- */
    async function send(text) {
        text = String(text || "").trim().slice(0, 600);
        if (!text || busy) return;

        busy = true;
        sendButton.disabled = true;
        chips.classList.add("hidden");

        const mine = { role: "user", content: text };
        history.push(mine);
        addMessage(mine);
        input.value = "";
        showTyping(true);

        try {
            const params = new URLSearchParams(window.location.search);
            const propertyId = /property-detail/.test(window.location.pathname) ? params.get("id") || "" : "";
            const response = await fetchWithTimeout("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    messages: history.slice(-12).map(m => ({ role: m.role, content: m.content })),
                    propertyId
                })
            }, 45000);
            const result = await response.json().catch(() => ({}));
            showTyping(false);

            if (!response.ok || !result.reply) {
                addMessage({ role: "assistant", content: (result.message || "Sorry, I could not answer that.") + (response.status >= 500 || response.status === 429 ? contactHint() : "") });
            } else {
                const reply = { role: "assistant", content: result.reply, links: result.links, actions: result.actions, enquiryId: result.enquiryId };
                history.push(reply);
                addMessage(reply);
            }
        } catch (error) {
            showTyping(false);
            addMessage({ role: "assistant", content: (error.network ? error.message + " " : "") + "I could not connect, so your message was not answered." + contactHint() });
        } finally {
            busy = false;
            sendButton.disabled = false;
            save();
            if (!panel.classList.contains("hidden")) input.focus();
        }
    }

    /* ---------- open and close ---------- */
    function openPanel() {
        panel.classList.remove("hidden");
        button.setAttribute("aria-expanded", "true");
        button.classList.add("hidden");
        input.focus();
        list.scrollTop = list.scrollHeight;
    }

    function closePanel() {
        panel.classList.add("hidden");
        button.classList.remove("hidden");
        button.setAttribute("aria-expanded", "false");
        button.focus();
    }

    function build() {
        button = document.createElement("button");
        button.type = "button";
        button.id = "chatButton";
        button.setAttribute("aria-controls", "chatPanel");
        button.setAttribute("aria-expanded", "false");
        button.className = "fixed z-40 bottom-4 right-4 sm:bottom-6 sm:right-6 flex items-center gap-2 bg-navy text-white font-semibold rounded-full px-5 min-h-[56px] shadow-xl hover:bg-darknavy transition";
        button.innerHTML = '<i data-lucide="message-circle" class="w-6 h-6"></i><span>Chat with us</span>';

        panel = document.createElement("section");
        panel.id = "chatPanel";
        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-label", "Chat assistant");
        panel.className = "hidden fixed z-50 inset-x-0 bottom-0 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[24rem] h-[85vh] max-h-[85dvh] sm:h-[34rem] bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden";
        panel.innerHTML = `
            <div class="bg-navy text-white px-5 py-4 flex items-start justify-between gap-3">
                <div>
                    <p class="font-bold leading-tight">Ask about our properties</p>
                    <p class="text-xs text-blue-100 mt-1">AI assistant. It can make mistakes, so the team confirms every detail.</p>
                </div>
                <button type="button" id="chatClose" class="w-11 h-11 shrink-0 -mr-2 -mt-2 flex items-center justify-center rounded-full hover:bg-white/10" aria-label="Close chat">
                    <i data-lucide="x" class="w-5 h-5"></i>
                </button>
            </div>
            <div id="chatLog" role="log" aria-live="polite" class="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-white"></div>
            <div id="chatChips" class="px-4 pb-3 flex flex-wrap gap-2"></div>
            <form id="chatForm" class="border-t border-gray-200 p-3 flex gap-2" autocomplete="off">
                <label for="chatInput" class="sr-only">Your message</label>
                <input id="chatInput" type="text" maxlength="600" placeholder="Type your question" class="flex-1 min-w-0 border border-gray-300 rounded-lg px-4 py-3 text-base outline-none focus:ring-2 focus:ring-navy">
                <button type="submit" id="chatSend" class="w-12 shrink-0 flex items-center justify-center bg-gold text-darknavy rounded-lg hover:opacity-90 disabled:opacity-50" aria-label="Send message">
                    <i data-lucide="send" class="w-5 h-5"></i>
                </button>
            </form>
            <p class="px-4 pb-3 text-[11px] text-gray-500">Please do not share passwords or payment details here.</p>
        `;

        document.body.appendChild(button);
        document.body.appendChild(panel);

        list = panel.querySelector("#chatLog");
        form = panel.querySelector("#chatForm");
        input = panel.querySelector("#chatInput");
        sendButton = panel.querySelector("#chatSend");
        chips = panel.querySelector("#chatChips");

        QUICK_QUESTIONS.forEach(question => {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "min-h-[44px] border border-gray-300 text-navy text-sm font-semibold rounded-full px-4 hover:border-gold hover:text-gold transition";
            chip.textContent = question;
            chip.addEventListener("click", () => send(question));
            chips.appendChild(chip);
        });

        const greeting = { role: "assistant", content: "Hello! I am the website assistant. Ask me about apartments, houses, offices or land, and I can pass your details to the team." };
        addMessage(greeting);
        history.forEach(addMessage);
        if (history.length) chips.classList.add("hidden");

        button.addEventListener("click", openPanel);
        panel.querySelector("#chatClose").addEventListener("click", closePanel);
        form.addEventListener("submit", event => { event.preventDefault(); send(input.value); });
        document.addEventListener("keydown", event => {
            if (event.key === "Escape" && !panel.classList.contains("hidden")) closePanel();
        });

        drawIcons();
    }

    /* ---------- start: only if the server says the assistant is switched on ---------- */
    async function start() {
        try {
            const response = await fetchWithTimeout("/api/chat/status", {}, 8000);
            const status = await response.json();
            if (!status.enabled) return;
        } catch (_) { return; }
        load();
        build();
    }

    start();
})();
