(function () {
  const SHEET_ID = "1-l0LXj6Mt7e73YdWcLGqRRLwR34GtrbnBWo6e-O3_qM";
  const GID = "0";
  const PUBLISHED_ID = "2PACX-1vRy-PgUzwkSJEPM7qGAou8yec7HoLZ3N31rTmtyzK6CIl5U0VQqjFh-nD9kfy8MlNGY2LyUSKUdYNYD";
  const PUBLISHED_GVIZ_URL = `https://docs.google.com/spreadsheets/d/e/${PUBLISHED_ID}/gviz/tq?gid=${GID}`;
  const DIRECT_GVIZ_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?gid=${GID}`;
  const PUBLISHED_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRy-PgUzwkSJEPM7qGAou8yec7HoLZ3N31rTmtyzK6CIl5U0VQqjFh-nD9kfy8MlNGY2LyUSKUdYNYD/pub?gid=0&single=true&output=csv";
  const LOCAL_CSV_PATH = "shop-risk-data.csv";
  const REFRESH_MS = 15 * 60 * 1000;
  const TIERS = ["Small", "Medium", "Large"];
  const STATUS_ORDER = ["Green", "Yellow", "Orange", "Red", "No Revenue Activity", "Insufficient Data"];
  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const COLORS = ["#276d9f", "#1f8a5f", "#c65f18", "#7b5fb2", "#bd2d2d", "#17858f", "#8a6d1f", "#48545c"];

  const columnAliases = {
    shop: ["Shop_Name", "Shop Name", "Shop", "Location", "ShopName"],
    task: ["Task_Association", "Task Association", "Task", "Campaign"],
    date: ["Date_Time_Stamp", "Date Time Stamp", "Date", "Timestamp", "Created At"],
    answered: ["Answered", "Answer", "Call Outcome", "Outcome"],
    ro: ["Posted_RO_IDs", "Posted RO IDs", "Posted RO ID", "RO ID", "Repair Order ID"],
    revenue: ["Revenue_Total_", "Revenue Total", "Revenue_Total", "Revenue", "Revenue Total $"]
  };

  const state = {
    rows: [],
    columns: [],
    mapping: {},
    diagnostics: [],
    sort: {}
  };

  const $ = (id) => document.getElementById(id);

  document.addEventListener("DOMContentLoaded", () => {
    $("refreshBtn").addEventListener("click", loadSheet);
    $("csvInput").addEventListener("change", handleCsvUpload);
    ["anchorDate", "recentWeeks", "baselineWeeks", "weakThreshold"].forEach((id) => {
      $(id).addEventListener("change", () => renderAll());
    });
    $("anchorDate").valueAsDate = localDate(new Date());
    loadSheet();
    window.setInterval(loadSheet, REFRESH_MS);
  });

  async function loadSheet() {
    setStatus("Loading latest Google Sheet data...", false);
    const attempts = [
      {
        name: "Published Google Sheet",
        load: () => loadGoogleSheet(PUBLISHED_GVIZ_URL, "published Google Sheet")
      },
      {
        name: "Shared Google Sheet",
        load: () => loadGoogleSheet(DIRECT_GVIZ_URL, "shared Google Sheet")
      },
      {
        name: "Published Google Sheet CSV",
        load: () => loadPublishedCsv()
      },
      {
        name: LOCAL_CSV_PATH,
        load: () => loadLocalCsv()
      }
    ];
    const failures = [];

    for (const attempt of attempts) {
      try {
        const parsed = await attempt.load();
        ingestRows(parsed.rows, parsed.columns, attempt.name, failures.map((failure) => `${failure.name} failed: ${failure.message}`));
        return;
      } catch (error) {
        failures.push({ name: attempt.name, message: error.message });
      }
    }

    setStatus("No live data loaded. Check the published Google Sheet URL or place shop-risk-data.csv next to this dashboard.", true);
    state.diagnostics = [
      ...failures.map((failure) => `${failure.name} failed: ${failure.message}`),
      `Expected local daily CSV path: ${LOCAL_CSV_PATH}`
    ];
    $("diagnostics").textContent = state.diagnostics.join("\n");
  }

  async function loadPublishedCsv() {
    setStatus("Loading latest published Google Sheet CSV...", false);
    const response = await fetch(`${PUBLISHED_CSV_URL}&cacheBust=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Published CSV returned ${response.status}.`);
    const text = await response.text();
    if (!text.trim()) throw new Error("Published CSV response was empty.");
    if (/^\s*</.test(text)) throw new Error("Published CSV returned HTML instead of CSV.");
    return parseCsv(text);
  }

  function loadGoogleSheet(baseUrl, label) {
    return new Promise((resolve, reject) => {
      setStatus(`Loading latest data from ${label}...`, false);
      const callbackName = "__shopRiskSheet_" + Date.now();
      const script = document.createElement("script");
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error(`${label} did not respond within 12 seconds.`));
      }, 12000);

      window[callbackName] = (payload) => {
        cleanup();
        try {
          resolve(parseGooglePayload(payload));
        } catch (error) {
          reject(error);
        }
      };

      script.onerror = () => {
        cleanup();
        reject(new Error(`Could not load ${label}. The sheet may be private or blocked.`));
      };

      script.src = `${baseUrl}&tqx=responseHandler:${callbackName};out:json&cacheBust=${Date.now()}`;
      document.head.appendChild(script);

      function cleanup() {
        window.clearTimeout(timeout);
        delete window[callbackName];
        script.remove();
      }
    });
  }

  async function loadLocalCsv() {
    const response = await fetch(`${LOCAL_CSV_PATH}?cacheBust=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load ${LOCAL_CSV_PATH} (${response.status}).`);
    const text = await response.text();
    if (!text.trim()) throw new Error(`${LOCAL_CSV_PATH} is empty.`);
    return parseCsv(text);
  }

  function handleCsvUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCsv(String(reader.result || ""));
      ingestRows(parsed.rows, parsed.columns, file.name);
    };
    reader.readAsText(file);
  }

  function ingestRows(rawRows, columns, sourceName, prependedDiagnostics = []) {
    state.columns = columns;
    state.mapping = mapColumns(columns);
    state.diagnostics = [...prependedDiagnostics];
    const missing = Object.entries(state.mapping).filter(([, value]) => !value).map(([key]) => key);
    if (missing.length) {
      state.diagnostics.push(`Missing expected columns: ${missing.join(", ")}`);
    }
    state.diagnostics.push("Matched columns:");
    Object.entries(state.mapping).forEach(([key, value]) => state.diagnostics.push(`  ${key}: ${value || "not found"}`));

    state.rows = rawRows.map(normalizeRow).filter((row) => row.shop && row.date);
    const badDateCount = rawRows.length - state.rows.length;
    if (badDateCount > 0) state.diagnostics.push(`${badDateCount} rows skipped because shop or date was missing/unparseable.`);

    setStatus(`Loaded ${state.rows.length.toLocaleString()} usable rows from ${sourceName}.`, false);
    $("lastUpdated").textContent = `Last refresh ${new Date().toLocaleString()}`;
    renderAll();
  }

  function parseGooglePayload(payload) {
    if (!payload || payload.status === "error") {
      const message = payload?.errors?.map((e) => e.detailed_message || e.message).join("; ") || "Google returned an error.";
      throw new Error(message);
    }
    const table = payload.table;
    const columns = table.cols.map((col, index) => col.label || col.id || `Column ${index + 1}`);
    const rows = table.rows.map((row) => {
      const out = {};
      columns.forEach((column, index) => {
        const cell = row.c[index];
        out[column] = cell ? cell.f || cell.v || "" : "";
      });
      return out;
    });
    return { columns, rows };
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      const next = text[i + 1];
      if (ch === '"' && quoted && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = !quoted;
      } else if (ch === "," && !quoted) {
        row.push(cell);
        cell = "";
      } else if ((ch === "\n" || ch === "\r") && !quoted) {
        if (ch === "\r" && next === "\n") i += 1;
        row.push(cell);
        if (row.some((value) => value.trim() !== "")) rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += ch;
      }
    }
    row.push(cell);
    if (row.some((value) => value.trim() !== "")) rows.push(row);
    const columns = rows.shift() || [];
    return {
      columns,
      rows: rows.map((values) => Object.fromEntries(columns.map((column, index) => [column, values[index] || ""])))
    };
  }

  function mapColumns(columns) {
    const normalized = new Map(columns.map((column) => [cleanName(column), column]));
    return Object.fromEntries(Object.entries(columnAliases).map(([key, aliases]) => {
      const found = aliases.find((alias) => normalized.has(cleanName(alias)));
      return [key, found ? normalized.get(cleanName(found)) : ""];
    }));
  }

  function normalizeRow(row) {
    const get = (key) => row[state.mapping[key]] ?? "";
    return {
      shop: String(get("shop")).trim(),
      task: String(get("task")).trim(),
      date: parseDate(get("date")),
      answered: String(get("answered")).trim(),
      ro: String(get("ro")).trim(),
      revenue: parseMoney(get("revenue"))
    };
  }

  function renderAll() {
    if (!state.rows.length) return;
    const anchor = parseDate($("anchorDate").value) || localDate(new Date());
    const currentStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const nextMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
    const rollingStart = new Date(anchor);
    rollingStart.setMonth(rollingStart.getMonth() - 6);
    rollingStart.setDate(rollingStart.getDate() + 1);

    const tierMap = deriveSizeTiers(filterRows(rollingStart, addDays(anchor, 1)));
    const rolling = computeWindow("Rolling 6M", rollingStart, addDays(anchor, 1), tierMap);
    const current = computeWindow("Current Month", currentStart, nextMonth, tierMap);
    const decline = computeDeclines(anchor);
    const currentByShop = new Map(current.metrics.map((item) => [item.shop, item]));
    const rollingByShop = new Map(rolling.metrics.map((item) => [item.shop, item]));

    current.metrics.forEach((item) => {
      const base = rollingByShop.get(item.shop);
      item.compositeDelta = item.composite != null && base?.composite != null ? item.composite - base.composite : null;
      item.decline = decline.get(item.shop) || null;
    });
    rolling.metrics.forEach((item) => {
      const now = currentByShop.get(item.shop);
      item.compositeDelta = now?.composite != null && item.composite != null ? now.composite - item.composite : null;
      item.decline = decline.get(item.shop) || null;
    });

    $("currentMonthNote").textContent = `Current month: ${formatDate(currentStart)} through ${formatDate(addDays(nextMonth, -1))}; rolling window: ${formatDate(rollingStart)} through ${formatDate(anchor)}.`;
    $("windowLabel").textContent = `${formatDate(currentStart)} current month; ${formatDate(rollingStart)} to ${formatDate(anchor)} rolling window`;
    renderSummary(rolling, decline);
    renderDecliningList(decline);
    renderPeerRiskTables(current.metrics, rolling.metrics);
    renderTrends(anchor, tierMap);
    renderDiagnostics(current, rolling, tierMap);
  }

  function deriveSizeTiers(rows) {
    const counts = countByShop(rows);
    const sorted = [...counts.entries()].sort((a, b) => a[1] - b[1]);
    const tierMap = new Map();
    sorted.forEach(([shop], index) => {
      const pct = sorted.length <= 1 ? 1 : index / sorted.length;
      tierMap.set(shop, pct < 1 / 3 ? "Small" : pct < 2 / 3 ? "Medium" : "Large");
    });
    return tierMap;
  }

  function computeWindow(label, start, end, tierMap) {
    const rows = filterRows(start, end);
    const shops = new Set([...tierMap.keys(), ...rows.map((row) => row.shop)]);
    const baseMetrics = [...shops].map((shop) => {
      const shopRows = rows.filter((row) => row.shop === shop);
      const uniqueRevenue = dedupedRevenue(shopRows);
      const calls = shopRows.length;
      const human = shopRows.filter((row) => row.answered.toLowerCase() === "human").length;
      return {
        shop,
        tier: tierMap.get(shop) || "Small",
        calls,
        human,
        connectRate: calls ? human / calls : null,
        revenue: uniqueRevenue.total,
        revenueRecords: uniqueRevenue.count,
        revenuePerCall: calls ? uniqueRevenue.total / calls : null
      };
    });

    TIERS.forEach((tier) => {
      const peers = baseMetrics.filter((item) => item.tier === tier);
      assignZ(peers, "connectRate", "connectZ");
      assignZ(peers, "revenuePerCall", "revenueZ");
    });

    baseMetrics.forEach((item) => {
      item.composite = item.connectZ == null || item.revenueZ == null ? null : (item.connectZ + item.revenueZ) / 2;
      item.status = riskStatus(item);
    });

    return { label, start, end, rows, metrics: baseMetrics };
  }

  function assignZ(items, sourceKey, targetKey) {
    const values = items.map((item) => item[sourceKey]).filter((value) => Number.isFinite(value));
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length;
    const sd = Math.sqrt(variance);
    items.forEach((item) => {
      item[targetKey] = values.length >= 2 && sd > 0 && Number.isFinite(item[sourceKey]) ? (item[sourceKey] - mean) / sd : null;
    });
  }

  function riskStatus(item) {
    if (item.revenueRecords === 0) return "No Revenue Activity";
    if (item.connectZ == null || item.revenueZ == null || item.composite == null) return "Insufficient Data";
    if (item.connectZ < 0 && item.revenueZ < 0 && item.composite <= -0.5) return "Red";
    if (item.connectZ <= -1.5 || item.revenueZ <= -1.5) return "Orange";
    if (item.composite < 0) return "Yellow";
    return "Green";
  }

  function computeDeclines(anchor) {
    const recentWeeks = clamp(Number($("recentWeeks").value) || 4, 2, 12);
    const baselineWeeks = clamp(Number($("baselineWeeks").value) || 8, 4, 24);
    const threshold = Number($("weakThreshold").value) || -0.25;
    const weekStart = startOfWeek(anchor);
    const shops = [...new Set(state.rows.map((row) => row.shop))];
    const output = new Map();

    shops.forEach((shop) => {
      const weekly = [];
      for (let offset = recentWeeks - 1; offset >= 0; offset -= 1) {
        const start = addDays(weekStart, -7 * offset);
        const end = addDays(start, 7);
        const baselineStart = addDays(start, -7 * baselineWeeks);
        const baselineRows = state.rows.filter((row) => row.shop === shop && row.date >= baselineStart && row.date < start);
        const weekRows = state.rows.filter((row) => row.shop === shop && row.date >= start && row.date < end);
        const weekScore = selfComposite(weekRows);
        const baselineScore = selfComposite(baselineRows);
        weekly.push({
          start,
          score: weekScore,
          baseline: baselineScore,
          delta: weekScore != null && baselineScore != null ? weekScore - baselineScore : null
        });
      }
      let consecutive = 0;
      for (let i = weekly.length - 1; i >= 0; i -= 1) {
        if (weekly[i].delta != null && weekly[i].delta <= threshold) consecutive += 1;
        else break;
      }
      if (consecutive >= 2) {
        output.set(shop, { shop, consecutive, weeks: weekly, latestDelta: weekly[weekly.length - 1].delta });
      }
    });
    return output;
  }

  function selfComposite(rows) {
    if (!rows.length) return null;
    const connect = rows.filter((row) => row.answered.toLowerCase() === "human").length / rows.length;
    const revenue = dedupedRevenue(rows).total / rows.length;
    const revenueScale = Math.log1p(Math.max(0, revenue));
    return connect + revenueScale / 10;
  }

  function renderSummary(rolling, decline) {
    const valid = rolling.metrics.filter((item) => item.status !== "Insufficient Data" && item.status !== "No Revenue Activity");
    const atOrAbove = valid.filter((item) => item.status === "Green" || item.status === "Yellow").length;
    const avgAbs = valid.length ? valid.reduce((sum, item) => sum + Math.abs(item.composite || 0), 0) / valid.length : null;
    $("peerShare").textContent = valid.length ? pct(atOrAbove / valid.length) : "--";
    $("avgAbsDeviation").textContent = avgAbs == null ? "--" : fmt(avgAbs);
    $("decliningCount").textContent = decline.size;
    $("rowsLoaded").textContent = state.rows.length.toLocaleString();

    const counts = Object.fromEntries(STATUS_ORDER.map((status) => [status, 0]));
    rolling.metrics.forEach((item) => counts[item.status] += 1);
    $("greenCount").textContent = counts.Green;
    $("yellowCount").textContent = counts.Yellow;
    $("orangeCount").textContent = counts.Orange;
    $("redCount").textContent = counts.Red;
    $("noRevenueCount").textContent = counts["No Revenue Activity"];
    $("insufficientCount").textContent = counts["Insufficient Data"];
  }

  function renderDecliningList(decline) {
    const target = $("decliningList");
    const items = [...decline.values()].sort((a, b) => b.consecutive - a.consecutive || (a.latestDelta || 0) - (b.latestDelta || 0));
    if (!items.length) {
      target.innerHTML = '<p class="empty">No shops currently meet the 2+ consecutive weak-week rule.</p>';
      return;
    }
    target.innerHTML = items.map((item) => `
      <article class="declineCard">
        <strong>${escapeHtml(item.shop)}</strong>
        <span>${item.consecutive} consecutive weak weeks</span>
        <span>Latest self-relative delta: ${fmt(item.latestDelta)}</span>
      </article>
    `).join("");
  }

  function renderPeerRiskTables(currentMetrics, rollingMetrics) {
    const container = $("peerRiskTables");
    container.innerHTML = TIERS.map((tier) => {
      const currentContainerId = `currentTables-${tier}`;
      const rollingContainerId = `rollingTables-${tier}`;
      const currentRows = sortRows(currentContainerId, currentMetrics.filter((item) => item.tier === tier));
      const rollingRows = sortRows(rollingContainerId, rollingMetrics.filter((item) => item.tier === tier));
      return `
        <div class="tierBlock">
          <div class="tierTitle"><span>${tier} shops</span><span>${Math.max(currentRows.length, rollingRows.length)} shops</span></div>
          <div class="peerRiskGrid">
            <div class="peerRiskColumn" data-table-id="${currentContainerId}">
              <h3>Current Month</h3>
              ${currentRows.length ? tableHtml(currentContainerId, currentRows) : '<p class="empty">No shops in this tier.</p>'}
            </div>
            <div class="peerRiskColumn" data-table-id="${rollingContainerId}">
              <h3>Rolling 6-Month</h3>
              ${rollingRows.length ? tableHtml(rollingContainerId, rollingRows) : '<p class="empty">No shops in this tier.</p>'}
            </div>
          </div>
        </div>
      `;
    }).join("");
    container.querySelectorAll(".peerRiskColumn th[data-key]").forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.getAttribute("data-key");
        const containerId = th.closest(".peerRiskColumn").getAttribute("data-table-id");
        const current = state.sort[containerId] || {};
        state.sort[containerId] = { key, dir: current.key === key && current.dir === "asc" ? "desc" : "asc" };
        renderPeerRiskTables(currentMetrics, rollingMetrics);
      });
    });
  }

  function tableHtml(containerId, rows) {
    const headers = [
      ["shop", "Shop"], ["status", "Risk"], ["calls", "Calls"], ["connectRate", "Connect Rate"],
      ["connectZ", "Connect Z"], ["revenue", "Revenue"], ["revenuePerCall", "Rev / Call"],
      ["revenueZ", "Revenue Z"], ["composite", "Composite"], ["compositeDelta", "Current - 6M"],
      ["decline", "Decline"]
    ];
    return `
      <div class="tableWrap">
        <table>
          <thead><tr>${headers.map(([key, label]) => `<th data-key="${key}">${label}</th>`).join("")}</tr></thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td>${escapeHtml(row.shop)}</td>
                <td><span class="status ${statusClass(row.status)}">${row.status}</span></td>
                <td>${row.calls.toLocaleString()}</td>
                <td>${row.connectRate == null ? "--" : pct(row.connectRate)}</td>
                <td>${fmt(row.connectZ)}</td>
                <td>${money(row.revenue)}</td>
                <td>${money(row.revenuePerCall)}</td>
                <td>${fmt(row.revenueZ)}</td>
                <td>${fmt(row.composite)}</td>
                <td class="delta ${row.compositeDelta < 0 ? "down" : row.compositeDelta > 0 ? "up" : ""}">${fmt(row.compositeDelta)}</td>
                <td>${row.decline ? `${row.decline.consecutive} wks` : "--"}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function sortRows(containerId, rows) {
    const sort = state.sort[containerId] || { key: "composite", dir: "asc" };
    const direction = sort.dir === "asc" ? 1 : -1;
    return rows.sort((a, b) => compareValue(a[sort.key], b[sort.key]) * direction);
  }

  function renderTrends(anchor, tierMap) {
    const months = [];
    for (let i = 5; i >= 0; i -= 1) {
      months.push(new Date(anchor.getFullYear(), anchor.getMonth() - i, 1));
    }
    const monthly = months.map((start) => {
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
      return computeWindow("Trend", start, end, tierMap);
    });
    const target = $("trendCharts");
    target.innerHTML = TIERS.map((tier, index) => `
      <div class="chartBlock">
        <h3>${tier}</h3>
        <canvas id="chart${index}" width="1200" height="320"></canvas>
      </div>
    `).join("");
    TIERS.forEach((tier, index) => drawTierChart($(`chart${index}`), tier, months, monthly));
  }

  function drawTierChart(canvas, tier, months, monthly) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    const pad = { left: 48, right: 18, top: 18, bottom: 34 };
    const valuesByShop = new Map();
    monthly.forEach((windowMetrics, monthIndex) => {
      windowMetrics.metrics.filter((item) => item.tier === tier && item.composite != null).forEach((item) => {
        if (!valuesByShop.has(item.shop)) valuesByShop.set(item.shop, Array(months.length).fill(null));
        valuesByShop.get(item.shop)[monthIndex] = item.composite;
      });
    });
    const shops = [...valuesByShop.keys()].slice(0, 8);
    const allValues = shops.flatMap((shop) => valuesByShop.get(shop)).filter((value) => value != null);
    const min = Math.min(-2, ...allValues);
    const max = Math.max(2, ...allValues);
    const x = (i) => pad.left + (i / Math.max(1, months.length - 1)) * (w - pad.left - pad.right);
    const y = (value) => pad.top + ((max - value) / (max - min || 1)) * (h - pad.top - pad.bottom);

    ctx.strokeStyle = "#d9e0e4";
    ctx.lineWidth = 1;
    [-1, 0, 1].forEach((tick) => {
      ctx.beginPath();
      ctx.moveTo(pad.left, y(tick));
      ctx.lineTo(w - pad.right, y(tick));
      ctx.stroke();
      ctx.fillStyle = "#65717b";
      ctx.fillText(String(tick), 10, y(tick) + 4);
    });

    shops.forEach((shop, index) => {
      const vals = valuesByShop.get(shop);
      ctx.strokeStyle = COLORS[index % COLORS.length];
      ctx.lineWidth = 2;
      ctx.beginPath();
      vals.forEach((value, i) => {
        if (value == null) return;
        if (i === vals.findIndex((v) => v != null)) ctx.moveTo(x(i), y(value));
        else ctx.lineTo(x(i), y(value));
      });
      ctx.stroke();
    });

    ctx.fillStyle = "#47535c";
    ctx.font = "12px Segoe UI, Arial";
    months.forEach((month, i) => ctx.fillText(`${MONTH_NAMES[month.getMonth()]} ${String(month.getFullYear()).slice(2)}`, x(i) - 20, h - 10));
    if (!shops.length) {
      ctx.fillStyle = "#65717b";
      ctx.fillText("No composite trend data for this tier.", pad.left, 44);
    }
  }

  function renderDiagnostics(current, rolling, tierMap) {
    const tierCounts = countValues([...tierMap.values()]);
    const lines = [
      ...state.diagnostics,
      "",
      `Rows in current-month window: ${current.rows.length}`,
      `Rows in rolling-6-month window: ${rolling.rows.length}`,
      `Size-tier shop counts: ${JSON.stringify(tierCounts)}`,
      "Risk priority: No Revenue Activity > Insufficient Data > Red > Orange > Yellow > Green",
      "Composite is null when either z-score is undefined."
    ];
    $("diagnostics").textContent = lines.join("\n");
  }

  function filterRows(start, end) {
    return state.rows.filter((row) => row.date >= start && row.date < end);
  }

  function countByShop(rows) {
    const counts = new Map();
    rows.forEach((row) => counts.set(row.shop, (counts.get(row.shop) || 0) + 1));
    return counts;
  }

  function dedupedRevenue(rows) {
    const seen = new Set();
    let total = 0;
    let count = 0;
    rows.forEach((row) => {
      if (!row.ro || seen.has(row.ro)) return;
      seen.add(row.ro);
      total += row.revenue || 0;
      count += 1;
    });
    return { total, count };
  }

  function parseDate(value) {
    if (value instanceof Date) return localDate(value);
    const text = String(value || "").trim();
    if (!text) return null;
    const gviz = text.match(/^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)$/);
    if (gviz) return new Date(Number(gviz[1]), Number(gviz[2]), Number(gviz[3]), Number(gviz[4] || 0), Number(gviz[5] || 0), Number(gviz[6] || 0));
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function parseMoney(value) {
    const number = Number(String(value || "").replace(/[$,\s]/g, ""));
    return Number.isFinite(number) ? number : 0;
  }

  function cleanName(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function localDate(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function startOfWeek(date) {
    const out = localDate(date);
    out.setDate(out.getDate() - out.getDay());
    return out;
  }

  function addDays(date, days) {
    const out = new Date(date);
    out.setDate(out.getDate() + days);
    return out;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function setStatus(message, isError) {
    $("sourceStatus").textContent = message;
    $("statusBand").classList.toggle("error", Boolean(isError));
  }

  function fmt(value) {
    return value == null || !Number.isFinite(value) ? "--" : value.toFixed(2);
  }

  function pct(value) {
    return value == null || !Number.isFinite(value) ? "--" : `${(value * 100).toFixed(1)}%`;
  }

  function money(value) {
    return value == null || !Number.isFinite(value) ? "--" : value.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  }

  function formatDate(date) {
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  function compareValue(a, b) {
    if (a && typeof a === "object") a = a.consecutive || 0;
    if (b && typeof b === "object") b = b.consecutive || 0;
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    if (typeof a === "number" && typeof b === "number") return a - b;
    return String(a).localeCompare(String(b));
  }

  function statusClass(status) {
    if (status === "Green") return "green";
    if (status === "Yellow") return "yellow";
    if (status === "Orange") return "orange";
    if (status === "Red") return "red";
    return "neutral";
  }

  function countValues(values) {
    return values.reduce((acc, value) => {
      acc[value] = (acc[value] || 0) + 1;
      return acc;
    }, {});
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[char]);
  }
})();
