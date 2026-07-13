
// Context Tracker — мини-бейдж со статистикой контекста.
// Показывает: id последнего сообщения (как в таверне, с 0), количество
// сообщений в контексте (нескрытых), токены. Прогресс-полоска и точка
// сигнализируют о приближении/наступлении порога пересказа.

(function () {
    'use strict';

    const MODULE = 'context_tracker';
    const EDGE_MARGIN = 14; // обязательный отступ от краёв экрана, px

    const DEFAULTS = {
        enabled: true,
        interval: 100,     // порог пересказа (сообщений в контексте); 0 = выключить индикацию
        showTokens: true,
        showProgress: true,
        pos: null,         // {x, y} — сохранённая позиция бейджа
    };

    let ctx = null;
    let settings = null;
    let badge = null;
    let lastSignature = '';
    let tokenCacheKey = '';
    let tokenText = '—';
    let pollTimer = null;

    // ---------- утилиты ----------

    function getSettings() {
        const store = ctx.extensionSettings;
        if (!store[MODULE]) store[MODULE] = {};
        // дозаполняем новыми дефолтами при обновлениях расширения
        for (const k of Object.keys(DEFAULTS)) {
            if (store[MODULE][k] === undefined) store[MODULE][k] = DEFAULTS[k];
        }
        return store[MODULE];
    }

    function save() {
        ctx.saveSettingsDebounced();
    }

    function fmtTokens(n) {
        if (n === null || n === undefined || Number.isNaN(n)) return '—';
        if (n >= 1000) {
            const v = n / 1000;
            return (v >= 100 ? Math.round(v) : v.toFixed(1)).toString() + 'k';
        }
        return String(n);
    }

    function getMaxContext() {
        if (typeof ctx.maxContext === 'number' && ctx.maxContext > 0) return ctx.maxContext;
        const el = document.getElementById('max_context');
        if (el) {
            const v = parseInt(el.value, 10);
            if (v > 0) return v;
        }
        const counter = document.getElementById('max_context_counter');
        if (counter) {
            const v = parseInt(counter.value || counter.textContent, 10);
            if (v > 0) return v;
        }
        return null;
    }

    async function countTokens(text) {
        try {
            if (typeof ctx.getTokenCountAsync === 'function') {
                return await ctx.getTokenCountAsync(text);
            }
            if (typeof ctx.getTokenCount === 'function') {
                return ctx.getTokenCount(text);
            }
        } catch (e) {
            console.warn(`[${MODULE}] token count failed, using estimate`, e);
        }
        // грубая оценка, если API токенайзера недоступен
        return Math.round(text.length / 3.2);
    }

    // ---------- сбор статистики ----------

    function collect() {
        const chat = Array.isArray(ctx.chat) ? ctx.chat : [];
        const total = chat.length;
        const lastId = total > 0 ? total - 1 : null; // ровно тот mesid, что в таверне (с нуля)
        const visible = chat.filter(m => m && !m.is_system);
        return { chat, total, lastId, visible };
    }

    function signatureOf(s) {
        const lastLen = s.total ? String((s.chat[s.total - 1].mes || '').length) : '0';
        return `${s.total}:${s.visible.length}:${lastLen}`;
    }

    // ---------- бейдж ----------

    function buildBadge() {
        badge = document.createElement('div');
        badge.id = 'ctx-tracker-badge';
        badge.innerHTML = `
            <div class="ctt-dot" title="Пора делать пересказ"></div>
            <div class="ctt-row"><span class="ctt-label">соо</span><span class="ctt-val" data-ctt="last">—</span></div>
            <div class="ctt-row"><span class="ctt-label">в контексте</span><span class="ctt-val" data-ctt="visible">—</span></div>
            <div class="ctt-row ctt-tokens-row"><span class="ctt-val ctt-tokens" data-ctt="tokens">—</span></div>
            <div class="ctt-progress"><div class="ctt-progress-fill"></div></div>
        `;
        document.body.appendChild(badge);
        initDrag();
        applyPosition();
    }

    function applyPosition() {
        if (!badge) return;
        let x, y;
        if (settings.pos && Number.isFinite(settings.pos.x) && Number.isFinite(settings.pos.y)) {
            ({ x, y } = settings.pos);
        } else {
            // позиция по умолчанию: правый верхний угол
            x = window.innerWidth - badge.offsetWidth - EDGE_MARGIN - 10;
            y = 70;
        }
        const c = clampPos(x, y);
        badge.style.left = c.x + 'px';
        badge.style.top = c.y + 'px';
    }

    function clampPos(x, y) {
        const w = badge.offsetWidth || 140;
        const h = badge.offsetHeight || 70;
        const maxX = Math.max(EDGE_MARGIN, window.innerWidth - w - EDGE_MARGIN);
        const maxY = Math.max(EDGE_MARGIN, window.innerHeight - h - EDGE_MARGIN);
        return {
            x: Math.min(Math.max(x, EDGE_MARGIN), maxX),
            y: Math.min(Math.max(y, EDGE_MARGIN), maxY),
        };
    }

    function initDrag() {
        let dragging = false;
        let startX = 0, startY = 0, origX = 0, origY = 0;

        badge.addEventListener('pointerdown', (e) => {
            dragging = true;
            badge.setPointerCapture(e.pointerId);
            badge.classList.add('ctt-dragging');
            startX = e.clientX;
            startY = e.clientY;
            const r = badge.getBoundingClientRect();
            origX = r.left;
            origY = r.top;
            e.preventDefault();
        });

        badge.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            const c = clampPos(origX + (e.clientX - startX), origY + (e.clientY - startY));
            badge.style.left = c.x + 'px';
            badge.style.top = c.y + 'px';
        });

        const stop = (e) => {
            if (!dragging) return;
            dragging = false;
            badge.classList.remove('ctt-dragging');
            try { badge.releasePointerCapture(e.pointerId); } catch { /* noop */ }
            const r = badge.getBoundingClientRect();
            settings.pos = { x: r.left, y: r.top };
            save();
        };
        badge.addEventListener('pointerup', stop);
        badge.addEventListener('pointercancel', stop);

        window.addEventListener('resize', () => {
            if (badge) applyPosition();
        });
    }

    function setText(key, value) {
        const el = badge.querySelector(`[data-ctt="${key}"]`);
        if (el) el.textContent = value;
    }

    // ---------- обновление ----------

    async function update(force = false) {
        if (!badge) return;

        badge.style.display = settings.enabled ? '' : 'none';
        if (!settings.enabled) return;

        const s = collect();
        const sig = signatureOf(s);
        if (!force && sig === lastSignature) return;
        lastSignature = sig;

        setText('last', s.lastId === null ? '—' : String(s.lastId));
        setText('visible', String(s.visible.length));

        // токены — считаем только по видимым сообщениям, с кэшем
        const tokensRow = badge.querySelector('.ctt-tokens-row');
        tokensRow.style.display = settings.showTokens ? '' : 'none';
        if (settings.showTokens) {
            if (sig !== tokenCacheKey) {
                tokenCacheKey = sig;
                const text = s.visible.map(m => m.mes || '').join('\n');
                const count = await countTokens(text);
                // за время await чат мог измениться — не затираем свежие данные старыми
                if (tokenCacheKey === sig) {
                    const max = getMaxContext();
                    tokenText = fmtTokens(count) + (max ? ' / ' + fmtTokens(max) : '');
                }
            }
            setText('tokens', tokenText);
        }

        // прогресс к порогу пересказа + точка «пора»
        const bar = badge.querySelector('.ctt-progress');
        const fill = badge.querySelector('.ctt-progress-fill');
        const dot = badge.querySelector('.ctt-dot');
        const interval = Number(settings.interval) || 0;

        if (interval > 0 && settings.showProgress) {
            bar.style.display = '';
            const ratio = Math.min(s.visible.length / interval, 1);
            fill.style.width = (ratio * 100).toFixed(1) + '%';
            dot.classList.toggle('ctt-due', s.visible.length >= interval);
        } else {
            bar.style.display = 'none';
            dot.classList.remove('ctt-due');
        }
    }

    function scheduleUpdate() {
        // микро-дебаунс, чтобы не дёргать пересчёт на каждый чих подряд
        clearTimeout(scheduleUpdate._t);
        scheduleUpdate._t = setTimeout(() => update(), 150);
    }

    // ---------- панель настроек ----------

    function addSettingsPanel() {
        const html = `
        <div class="context-tracker-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Context Tracker</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <label class="checkbox_label">
                        <input type="checkbox" id="ctt_enabled">
                        <span>Показывать бейдж</span>
                    </label>
                    <label class="checkbox_label">
                        <input type="checkbox" id="ctt_show_tokens">
                        <span>Показывать токены</span>
                    </label>
                    <label class="checkbox_label">
                        <input type="checkbox" id="ctt_show_progress">
                        <span>Полоска прогресса и точка «пора»</span>
                    </label>
                    <label for="ctt_interval">Интервал пересказа (сообщений в контексте, 0 — выкл.):</label>
                    <input type="number" id="ctt_interval" class="text_pole" min="0" step="10">
                    <div class="menu_button" id="ctt_reset_pos" title="Вернуть бейдж в угол по умолчанию">
                        Сбросить позицию бейджа
                    </div>
                </div>
            </div>
        </div>`;

        const target = document.getElementById('extensions_settings2')
            || document.getElementById('extensions_settings');
        if (!target) {
            console.warn(`[${MODULE}] не нашла контейнер настроек расширений`);
            return;
        }
        target.insertAdjacentHTML('beforeend', html);

        const $enabled = document.getElementById('ctt_enabled');
        const $tokens = document.getElementById('ctt_show_tokens');
        const $progress = document.getElementById('ctt_show_progress');
        const $interval = document.getElementById('ctt_interval');
        const $reset = document.getElementById('ctt_reset_pos');

        $enabled.checked = settings.enabled;
        $tokens.checked = settings.showTokens;
        $progress.checked = settings.showProgress;
        $interval.value = settings.interval;

        $enabled.addEventListener('change', () => { settings.enabled = $enabled.checked; save(); update(true); });
        $tokens.addEventListener('change', () => { settings.showTokens = $tokens.checked; save(); update(true); });
        $progress.addEventListener('change', () => { settings.showProgress = $progress.checked; save(); update(true); });
        $interval.addEventListener('input', () => {
            const v = parseInt($interval.value, 10);
            settings.interval = Number.isFinite(v) && v >= 0 ? v : 0;
            save();
            update(true);
        });
        $reset.addEventListener('click', () => {
            settings.pos = null;
            save();
            applyPosition();
        });
    }

    // ---------- события ----------

    function bindEvents() {
        const et = ctx.eventTypes || {};
        const names = [
            et.CHAT_CHANGED,
            et.MESSAGE_SENT,
            et.MESSAGE_RECEIVED,
            et.MESSAGE_DELETED,
            et.MESSAGE_EDITED,
            et.MESSAGE_SWIPED,
            et.MESSAGE_UPDATED,
            et.GENERATION_ENDED,
        ].filter(Boolean);
        for (const name of names) {
            ctx.eventSource.on(name, scheduleUpdate);
        }

        // страховка: /hide и некоторые действия не всегда кидают события —
        // раз в 2 секунды дёшево сверяем сигнатуру и обновляем при изменениях
        pollTimer = setInterval(() => update(), 2000);
    }

    // ---------- init ----------

    jQuery(async () => {
        try {
            ctx = SillyTavern.getContext();
        } catch (e) {
            console.error(`[${MODULE}] SillyTavern context недоступен`, e);
            return;
        }
        settings = getSettings();
        buildBadge();
        addSettingsPanel();
        bindEvents();
        update(true);
    });
})();
