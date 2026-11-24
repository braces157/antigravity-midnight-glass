  const metricsByCid = (window.__ag_mg_metrics = window.__ag_mg_metrics || {});
  const lastSeenGenByCid = {};
  const lastTurnKeyByPane = {};
  let popPinned = false;
  let popOwnerPane = 'main';
  let popShowTimer = null;
  let popHideTimer = null;
  let turnShowTimer = null;
  let turnHideTimer = null;

  const discoverPanes = () => {
    const panes = [];
    const boxes = document.querySelectorAll('[id="antigravity.agentSidePanelInputBox"]');
    let hasMain = false, hasSide = false;
    for (const box of boxes) {
      const side = box.closest?.('[data-testid="side-question-tab-content"]');
      if (side) {
        if (hasSide) continue;
        hasSide = true;
        const conv = side.querySelector('[data-testid="side-question-tab-conversation"][data-cascade-id]');
        const cid = conv?.getAttribute('data-cascade-id')?.trim() || '';
        panes.push({ key: 'side', stripId: 'ag-mg-strip-side', inputBox: box, container: side, cid: UUID_RE.test(cid) ? cid : '' });
      } else {
        if (hasMain) continue;
        hasMain = true;
        panes.push({
          key: 'main',
          stripId: 'ag-mg-strip-main',
          inputBox: box,
          container: box.closest?.('[data-testid="conversation-view"]') || document,
          cid: extractMainCid()
        });
      }
    }
    return panes;
  };

  window.__ag_mg_get_cids = () => {
    const out = [];
    for (const p of discoverPanes()) {
      if (p.cid && !out.includes(p.cid)) out.push(p.cid);
    }
    return out;
  };

  const positionPopover = (popover, inputBox, strip) => {
    if (!popover) return;
    const boxRect = inputBox ? inputBox.getBoundingClientRect() : null;
    const stripRect = strip ? strip.getBoundingClientRect() : null;
    const anchorTop = boxRect && boxRect.height > 0 ? boxRect.top : stripRect ? stripRect.top : 0;
    const anchorCenterX = boxRect && boxRect.width > 0 ? boxRect.left + boxRect.width / 2 : window.innerWidth / 2;
    const popW = popover.offsetWidth || 352;
    const left = Math.max(12, Math.min(Math.round(anchorCenterX - popW / 2), window.innerWidth - popW - 12));
    const bottom = Math.max(16, Math.round(window.innerHeight - anchorTop + 10));
    popover.style.left = `${left}px`;
    popover.style.bottom = `${bottom}px`;
    popover.style.top = 'auto';
  };

  const ensurePopover = () => {
    let pop = document.getElementById('ag-mg-popover');
    if (pop || !document.body) return pop;
    pop = document.createElement('div');
    pop.id = 'ag-mg-popover';
    document.body.appendChild(pop);

    pop.addEventListener('mouseenter', () => {
      if (popHideTimer) { clearTimeout(popHideTimer); popHideTimer = null; }
    });
    pop.addEventListener('mouseleave', () => {
      if (popPinned) return;
      if (popHideTimer) clearTimeout(popHideTimer);
      popHideTimer = setTimeout(() => {
        if (!popPinned) pop.removeAttribute('data-visible');
      }, 180);
    });
    pop.addEventListener('click', (e) => {
      const refBtn = e.target?.closest?.('.mg-quota-refresh');
      if (refBtn) {
        e.preventDefault();
        e.stopPropagation();
        const pane = discoverPanes().find((p) => p.key === popOwnerPane);
        triggerLiveQuotaRefresh(pane?.inputBox, { force: true, onUpdated: () => hydratePopover(popOwnerPane) });
        return;
      }
      const btn = e.target?.closest?.('.mg-btn-toggle');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      if (pop.getAttribute('data-expanded') === '1') pop.removeAttribute('data-expanded');
      else pop.setAttribute('data-expanded', '1');
      const pane = discoverPanes().find((p) => p.key === popOwnerPane);
      positionPopover(pop, pane?.inputBox, document.getElementById(pane?.stripId || 'ag-mg-strip-main'));
    });
    return pop;
  };

  const hydratePopover = (paneKey) => {
    const pop = ensurePopover();
    if (!pop) return null;
    const pane = discoverPanes().find((p) => p.key === paneKey);
    const m = pane?.cid ? metricsByCid[pane.cid] : null;
    if (!m || !m.tooltipHtml) return null;
    popOwnerPane = paneKey;
    if (pop.getAttribute('data-raw') !== m.tooltipHtml) {
      pop.setAttribute('data-raw', m.tooltipHtml);
      pop.innerHTML = m.tooltipHtml;
    }
    const vis = computeVisualStatus({ st: m.status, stopActive: isStopBtnVisible(pane?.inputBox) });
    const chip = pop.querySelector('.mg-live-chip');
    if (chip) {
      chip.textContent = vis.chipText;
      chip.className = 'mg-live-chip' + (vis.chipClass ? ' ' + vis.chipClass : '');
    }
    const note = pop.querySelector('.mg-wait-note');
    if (note) {
      note.className = 'mg-wait-note' + (vis.noteClass ? ' ' + vis.noteClass : '');
      note.innerHTML = vis.noteHtml;
    }
    let quotaHost = pop.querySelector('.mg-quota-blk');
    if (!quotaHost) {
      const l2 = pop.querySelector('.mg-l2');
      const wrap = pop.querySelector('.mg-pop-wrap');
      if (wrap) {
        quotaHost = document.createElement('div');
        quotaHost.className = 'mg-quota-blk';
        if (l2) wrap.insertBefore(quotaHost, l2);
        else wrap.appendChild(quotaHost);
      }
    }
    if (quotaHost) {
      const q = readLiveQuotaInfo(pane?.inputBox);
      if (q) {
        const qCls = q.pct <= 15 ? 'is-crit' : q.pct <= 35 ? 'is-warn' : 'is-quota';
        const refBtnHtml = q.canRefresh
          ? `<button type="button" class="mg-quota-refresh${q.refreshing ? ' is-spin' : ''}" title="Refresh live model quota" aria-label="Refresh live model quota">↻</button>`
          : '';
        const leftLabel = q.refreshing ? 'Syncing quota…' : 'Model quota';
        const qHtml =
          `<div class="mg-meter-top"><span class="mg-meter-name">${escapeUiHtml(q.label)}</span><span class="mg-meter-val"><strong class="${qCls}">${escapeUiHtml(q.pctLabel)}%</strong> left</span></div>` +
          `<div class="mg-hairline-track"><div class="mg-hairline-fill ${qCls}" style="width:${Math.max(2, q.rawPct).toFixed(1)}%"></div></div>` +
          `<div class="mg-meter-sub"><span class="mg-quota-left">${leftLabel}${refBtnHtml}</span><span>${escapeUiHtml(q.resetText || '')}</span></div>`;
        if (quotaHost.getAttribute('data-raw') !== qHtml) {
          quotaHost.setAttribute('data-raw', qHtml);
          quotaHost.innerHTML = qHtml;
        }
      } else {
        quotaHost.innerHTML = '';
      }
    }
    return { pop, pane };
  };

  const ensureStripForPane = (pane) => {
    if (!pane?.inputBox?.parentElement) return null;
    let strip = document.getElementById(pane.stripId);
    if (!strip) {
      strip = document.createElement('div');
      strip.id = pane.stripId;
      strip.className = 'ag-mg-strip';
      strip.setAttribute('role', 'button');
      strip.setAttribute('tabindex', '0');
      strip.setAttribute('aria-label', 'Session telemetry details');
      strip.innerHTML = '<span class="ag-mg-strip-inner"><span class="ag-mg-dot is-idle"></span><span>Ready</span></span>';

      strip.addEventListener('mouseenter', () => {
        if (popHideTimer) { clearTimeout(popHideTimer); popHideTimer = null; }
        if (popPinned && popOwnerPane !== pane.key) return;
        if (popShowTimer) clearTimeout(popShowTimer);
        popShowTimer = setTimeout(() => {
          const res = hydratePopover(pane.key);
          if (!res) return;
          positionPopover(res.pop, res.pane?.inputBox || pane.inputBox, strip);
          res.pop.setAttribute('data-visible', '1');
          triggerLiveQuotaRefresh(res.pane?.inputBox || pane.inputBox, {
            force: false,
            onUpdated: () => hydratePopover(pane.key)
          });
        }, 90);
      });

      strip.addEventListener('mouseleave', () => {
        if (popShowTimer) { clearTimeout(popShowTimer); popShowTimer = null; }
        if (popPinned) return;
        if (popHideTimer) clearTimeout(popHideTimer);
        popHideTimer = setTimeout(() => {
          const pop = document.getElementById('ag-mg-popover');
          if (pop && !popPinned) pop.removeAttribute('data-visible');
        }, 180);
      });

      const togglePin = (e) => {
        e.stopPropagation();
        const res = hydratePopover(pane.key);
        if (!res) return;
        const { pop } = res;
        const visible = pop.getAttribute('data-visible') === '1';
        const expanded = pop.getAttribute('data-expanded') === '1';
        if (!visible || !popPinned) {
          pop.removeAttribute('data-expanded');
          pop.setAttribute('data-visible', '1');
          popPinned = true;
        } else if (!expanded) {
          pop.setAttribute('data-expanded', '1');
          pop.setAttribute('data-visible', '1');
          popPinned = true;
        } else {
          pop.removeAttribute('data-expanded');
          pop.removeAttribute('data-visible');
          popPinned = false;
        }
        if (pop.getAttribute('data-visible') === '1') {
          positionPopover(pop, res.pane?.inputBox || pane.inputBox, strip);
          triggerLiveQuotaRefresh(res.pane?.inputBox || pane.inputBox, {
            force: false,
            onUpdated: () => hydratePopover(pane.key)
          });
        }
      };

      strip.addEventListener('click', togglePin);
      strip.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePin(e); }
      });
    }

    const hostParent = pane.inputBox.parentElement;
    if (strip.parentElement !== hostParent || pane.inputBox.nextElementSibling !== strip) {
      hostParent.insertBefore(strip, pane.inputBox.nextSibling);
    }
    return strip;
  };

  const ensureTurnTooltip = () => {
    let tt = document.getElementById('ag-mg-turn-tooltip');
    if (tt || !document.body) return tt;
    tt = document.createElement('div');
    tt.id = 'ag-mg-turn-tooltip';
    document.body.appendChild(tt);
    tt.addEventListener('mouseenter', () => { if (turnHideTimer) { clearTimeout(turnHideTimer); turnHideTimer = null; } });
    tt.addEventListener('mouseleave', () => { turnHideTimer = setTimeout(() => tt.removeAttribute('data-visible'), 110); });
    return tt;
  };

  const renderTurnBadges = (pane) => {
    if (!pane?.cid) return;
    const m = metricsByCid[pane.cid];
    if (!m?.turns?.length) return;
    const root = pane.container || document;
    const copyBtns = root.querySelectorAll('button[aria-label="Copy"]');
    if (!copyBtns.length) return;
    const toolbars = [];
    for (let i = 0; i < copyBtns.length; i++) {
      const parent = copyBtns[i].parentElement;
      if (parent && parent.tagName === 'DIV') toolbars.push(parent);
    }
    if (!toolbars.length) return;
    const renderKey = `${pane.cid}:${m.sig || ''}:${toolbars.length}`;
    if (lastTurnKeyByPane[pane.key] === renderKey && toolbars[toolbars.length - 1].querySelector('.ag-mg-turn-badge')) {
      return;
    }
    lastTurnKeyByPane[pane.key] = renderKey;
    const turns = m.turns;
    let tIdx = turns.length - 1;
    for (let i = toolbars.length - 1; i >= 0 && tIdx >= 0; i--, tIdx--) {
      const tb = toolbars[i];
      const t = turns[tIdx];
      let badge = tb.querySelector('.ag-mg-turn-badge');
      const parts = [];
      if (t.model) parts.push(`<span class="mg-turn-model">${escapeUiHtml(t.model)}</span>`);
      if (t.promptTok > 0) parts.push(`<span>In ${escapeUiHtml(t.promptStr)}</span>`);
      if (t.outTok > 0) parts.push(`<span>Out ${escapeUiHtml(t.outStr)}</span>`);
      if (t.promptTok > 0 && t.cacheRate) parts.push(`<span>Cache ${escapeUiHtml(t.cacheRate)}</span>`);
      if (t.tps > 0) parts.push(`<span>${t.tps} tok/s</span>`);
      const html = parts.join('<span class="mg-sep">·</span>');
      const ttHtml =
        `<div class="mg-tmt-hdr"><span>${escapeUiHtml(t.model || 'Turn')}</span><span>${t.steps} steps</span></div>` +
        `<div class="mg-tmt-row"><span class="mg-tmt-lbl">Context</span><span>${t.lastCtx.toLocaleString('en-US')} / ${escapeUiHtml(t.limitStr)} (${t.ctxPct}%)</span></div>` +
        `<div class="mg-tmt-row"><span class="mg-tmt-lbl">Output</span><span>${t.outTok.toLocaleString('en-US')} <span class="mg-tmt-sub">(Think ${t.thinkTok.toLocaleString('en-US')} + Resp ${t.respTok.toLocaleString('en-US')})</span></span></div>` +
        `<div class="mg-tmt-row"><span class="mg-tmt-lbl">Input</span><span>New ${t.inTok.toLocaleString('en-US')} + Cache ${t.cacheRead.toLocaleString('en-US')} (${escapeUiHtml(t.cacheRate)})</span></div>` +
        `<div class="mg-tmt-row"><span class="mg-tmt-lbl">Speed</span><span>${t.tps} tok/s · ${t.streamDur}s / ${t.totDur}s</span></div>`;

      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'ag-mg-turn-badge';
        badge.style.marginRight = '8px';
        tb.insertBefore(badge, tb.firstChild);
        badge.addEventListener('mouseenter', () => {
          if (turnHideTimer) { clearTimeout(turnHideTimer); turnHideTimer = null; }
          if (turnShowTimer) clearTimeout(turnShowTimer);
          turnShowTimer = setTimeout(() => {
            const tt = ensureTurnTooltip();
            if (!tt) return;
            tt.innerHTML = badge.getAttribute('data-tt') || '';
            const rc = badge.getBoundingClientRect();
            const ttW = tt.offsetWidth || 320;
            const ttH = tt.offsetHeight || 130;
            tt.style.left = `${Math.max(12, Math.min(Math.round(rc.left), window.innerWidth - ttW - 12))}px`;
            tt.style.top = `${Math.max(12, Math.round(rc.top - ttH - 8))}px`;
            tt.setAttribute('data-visible', '1');
          }, 80);
        });
        badge.addEventListener('mouseleave', () => {
          if (turnShowTimer) { clearTimeout(turnShowTimer); turnShowTimer = null; }
          turnHideTimer = setTimeout(() => {
            const tt = document.getElementById('ag-mg-turn-tooltip');
            if (tt) tt.removeAttribute('data-visible');
          }, 110);
        });
      }
      if (badge.getAttribute('data-raw') !== html) {
        badge.setAttribute('data-raw', html);
        badge.innerHTML = html;
      }
      badge.setAttribute('data-tt', ttHtml);
    }
  };

  const refreshTelemetryUi = () => {
    if (!BOOT.telemetryEnabled) return;
    const panes = discoverPanes();
    const activeIds = new Set(panes.map((p) => p.stripId));
    for (const id of ['ag-mg-strip-main', 'ag-mg-strip-side']) {
      if (!activeIds.has(id)) document.getElementById(id)?.remove();
    }
    for (const pane of panes) {
      const strip = ensureStripForPane(pane);
      if (!strip) continue;
      const m = pane.cid ? metricsByCid[pane.cid] : null;
      const vis = computeVisualStatus({ st: m?.status, stopActive: isStopBtnVisible(pane.inputBox) });
      strip.style.display = 'flex';
      strip.title = vis.title;
      const inner = strip.querySelector('.ag-mg-strip-inner');
      if (inner) {
        const html = m?.hasData && m.inlineHtml
          ? m.inlineHtml
          : `<span class="${vis.dotClass}"></span><span>${escapeUiHtml(vis.chipText || 'Ready')}</span>`;
        if (inner.getAttribute('data-raw') !== html) {
          inner.setAttribute('data-raw', html);
          inner.innerHTML = html;
        }
        const dot = inner.querySelector('.ag-mg-dot');
        if (dot && dot.className !== vis.dotClass) dot.className = vis.dotClass;
      }
      renderTurnBadges(pane);
      const genIdx = m?.stats?.genIdx || 0;
      const stopActive = isStopBtnVisible(pane.inputBox);
      if (pane.cid && genIdx > 0) {
        const prevGen = lastSeenGenByCid[pane.cid] || 0;
        if (prevGen > 0 && genIdx > prevGen && !stopActive && m?.status?.pendingKind === 'idle') {
          triggerLiveQuotaRefresh(pane.inputBox, { force: false, onUpdated: () => {
            const pEl = document.getElementById('ag-mg-popover');
            if (pEl && pEl.getAttribute('data-visible') === '1') hydratePopover(popOwnerPane);
          }});
        }
        lastSeenGenByCid[pane.cid] = genIdx;
      }
    }
    const pop = document.getElementById('ag-mg-popover');
    if (pop && pop.getAttribute('data-visible') === '1') {
      hydratePopover(popOwnerPane);
    }
  };

  window.__ag_mg_render_metrics = (payload) => {
    if (!payload?.cid) return;
    metricsByCid[payload.cid] = payload;
    const keys = Object.keys(metricsByCid);
    if (keys.length > 10) delete metricsByCid[keys[0]];
    refreshTelemetryUi();
  };

  window.__ag_mg_refresh = refreshTelemetryUi;

  const onDocClick = (e) => {
    if (!popPinned) return;
    const pop = document.getElementById('ag-mg-popover');
    if (pop && !pop.contains(e.target) && !e.target?.closest?.('.ag-mg-strip')) {
      popPinned = false;
      pop.removeAttribute('data-visible');
      pop.removeAttribute('data-expanded');
    }
  };
  const onDocKeyDown = (e) => {
    if (e.key === 'Escape' && popPinned) {
      popPinned = false;
      const pop = document.getElementById('ag-mg-popover');
      if (pop) { pop.removeAttribute('data-visible'); pop.removeAttribute('data-expanded'); }
    }
  };
  const onVisibilityChange = () => {
    if (!document.hidden) refreshTelemetryUi();
  };
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onDocKeyDown);
  document.addEventListener('visibilitychange', onVisibilityChange);

  refreshTelemetryUi();
  const uiTimer = setInterval(() => {
    if (!document.hidden) refreshTelemetryUi();
  }, 1500);

  onCleanup(() => {
    clearInterval(uiTimer);
    if (popShowTimer) clearTimeout(popShowTimer);
    if (popHideTimer) clearTimeout(popHideTimer);
    if (turnShowTimer) clearTimeout(turnShowTimer);
    if (turnHideTimer) clearTimeout(turnHideTimer);
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onDocKeyDown);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    document.getElementById('ag-mg-popover')?.remove();
    document.getElementById('ag-mg-turn-tooltip')?.remove();
    document.getElementById('ag-mg-strip-main')?.remove();
    document.getElementById('ag-mg-strip-side')?.remove();
  });
