import React, { useState, useMemo, useEffect } from "react";
import * as XLSX from "xlsx";

// ─── Font Injection ───────────────────────────────────────────────────────────
function useFonts() {
  useEffect(() => {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href =
      "https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Rajdhani:wght@500;700&display=swap";
    document.head.appendChild(l);
  }, []);
}

// ─── Physics Engine (V9 - Configurable Chamber Volume) ────────────────────────
function compute(v) {
  const G = 1.882,
    A = 1.204,
    HV = 46400,
    SR = 15.67,
    EX = 3.8,
    CA = 0.72;

  // 1. Gas Jet
  const pPa = v.p_gas * 6894.76;
  const rN = v.d_noz / 1000 / 2,
    aN = Math.PI * rN ** 2;
  const rg = G * (273.15 / (273.15 + v.amb_temp));
  const ra = A * (273.15 / (273.15 + v.amb_temp));
  const mG = v.cd * aN * Math.sqrt(2 * rg * pPa);
  const vG = aN > 0 ? mG / (rg * aN) : 0;

  // 2. Venturi Entrainment
  const rT = v.d_thr / 1000 / 2,
    aT = Math.PI * rT ** 2;
  const rAir = v.d_air_in / 1000 / 2,
    aAir = Math.PI * rAir ** 2 * v.n_air_in;
  const aRat = aN > 0 ? aT / aN : 0;

  const eB = ((CA * aAir) / aT) * Math.sqrt(ra / rg);
  const rR = (v.m_eff / 100) * eB * Math.cos(Math.PI / 4) * 28.5;
  const mA = mG * rR,
    volA = mA / ra;

  // 3. Tube Dynamics & Exact Volumes
  const vMC = mG / rg + volA;
  const vTS = aT > 0 ? vMC / aT : 0;

  const aBody = Math.PI * (v.body_id / 1000 / 2) ** 2;
  const vBS = aBody > 0 ? vMC / aBody : 0; // Decelerated velocity in main body

  // Convert exact user-defined Chamber Volume from cm³ to m³
  const volCham = v.cham_vol / 1e6;
  const volThr = aT * (v.thr_len / 1000);
  const volBody = aBody * (v.body_len / 1000);

  const volTotM3 = volCham + volThr + volBody;
  const tRes = vMC > 0 ? (volTotM3 / vMC) * 1000 : 0;

  // 4. Combustion Limits
  const afr = mG > 0 ? mA / mG : 0;
  const phi = afr > 0 ? SR / afr : 0;
  const combOK = phi >= 0.5 && phi <= 2.8;

  let tF = v.amb_temp;
  if (combOK) {
    tF = 1980 * (1 - 0.3 * Math.abs(1 - phi) ** 1.2);
    tF = Math.max(v.amb_temp, Math.min(1980, tF));
  }

  // 5. Exit Ports
  const nP = Math.round(v.rows) * Math.round(v.hpr);
  const rP = v.d_port / 1000 / 2,
    aP = Math.PI * rP ** 2 * Math.max(nP, 1);
  const expF = tF > 300 ? EX * (tF / 1980) : 1;
  const vEx = aP > 0 ? (vMC * expF) / aP : 0;

  // 6. Spark
  const vSp = vBS;

  return {
    m_gas_hr: mG * 3600,
    m_air_hr: mA * 3600,
    afr,
    phi,
    kw: combOK ? mG * HV * (v.t_eff / 100) : 0,
    v_exit: vEx,
    v_thr: vTS,
    v_body: vBS,
    v_gas: vG,
    t_flame: tF,
    t_res: tRes,
    area_ratio: aRat,
    vol_cm3: volTotM3 * 1e6,
    v_at_spark: vSp,
    spark_ok: vSp > 0.3 && vSp < 8.0,
    ports_tot: nP,
    comb_ok: combOK,
  };
}

// ─── Ranges & Tier ────────────────────────────────────────────────────────────
const RANGES = {
  m_gas_hr: [0.01, 2],
  m_air_hr: [0.1, 30],
  afr: [10, 22],
  area_ratio: [3, 150],
  phi: [0.7, 1.5],
  kw: [0.5, 50],
  ports_tot: [4, 64],
  v_exit: [5, 18],
  v_thr: [3, 30],
  v_body: [1, 15],
  v_gas: [10, 500],
  t_flame: [1400, 1980],
  t_res: [10, 600],
  v_at_spark: [0.3, 8],
  vol_cm3: [10, 5000],
};

const TIER = {
  ok: { bg: "#052e16", border: "#16a34a", text: "#4ade80" },
  wn: { bg: "#1c1407", border: "#b45309", text: "#fbbf24" },
  bad: { bg: "#1c0505", border: "#991b1b", text: "#f87171" },
  n: { bg: "#0f172a", border: "#334155", text: "#94a3b8" },
};

function tier(key, val) {
  const r = RANGES[key];
  if (!r) return "n";
  const [lo, hi] = r,
    m = (hi - lo) * 0.1;
  if (lo <= val && val <= hi) return "ok";
  if (lo - m <= val && val <= hi + m) return "wn";
  return "bad";
}

function fv(v) {
  if (v == null || isNaN(v)) return "—";
  if (Math.abs(v) >= 1e5) return (v / 1000).toFixed(0) + "k";
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (Math.abs(v) >= 100) return v.toFixed(1);
  if (Math.abs(v) >= 10) return v.toFixed(2);
  return v.toFixed(3);
}

// ─── Default Parameters ───────────────────────────────────────────────────────
const DEFAULTS = {
  p_gas: 11,
  d_noz: 0.8,
  cd: 0.82,
  amb_temp: 20,
  d_thr: 14,
  d_air_in: 8,
  n_air_in: 2,
  m_eff: 85,
  cham_vol: 30, // New Chamber Vol Input
  thr_len: 85,
  body_len: 1500,
  body_id: 46,
  spark_bot: 100,
  rows: 4,
  hpr: 6,
  d_port: 10,
  t_eff: 88,
};

// ─── SVG Vertical Blueprint Component ─────────────────────────────────────────
function Diagram({ inp, out }) {
  const W = 450,
    H = 800,
    cx = W / 2,
    cyBase = 700,
    sc = 2.5;

  // Schematic Dimensions
  const cID = 39 * sc,
    cOD = (39 + 6.6) * sc,
    cH = 25 * sc;
  const tID = inp.d_thr * sc,
    tOD = 19 * sc,
    tL = inp.thr_len * sc;
  const bID = inp.body_id * sc,
    bOD = (inp.body_id + 6.6) * sc;
  const aD = inp.d_air_in * sc,
    pD = inp.d_port * sc * 0.3;
  const airY = cyBase - cH / 2;
  const tyBot = cyBase - cH - tL,
    tyTop = tyBot - 30;

  const headY = 120;
  const breakYBot = tyTop - 120,
    breakYTop = headY + 120;
  const midBreak = (breakYTop + breakYBot) / 2;

  const spY = tyTop - (10 + (inp.spark_bot / 300) * 80);
  const flameActive = out.comb_ok;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{
        width: "100%",
        height: "100%",
        background: "#0f172a",
        borderRadius: 12,
      }}
    >
      <defs>
        <linearGradient id="dMet" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#1e293b" />
          <stop offset="50%" stopColor="#334155" />
          <stop offset="100%" stopColor="#1e293b" />
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <marker
          id="arrow"
          viewBox="0 0 10 10"
          refX="10"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#38bdf8" />
        </marker>
      </defs>

      <line
        x1={cx}
        y1={cyBase + 50}
        x2={cx}
        y2={headY - 50}
        stroke="#334155"
        strokeDasharray="5,5"
      />

      {/* Gas Inlet */}
      <rect
        x={cx - 6}
        y={cyBase}
        width={12}
        height={50}
        fill="url(#dMet)"
        stroke="#38bdf8"
      />
      <rect x={cx - 3} y={cyBase - 8} width={6} height={8} fill="#f59e0b" />

      {/* Mixing Chamber */}
      <rect
        x={cx - cOD / 2}
        y={cyBase - cH}
        width={cOD}
        height={cH}
        fill="url(#dMet)"
        stroke="#38bdf8"
        strokeWidth={2}
      />
      <rect
        x={cx - cID / 2}
        y={cyBase - cH}
        width={cID}
        height={cH}
        fill="#0f172a"
      />

      {/* Air Inlets */}
      <rect
        x={cx - cOD / 2 - 2}
        y={airY - aD / 2}
        width={cOD / 2 - cID / 2 + 4}
        height={aD}
        fill="#0f172a"
      />
      <rect
        x={cx + cID / 2 - 2}
        y={airY - aD / 2}
        width={cOD / 2 - cID / 2 + 4}
        height={aD}
        fill="#0f172a"
      />
      <line
        x1={cx - cOD / 2 - 30}
        y1={airY}
        x2={cx - cID / 2 - 10}
        y2={airY}
        stroke="#38bdf8"
        strokeWidth={2}
        markerEnd="url(#arrow)"
      />
      <line
        x1={cx + cOD / 2 + 30}
        y1={airY}
        x2={cx + cID / 2 + 10}
        y2={airY}
        stroke="#38bdf8"
        strokeWidth={2}
        markerEnd="url(#arrow)"
      />

      {/* Throat */}
      <rect
        x={cx - tOD / 2}
        y={tyBot}
        width={tOD}
        height={tL}
        fill="url(#dMet)"
        stroke="#38bdf8"
        strokeWidth={2}
      />
      <rect x={cx - tID / 2} y={tyBot} width={tID} height={tL} fill="#0f172a" />
      <line
        x1={cx - tID / 2 + 2}
        y1={cyBase - cH}
        x2={cx + tID / 2 - 2}
        y2={cyBase - cH}
        stroke="#0f172a"
        strokeWidth={3}
      />

      {/* Transition */}
      <polygon
        points={`${cx - tOD / 2},${tyBot} ${cx - bOD / 2},${tyTop} ${
          cx + bOD / 2
        },${tyTop} ${cx + tOD / 2},${tyBot}`}
        fill="url(#dMet)"
        stroke="#38bdf8"
        strokeWidth={2}
      />
      <polygon
        points={`${cx - tID / 2},${tyBot} ${cx - bID / 2},${tyTop} ${
          cx + bID / 2
        },${tyTop} ${cx + tID / 2},${tyBot}`}
        fill="#0f172a"
      />

      {/* Body Bottom */}
      <rect
        x={cx - bOD / 2}
        y={breakYBot}
        width={bOD}
        height={tyTop - breakYBot}
        fill="url(#dMet)"
        stroke="#38bdf8"
        strokeWidth={2}
      />
      <rect
        x={cx - bID / 2}
        y={breakYBot}
        width={bID}
        height={tyTop - breakYBot}
        fill="#0f172a"
      />

      {/* Break Lines */}
      <polyline
        points={`${cx - bOD / 2 - 5},${breakYBot} ${
          cx - bOD / 2 + 10
        },${midBreak} ${cx - bOD / 2 - 10},${midBreak} ${
          cx - bOD / 2 + 5
        },${breakYTop}`}
        fill="none"
        stroke="#38bdf8"
        strokeWidth={2}
      />
      <polyline
        points={`${cx + bOD / 2 - 5},${breakYBot} ${
          cx + bOD / 2 + 10
        },${midBreak} ${cx + bOD / 2 - 10},${midBreak} ${
          cx + bOD / 2 + 5
        },${breakYTop}`}
        fill="none"
        stroke="#38bdf8"
        strokeWidth={2}
      />

      {/* Body Top */}
      <rect
        x={cx - bOD / 2}
        y={headY}
        width={bOD}
        height={breakYTop - headY}
        fill="url(#dMet)"
        stroke="#38bdf8"
        strokeWidth={2}
      />
      <rect
        x={cx - bID / 2}
        y={headY}
        width={bID}
        height={breakYTop - headY}
        fill="#0f172a"
      />

      {/* Closed Top Cap */}
      <line
        x1={cx - bOD / 2}
        y1={headY}
        x2={cx + bOD / 2}
        y2={headY}
        stroke="#38bdf8"
        strokeWidth={4}
      />

      {/* Spark Plug */}
      <line
        x1={cx - bOD / 2 - 40}
        y1={spY}
        x2={cx - bID / 2}
        y2={spY}
        stroke="#cbd5e1"
        strokeWidth={4}
      />
      <line
        x1={cx - bID / 2}
        y1={spY}
        x2={cx - 10}
        y2={spY}
        stroke="#ef4444"
        strokeWidth={3}
      />

      {/* Ports and Side Flames */}
      {Array.from({ length: Math.min(6, inp.rows) }, (_, i) => {
        let py = headY + 15 + i * 15;
        return (
          <g key={i}>
            <ellipse
              cx={cx - bOD / 2}
              cy={py}
              rx={pD}
              ry={pD * 1.5}
              fill="#0f172a"
              stroke="#38bdf8"
            />
            <ellipse
              cx={cx + bOD / 2}
              cy={py}
              rx={pD}
              ry={pD * 1.5}
              fill="#0f172a"
              stroke="#38bdf8"
            />
          </g>
        );
      })}

      {/* Flame Plume */}
      {flameActive && (
        <>
          <polygon
            points={`${cx - bID / 2 + 4},${spY} ${cx + bID / 2 - 4},${spY} ${
              cx + bID / 2 - 8
            },${breakYBot} ${cx - bID / 2 + 8},${breakYBot}`}
            fill="#c2410c"
            opacity="0.6"
          />
          <polygon
            points={`${cx - bID / 2 + 8},${breakYTop} ${
              cx + bID / 2 - 8
            },${breakYTop} ${cx + bID / 2 - 4},${headY} ${
              cx - bID / 2 + 4
            },${headY}`}
            fill="#c2410c"
            opacity="0.6"
          />

          {Array.from({ length: Math.min(6, inp.rows) }, (_, i) => {
            let py = headY + 15 + i * 15;
            return (
              <g key={`flame-${i}`}>
                <path
                  d={`M ${cx - bOD / 2} ${py + pD} Q ${cx - bOD / 2 - 15} ${
                    py + 5
                  } ${cx - bOD / 2 - 35} ${py - 15} Q ${cx - bOD / 2 - 10} ${
                    py - 5
                  } ${cx - bOD / 2} ${py - pD} Z`}
                  fill="#f97316"
                  opacity="0.85"
                  filter="url(#glow)"
                />
                <path
                  d={`M ${cx - bOD / 2} ${py + pD / 2} Q ${cx - bOD / 2 - 10} ${
                    py + 2
                  } ${cx - bOD / 2 - 20} ${py - 10} Q ${cx - bOD / 2 - 5} ${
                    py - 2
                  } ${cx - bOD / 2} ${py - pD / 2} Z`}
                  fill="#fde047"
                  opacity="0.9"
                />
                <path
                  d={`M ${cx + bOD / 2} ${py + pD} Q ${cx + bOD / 2 + 15} ${
                    py + 5
                  } ${cx + bOD / 2 + 35} ${py - 15} Q ${cx + bOD / 2 + 10} ${
                    py - 5
                  } ${cx + bOD / 2} ${py - pD} Z`}
                  fill="#f97316"
                  opacity="0.85"
                  filter="url(#glow)"
                />
                <path
                  d={`M ${cx + bOD / 2} ${py + pD / 2} Q ${cx + bOD / 2 + 10} ${
                    py + 2
                  } ${cx + bOD / 2 + 20} ${py - 10} Q ${cx + bOD / 2 + 5} ${
                    py - 2
                  } ${cx + bOD / 2} ${py - pD / 2} Z`}
                  fill="#fde047"
                  opacity="0.9"
                />
              </g>
            );
          })}
        </>
      )}

      {/* Annotations */}
      <text
        x={cx - 15}
        y={cyBase - 5}
        fill="#94a3b8"
        fontSize={10}
        fontFamily="monospace"
        textAnchor="end"
      >
        Noz: {inp.d_noz.toFixed(1)}mm
      </text>
      <text
        x={cx - cOD / 2 - 35}
        y={airY - 10}
        fill="#38bdf8"
        fontSize={10}
        fontFamily="monospace"
        textAnchor="end"
      >
        AIR IN
      </text>
      <text
        x={cx + cOD / 2 + 35}
        y={airY - 10}
        fill="#38bdf8"
        fontSize={10}
        fontFamily="monospace"
        textAnchor="start"
      >
        AIR IN
      </text>
      <text
        x={cx + cID / 2 - 5}
        y={cyBase - cH + 10}
        fill="#10b981"
        fontSize={9}
        fontFamily="monospace"
        textAnchor="start"
      >
        Vol: {inp.cham_vol.toFixed(0)}cm³
      </text>
      <text
        x={cx + tID / 2 + 15}
        y={tyBot + tL / 2}
        fill="#94a3b8"
        fontSize={10}
        fontFamily="monospace"
      >
        Throat: {inp.d_thr.toFixed(1)}mm
      </text>
      <text
        x={cx}
        y={midBreak}
        fill="#94a3b8"
        fontSize={12}
        fontFamily="monospace"
        textAnchor="middle"
      >
        L = {inp.body_len}mm
      </text>
      <text
        x={cx + bOD / 2 + 15}
        y={tyTop - 20}
        fill="#94a3b8"
        fontSize={10}
        fontFamily="monospace"
      >
        ID: {inp.body_id.toFixed(1)}mm
      </text>
    </svg>
  );
}

// ─── Input Slider ─────────────────────────────────────────────────────────────
function Slider({ label, unit, min, max, step, value, onChange, color }) {
  const fmt = (v) =>
    step < 0.1 ? v.toFixed(2) : step < 1 ? v.toFixed(1) : v.toFixed(0);
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 2,
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: "#94a3b8",
            fontFamily: "'Space Mono',monospace",
          }}
        >
          {label} {unit && `(${unit})`}
        </span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: color || "#38bdf8",
            fontFamily: "'Space Mono',monospace",
          }}
        >
          {fmt(value)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{
          width: "100%",
          accentColor: color || "#38bdf8",
          cursor: "pointer",
        }}
      />
    </div>
  );
}

// ─── Excel Export Logic ────────────────────────────────────────────────────────
function doExport(inp, out) {
  const wb = XLSX.utils.book_new();
  const data = [
    ["BiHorns Engineering - Pioneer Pilot System", ""],
    [""],
    ["INPUT PARAMETERS", "Value", "Unit"],
    ["Gas Pressure", inp.p_gas, "PSI"],
    ["Nozzle Ø", inp.d_noz, "mm"],
    ["Throat Ø", inp.d_thr, "mm"],
    ["Air Inlet Ø", inp.d_air_in, "mm"],
    ["Chamber Volume", inp.cham_vol, "cm³"],
    ["Throat Length", inp.thr_len, "mm"],
    ["Pilot Body Ø", inp.body_id, "mm"],
    ["Pilot Body Length", inp.body_len, "mm"],
    ["Spark From Throat", inp.spark_bot, "mm"],
    [""],
    ["CALCULATED RESULTS", "Value", "Unit", "Status"],
    [
      "Gas Mass Flow",
      out.m_gas_hr.toFixed(2),
      "kg/hr",
      tier("m_gas_hr", out.m_gas_hr).toUpperCase(),
    ],
    [
      "Air Mass Flow",
      out.m_air_hr.toFixed(2),
      "kg/hr",
      tier("m_air_hr", out.m_air_hr).toUpperCase(),
    ],
    [
      "Equivalence Ratio (Φ)",
      out.phi.toFixed(3),
      "—",
      tier("phi", out.phi).toUpperCase(),
    ],
    [
      "Flame Temp",
      out.t_flame.toFixed(0),
      "°C",
      tier("t_flame", out.t_flame).toUpperCase(),
    ],
    [
      "Exit Velocity",
      out.v_exit.toFixed(2),
      "m/s",
      tier("v_exit", out.v_exit).toUpperCase(),
    ],
    [
      "Body Velocity",
      out.v_body.toFixed(2),
      "m/s",
      tier("v_body", out.v_body).toUpperCase(),
    ],
    ["Total Internal Volume", out.vol_cm3.toFixed(0), "cm³", "—"],
    [
      "Residence Time",
      out.t_res.toFixed(1),
      "ms",
      tier("t_res", out.t_res).toUpperCase(),
    ],
    ["Ignition State", out.comb_ok ? "ACTIVE" : "FAILED", "—", "—"],
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, "Pilot Data");
  XLSX.writeFile(wb, `BiHorns_Pilot_${new Date().getTime()}.xlsx`);
}

// ─── Main Application Component ───────────────────────────────────────────────
export default function FlarePilotApp() {
  useFonts();
  const [inp, setInp] = useState(DEFAULTS);
  const out = useMemo(() => compute(inp), [inp]);

  const update = (k, v) => setInp((prev) => ({ ...prev, [k]: v }));

  const resBlock = (label, val, unit, key) => {
    const t = tier(key, val);
    const color = TIER[t].text;
    return (
      <div
        style={{
          background: "#0f172a",
          padding: "10px 15px",
          borderRadius: 6,
          borderLeft: `4px solid ${color}`,
          marginBottom: 8,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span
          style={{
            color: "#94a3b8",
            fontFamily: "'Space Mono',monospace",
            fontSize: 12,
          }}
        >
          {label}
        </span>
        <span
          style={{
            color,
            fontFamily: "'Space Mono',monospace",
            fontWeight: "bold",
            fontSize: 14,
          }}
        >
          {fv(val)} <span style={{ fontSize: 10, opacity: 0.7 }}>{unit}</span>
        </span>
      </div>
    );
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#1e293b",
        padding: 20,
        color: "white",
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "#0f172a",
          padding: 20,
          borderRadius: 8,
        }}
      >
        <div>
          <h1
            style={{
              fontFamily: "'Rajdhani',sans-serif",
              margin: 0,
              color: "#f8fafc",
              fontSize: 28,
            }}
          >
            BIHORNS ENGINEERING
          </h1>
          <span
            style={{
              color: "#94a3b8",
              fontFamily: "'Space Mono',monospace",
              fontSize: 12,
            }}
          >
            V9 Dynamic Volume Engine
          </span>
        </div>
        <button
          onClick={() => doExport(inp, out)}
          style={{
            background: "#10b981",
            color: "white",
            border: "none",
            padding: "10px 20px",
            borderRadius: 6,
            cursor: "pointer",
            fontWeight: "bold",
            fontFamily: "'Rajdhani',sans-serif",
            fontSize: 16,
          }}
        >
          EXPORT TO EXCEL
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "350px 1fr 350px",
          gap: 20,
          flex: 1,
        }}
      >
        {/* Left: Inputs */}
        <div
          style={{
            background: "#111827",
            padding: 20,
            borderRadius: 8,
            overflowY: "auto",
            maxHeight: "80vh",
          }}
        >
          <h3
            style={{
              fontFamily: "'Rajdhani',sans-serif",
              borderBottom: "1px solid #334155",
              paddingBottom: 10,
              color: "#38bdf8",
            }}
          >
            GAS INJECTION
          </h3>
          <Slider
            label="Gas Pressure"
            unit="PSI"
            min={1}
            max={60}
            step={0.5}
            value={inp.p_gas}
            onChange={(v) => update("p_gas", v)}
            color="#f59e0b"
          />
          <Slider
            label="Nozzle Ø"
            unit="mm"
            min={0.3}
            max={3.0}
            step={0.05}
            value={inp.d_noz}
            onChange={(v) => update("d_noz", v)}
            color="#f59e0b"
          />

          <h3
            style={{
              fontFamily: "'Rajdhani',sans-serif",
              borderBottom: "1px solid #334155",
              paddingBottom: 10,
              marginTop: 30,
              color: "#38bdf8",
            }}
          >
            VENTURI & AIR
          </h3>
          <Slider
            label="Throat Ø"
            unit="mm"
            min={8}
            max={50}
            step={0.5}
            value={inp.d_thr}
            onChange={(v) => update("d_thr", v)}
          />
          <Slider
            label="Air Inlet Ø"
            unit="mm"
            min={4}
            max={30}
            step={0.5}
            value={inp.d_air_in}
            onChange={(v) => update("d_air_in", v)}
          />
          <Slider
            label="Chamber Volume"
            unit="cm³"
            min={5}
            max={150}
            step={1}
            value={inp.cham_vol}
            onChange={(v) => update("cham_vol", v)}
            color="#10b981"
          />

          <h3
            style={{
              fontFamily: "'Rajdhani',sans-serif",
              borderBottom: "1px solid #334155",
              paddingBottom: 10,
              marginTop: 30,
              color: "#38bdf8",
            }}
          >
            PILOT BODY
          </h3>
          <Slider
            label="Throat Length"
            unit="mm"
            min={50}
            max={300}
            step={5}
            value={inp.thr_len}
            onChange={(v) => update("thr_len", v)}
            color="#10b981"
          />
          <Slider
            label="Body Length"
            unit="mm"
            min={500}
            max={3000}
            step={50}
            value={inp.body_len}
            onChange={(v) => update("body_len", v)}
            color="#10b981"
          />
          <Slider
            label="Body ID"
            unit="mm"
            min={20}
            max={100}
            step={1}
            value={inp.body_id}
            onChange={(v) => update("body_id", v)}
            color="#10b981"
          />

          <h3
            style={{
              fontFamily: "'Rajdhani',sans-serif",
              borderBottom: "1px solid #334155",
              paddingBottom: 10,
              marginTop: 30,
              color: "#38bdf8",
            }}
          >
            PORTS & SPARK
          </h3>
          <Slider
            label="Spark Dist. from Throat"
            unit="mm"
            min={50}
            max={300}
            step={5}
            value={inp.spark_bot}
            onChange={(v) => update("spark_bot", v)}
            color="#ef4444"
          />
          <Slider
            label="Port Rows"
            unit=""
            min={1}
            max={8}
            step={1}
            value={inp.rows}
            onChange={(v) => update("rows", v)}
            color="#c084fc"
          />
          <Slider
            label="Holes/Row"
            unit=""
            min={1}
            max={12}
            step={1}
            value={inp.hpr}
            onChange={(v) => update("hpr", v)}
            color="#c084fc"
          />
          <Slider
            label="Port Ø"
            unit="mm"
            min={2}
            max={20}
            step={0.5}
            value={inp.d_port}
            onChange={(v) => update("d_port", v)}
            color="#c084fc"
          />
        </div>

        {/* Center: Diagram */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            background: "#111827",
            padding: 20,
            borderRadius: 8,
          }}
        >
          <div
            style={{
              height: "100%",
              width: "100%",
              maxWidth: 450,
              maxHeight: 800,
            }}
          >
            <Diagram inp={inp} out={out} />
          </div>
        </div>

        {/* Right: Results */}
        <div
          style={{
            background: "#111827",
            padding: 20,
            borderRadius: 8,
            overflowY: "auto",
            maxHeight: "80vh",
          }}
        >
          <div
            style={{
              background: out.comb_ok ? "#064e3b" : "#7f1d1d",
              padding: 15,
              borderRadius: 8,
              textAlign: "center",
              marginBottom: 20,
            }}
          >
            <h2
              style={{
                margin: 0,
                fontFamily: "'Space Mono',monospace",
                color: out.comb_ok ? "#34d399" : "#fca5a5",
              }}
            >
              {out.comb_ok ? "STABLE COMBUSTION" : "IGNITION FAILURE"}
            </h2>
          </div>

          <h3
            style={{
              fontFamily: "'Rajdhani',sans-serif",
              color: "#94a3b8",
              marginBottom: 10,
            }}
          >
            MIXING & CHEMISTRY
          </h3>
          {resBlock("Equivalence (Φ)", out.phi, "", "phi")}
          {resBlock("Air/Fuel Ratio", out.afr, ":1", "afr")}
          {resBlock("Area Ratio", out.area_ratio, ":1", "area_ratio")}

          <h3
            style={{
              fontFamily: "'Rajdhani',sans-serif",
              color: "#94a3b8",
              marginTop: 20,
              marginBottom: 10,
            }}
          >
            FLOW DYNAMICS
          </h3>
          {resBlock("Gas Mass Flow", out.m_gas_hr, "kg/h", "m_gas_hr")}
          {resBlock("Air Mass Flow", out.m_air_hr, "kg/h", "m_air_hr")}
          {resBlock("Throat Velocity", out.v_thr, "m/s", "v_thr")}
          {resBlock("Body Velocity", out.v_body, "m/s", "v_body")}

          <h3
            style={{
              fontFamily: "'Rajdhani',sans-serif",
              color: "#94a3b8",
              marginTop: 20,
              marginBottom: 10,
            }}
          >
            IGNITION & EXIT
          </h3>
          {resBlock("Internal Volume", out.vol_cm3, "cm³", "vol_cm3")}
          {resBlock("Residence Time", out.t_res, "ms", "t_res")}
          {resBlock("Spark Velocity", out.v_at_spark, "m/s", "v_at_spark")}
          {resBlock("Exit Velocity", out.v_exit, "m/s", "v_exit")}
          {resBlock("Flame Temp", out.t_flame, "°C", "t_flame")}
          {resBlock("Thermal Power", out.kw, "kW", "kw")}
        </div>
      </div>
    </div>
  );
}
