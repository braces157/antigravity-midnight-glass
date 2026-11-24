export function fmtTok(n) {
  if (!n || n <= 0) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 10000) return Math.round(n / 1000) + 'K';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(Math.round(n));
}

export function fmtNum(n) {
  return (n || 0).toLocaleString('en-US');
}

export function formatContextLimitLabel(tokens) {
  if (!tokens || tokens <= 0) return '0k';
  if (tokens >= 1000000) {
    if (tokens === 1000000 || tokens === 1048576) return '1M';
    return (tokens / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M';
  }
  return Math.round(tokens / 1000) + 'k';
}

export function computeSegPcts(values, targetTotalPct = 100, minVisiblePct = 1.6) {
  const sum = values.reduce((acc, v) => acc + (v > 0 ? v : 0), 0);
  const clamped = Math.max(0, Math.min(100, targetTotalPct));
  if (sum <= 0 || clamped <= 0) return values.map(() => 0);
  const raw = values.map((v) => (v > 0 ? (v / sum) * clamped : 0));
  const nonZero = [];
  for (let i = 0; i < values.length; i++) if (values[i] > 0) nonZero.push(i);
  if (nonZero.length > 1 && clamped > minVisiblePct * nonZero.length) {
    let deficit = 0;
    let flex = 0;
    for (const i of nonZero) {
      if (raw[i] < minVisiblePct) {
        deficit += minVisiblePct - raw[i];
        raw[i] = minVisiblePct;
      } else {
        flex += raw[i] - minVisiblePct;
      }
    }
    if (deficit > 0 && flex > 0) {
      const ratio = Math.min(1, deficit / flex);
      for (const i of nonZero) {
        if (raw[i] > minVisiblePct) raw[i] -= (raw[i] - minVisiblePct) * ratio;
      }
    }
  }
  return raw.map((pct) => Number(pct.toFixed(1)));
}

export function buildStripHtml({
  telemetryLayout = 'compact',
  telemetryCacheMode = 'session',
  statusDotHtml,
  displayTps,
  ttft,
  lastCtx,
  limitKStr,
  ctxClass,
  ctxPct,
  compactedPending,
  outTok,
  lastCacheRate,
  sessionCacheRate,
  turnsCount = 0,
  stepsCount = 0,
  totalTokens = 0
}) {
  const gaugeSvg =
    '<svg class="ag-mg-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="8" cy="8.5" r="5.75" opacity="0.88"></circle>' +
    '<path d="M8 8.5L10.9 5.6"></path>' +
    '<circle cx="8" cy="8.5" r="0.8" fill="currentColor" stroke="none"></circle>' +
    '</svg>';

  const dbSvg =
    '<svg class="ag-mg-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<ellipse cx="8" cy="4.25" rx="4.75" ry="1.9"></ellipse>' +
    '<path d="M3.25 4.25v3.5c0 1.05 2.13 1.9 4.75 1.9s4.75-.85 4.75-1.9v-3.5"></path>' +
    '<path d="M3.25 7.75v3.5c0 1.05 2.13 1.9 4.75 1.9s4.75-.85 4.75-1.9v-3.5"></path>' +
    '</svg>';

  const pct = Math.max(0, Math.min(100, Number(ctxPct) || 0));
  const r = 5.2;
  const circ = 2 * Math.PI * r;
  const offset = (circ * (1 - pct / 100)).toFixed(2);
  const ringCls = compactedPending ? 'ag-mg-ctx-compacted' : ctxClass || '';
  const ringSvg =
    `<svg class="ag-mg-ico ag-mg-ring ${ringCls}" viewBox="0 0 16 16" fill="none" aria-hidden="true">` +
    `<circle cx="8" cy="8" r="${r}" stroke="currentColor" stroke-width="1.5" opacity="0.24"></circle>` +
    `<circle cx="8" cy="8" r="${r}" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-dasharray="${circ.toFixed(2)}" stroke-dashoffset="${offset}" transform="rotate(-90 8 8)"></circle>` +
    '</svg>';

  const rawCache = telemetryCacheMode === 'step' ? lastCacheRate : sessionCacheRate;
  const cacheInt = Number.isFinite(parseFloat(rawCache)) ? Math.round(parseFloat(rawCache)) : 0;
  const tokTotal = totalTokens > 0 ? totalTokens : lastCtx + outTok;
  const turnsLabel = turnsCount > 0 ? `${turnsCount} turns ${stepsCount} steps` : `${stepsCount} steps`;

  const ctxValHtml = compactedPending
    ? '<span class="ag-mg-ctx-compacted">Compacted</span>'
    : telemetryLayout === 'detailed'
    ? `<span>${fmtTok(lastCtx)}/${limitKStr} <span class="${ctxClass}">${pct}%</span></span>`
    : `<span class="${ctxClass}">${pct}%</span>`;

  const speedExtra = telemetryLayout === 'detailed' ? `<span class="ag-mg-sep">·</span><span>TTFT ${Number(ttft || 0).toFixed(1)}s</span>` : '';

  return (
    statusDotHtml +
    `<span class="ag-mg-group">${gaugeSvg}<span>${turnsLabel}</span><span class="ag-mg-sep">·</span><span>${Math.round(displayTps)} tok/s</span>${speedExtra}</span>` +
    `<span class="ag-mg-group">${dbSvg}<span>${fmtTok(tokTotal)} tok</span><span class="ag-mg-sep">·</span><span>Cache hit ${cacheInt}%</span></span>` +
    `<span class="ag-mg-group">${ringSvg}${ctxValHtml}</span>`
  );
}

export function buildPopoverHtml({
  genIdx,
  streamTps,
  e2eTps,
  streamTpsValid,
  last,
  lastCacheRate,
  ctxPct,
  contextLimitTokens,
  limitKStr,
  remainCtx,
  ctxBreakdown = null,
  compactedPending,
  compactSummaryKb,
  compactingNow,
  generatingPending,
  pendingRetrying,
  lastErrorMsg,
  turnSteps,
  turnOut,
  turnThink,
  turnResp,
  turnDur,
  userStepsCount,
  validCount,
  totalIn,
  totalCacheWrite,
  totalCache,
  totalPrompt,
  sessionCacheRate,
  totalOut,
  totalThink,
  totalResp
}) {
  const lvlCls = compactedPending ? '' : ctxPct >= 90 ? 'is-crit' : ctxPct >= 75 ? 'is-warn' : '';
  const mainTps = streamTpsValid ? streamTps : e2eTps;
  const speedSub = streamTpsValid ? `E2E ${e2eTps.toFixed(1)}` : 'E2E Avg';
  const hasCache = parseFloat(sessionCacheRate) > 0;
  const liveCls =
    lastErrorMsg && !compactingNow && !generatingPending && !pendingRetrying
      ? ' is-error'
      : pendingRetrying
      ? ' is-slow'
      : '';
  const liveTxt =
    lastErrorMsg && !compactingNow && !generatingPending && !pendingRetrying
      ? 'Error'
      : pendingRetrying
      ? 'Retrying…'
      : compactingNow
      ? 'Compacting…'
      : generatingPending
      ? 'Running…'
      : '';

  const ctxTargetPct = contextLimitTokens > 0 ? Math.min(100, (last.ctx / contextLimitTokens) * 100) : 0;
  const ctxFillPct = compactedPending ? 8 : Math.max(2, Number(ctxTargetPct.toFixed(1)));
  const turnsLabel = userStepsCount > 0 ? `${userStepsCount} turns · ` : '';

  let ctxTrackHtml = `<div class="mg-hairline-fill is-ctx" style="width:${ctxFillPct}%"></div>`;
  let ctxSubLeft = `${fmtTok(last.inTok)} new · ${lastCacheRate}% cached`;
  let ctxBreakdownRowsHtml = '';

  if (ctxBreakdown && !compactedPending) {
    const sysTok = (ctxBreakdown.system || 0) + (ctxBreakdown.rules || 0);
    const toolsTok = (ctxBreakdown.tools || 0) + (ctxBreakdown.mcp || 0);
    const skillsAgentsTok = (ctxBreakdown.skills || 0) + (ctxBreakdown.subagents || 0) + (ctxBreakdown.plugins || 0);
    const extTok = toolsTok + skillsAgentsTok;
    const msgTok = (ctxBreakdown.messages || 0) + (ctxBreakdown.other || 0);
    const [segSys, segExt, segMsg] = computeSegPcts([sysTok, extTok, msgTok], ctxFillPct, 1.4);
    ctxTrackHtml =
      (segSys > 0 ? `<div class="mg-hairline-seg is-sys" style="width:${segSys}%"></div>` : '') +
      (segExt > 0 ? `<div class="mg-hairline-seg is-ext" style="width:${segExt}%"></div>` : '') +
      (segMsg > 0 ? `<div class="mg-hairline-seg is-ctx" style="width:${segMsg}%"></div>` : '');
    const legParts = [];
    if (sysTok > 0) legParts.push(`<span class="mg-leg-it"><i class="mg-dot-s is-sys"></i>Sys ${fmtTok(sysTok)}</span>`);
    if (extTok > 0) legParts.push(`<span class="mg-leg-it"><i class="mg-dot-s is-ext"></i>Tools ${fmtTok(extTok)}</span>`);
    if (msgTok > 0) legParts.push(`<span class="mg-leg-it"><i class="mg-dot-s is-ctx"></i>Chat ${fmtTok(msgTok)}</span>`);
    if (legParts.length) ctxSubLeft = `<span class="mg-ctx-leg">${legParts.join('')}</span>`;

    const sysSub = [];
    if (ctxBreakdown.system > 0) sysSub.push(`Sys ${fmtTok(ctxBreakdown.system)}`);
    if (ctxBreakdown.rules > 0) sysSub.push(`Rules ${fmtTok(ctxBreakdown.rules)}`);

    const toolsSub = [];
    if (ctxBreakdown.toolCount > 0) toolsSub.push(`${ctxBreakdown.toolCount} tools`);
    if (ctxBreakdown.mcp > 0) toolsSub.push(`MCP ${fmtTok(ctxBreakdown.mcp)}`);

    const extSub = [];
    if (ctxBreakdown.skills > 0) extSub.push(`Skills ${fmtTok(ctxBreakdown.skills)}`);
    if (ctxBreakdown.subagents > 0) extSub.push(`Agents ${fmtTok(ctxBreakdown.subagents)}`);
    if (ctxBreakdown.plugins > 0) extSub.push(`Plugins ${fmtTok(ctxBreakdown.plugins)}`);

    const chatDirect = (ctxBreakdown.msgUser || 0) + (ctxBreakdown.msgAssistant || 0);
    const msgSub = [];
    if (chatDirect > 0) msgSub.push(`Chat ${fmtTok(chatDirect)}`);
    if (ctxBreakdown.msgToolOut > 0) msgSub.push(`Tools ${fmtTok(ctxBreakdown.msgToolOut)}`);
    if (ctxBreakdown.msgCheckpoint > 0) msgSub.push(`Ckpt ${fmtTok(ctxBreakdown.msgCheckpoint)}`);

    const rows = [];
    if (sysTok > 0) {
      rows.push(`<div class="mg-kv"><span class="mg-kv-k"><i class="mg-dot-s is-sys"></i>System &amp; Rules</span><span class="mg-kv-v"><strong>${fmtTok(sysTok)}</strong>${sysSub.length ? ` <span class="mg-kv-dim">(${sysSub.join(' · ')})</span>` : ''}</span></div>`);
    }
    if (toolsTok > 0) {
      rows.push(`<div class="mg-kv"><span class="mg-kv-k"><i class="mg-dot-s is-ext"></i>Tools &amp; MCP</span><span class="mg-kv-v"><strong>${fmtTok(toolsTok)}</strong>${toolsSub.length ? ` <span class="mg-kv-dim">(${toolsSub.join(' · ')})</span>` : ''}</span></div>`);
    }
    if (skillsAgentsTok > 0) {
      rows.push(`<div class="mg-kv"><span class="mg-kv-k"><i class="mg-dot-s is-ext"></i>Skills &amp; Agents</span><span class="mg-kv-v"><strong>${fmtTok(skillsAgentsTok)}</strong>${extSub.length ? ` <span class="mg-kv-dim">(${extSub.join(' · ')})</span>` : ''}</span></div>`);
    }
    if (msgTok > 0) {
      const msgLbl = ctxBreakdown.msgCount > 0 ? `Messages (${ctxBreakdown.msgCount})` : 'Messages';
      rows.push(`<div class="mg-kv"><span class="mg-kv-k"><i class="mg-dot-s is-ctx"></i>${msgLbl}</span><span class="mg-kv-v"><strong>${fmtTok(msgTok)}</strong>${msgSub.length ? ` <span class="mg-kv-dim">(${msgSub.join(' · ')})</span>` : ''}</span></div>`);
    }
    rows.push(`<div class="mg-kv"><span class="mg-kv-k">Prompt Cache</span><span class="mg-kv-v"><strong>${lastCacheRate}%</strong> <span class="mg-kv-dim">(${fmtTok(last.inTok)} new · ${fmtTok(last.cacheRead)} hit)</span></span></div>`);
    ctxBreakdownRowsHtml = `<div class="mg-l2-head">Context Window Breakdown</div><div class="mg-kv-list">${rows.join('')}</div><div class="mg-l2-sep"></div>`;
  }

  return `<div class="mg-pop-wrap ${lvlCls}">
    <div class="mg-pop-hdr">
      <span class="mg-pop-title">Session</span>
      <span class="mg-pop-badges">
        <span class="mg-live-chip${liveCls}">${liveTxt}</span>
        <span class="mg-chip">#${genIdx}</span>
      </span>
    </div>
    <div class="mg-wait-note" id="ag-mg-wait-note"></div>
    <div class="mg-stat-row">
      <div class="mg-stat-cell">
        <div class="mg-stat-lbl">Speed</div>
        <div class="mg-stat-val">${mainTps.toFixed(1)}<span class="mg-stat-unit">t/s</span></div>
        <div class="mg-stat-sub">${speedSub}</div>
      </div>
      <div class="mg-stat-cell">
        <div class="mg-stat-lbl">Context</div>
        <div class="mg-stat-val is-ctx">${compactedPending ? 'Compacted' : `${ctxPct}%`}</div>
        <div class="mg-stat-sub">${compactedPending ? 'Next turn' : `${fmtTok(remainCtx)} left`}</div>
      </div>
      <div class="mg-stat-cell">
        <div class="mg-stat-lbl">Cache</div>
        <div class="mg-stat-val${hasCache ? ' is-accent' : ''}">${sessionCacheRate}%</div>
        <div class="mg-stat-sub">Step ${lastCacheRate}%</div>
      </div>
    </div>
    <div class="mg-meter">
      <div class="mg-meter-top">
        <span class="mg-meter-name">Context Window</span>
        <span class="mg-meter-val">${compactedPending ? `<strong>Compacted</strong>${compactSummaryKb > 0 ? ` · ${compactSummaryKb} KB` : ''}` : `<strong>${fmtTok(last.ctx)}</strong> / ${limitKStr}`}</span>
      </div>
      <div class="mg-hairline-track">${ctxTrackHtml}</div>
      <div class="mg-meter-sub">
        <span>${ctxSubLeft}</span>
        <span>${fmtTok(remainCtx)} left</span>
      </div>
    </div>
    <div class="mg-l2">
      ${ctxBreakdownRowsHtml}
      <div class="mg-kv-list">
        <div class="mg-kv">
          <span class="mg-kv-k">Latency</span>
          <span class="mg-kv-v"><strong>${last.totDur.toFixed(2)}s</strong> <span class="mg-kv-dim">(${last.ttft.toFixed(1)}s TTFT · ${last.stream.toFixed(1)}s stream)</span></span>
        </div>
        <div class="mg-kv">
          <span class="mg-kv-k">Latest Step</span>
          <span class="mg-kv-v"><strong>${fmtNum(last.outTok)}</strong> <span class="mg-kv-dim">(${fmtTok(last.thinkTok)} think · ${fmtTok(last.respTok)} resp)</span></span>
        </div>
        <div class="mg-kv">
          <span class="mg-kv-k">Total Input</span>
          <span class="mg-kv-v"><strong>${fmtTok(totalPrompt)}</strong> <span class="mg-kv-dim">(${fmtTok(totalIn)} new · ${sessionCacheRate}% cached)</span></span>
        </div>
        <div class="mg-kv">
          <span class="mg-kv-k">Total Output</span>
          <span class="mg-kv-v"><strong>${fmtTok(totalOut)}</strong> <span class="mg-kv-dim">(${fmtTok(totalThink)} think · ${fmtTok(totalResp)} resp)</span></span>
        </div>
      </div>
      <div class="mg-l2-foot">
        <span class="mg-footer-sum">${turnsLabel}${validCount} calls · ${turnDur.toFixed(1)}s</span>
        <button type="button" class="mg-btn-toggle">Less ▴</button>
      </div>
    </div>
    <div class="mg-footer">
      <span class="mg-footer-sum">${turnsLabel}${validCount} calls · ${turnDur.toFixed(1)}s</span>
      <button type="button" class="mg-btn-toggle">Details ▾</button>
    </div>
  </div>`;
}

export function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatTurnModelName(gens) {
  const models = [];
  for (let i = 0; i < gens.length; i++) {
    const m = gens[i].modelName;
    if (m && !models.includes(m)) models.push(m);
  }
  if (models.length === 0) return '';
  if (models.length === 1) return models[0];
  const first = models[0];
  let last = models[models.length - 1];
  if (/^Orchestrator\b/i.test(first)) last = last.replace(/\s*\(Orchestrator\)\s*$/i, '').trim();
  return last && last !== first ? `${first} → ${last}` : first;
}

export function buildTurnSummaries(valid, userStepIdxs, manualLim, fallbackLim) {
  if (!valid || valid.length === 0 || !valid.some((it) => it.maxStepIdx >= 0)) return [];
  const buckets = new Map();
  for (let i = 0; i < valid.length; i++) {
    const item = valid[i];
    const si = item.maxStepIdx;
    if (si < 0) continue;
    let lo = 0, hi = userStepIdxs.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (userStepIdxs[mid] <= si) { found = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    const key = found >= 0 ? found : -1;
    let arr = buckets.get(key);
    if (!arr) { arr = []; buckets.set(key, arr); }
    arr.push(item);
  }
  const keys = Array.from(buckets.keys()).sort((a, b) => a - b);
  const turns = [];
  for (const k of keys) {
    const gens = buckets.get(k);
    if (!gens || !gens.length) continue;
    const startStepIdx = k >= 0 ? userStepIdxs[k] : -1;
    const nextUserStep = k + 1 < userStepIdxs.length ? userStepIdxs[k + 1] : Infinity;
    const endStepIdx = Number.isFinite(nextUserStep) ? nextUserStep - 1 : -1;
    let inTok = 0, cacheWrite = 0, cacheRead = 0, outTok = 0, thinkTok = 0, respTok = 0, stream = 0, totDur = 0, nativeMax = 0;
    for (const g of gens) {
      inTok += g.inTok; cacheWrite += g.cacheWrite; cacheRead += g.cacheRead;
      outTok += g.outTok; thinkTok += g.thinkTok; respTok += g.respTok;
      stream += g.stream; totDur += g.totDur;
      if (g.maxCtx > 0) nativeMax = g.maxCtx;
    }
    const lastG = gens[gens.length - 1];
    const lastCtx = lastG.ctx;
    const contextLimit = manualLim > 0 ? manualLim : nativeMax > 0 ? nativeMax : fallbackLim;
    const streamTps = stream >= 0.12 ? outTok / stream : 0;
    const e2eTps = totDur > 0 ? outTok / totDur : 0;
    const tps = Math.round(streamTps > 0 && streamTps <= 3000 ? streamTps : e2eTps);
    const promptTok = inTok + cacheWrite + cacheRead;
    const model = formatTurnModelName(gens);
    const cacheRate = promptTok > 0 ? ((cacheRead / promptTok) * 100).toFixed(1) + '%' : '0.0%';
    turns.push({
      turnIndex: k >= 0 ? k + 1 : 0,
      startStepIdx,
      endStepIdx,
      minGenIdx: gens[0].idx,
      maxGenIdx: lastG.idx,
      steps: gens.length,
      model,
      lastCtx,
      ctxStr: fmtTok(lastCtx),
      promptTok,
      promptStr: fmtTok(promptTok),
      outTok,
      outStr: fmtTok(outTok),
      inTok,
      cacheWrite,
      cacheRead,
      thinkTok,
      respTok,
      streamDur: Number(stream.toFixed(1)),
      totDur: Number(totDur.toFixed(1)),
      tps,
      e2eTps: Number(e2eTps.toFixed(1)),
      contextLimit,
      limitStr: formatContextLimitLabel(contextLimit),
      ctxPct: Math.round((lastCtx / contextLimit) * 100),
      cacheRate
    });
  }
  return turns;
}
